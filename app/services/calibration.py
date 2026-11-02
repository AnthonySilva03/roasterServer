"""Persisted hardware calibration (servo pulse-width endpoints and the
thermocouple offset).

Stored as JSON in the instance folder so it survives restarts without touching
the environment file. Missing/invalid files fall back to the env defaults.
"""
import json
from pathlib import Path

CALIBRATION_FILENAME = "calibration.json"
_INT_KEYS = ("servo_min_pulsewidth", "servo_max_pulsewidth")
_FLOAT_KEYS = ("temperature_offset_c",)


def _calibration_path(app):
    return Path(app.instance_path) / CALIBRATION_FILENAME


def load_calibration(app):
    """Return saved calibration values as a dict, or {} if none/invalid."""
    try:
        data = json.loads(_calibration_path(app).read_text())
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}

    result = {}
    for key in _INT_KEYS:
        value = data.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            result[key] = int(value)
    for key in _FLOAT_KEYS:
        value = data.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            result[key] = float(value)
    return result


def save_calibration(app, servo_min_pulsewidth=None, servo_max_pulsewidth=None, **values):
    """Persist calibration values, merging with whatever is already saved so
    saving the servo range never drops the probe offset and vice versa."""
    current = load_calibration(app)
    if servo_min_pulsewidth is not None:
        current["servo_min_pulsewidth"] = int(servo_min_pulsewidth)
    if servo_max_pulsewidth is not None:
        current["servo_max_pulsewidth"] = int(servo_max_pulsewidth)
    for key, value in values.items():
        if key in _FLOAT_KEYS and value is not None:
            current[key] = float(value)

    path = _calibration_path(app)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(current))
    return current
