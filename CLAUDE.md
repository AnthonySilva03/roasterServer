# CLAUDE.md

Developer context for AI-assisted work on this project.

## What This Is

A Flask + Socket.IO coffee roast tracker. Runs on a Raspberry Pi with a MAX6675 thermocouple and servo flame controller. Falls back to simulated sensor data when Pi hardware is unavailable so the UI works on any machine.

## Key Commands

```bash
make run            # start the server (http://127.0.0.1:5000)
make test-fast      # run the test suite
make check          # compile check + tests
PYTHONPATH=. pytest # if pytest cannot find app
./scripts/dev.sh seed-roasts  # reset DB to demo roasts
```

## Project Layout (important files only)

```
app/__init__.py              Flask factory, config load, DB init, schema migration
app/web/routes.py            All HTTP routes and JSON API endpoints
app/sockets.py               Socket.IO events, sensor broadcast loop, flame control
app/services/sensor_service.py   SensorService: pigpio or simulated, servo, health
app/services/roast_storage.py    SQLite persistence, schema versioning, photo file storage

app/templates/dashboard.html     Monthly calendar + Leaflet origin map + hardware health
app/templates/roast_session.html Active roast, live graph, stage buttons, flame slider
app/templates/roast_review.html  Save/cancel step with graph preview + photo upload
app/templates/lookup.html        Saved roast browser with Leaflet origin filter map
app/templates/lookup_edit.html   Post-roast metadata editor

app/static/js/origin_map.js  Shared Leaflet map + coffee-region alias matching
app/static/js/dashboard.js   Dashboard calendar, origin map markers, health panel
app/static/js/roast_session.js  Active roast logic, stage events, hardware polling
app/static/js/lookup_page.js    Saved roast detail, origin filter, chart, photo
app/static/js/roast_review.js   Pending roast review and save/cancel logic

config.py                    All env-var defaults
tests/test_app.py            Integration tests: routes, roast API, photo handling
tests/test_sensor_service.py Unit tests: sensor modes, servo, health
```

## Architecture in One Paragraph

HTTP routes (routes.py) render pages and expose the REST API. Socket.IO (sockets.py) runs a background loop that emits `sensor_data` events to connected browsers. `SensorService` is the single hardware abstraction — it either reads a MAX6675 via pigpio or generates a simulated roast curve. `roast_storage.py` owns all SQLite work without an ORM. The frontend captures sensor events in `sessionStorage` during an active roast, then posts them to `POST /api/roasts` on the review page.

## Critical Patterns

**Schema migration** — `roast_storage.py` uses a `schema_version` table. When adding a column, bump `_SCHEMA_VERSION` and add a `_migrate_vN(conn)` function. Never alter the baseline `CREATE TABLE` statement.

**Photo storage** — New roasts store photos as files at `instance/uploads/<uuid>.<ext>`; DB holds `photo_filename`. The API returns `photo_url` for new records and `photo_data` (legacy base64) for old ones. `lookup_page.js` checks `photo_url` before `photo_data`. DELETE endpoint removes the file from disk.

**Origin maps** — Both the dashboard and lookup page use Leaflet (`origin_map.js`). `renderOriginMarkers(containerEl, origins, selectedKey, onSelect)` mounts a Leaflet map into `containerEl` on first call (module-level singleton per page load). Marker clicks fire `onSelect(key)`. Adding new coffee regions means extending `coffeeOriginCatalog` in `origin_map.js`.

**Roast save flow** — Active session page stores a pending roast object in `sessionStorage`. Review page reads it, shows a preview chart, and POSTs to `/api/roasts` on confirm. If the tab is closed before saving, the pending roast is lost (known limitation).

**Simulated badge** — The server sets `simulated: bool` on `sensor_state` Socket.IO events. The dashboard and roast session pages show a gold `#simulatedBadge` pill when `state.simulated` is true.

**Security** — The app raises `RuntimeError` at startup if `SECRET_KEY == "devkey"` outside test mode. Photo uploads are validated for MIME type (jpeg/png/gif/webp) and raw size (≤ 5 MB / 7 MB base64) in routes.py.

## Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `SECRET_KEY` | `devkey` | Must be overridden in production |
| `SENSOR_MODE` | `simulated` | Set to `pigpio` on Pi hardware |
| `DATABASE_URL` | `sqlite:///instance/roasts.db` | SQLite path |
| `SENSOR_INTERVAL_SECONDS` | `2` | Sensor broadcast rate |
| `MAX_CHART_POINTS` | `300` | Frontend chart buffer |
| `MAX6675_CS_PIN` | `8` | GPIO chip-select for thermocouple |
| `MAX6675_CLK_PIN` | `11` | GPIO clock |
| `MAX6675_DO_PIN` | `9` | GPIO data-out |
| `SERVO_CONTROL_PIN` | `18` | GPIO for flame servo |
| `WIFI_SETUP_MODE` | `false` | Enables `/setup/wifi` provisioning page |

## API Surface

```
GET  /api/roasts           list saved roasts
POST /api/roasts           save roast + curve + photo
GET  /api/roasts/<id>      roast detail with curve + events
PATCH /api/roasts/<id>     update metadata, notes, rating, tasting notes
DELETE /api/roasts/<id>    remove roast + photo file
GET  /api/sensor/health    hardware health check
GET  /uploads/<filename>   serve saved photo files
```

## Test Suite

```bash
PYTHONPATH=. pytest -q
```

All tests use an in-memory SQLite DB and disable the background sensor task. 35 tests currently pass. Extend `test_app.py` for new routes or storage behavior; extend `test_sensor_service.py` for hardware mode changes.

## Common Gotchas

- `leaflet.js` must be loaded before `origin_map.js` on every page that shows a map. The lookup page loads it in `{% block scripts %}`, not `{% block head %}`.
- The `_originMap` singleton in `origin_map.js` is per-page-load. Calling `renderOriginMarkers` with a different container on the same page will silently reuse the first container.
- `wifi_service` only exposes the provisioning routes while `WIFI_SETUP_MODE=true`. The dashboard redirects to `/setup/wifi` when that flag is set.
- `make check` runs `python -m compileall` first — catch syntax errors before pytest.
