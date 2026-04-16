# Development Guide

## Local Setup

1. Create a virtual environment.
2. Install dependencies with `pip install -r requirements.txt`.
3. Run the app with `python run.py`.

## Workflow Visual

```text
install deps
    |
    v
run app
    |
    +--> open dashboard
    |      |
    |      v
    |   origin map + hardware status
    |
    +--> start roast
    |      |
    |      v
    |   review + graph + weight + time + photo
    |      |
    |      v
    |   save to database
    |
    +--> lookup saved roasts
           |
           v
        edit roast properties or delete roast
```

Helper commands are also available:

```bash
make install-dev
make run
make test-fast
make check
```

Or with the helper script:

```bash
./scripts/dev.sh install-dev
./scripts/dev.sh run
./scripts/dev.sh seed-roasts
./scripts/dev.sh test-fast
./scripts/dev.sh check
```

## Development Notes

- If `pigpio` is unavailable, the app automatically uses simulated data.
- The dashboard includes a hardware health panel backed by `GET /api/sensor/health`.
- The dashboard also plots saved roast origins on an interactive world map that matches coffee regions and countries from saved origin text.
- The lookup page includes a compact interactive world map that filters saved sessions by mapped origin.
- The SQLite database is created automatically at `instance/roasts.db`.
- Recent roast history is loaded from `GET /api/roasts`.
- Roast review shows the actual graph curve that will be saved before the final `POST /api/roasts`.
- Roast setup now captures batch weight, and saved roasts persist both `weight_grams` and `total_roast_seconds`.
- The lookup edit page now updates saved roast metadata, roast notes, rating, and tasting notes through `PATCH /api/roasts/<id>`.
- Saved roasts can be removed from the lookup page through `DELETE /api/roasts/<id>`.
- Console logging now covers startup, route hits, roast saves, feedback edits, socket controls, and periodic sensor samples for testing.
- You can reset the local database to a known demo roast set with `./scripts/dev.sh seed-roasts`.

## Useful Environment Variables

- `SENSOR_INTERVAL_SECONDS`: how often the server emits sensor updates.
- `MAX_CHART_POINTS`: how many recent points the frontend keeps per chart.
- `DATABASE_URL`: overrides the SQLite database location.
- `SOCKET_CORS_ALLOWED_ORIGINS`: adjusts allowed Socket.IO origins.
- `SENSOR_MODE`: set to `pigpio` on Raspberry Pi hardware, otherwise leave as simulated.
- `MAX6675_CS_PIN`: chip-select GPIO for the MAX6675 reader.
- `MAX6675_CLK_PIN`: clock GPIO for the MAX6675 reader.
- `MAX6675_DO_PIN`: data-out GPIO for the MAX6675 reader.
- `SERVO_CONTROL_PIN`: GPIO pin used for the roast flame servo.
- `SERVO_MIN_PULSEWIDTH`: minimum pulse width for the servo controller.
- `SERVO_MAX_PULSEWIDTH`: maximum pulse width for the servo controller.

## Raspberry Pi Notes

- Install and start the `pigpio` daemon with `sudo pigpiod`.
- Set `SENSOR_MODE=pigpio` before starting the Flask app.
- The current hardware reader expects a MAX6675 thermocouple breakout.
- The roast flame slider can drive a servo through `SERVO_CONTROL_PIN` when hardware mode is enabled.
- If the Pi reader is unavailable, the app falls back to simulated data so the UI still works.
- For Wi-Fi onboarding, use `./scripts/wifi_provisioning_bootstrap.sh` instead of `python run.py` so the Pi can fall back to a temporary setup hotspot when it is not already on a saved network.

### Pi Setup Visual

```text
export SENSOR_MODE=pigpio
export MAX6675_CS_PIN=8
export MAX6675_CLK_PIN=11
export MAX6675_DO_PIN=9
export SERVO_CONTROL_PIN=18

sudo pigpiod
make run
```

### Wi-Fi Provisioning Flow

The app includes a Wi-Fi setup page at `/setup/wifi`, but it only exists while `WIFI_SETUP_MODE=true`.

Recommended Pi startup flow:

```text
boot
  |
  v
wait for saved Wi-Fi profile
  |
  +--> connected
  |      |
  |      v
  |   start Flask normally
  |
  +--> not connected
         |
         v
      start temporary hotspot
         |
         v
      open /setup/wifi from phone
         |
         v
      save home SSID + password with nmcli
```

Run the helper manually during development:

```bash
export WIFI_SETUP_SSID=Roaster-Setup
export WIFI_SETUP_PASSWORD=changeme123
./scripts/wifi_provisioning_bootstrap.sh
```

If the Flask process cannot call `nmcli` directly, enable:

```bash
export WIFI_USE_SUDO_FOR_NMCLI=true
```

Then allow passwordless `nmcli` for the service user in `sudoers`. The setup route uses `sudo -n`, so it will fail fast instead of hanging for a password prompt.

### Start On Boot With systemd

The repo includes a ready-to-edit unit file at [deploy/roaster-server.service](/home/ub20/Documents/python/flaskTesting/roasterServer/deploy/roaster-server.service) and an env template at [deploy/roaster-server.env.example](/home/ub20/Documents/python/flaskTesting/roasterServer/deploy/roaster-server.env.example).

The full Raspberry Pi deployment guide now lives in [docs/pi-setup.md](/home/ub20/Documents/python/flaskTesting/roasterServer/docs/pi-setup.md).

Quick install on a Pi:

```bash
sudo apt update
sudo apt install -y python3-venv python3-pip network-manager pigpio
sudo systemctl enable NetworkManager

cd /home/pi/roasterServer
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
cp deploy/roaster-server.env.example deploy/roaster-server.env
sudo ./scripts/install_pi_service.sh
sudo systemctl start roaster-server.service
```

To let the app save Wi-Fi credentials through `nmcli`, add `/etc/sudoers.d/roaster-server` with:

```sudoers
pi ALL=(root) NOPASSWD: /usr/bin/nmcli
```

Validate it with:

```bash
sudo visudo -cf /etc/sudoers.d/roaster-server
```

The service launches `scripts/wifi_provisioning_bootstrap.sh`, so startup behavior is:

- If a saved Wi-Fi connection comes up, the app starts in normal mode.
- If no saved Wi-Fi connects, the script enables the setup hotspot and starts Flask in setup mode.

For troubleshooting:

```bash
sudo systemctl status roaster-server.service
sudo journalctl -u roaster-server.service -f
```

## Hardware Health Check

- The backend exposes `GET /api/sensor/health`.
- The dashboard polls that endpoint and shows temperature sensor status, servo status, current flame level, mode, and the last reported error.
- A `200` response means the configured mode passed the health check.
- A `503` response means the Pi hardware path is unavailable or failing.

### Health States

```text
Healthy:
  connected=true
  temperature_ok=true
  servo_ok=true

Unhealthy examples:
  connected=false
  temperature_ok=false
  last_temperature_error="pigpio daemon unavailable"

  connected=true
  temperature_ok=false
  last_temperature_error="Thermocouple open circuit"
```

## Verification

Useful checks:

```bash
python -m compileall app run.py config.py
python run.py
PYTHONPATH=. pytest
curl http://127.0.0.1:5000/api/sensor/health
```

If you are running in a restricted sandbox, startup may fail when binding to a listening socket even if the code itself is correct.

## Continuing Later

If you are picking the project back up on another day, read:

- `docs/continuation.md`

That file tracks the current product state, important decisions, key files, known risks, and recommended next steps.

## Test Layout

- `tests/test_sensor_service.py` verifies simulated and `pigpio` sensor behavior.
- `tests/test_app.py` verifies page rendering, roast API flows, and the sensor health endpoint.
- The test app disables the background sensor task so tests stay deterministic.

### Test Map

```text
tests/test_sensor_service.py
  -> simulated sample shape
  -> MAX6675 reads
  -> servo pulse mapping
  -> hardware health

tests/test_app.py
  -> page renders
  -> roast create/detail
  -> roast summary
  -> lookup edit page
  -> roast property patch
  -> roast delete flow
  -> sensor health endpoint
```
