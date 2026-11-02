"""Roast properties, CSV / Artisan exports, the ranking report and the v3
schema migration."""

import ast
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app import create_app
from app.services.roast_storage import ROAST_PROPERTY_FIELDS

START = datetime(2026, 4, 15, 12, 0, 0)


def _iso(seconds):
    return (START + timedelta(seconds=seconds)).isoformat() + "Z"


def _clock(seconds):
    """Local wall-clock stamp for the UTC instant START + seconds (as the sensor loop emits)."""
    return (START + timedelta(seconds=seconds)).replace(tzinfo=timezone.utc).astimezone().strftime("%H:%M:%S")


def _ramp_roast(**overrides):
    """10-minute roast: 180 °C charge, 60 s drop to 110 °C, then +10 °C/min."""
    curve = []
    for s in range(0, 601, 2):
        temperature = 180 - s * (70 / 60) if s < 60 else 110 + (s - 60) * (10 / 60)
        curve.append({
            "timestamp": _clock(s),
            "temperature": round(temperature, 2),
            "flame_level": 80 if s < 300 else 40,
        })
    events = [
        {"label": "Charge", "detail": "", "time": _iso(0), "temperature": 180.0, "flame_level": 80},
        {"label": "Dry End", "detail": "", "time": _iso(240), "temperature": 140.0, "flame_level": 80},
        {"label": "Flame Change", "detail": "80->40", "time": _iso(300), "temperature": 150.0, "flame_level": 40},
        {"label": "First Crack", "detail": "", "time": _iso(480), "temperature": 180.0, "flame_level": 40},
        {"label": "Drop", "detail": "", "time": _iso(600), "temperature": 200.0, "flame_level": 40},
    ]
    payload = {
        "bean_name": "Feature Roast",
        "origin": "Kenya",
        "roast_level": "Medium",
        "weight_grams": 300,
        "flame_level": 40,
        "total_roast_seconds": 600,
        "started_at": _iso(0),
        "ended_at": _iso(600),
        "notes": "",
        "curve": curve,
        "events": events,
    }
    payload.update(overrides)
    return payload


def _create(client, **overrides):
    response = client.post("/api/roasts", json=_ramp_roast(**overrides))
    assert response.status_code == 201, response.get_json()
    return response.get_json()


# --- properties ----------------------------------------------------------------

def test_roast_properties_round_trip_and_weight_loss(client):
    roast = _create(
        client,
        roasted_weight_grams="255.5",
        roast_color="Agtron 65",
        batch_label="B-12",
        green_moisture_percent=10.4,
        ambient_temp_c=21,
    )
    assert roast["roasted_weight_grams"] == 255.5
    assert roast["roast_color"] == "Agtron 65"
    assert roast["batch_label"] == "B-12"
    assert roast["green_moisture_percent"] == 10.4
    assert roast["ambient_temp_c"] == 21.0
    assert roast["weight_loss_percent"] == 14.83

    listed = client.get("/api/roasts").get_json()["items"][0]
    assert listed["weight_loss_percent"] == 14.83
    assert listed["batch_label"] == "B-12"


def test_roast_properties_default_when_absent(client):
    roast = _create(client)
    for field in ROAST_PROPERTY_FIELDS:
        assert roast[field] in (None, "")
    assert roast["weight_loss_percent"] is None


def test_roast_properties_validation(client):
    bad_cases = {
        "moisture out of range": {"green_moisture_percent": 140},
        "roasted weight not numeric": {"roasted_weight_grams": "heavy"},
        "ambient too hot": {"ambient_temp_c": 300},
        "color not text": {"roast_color": 65},
        "batch label too long": {"batch_label": "x" * 81},
    }
    for name, overrides in bad_cases.items():
        response = client.post("/api/roasts", json=_ramp_roast(**overrides))
        assert response.status_code == 400, name
        assert "error" in response.get_json()


def test_patch_updates_only_the_properties_sent(client):
    roast = _create(client, roasted_weight_grams=250, batch_label="keep-me")

    response = client.patch(
        f"/api/roasts/{roast['id']}",
        json={
            "bean_name": roast["bean_name"],
            "origin": roast["origin"],
            "roast_level": roast["roast_level"],
            "weight_grams": roast["weight_grams"],
            "roasted_weight_grams": 240,
            "roast_color": "city+",
        },
    )
    assert response.status_code == 200
    updated = response.get_json()
    assert updated["roasted_weight_grams"] == 240.0
    assert updated["roast_color"] == "city+"
    assert updated["batch_label"] == "keep-me"
    assert updated["weight_loss_percent"] == 20.0

    rejected = client.patch(
        f"/api/roasts/{roast['id']}",
        json={"bean_name": "x", "origin": "y", "roast_level": "z", "green_moisture_percent": -1},
    )
    assert rejected.status_code == 400


def test_export_import_round_trip_keeps_properties(client):
    roast = _create(client, roasted_weight_grams=250, roast_color="Agtron 70", batch_label="B-1")
    exported = client.get(f"/api/roasts/{roast['id']}/export").get_json()
    assert exported["roast"]["roasted_weight_grams"] == 250.0

    imported = client.post("/api/roasts/import", json=exported)
    assert imported.status_code == 201
    item = imported.get_json()["items"][0]
    assert item["roast_color"] == "Agtron 70"
    assert item["batch_label"] == "B-1"
    assert item["weight_loss_percent"] == 16.67


# --- exports ------------------------------------------------------------------------

def test_csv_export_has_elapsed_time_flame_and_events(client):
    roast = _create(client)
    response = client.get(f"/api/roasts/{roast['id']}/export.csv")
    assert response.status_code == 200
    assert response.mimetype == "text/csv"
    assert response.headers["Content-Disposition"].endswith('.csv"')

    lines = response.get_data(as_text=True).strip().splitlines()
    assert lines[0] == "elapsed_seconds,timestamp,bean_temp_c,flame_percent,event"
    assert lines[1] == f"0.0,{_clock(0)},180.00,80,Charge"
    first_crack = [line for line in lines if line.endswith("First Crack")]
    assert first_crack and first_crack[0].startswith("480.0,")
    assert lines[-1].endswith(",40,Drop")
    assert len(lines) == 1 + len(roast["curve"])


def test_csv_export_missing_roast_returns_404(client):
    assert client.get("/api/roasts/99999/export.csv").status_code == 404
    assert client.get("/api/roasts/99999/export.alog").status_code == 404


def test_artisan_export_is_a_loadable_profile(client):
    roast = _create(client, roasted_weight_grams=250)
    response = client.get(f"/api/roasts/{roast['id']}/export.alog")
    assert response.status_code == 200
    assert response.headers["Content-Disposition"].endswith('.alog"')

    profile = ast.literal_eval(response.get_data(as_text=True))
    assert profile["mode"] == "C"
    assert len(profile["timex"]) == len(profile["temp2"]) == len(profile["temp1"]) == len(roast["curve"])
    assert profile["timex"][0] == 0.0
    assert profile["timex"][-1] == 600.0
    assert set(profile["temp1"]) == {-1.0}  # no environment probe
    assert profile["temp2"][0] == 180.0

    # CHARGE, DRYe, FCs, FCe, SCs, SCe, DROP, COOL -> sample indices
    assert profile["timeindex"] == [0, 120, 240, 0, 0, 0, 300, 0]
    assert profile["weight"] == [300.0, 250.0, "g"]
    assert profile["roastdate"] == "2026-04-15"

    # Flame moves become Burner events: 80% at charge and 40% at 5:00.
    assert profile["specialevents"] == [0, 150]
    assert profile["specialeventstype"] == [3, 3]
    assert profile["specialeventsvalue"] == [9.0, 5.0]
    assert profile["specialeventsStrings"] == ["80%", "40%"]


# --- report ---------------------------------------------------------------------------

def test_roast_report_lists_statistics_per_roast(client):
    roast = _create(client, roasted_weight_grams=255, rating=4)
    response = client.get("/api/roasts/report")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["auc_base_c"] == 150.0
    row = next(item for item in payload["items"] if item["id"] == roast["id"])

    assert row["total_seconds"] == 600
    assert row["dry_end_seconds"] == 240
    assert row["first_crack_seconds"] == 480
    assert row["development_seconds"] == 120
    assert round(row["dtr"]) == 20
    assert round(row["drying_percent"]) == 40
    assert round(row["maillard_percent"]) == 40
    assert row["charge_temp"] == 180.0
    assert row["first_crack_temp"] == 180.0
    assert row["drop_temp"] == 200.0
    assert row["turning_point_temp"] == 110.0
    assert row["turning_point_seconds"] == 60
    assert row["weight_loss_percent"] == 15.0
    assert row["rating"] == 4
    # Curve from Dry End (140 °C) to drop (200 °C) above 150 °C: triangle
    # 150->200 over 5 min = 125 °C·min.
    assert abs(row["auc"] - 125) < 2

    custom = client.get("/api/roasts/report?auc_base=100").get_json()
    custom_row = next(item for item in custom["items"] if item["id"] == roast["id"])
    assert custom_row["auc"] > row["auc"]


def test_roast_report_rejects_bad_base(client):
    assert client.get("/api/roasts/report?auc_base=hot").status_code == 400


def test_reports_page_renders(client):
    response = client.get("/reports")
    assert response.status_code == 200
    assert b"reportTable" in response.data


# --- migration -------------------------------------------------------------------------

def test_schema_v3_migration_adds_property_columns(tmp_path: Path):
    db_path = tmp_path / "legacy.db"
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        connection.execute("INSERT INTO schema_version VALUES (1, 'x'), (2, 'y')")
        connection.execute(
            """
            CREATE TABLE roast_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bean_name TEXT NOT NULL, origin TEXT NOT NULL, roast_level TEXT NOT NULL,
                weight_grams REAL, flame_level INTEGER, total_roast_seconds INTEGER,
                notes TEXT NOT NULL, taste_notes TEXT NOT NULL DEFAULT '', rating INTEGER,
                sample_count INTEGER NOT NULL, started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
                created_at TEXT NOT NULL, curve_json TEXT NOT NULL,
                events_json TEXT NOT NULL DEFAULT '[]', photo_data TEXT NOT NULL DEFAULT '',
                photo_filename TEXT NOT NULL DEFAULT ''
            )
            """
        )
        connection.execute(
            """
            INSERT INTO roast_sessions (bean_name, origin, roast_level, notes, sample_count,
                started_at, ended_at, created_at, curve_json)
            VALUES ('Old', 'Brazil', 'Medium', '', 0, 'a', 'b', 'c', '[]')
            """
        )
        connection.commit()

    app = create_app(
        {
            "TESTING": True,
            "START_SENSOR_BACKGROUND_TASK": False,
            "SENSOR_MODE": "simulated",
            "SQLALCHEMY_DATABASE_URI": "sqlite:///legacy.db",
            "INSTANCE_PATH": str(tmp_path),
        }
    )
    app.instance_path = str(tmp_path)

    with sqlite3.connect(db_path) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(roast_sessions)")}
        version = connection.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
    assert set(ROAST_PROPERTY_FIELDS) <= columns
    assert version == 3

    # Legacy rows read back with empty properties and still list/report cleanly.
    client = app.test_client()
    old = client.get("/api/roasts/1").get_json()
    assert old["bean_name"] == "Old"
    assert old["roast_color"] == ""
    assert old["roasted_weight_grams"] is None
    assert client.get("/api/roasts/report").status_code == 200
