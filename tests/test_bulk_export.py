_TINY_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


def _create(client, bean_name, **overrides):
    payload = {
        "bean_name": bean_name,
        "origin": "Ethiopia",
        "roast_level": "Light",
        "started_at": "2026-04-15T12:00:00Z",
        "ended_at": "2026-04-15T12:10:00Z",
        "notes": "backup test",
        "curve": [{"timestamp": "12:00:05", "temperature": 200.0, "flame_level": 55}],
        "events": [{"label": "First Crack", "detail": "Marked", "time": "2026-04-15T12:07:00Z"}],
    }
    payload.update(overrides)
    response = client.post("/api/roasts", json=payload)
    assert response.status_code == 201
    return response.get_json()


def test_export_all_returns_every_roast_oldest_first_with_photos(client):
    _create(client, "Alpha")
    _create(client, "Beta", photo_data=_TINY_PNG)

    response = client.get("/api/roasts/export")

    assert response.status_code == 200
    assert response.headers["Content-Disposition"].startswith('attachment; filename="roaster-backup-')
    doc = response.get_json()
    assert doc["format"] == "roaster-server-roasts"
    assert doc["version"] == 1
    assert doc["count"] == 2
    assert doc["exported_at"].endswith("Z")
    assert [roast["bean_name"] for roast in doc["roasts"]] == ["Alpha", "Beta"]
    assert "id" not in doc["roasts"][0]
    assert doc["roasts"][0]["curve"][0]["temperature"] == 200.0
    assert "photo_data" not in doc["roasts"][0]
    assert doc["roasts"][1]["photo_data"].startswith("data:image/png;base64,")


def test_export_all_can_omit_photos(client):
    _create(client, "With Photo", photo_data=_TINY_PNG)

    doc = client.get("/api/roasts/export?photos=0").get_json()

    assert doc["count"] == 1
    assert "photo_data" not in doc["roasts"][0]


def test_export_all_round_trips_through_import(client):
    _create(client, "Alpha")
    _create(client, "Beta", photo_data=_TINY_PNG)
    doc = client.get("/api/roasts/export").get_json()

    response = client.post("/api/roasts/import", json=doc)

    assert response.status_code == 201
    assert response.get_json()["imported"] == 2
    items = client.get("/api/roasts?limit=all").get_json()["items"]
    assert len(items) == 4
    assert sorted(item["bean_name"] for item in items) == ["Alpha", "Alpha", "Beta", "Beta"]
    restored_beta = next(item for item in items if item["bean_name"] == "Beta" and item["id"] > 2)
    assert restored_beta["photo_url"]


def test_export_all_with_no_roasts_is_an_empty_document(client):
    doc = client.get("/api/roasts/export").get_json()

    assert doc["count"] == 0
    assert doc["roasts"] == []


def test_single_roast_export_unchanged(client):
    roast = _create(client, "Solo", photo_data=_TINY_PNG)

    doc = client.get(f"/api/roasts/{roast['id']}/export").get_json()

    assert doc["format"] == "roaster-server-roast"
    assert doc["roast"]["bean_name"] == "Solo"
    assert doc["roast"]["photo_data"].startswith("data:image/png;base64,")
