from datetime import datetime

from flask import Blueprint, abort, current_app, jsonify, redirect, render_template, request, url_for

from app import sockets as sockets_module
from app.services.roast_storage import (
    delete_roast_session,
    get_roast_session,
    get_roast_summary,
    list_roast_sessions,
    save_roast_session,
    update_roast_session,
)
from app.services import wifi_service


main = Blueprint("main", __name__)


@main.route("/")
def dashboard():
    if wifi_service.is_setup_mode_enabled(current_app):
        current_app.logger.info("Redirected dashboard request to Wi-Fi setup")
        return redirect(url_for("main.wifi_setup_page"))

    current_app.logger.info("Rendered dashboard page")
    return render_template(
        "dashboard.html",
        max_chart_points=current_app.config["MAX_CHART_POINTS"],
        active_page="dashboard",
    )


@main.route("/roast")
def roast_page():
    current_app.logger.info("Rendered roast setup page")
    return render_template(
        "roast.html",
        active_page="roast",
    )


@main.route("/roast/session")
def roast_session_page():
    bean_name = request.args.get("bean_name", "").strip()
    origin = request.args.get("origin", "").strip()
    roast_level = request.args.get("roast_level", "Medium").strip() or "Medium"
    weight_grams = request.args.get("weight_grams", "").strip()

    current_app.logger.info(
        "Rendered roast session page",
        extra={
            "bean_name": bean_name or "Unnamed Roast",
            "origin": origin or "Unknown origin",
            "roast_level": roast_level,
            "weight_grams": weight_grams or "--",
        },
    )

    return render_template(
        "roast_session.html",
        max_chart_points=current_app.config["MAX_CHART_POINTS"],
        active_page="roast",
        bean_name=bean_name,
        origin=origin,
        roast_level=roast_level,
        weight_grams=weight_grams,
    )


@main.route("/roast/review")
def roast_review_page():
    current_app.logger.info("Rendered roast review page")
    return render_template(
        "roast_review.html",
        active_page="roast",
    )


@main.route("/lookup")
def lookup_page():
    current_app.logger.info("Rendered lookup page")
    return render_template(
        "lookup.html",
        active_page="lookup",
    )


@main.route("/lookup/<int:roast_id>/edit")
def lookup_edit_page(roast_id):
    roast = get_roast_session(roast_id)
    if roast is None:
        current_app.logger.warning("Lookup edit page requested for missing roast", extra={"roast_id": roast_id})
        abort(404)

    current_app.logger.info("Rendered lookup edit page", extra={"roast_id": roast_id})

    return render_template(
        "lookup_edit.html",
        active_page="lookup",
        roast_id=roast_id,
    )


@main.route("/setup/wifi")
def wifi_setup_page():
    _require_wifi_setup_mode()
    current_app.logger.info("Rendered Wi-Fi setup page")
    return render_template(
        "setup_wifi.html",
        active_page="setup",
        wifi_setup_ssid=current_app.config["WIFI_SETUP_SSID"],
        wifi_setup_route=current_app.config["WIFI_SETUP_ROUTE"],
        wifi_interface=current_app.config["WIFI_INTERFACE"],
        hide_site_nav=True,
    )


@main.route("/api/setup/wifi/networks", methods=["GET"])
def wifi_setup_networks():
    _require_wifi_setup_mode()

    try:
        networks = wifi_service.list_networks(current_app)
    except wifi_service.WifiCommandError as error:
        current_app.logger.warning("Wi-Fi scan failed", extra={"error": str(error)})
        return jsonify({"error": str(error)}), 503

    current_app.logger.info("Listed Wi-Fi networks", extra={"count": len(networks)})
    return jsonify({"items": networks})


@main.route("/api/setup/wifi/connect", methods=["POST"])
def wifi_setup_connect():
    _require_wifi_setup_mode()

    payload = request.get_json(silent=True) or {}
    ssid = str(payload.get("ssid", "")).strip()
    password = str(payload.get("password", ""))
    hidden = bool(payload.get("hidden", False))

    if not ssid:
        return jsonify({"error": "SSID is required."}), 400

    try:
        wifi_service.connect_to_network(
            current_app,
            ssid=ssid,
            password=password,
            hidden=hidden,
        )
    except wifi_service.WifiCommandError as error:
        current_app.logger.warning(
            "Wi-Fi connect failed",
            extra={"ssid": ssid, "error": str(error)},
        )
        return jsonify({"error": str(error)}), 400

    current_app.logger.info("Saved Wi-Fi credentials", extra={"ssid": ssid, "hidden": hidden})
    return jsonify(
        {
            "connected": True,
            "ssid": ssid,
            "message": "Home Wi-Fi saved. The Pi should switch from setup hotspot to your home network shortly.",
        }
    )


@main.route("/api/roasts", methods=["GET"])
def get_roasts():
    limit_arg = request.args.get("limit", default="8")
    limit = None if limit_arg == "all" else int(limit_arg)
    current_app.logger.info("Listed roasts", extra={"limit": limit_arg})
    return jsonify({"items": list_roast_sessions(limit=limit)})


@main.route("/api/roasts/summary", methods=["GET"])
def get_roast_overview():
    current_app.logger.info("Fetched roast summary")
    return jsonify(get_roast_summary())


@main.route("/api/roasts/<int:roast_id>", methods=["GET"])
def get_roast(roast_id):
    roast = get_roast_session(roast_id)
    if roast is None:
        current_app.logger.warning("Requested missing roast detail", extra={"roast_id": roast_id})
        abort(404)
    current_app.logger.info("Fetched roast detail", extra={"roast_id": roast_id})
    return jsonify(roast)


@main.route("/api/roasts/<int:roast_id>", methods=["PATCH"])
def patch_roast(roast_id):
    payload = request.get_json(silent=True) or {}
    bean_name = str(payload.get("bean_name", "")).strip()
    origin = str(payload.get("origin", "")).strip()
    roast_level = str(payload.get("roast_level", "")).strip()
    notes = str(payload.get("notes", "")).strip()
    rating = payload.get("rating")
    taste_notes = str(payload.get("taste_notes", "")).strip()
    weight_grams = payload.get("weight_grams")

    if not bean_name or not origin or not roast_level:
        current_app.logger.warning(
            "Rejected roast update due to missing editable fields",
            extra={"roast_id": roast_id},
        )
        return jsonify({"error": "Bean name, origin, and roast level are required."}), 400

    if weight_grams in ("", None):
        normalized_weight_grams = None
    else:
        try:
            normalized_weight_grams = round(float(weight_grams), 2)
        except (TypeError, ValueError):
            current_app.logger.warning(
                "Rejected roast update due to invalid weight",
                extra={"roast_id": roast_id, "weight_grams": weight_grams},
            )
            return jsonify({"error": "Weight must be a valid number in grams."}), 400

    if rating in ("", None):
        normalized_rating = None
    else:
        try:
            normalized_rating = int(rating)
        except (TypeError, ValueError):
            current_app.logger.warning("Rejected roast feedback update due to invalid rating type", extra={"roast_id": roast_id, "rating": rating})
            return jsonify({"error": "Rating must be a whole number from 1 to 5."}), 400

        if normalized_rating < 1 or normalized_rating > 5:
            current_app.logger.warning("Rejected roast feedback update due to rating bounds", extra={"roast_id": roast_id, "rating": normalized_rating})
            return jsonify({"error": "Rating must be between 1 and 5."}), 400

    roast = update_roast_session(
        roast_id,
        {
            "bean_name": bean_name,
            "origin": origin,
            "roast_level": roast_level,
            "weight_grams": normalized_weight_grams,
            "notes": notes,
            "rating": normalized_rating,
            "taste_notes": taste_notes,
        },
    )
    if roast is None:
        current_app.logger.warning("Attempted to update feedback for missing roast", extra={"roast_id": roast_id})
        abort(404)

    current_app.logger.info(
        "Updated roast session",
        extra={
            "roast_id": roast_id,
            "bean_name": bean_name,
            "origin": origin,
            "roast_level": roast_level,
            "weight_grams": normalized_weight_grams,
            "rating": normalized_rating,
            "notes_length": len(notes),
            "taste_notes_length": len(taste_notes),
        },
    )

    return jsonify(roast)


@main.route("/api/roasts/<int:roast_id>", methods=["DELETE"])
def delete_roast(roast_id):
    deleted = delete_roast_session(roast_id)
    if not deleted:
        current_app.logger.warning("Attempted to delete missing roast", extra={"roast_id": roast_id})
        abort(404)

    current_app.logger.info("Deleted roast session", extra={"roast_id": roast_id})
    return jsonify({"deleted": True, "roast_id": roast_id})


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
        current_app.logger.warning("Rejected roast create request due to missing fields", extra={"missing_fields": ", ".join(missing)})
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    weight_grams = payload.get("weight_grams")
    if weight_grams in ("", None):
        payload["weight_grams"] = None
    else:
        try:
            payload["weight_grams"] = round(float(weight_grams), 2)
        except (TypeError, ValueError):
            return jsonify({"error": "Weight must be a valid number in grams."}), 400

    total_roast_seconds = payload.get("total_roast_seconds")
    if total_roast_seconds in ("", None):
        payload["total_roast_seconds"] = None
    else:
        try:
            payload["total_roast_seconds"] = int(total_roast_seconds)
        except (TypeError, ValueError):
            return jsonify({"error": "Total roast time must be a whole number of seconds."}), 400

    payload["created_at"] = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    roast = save_roast_session(payload)
    current_app.logger.info(
        "Created roast session",
        extra={
            "roast_id": roast["id"],
            "bean_name": roast["bean_name"],
            "origin": roast["origin"],
            "weight_grams": roast["weight_grams"],
            "total_roast_seconds": roast["total_roast_seconds"],
            "sample_count": roast["sample_count"],
        },
    )
    return jsonify(roast), 201


def _require_wifi_setup_mode():
    if not wifi_service.is_setup_mode_enabled(current_app):
        abort(404)


@main.route("/api/sensor/health", methods=["GET"])
def get_sensor_health():
    if sockets_module.sensor_service is None:
        current_app.logger.warning("Sensor health requested before sensor service initialization")
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
    if status_code == 200:
        current_app.logger.info(
            "Sensor health check passed",
            extra={"source": health["source"], "speed": health["speed"]},
        )
    else:
        current_app.logger.warning(
            "Sensor health check failed",
            extra={
                "source": health["source"],
                "last_temperature_error": health["last_temperature_error"],
                "speed": health["speed"],
            },
        )
    return jsonify(health), status_code
