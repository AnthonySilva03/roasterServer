import base64
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, abort, current_app, jsonify, redirect, render_template, request, send_from_directory, url_for

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

_ALLOWED_PHOTO_TYPES = re.compile(r'^data:image/(jpeg|jpg|png|gif|webp);base64,')
_MAX_PHOTO_BYTES = 7_000_000  # ~5 MB raw after base64 decode


class PhotoSaveError(Exception):
    """Raised when a valid photo payload could not be written to disk."""


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


# Probe URLs that phones/laptops request right after joining a Wi-Fi network to
# detect a captive portal. When the Pi runs as a direct access point we answer
# these with a redirect to the dashboard so the device pops the app on join.
@main.route("/generate_204")
@main.route("/gen_204")
@main.route("/hotspot-detect.html")
@main.route("/library/test/success.html")
@main.route("/ncsi.txt")
@main.route("/connecttest.txt")
@main.route("/canonical.html")
@main.route("/success.txt")
@main.route("/redirect")
def captive_portal_probe():
    if not current_app.config.get("CAPTIVE_PORTAL_ENABLED", False):
        abort(404)
    current_app.logger.info("Captive portal probe redirected", extra={"path": request.path})
    return redirect(url_for("main.dashboard"))


@main.route("/sw.js")
def service_worker():
    # Served from the root so its scope covers the whole app (a /static/ path
    # would only control /static/). Service-Worker-Allowed widens the scope too.
    response = send_from_directory(current_app.static_folder, "sw.js")
    response.headers["Content-Type"] = "application/javascript"
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-cache"
    return response


@main.route("/uploads/<filename>")
def uploaded_file(filename):
    upload_folder = current_app.config.get("UPLOAD_FOLDER", "")
    if not upload_folder or not re.match(r'^[\w\-]+\.\w{2,5}$', filename):
        abort(404)
    return send_from_directory(upload_folder, filename)


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
    roast = get_roast_session(roast_id)
    if roast is None:
        current_app.logger.warning("Attempted to delete missing roast", extra={"roast_id": roast_id})
        abort(404)

    delete_roast_session(roast_id)

    photo_filename = roast.get("photo_filename", "")
    if photo_filename:
        upload_folder = current_app.config.get("UPLOAD_FOLDER", "")
        if upload_folder:
            try:
                Path(upload_folder, photo_filename).unlink(missing_ok=True)
            except OSError:
                current_app.logger.warning(
                    "Failed to delete photo file",
                    extra={"photo_filename": photo_filename, "roast_id": roast_id},
                )

    current_app.logger.info("Deleted roast session", extra={"roast_id": roast_id})
    return jsonify({"deleted": True, "roast_id": roast_id})


def _normalize_roast_payload(payload):
    """Validate and coerce roast fields in place. Returns an error string or None."""
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
        return f"Missing fields: {', '.join(missing)}"

    weight_grams = payload.get("weight_grams")
    if weight_grams in ("", None):
        payload["weight_grams"] = None
    else:
        try:
            payload["weight_grams"] = round(float(weight_grams), 2)
        except (TypeError, ValueError):
            return "Weight must be a valid number in grams."

    total_roast_seconds = payload.get("total_roast_seconds")
    if total_roast_seconds in ("", None):
        payload["total_roast_seconds"] = None
    else:
        try:
            payload["total_roast_seconds"] = int(total_roast_seconds)
        except (TypeError, ValueError):
            return "Total roast time must be a whole number of seconds."

    flame_level = payload.get("flame_level")
    if flame_level in ("", None):
        payload["flame_level"] = None
    else:
        try:
            payload["flame_level"] = int(flame_level)
        except (TypeError, ValueError):
            return "Flame level must be a whole number from 0 to 100."

        if payload["flame_level"] < 0 or payload["flame_level"] > 100:
            return "Flame level must be between 0 and 100."

    return None


@main.route("/api/roasts", methods=["POST"])
def create_roast():
    payload = request.get_json(silent=True) or {}
    error = _normalize_roast_payload(payload)
    if error:
        current_app.logger.warning("Rejected roast create request", extra={"error": error})
        return jsonify({"error": error}), 400

    photo_data = str(payload.pop("photo_data", "") or "")
    if photo_data:
        if not _ALLOWED_PHOTO_TYPES.match(photo_data):
            return jsonify({"error": "Photo must be a JPEG, PNG, GIF, or WebP image."}), 400
        if len(photo_data) > _MAX_PHOTO_BYTES:
            return jsonify({"error": "Photo exceeds the 5 MB size limit."}), 400

    try:
        payload["photo_filename"] = _save_photo_to_disk(photo_data)
    except PhotoSaveError:
        return jsonify({"error": "Could not save the uploaded photo. Please try again."}), 500

    payload["created_at"] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds") + "Z"
    roast = save_roast_session(payload)
    current_app.logger.info(
        "Created roast session",
        extra={
            "roast_id": roast["id"],
            "bean_name": roast["bean_name"],
            "origin": roast["origin"],
            "weight_grams": roast["weight_grams"],
            "flame_level": roast["flame_level"],
            "total_roast_seconds": roast["total_roast_seconds"],
            "sample_count": roast["sample_count"],
            "has_photo": bool(roast.get("photo_filename")),
        },
    )
    return jsonify(roast), 201


_EXPORT_FORMAT = "roaster-server-roast"
_EXPORT_FIELDS = [
    "bean_name",
    "origin",
    "roast_level",
    "weight_grams",
    "flame_level",
    "total_roast_seconds",
    "notes",
    "taste_notes",
    "rating",
    "started_at",
    "ended_at",
    "created_at",
    "curve",
    "events",
]


@main.route("/api/roasts/<int:roast_id>/export", methods=["GET"])
def export_roast(roast_id):
    roast = get_roast_session(roast_id)
    if roast is None:
        current_app.logger.warning("Requested export for missing roast", extra={"roast_id": roast_id})
        abort(404)

    data = {field: roast.get(field) for field in _EXPORT_FIELDS}
    photo_data = _photo_as_data_url(roast)
    if photo_data:
        data["photo_data"] = photo_data

    response = jsonify({"format": _EXPORT_FORMAT, "version": 1, "roast": data})
    response.headers["Content-Disposition"] = f'attachment; filename="{_export_filename(roast)}"'
    current_app.logger.info("Exported roast session", extra={"roast_id": roast_id, "has_photo": bool(photo_data)})
    return response


@main.route("/api/roasts/import", methods=["POST"])
def import_roasts():
    payload = request.get_json(silent=True)
    if payload is None:
        return jsonify({"error": "Request body must be valid JSON."}), 400

    entries = _extract_import_roasts(payload)
    if not entries:
        return jsonify({"error": "Could not find any roast records to import."}), 400

    # Validate every entry up front so a bad record never leaves a partial import.
    normalized = []
    for entry in entries:
        if not isinstance(entry, dict):
            return jsonify({"error": "Each roast must be a JSON object."}), 400

        roast_payload = dict(entry)
        roast_payload.pop("id", None)  # storage assigns a fresh id

        error = _normalize_roast_payload(roast_payload)
        if error:
            return jsonify({"error": error}), 400

        photo_data = str(roast_payload.pop("photo_data", "") or "")
        if photo_data:
            if not _ALLOWED_PHOTO_TYPES.match(photo_data):
                return jsonify({"error": "Photo must be a JPEG, PNG, GIF, or WebP image."}), 400
            if len(photo_data) > _MAX_PHOTO_BYTES:
                return jsonify({"error": "Photo exceeds the 5 MB size limit."}), 400

        normalized.append((roast_payload, photo_data))

    imported = []
    for roast_payload, photo_data in normalized:
        try:
            roast_payload["photo_filename"] = _save_photo_to_disk(photo_data)
        except PhotoSaveError:
            return jsonify({"error": "Could not save an imported photo. Please try again."}), 500

        if not str(roast_payload.get("created_at", "")).strip():
            roast_payload["created_at"] = (
                datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds") + "Z"
            )

        imported.append(save_roast_session(roast_payload))

    current_app.logger.info("Imported roast sessions", extra={"count": len(imported)})
    return jsonify({"imported": len(imported), "items": imported}), 201


def _extract_import_roasts(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        if isinstance(payload.get("roast"), dict):
            return [payload["roast"]]
        if isinstance(payload.get("roasts"), list):
            return payload["roasts"]
        if isinstance(payload.get("items"), list):
            return payload["items"]
        if any(key in payload for key in ("bean_name", "curve", "events")):
            return [payload]
    return None


def _photo_as_data_url(roast):
    legacy = roast.get("photo_data") or ""
    if legacy:
        return legacy

    filename = roast.get("photo_filename") or ""
    if not filename:
        return ""

    upload_folder = current_app.config.get("UPLOAD_FOLDER", "")
    if not upload_folder:
        return ""

    try:
        raw = Path(upload_folder, filename).read_bytes()
    except OSError:
        current_app.logger.warning("Could not read photo for export", extra={"photo_filename": filename})
        return ""

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    mime = "jpeg" if ext == "jpg" else ext
    return f"data:image/{mime};base64,{base64.b64encode(raw).decode()}"


def _export_filename(roast):
    slug = re.sub(r'[^\w\-]+', '-', (roast.get("bean_name") or "roast")).strip("-").lower() or "roast"
    return f"roast-{roast['id']}-{slug}.json"


def _require_wifi_setup_mode():
    if not wifi_service.is_setup_mode_enabled(current_app):
        abort(404)


def _save_photo_to_disk(photo_data):
    if not photo_data:
        return ""

    upload_folder = current_app.config.get("UPLOAD_FOLDER", "")
    if not upload_folder:
        current_app.logger.error("Photo upload received but UPLOAD_FOLDER is not configured")
        raise PhotoSaveError("upload folder not configured")

    try:
        header, encoded = photo_data.split(",", 1)
        ext_match = re.search(r'image/(\w+)', header)
        ext = ext_match.group(1) if ext_match else "jpg"
        if ext == "jpeg":
            ext = "jpg"
        filename = f"{uuid.uuid4().hex}.{ext}"
        Path(upload_folder, filename).write_bytes(base64.b64decode(encoded))
        return filename
    except Exception as error:
        current_app.logger.exception("Failed to save photo to disk")
        raise PhotoSaveError(str(error)) from error


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
                "flame_level": 0,
            }
        ), 503

    health = sockets_module.sensor_service.health_status()
    status_code = 200 if health["connected"] and health["temperature_ok"] and health["servo_ok"] else 503
    if status_code == 200:
        current_app.logger.info(
            "Sensor health check passed",
            extra={"source": health["source"], "flame_level": health["flame_level"]},
        )
    else:
        current_app.logger.warning(
            "Sensor health check failed",
            extra={
                "source": health["source"],
                "last_temperature_error": health["last_temperature_error"],
                "flame_level": health["flame_level"],
            },
        )
    return jsonify(health), status_code
