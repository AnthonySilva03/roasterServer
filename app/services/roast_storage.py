import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from flask import current_app

# Bump this when adding new columns or tables.
_SCHEMA_VERSION = 2


def init_db(app):
    db_path = _database_path(app)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(db_path) as connection:
        _ensure_schema_version_table(connection)
        current_version = _get_schema_version(connection)
        _apply_migrations(connection, current_version)
        connection.commit()


# ---------------------------------------------------------------------------
# Schema management
# ---------------------------------------------------------------------------

def _ensure_schema_version_table(connection):
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
        """
    )


def _get_schema_version(connection):
    row = connection.execute("SELECT MAX(version) FROM schema_version").fetchone()
    return row[0] or 0


def _record_version(connection, version):
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    connection.execute(
        "INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)",
        (version, now),
    )


def _apply_migrations(connection, from_version):
    if from_version < 1:
        _migrate_v1(connection)
        _record_version(connection, 1)

    if from_version < 2:
        _migrate_v2(connection)
        _record_version(connection, 2)


def _migrate_v1(connection):
    """Create roast_sessions table and backfill columns added before versioning."""
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS roast_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bean_name TEXT NOT NULL,
            origin TEXT NOT NULL,
            roast_level TEXT NOT NULL,
            weight_grams REAL,
            flame_level INTEGER,
            total_roast_seconds INTEGER,
            notes TEXT NOT NULL,
            taste_notes TEXT NOT NULL DEFAULT '',
            rating INTEGER,
            sample_count INTEGER NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            curve_json TEXT NOT NULL,
            events_json TEXT NOT NULL DEFAULT '[]',
            photo_data TEXT NOT NULL DEFAULT ''
        )
        """
    )
    existing = {row[1] for row in connection.execute("PRAGMA table_info(roast_sessions)")}
    additions = [
        ("events_json", "TEXT NOT NULL DEFAULT '[]'"),
        ("photo_data", "TEXT NOT NULL DEFAULT ''"),
        ("taste_notes", "TEXT NOT NULL DEFAULT ''"),
        ("rating", "INTEGER"),
        ("weight_grams", "REAL"),
        ("flame_level", "INTEGER"),
        ("total_roast_seconds", "INTEGER"),
    ]
    for col, definition in additions:
        if col not in existing:
            connection.execute(f"ALTER TABLE roast_sessions ADD COLUMN {col} {definition}")


def _migrate_v2(connection):
    """Add photo_filename column for on-disk photo storage."""
    existing = {row[1] for row in connection.execute("PRAGMA table_info(roast_sessions)")}
    if "photo_filename" not in existing:
        connection.execute(
            "ALTER TABLE roast_sessions ADD COLUMN photo_filename TEXT NOT NULL DEFAULT ''"
        )


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def save_roast_session(payload):
    flame_level = _normalize_flame_level(payload.get("flame_level"))
    curve = _normalize_curve(payload.get("curve") or [], flame_level)
    events = _normalize_events(payload.get("events") or [], flame_level)
    row = (
        payload["bean_name"].strip(),
        payload["origin"].strip(),
        payload["roast_level"].strip(),
        payload.get("weight_grams"),
        flame_level,
        payload.get("total_roast_seconds"),
        payload.get("notes", "").strip(),
        payload.get("taste_notes", "").strip(),
        payload.get("rating"),
        len(curve),
        payload["started_at"],
        payload["ended_at"],
        payload["created_at"],
        json.dumps(curve),
        json.dumps(events),
        payload.get("photo_filename", "") or "",
    )

    with sqlite3.connect(_database_path()) as connection:
        cursor = connection.execute(
            """
            INSERT INTO roast_sessions (
                bean_name,
                origin,
                roast_level,
                weight_grams,
                flame_level,
                total_roast_seconds,
                notes,
                taste_notes,
                rating,
                sample_count,
                started_at,
                ended_at,
                created_at,
                curve_json,
                events_json,
                photo_filename
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            row,
        )
        connection.commit()
        roast_id = cursor.lastrowid

    return get_roast_session(roast_id)


def list_roast_sessions(limit=8):
    with sqlite3.connect(_database_path()) as connection:
        connection.row_factory = sqlite3.Row
        query = """
            SELECT
                id,
                bean_name,
                origin,
                roast_level,
                weight_grams,
                flame_level,
                total_roast_seconds,
                notes,
                taste_notes,
                rating,
                sample_count,
                started_at,
                ended_at,
                created_at,
                photo_filename
            FROM roast_sessions
            ORDER BY id DESC
        """
        params = ()

        if limit is not None:
            query += " LIMIT ?"
            params = (limit,)

        rows = connection.execute(query, params).fetchall()

    return [_format_list_row(row) for row in rows]


def get_roast_session(roast_id):
    with sqlite3.connect(_database_path()) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            """
            SELECT
                id,
                bean_name,
                origin,
                roast_level,
                weight_grams,
                flame_level,
                total_roast_seconds,
                notes,
                taste_notes,
                rating,
                sample_count,
                started_at,
                ended_at,
                created_at,
                curve_json,
                events_json,
                photo_data,
                photo_filename
            FROM roast_sessions
            WHERE id = ?
            """,
            (roast_id,),
        ).fetchone()

    if not row:
        return None

    roast = dict(row)
    roast["flame_level"] = _normalize_flame_level(roast.get("flame_level"))
    roast["curve"] = json.loads(roast.pop("curve_json") or "[]")
    roast["events"] = json.loads(roast.pop("events_json") or "[]")
    roast["curve"] = _normalize_curve(roast["curve"], roast["flame_level"])
    roast["events"] = _normalize_events(roast["events"], roast["flame_level"])

    photo_filename = roast.get("photo_filename", "") or ""
    if photo_filename:
        roast["photo_url"] = f"/uploads/{photo_filename}"
        roast["photo_data"] = ""
    else:
        roast["photo_url"] = ""
        # photo_data kept as-is for legacy rows that stored base64 directly

    return roast


def get_roast_summary():
    with sqlite3.connect(_database_path()) as connection:
        connection.row_factory = sqlite3.Row
        counts = connection.execute(
            """
            SELECT
                COUNT(*) AS roast_count,
                COALESCE(SUM(sample_count), 0) AS sample_count,
                MAX(created_at) AS latest_roast_at
            FROM roast_sessions
            """
        ).fetchone()

        level_rows = connection.execute(
            """
            SELECT roast_level, COUNT(*) AS total
            FROM roast_sessions
            GROUP BY roast_level
            ORDER BY total DESC, roast_level ASC
            """
        ).fetchall()

    summary = dict(counts)
    summary["levels"] = [dict(row) for row in level_rows]
    return summary


def update_roast_session(roast_id, payload):
    row = (
        payload["bean_name"].strip(),
        payload["origin"].strip(),
        payload["roast_level"].strip(),
        payload.get("weight_grams"),
        payload.get("notes", "").strip(),
        payload.get("rating"),
        payload.get("taste_notes", "").strip(),
        roast_id,
    )

    with sqlite3.connect(_database_path()) as connection:
        cursor = connection.execute(
            """
            UPDATE roast_sessions
            SET
                bean_name = ?,
                origin = ?,
                roast_level = ?,
                weight_grams = ?,
                notes = ?,
                rating = ?,
                taste_notes = ?
            WHERE id = ?
            """,
            row,
        )
        connection.commit()

    if cursor.rowcount == 0:
        return None

    return get_roast_session(roast_id)


def delete_roast_session(roast_id):
    with sqlite3.connect(_database_path()) as connection:
        cursor = connection.execute(
            "DELETE FROM roast_sessions WHERE id = ?",
            (roast_id,),
        )
        connection.commit()

    return cursor.rowcount > 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _database_path(app=None):
    flask_app = app or current_app
    configured = flask_app.config["SQLALCHEMY_DATABASE_URI"]

    if configured.startswith("sqlite:///"):
        relative = configured.replace("sqlite:///", "", 1)
        return Path(flask_app.instance_path) / relative

    return Path(configured)


def _format_list_row(row):
    result = dict(row)
    photo_filename = result.get("photo_filename", "") or ""
    result["photo_url"] = f"/uploads/{photo_filename}" if photo_filename else ""
    return result


def _normalize_flame_level(value):
    if value in ("", None):
        return None

    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_curve(curve, default_flame_level):
    normalized = []
    for point in curve:
        flame_level = _normalize_flame_level(point.get("flame_level", default_flame_level))
        normalized_point = dict(point)
        normalized_point["flame_level"] = flame_level
        normalized.append(normalized_point)
    return normalized


def _normalize_events(events, default_flame_level):
    normalized = []
    for event in events:
        flame_level = _normalize_flame_level(event.get("flame_level", default_flame_level))
        normalized_event = dict(event)
        normalized_event["flame_level"] = flame_level
        normalized.append(normalized_event)
    return normalized
