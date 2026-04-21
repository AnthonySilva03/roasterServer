import os


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "3920rjsohipdsaj3r9sdf8")
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
    LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
    SENSOR_LOG_EVERY_N = int(os.environ.get("SENSOR_LOG_EVERY_N", "10"))
    WIFI_SETUP_MODE = os.environ.get("WIFI_SETUP_MODE", "false").lower() == "true"
    WIFI_INTERFACE = os.environ.get("WIFI_INTERFACE", "wlan0")
    WIFI_SETUP_SSID = os.environ.get("WIFI_SETUP_SSID", "Roaster-Setup")
    WIFI_SETUP_PASSWORD = os.environ.get("WIFI_SETUP_PASSWORD", "changeme123")
    WIFI_SETUP_CONNECTION_NAME = os.environ.get("WIFI_SETUP_CONNECTION_NAME", "roaster-setup")
    WIFI_SETUP_ROUTE = os.environ.get("WIFI_SETUP_ROUTE", "/setup/wifi")
    WIFI_NMCLI_BINARY = os.environ.get("WIFI_NMCLI_BINARY", "nmcli")
    WIFI_USE_SUDO_FOR_NMCLI = os.environ.get("WIFI_USE_SUDO_FOR_NMCLI", "false").lower() == "true"
