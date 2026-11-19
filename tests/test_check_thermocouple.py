"""Tests for the on-Pi hardware sanity check (scripts/check_thermocouple.py)."""

import importlib.util
import json
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "check_thermocouple.py"
_spec = importlib.util.spec_from_file_location("check_thermocouple", _SCRIPT)
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)


def health(temperature, error=None, mode="pigpio", source="pigpio-max6675"):
    return {"mode": mode, "source": source, "temperature": temperature, "last_temperature_error": error}


def test_room_temperature_passes():
    assert check.evaluate([health(21.25), health(21.5), health(21.5)]) == []


def test_doubled_room_temperature_fails_with_bit_shift_hint():
    problems = check.evaluate([health(44.0), health(44.5)])
    assert len(problems) == 1
    assert "outside the room range" in problems[0]
    assert "shifted" in problems[0]


def test_expected_temperature_tolerance():
    assert check.evaluate([health(21.5)], expect_c=21) == []
    problems = check.evaluate([health(27.0)], expect_c=21)
    assert any("from the expected 21" in p for p in problems)


def test_unstable_readings_fail():
    problems = check.evaluate([health(20.0), health(24.5), health(21.0)])
    assert any("wandered" in p for p in problems)


def test_simulated_mode_fails_fast():
    problems = check.evaluate([health(None, mode="simulated", source="simulated")])
    assert len(problems) == 1
    assert "Not reading real hardware" in problems[0]


def test_sensor_errors_are_reported():
    problems = check.evaluate([health(None, error="Thermocouple open circuit")])
    assert "Sensor reported an error: Thermocouple open circuit" in problems
    assert "No temperature values came back from the sensor." in problems


def test_no_readings():
    assert check.evaluate([]) == ["No readings were collected."]


def test_main_exit_codes(monkeypatch, capsys):
    responses = iter([health(21.5), health(21.75)])
    monkeypatch.setattr(check, "fetch_health", lambda url: next(responses))
    monkeypatch.setattr(check.time, "sleep", lambda *_: None)
    assert check.main(["--samples", "2"]) == 0
    assert "PASS" in capsys.readouterr().out

    monkeypatch.setattr(check, "fetch_health", lambda url: health(44.0))
    assert check.main(["--samples", "2"]) == 1
    assert "FAIL" in capsys.readouterr().out


def test_main_unreachable_app_exits_2(monkeypatch, capsys):
    def boom(url):
        raise OSError("connection refused")

    monkeypatch.setattr(check, "fetch_health", boom)
    assert check.main(["--samples", "1"]) == 2
    assert "could not reach" in capsys.readouterr().out


@pytest.mark.parametrize("payload", [health(21.5)])
def test_health_endpoint_json_shape_round_trips(payload):
    assert check.evaluate([json.loads(json.dumps(payload))]) == []
