import logging

from flask_socketio import emit

from . import socketio
from .services.sensor_service import SensorService
from .services.calibration import load_calibration


logger = logging.getLogger("roasterServer.sockets")
sensor_service = None
latest_sample = None
background_started = False
sensor_interval_seconds = 2
sensor_log_every_n = 10
sample_counter = 0
consecutive_read_failures = 0

# Safety limits (see config.py). The flame is cut to 0% once the bean probe
# reads max_bean_temp_c or hotter, and optionally after a run of faulty reads.
max_bean_temp_c = 0.0
sensor_fault_flame_policy = "hold"
sensor_fault_flame_after = 5
over_temperature_active = False
_OVER_TEMP_REARM_MARGIN_C = 5.0


def register_socket_handlers(app):
    global sensor_interval_seconds, sensor_service, sensor_log_every_n
    global max_bean_temp_c, sensor_fault_flame_policy, sensor_fault_flame_after

    sensor_interval_seconds = app.config["SENSOR_INTERVAL_SECONDS"]
    sensor_log_every_n = max(1, int(app.config.get("SENSOR_LOG_EVERY_N", 10)))
    max_bean_temp_c = float(app.config.get("MAX_BEAN_TEMP_C", 0) or 0)
    sensor_fault_flame_policy = str(app.config.get("SENSOR_FAULT_FLAME_POLICY", "hold") or "hold").lower()
    sensor_fault_flame_after = max(1, int(app.config.get("SENSOR_FAULT_FLAME_AFTER", 5) or 5))

    if sensor_service is None:
        # Saved calibration overrides the env pulse-width defaults.
        calibration = load_calibration(app)
        sensor_service = SensorService(
            interval_seconds=sensor_interval_seconds,
            sensor_mode=app.config["SENSOR_MODE"],
            max6675_cs_pin=app.config["MAX6675_CS_PIN"],
            max6675_clk_pin=app.config["MAX6675_CLK_PIN"],
            max6675_do_pin=app.config["MAX6675_DO_PIN"],
            servo_control_pin=app.config["SERVO_CONTROL_PIN"],
            servo_min_pulsewidth=calibration.get("servo_min_pulsewidth", app.config["SERVO_MIN_PULSEWIDTH"]),
            servo_max_pulsewidth=calibration.get("servo_max_pulsewidth", app.config["SERVO_MAX_PULSEWIDTH"]),
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
    while True:
        _sensor_tick()
        socketio.sleep(sensor_interval_seconds)


def _sensor_tick():
    """Run one iteration of the sensor loop.

    Never raises: a failing hardware read (pigpio daemon gone, wiring fault,
    etc.) is logged and skipped so the background task keeps running and
    resumes broadcasting as soon as reads succeed again.
    """
    global latest_sample, sample_counter, consecutive_read_failures

    if not (sensor_service and sensor_service.active):
        return

    try:
        sample = sensor_service.read_sample()
    except Exception:
        consecutive_read_failures += 1
        if consecutive_read_failures == 1 or consecutive_read_failures % sensor_log_every_n == 0:
            logger.exception(
                "Sensor read failed (%s consecutive); sensor loop continuing",
                consecutive_read_failures,
            )
        return

    if sample.get("error"):
        # Hardware fault (e.g. open thermocouple). Broadcast it so clients show
        # the fault instead of a stale or fabricated temperature.
        consecutive_read_failures += 1
        if consecutive_read_failures == 1 or consecutive_read_failures % sensor_log_every_n == 0:
            logger.warning(
                "Sensor fault (%s consecutive): %s",
                consecutive_read_failures,
                sample["error"],
            )
        latest_sample = sample
        _broadcast_sample(sample)
        if (
            sensor_fault_flame_policy == "min"
            and consecutive_read_failures == sensor_fault_flame_after
        ):
            _safety_cutoff(
                "sensor_fault",
                f"Flame cut to 0% after {consecutive_read_failures} consecutive thermocouple faults.",
                sample,
            )
        return

    if consecutive_read_failures:
        logger.info("Sensor read recovered after %s failed attempt(s)", consecutive_read_failures)
        consecutive_read_failures = 0

    latest_sample = sample
    sample_counter += 1
    _check_over_temperature(sample)
    if sample_counter == 1 or sample_counter % sensor_log_every_n == 0:
        logger.info(
            "Sensor sample #%s temperature=%s source=%s flame_level=%s",
            sample_counter,
            latest_sample["temperature"],
            latest_sample["source"],
            latest_sample["flame_level"],
        )

    _broadcast_sample(latest_sample)


def _broadcast_sample(sample):
    try:
        socketio.emit("sensor_data", sample)
    except Exception:
        logger.exception("Failed to broadcast sensor sample; sensor loop continuing")


def _check_over_temperature(sample):
    """Cut the flame once when the bean probe reaches the configured maximum.

    Re-arms after the temperature falls a few degrees below the limit so a
    roast that keeps climbing is cut again, but a reading hovering at the
    limit does not spam cutoffs.
    """
    global over_temperature_active

    if max_bean_temp_c <= 0:
        return
    temperature = sample.get("temperature")
    if temperature is None:
        return

    if temperature >= max_bean_temp_c:
        if not over_temperature_active:
            over_temperature_active = True
            _safety_cutoff(
                "over_temperature",
                f"Bean temperature {temperature:.1f} °C reached the {max_bean_temp_c:.0f} °C limit; flame cut to 0%.",
                sample,
            )
    elif temperature < max_bean_temp_c - _OVER_TEMP_REARM_MARGIN_C:
        over_temperature_active = False


def _safety_cutoff(kind, message, sample):
    """Drop the flame to 0% and tell every client why. Never raises."""
    try:
        previous = sensor_service.health_status()["flame_level"]
        if previous <= 0:
            return
        sensor_service.set_flame_level(0)
        logger.warning("Safety cutoff (%s): %s (flame was %s%%)", kind, message, previous)
        socketio.emit(
            "safety_event",
            {
                "type": kind,
                "message": message,
                "previous_flame_level": previous,
                "flame_level": 0,
                "timestamp": sample.get("timestamp"),
            },
        )
        socketio.emit(
            "sensor_state",
            {
                "active": sensor_service.active,
                "source": sensor_service.source_name,
                "flame_level": 0,
                "simulated": sensor_service.source_name == "simulated",
            },
        )
    except Exception:
        logger.exception("Safety cutoff failed; sensor loop continuing")


def safety_settings():
    return {
        "max_bean_temp_c": max_bean_temp_c,
        "sensor_fault_flame_policy": sensor_fault_flame_policy,
        "sensor_fault_flame_after": sensor_fault_flame_after,
        "over_temperature_active": over_temperature_active,
    }


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
    elif command == "set_servo_pulsewidth":
        pulsewidth = (data or {}).get("pulsewidth", 1500)
        result = sensor_service.set_servo_pulsewidth_raw(pulsewidth)
        message = f"Servo pulse width set to {result['pulsewidth']} µs."
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
