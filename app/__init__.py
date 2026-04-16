from flask import Flask
from flask_socketio import SocketIO

socketio = SocketIO(async_mode="eventlet")


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

    socketio.init_app(
        app,
        cors_allowed_origins=app.config["SOCKET_CORS_ALLOWED_ORIGINS"],
    )

    from .web.routes import main
    app.register_blueprint(main)

    from .sockets import register_socket_handlers
    register_socket_handlers(app)

    from .services.roast_storage import init_db

    with app.app_context():
        init_db(app)

    return app
