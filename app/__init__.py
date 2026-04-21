import logging
from pathlib import Path

from flask import Flask
from flask_socketio import SocketIO

socketio = SocketIO(async_mode="eventlet")


def _configure_logging(app):
    level_name = app.config.get("LOG_LEVEL", "INFO")
    level = getattr(logging, str(level_name).upper(), logging.INFO)

    if not logging.getLogger().handlers:
        logging.basicConfig(
            level=level,
            format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        )
    else:
        logging.getLogger().setLevel(level)

    app.logger.setLevel(level)
    app.logger.info(
        "App logging configured",
        extra={
            "log_level": level_name,
        },
    )


def create_app(test_config=None):
    instance_path = None
    if test_config and test_config.get("INSTANCE_PATH"):
        instance_path = test_config["INSTANCE_PATH"]

    app = Flask(
        __name__,
        instance_relative_config=True,
        instance_path=instance_path,
    )
    app.config.from_object("config.Config")
    if test_config:
        app.config.update(test_config)

    _configure_logging(app)

    socketio.init_app(
        app,
        cors_allowed_origins=app.config["SOCKET_CORS_ALLOWED_ORIGINS"],
    )

    from .web.routes import main
    app.register_blueprint(main)

    from .sockets import register_socket_handlers
    register_socket_handlers(app)

    if not app.testing and app.config.get("SECRET_KEY") == "devkey":
        raise RuntimeError(
            "SECRET_KEY is set to the insecure default 'devkey'. "
            "Set the SECRET_KEY environment variable to a strong random value."
        )

    from .services.roast_storage import init_db

    with app.app_context():
        init_db(app)
        upload_folder = Path(app.instance_path) / "uploads"
        upload_folder.mkdir(parents=True, exist_ok=True)
        app.config["UPLOAD_FOLDER"] = str(upload_folder)

    app.logger.info(
        "App created",
        extra={
            "sensor_mode": app.config["SENSOR_MODE"],
            "sensor_interval_seconds": app.config["SENSOR_INTERVAL_SECONDS"],
            "database_uri": app.config["SQLALCHEMY_DATABASE_URI"],
            "background_sensor_task": app.config.get("START_SENSOR_BACKGROUND_TASK", True),
        },
    )

    return app
