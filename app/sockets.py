import logging

from flask_socketio import emit

from . import socketio
from .services.sensor_service import SensorService


logger = logging.getLogger("roasterServer.sockets")
sensor_service = None
latest_sample = None
background_started = False
sensor_interval_seconds = 2
sensor_log_every_n = 10
sample_counter = 0


def register_socket_handlers(app):
    global sensor_interval_seconds, sensor_service, sensor_log_every_n

    sensor_interval_seconds = app.config["SENSOR_INTERVAL_SECONDS"]
    sensor_log_every_n = max(1, int(app.config.get("SENSOR_LOG_EVERY_N", 10)))

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
        logger.info(
            "Sensor service initialized mode=%s interval=%.2fs flame_level=%s",
            app.config["SENSOR_MODE"],
            sensor_interval_seconds,
            sensor_service.health_status()["flame_level"],
        )

    if app.config.get("START_SENSOR_BACKGROUND_TASK", True):
        _ensure_background_task()


def _ensure_background_task():
    global background_started

    if not background_started:
        background_started = True
        logger.info("Starting sensor background task")
        socketio.start_background_task(_sensor_loop)


def _sensor_loop():
    global latest_sample, sample_counter

    while True:
        if sensor_service and sensor_service.active:
            latest_sample = sensor_service.read_sample()
            sample_counter += 1
            if sample_counter == 1 or sample_counter % sensor_log_every_n == 0:
                logger.info(
                    "Sensor sample #%s temperature=%s source=%s flame_level=%s",
                    sample_counter,
                    latest_sample["temperature"],
                    latest_sample["source"],
                    latest_sample["flame_level"],
                )
            socketio.emit("sensor_data", latest_sample)

        socketio.sleep(sensor_interval_seconds)


@socketio.on("connect")
def handle_connect():
    logger.info(
        "Socket client connected active=%s source=%s",
        sensor_service.active if sensor_service else False,
        sensor_service.source_name if sensor_service else "unknown",
    )
    source = sensor_service.source_name if sensor_service else "unknown"
    emit(
        "sensor_state",
        {
            "active": sensor_service.active if sensor_service else False,
            "source": source,
            "flame_level": sensor_service.health_status()["flame_level"] if sensor_service else 0,
            "simulated": source == "simulated",
        },
    )
    if latest_sample:
        emit("sensor_data", latest_sample)


@socketio.on("control")
def handle_control(data):
    global latest_sample, sample_counter

    if sensor_service is None:
        logger.warning("Socket control received before sensor service initialization")
        emit("control_response", {"message": "Sensor service is not ready yet."})
        return

    command = (data or {}).get("command")
    logger.info("Received socket control command=%s payload=%s", command, data)

    if command == "start":
        sensor_service.start()
        message = "Sensor stream started."
    elif command == "stop":
        sensor_service.stop()
        message = "Sensor stream paused."
    elif command == "reset":
        sensor_service.reset()
        latest_sample = None
        sample_counter = 0
        message = "Sensor values reset."
    elif command == "set_flame_level":
        flame_level = (data or {}).get("flame_level", 50)
        result = sensor_service.set_flame_level(flame_level)
        message = f"Flame controller set to {result['flame_level']}%."
    else:
        message = "Unknown command."
        logger.warning("Unknown socket control command=%s", command)

    logger.info("Socket control result command=%s message=%s", command, message)
    emit("control_response", {"message": message})
    socketio.emit(
        "sensor_state",
        {
            "active": sensor_service.active,
            "source": sensor_service.source_name,
            "flame_level": sensor_service.health_status()["flame_level"],
            "simulated": sensor_service.source_name == "simulated",
        },
    )
