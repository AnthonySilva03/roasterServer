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
        "speed",
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


def test_servo_speed_controller_updates_pulsewidth(monkeypatch):
    fake_pi = FakePi(bits=bits_for_word(0x0C80))
    monkeypatch.setattr(sensor_module, "pigpio", FakePigpioModule(fake_pi))

    sensor = SensorService(sensor_mode="pigpio")
    result = sensor.set_speed(75)

    assert result["speed"] == 75
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
