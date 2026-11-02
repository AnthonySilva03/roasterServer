from __future__ import annotations

import random
import threading
import time
from datetime import datetime, timezone

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

# A MAX6675 read is considered fresh for this many sensor intervals. While the
# sensor loop is sampling, health_status() reports that read instead of
# touching the bus again.
_FRESH_READ_INTERVALS = 2.0


def _sample_timestamp(now: float | None = None) -> str:
    """Sample time as an ISO 8601 UTC instant with milliseconds, e.g.
    2026-11-02T10:00:00.250Z. Being an absolute instant it needs no anchor
    date and does not depend on the Pi and the browser sharing a timezone
    (older roasts carry local "HH:MM:SS[.mmm]" stamps, still accepted by the
    parsers)."""
    now = time.time() if now is None else now
    moment = datetime.fromtimestamp(now, tz=timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


# Thermocouple offset bounds (°C) accepted from the settings page.
MIN_TEMPERATURE_OFFSET_C = -20.0
MAX_TEMPERATURE_OFFSET_C = 20.0


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
        self._current_flame_level = 50
        # Serializes bit-banged MAX6675 reads. Under eventlet, time.sleep()
        # yields, so without this a health-check read could interleave its
        # clock pulses with the sensor loop's and corrupt both results.
        self._bus_lock = threading.Lock()
        self._last_read_monotonic = None
        self._pi = self._connect_pigpio()
        self._last_temperature_error = None
        self._sim_temperature = 202.0
        # Added to every hardware reading (probe calibration against a
        # reference thermometer). Persisted by calibration.py.
        self.temperature_offset_c = 0.0
        # Simulated-mode replay of a saved roast curve: {"points": [(s, °C)],
        # "roast_id", "label", "started_monotonic", "total_seconds"}.
        self._replay = None

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
        self._replay = None
        self.set_flame_level(50)

    # --- probe offset -----------------------------------------------------------

    def set_temperature_offset(self, offset_c: float) -> dict:
        value = float(offset_c)
        if value != value or value < MIN_TEMPERATURE_OFFSET_C or value > MAX_TEMPERATURE_OFFSET_C:
            raise ValueError(
                f"Temperature offset must be between {MIN_TEMPERATURE_OFFSET_C:g} and {MAX_TEMPERATURE_OFFSET_C:g} °C."
            )
        self.temperature_offset_c = round(value, 2)
        return {"temperature_offset_c": self.temperature_offset_c}

    # --- simulated replay -----------------------------------------------------------

    def set_replay(self, points, roast_id=None, label="") -> dict:
        """Replay a saved curve in simulated mode. ``points`` is a list of
        (elapsed_seconds, temperature) in ascending order; the curve loops."""
        if self._pi:
            raise RuntimeError("Replay is only available in simulated mode.")
        cleaned = sorted(
            (float(seconds), float(temperature))
            for seconds, temperature in points
            if seconds is not None and temperature is not None
        )
        if len(cleaned) < 2:
            raise ValueError("A replay needs at least two curve points.")
        self._replay = {
            "points": cleaned,
            "roast_id": roast_id,
            "label": label,
            "started_monotonic": time.monotonic(),
            "total_seconds": cleaned[-1][0] - cleaned[0][0],
        }
        return self.replay_status()

    def clear_replay(self) -> dict:
        self._replay = None
        return self.replay_status()

    def replay_status(self) -> dict | None:
        if not self._replay:
            return None
        elapsed = (time.monotonic() - self._replay["started_monotonic"])
        total = self._replay["total_seconds"]
        return {
            "roast_id": self._replay["roast_id"],
            "label": self._replay["label"],
            "elapsed_seconds": round(elapsed % total, 1) if total > 0 else 0.0,
            "total_seconds": round(total, 1),
            "loop": int(elapsed // total) + 1 if total > 0 else 1,
        }

    def _replay_temperature(self, now_monotonic: float | None = None) -> float:
        replay = self._replay
        points = replay["points"]
        total = replay["total_seconds"]
        now_monotonic = time.monotonic() if now_monotonic is None else now_monotonic
        elapsed = now_monotonic - replay["started_monotonic"]
        position = points[0][0] + (elapsed % total if total > 0 else 0.0)
        for (t0, temp0), (t1, temp1) in zip(points, points[1:]):
            if t0 <= position <= t1:
                span = t1 - t0
                return temp0 if span <= 0 else temp0 + (temp1 - temp0) * (position - t0) / span
        return points[-1][1]

    def read_sample(self) -> dict:
        """Return the current sample.

        In hardware mode a failed thermocouple read yields ``temperature``
        None plus an ``error`` message. Simulated values are only produced
        when no hardware is attached (``source`` == "simulated"), never as a
        stand-in for a faulting sensor.
        """
        if self._pi:
            temperature = self._read_temperature()
            if temperature is not None:
                temperature += self.temperature_offset_c
        elif self._replay:
            temperature = self._replay_temperature()
        else:
            temperature = self._next_simulated_value(
                "_sim_temperature", 0.9, 188.0, 225.0
            )

        sample = {
            # ISO UTC instant with milliseconds (see _sample_timestamp).
            "timestamp": _sample_timestamp(),
            "temperature": None if temperature is None else round(temperature, 2),
            "source": self.source_name,
            "flame_level": self._current_flame_level,
        }
        if temperature is None:
            sample["error"] = self._last_temperature_error or "Thermocouple read failed"
        return sample

    def set_flame_level(self, flame_level: int | float) -> dict:
        bounded_flame_level = max(0, min(100, int(round(float(flame_level)))))
        self._current_flame_level = bounded_flame_level

        if self._pi:
            pulsewidth = self._flame_level_to_pulsewidth(bounded_flame_level)
            self._pi.set_servo_pulsewidth(self.servo_pin, pulsewidth)

        return {
            "flame_level": self._current_flame_level,
            "source": self.source_name,
        }

    def set_servo_pulsewidth_raw(self, pulsewidth: int | float) -> dict:
        """Drive the servo directly to a pulse width (µs), for calibration."""
        bounded = max(400, min(3000, int(round(float(pulsewidth)))))
        if self._pi:
            self._pi.set_servo_pulsewidth(self.servo_pin, bounded)
        return {"pulsewidth": bounded, "source": self.source_name}

    def set_servo_calibration(self, servo_min_pulsewidth: int, servo_max_pulsewidth: int) -> dict:
        """Update the flame-level pulse-width range and re-apply the current flame."""
        self.servo_min_pulsewidth = int(servo_min_pulsewidth)
        self.servo_max_pulsewidth = int(servo_max_pulsewidth)
        self.set_flame_level(self._current_flame_level)
        return {
            "servo_min_pulsewidth": self.servo_min_pulsewidth,
            "servo_max_pulsewidth": self.servo_max_pulsewidth,
        }

    def health_status(self) -> dict:
        status = {
            "mode": self.sensor_mode,
            "connected": bool(self._pi) if self.sensor_mode == "pigpio" else True,
            "temperature_ok": False,
            "servo_ok": False,
            "source": self.source_name,
            "last_temperature_error": self._last_temperature_error,
            "flame_level": self._current_flame_level,
            "servo_min_pulsewidth": self.servo_min_pulsewidth,
            "servo_max_pulsewidth": self.servo_max_pulsewidth,
            "temperature_offset_c": self.temperature_offset_c,
            "replay": self.replay_status(),
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

        # The sensor loop already reads the chip every interval; report that
        # result rather than contending for the bus. Only read directly when
        # no recent sample exists (loop paused, not yet started, or failing).
        if not self._has_fresh_read():
            try:
                self._read_temperature()
            except Exception as error:  # pigpio daemon/socket errors
                self._last_temperature_error = f"Temperature read failed: {error}"

        status["temperature_ok"] = self._last_temperature_error is None
        status["servo_ok"] = True
        status["last_temperature_error"] = self._last_temperature_error
        return status

    def _has_fresh_read(self) -> bool:
        if self._last_read_monotonic is None:
            return False
        max_age = max(float(self.interval_seconds), 0.1) * _FRESH_READ_INTERVALS
        return (time.monotonic() - self._last_read_monotonic) <= max_age

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
        pi.set_servo_pulsewidth(self.servo_pin, self._flame_level_to_pulsewidth(self._current_flame_level))
        return pi

    def _read_temperature(self):
        if not self._pi:
            return None

        with self._bus_lock:
            self._pi.write(self.cs_pin, 0)
            time.sleep(0.002)

            data = 0
            for _ in range(16):
                self._pi.write(self.clk_pin, 1)
                time.sleep(0.001)
                self._pi.write(self.clk_pin, 0)
                data = (data << 1) | self._pi.read(self.do_pin)

            self._pi.write(self.cs_pin, 1)

        self._last_read_monotonic = time.monotonic()

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

    def _flame_level_to_pulsewidth(self, flame_level: int) -> int:
        span = self.servo_max_pulsewidth - self.servo_min_pulsewidth
        return int(self.servo_min_pulsewidth + (span * (flame_level / 100)))
