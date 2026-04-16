import os


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "devkey")
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL", "sqlite:///roasts.db"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SENSOR_INTERVAL_SECONDS = float(os.environ.get("SENSOR_INTERVAL_SECONDS", "2.0"))
    MAX_CHART_POINTS = int(os.environ.get("MAX_CHART_POINTS", "30"))
    SOCKET_CORS_ALLOWED_ORIGINS = os.environ.get(
        "SOCKET_CORS_ALLOWED_ORIGINS", "*"
    )
    START_SENSOR_BACKGROUND_TASK = (
        os.environ.get("START_SENSOR_BACKGROUND_TASK", "true").lower() == "true"
    )
    SENSOR_MODE = os.environ.get("SENSOR_MODE", "simulated")
    MAX6675_CS_PIN = int(os.environ.get("MAX6675_CS_PIN", "8"))
    MAX6675_CLK_PIN = int(os.environ.get("MAX6675_CLK_PIN", "11"))
    MAX6675_DO_PIN = int(os.environ.get("MAX6675_DO_PIN", "9"))
    SERVO_CONTROL_PIN = int(os.environ.get("SERVO_CONTROL_PIN", "18"))
    SERVO_MIN_PULSEWIDTH = int(os.environ.get("SERVO_MIN_PULSEWIDTH", "1000"))
    SERVO_MAX_PULSEWIDTH = int(os.environ.get("SERVO_MAX_PULSEWIDTH", "2000"))
