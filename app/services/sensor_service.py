from __future__ import annotations

import random
import time

try:
    import pigpio
except ImportError:  # pragma: no cover - depends on Raspberry Pi environment
    pigpio = None


DEFAULT_CS_PIN = 8
DEFAULT_CLK_PIN = 11
DEFAULT_DO_PIN = 9
DEFAULT_SERVO_PIN = 18
DEFAULT_SERVO_MIN_PULSEWIDTH = 1000
DEFAULT_SERVO_MAX_PULSEWIDTH = 2000


class SensorService:
    def __init__(
        self,
        interval_seconds: float = 2.0,
        sensor_mode: str = "simulated",
        max6675_cs_pin: int = DEFAULT_CS_PIN,
        max6675_clk_pin: int = DEFAULT_CLK_PIN,
        max6675_do_pin: int = DEFAULT_DO_PIN,
        servo_control_pin: int = DEFAULT_SERVO_PIN,
        servo_min_pulsewidth: int = DEFAULT_SERVO_MIN_PULSEWIDTH,
        servo_max_pulsewidth: int = DEFAULT_SERVO_MAX_PULSEWIDTH,
    ):
        self.interval_seconds = interval_seconds
        self.sensor_mode = sensor_mode.lower()
        self.active = True
        self.cs_pin = max6675_cs_pin
        self.clk_pin = max6675_clk_pin
        self.do_pin = max6675_do_pin
        self.servo_pin = servo_control_pin
        self.servo_min_pulsewidth = servo_min_pulsewidth
        self.servo_max_pulsewidth = servo_max_pulsewidth
        self._current_speed = 50
        self._pi = self._connect_pigpio()
        self._last_temperature_error = None
        self._sim_temperature = 202.0

    @property
    def source_name(self) -> str:
        if self._pi:
            return "pigpio-max6675"
        return "simulated"

    def start(self) -> None:
        self.active = True

    def stop(self) -> None:
        self.active = False

    def reset(self) -> None:
        self._sim_temperature = 202.0
        self.set_speed(50)

    def read_sample(self) -> dict:
        temperature = self._read_temperature()
        if temperature is None:
            temperature = self._next_simulated_value(
                "_sim_temperature", 0.9, 188.0, 225.0
            )
        else:
            self._sim_temperature = temperature

        return {
            "timestamp": time.strftime("%H:%M:%S"),
            "temperature": round(temperature, 2),
            "source": self.source_name,
            "speed": self._current_speed,
        }

    def set_speed(self, speed: int | float) -> dict:
        bounded_speed = max(0, min(100, int(round(float(speed)))))
        self._current_speed = bounded_speed

        if self._pi:
            pulsewidth = self._speed_to_pulsewidth(bounded_speed)
            self._pi.set_servo_pulsewidth(self.servo_pin, pulsewidth)

        return {
            "speed": self._current_speed,
            "source": self.source_name,
        }

    def health_status(self) -> dict:
        status = {
            "mode": self.sensor_mode,
            "connected": bool(self._pi) if self.sensor_mode == "pigpio" else True,
            "temperature_ok": False,
            "servo_ok": False,
            "source": self.source_name,
            "last_temperature_error": self._last_temperature_error,
            "speed": self._current_speed,
        }

        if self.sensor_mode != "pigpio":
            status["temperature_ok"] = True
            status["servo_ok"] = True
            return status

        if not self._pi:
            status["last_temperature_error"] = (
                self._last_temperature_error or "pigpio daemon unavailable"
            )
            return status

        temperature = self._read_temperature()
        status["temperature_ok"] = temperature is not None
        status["servo_ok"] = True
        status["last_temperature_error"] = self._last_temperature_error
        return status

    def _connect_pigpio(self):
        if self.sensor_mode != "pigpio":
            return None

        if pigpio is None:
            return None

        pi = pigpio.pi()
        if not pi.connected:
            return None

        pi.set_mode(self.cs_pin, pigpio.OUTPUT)
        pi.set_mode(self.clk_pin, pigpio.OUTPUT)
        pi.set_mode(self.do_pin, pigpio.INPUT)
        pi.set_mode(self.servo_pin, pigpio.OUTPUT)
        pi.write(self.cs_pin, 1)
        pi.write(self.clk_pin, 0)
        pi.set_servo_pulsewidth(self.servo_pin, self._speed_to_pulsewidth(self._current_speed))
        return pi

    def _read_temperature(self):
        if not self._pi:
            return None

        self._pi.write(self.cs_pin, 0)
        time.sleep(0.002)

        data = 0
        for _ in range(16):
            self._pi.write(self.clk_pin, 1)
            time.sleep(0.001)
            self._pi.write(self.clk_pin, 0)
            data = (data << 1) | self._pi.read(self.do_pin)

        self._pi.write(self.cs_pin, 1)

        if data & 0x4:
            self._last_temperature_error = "Thermocouple open circuit"
            return None

        self._last_temperature_error = None
        return (data >> 3) * 0.25

    def _next_simulated_value(
        self, attr_name: str, drift: float, lower: float, upper: float
    ) -> float:
        current = getattr(self, attr_name)
        updated = current + random.uniform(-drift, drift)
        bounded = max(lower, min(upper, updated))
        setattr(self, attr_name, bounded)
        return bounded

    def _speed_to_pulsewidth(self, speed: int) -> int:
        span = self.servo_max_pulsewidth - self.servo_min_pulsewidth
        return int(self.servo_min_pulsewidth + (span * (speed / 100)))
