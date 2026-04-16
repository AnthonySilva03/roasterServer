from flask_socketio import emit

from . import socketio
from .services.sensor_service import SensorService


sensor_service = None
latest_sample = None
background_started = False
sensor_interval_seconds = 2.0


def register_socket_handlers(app):
    global sensor_interval_seconds, sensor_service

    sensor_interval_seconds = app.config["SENSOR_INTERVAL_SECONDS"]

    if sensor_service is None:
        sensor_service = SensorService(
            interval_seconds=sensor_interval_seconds,
            sensor_mode=app.config["SENSOR_MODE"],
            max6675_cs_pin=app.config["MAX6675_CS_PIN"],
            max6675_clk_pin=app.config["MAX6675_CLK_PIN"],
            max6675_do_pin=app.config["MAX6675_DO_PIN"],
            servo_control_pin=app.config["SERVO_CONTROL_PIN"],
            servo_min_pulsewidth=app.config["SERVO_MIN_PULSEWIDTH"],
            servo_max_pulsewidth=app.config["SERVO_MAX_PULSEWIDTH"],
        )

    if app.config.get("START_SENSOR_BACKGROUND_TASK", True):
        _ensure_background_task()


def _ensure_background_task():
    global background_started

    if not background_started:
        background_started = True
        socketio.start_background_task(_sensor_loop)


def _sensor_loop():
    global latest_sample

    while True:
        if sensor_service and sensor_service.active:
            latest_sample = sensor_service.read_sample()
            socketio.emit("sensor_data", latest_sample)

        socketio.sleep(sensor_interval_seconds)


@socketio.on("connect")
def handle_connect():
    emit(
        "sensor_state",
        {
            "active": sensor_service.active if sensor_service else False,
            "source": sensor_service.source_name if sensor_service else "unknown",
            "speed": sensor_service.health_status()["speed"] if sensor_service else 0,
        },
    )
    if latest_sample:
        emit("sensor_data", latest_sample)


@socketio.on("control")
def handle_control(data):
    global latest_sample

    if sensor_service is None:
        emit("control_response", {"message": "Sensor service is not ready yet."})
        return

    command = (data or {}).get("command")

    if command == "start":
        sensor_service.start()
        message = "Sensor stream started."
    elif command == "stop":
        sensor_service.stop()
        message = "Sensor stream paused."
    elif command == "reset":
        sensor_service.reset()
        latest_sample = None
        message = "Sensor values reset."
    elif command == "set_speed":
        speed = (data or {}).get("speed", 50)
        result = sensor_service.set_speed(speed)
        message = f"Speed controller set to {result['speed']}%."
    else:
        message = "Unknown command."

    emit("control_response", {"message": message})
    socketio.emit(
        "sensor_state",
        {
            "active": sensor_service.active,
            "source": sensor_service.source_name,
            "speed": sensor_service.health_status()["speed"],
        },
    )
