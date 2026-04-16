import json
import sqlite3
from pathlib import Path

from flask import current_app


def init_db(app):
    db_path = _database_path(app)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS roast_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bean_name TEXT NOT NULL,
                origin TEXT NOT NULL,
                roast_level TEXT NOT NULL,
                weight_grams REAL,
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
        existing_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(roast_sessions)")
        }
        if "events_json" not in existing_columns:
            connection.execute(
                "ALTER TABLE roast_sessions ADD COLUMN events_json TEXT NOT NULL DEFAULT '[]'"
            )
        if "photo_data" not in existing_columns:
            connection.execute(
                "ALTER TABLE roast_sessions ADD COLUMN photo_data TEXT NOT NULL DEFAULT ''"
            )
        if "taste_notes" not in existing_columns:
            connection.execute(
                "ALTER TABLE roast_sessions ADD COLUMN taste_notes TEXT NOT NULL DEFAULT ''"
            )
        if "rating" not in existing_columns:
            connection.execute(
                "ALTER TABLE roast_sessions ADD COLUMN rating INTEGER"
            )
        if "weight_grams" not in existing_columns:
            connection.execute(
                "ALTER TABLE roast_sessions ADD COLUMN weight_grams REAL"
            )
        if "total_roast_seconds" not in existing_columns:
            connection.execute(
                "ALTER TABLE roast_sessions ADD COLUMN total_roast_seconds INTEGER"
            )
        connection.commit()


def save_roast_session(payload):
    curve = payload.get("curve") or []
    events = payload.get("events") or []
    row = (
        payload["bean_name"].strip(),
        payload["origin"].strip(),
        payload["roast_level"].strip(),
        payload.get("weight_grams"),
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
        payload.get("photo_data", ""),
    )

    with sqlite3.connect(_database_path()) as connection:
        cursor = connection.execute(
            """
            INSERT INTO roast_sessions (
                bean_name,
                origin,
                roast_level,
                weight_grams,
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
                photo_data
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                total_roast_seconds,
                notes,
                taste_notes,
                rating,
                sample_count,
                started_at,
                ended_at,
                created_at,
                photo_data
            FROM roast_sessions
            ORDER BY id DESC
        """
        params = ()

        if limit is not None:
            query += " LIMIT ?"
            params = (limit,)

        rows = connection.execute(query, params).fetchall()

    return [dict(row) for row in rows]


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
                photo_data
            FROM roast_sessions
            WHERE id = ?
            """,
            (roast_id,),
        ).fetchone()

    if not row:
        return None

    roast = dict(row)
    roast["curve"] = json.loads(roast.pop("curve_json") or "[]")
    roast["events"] = json.loads(roast.pop("events_json") or "[]")
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


def _database_path(app=None):
    flask_app = app or current_app
    configured = flask_app.config["SQLALCHEMY_DATABASE_URI"]

    if configured.startswith("sqlite:///"):
        relative = configured.replace("sqlite:///", "", 1)
        return Path(flask_app.instance_path) / relative

    return Path(configured)
