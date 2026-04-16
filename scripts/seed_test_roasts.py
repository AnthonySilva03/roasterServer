#!/usr/bin/env python3

import sqlite3
from pathlib import Path

from app import create_app
from app.services.roast_storage import list_roast_sessions, save_roast_session


SEED_ROASTS = [
    {
        "bean_name": "Ethiopia Guji Test Batch",
        "origin": "Guji, Ethiopia",
        "roast_level": "Light",
        "weight_grams": 320.0,
        "flame_level": 35,
        "total_roast_seconds": 540,
        "started_at": "2026-04-16T09:00:00Z",
        "ended_at": "2026-04-16T09:09:00Z",
        "created_at": "2026-04-16T09:10:00Z",
        "notes": "Clean floral test roast with stepped flame reductions.",
        "taste_notes": "Jasmine, bergamot, cane sugar.",
        "rating": 4,
        "curve": [
            {"timestamp": "09:00:30", "temperature": 168.2, "flame_level": 60},
            {"timestamp": "09:02:00", "temperature": 182.5, "flame_level": 60},
            {"timestamp": "09:04:00", "temperature": 197.1, "flame_level": 50},
            {"timestamp": "09:06:30", "temperature": 205.8, "flame_level": 40},
            {"timestamp": "09:08:45", "temperature": 210.4, "flame_level": 35},
        ],
        "events": [
            {"label": "Pre Roast", "detail": "Recording started with flame 60%.", "time": "2026-04-16T09:00:00Z", "chart_label": "09:00:30", "color": "#566a8e", "temperature": 168.2, "flame_level": 60},
            {"label": "Start", "detail": "Charge marked with flame 60%.", "time": "2026-04-16T09:00:30Z", "chart_label": "09:00:30", "color": "#b4542b", "temperature": 168.2, "flame_level": 60},
            {"label": "Flame Change", "detail": "Flame adjusted from 60% to 50%.", "time": "2026-04-16T09:03:30Z", "chart_label": "09:04:00", "color": "#ff8f47", "temperature": 197.1, "flame_level": 50},
            {"label": "First Crack", "detail": "First crack marked at 205.8 C.", "time": "2026-04-16T09:06:30Z", "chart_label": "09:06:30", "color": "#d4a246", "temperature": 205.8, "flame_level": 40},
            {"label": "Flame Change", "detail": "Flame adjusted from 40% to 35%.", "time": "2026-04-16T09:08:10Z", "chart_label": "09:08:45", "color": "#ff8f47", "temperature": 210.4, "flame_level": 35},
            {"label": "Finish", "detail": "Roast finished and dropped for cooling.", "time": "2026-04-16T09:09:00Z", "chart_label": "09:08:45", "color": "#7f3417", "temperature": 210.4, "flame_level": 35},
        ],
        "photo_data": "",
    },
    {
        "bean_name": "Colombia Huila Test Batch",
        "origin": "Huila, Colombia",
        "roast_level": "Medium",
        "weight_grams": 350.0,
        "flame_level": 45,
        "total_roast_seconds": 615,
        "started_at": "2026-04-16T11:30:00Z",
        "ended_at": "2026-04-16T11:40:15Z",
        "created_at": "2026-04-16T11:41:00Z",
        "notes": "Balanced development test roast for lookup and review screens.",
        "taste_notes": "Caramel, red apple, cocoa.",
        "rating": 5,
        "curve": [
            {"timestamp": "11:30:20", "temperature": 170.6, "flame_level": 70},
            {"timestamp": "11:33:00", "temperature": 188.9, "flame_level": 65},
            {"timestamp": "11:35:30", "temperature": 201.3, "flame_level": 55},
            {"timestamp": "11:37:50", "temperature": 209.9, "flame_level": 45},
            {"timestamp": "11:39:50", "temperature": 214.2, "flame_level": 45},
        ],
        "events": [
            {"label": "Start", "detail": "Roast start marked with flame 70%.", "time": "2026-04-16T11:30:20Z", "chart_label": "11:30:20", "color": "#b4542b", "temperature": 170.6, "flame_level": 70},
            {"label": "Flame Change", "detail": "Flame adjusted from 70% to 65%.", "time": "2026-04-16T11:32:10Z", "chart_label": "11:33:00", "color": "#ff8f47", "temperature": 188.9, "flame_level": 65},
            {"label": "Flame Change", "detail": "Flame adjusted from 65% to 55%.", "time": "2026-04-16T11:34:40Z", "chart_label": "11:35:30", "color": "#ff8f47", "temperature": 201.3, "flame_level": 55},
            {"label": "First Crack", "detail": "First crack marked at 209.9 C.", "time": "2026-04-16T11:37:50Z", "chart_label": "11:37:50", "color": "#d4a246", "temperature": 209.9, "flame_level": 45},
            {"label": "Finish", "detail": "Roast finished and reviewed for save.", "time": "2026-04-16T11:40:15Z", "chart_label": "11:39:50", "color": "#7f3417", "temperature": 214.2, "flame_level": 45},
        ],
        "photo_data": "",
    },
    {
        "bean_name": "Kenya Nyeri Test Batch",
        "origin": "Nyeri, Kenya",
        "roast_level": "Medium",
        "weight_grams": 300.0,
        "flame_level": 30,
        "total_roast_seconds": 585,
        "started_at": "2026-04-16T14:15:00Z",
        "ended_at": "2026-04-16T14:24:45Z",
        "created_at": "2026-04-16T14:25:30Z",
        "notes": "Brighter profile with more aggressive late flame cuts for testing event history.",
        "taste_notes": "Blackcurrant, grapefruit, brown sugar.",
        "rating": 4,
        "curve": [
            {"timestamp": "14:15:20", "temperature": 171.8, "flame_level": 65},
            {"timestamp": "14:18:10", "temperature": 190.4, "flame_level": 55},
            {"timestamp": "14:20:20", "temperature": 201.9, "flame_level": 45},
            {"timestamp": "14:22:20", "temperature": 208.6, "flame_level": 35},
            {"timestamp": "14:24:20", "temperature": 212.1, "flame_level": 30},
        ],
        "events": [
            {"label": "Start", "detail": "Roast start marked with flame 65%.", "time": "2026-04-16T14:15:20Z", "chart_label": "14:15:20", "color": "#b4542b", "temperature": 171.8, "flame_level": 65},
            {"label": "Flame Change", "detail": "Flame adjusted from 65% to 55%.", "time": "2026-04-16T14:17:20Z", "chart_label": "14:18:10", "color": "#ff8f47", "temperature": 190.4, "flame_level": 55},
            {"label": "Flame Change", "detail": "Flame adjusted from 55% to 45%.", "time": "2026-04-16T14:19:40Z", "chart_label": "14:20:20", "color": "#ff8f47", "temperature": 201.9, "flame_level": 45},
            {"label": "First Crack", "detail": "First crack marked at 208.6 C.", "time": "2026-04-16T14:22:20Z", "chart_label": "14:22:20", "color": "#d4a246", "temperature": 208.6, "flame_level": 35},
            {"label": "Flame Change", "detail": "Flame adjusted from 35% to 30%.", "time": "2026-04-16T14:23:50Z", "chart_label": "14:24:20", "color": "#ff8f47", "temperature": 212.1, "flame_level": 30},
            {"label": "Finish", "detail": "Roast finished at target color.", "time": "2026-04-16T14:24:45Z", "chart_label": "14:24:20", "color": "#7f3417", "temperature": 212.1, "flame_level": 30},
        ],
        "photo_data": "",
    },
]


def main():
    app = create_app(
        {
            "START_SENSOR_BACKGROUND_TASK": False,
            "SENSOR_MODE": "simulated",
        }
    )

    with app.app_context():
        db_path = Path(app.instance_path) / "roasts.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)

        with sqlite3.connect(db_path) as connection:
            connection.execute("DELETE FROM roast_sessions")
            connection.commit()

        for roast in SEED_ROASTS:
            save_roast_session(roast)

        saved = list_roast_sessions(limit=None)
        print(f"seeded={len(saved)}")
        for roast in saved:
            print(
                f"{roast['id']}: {roast['bean_name']} | flame={roast.get('flame_level')} | samples={roast['sample_count']}"
            )


if __name__ == "__main__":
    main()
