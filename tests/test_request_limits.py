from app import create_app


def _app(tmp_path, **overrides):
    config = {
        "TESTING": True,
        "START_SENSOR_BACKGROUND_TASK": False,
        "SENSOR_MODE": "simulated",
        "SQLALCHEMY_DATABASE_URI": "sqlite:///limits_test.db",
        "INSTANCE_PATH": str(tmp_path),
    }
    config.update(overrides)
    return create_app(config)


def _roast(notes):
    return {
        "bean_name": "Big",
        "origin": "Kenya",
        "roast_level": "Light",
        "started_at": "2026-04-15T12:00:00Z",
        "ended_at": "2026-04-15T12:10:00Z",
        "notes": notes,
        "curve": [{"timestamp": "12:00:05", "temperature": 200.0}],
    }


def test_default_body_limit_is_32_mb(tmp_path):
    app = _app(tmp_path)
    assert app.config["MAX_CONTENT_LENGTH"] == 32 * 1024 * 1024


def test_oversized_body_gets_json_413(tmp_path):
    client = _app(tmp_path, MAX_CONTENT_LENGTH=2000).test_client()

    response = client.post("/api/roasts", json=_roast("x" * 5000))

    assert response.status_code == 413
    assert response.is_json
    assert "too large" in response.get_json()["error"]
    assert client.get("/api/roasts?limit=all").get_json()["items"] == []


def test_body_under_limit_is_accepted(tmp_path):
    client = _app(tmp_path, MAX_CONTENT_LENGTH=20000).test_client()

    response = client.post("/api/roasts", json=_roast("x" * 500))

    assert response.status_code == 201
