# Development Guide

## Local Setup

1. Create a virtual environment.
2. Install dependencies with `pip install -r requirements.txt`.
3. Run the app with `make run` (or `./scripts/dev.sh run`). Both generate a throwaway `SECRET_KEY` and, on macOS, set `EVENTLET_HUB=selects`; `python run.py` directly needs `SECRET_KEY` exported.

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

- If `pigpio` is unavailable (not installed or the daemon is down), the app runs on simulated data and labels the source `simulated`. A faulting thermocouple in `pigpio` mode is different: the sample carries `temperature: null` plus an `error`, the UI shows `-- °C`, and nothing simulated is ever substituted.
- The roast session keeps the whole curve (no point cap) and persists an in-progress draft plus the pending review payload to `localStorage`, so a closed tab can resume.
- The settings page (`/settings`) shows live hardware health and a servo calibration slider; `POST /api/sensor/calibration` persists the pulse-width range to `instance/calibration.json`, which overrides the env defaults on the next start.
- Roast payloads are validated strictly (`_normalize_roast_payload` in `routes.py`); import writes all photos then inserts all rows in one transaction, so a bad or failing entry imports nothing.
- Every innerHTML template escapes data through `escapeHtml()` from `live_charts.js`.
- The dashboard includes a hardware health panel backed by `GET /api/sensor/health`.
- Both the dashboard and lookup page use Leaflet-based interactive origin maps via `origin_map.js`. Both pages must load `leaflet.js` before `origin_map.js` in their scripts block.
- Adding new coffee-growing regions requires extending `coffeeOriginCatalog` in `app/static/js/origin_map.js`.
- The SQLite database is created automatically at `instance/roasts.db`.
- Recent roast history is loaded from `GET /api/roasts`.
- Roast review shows the actual graph curve that will be saved before the final `POST /api/roasts`.
- Roast setup captures batch weight and flame level. Saved roasts persist `weight_grams`, `total_roast_seconds`, and `flame_level`.
- Photos are stored on disk at `instance/uploads/<uuid>.<ext>`. The API returns `photo_url` for new records and `photo_data` for legacy base64 records.
- The lookup edit page updates saved roast metadata, roast notes, rating, and tasting notes through `PATCH /api/roasts/<id>`.
- Saved roasts can be removed from the lookup page through `DELETE /api/roasts/<id>` (also deletes the photo file if present).
- The `schema_version` table in SQLite drives additive migrations. Bump `_SCHEMA_VERSION` and add `_migrate_vN(conn)` when adding columns.
- Console logging now covers startup, route hits, roast saves, feedback edits, socket controls, and periodic sensor samples for testing.
- You can reset the local database to a known demo roast set with `./scripts/dev.sh seed-roasts`.

## Useful Environment Variables

- `SECRET_KEY`: required outside tests; the app refuses `devkey`, `change-me`, or an empty value.
- `MAX_CONTENT_LENGTH`: largest request body in bytes (default 32 MB); bigger bodies get a JSON 413 instead of being read into memory.
- `LOG_LEVEL` / `SENSOR_LOG_EVERY_N`: console log level and how often a sensor sample is logged.
- `SENSOR_INTERVAL_SECONDS`: how often the server emits sensor updates.
- `DATABASE_URL`: overrides the SQLite database location.
- `SOCKET_CORS_ALLOWED_ORIGINS`: adjusts allowed Socket.IO origins.
- `SENSOR_MODE`: set to `pigpio` on Raspberry Pi hardware, otherwise leave as simulated.
- `MAX6675_CS_PIN`: chip-select GPIO for the MAX6675 reader.
- `MAX6675_CLK_PIN`: clock GPIO for the MAX6675 reader.
- `MAX6675_DO_PIN`: data-out GPIO for the MAX6675 reader.
- `SERVO_CONTROL_PIN`: GPIO pin used for the roast flame servo.
- `SERVO_MIN_PULSEWIDTH`: minimum pulse width for the servo controller.
- `SERVO_MAX_PULSEWIDTH`: maximum pulse width for the servo controller (both pulse widths are overridden by a saved calibration).
- `CAPTIVE_PORTAL_ENABLED`: redirect captive-portal probe URLs to the dashboard in direct-AP mode.

## Raspberry Pi Notes

- Install and start the `pigpio` daemon with `sudo pigpiod`.
- Set `SENSOR_MODE=pigpio` before starting the Flask app.
- The current hardware reader expects a MAX6675 thermocouple breakout.
- The roast flame slider can drive a servo through `SERVO_CONTROL_PIN` when hardware mode is enabled.
- If the pigpio daemon is unavailable, the app falls back to simulated data so the UI still works; a wiring fault with the daemon up is reported as a fault instead.
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

The repo includes a ready-to-edit unit file at [deploy/roaster-server.service](../deploy/roaster-server.service) and an env template at [deploy/roaster-server.env.example](../deploy/roaster-server.env.example).

The full Raspberry Pi deployment guide now lives in [docs/pi-setup.md](pi-setup.md).

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

`install_pi_service.sh` also installs `deploy/sudoers-roaster-server` to `/etc/sudoers.d/roaster-server` after a `visudo -cf` check. It grants the `pi` user passwordless `nmcli`, so the setup page can save Wi-Fi credentials, and passwordless `systemctl restart roaster-server.service`, so deploys can restart the app without a terminal.

The unit runs `venv/bin/python run.py` directly. In the recommended direct-AP deployment the Pi's own Wi-Fi comes from `hostapd` + `dnsmasq` (installed by `scripts/install_pi_ap.sh`), not from the app. `scripts/wifi_provisioning_bootstrap.sh` is the NetworkManager-based alternative for joining a home network; point the unit's `ExecStart=` at it to use the `provision`/`client` modes. See `docs/pi-setup.md`.

For troubleshooting:

```bash
sudo systemctl status roaster-server.service
sudo journalctl -u roaster-server.service -f
```

## Hardware Health Check

- The backend exposes `GET /api/sensor/health`.
- In `pigpio` mode the endpoint reports the sensor loop's most recent read rather than reading the chip itself, so polling it never contends with the loop on the MAX6675 bus. It only reads directly when the loop is paused or has not sampled recently. Every bit-banged read holds a lock.
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
make check                     # compileall + pytest
make run                       # dev SECRET_KEY generated; EVENTLET_HUB=selects on macOS
curl http://127.0.0.1:5000/api/sensor/health
```

If you are running in a restricted sandbox, startup may fail when binding to a listening socket even if the code itself is correct.

## Continuing Later

If you are picking the project back up on another day, read:

- `docs/continuation.md`

That file tracks the current product state, important decisions, key files, known risks, and recommended next steps.

## Test Layout

- `tests/test_sensor_service.py` verifies simulated and `pigpio` sensor behavior, fault samples, cached health, and the bus lock.
- `tests/test_app.py` verifies page rendering, roast API validation and flows, photos, export/import atomicity, PWA assets, and the `SECRET_KEY` guard.
- `tests/test_sockets.py` verifies the sensor loop tick survives read errors and broadcasts fault samples.
- Each test gets a fresh temporary instance folder and SQLite file, and the background sensor task is disabled, so tests stay deterministic.
- Frontend logic has no committed test harness. Changes are checked with `node --check`; during development, stubbed-DOM harnesses run in plain Node (load `live_charts.js` then the page script in a `vm` context with `document`, `io`, `Chart`, and `localStorage` stubs).

### Test Map

```text
tests/test_sensor_service.py
  -> simulated sample shape
  -> MAX6675 reads, open-circuit fault samples
  -> servo pulse mapping
  -> hardware health: cached loop read, stale fallback, direct-read failure
  -> bus lock held during reads

tests/test_sockets.py
  -> tick survives read exceptions and recovers
  -> fault samples broadcast and counted
  -> paused loop skips reads

tests/test_app.py
  -> page renders (incl. /settings)
  -> roast create/detail/summary, payload validation + coercion
  -> ?limit validation
  -> lookup edit page, roast property patch, delete (+ photo file)
  -> photo type/size validation
  -> export/import round trip, atomic import (validation, photo failure, DB failure)
  -> Wi-Fi setup routes, captive-portal probes
  -> PWA manifest + service worker
  -> SECRET_KEY guard
  -> sensor health endpoint
```
