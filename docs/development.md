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

## Useful Environment Variables

- `SENSOR_INTERVAL_SECONDS`: how often the server emits sensor updates.
- `MAX_CHART_POINTS`: how many recent points the frontend keeps per chart.
- `DATABASE_URL`: overrides the SQLite database location.
- `SOCKET_CORS_ALLOWED_ORIGINS`: adjusts allowed Socket.IO origins.
- `SENSOR_MODE`: set to `pigpio` on Raspberry Pi hardware, otherwise leave as simulated.
- `MAX6675_CS_PIN`: chip-select GPIO for the MAX6675 reader.
- `MAX6675_CLK_PIN`: clock GPIO for the MAX6675 reader.
- `MAX6675_DO_PIN`: data-out GPIO for the MAX6675 reader.
- `SERVO_CONTROL_PIN`: GPIO pin used for the roast speed servo.
- `SERVO_MIN_PULSEWIDTH`: minimum pulse width for the servo controller.
- `SERVO_MAX_PULSEWIDTH`: maximum pulse width for the servo controller.

## Raspberry Pi Notes

- Install and start the `pigpio` daemon with `sudo pigpiod`.
- Set `SENSOR_MODE=pigpio` before starting the Flask app.
- The current hardware reader expects a MAX6675 thermocouple breakout.
- The roast speed slider can drive a servo through `SERVO_CONTROL_PIN` when hardware mode is enabled.
- If the Pi reader is unavailable, the app falls back to simulated data so the UI still works.

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

## Hardware Health Check

- The backend exposes `GET /api/sensor/health`.
- The dashboard polls that endpoint and shows temperature sensor status, servo status, current speed, mode, and the last reported error.
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
