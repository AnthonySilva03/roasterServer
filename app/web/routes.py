import base64
import csv
import io
import math
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, Response, abort, current_app, jsonify, redirect, render_template, request, send_from_directory, url_for

from app import sockets as sockets_module
from app.services import roast_math
from app.services.roast_storage import (
    ROAST_PROPERTY_FIELDS,
    delete_roast_session,
    get_roast_session,
    get_roast_summary,
    list_roast_sessions,
    save_roast_session,
    save_roast_sessions,
    update_roast_session,
)
from app.services import wifi_service
from app.services.calibration import save_calibration


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
    # Optional saved roast to overlay as a reference curve; ignore anything
    # that is not a positive integer id.
    reference_id = request.args.get("reference_id", "").strip()
    reference_id = reference_id if reference_id.isdigit() and int(reference_id) > 0 else ""

    current_app.logger.info(
        "Rendered roast session page",
        extra={
            "bean_name": bean_name or "Unnamed Roast",
            "origin": origin or "Unknown origin",
            "roast_level": roast_level,
            "weight_grams": weight_grams or "--",
            "reference_id": reference_id or "--",
        },
    )

    return render_template(
        "roast_session.html",
        active_page="roast",
        bean_name=bean_name,
        origin=origin,
        roast_level=roast_level,
        weight_grams=weight_grams,
        reference_id=reference_id,
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


@main.route("/settings")
def settings_page():
    current_app.logger.info("Rendered settings page")
    return render_template(
        "settings.html",
        active_page="settings",
        servo_min_pulsewidth=current_app.config["SERVO_MIN_PULSEWIDTH"],
        servo_max_pulsewidth=current_app.config["SERVO_MAX_PULSEWIDTH"],
    )


@main.route("/reports")
def reports_page():
    current_app.logger.info("Rendered reports page")
    return render_template(
        "reports.html",
        active_page="reports",
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
    if limit_arg == "all":
        limit = None
    else:
        try:
            limit = int(limit_arg)
        except ValueError:
            limit = 0
        if limit < 1:
            return jsonify({"error": "limit must be a positive whole number or 'all'."}), 400
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

    # Post-roast properties: only the fields present in the request are changed.
    properties = {field: payload[field] for field in ROAST_PROPERTY_FIELDS if field in payload}
    property_error = _normalize_roast_properties(properties, only_present=True)
    if property_error:
        current_app.logger.warning(
            "Rejected roast update due to invalid property",
            extra={"roast_id": roast_id, "error": property_error},
        )
        return jsonify({"error": property_error}), 400

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
            **properties,
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

    _delete_photo_files([roast.get("photo_filename", "")])

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
    missing = []
    for field in required_fields:
        value = payload.get(field)
        text = "" if value is None else str(value).strip()
        if not text:
            missing.append(field)
        payload[field] = text
    if missing:
        return f"Missing fields: {', '.join(missing)}"

    created_at = payload.get("created_at")
    payload["created_at"] = "" if created_at is None else str(created_at).strip()

    for field, label in (("notes", "Notes"), ("taste_notes", "Tasting notes")):
        value = payload.get(field)
        if value is None:
            payload[field] = ""
        elif isinstance(value, str):
            payload[field] = value.strip()
        else:
            return f"{label} must be text."

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

    rating = payload.get("rating")
    if rating in ("", None):
        payload["rating"] = None
    else:
        try:
            payload["rating"] = int(rating)
        except (TypeError, ValueError):
            return "Rating must be a whole number from 1 to 5."

        if payload["rating"] < 1 or payload["rating"] > 5:
            return "Rating must be between 1 and 5."

    error = _normalize_roast_properties(payload)
    if error:
        return error

    error = _normalize_curve_points(payload)
    if error:
        return error

    return _normalize_event_entries(payload)


_PROPERTY_TEXT_MAX = 80
_NUMERIC_PROPERTIES = (
    # field, label, minimum, maximum, unit
    ("roasted_weight_grams", "Roasted weight", 0, 100000, "grams"),
    ("green_moisture_percent", "Green moisture", 0, 100, "percent"),
    ("ambient_temp_c", "Ambient temperature", -50, 80, "°C"),
)
_TEXT_PROPERTIES = (("roast_color", "Roast color"), ("batch_label", "Batch label"))


def _normalize_roast_properties(payload, only_present=False):
    """Coerce the post-roast property fields in place. Returns an error or None.

    With only_present=True (PATCH) fields missing from the payload are left
    untouched; otherwise (create/import) they are filled with None / ''.
    """
    for field, label, low, high, unit in _NUMERIC_PROPERTIES:
        if only_present and field not in payload:
            continue
        value = payload.get(field)
        if value in ("", None):
            payload[field] = None
            continue
        number = _finite_number(value)
        if number is None:
            return f"{label} must be a number in {unit}."
        if number < low or number > high:
            return f"{label} must be between {low} and {high} {unit}."
        payload[field] = round(number, 2)

    for field, label in _TEXT_PROPERTIES:
        if only_present and field not in payload:
            continue
        value = payload.get(field)
        if value is None:
            payload[field] = ""
            continue
        if not isinstance(value, str):
            return f"{label} must be text."
        text = value.strip()
        if len(text) > _PROPERTY_TEXT_MAX:
            return f"{label} must be {_PROPERTY_TEXT_MAX} characters or fewer."
        payload[field] = text

    return None


def _normalize_curve_points(payload):
    """Require curve to be a list of {timestamp: str, temperature: finite number}."""
    curve = payload.get("curve")
    if curve is None:
        curve = []
    if not isinstance(curve, list):
        return "Curve must be a list of temperature points."

    normalized = []
    for index, point in enumerate(curve, start=1):
        if not isinstance(point, dict):
            return f"Curve point {index} must be an object."
        temperature = _finite_number(point.get("temperature"))
        if temperature is None:
            return f"Curve point {index} has an invalid temperature."
        timestamp = point.get("timestamp")
        if not isinstance(timestamp, str) or not timestamp.strip():
            return f"Curve point {index} is missing a timestamp."
        normalized_point = dict(point)
        normalized_point["temperature"] = temperature
        normalized_point["timestamp"] = timestamp.strip()
        normalized.append(normalized_point)

    payload["curve"] = normalized
    return None


def _normalize_event_entries(payload):
    """Require events to be a list of objects with a non-empty text label."""
    events = payload.get("events")
    if events is None:
        events = []
    if not isinstance(events, list):
        return "Events must be a list."

    normalized = []
    for index, event in enumerate(events, start=1):
        if not isinstance(event, dict):
            return f"Event {index} must be an object."
        label = event.get("label")
        if not isinstance(label, str) or not label.strip():
            return f"Event {index} is missing a label."
        detail = event.get("detail")
        if detail is not None and not isinstance(detail, str):
            return f"Event {index} detail must be text."
        normalized_event = dict(event)
        normalized_event["label"] = label.strip()
        normalized_event["detail"] = "" if detail is None else detail
        normalized.append(normalized_event)

    payload["events"] = normalized
    return None


def _finite_number(value):
    """Return value as a finite float, or None when it is not a usable number."""
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _utc_now_iso():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds") + "Z"


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

    payload["created_at"] = _utc_now_iso()
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
    *ROAST_PROPERTY_FIELDS,
]


@main.route("/api/roasts/report", methods=["GET"])
def roast_report():
    """Per-roast statistics for the ranking report (phases, key temps, loss, AUC)."""
    auc_base = roast_math._number(request.args.get("auc_base", "150")) if request.args.get("auc_base") else 150.0
    if auc_base is None:
        return jsonify({"error": "auc_base must be a number in °C."}), 400

    items = []
    for row in list_roast_sessions(limit=None):
        roast = get_roast_session(row["id"])
        if roast is not None:
            items.append(roast_math.roast_report_row(roast, auc_base_c=auc_base))

    current_app.logger.info("Built roast report", extra={"count": len(items), "auc_base": auc_base})
    return jsonify({"items": items, "auc_base_c": auc_base})


@main.route("/api/roasts/<int:roast_id>/export.csv", methods=["GET"])
def export_roast_csv(roast_id):
    """Curve as CSV: seconds from charge, sample time, bean temp, flame %, event label."""
    roast = get_roast_session(roast_id)
    if roast is None:
        current_app.logger.warning("Requested CSV export for missing roast", extra={"roast_id": roast_id})
        abort(404)

    times = roast_math.roast_times(roast)
    points = times["points"]
    charge = times["charge"] or (points[0][0] if points else None)
    anchor = roast_math.parse_timestamp(roast.get("started_at"))

    # Attach each event to its nearest sample so the CSV stays one table.
    labels_by_index = {}
    for event in roast.get("events") or []:
        when = roast_math.parse_timestamp(event.get("time"), anchor)
        if when is None or not points:
            continue
        index = min(range(len(points)), key=lambda i: abs((points[i][0] - when).total_seconds()))
        labels_by_index.setdefault(index, []).append(str(event.get("label", "")))

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["elapsed_seconds", "timestamp", "bean_temp_c", "flame_percent", "event"])
    raw_curve = roast.get("curve") or []
    for index, (when, temperature, flame) in enumerate(points):
        elapsed = round((when - charge).total_seconds(), 3) if charge else ""
        timestamp = raw_curve[index].get("timestamp", "") if index < len(raw_curve) else ""
        writer.writerow([
            elapsed,
            timestamp,
            f"{temperature:.2f}",
            "" if flame is None else flame,
            "; ".join(labels_by_index.get(index, [])),
        ])

    response = Response(buffer.getvalue(), mimetype="text/csv")
    response.headers["Content-Disposition"] = f'attachment; filename="{_export_filename(roast, "csv")}"'
    current_app.logger.info("Exported roast CSV", extra={"roast_id": roast_id, "rows": len(points)})
    return response


@main.route("/api/roasts/<int:roast_id>/export.alog", methods=["GET"])
def export_roast_alog(roast_id):
    """Artisan profile (.alog): a Python dict literal Artisan opens with File > Open."""
    roast = get_roast_session(roast_id)
    if roast is None:
        current_app.logger.warning("Requested Artisan export for missing roast", extra={"roast_id": roast_id})
        abort(404)

    profile = _artisan_profile(roast)
    response = Response(repr(profile), mimetype="application/octet-stream")
    response.headers["Content-Disposition"] = f'attachment; filename="{_export_filename(roast, "alog")}"'
    current_app.logger.info("Exported roast as Artisan profile", extra={"roast_id": roast_id, "samples": len(profile["timex"])})
    return response


_ARTISAN_BURNER_TYPE = 3  # index into etypes: Air, Drum, Damper, Burner


def _artisan_profile(roast):
    """Build an Artisan profile dict. Bean temp goes to temp2 (BT); there is no
    environment probe so temp1 (ET) is -1 (Artisan's "no reading")."""
    times = roast_math.roast_times(roast)
    points = times["points"]
    anchor = roast_math.parse_timestamp(roast.get("started_at"))
    t0 = points[0][0] if points else None

    timex = [round((when - t0).total_seconds(), 3) for when, _, _ in points]
    temp2 = [round(temperature, 2) for _, temperature, _ in points]
    temp1 = [-1.0] * len(points)

    def index_at(when):
        if when is None or not points:
            return None
        return min(range(len(points)), key=lambda i: abs((points[i][0] - when).total_seconds()))

    events = roast.get("events") or []

    def role_index(role, fallback=None):
        event = roast_math.find_event(events, role)
        when = roast_math.parse_timestamp((event or {}).get("time"), anchor) if event else fallback
        return index_at(when)

    charge_index = role_index("charge", times["charge"])
    drop_index = role_index("drop", times["drop"])
    timeindex = [
        charge_index if charge_index is not None else -1,
        role_index("dryEnd") or 0,
        role_index("firstCrack") or 0,
        role_index("firstCrackEnd") or 0,
        role_index("secondCrack") or 0,
        0,  # second crack end is not tracked
        drop_index or 0,
        0,  # cool end is not tracked
    ]

    # Flame moves become Burner slider events. Artisan stores slider values
    # as value/10 + 1 and shows them back as (value-1)*10.
    special = []
    initial_flame = points[charge_index][2] if charge_index is not None and points[charge_index][2] is not None else None
    if initial_flame is not None:
        special.append((charge_index, initial_flame))
    for event in events:
        if event.get("label") != "Flame Change":
            continue
        flame = event.get("flame_level")
        index = index_at(roast_math.parse_timestamp(event.get("time"), anchor))
        if index is not None and isinstance(flame, (int, float)) and not isinstance(flame, bool):
            special.append((index, int(flame)))
    special.sort()

    started = anchor or t0 or datetime.utcnow()
    return {
        "version": "roaster-server",
        "revision": 1,
        "artisan_os": "raspberry-pi",
        "mode": "C",
        "title": roast.get("bean_name") or f"Roast #{roast.get('id')}",
        "beans": " / ".join(part for part in (roast.get("bean_name"), roast.get("origin")) if part),
        "roastertype": "Raspberry Pi roaster",
        "roastdate": started.strftime("%Y-%m-%d"),
        "roastisodate": started.strftime("%Y-%m-%d"),
        "roasttime": started.strftime("%H:%M:%S"),
        "roastepoch": int(started.replace(tzinfo=timezone.utc).timestamp()),
        "roastbatchnr": 0,
        "roastbatchprefix": roast.get("batch_label") or "",
        "weight": [float(roast.get("weight_grams") or 0), float(roast.get("roasted_weight_grams") or 0), "g"],
        "moisture_greens": float(roast.get("green_moisture_percent") or 0),
        "ambientTemp": float(roast.get("ambient_temp_c") or 0),
        "roastingnotes": roast.get("notes") or "",
        "cuppingnotes": roast.get("taste_notes") or "",
        "samplinginterval": float(current_app.config.get("SENSOR_INTERVAL_SECONDS", 2.0)),
        "timex": timex,
        "temp1": temp1,
        "temp2": temp2,
        "timeindex": timeindex,
        "etypes": ["Air", "Drum", "Damper", "Burner"],
        "specialevents": [index for index, _ in special],
        "specialeventstype": [_ARTISAN_BURNER_TYPE for _ in special],
        "specialeventsvalue": [round(flame / 10 + 1, 2) for _, flame in special],
        "specialeventsStrings": [f"{flame}%" for _, flame in special],
        "extradevices": [],
        "extratimex": [],
        "extratemp1": [],
        "extratemp2": [],
        "extraname1": [],
        "extraname2": [],
    }


@main.route("/api/roasts/<int:roast_id>/export", methods=["GET"])
def export_roast(roast_id):
    roast = get_roast_session(roast_id)
    if roast is None:
        current_app.logger.warning("Requested export for missing roast", extra={"roast_id": roast_id})
        abort(404)

    data = _export_entry(roast, include_photo=True)
    response = jsonify({"format": _EXPORT_FORMAT, "version": 1, "roast": data})
    response.headers["Content-Disposition"] = f'attachment; filename="{_export_filename(roast)}"'
    current_app.logger.info("Exported roast session", extra={"roast_id": roast_id, "has_photo": "photo_data" in data})
    return response


_BULK_EXPORT_FORMAT = "roaster-server-roasts"


@main.route("/api/roasts/export", methods=["GET"])
def export_all_roasts():
    """Download every saved roast as one portable document (a full backup).

    Roasts are listed oldest first so a re-import preserves their order.
    Photos are embedded as base64 by default; pass ?photos=0 to leave them
    out, which keeps a large library small enough to re-import in a single
    request under MAX_CONTENT_LENGTH.
    """
    include_photos = request.args.get("photos", "1").strip().lower() not in ("0", "false", "no")

    roasts = []
    for summary in sorted(list_roast_sessions(limit=None), key=lambda row: row["id"]):
        roast = get_roast_session(summary["id"])
        if roast is not None:
            roasts.append(_export_entry(roast, include_photo=include_photos))

    response = jsonify(
        {
            "format": _BULK_EXPORT_FORMAT,
            "version": 1,
            "exported_at": _utc_now_iso(),
            "count": len(roasts),
            "roasts": roasts,
        }
    )
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M")
    response.headers["Content-Disposition"] = f'attachment; filename="roaster-backup-{stamp}.json"'
    current_app.logger.info("Exported all roast sessions", extra={"count": len(roasts), "photos": include_photos})
    return response


def _export_entry(roast, include_photo=True):
    data = {field: roast.get(field) for field in _EXPORT_FIELDS}
    if include_photo:
        photo_data = _photo_as_data_url(roast)
        if photo_data:
            data["photo_data"] = photo_data
    return data


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

    # All-or-nothing: write every photo first, then insert every row in one
    # transaction. Any failure removes the photos already written.
    photo_filenames = []
    try:
        for roast_payload, photo_data in normalized:
            photo_filename = _save_photo_to_disk(photo_data)
            roast_payload["photo_filename"] = photo_filename
            if photo_filename:
                photo_filenames.append(photo_filename)
            if not roast_payload.get("created_at"):
                roast_payload["created_at"] = _utc_now_iso()

        imported = save_roast_sessions([roast_payload for roast_payload, _ in normalized])
    except PhotoSaveError:
        _delete_photo_files(photo_filenames)
        return jsonify({"error": "Could not save an imported photo. Nothing was imported."}), 500
    except Exception:
        current_app.logger.exception("Import failed while saving roasts")
        _delete_photo_files(photo_filenames)
        return jsonify({"error": "Could not save the imported roasts. Nothing was imported."}), 500

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


def _export_filename(roast, extension="json"):
    slug = re.sub(r'[^\w\-]+', '-', (roast.get("bean_name") or "roast")).strip("-").lower() or "roast"
    return f"roast-{roast['id']}-{slug}.{extension}"


def _require_wifi_setup_mode():
    if not wifi_service.is_setup_mode_enabled(current_app):
        abort(404)


def _delete_photo_files(filenames):
    upload_folder = current_app.config.get("UPLOAD_FOLDER", "")
    if not upload_folder:
        return
    for filename in filenames:
        if not filename:
            continue
        try:
            Path(upload_folder, filename).unlink(missing_ok=True)
        except OSError:
            current_app.logger.warning("Failed to delete photo file", extra={"photo_filename": filename})


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
    health["safety"] = sockets_module.safety_settings()
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


@main.route("/api/sensor/calibration", methods=["POST"])
def set_sensor_calibration():
    if sockets_module.sensor_service is None:
        return jsonify({"error": "Sensor service is not ready yet."}), 503

    payload = request.get_json(silent=True) or {}
    try:
        min_pw = int(payload["servo_min_pulsewidth"])
        max_pw = int(payload["servo_max_pulsewidth"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Min and max pulse widths must be whole numbers in µs."}), 400

    if not (400 <= min_pw <= 3000) or not (400 <= max_pw <= 3000):
        return jsonify({"error": "Pulse widths must be between 400 and 3000 µs."}), 400
    if max_pw - min_pw < 100:
        return jsonify({"error": "Max must be at least 100 µs above min."}), 400

    result = sockets_module.sensor_service.set_servo_calibration(min_pw, max_pw)
    save_calibration(current_app, min_pw, max_pw)
    current_app.logger.info("Saved servo calibration", extra={"min": min_pw, "max": max_pw})
    return jsonify(result)
