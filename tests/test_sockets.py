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
