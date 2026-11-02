from app.services import wifi_service


def test_pages_render(client):
    for path in ["/", "/roast", "/lookup", "/roast/session?bean_name=Test&origin=Kenya&weight_grams=350", "/roast/review", "/settings"]:
        response = client.get(path)
        assert response.status_code == 200


def test_roast_session_page_passes_reference_roast_id(client):
    response = client.get("/roast/session?bean_name=Test&origin=Kenya&weight_grams=350&reference_id=7")
    assert response.status_code == 200
    assert b'data-reference-id="7"' in response.data

    # Anything that is not a positive integer is dropped rather than echoed.
    for bad in ("abc", "-3", "0", "1.5"):
        response = client.get(f"/roast/session?bean_name=Test&origin=Kenya&reference_id={bad}")
        assert response.status_code == 200
        assert b'data-reference-id=""' in response.data


def test_lookup_edit_page_renders_for_saved_roast(client):
    create_response = client.post(
        "/api/roasts",
        json={
            "bean_name": "Edit Roast",
            "origin": "Ethiopia",
            "roast_level": "Light",
            "started_at": "2026-04-15T11:00:00Z",
            "ended_at": "2026-04-15T11:11:00Z",
            "curve": [],
        },
    )
    roast = create_response.get_json()

    response = client.get(f"/lookup/{roast['id']}/edit")
    assert response.status_code == 200


def test_sensor_health_endpoint(client):
    response = client.get("/api/sensor/health")
    assert response.status_code == 200
    health = response.get_json()
    assert health["temperature_ok"] is True
    assert health["servo_ok"] is True


def test_create_and_fetch_roast(client):
    create_response = client.post(
        "/api/roasts",
        json={
            "bean_name": "Test Roast",
            "origin": "Costa Rica",
            "roast_level": "Medium",
            "weight_grams": 350.5,
            "flame_level": 60,
            "total_roast_seconds": 600,
            "started_at": "2026-04-15T12:00:00Z",
            "ended_at": "2026-04-15T12:10:00Z",
            "notes": "Verification roast",
            "events": [{
                "label": "Start",
                "detail": "Started",
                "time": "2026-04-15T12:00:00Z",
                "chart_label": "12:00:05",
                "color": "#b4542b",
                "temperature": 201.2,
                "flame_level": 50,
            }],
            "photo_data": (
                "data:image/png;base64,"
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8"
                "/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg=="
            ),
            "curve": [
                {
                    "timestamp": "12:00:05",
                    "temperature": 201.2,
                    "flame_level": 50,
                }
            ],
        },
    )

    assert create_response.status_code == 201
    roast = create_response.get_json()
    assert roast["bean_name"] == "Test Roast"

    detail_response = client.get(f"/api/roasts/{roast['id']}")
    assert detail_response.status_code == 200
    detail = detail_response.get_json()
    assert len(detail["curve"]) == 1
    assert detail["curve"][0]["temperature"] == 201.2
    assert detail["curve"][0]["flame_level"] == 50
    assert detail["events"][0]["label"] == "Start"
    assert detail["events"][0]["chart_label"] == "12:00:05"
    assert detail["events"][0]["flame_level"] == 50
    assert detail["photo_url"].startswith("/uploads/")
    assert detail["photo_data"] == ""
    assert detail["weight_grams"] == 350.5
    assert detail["flame_level"] == 60
    assert detail["total_roast_seconds"] == 600
    assert detail["rating"] is None
    assert detail["taste_notes"] == ""


def test_roast_summary_endpoint(client):
    client.post(
        "/api/roasts",
        json={
            "bean_name": "Summary Roast",
            "origin": "Kenya",
            "roast_level": "Light",
            "weight_grams": 250,
            "total_roast_seconds": 540,
            "started_at": "2026-04-15T14:00:00Z",
            "ended_at": "2026-04-15T14:09:00Z",
            "notes": "Summary verification",
            "curve": [
                {
                    "timestamp": "14:00:05",
                    "temperature": 198.4,
                }
            ],
        },
    )

    summary_response = client.get("/api/roasts/summary")
    assert summary_response.status_code == 200
    summary = summary_response.get_json()
    assert summary["roast_count"] >= 1
    assert "levels" in summary


def test_create_roast_validation(client):
    response = client.post("/api/roasts", json={"bean_name": "Incomplete"})
    assert response.status_code == 400
    assert "Missing fields" in response.get_json()["error"]


def test_create_roast_rejects_invalid_weight(client):
    response = client.post(
        "/api/roasts",
        json={
            "bean_name": "Bad Weight",
            "origin": "Kenya",
            "roast_level": "Medium",
            "weight_grams": "heavy",
            "started_at": "2026-04-15T12:00:00Z",
            "ended_at": "2026-04-15T12:10:00Z",
        },
    )

    assert response.status_code == 400
    assert response.get_json()["error"] == "Weight must be a valid number in grams."


def test_create_roast_rejects_invalid_flame_level(client):
    response = client.post(
        "/api/roasts",
        json={
            "bean_name": "Bad Flame",
            "origin": "Kenya",
            "roast_level": "Medium",
            "flame_level": 120,
            "started_at": "2026-04-15T12:00:00Z",
            "ended_at": "2026-04-15T12:10:00Z",
        },
    )

    assert response.status_code == 400
    assert response.get_json()["error"] == "Flame level must be between 0 and 100."


def test_update_roast_feedback(client):
    create_response = client.post(
        "/api/roasts",
        json={
            "bean_name": "Tasting Roast",
            "origin": "Guatemala",
            "roast_level": "Medium",
            "started_at": "2026-04-15T13:00:00Z",
            "ended_at": "2026-04-15T13:12:00Z",
            "curve": [],
        },
    )
    roast = create_response.get_json()

    update_response = client.patch(
        f"/api/roasts/{roast['id']}",
        json={
            "bean_name": roast["bean_name"],
            "origin": roast["origin"],
            "roast_level": roast["roast_level"],
            "weight_grams": roast["weight_grams"],
            "notes": roast["notes"],
            "rating": 4,
            "taste_notes": "Sweet cup with cocoa, citrus, and a clean finish.",
        },
    )

    assert update_response.status_code == 200
    updated = update_response.get_json()
    assert updated["rating"] == 4
    assert updated["taste_notes"] == "Sweet cup with cocoa, citrus, and a clean finish."


def test_update_roast_properties(client):
    create_response = client.post(
        "/api/roasts",
        json={
            "bean_name": "Original Roast",
            "origin": "Guatemala",
            "roast_level": "Medium",
            "weight_grams": 320,
            "started_at": "2026-04-15T13:00:00Z",
            "ended_at": "2026-04-15T13:12:00Z",
            "notes": "Original note",
            "curve": [],
        },
    )
    roast = create_response.get_json()

    update_response = client.patch(
        f"/api/roasts/{roast['id']}",
        json={
            "bean_name": "Updated Roast",
            "origin": "Huehuetenango, Guatemala",
            "roast_level": "Light",
            "weight_grams": 333.3,
            "notes": "Adjusted airflow earlier and liked the result.",
            "rating": 5,
            "taste_notes": "Stone fruit, cocoa, and a syrupy finish.",
        },
    )

    assert update_response.status_code == 200
    updated = update_response.get_json()
    assert updated["bean_name"] == "Updated Roast"
    assert updated["origin"] == "Huehuetenango, Guatemala"
    assert updated["roast_level"] == "Light"
    assert updated["weight_grams"] == 333.3
    assert updated["notes"] == "Adjusted airflow earlier and liked the result."
    assert updated["rating"] == 5
    assert updated["taste_notes"] == "Stone fruit, cocoa, and a syrupy finish."


def test_update_roast_properties_rejects_missing_required_fields(client):
    create_response = client.post(
        "/api/roasts",
        json={
            "bean_name": "Editable Roast",
            "origin": "Kenya",
            "roast_level": "Medium",
            "started_at": "2026-04-15T15:00:00Z",
            "ended_at": "2026-04-15T15:10:00Z",
            "curve": [],
        },
    )
    roast = create_response.get_json()

    response = client.patch(
        f"/api/roasts/{roast['id']}",
        json={
            "bean_name": "",
            "origin": "Kenya",
            "roast_level": "Medium",
            "notes": "Still should fail without bean name.",
        },
    )

    assert response.status_code == 400
    assert response.get_json()["error"] == "Bean name, origin, and roast level are required."


def test_delete_roast(client):
    create_response = client.post(
        "/api/roasts",
        json={
            "bean_name": "Delete Me",
            "origin": "Kenya",
            "roast_level": "Medium",
            "started_at": "2026-04-15T16:00:00Z",
            "ended_at": "2026-04-15T16:11:00Z",
            "curve": [],
        },
    )
    roast = create_response.get_json()

    delete_response = client.delete(f"/api/roasts/{roast['id']}")
    assert delete_response.status_code == 200
    assert delete_response.get_json() == {"deleted": True, "roast_id": roast["id"]}

    detail_response = client.get(f"/api/roasts/{roast['id']}")
    assert detail_response.status_code == 404


def test_delete_missing_roast_returns_404(client):
    response = client.delete("/api/roasts/99999")
    assert response.status_code == 404


def test_wifi_setup_page_hidden_when_mode_disabled(client):
    response = client.get("/setup/wifi")
    assert response.status_code == 404


def test_wifi_setup_redirects_root_when_mode_enabled(client):
    client.application.config["WIFI_SETUP_MODE"] = True

    response = client.get("/")

    assert response.status_code == 302
    assert response.headers["Location"].endswith("/setup/wifi")


def test_wifi_setup_page_renders_when_mode_enabled(client):
    client.application.config["WIFI_SETUP_MODE"] = True

    response = client.get("/setup/wifi")

    assert response.status_code == 200
    assert b"Connect this roaster to your home Wi-Fi." in response.data


def test_wifi_setup_lists_networks(client, monkeypatch):
    client.application.config["WIFI_SETUP_MODE"] = True

    def fake_list_networks(app):
        assert app.config["WIFI_SETUP_MODE"] is True
        return [{"ssid": "HomeNet", "signal": 82, "security": "WPA2"}]

    monkeypatch.setattr(wifi_service, "list_networks", fake_list_networks)

    response = client.get("/api/setup/wifi/networks")

    assert response.status_code == 200
    assert response.get_json()["items"] == [{"ssid": "HomeNet", "signal": 82, "security": "WPA2"}]


def test_wifi_setup_rejects_missing_ssid(client):
    client.application.config["WIFI_SETUP_MODE"] = True

    response = client.post("/api/setup/wifi/connect", json={"password": "secret"})

    assert response.status_code == 400
    assert response.get_json()["error"] == "SSID is required."


def test_wifi_setup_connects_and_saves_network(client, monkeypatch):
    client.application.config["WIFI_SETUP_MODE"] = True
    calls = []

    def fake_connect_to_network(app, ssid, password="", hidden=False):
        calls.append(
            {
                "ssid": ssid,
                "password": password,
                "hidden": hidden,
                "wifi_interface": app.config["WIFI_INTERFACE"],
            }
        )

    monkeypatch.setattr(wifi_service, "connect_to_network", fake_connect_to_network)

    response = client.post(
        "/api/setup/wifi/connect",
        json={
            "ssid": "MyHomeWiFi",
            "password": "supersecret",
            "hidden": True,
        },
    )

    assert response.status_code == 200
    assert response.get_json()["connected"] is True
    assert calls == [
        {
            "ssid": "MyHomeWiFi",
            "password": "supersecret",
            "hidden": True,
            "wifi_interface": "wlan0",
        }
    ]


def test_wifi_setup_returns_error_when_connection_fails(client, monkeypatch):
    client.application.config["WIFI_SETUP_MODE"] = True

    def fake_connect_to_network(app, ssid, password="", hidden=False):
        raise wifi_service.WifiCommandError("Connection activation failed")

    monkeypatch.setattr(wifi_service, "connect_to_network", fake_connect_to_network)

    response = client.post(
        "/api/setup/wifi/connect",
        json={"ssid": "MyHomeWiFi", "password": "wrongpass"},
    )

    assert response.status_code == 400
    assert response.get_json()["error"] == "Connection activation failed"


def test_wifi_scan_parser_handles_escaped_colons():
    assert wifi_service._split_escaped_fields(r"Cafe\:Net:78:WPA2", expected_fields=3) == [
        "Cafe:Net",
        "78",
        "WPA2",
    ]


def test_get_missing_roast_returns_404(client):
    response = client.get("/api/roasts/99999")
    assert response.status_code == 404


def test_patch_missing_roast_returns_404(client):
    response = client.patch(
        "/api/roasts/99999",
        json={"bean_name": "Ghost", "origin": "Kenya", "roast_level": "Light"},
    )
    assert response.status_code == 404


def test_create_roast_malformed_body_returns_400(client):
    response = client.post(
        "/api/roasts",
        data="not json at all",
        content_type="application/json",
    )
    assert response.status_code == 400


def test_create_roast_rejects_photo_invalid_type(client):
    import base64
    bad_photo = "data:text/plain;base64," + base64.b64encode(b"hello world").decode()
    response = client.post(
        "/api/roasts",
        json={
            "bean_name": "Photo Type Test",
            "origin": "Kenya",
            "roast_level": "Light",
            "started_at": "2026-04-15T12:00:00Z",
            "ended_at": "2026-04-15T12:10:00Z",
            "photo_data": bad_photo,
        },
    )
    assert response.status_code == 400
    assert "Photo must be" in response.get_json()["error"]


def test_create_roast_rejects_photo_too_large(client):
    oversized = "data:image/png;base64," + "A" * 7_000_001
    response = client.post(
        "/api/roasts",
        json={
            "bean_name": "Big Photo Test",
            "origin": "Kenya",
            "roast_level": "Light",
            "started_at": "2026-04-15T12:00:00Z",
            "ended_at": "2026-04-15T12:10:00Z",
            "photo_data": oversized,
        },
    )
    assert response.status_code == 400
    assert "exceeds" in response.get_json()["error"]


def test_create_roast_with_valid_photo_saves_to_disk(client):
    from pathlib import Path

    # Minimal 1×1 pixel PNG base64
    tiny_png = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8"
        "/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg=="
    )
    response = client.post(
        "/api/roasts",
        json={
            "bean_name": "Photo Roast",
            "origin": "Kenya",
            "roast_level": "Light",
            "started_at": "2026-04-15T12:00:00Z",
            "ended_at": "2026-04-15T12:10:00Z",
            "curve": [],
            "photo_data": tiny_png,
        },
    )
    assert response.status_code == 201
    roast = response.get_json()
    assert roast["photo_url"].startswith("/uploads/")
    assert roast["photo_data"] == ""

    upload_folder = client.application.config["UPLOAD_FOLDER"]
    filename = roast["photo_url"].split("/")[-1]
    assert Path(upload_folder, filename).exists()


def test_delete_roast_removes_photo_file(client):
    from pathlib import Path

    tiny_png = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8"
        "/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg=="
    )
    create_response = client.post(
        "/api/roasts",
        json={
            "bean_name": "Doomed Photo Roast",
            "origin": "Kenya",
            "roast_level": "Light",
            "started_at": "2026-04-15T12:00:00Z",
            "ended_at": "2026-04-15T12:10:00Z",
            "curve": [],
            "photo_data": tiny_png,
        },
    )
    roast = create_response.get_json()
    filename = roast["photo_url"].split("/")[-1]
    upload_folder = client.application.config["UPLOAD_FOLDER"]
    photo_path = Path(upload_folder, filename)
    assert photo_path.exists()

    delete_response = client.delete(f"/api/roasts/{roast['id']}")
    assert delete_response.status_code == 200
    assert not photo_path.exists()


def test_update_roast_feedback_rejects_invalid_rating(client):
    create_response = client.post(
        "/api/roasts",
        json={
            "bean_name": "Bad Rating Roast",
            "origin": "Kenya",
            "roast_level": "Medium",
            "started_at": "2026-04-15T15:00:00Z",
            "ended_at": "2026-04-15T15:10:00Z",
            "curve": [],
        },
    )
    roast = create_response.get_json()

    response = client.patch(
        f"/api/roasts/{roast['id']}",
        json={
            "bean_name": roast["bean_name"],
            "origin": roast["origin"],
            "roast_level": roast["roast_level"],
            "weight_grams": roast["weight_grams"],
            "notes": roast["notes"],
            "rating": 7,
            "taste_notes": "Too high a rating payload.",
        },
    )

    assert response.status_code == 400
    assert "Rating must be between 1 and 5." == response.get_json()["error"]


def _sample_roast_payload(**overrides):
    payload = {
        "bean_name": "Export Roast",
        "origin": "Ethiopia",
        "roast_level": "Light",
        "weight_grams": 300,
        "flame_level": 55,
        "total_roast_seconds": 600,
        "started_at": "2026-04-15T12:00:00Z",
        "ended_at": "2026-04-15T12:10:00Z",
        "notes": "Export verification",
        "curve": [{"timestamp": "12:00:05", "temperature": 200.0, "flame_level": 55}],
        "events": [{
            "label": "First Crack",
            "detail": "Marked",
            "time": "2026-04-15T12:07:00Z",
            "chart_label": "12:07:00",
            "color": "#d4a246",
            "temperature": 196.0,
            "flame_level": 55,
        }],
    }
    payload.update(overrides)
    return payload


def _create_sample_roast(client, **overrides):
    response = client.post("/api/roasts", json=_sample_roast_payload(**overrides))
    assert response.status_code == 201
    return response.get_json()


def test_export_roast_returns_portable_payload(client):
    roast = _create_sample_roast(client)

    response = client.get(f"/api/roasts/{roast['id']}/export")
    assert response.status_code == 200
    assert "attachment" in response.headers.get("Content-Disposition", "")

    body = response.get_json()
    assert body["format"] == "roaster-server-roast"
    assert body["version"] == 1
    exported = body["roast"]
    assert exported["bean_name"] == "Export Roast"
    assert exported["origin"] == "Ethiopia"
    assert len(exported["curve"]) == 1
    assert len(exported["events"]) == 1
    # internal-only fields must not leak into the portable payload
    assert "id" not in exported
    assert "photo_filename" not in exported


def test_export_missing_roast_returns_404(client):
    response = client.get("/api/roasts/99999/export")
    assert response.status_code == 404


def test_export_then_import_round_trips(client):
    roast = _create_sample_roast(client, bean_name="Round Trip Roast")
    export_body = client.get(f"/api/roasts/{roast['id']}/export").get_json()

    import_response = client.post("/api/roasts/import", json=export_body)
    assert import_response.status_code == 201
    result = import_response.get_json()
    assert result["imported"] == 1

    imported = result["items"][0]
    assert imported["id"] != roast["id"]  # storage assigns a fresh id
    assert imported["bean_name"] == "Round Trip Roast"
    assert len(imported["curve"]) == 1
    assert len(imported["events"]) == 1


def test_import_accepts_bare_list_of_roasts(client):
    roast_a = client.get(f"/api/roasts/{_create_sample_roast(client, bean_name='A')['id']}/export").get_json()["roast"]
    roast_b = client.get(f"/api/roasts/{_create_sample_roast(client, bean_name='B')['id']}/export").get_json()["roast"]

    response = client.post("/api/roasts/import", json=[roast_a, roast_b])
    assert response.status_code == 201
    assert response.get_json()["imported"] == 2


def test_import_rejects_missing_required_fields(client):
    response = client.post("/api/roasts/import", json={"roast": {"bean_name": "Incomplete"}})
    assert response.status_code == 400
    assert "Missing fields" in response.get_json()["error"]


def test_import_rejects_empty_body(client):
    response = client.post("/api/roasts/import", json={})
    assert response.status_code == 400


def test_import_does_not_partially_save_on_invalid_entry(client):
    good = client.get(f"/api/roasts/{_create_sample_roast(client, bean_name='Good')['id']}/export").get_json()["roast"]
    before = len(client.get("/api/roasts?limit=all").get_json()["items"])

    response = client.post("/api/roasts/import", json=[good, {"bean_name": "Broken"}])
    assert response.status_code == 400

    after = len(client.get("/api/roasts?limit=all").get_json()["items"])
    assert after == before  # the valid entry must not be saved when a later entry fails


def test_captive_probe_returns_404_when_disabled(client):
    # Captive portal is off by default, so probes behave like any unknown path.
    response = client.get("/generate_204")
    assert response.status_code == 404


def test_captive_probe_redirects_to_dashboard_when_enabled(tmp_path):
    from app import create_app

    app = create_app(
        {
            "TESTING": True,
            "START_SENSOR_BACKGROUND_TASK": False,
            "SENSOR_MODE": "simulated",
            "SQLALCHEMY_DATABASE_URI": "sqlite:///test_roasts.db",
            "INSTANCE_PATH": str(tmp_path),
            "CAPTIVE_PORTAL_ENABLED": True,
        }
    )
    app.instance_path = str(tmp_path)
    client = app.test_client()

    for probe in ["/generate_204", "/hotspot-detect.html", "/ncsi.txt"]:
        response = client.get(probe)
        assert response.status_code == 302
        assert response.headers["Location"].endswith("/")


def test_pwa_manifest_served_and_valid(client):
    import json

    response = client.get("/static/manifest.webmanifest")
    assert response.status_code == 200
    manifest = json.loads(response.data)
    assert manifest["start_url"] == "/"
    assert manifest["display"] == "standalone"
    assert any(icon["sizes"] == "512x512" for icon in manifest["icons"])
    assert any("maskable" in icon.get("purpose", "") for icon in manifest["icons"])


def test_dashboard_links_pwa_metadata(client):
    body = client.get("/").get_data(as_text=True)
    assert 'rel="manifest"' in body
    assert 'name="theme-color"' in body
    assert "apple-touch-icon" in body


def test_service_worker_served_at_root_scope(client):
    response = client.get("/sw.js")
    assert response.status_code == 200
    assert "javascript" in response.headers["Content-Type"]
    assert response.headers.get("Service-Worker-Allowed") == "/"
    assert b"CACHE_VERSION" in response.data


def test_dashboard_registers_service_worker(client):
    body = client.get("/").get_data(as_text=True)
    assert "serviceWorker" in body
    assert "/sw.js" in body


def test_sensor_calibration_saves_and_applies(client):
    response = client.post(
        "/api/sensor/calibration",
        json={"servo_min_pulsewidth": 600, "servo_max_pulsewidth": 2400},
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body["servo_min_pulsewidth"] == 600
    assert body["servo_max_pulsewidth"] == 2400

    # It should be reflected in the health payload (the live sensor range).
    health = client.get("/api/sensor/health").get_json()
    assert health["servo_min_pulsewidth"] == 600
    assert health["servo_max_pulsewidth"] == 2400


def test_sensor_calibration_rejects_bad_range(client):
    # max not above min
    r1 = client.post("/api/sensor/calibration", json={"servo_min_pulsewidth": 2000, "servo_max_pulsewidth": 2000})
    assert r1.status_code == 400
    # out of bounds
    r2 = client.post("/api/sensor/calibration", json={"servo_min_pulsewidth": 100, "servo_max_pulsewidth": 5000})
    assert r2.status_code == 400
    # non-numeric
    r3 = client.post("/api/sensor/calibration", json={"servo_min_pulsewidth": "x", "servo_max_pulsewidth": 2000})
    assert r3.status_code == 400


def _non_test_app_config(tmp_path, secret_key):
    return {
        "TESTING": False,
        "SECRET_KEY": secret_key,
        "START_SENSOR_BACKGROUND_TASK": False,
        "SENSOR_MODE": "simulated",
        "SQLALCHEMY_DATABASE_URI": "sqlite:///guard_test.db",
        "INSTANCE_PATH": str(tmp_path),
    }


def test_create_app_rejects_default_secret_key(tmp_path):
    import pytest
    from app import create_app

    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        create_app(_non_test_app_config(tmp_path, "devkey"))


def test_create_app_rejects_example_env_secret_key(tmp_path):
    import pytest
    from app import create_app

    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        create_app(_non_test_app_config(tmp_path, "change-me"))


def test_create_app_rejects_empty_secret_key(tmp_path):
    import pytest
    from app import create_app

    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        create_app(_non_test_app_config(tmp_path, ""))


def test_create_app_accepts_real_secret_key(tmp_path):
    from app import create_app

    app = create_app(_non_test_app_config(tmp_path, "f" * 64))
    assert app.config["SECRET_KEY"] == "f" * 64


_TINY_PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


def test_get_roasts_validates_limit(client):
    _create_sample_roast(client, bean_name="Limit A")
    _create_sample_roast(client, bean_name="Limit B")

    for bad in ("abc", "0", "-3", "1.5", ""):
        response = client.get(f"/api/roasts?limit={bad}")
        assert response.status_code == 400, bad
        assert "limit" in response.get_json()["error"]

    assert len(client.get("/api/roasts?limit=1").get_json()["items"]) == 1
    assert len(client.get("/api/roasts?limit=all").get_json()["items"]) >= 2


def test_create_roast_rejects_malformed_curve_events_notes_and_rating(client):
    cases = {
        "curve not a list": {"curve": "abc"},
        "curve point not an object": {"curve": [1, 2]},
        "curve temperature not numeric": {"curve": [{"timestamp": "12:00:05", "temperature": "hot"}]},
        "curve temperature null": {"curve": [{"timestamp": "12:00:05", "temperature": None}]},
        "curve temperature boolean": {"curve": [{"timestamp": "12:00:05", "temperature": True}]},
        "curve point missing timestamp": {"curve": [{"temperature": 200.0}]},
        "events not a list": {"events": {"label": "First Crack"}},
        "event not an object": {"events": ["First Crack"]},
        "event without label": {"events": [{"detail": "no label"}]},
        "event detail not text": {"events": [{"label": "First Crack", "detail": 5}]},
        "notes not text": {"notes": 123},
        "taste notes not text": {"taste_notes": ["fruity"]},
        "rating out of range": {"rating": 9},
        "rating not a number": {"rating": "great"},
    }
    before = len(client.get("/api/roasts?limit=all").get_json()["items"])

    for case, overrides in cases.items():
        response = client.post("/api/roasts", json=_sample_roast_payload(**overrides))
        assert response.status_code == 400, case
        assert response.get_json()["error"], case

    assert len(client.get("/api/roasts?limit=all").get_json()["items"]) == before


def test_create_roast_coerces_numeric_strings_and_nullable_fields(client):
    roast = _create_sample_roast(
        client,
        curve=[{"timestamp": " 12:00:05 ", "temperature": "190.5", "flame_level": 55}],
        events=[{"label": " First Crack ", "detail": None, "time": "2026-04-15T12:07:00Z"}],
        notes=None,
        taste_notes=None,
        rating="4",
    )

    assert roast["curve"][0]["temperature"] == 190.5
    assert roast["curve"][0]["timestamp"] == "12:00:05"
    assert roast["events"][0]["label"] == "First Crack"
    assert roast["events"][0]["detail"] == ""
    assert roast["notes"] == ""
    assert roast["taste_notes"] == ""
    assert roast["rating"] == 4
    assert roast["sample_count"] == 1


def test_import_rejects_bad_curve_in_later_entry_without_saving(client):
    good = client.get(f"/api/roasts/{_create_sample_roast(client, bean_name='Good Curve')['id']}/export").get_json()["roast"]
    before = len(client.get("/api/roasts?limit=all").get_json()["items"])
    bad = dict(good, bean_name="Bad Curve", curve=[{"timestamp": "12:00:05", "temperature": "hot"}])

    response = client.post("/api/roasts/import", json=[good, bad])

    assert response.status_code == 400
    assert "Curve point 1" in response.get_json()["error"]
    assert len(client.get("/api/roasts?limit=all").get_json()["items"]) == before


def test_import_photo_failure_saves_nothing_and_removes_written_photos(client, app, monkeypatch):
    from pathlib import Path

    from app.web import routes as routes_module

    before = len(client.get("/api/roasts?limit=all").get_json()["items"])
    original_save = routes_module._save_photo_to_disk
    written = []

    def flaky_save(photo_data):
        if written:
            raise routes_module.PhotoSaveError("disk full")
        filename = original_save(photo_data)
        written.append(filename)
        return filename

    monkeypatch.setattr(routes_module, "_save_photo_to_disk", flaky_save)

    response = client.post(
        "/api/roasts/import",
        json=[
            _sample_roast_payload(bean_name="Photo A", photo_data=_TINY_PNG_DATA_URL),
            _sample_roast_payload(bean_name="Photo B", photo_data=_TINY_PNG_DATA_URL),
        ],
    )

    assert response.status_code == 500
    assert "Nothing was imported" in response.get_json()["error"]
    assert len(client.get("/api/roasts?limit=all").get_json()["items"]) == before
    assert written and written[0]
    assert not (Path(app.config["UPLOAD_FOLDER"]) / written[0]).exists()


def test_import_db_failure_saves_nothing_and_removes_written_photos(client, app, monkeypatch):
    from pathlib import Path

    from app.web import routes as routes_module

    upload_folder = Path(app.config["UPLOAD_FOLDER"])
    files_before = set(upload_folder.iterdir())
    roasts_before = len(client.get("/api/roasts?limit=all").get_json()["items"])

    def failing_save(payloads):
        raise RuntimeError("database is locked")

    monkeypatch.setattr(routes_module, "save_roast_sessions", failing_save)

    response = client.post(
        "/api/roasts/import",
        json=[_sample_roast_payload(bean_name="Photo C", photo_data=_TINY_PNG_DATA_URL)],
    )

    assert response.status_code == 500
    assert len(client.get("/api/roasts?limit=all").get_json()["items"]) == roasts_before
    assert set(upload_folder.iterdir()) == files_before


def test_save_roast_sessions_rolls_back_every_row_on_failure(app):
    import sqlite3

    import pytest

    from app.services import roast_storage

    with app.app_context():
        before = len(roast_storage.list_roast_sessions(limit=None))
        good = _sample_roast_payload(bean_name="Atomic", created_at="2026-04-15T12:11:00Z")
        bad = dict(good, bean_name="Atomic Bad", started_at=None)  # violates NOT NULL on insert

        with pytest.raises(sqlite3.IntegrityError):
            roast_storage.save_roast_sessions([good, bad])

        assert len(roast_storage.list_roast_sessions(limit=None)) == before
