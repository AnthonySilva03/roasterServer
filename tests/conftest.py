from pathlib import Path

import pytest

from app import create_app


@pytest.fixture()
def app(tmp_path: Path):
    app = create_app(
        {
            "TESTING": True,
            "START_SENSOR_BACKGROUND_TASK": False,
            "SENSOR_MODE": "simulated",
            "SQLALCHEMY_DATABASE_URI": "sqlite:///test_roasts.db",
            "INSTANCE_PATH": str(tmp_path),
        }
    )
    app.instance_path = str(tmp_path)
    return app


@pytest.fixture()
def client(app):
    return app.test_client()
