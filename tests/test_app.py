def test_pages_render(client):
    for path in ["/", "/roast", "/lookup", "/roast/session?bean_name=Test&origin=Kenya&weight_grams=350", "/roast/review"]:
        response = client.get(path)
        assert response.status_code == 200


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
                "speed": 50,
            }],
            "photo_data": "data:image/png;base64,abc123",
            "curve": [
                {
                    "timestamp": "12:00:05",
                    "temperature": 201.2,
                    "speed": 50,
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
    assert detail["events"][0]["label"] == "Start"
    assert detail["events"][0]["chart_label"] == "12:00:05"
    assert detail["photo_data"] == "data:image/png;base64,abc123"
    assert detail["weight_grams"] == 350.5
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
