from datetime import datetime

from flask import Blueprint, abort, current_app, jsonify, render_template, request

from app import sockets as sockets_module
from app.services.roast_storage import (
    get_roast_session,
    get_roast_summary,
    list_roast_sessions,
    save_roast_session,
)


main = Blueprint("main", __name__)


@main.route("/")
def dashboard():
    return render_template(
        "dashboard.html",
        max_chart_points=current_app.config["MAX_CHART_POINTS"],
        active_page="dashboard",
    )


@main.route("/roast")
def roast_page():
    return render_template(
        "roast.html",
        active_page="roast",
    )


@main.route("/roast/session")
def roast_session_page():
    bean_name = request.args.get("bean_name", "").strip()
    origin = request.args.get("origin", "").strip()
    roast_level = request.args.get("roast_level", "Medium").strip() or "Medium"

    return render_template(
        "roast_session.html",
        max_chart_points=current_app.config["MAX_CHART_POINTS"],
        active_page="roast",
        bean_name=bean_name,
        origin=origin,
        roast_level=roast_level,
    )


@main.route("/roast/review")
def roast_review_page():
    return render_template(
        "roast_review.html",
        active_page="roast",
    )


@main.route("/lookup")
def lookup_page():
    return render_template(
        "lookup.html",
        active_page="lookup",
    )


@main.route("/api/roasts", methods=["GET"])
def get_roasts():
    limit_arg = request.args.get("limit", default="8")
    limit = None if limit_arg == "all" else int(limit_arg)
    return jsonify({"items": list_roast_sessions(limit=limit)})


@main.route("/api/roasts/summary", methods=["GET"])
def get_roast_overview():
    return jsonify(get_roast_summary())


@main.route("/api/roasts/<int:roast_id>", methods=["GET"])
def get_roast(roast_id):
    roast = get_roast_session(roast_id)
    if roast is None:
        abort(404)
    return jsonify(roast)


@main.route("/api/roasts", methods=["POST"])
def create_roast():
    payload = request.get_json(silent=True) or {}
    required_fields = [
        "bean_name",
        "origin",
        "roast_level",
        "started_at",
        "ended_at",
    ]
    missing = [
        field for field in required_fields if not str(payload.get(field, "")).strip()
    ]

    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    payload["created_at"] = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    roast = save_roast_session(payload)
    return jsonify(roast), 201


@main.route("/api/sensor/health", methods=["GET"])
def get_sensor_health():
    if sockets_module.sensor_service is None:
        return jsonify(
            {
                "mode": current_app.config["SENSOR_MODE"],
                "connected": False,
                "temperature_ok": False,
                "servo_ok": False,
                "source": "unavailable",
                "last_temperature_error": "sensor service not initialized",
                "speed": 0,
            }
        ), 503

    health = sockets_module.sensor_service.health_status()
    status_code = 200 if health["connected"] and health["temperature_ok"] and health["servo_ok"] else 503
    return jsonify(health), status_code
