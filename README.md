# Roaster Server

Roaster Server is a Flask and Socket.IO dashboard for tracking live roast telemetry, simulating sensor data during development, and saving roast sessions to SQLite.

## What It Does

- Streams temperature updates to a browser dashboard in real time.
- Falls back to simulated sensor data when Raspberry Pi hardware is unavailable.
- Drives a Raspberry Pi servo flame controller during roasting when `pigpio` hardware mode is enabled.
- Shows live hardware health on the dashboard using the sensor health API.
- Plots saved roast origins on interactive global maps using region and country matching from saved origin names.
- Saves roast session metadata, event markers, optional photo data, and the current chart curve to `instance/roasts.db`.
- Calculates roast analytics like duration, development time, ratio, and peak temperature from captured curves.
- Supports post-roast editing for roast metadata, roast notes, cup ratings, and tasting notes from a dedicated edit page after the beans are brewed or cupped.
- Lets users remove saved roasts directly from the lookup page.
- Exports any roast as a portable JSON file (photo embedded) and imports one or many back, all-or-nothing.
- Shows live rate-of-rise and marks the turn point on the active roast chart.
- Has a settings page with a hardware check and a flame-servo calibration slider whose endpoints persist across restarts.
- Reports thermocouple faults honestly: a failed read shows `-- °C`, leaves a gap in the curve, and logs a hardware-issue event instead of plotting a stand-in value.
- Installs as an offline-capable PWA and runs on the Pi's own Wi-Fi access point, so no router or internet is needed at the roaster.
- Exposes HTTP endpoints for listing, saving, editing, deleting, exporting, and importing roasts, plus hardware health and calibration.

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
   origin map     review graph  cup feedback
   health panel   servo control curve + photo
```

## Project Layout

```text
roasterServer/
├── app/
│   ├── services/
│   │   ├── calibration.py        servo calibration persisted to instance/calibration.json
│   │   ├── roast_storage.py
│   │   ├── sensor_service.py
│   │   └── wifi_service.py       nmcli wrapper for /setup/wifi
│   ├── static/
│   │   ├── css/
│   │   ├── icons/                PWA icons
│   │   ├── js/
│   │   ├── vendor/               Chart.js, Socket.IO, Leaflet, map tiles (no CDN)
│   │   ├── manifest.webmanifest
│   │   └── sw.js                 service worker
│   ├── templates/
│   │   ├── base.html
│   │   ├── dashboard.html
│   │   ├── lookup.html
│   │   ├── lookup_edit.html
│   │   ├── roast.html
│   │   ├── roast_review.html
│   │   ├── roast_session.html
│   │   ├── settings.html
│   │   └── setup_wifi.html
│   ├── web/
│   │   └── routes.py
│   ├── __init__.py
│   └── sockets.py
├── deploy/                       systemd unit, env template, sudoers rules, hostapd/dnsmasq configs
├── docs/
│   ├── architecture.md
│   ├── continuation.md
│   ├── development.md
│   └── pi-setup.md
├── scripts/                      dev.sh, Pi install scripts, demo seed data
├── tests/
│   ├── test_app.py
│   ├── test_sensor_service.py
│   └── test_sockets.py
├── config.py
├── requirements-dev.txt
├── requirements.txt
├── Makefile
└── run.py
```

## Quick Start

1. Create or activate a virtual environment.
2. Install dependencies with `pip install -r requirements.txt`.
3. Start the server with `make run` (it generates a throwaway `SECRET_KEY`; the app refuses to start with an unset or placeholder key, so `python run.py` needs `SECRET_KEY` exported).
4. Open `http://127.0.0.1:5000` in your browser.

The app binds to `0.0.0.0:5000` by default, so it is reachable from your local network if your machine and firewall allow it.

### Page Map

```text
/                Dashboard
                 - monthly roast calendar
                 - interactive global roast origin map
                 - clickable origin roast list
                 - hardware health

/roast           Roast setup
                 - bean name
                 - origin
                 - batch weight
                 - start roast

/roast/session   Active roast
                 - live graph
                 - roast stage buttons
                 - live roast analytics
                 - hardware widget

/roast/review    Review before save
                 - summary
                 - roast analytics
                 - total roast time
                 - batch weight
                 - graph preview to be saved
                 - photo upload
                 - save or cancel

/lookup          Saved roast explorer
                 - global origin filter map
                 - roast list
                 - roast analytics
                 - edit roast link
                 - remove roast button
                 - cup rating + tasting notes
                 - curve with event badges
                 - saved photo

/lookup/<id>/edit
                 - edit bean, origin, level, and weight
                 - edit roast notes
                 - edit rating and tasting notes
                 - saved after cupping

/settings        Hardware check + flame calibration
                 - live temperature and health
                 - servo min/max pulse-width slider, persisted

/setup/wifi      Wi-Fi onboarding (only while WIFI_SETUP_MODE=true)
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
./scripts/dev.sh seed-roasts
./scripts/dev.sh test-fast
./scripts/dev.sh check
```

To replace any saved roast history with fresh demo roasts for UI testing:

```bash
./venv/bin/python scripts/seed_test_roasts.py
```

Or through the helper:

```bash
./scripts/dev.sh seed-roasts
```

## Testing

Install test dependencies with `pip install -r requirements-dev.txt`, then run:

```bash
pytest
```

The test suite is split into:

- `tests/test_sensor_service.py` for sensor reader behavior, `pigpio` handling, health caching, and the bus lock.
- `tests/test_app.py` for page rendering, roast API validation, editing, deletion, photos, export/import atomicity, PWA assets, and the `SECRET_KEY` guard.
- `tests/test_sockets.py` for the sensor loop tick: read errors, fault samples, recovery.

If `pytest` cannot import `app` in your local shell, run:

```bash
PYTHONPATH=. pytest
```

## Configuration

These environment variables are supported:

- `SECRET_KEY` (required outside tests; `devkey` and `change-me` are rejected)
- `DATABASE_URL`
- `SENSOR_INTERVAL_SECONDS`
- `SOCKET_CORS_ALLOWED_ORIGINS`
- `SENSOR_MODE`
- `LOG_LEVEL`
- `SENSOR_LOG_EVERY_N`
- `MAX6675_CS_PIN`
- `MAX6675_CLK_PIN`
- `MAX6675_DO_PIN`
- `SERVO_CONTROL_PIN`
- `SERVO_MIN_PULSEWIDTH`
- `SERVO_MAX_PULSEWIDTH`
- `CAPTIVE_PORTAL_ENABLED`
- `WIFI_SETUP_MODE` and the other `WIFI_*` variables listed under Wi-Fi provisioning

### Testing Logs

For local testing, the app now logs startup, route hits, roast saves, feedback edits, socket controls, and periodic sensor samples to the console.

Useful overrides:

```bash
export LOG_LEVEL=INFO
export SENSOR_LOG_EVERY_N=5
python3 run.py
```

### Raspberry Pi Temperature Reader And Servo Control

The app can read temperature from a Raspberry Pi through `pigpio` using a MAX6675 thermocouple interface, and it can drive a servo that acts as the roast flame controller.

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

## Raspberry Pi Wi-Fi Provisioning

The recommended deployment is direct-AP mode, where the Pi broadcasts its own network (see `docs/pi-setup.md`). As an alternative, the app supports a first-boot Wi-Fi onboarding flow for joining a home network:

1. On startup, the Pi waits briefly for any saved Wi-Fi profile to connect.
2. If no saved network connects, it brings up a temporary hotspot.
3. You connect to that hotspot from a phone and open `http://10.42.0.1:5000/setup/wifi`.
4. The setup page scans nearby SSIDs, accepts your home Wi-Fi password, and saves it through `nmcli`.
5. NetworkManager remembers the home network and reconnects automatically on later boots.

The bootstrap helper is:

```bash
./scripts/wifi_provisioning_bootstrap.sh
```

Important environment variables:

- `WIFI_SETUP_MODE`: enables the setup page and setup API when `true`
- `WIFI_INTERFACE`: wireless interface to manage, usually `wlan0`
- `WIFI_SETUP_SSID`: SSID for the temporary setup hotspot
- `WIFI_SETUP_PASSWORD`: password for the temporary setup hotspot
- `WIFI_SETUP_CONNECTION_NAME`: saved NetworkManager connection name for the hotspot
- `WIFI_USE_SUDO_FOR_NMCLI`: set to `true` if the Flask process needs `sudo -n nmcli`

Recommended Pi deployment notes:

- Give the app permission to run `nmcli` non-interactively, or run the service as a user that already has that access.
- Keep the setup hotspot temporary. The bootstrap script only enables it when no saved Wi-Fi profile connects.
- The app exposes the provisioning UI only while `WIFI_SETUP_MODE=true`.
- Full Pi deployment steps live in [docs/pi-setup.md](docs/pi-setup.md).

## Run At Startup On Raspberry Pi

The repo includes a `systemd` service template and env-file template:

- [deploy/roaster-server.service](deploy/roaster-server.service)
- [deploy/roaster-server.env.example](deploy/roaster-server.env.example)
- [scripts/install_pi_service.sh](scripts/install_pi_service.sh)

For the full Raspberry Pi installation and auto-start walkthrough, see [docs/pi-setup.md](docs/pi-setup.md).

Quick start on the Pi:

```bash
sudo apt update
sudo apt install -y python3-venv python3-pip network-manager pigpio

cd /home/pi/roasterServer
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
cp deploy/roaster-server.env.example deploy/roaster-server.env
chmod +x scripts/wifi_provisioning_bootstrap.sh scripts/install_pi_service.sh
sudo ./scripts/install_pi_service.sh
sudo systemctl start roaster-server.service
sudo systemctl status roaster-server.service
```

Useful service commands:

```bash
sudo systemctl restart roaster-server.service
sudo journalctl -u roaster-server.service -f
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

When `SENSOR_MODE` is not `pigpio`, or when `pigpio` cannot connect, the app runs on simulated data and labels it `simulated`. A thermocouple fault in `pigpio` mode is never papered over: the sample carries `temperature: null` and an `error`, the pages show `-- °C`, and the roast curve gets a gap.

You can verify hardware health from the browser dashboard or directly through:

```bash
curl http://127.0.0.1:5000/api/sensor/health
```

Expected shape:

```text
{
  "mode": "pigpio",
  "connected": true,
  "temperature_ok": true,
  "servo_ok": true,
  "last_temperature_error": null,
  "flame_level": 50,
  "servo_min_pulsewidth": 1000,
  "servo_max_pulsewidth": 2000,
  "source": "pigpio-max6675"
}
```

## API

- `GET /api/roasts?limit=N|all` returns recent roast sessions (default 8).
- `GET /api/roasts/summary` returns counts and roast-level totals.
- `GET /api/roasts/<id>` returns one roast with its curve and events.
- `POST /api/roasts` saves a roast session and its captured curve (strictly validated; bad records get a 400).
- `PATCH /api/roasts/<id>` updates editable saved-roast properties after roasting.
- `DELETE /api/roasts/<id>` removes a saved roast and its photo file.
- `GET /api/roasts/<id>/export` downloads a portable JSON document with the photo embedded.
- `POST /api/roasts/import` restores one or many exported roasts, all-or-nothing.
- `GET /api/sensor/health` returns temperature and servo hardware health.
- `POST /api/sensor/calibration` sets and persists the servo pulse-width range.

Example payload:

```json
{
  "bean_name": "Guatemala Huehuetenango",
  "origin": "Huehuetenango, Guatemala",
  "roast_level": "Medium",
  "weight_grams": 350,
  "started_at": "2026-04-15T09:30:00Z",
  "ended_at": "2026-04-15T09:42:00Z",
  "total_roast_seconds": 720,
  "notes": "Lower airflow at turning point",
  "curve": [
    {
      "timestamp": "09:30:05",
      "temperature": 201.3
    }
  ]
}
```

## Documentation

- [Architecture](docs/architecture.md)
- [Development Guide](docs/development.md)
- [Raspberry Pi Setup](docs/pi-setup.md)
- [Continuation Notes](docs/continuation.md)
