import re

from app.services import sensor_service as sensor_module
from app.services.sensor_service import SensorService


class FakePi:
    """Models the MAX6675 serial output, not just a bit queue.

    Pulling CS low latches the next 16-bit frame and drives D15 on SO; each
    falling SCK edge shifts the next bit out (datasheet timing). A reader that
    clocks before sampling therefore loses D15 and reads every bit one place
    high, which is exactly the doubled-temperature bug this guards against.
    """

    CS_PIN = sensor_module.DEFAULT_CS_PIN
    CLK_PIN = sensor_module.DEFAULT_CLK_PIN

    def __init__(self, bits=None, connected=True):
        self.connected = connected
        self.bits = list(bits or [])
        self.modes = []
        self.writes = []
        self.servo_pulsewidths = []
        self._frame = []
        self._index = 0
        self._clk = 0

    def set_mode(self, pin, mode):
        self.modes.append((pin, mode))

    def write(self, pin, value):
        self.writes.append((pin, value))
        if pin == self.CS_PIN and value == 0:
            # Fail loudly on an unexpected extra read instead of returning 0 °C.
            assert len(self.bits) >= 16, "MAX6675 read with no frame queued"
            self._frame, self.bits = self.bits[:16], self.bits[16:]
            self._index = 0
        elif pin == self.CLK_PIN:
            if self._clk == 1 and value == 0:
                self._index += 1
            self._clk = value

    def read(self, pin):
        return self._frame[self._index] if self._index < len(self._frame) else 0

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
    assert re.fullmatch(r"\d{2}:\d{2}:\d{2}\.\d{3}", sample["timestamp"])


def test_sample_timestamp_has_milliseconds_and_rounds_safely():
    assert sensor_module._sample_timestamp(1_700_000_000.250).endswith(".250")
    # Rounding 0.9996 s carries into the next second instead of emitting ".1000".
    assert sensor_module._sample_timestamp(1_700_000_000.9996).endswith(".000")
    assert re.fullmatch(r"\d{2}:\d{2}:\d{2}\.\d{3}", sensor_module._sample_timestamp())


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


# --- MAX6675 decoding regression tests -------------------------------------
# A MAX6675 frame is D15 = 0, D14..D3 = temperature in 0.25 °C steps,
# D2 = thermocouple open, D1 = device ID (0), D0 = tri-state.

def max6675_word(celsius, open_circuit=False):
    return (int(round(celsius / 0.25)) << 3) | (0x4 if open_circuit else 0)


import pytest  # noqa: E402


@pytest.mark.parametrize("celsius", [0.0, 0.25, 21.5, 22.0, 100.0, 196.75, 250.0, 1023.75])
def test_max6675_reads_exact_temperature_across_range(monkeypatch, celsius):
    fake_pi = FakePi(bits=bits_for_word(max6675_word(celsius)))
    sensor = _pigpio_sensor(monkeypatch, fake_pi)

    assert sensor._read_temperature() == celsius
    assert sensor._last_temperature_error is None


def test_room_temperature_is_not_doubled(monkeypatch):
    # Regression: clocking SCK before sampling SO dropped D15 and shifted every
    # bit one place high, so a 22 °C room read as 44 °C.
    fake_pi = FakePi(bits=bits_for_word(max6675_word(22.0)))
    sensor = _pigpio_sensor(monkeypatch, fake_pi)

    temperature = sensor.read_sample()["temperature"]

    assert temperature == 22.0
    assert temperature != 44.0


def test_reads_sample_bit_before_each_clock_pulse(monkeypatch):
    class OrderRecordingPi(FakePi):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.events = []

        def write(self, pin, value):
            if pin == self.CLK_PIN:
                self.events.append(f"clk{value}")
            super().write(pin, value)

        def read(self, pin):
            self.events.append("read")
            return super().read(pin)

    fake_pi = OrderRecordingPi(bits=bits_for_word(max6675_word(22.0)))
    sensor = _pigpio_sensor(monkeypatch, fake_pi)
    fake_pi.events.clear()  # drop the idle-low write from setup

    sensor._read_temperature()

    assert fake_pi.events.count("read") == 16
    assert fake_pi.events[0] == "read", "D15 is valid as soon as CS falls; read it before clocking"
    assert fake_pi.events[:3] == ["read", "clk1", "clk0"]


@pytest.mark.parametrize("celsius", [22.0, 250.0, 1023.75])
def test_open_circuit_wins_over_any_temperature_bits(monkeypatch, celsius):
    fake_pi = FakePi(bits=bits_for_word(max6675_word(celsius, open_circuit=True)))
    sensor = _pigpio_sensor(monkeypatch, fake_pi)

    sample = sensor.read_sample()

    assert sample["temperature"] is None
    assert sample["error"] == "Thermocouple open circuit"


def test_device_id_and_tristate_bits_do_not_change_temperature(monkeypatch):
    # D1 and D0 carry no temperature; a reader shifted by one would fold D2/D1
    # into the value. Set D0 high (tri-state noise) and expect the same reading.
    fake_pi = FakePi(bits=bits_for_word(max6675_word(21.5) | 0x1))
    sensor = _pigpio_sensor(monkeypatch, fake_pi)

    assert sensor._read_temperature() == 21.5


def test_health_reports_latest_temperature_and_clears_it_on_fault(monkeypatch):
    fake_pi = FakePi(bits=bits_for_word(max6675_word(21.5)) + bits_for_word(max6675_word(0, open_circuit=True)))
    sensor = _pigpio_sensor(monkeypatch, fake_pi)

    sensor.read_sample()
    assert sensor.health_status()["temperature"] == 21.5

    sensor.read_sample()
    health = sensor.health_status()
    assert health["temperature"] is None
    assert health["temperature_ok"] is False


def test_simulated_health_has_no_hardware_temperature():
    assert SensorService(sensor_mode="simulated").health_status()["temperature"] is None
