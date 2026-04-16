# Roaster Server

Roaster Server is a Flask and Socket.IO dashboard for tracking live roast telemetry, simulating sensor data during development, and saving roast sessions to SQLite.

## What It Does

- Streams temperature updates to a browser dashboard in real time.
- Falls back to simulated sensor data when Raspberry Pi hardware is unavailable.
- Drives a Raspberry Pi servo speed controller during roasting when `pigpio` hardware mode is enabled.
- Shows live hardware health on the dashboard using the sensor health API.
- Saves roast session metadata, event markers, optional photo data, and the current chart curve to `instance/roasts.db`.
- Exposes simple HTTP endpoints for listing roasts, saving roasts, and checking hardware health.

## Visual Overview

```text
          +----------------------+
          |   Raspberry Pi       |
          |  MAX6675 + Servo     |
          +----------+-----------+
                     |
                     v
          +----------------------+
          | Flask + Socket.IO    |
          |  sensor_service      |
          |  roast_storage       |
          +----------+-----------+
                     |
        +------------+-------------+
        |            |             |
        v            v             v
   Dashboard      Roasting      Lookup
   calendar       live session  saved roasts
   health panel   review flow   curve + photo
```

## Project Layout

```text
roasterServer/
├── app/
│   ├── services/
│   │   ├── roast_storage.py
│   │   └── sensor_service.py
│   ├── static/
│   │   ├── css/
│   │   └── js/
│   ├── templates/
│   │   ├── dashboard.html
│   │   ├── lookup.html
│   │   ├── roast.html
│   │   ├── roast_review.html
│   │   └── roast_session.html
│   ├── web/
│   │   └── routes.py
│   ├── __init__.py
│   └── sockets.py
├── docs/
│   ├── architecture.md
│   └── development.md
├── tests/
│   ├── test_app.py
│   └── test_sensor_service.py
├── config.py
├── requirements-dev.txt
├── requirements.txt
├── Makefile
├── run.py
└── scripts/dev.sh
```

## Quick Start

1. Create or activate a virtual environment.
2. Install dependencies with `pip install -r requirements.txt`.
3. Start the server with `python run.py`.
4. Open `http://127.0.0.1:5000` in your browser.

The app binds to `0.0.0.0:5000` by default, so it is reachable from your local network if your machine and firewall allow it.

### Page Map

```text
/                Dashboard
                 - monthly roast calendar
                 - hardware health

/roast           Roast setup
                 - bean name
                 - origin
                 - start roast

/roast/session   Active roast
                 - live graph
                 - roast stage buttons
                 - hardware widget

/roast/review    Review before save
                 - summary
                 - photo upload
                 - save or cancel

/lookup          Saved roast explorer
                 - roast list
                 - curve with event badges
                 - saved photo
```

### Shortcuts

You can also use the included helpers:

```bash
make install-dev
make run
make test-fast
make check
```

Or, if you prefer a script:

```bash
./scripts/dev.sh install-dev
./scripts/dev.sh run
./scripts/dev.sh test-fast
./scripts/dev.sh check
```

## Testing

Install test dependencies with `pip install -r requirements-dev.txt`, then run:

```bash
pytest
```

The test suite is split into:

- `tests/test_sensor_service.py` for sensor reader behavior and `pigpio` handling.
- `tests/test_app.py` for page rendering and roast API behavior.

## Configuration

These environment variables are supported:

- `SECRET_KEY`
- `DATABASE_URL`
- `SENSOR_INTERVAL_SECONDS`
- `MAX_CHART_POINTS`
- `SOCKET_CORS_ALLOWED_ORIGINS`
- `SENSOR_MODE`
- `MAX6675_CS_PIN`
- `MAX6675_CLK_PIN`
- `MAX6675_DO_PIN`
- `SERVO_CONTROL_PIN`
- `SERVO_MIN_PULSEWIDTH`
- `SERVO_MAX_PULSEWIDTH`

### Raspberry Pi Temperature Reader And Servo Control

The app can read temperature from a Raspberry Pi through `pigpio` using a MAX6675 thermocouple interface, and it can drive a servo that acts as the roast speed controller.

```text
MAX6675 breakout              Raspberry Pi
----------------              ------------
VCC        3.3V/5V   ------>  power
GND        ground    ------>  GND
CS         select    ------>  MAX6675_CS_PIN
CLK        clock     ------>  MAX6675_CLK_PIN
DO         data out  ------>  MAX6675_DO_PIN

Servo signal pin     ------>  SERVO_CONTROL_PIN
Servo power/ground   ------>  external power/GND as appropriate
```

1. Install `pigpio` on the Pi and start the daemon with `sudo pigpiod`.
2. Install Python dependencies with `pip install -r requirements.txt`.
3. Set `SENSOR_MODE=pigpio`.
4. Set the GPIO pins if you are not using the defaults:
   `MAX6675_CS_PIN=8`
   `MAX6675_CLK_PIN=11`
   `MAX6675_DO_PIN=9`
   `SERVO_CONTROL_PIN=18`
5. Start the app with `python run.py`.

When `SENSOR_MODE` is not `pigpio`, or when `pigpio` cannot connect, the app falls back to simulated data.

You can verify hardware health from the browser dashboard or directly through:

```bash
curl http://127.0.0.1:5000/api/sensor/health
```

Expected shape:

```text
{
  "connected": true,
  "temperature_ok": true,
  "servo_ok": true,
  "speed": 50,
  "source": "pigpio-max6675"
}
```

## API

- `GET /api/roasts` returns recent roast sessions.
- `POST /api/roasts` saves a roast session and its captured curve.
- `GET /api/sensor/health` returns temperature and servo hardware health.

Example payload:

```json
{
  "bean_name": "Guatemala Huehuetenango",
  "origin": "Huehuetenango, Guatemala",
  "roast_level": "Medium",
  "started_at": "2026-04-15T09:30:00Z",
  "ended_at": "2026-04-15T09:42:00Z",
  "notes": "Lower airflow at turning point",
  "curve": [
    {
      "timestamp": "09:30:05",
      "temperature": 201.3,
    }
  ]
}
```

## Documentation

- [Architecture](docs/architecture.md)
- [Development Guide](docs/development.md)
- [Continuation Notes](docs/continuation.md)
