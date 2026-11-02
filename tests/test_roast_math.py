from datetime import datetime, timedelta, timezone

from app.services import roast_math

START = datetime(2026, 4, 15, 12, 0, 0)


def _iso(seconds):
    return (START + timedelta(seconds=seconds)).isoformat() + "Z"


def _clock(seconds, millis=None):
    """Local wall-clock stamp for the UTC instant START + seconds (as the sensor loop emits)."""
    local = (START + timedelta(seconds=seconds)).replace(tzinfo=timezone.utc).astimezone()
    stamp = local.strftime("%H:%M:%S")
    return f"{stamp}.{millis:03d}" if millis is not None else stamp


def _roast(events=None, rate_per_minute=10.0, seconds=600):
    curve = [
        {"timestamp": _clock(s), "temperature": 100 + rate_per_minute * s / 60, "flame_level": 50}
        for s in range(0, seconds + 1, 2)
    ]
    return {
        "started_at": _iso(0),
        "ended_at": _iso(seconds),
        "curve": curve,
        "events": events if events is not None else [],
    }


def test_parse_timestamp_handles_clock_iso_and_millis():
    anchor = START
    whole = roast_math.parse_timestamp(_clock(5), anchor)
    millis = roast_math.parse_timestamp(_clock(5, 250), anchor)
    assert whole == START + timedelta(seconds=5)  # local clock -> UTC instant
    assert (millis - whole).total_seconds() == 0.25
    assert roast_math.parse_timestamp("2026-04-15T12:00:05Z") == datetime(2026, 4, 15, 12, 0, 5)
    assert roast_math.parse_timestamp("2026-04-15T14:00:05+02:00") == datetime(2026, 4, 15, 12, 0, 5)
    assert roast_math.parse_timestamp("nope") is None
    assert roast_math.parse_timestamp("") is None


def test_find_event_accepts_legacy_labels():
    events = [{"label": "Start", "time": _iso(0)}, {"label": "Finish", "time": _iso(600)}]
    assert roast_math.find_event(events, "charge")["label"] == "Start"
    assert roast_math.find_event(events, "drop")["label"] == "Finish"
    assert roast_math.find_event(events, "dryEnd") is None


def test_phase_summary_splits_three_phases():
    roast = _roast([
        {"label": "Charge", "time": _iso(0)},
        {"label": "Dry End", "time": _iso(240)},
        {"label": "First Crack", "time": _iso(480)},
        {"label": "Drop", "time": _iso(600)},
    ])
    summary = roast_math.phase_summary(roast)
    assert summary["total_seconds"] == 600
    assert [phase["key"] for phase in summary["phases"]] == ["drying", "maillard", "development"]
    assert [round(phase["percent"]) for phase in summary["phases"]] == [40, 40, 20]
    assert round(summary["dtr"]) == 20
    drying = summary["phases"][0]
    assert abs(drying["delta_temp"] - 40) < 0.5


def test_phase_summary_merges_without_dry_end():
    roast = _roast([{"label": "First Crack", "time": _iso(450)}])
    summary = roast_math.phase_summary(roast)
    assert [phase["label"] for phase in summary["phases"]] == ["Drying + Maillard", "Development"]
    assert round(summary["dtr"]) == 25


def test_area_under_curve_is_trapezoidal_above_base():
    # Linear 100 -> 200 °C over 10 min. Above 150 °C: triangle from 5:00 to
    # 10:00 with height 50 -> 125 °C·min (no Dry End, no turning point -> charge).
    roast = _roast([])
    assert abs(roast_math.area_under_curve(roast, base_temp_c=150) - 125) < 1
    assert roast_math.area_under_curve(roast, base_temp_c=250) == 0
    # From Dry End at 8:00 the remaining triangle is 8:00-10:00 above 180 °C: 20 °C·min.
    dry_roast = _roast([{"label": "Dry End", "time": _iso(480)}])
    assert abs(roast_math.area_under_curve(dry_roast, base_temp_c=180) - 20) < 1
    assert roast_math.area_under_curve({"curve": [], "events": []}) is None


def test_turning_point_and_key_temperatures():
    curve = [{"timestamp": _clock(s), "temperature": 180 - s if s < 50 else 130 + (s - 50)} for s in range(0, 301, 2)]
    roast = {"started_at": _iso(0), "ended_at": _iso(300), "curve": curve, "events": [
        {"label": "Charge", "time": _iso(0), "temperature": 181.5},
        {"label": "First Crack", "time": _iso(200)},
    ]}
    temps = roast_math.key_temperatures(roast)
    assert temps["charge"] == 181.5  # recorded event temperature wins
    assert temps["turning_point"] == 130
    assert temps["turning_point_seconds"] == 50
    assert temps["first_crack"] == 280  # nearest sample at 200 s
    assert temps["drop"] == 380
    assert temps["dry_end"] is None


def test_weight_loss_percent():
    assert roast_math.weight_loss_percent(300, 255) == 15.0
    assert roast_math.weight_loss_percent(0, 255) is None
    assert roast_math.weight_loss_percent(300, None) is None
    assert roast_math.weight_loss_percent("300", "240") == 20.0
