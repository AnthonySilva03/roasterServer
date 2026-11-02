"""Server-side roast math shared by the CSV/Artisan exports and the ranking
report. Mirrors the client helpers in app/static/js/live_charts.js: event
roles (with legacy Start/Finish labels), elapsed-time parsing of the
"HH:MM:SS[.mmm]" sample timestamps, phases/DTR and area under curve.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

# Role -> accepted labels. Older roasts used "Start"/"Finish" for charge/drop.
EVENT_ROLES = {
    "preRoast": ("Pre Roast",),
    "charge": ("Charge", "Start"),
    "dryEnd": ("Dry End",),
    "firstCrack": ("First Crack",),
    "firstCrackEnd": ("First Crack End",),
    "secondCrack": ("Second Crack",),
    "drop": ("Drop", "Finish"),
}

_CLOCK_RE = re.compile(r"^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$")


def parse_timestamp(value, anchor: datetime | None = None) -> datetime | None:
    """Parse an ISO timestamp or a wall-clock "HH:MM:SS[.mmm]" sample time.

    Clock-only values take their date from ``anchor`` (the roast start).
    Returns a naive UTC datetime, or None when unparseable.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    text = str(value).strip()
    if not text:
        return None

    match = _CLOCK_RE.match(text)
    if match:
        # Sample stamps are the server's LOCAL wall clock (time.strftime in the
        # sensor loop); events are UTC instants. Mirror the browser, which
        # applies the clock to the anchor's local date, then convert to UTC.
        anchor_utc = (anchor or datetime.utcnow()).replace(tzinfo=timezone.utc)
        local_anchor = anchor_utc.astimezone()
        hours, minutes, seconds = (int(match.group(i)) for i in (1, 2, 3))
        millis = int(match.group(4).ljust(3, "0")) if match.group(4) else 0
        try:
            local = local_anchor.replace(hour=hours, minute=minutes, second=seconds, microsecond=millis * 1000)
        except ValueError:
            return None
        return local.astimezone(timezone.utc).replace(tzinfo=None)

    iso = text[:-1] if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(iso)
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = (parsed - parsed.utcoffset()).replace(tzinfo=None)
    return parsed


def find_event(events, role):
    labels = EVENT_ROLES.get(role, (role,))
    for event in events or []:
        if isinstance(event, dict) and event.get("label") in labels:
            return event
    return None


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and number not in (float("inf"), float("-inf")) else None


def normalize_curve(curve, started_at):
    """Return [(time, temperature, flame)] for every parseable sample."""
    anchor = parse_timestamp(started_at)
    points = []
    for point in curve or []:
        if not isinstance(point, dict):
            continue
        time = parse_timestamp(point.get("timestamp"), anchor)
        temperature = _number(point.get("temperature"))
        if time is None or temperature is None:
            continue
        flame = point.get("flame_level")
        flame = int(flame) if isinstance(flame, (int, float)) and not isinstance(flame, bool) else None
        points.append((time, temperature, flame))
    return points


def temperature_at(points, when, tolerance_seconds=15):
    """Nearest sample temperature to ``when`` within the tolerance, else None."""
    if when is None or not points:
        return None
    best = min(points, key=lambda point: abs((point[0] - when).total_seconds()))
    if abs((best[0] - when).total_seconds()) > tolerance_seconds:
        return None
    return best[1]


def turning_point(points, charge_time, rise_threshold=2.0):
    """Post-charge minimum confirmed by a subsequent rise: (time, temperature)."""
    after = [p for p in points if charge_time is None or p[0] >= charge_time]
    if len(after) < 3:
        return None
    min_index = min(range(len(after)), key=lambda i: after[i][1])
    if min_index >= len(after) - 1:
        return None
    peak_after = max(p[1] for p in after[min_index + 1:])
    if peak_after - after[min_index][1] < rise_threshold:
        return None
    return after[min_index][0], after[min_index][1]


def roast_times(roast):
    """Resolve charge / dry end / first crack / drop datetimes for a roast dict."""
    events = roast.get("events") or []
    points = normalize_curve(roast.get("curve"), roast.get("started_at"))
    anchor = parse_timestamp(roast.get("started_at"))
    charge = parse_timestamp(roast.get("started_at")) or parse_timestamp(
        (find_event(events, "charge") or {}).get("time"), anchor
    ) or (points[0][0] if points else None)
    drop = parse_timestamp(roast.get("ended_at")) or parse_timestamp(
        (find_event(events, "drop") or {}).get("time"), anchor
    ) or (points[-1][0] if points else None)
    dry_end = parse_timestamp((find_event(events, "dryEnd") or {}).get("time"), anchor)
    first_crack = parse_timestamp((find_event(events, "firstCrack") or {}).get("time"), anchor)
    return {
        "points": points,
        "charge": charge,
        "dryEnd": dry_end,
        "firstCrack": first_crack,
        "drop": drop,
    }


def phase_summary(roast):
    """Drying / Maillard / development seconds and percentages plus DTR."""
    times = roast_times(roast)
    charge, drop = times["charge"], times["drop"]
    if charge is None or drop is None or drop < charge:
        return {"total_seconds": None, "phases": [], "dtr": None}

    total = (drop - charge).total_seconds()
    dry_end, first_crack = times["dryEnd"], times["firstCrack"]
    boundaries = []
    if dry_end and dry_end > charge and (not first_crack or dry_end <= first_crack):
        boundaries.append(("drying", "Drying", charge, dry_end))
        boundaries.append(("maillard", "Maillard", dry_end, first_crack if first_crack and first_crack > dry_end else drop))
    elif first_crack and first_crack > charge:
        boundaries.append(("drying", "Drying + Maillard", charge, first_crack))
    else:
        boundaries.append(("drying", "Drying", charge, drop))
    if first_crack and first_crack > charge:
        boundaries.append(("development", "Development", first_crack, drop))

    phases = []
    for key, label, start, end in boundaries:
        if end < start:
            continue
        seconds = (end - start).total_seconds()
        start_temp = temperature_at(times["points"], start)
        end_temp = temperature_at(times["points"], end)
        phases.append(
            {
                "key": key,
                "label": label,
                "seconds": seconds,
                "percent": (seconds / total * 100) if total > 0 else None,
                "temp_start": start_temp,
                "temp_end": end_temp,
                "delta_temp": (end_temp - start_temp) if start_temp is not None and end_temp is not None else None,
            }
        )

    development = next((phase for phase in phases if phase["key"] == "development"), None)
    return {
        "total_seconds": total,
        "phases": phases,
        "dtr": development["percent"] if development else None,
    }


def area_under_curve(roast, base_temp_c=150.0):
    """Area (°C·min) of the bean curve above ``base_temp_c`` from Dry End (or the
    turning point, or charge) to drop, trapezoidal. Artisan's AUC uses the same
    definition with a configurable base and start event."""
    times = roast_times(roast)
    points = times["points"]
    charge, drop = times["charge"], times["drop"]
    if not points or charge is None or drop is None:
        return None
    start = times["dryEnd"]
    if start is None:
        turn = turning_point(points, charge)
        start = turn[0] if turn else charge

    window = [p for p in points if start <= p[0] <= drop]
    if len(window) < 2:
        return None
    area = 0.0
    for (t0, temp0, _), (t1, temp1, _) in zip(window, window[1:]):
        minutes = (t1 - t0).total_seconds() / 60
        if minutes <= 0:
            continue
        area += (max(0.0, temp0 - base_temp_c) + max(0.0, temp1 - base_temp_c)) / 2 * minutes
    return round(area, 1)


def key_temperatures(roast):
    """Charge, turning point, dry end, first crack, drop temperatures (°C)."""
    times = roast_times(roast)
    points = times["points"]
    turn = turning_point(points, times["charge"]) if points else None
    events = roast.get("events") or []

    def event_temp(role, fallback_time):
        event = find_event(events, role)
        value = _number((event or {}).get("temperature"))
        if value is not None:
            return value
        return temperature_at(points, fallback_time)

    peak = max((p[1] for p in points), default=None)
    return {
        "charge": event_temp("charge", times["charge"]),
        "turning_point": turn[1] if turn else None,
        "turning_point_seconds": (turn[0] - times["charge"]).total_seconds() if turn and times["charge"] else None,
        "dry_end": event_temp("dryEnd", times["dryEnd"]) if times["dryEnd"] else None,
        "first_crack": event_temp("firstCrack", times["firstCrack"]) if times["firstCrack"] else None,
        "drop": event_temp("drop", times["drop"]),
        "peak": peak,
    }


def elapsed_seconds(when, start):
    if when is None or start is None:
        return None
    return (when - start).total_seconds()


def weight_loss_percent(weight_in, weight_out):
    weight_in = _number(weight_in)
    weight_out = _number(weight_out)
    if not weight_in or weight_out is None or weight_in <= 0:
        return None
    return round((weight_in - weight_out) / weight_in * 100, 2)


def roast_report_row(roast, auc_base_c=150.0):
    """Flattened per-roast statistics for the ranking report."""
    times = roast_times(roast)
    phases = phase_summary(roast)
    temps = key_temperatures(roast)
    by_key = {phase["key"]: phase for phase in phases["phases"]}
    return {
        "id": roast.get("id"),
        "bean_name": roast.get("bean_name"),
        "origin": roast.get("origin"),
        "roast_level": roast.get("roast_level"),
        "batch_label": roast.get("batch_label") or "",
        "roast_color": roast.get("roast_color") or "",
        "created_at": roast.get("created_at"),
        "started_at": roast.get("started_at"),
        "rating": roast.get("rating"),
        "weight_grams": roast.get("weight_grams"),
        "roasted_weight_grams": roast.get("roasted_weight_grams"),
        "weight_loss_percent": weight_loss_percent(roast.get("weight_grams"), roast.get("roasted_weight_grams")),
        "total_seconds": phases["total_seconds"],
        "dry_end_seconds": elapsed_seconds(times["dryEnd"], times["charge"]),
        "first_crack_seconds": elapsed_seconds(times["firstCrack"], times["charge"]),
        "development_seconds": by_key.get("development", {}).get("seconds"),
        "dtr": phases["dtr"],
        "drying_percent": by_key.get("drying", {}).get("percent") if "maillard" in by_key else None,
        "maillard_percent": by_key.get("maillard", {}).get("percent"),
        "charge_temp": temps["charge"],
        "turning_point_temp": temps["turning_point"],
        "turning_point_seconds": temps["turning_point_seconds"],
        "dry_end_temp": temps["dry_end"],
        "first_crack_temp": temps["first_crack"],
        "drop_temp": temps["drop"],
        "peak_temp": temps["peak"],
        "auc": area_under_curve(roast, auc_base_c),
        "sample_count": roast.get("sample_count"),
    }


def timedelta_seconds(delta: timedelta | None):
    return None if delta is None else delta.total_seconds()
