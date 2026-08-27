"""Persisted hardware calibration (servo pulse-width endpoints).

Stored as JSON in the instance folder so it survives restarts without touching
the environment file. Missing/invalid files fall back to the env defaults.
"""
import json
from pathlib import Path

CALIBRATION_FILENAME = "calibration.json"
_KEYS = ("servo_min_pulsewidth", "servo_max_pulsewidth")


def _calibration_path(app):
    return Path(app.instance_path) / CALIBRATION_FILENAME


def load_calibration(app):
    """Return saved calibration values as a dict, or {} if none/invalid."""
    try:
        data = json.loads(_calibration_path(app).read_text())
    except (OSError, ValueError):
        return {}

    result = {}
    for key in _KEYS:
        value = data.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            result[key] = int(value)
    return result


def save_calibration(app, servo_min_pulsewidth, servo_max_pulsewidth):
    """Persist the servo pulse-width endpoints to the instance folder."""
    path = _calibration_path(app)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "servo_min_pulsewidth": int(servo_min_pulsewidth),
        "servo_max_pulsewidth": int(servo_max_pulsewidth),
    }))
