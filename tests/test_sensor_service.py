from app.services import sensor_service as sensor_module
from app.services.sensor_service import SensorService


class FakePi:
    def __init__(self, bits=None, connected=True):
        self.connected = connected
        self.bits = list(bits or [])
        self.modes = []
        self.writes = []
        self.servo_pulsewidths = []

    def set_mode(self, pin, mode):
        self.modes.append((pin, mode))

    def write(self, pin, value):
        self.writes.append((pin, value))

    def read(self, pin):
        return self.bits.pop(0)

    def set_servo_pulsewidth(self, pin, pulsewidth):
        self.servo_pulsewidths.append((pin, pulsewidth))


class FakePigpioModule:
    OUTPUT = 1
    INPUT = 0

    def __init__(self, pi_instance):
        self._pi_instance = pi_instance

    def pi(self):
        return self._pi_instance


def bits_for_word(word):
    return [int(bit) for bit in f"{word:016b}"]


def test_simulated_sensor_sample_shape():
    sensor = SensorService(sensor_mode="simulated")
    sample = sensor.read_sample()

    assert sample["source"] == "simulated"
    assert set(sample) == {
        "timestamp",
        "temperature",
        "source",
        "flame_level",
    }
    assert 188.0 <= sample["temperature"] <= 225.0


def test_pigpio_max6675_temperature_read(monkeypatch):
    fake_pi = FakePi(bits=bits_for_word(0x0C80))
    monkeypatch.setattr(sensor_module, "pigpio", FakePigpioModule(fake_pi))
    monkeypatch.setattr(sensor_module.time, "sleep", lambda *_args: None)

    sensor = SensorService(sensor_mode="pigpio")
    temperature = sensor._read_temperature()

    assert sensor.source_name == "pigpio-max6675"
    assert temperature == 100.0
    assert fake_pi.modes == [
        (sensor.cs_pin, FakePigpioModule.OUTPUT),
        (sensor.clk_pin, FakePigpioModule.OUTPUT),
        (sensor.do_pin, FakePigpioModule.INPUT),
        (sensor.servo_pin, FakePigpioModule.OUTPUT),
    ]


def test_pigpio_open_circuit_returns_none(monkeypatch):
    fake_pi = FakePi(bits=bits_for_word(0x0004))
    monkeypatch.setattr(sensor_module, "pigpio", FakePigpioModule(fake_pi))
    monkeypatch.setattr(sensor_module.time, "sleep", lambda *_args: None)

    sensor = SensorService(sensor_mode="pigpio")

    assert sensor._read_temperature() is None
    assert sensor._last_temperature_error == "Thermocouple open circuit"


def test_pigpio_falls_back_when_unavailable(monkeypatch):
    monkeypatch.setattr(sensor_module, "pigpio", None)

    sensor = SensorService(sensor_mode="pigpio")

    assert sensor.source_name == "simulated"
    assert sensor.read_sample()["source"] == "simulated"


def test_servo_flame_controller_updates_pulsewidth(monkeypatch):
    fake_pi = FakePi(bits=bits_for_word(0x0C80))
    monkeypatch.setattr(sensor_module, "pigpio", FakePigpioModule(fake_pi))

    sensor = SensorService(sensor_mode="pigpio")
    result = sensor.set_flame_level(75)

    assert result["flame_level"] == 75
    assert fake_pi.servo_pulsewidths[-1] == (sensor.servo_pin, 1750)


def test_health_status_reports_hardware_ok(monkeypatch):
    fake_pi = FakePi(bits=bits_for_word(0x0C80))
    monkeypatch.setattr(sensor_module, "pigpio", FakePigpioModule(fake_pi))
    monkeypatch.setattr(sensor_module.time, "sleep", lambda *_args: None)

    sensor = SensorService(sensor_mode="pigpio")
    health = sensor.health_status()

    assert health["connected"] is True
    assert health["temperature_ok"] is True
    assert health["servo_ok"] is True


def _pigpio_sensor(monkeypatch, fake_pi, **kwargs):
    monkeypatch.setattr(sensor_module, "pigpio", FakePigpioModule(fake_pi))
    monkeypatch.setattr(sensor_module.time, "sleep", lambda *_args: None)
    return SensorService(sensor_mode="pigpio", **kwargs)


def test_health_status_reuses_recent_loop_read_without_touching_bus(monkeypatch):
    # Bits for exactly one read: a second read would pop from an empty list.
    fake_pi = FakePi(bits=bits_for_word(0x0C80))
    sensor = _pigpio_sensor(monkeypatch, fake_pi)

    sample = sensor.read_sample()
    writes_after_loop_read = len(fake_pi.writes)

    health = sensor.health_status()

    assert sample["temperature"] == 100.0
    assert health["temperature_ok"] is True
    assert health["last_temperature_error"] is None
    assert len(fake_pi.writes) == writes_after_loop_read
    assert fake_pi.bits == []


def test_health_status_reports_cached_open_circuit_without_rereading(monkeypatch):
    fake_pi = FakePi(bits=bits_for_word(0x0004))
    sensor = _pigpio_sensor(monkeypatch, fake_pi)

    sensor.read_sample()
    writes_after_loop_read = len(fake_pi.writes)

    health = sensor.health_status()

    assert health["temperature_ok"] is False
    assert health["last_temperature_error"] == "Thermocouple open circuit"
    assert len(fake_pi.writes) == writes_after_loop_read


def test_health_status_reads_directly_when_last_read_is_stale(monkeypatch):
    fake_pi = FakePi(bits=bits_for_word(0x0004) + bits_for_word(0x0C80))
    sensor = _pigpio_sensor(monkeypatch, fake_pi)

    sensor.read_sample()  # open circuit, recorded as the last loop result
    sensor._last_read_monotonic = sensor_module.time.monotonic() - 100

    health = sensor.health_status()  # stale, so it reads again and sees 100 C

    assert health["temperature_ok"] is True
    assert health["last_temperature_error"] is None
    assert fake_pi.bits == []


def test_health_status_survives_direct_read_failure(monkeypatch):
    class DisconnectingPi(FakePi):
        armed = False

        def write(self, pin, value):
            if self.armed:
                raise RuntimeError("pigpio daemon connection lost")
            super().write(pin, value)

    fake_pi = DisconnectingPi(bits=bits_for_word(0x0C80))
    sensor = _pigpio_sensor(monkeypatch, fake_pi)
    fake_pi.armed = True

    health = sensor.health_status()

    assert health["connected"] is True
    assert health["temperature_ok"] is False
    assert "pigpio daemon connection lost" in health["last_temperature_error"]


def test_temperature_read_holds_bus_lock(monkeypatch):
    class LockCheckingPi(FakePi):
        sensor = None

        def read(self, pin):
            assert self.sensor._bus_lock.locked(), "bus read outside the lock"
            return super().read(pin)

    fake_pi = LockCheckingPi(bits=bits_for_word(0x0C80))
    sensor = _pigpio_sensor(monkeypatch, fake_pi)
    fake_pi.sensor = sensor

    assert sensor.read_sample()["temperature"] == 100.0
    assert not sensor._bus_lock.locked()


def test_pigpio_open_circuit_sample_reports_fault_not_fake_value(monkeypatch):
    fake_pi = FakePi(bits=bits_for_word(0x0004))
    sensor = _pigpio_sensor(monkeypatch, fake_pi)

    sample = sensor.read_sample()

    assert sample["temperature"] is None
    assert sample["error"] == "Thermocouple open circuit"
    assert sample["source"] == "pigpio-max6675"
    assert sample["flame_level"] == 50


def test_pigpio_good_read_sample_has_no_error(monkeypatch):
    fake_pi = FakePi(bits=bits_for_word(0x0C80))
    sensor = _pigpio_sensor(monkeypatch, fake_pi)

    sample = sensor.read_sample()

    assert sample["temperature"] == 100.0
    assert "error" not in sample
