from app import sockets as sockets_module


class FlakySensor:
    """Fails on the first read, then returns samples normally."""

    active = True

    def __init__(self, failures=1):
        self.calls = 0
        self.failures = failures

    def read_sample(self):
        self.calls += 1
        if self.calls <= self.failures:
            raise RuntimeError("pigpio daemon disconnected")
        return {
            "timestamp": "00:00:00",
            "temperature": 100.0 + self.calls,
            "source": "fake",
            "flame_level": 50,
        }


def _wire(monkeypatch, sensor):
    emitted = []
    monkeypatch.setattr(sockets_module, "sensor_service", sensor)
    monkeypatch.setattr(sockets_module, "latest_sample", None)
    monkeypatch.setattr(sockets_module, "consecutive_read_failures", 0)
    monkeypatch.setattr(sockets_module.socketio, "emit", lambda event, data: emitted.append((event, data)))
    return emitted


def test_sensor_tick_survives_read_failure_and_recovers(monkeypatch):
    sensor = FlakySensor(failures=1)
    emitted = _wire(monkeypatch, sensor)

    sockets_module._sensor_tick()  # read raises; must not propagate
    assert emitted == []
    assert sockets_module.latest_sample is None
    assert sockets_module.consecutive_read_failures == 1

    sockets_module._sensor_tick()  # read succeeds; broadcasting resumes
    assert sockets_module.consecutive_read_failures == 0
    assert len(emitted) == 1
    assert emitted[0][0] == "sensor_data"
    assert emitted[0][1]["temperature"] == 102.0
    assert sockets_module.latest_sample is emitted[0][1]


def test_sensor_tick_keeps_counting_consecutive_failures(monkeypatch):
    sensor = FlakySensor(failures=5)
    emitted = _wire(monkeypatch, sensor)

    for _ in range(5):
        sockets_module._sensor_tick()

    assert emitted == []
    assert sockets_module.consecutive_read_failures == 5


def test_sensor_tick_skips_when_paused(monkeypatch):
    sensor = FlakySensor(failures=0)
    sensor.active = False
    emitted = _wire(monkeypatch, sensor)

    sockets_module._sensor_tick()

    assert sensor.calls == 0
    assert emitted == []


class FaultingSensor:
    """Returns open-circuit fault samples, then a real reading."""

    active = True

    def __init__(self, faults=1):
        self.calls = 0
        self.faults = faults

    def read_sample(self):
        self.calls += 1
        if self.calls <= self.faults:
            return {
                "timestamp": "00:00:00",
                "temperature": None,
                "source": "pigpio-max6675",
                "flame_level": 50,
                "error": "Thermocouple open circuit",
            }
        return {"timestamp": "00:00:02", "temperature": 180.0, "source": "pigpio-max6675", "flame_level": 50}


def test_sensor_tick_broadcasts_fault_samples_and_counts_them(monkeypatch):
    sensor = FaultingSensor(faults=2)
    emitted = _wire(monkeypatch, sensor)

    sockets_module._sensor_tick()
    sockets_module._sensor_tick()

    assert [payload.get("error") for _, payload in emitted] == ["Thermocouple open circuit"] * 2
    assert all(payload["temperature"] is None for _, payload in emitted)
    assert sockets_module.consecutive_read_failures == 2
    assert sockets_module.latest_sample["error"] == "Thermocouple open circuit"

    sockets_module._sensor_tick()

    assert sockets_module.consecutive_read_failures == 0
    assert emitted[-1][1]["temperature"] == 180.0
    assert "error" not in emitted[-1][1]


class ScriptedSensor:
    """Returns the given temperatures in order (None = fault) and records flame changes."""

    active = True
    source_name = "pigpio-max6675"

    def __init__(self, temperatures):
        self.temperatures = list(temperatures)
        self.flame_level = 60
        self.flame_changes = []

    def read_sample(self):
        temperature = self.temperatures.pop(0)
        sample = {"timestamp": "00:00:00", "temperature": temperature, "source": self.source_name, "flame_level": self.flame_level}
        if temperature is None:
            sample["error"] = "Thermocouple open circuit"
        return sample

    def set_flame_level(self, level):
        self.flame_level = int(level)
        self.flame_changes.append(self.flame_level)
        return {"flame_level": self.flame_level, "source": self.source_name}

    def health_status(self):
        return {"flame_level": self.flame_level}


def _wire_safety(monkeypatch, sensor, max_temp=0.0, policy="hold", after=5):
    emitted = _wire(monkeypatch, sensor)
    monkeypatch.setattr(sockets_module, "max_bean_temp_c", max_temp)
    monkeypatch.setattr(sockets_module, "sensor_fault_flame_policy", policy)
    monkeypatch.setattr(sockets_module, "sensor_fault_flame_after", after)
    monkeypatch.setattr(sockets_module, "over_temperature_active", False)
    return emitted


def test_over_temperature_cuts_flame_once_and_rearms(monkeypatch):
    sensor = ScriptedSensor([240.0, 251.0, 252.0, 244.0, 251.0])
    emitted = _wire_safety(monkeypatch, sensor, max_temp=250)

    sockets_module._sensor_tick()  # 240: below the limit
    assert sensor.flame_changes == []

    sockets_module._sensor_tick()  # 251: cutoff
    assert sensor.flame_changes == [0]
    safety = [payload for event, payload in emitted if event == "safety_event"]
    assert len(safety) == 1
    assert safety[0]["type"] == "over_temperature"
    assert safety[0]["previous_flame_level"] == 60
    assert any(event == "sensor_state" and payload["flame_level"] == 0 for event, payload in emitted)

    sensor.flame_level = 30  # the roaster turns the flame back up
    sockets_module._sensor_tick()  # 252: still over, no second cutoff until re-armed
    assert sensor.flame_changes == [0]

    sockets_module._sensor_tick()  # 244: more than 5 °C below the limit -> re-armed
    sockets_module._sensor_tick()  # 251: cut again
    assert sensor.flame_changes == [0, 0]


def test_over_temperature_disabled_when_limit_is_zero(monkeypatch):
    sensor = ScriptedSensor([300.0])
    emitted = _wire_safety(monkeypatch, sensor, max_temp=0)
    sockets_module._sensor_tick()
    assert sensor.flame_changes == []
    assert all(event != "safety_event" for event, _ in emitted)


def test_sensor_fault_policy_min_cuts_flame_after_n_faults(monkeypatch):
    sensor = ScriptedSensor([None, None, None, 180.0])
    emitted = _wire_safety(monkeypatch, sensor, policy="min", after=3)

    sockets_module._sensor_tick()
    sockets_module._sensor_tick()
    assert sensor.flame_changes == []

    sockets_module._sensor_tick()  # third consecutive fault
    assert sensor.flame_changes == [0]
    assert [payload["type"] for event, payload in emitted if event == "safety_event"] == ["sensor_fault"]

    sockets_module._sensor_tick()  # recovery does not touch the flame
    assert sensor.flame_changes == [0]


def test_sensor_fault_policy_hold_leaves_flame_alone(monkeypatch):
    sensor = ScriptedSensor([None] * 6)
    emitted = _wire_safety(monkeypatch, sensor, policy="hold", after=3)
    for _ in range(6):
        sockets_module._sensor_tick()
    assert sensor.flame_changes == []
    assert all(event != "safety_event" for event, _ in emitted)
