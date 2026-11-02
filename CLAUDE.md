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
app/static/js/roast_alarms.js   User alarms: localStorage store, pure evaluator, beep/speech
app/static/js/roast_assist.js   RoR flame assist: settings + pure step controller
app/static/js/reports.js        Ranking report table (sortable, CSV download)
app/services/roast_math.py      Server-side roast math: timestamps, event roles, phases, AUC, key temps, report rows
app/templates/reports.html      Ranking report page

config.py                    All env-var defaults
tests/test_app.py            Integration tests: routes, roast API, photo handling
tests/test_sensor_service.py Unit tests: sensor modes, servo, health
tests/test_sockets.py        Unit tests: sensor loop tick resilience
tests/test_frontend_js.py    node --check every static JS file + runs tests/js/*.test.js (skips without node)
tests/js/live_charts.test.js Node unit tests for RoR, phases, projections, alarms
```

## Architecture in One Paragraph

HTTP routes (routes.py) render pages and expose the REST API. Socket.IO (sockets.py) runs a background loop (`_sensor_loop` → `_sensor_tick` per iteration) that emits `sensor_data` events to connected browsers; a failing hardware read is logged and skipped so the loop never dies. `SensorService` is the single hardware abstraction — it either reads a MAX6675 via pigpio or generates a simulated roast curve. `roast_storage.py` owns all SQLite work without an ORM. The frontend captures sensor events in `sessionStorage` during an active roast, then posts them to `POST /api/roasts` on the review page.

## Critical Patterns

**Schema migration** — `roast_storage.py` uses a `schema_version` table. When adding a column, bump `_SCHEMA_VERSION` and add a `_migrate_vN(conn)` function. Never alter the baseline `CREATE TABLE` statement.

**Photo storage** — New roasts store photos as files at `instance/uploads/<uuid>.<ext>`; DB holds `photo_filename`. The API returns `photo_url` for new records and `photo_data` (legacy base64) for old ones. `lookup_page.js` checks `photo_url` before `photo_data`. DELETE endpoint removes the file from disk.

**Origin maps** — Both the dashboard and lookup page use Leaflet (`origin_map.js`). `renderOriginMarkers(containerEl, origins, selectedKey, onSelect)` mounts a Leaflet map into `containerEl` on first call (module-level singleton per page load). Marker clicks fire `onSelect(key)`. Adding new coffee regions means extending `coffeeOriginCatalog` in `origin_map.js`.

**Roast save flow** — Active session page stores a pending roast object in `sessionStorage`. Review page reads it, shows a preview chart, and POSTs to `/api/roasts` on confirm. If the tab is closed before saving, the pending roast is lost (known limitation).

**Simulated badge** — The server sets `simulated: bool` on `sensor_state` Socket.IO events. The dashboard and roast session pages show a gold `#simulatedBadge` pill when `state.simulated` is true.

**Security** — The app raises `RuntimeError` at startup if `SECRET_KEY` is unset or one of the placeholders in `config.INSECURE_SECRET_KEYS` (`devkey`, `change-me`) outside test mode; `make run` / `dev.sh run` generate a throwaway key when none is exported. Photo uploads are validated for MIME type (jpeg/png/gif/webp) and raw size (≤ 5 MB / 7 MB base64) in routes.py.

**Hardware health** — In pigpio mode `SensorService.health_status()` reports the sensor loop's most recent MAX6675 read (fresh within `_FRESH_READ_INTERVALS` × `interval_seconds`) instead of reading the chip itself; it only reads directly when the loop is paused, not yet started, or failing. Every bit-banged read holds `_bus_lock`, so a direct read can never interleave its clock pulses with the loop's under eventlet. Health is polled every 10 s by the roast session, the dashboard, and the settings page.

**Sensor faults** — In pigpio mode a failed MAX6675 read yields a `sensor_data` sample with `temperature: null` and an `error` string; simulated values are never substituted for a faulting sensor (simulation only runs when `source == "simulated"`). `_sensor_tick` broadcasts fault samples (throttled warning log) and counts them as failures. Pages render `-- °C` via `hasSensorTemperature()` in `live_charts.js`; the roast session skips the point (gap in the curve), logs one deduped `Sensor fault` hardware-issue event through `reportSensorFault()` (shared with the health poll), and logs `Sensor Recovered` when readings resume.

**HTML escaping** — Any data rendered through an innerHTML template literal (bean name, origin, roast level, notes, event label/detail, counts, and date formatters that echo unparseable input) goes through `escapeHtml()` from `live_charts.js`, including attribute values. Single values use `textContent`. Never interpolate raw data into innerHTML; imported JSON is untrusted.

**Roast export/import** — `GET /api/roasts/<id>/export` returns a portable `{format, version, roast}` document (Content-Disposition attachment) with photos embedded as a base64 `photo_data` URL. `POST /api/roasts/import` accepts a single export doc, a bare roast object, or a list/`{items|roasts}`; it validates **every** entry via `_normalize_roast_payload` before touching disk or DB, then writes all photos and inserts all rows in one transaction (`save_roast_sessions`); any failure removes the written photos and imports nothing. Incoming `id`s are dropped and fresh ones assigned. `create_roast` and `import_roasts` share `_normalize_roast_payload`, which also type-checks `curve` (list of `{timestamp: str, temperature: finite number}`), `events` (list of objects with a non-empty `label`), `notes`/`taste_notes` (text or null), and `rating` (1–5 or null), coercing numeric strings in place so a bad record is a 400, never a 500.

**Rate-of-rise & turn point** — Client-side only, in `live_charts.js`. `buildRorSeries(curve, {windowSeconds, smoothingPoints})` fits a least-squares slope over the trailing window (no points until half a window of history exists) and then applies a trailing moving average; defaults come from `getRoastSettings()`. `enableRorOverlay(chart)` adds a dataset tagged `roasterRole: "ror"` on the right-hand `y1` axis (temperature stays dataset 0 so `stageMarkerPlugin` is unaffected; every overlay is found by role via `findDataset`, never by index). `detectTurningPoint(curve, {startedAt, riseThreshold})` returns the confirmed post-charge minimum, drawn as a stage marker by `rebuildStageMarkers` in `roast_session.js`. No server storage — these are derived from the saved curve. Sensor timestamps are `HH:MM:SS.mmm` (`_sample_timestamp()` in `sensor_service.py`); `parseRoastTimestamp` accepts both with and without the millisecond suffix.

**Roast events & phases** — Session buttons mark `Pre Roast`, `Charge`, `Dry End`, `First Crack`, `First Crack End`, `Second Crack`, `Drop`. `ROAST_EVENT_ROLES` / `findRoastEvent(events, role)` in `live_charts.js` map roles to labels and still accept the legacy `Start`/`Finish` labels from older saved roasts — always look events up by role, never by literal label. `buildRoastPhases(curve, events, {startedAt, endedAt})` returns Artisan's three phases (drying = Charge→Dry End, Maillard = Dry End→First Crack, development = First Crack→Drop; merged "Drying + Maillard" when Dry End is missing) with seconds, percent, ΔT and average RoR, plus `dtr`. `buildPhaseBands()` feeds the `phaseBandPlugin` (green/yellow/brown bands behind the curve) and `renderPhaseSummary(el, phases)` draws the shared phase bar + table used by the session, review and lookup pages. The session page also shows LCD readouts (`.lcd-strip`) and a Dry End / First Crack ETA from `projectSecondsToTemperature()` against the target temps in roast settings.

**Flame step curve** — `enableFlameOverlay(chart)` + `setFlameSeries(chart, buildFlameSeries(curve))` draw the per-sample `flame_level` as a `stepped: "after"` dataset on a hidden `y2` axis (0–320 so it sits under the bean curve); `flameStepLabelPlugin` labels each step change with its percentage. Enabled on the session, review and lookup charts.

**Reference roast overlay** — The setup page offers a `reference_id` (any saved roast with samples); `roast_session_page` validates it as a positive integer and exposes it as `data-reference-id`. `roast_session.js` fetches `/api/roasts/<id>`, draws it via `enableReferenceOverlay` / `setReferenceSeries` (faint temperature + dashed flame, both aligned at Charge), adds `style: "reference"` stage markers (dotted, labelled at the bottom), shows a live "vs Reference" LCD (ΔT at the same elapsed time, and seconds ahead/behind to reach the current temperature, searched after the reference's turn point), and pops a toast cue when the live roast reaches the time of each reference event/flame change (Artisan's playback aid). The reference id is kept in the roast draft so a resumed roast reloads it. The lookup page reuses the same overlay as a "Compare with" comparator.

**Alarms** — `roast_alarms.js` stores alarms per device in `localStorage` (`roasterAlarms`): `{source, value, fromEvent, action, flameLevel, message, enabled}`. Sources: bean temp ≥/≤, RoR ≤/≥, time after event. `fromEvent` gates the alarm until that event is marked (`charge`/`dryEnd`/`firstCrack`/`any`). `evaluateRoastAlarm(alarm, {temperature, ror, now, eventTimes})` is pure (null readings never compare as 0); `roast_session.js` evaluates on every sample and every 1 s tick, fires once per roast (`firedAlarmIds`, reset in `beginRecording`, persisted in the draft), and actions are toast/notification, WebAudio beep, `speechSynthesis`, or `applyFlameLevel(level, {source: "alarm"})` which moves the servo and logs a `Flame Change` event. Every fired alarm also logs an `Alarm` event.

**Roast settings** — `getRoastSettings()` / `saveRoastSettings()` in `live_charts.js` keep per-device values in `localStorage` (`roasterSettings`): `rorWindowSeconds`, `rorSmoothingPoints`, `dryEndTargetC`, `firstCrackTargetC`, `aucBaseC`. Edited on the settings page ("Roast Analysis" panel). Nothing server-side.

**Roast properties (schema v3)** — `ROAST_PROPERTY_COLUMNS` in `roast_storage.py` defines `roasted_weight_grams`, `roast_color`, `green_moisture_percent`, `batch_label`, `ambient_temp_c`; the INSERT/SELECT/UPDATE statements are built from that tuple, so adding a property means extending it plus `_NUMERIC_PROPERTIES` / `_TEXT_PROPERTIES` in `routes.py`. `_normalize_roast_properties(payload, only_present=…)` validates them for create/import (fills defaults) and PATCH (touches only the fields sent). `weight_loss_percent` is derived on read (list + detail) and never stored. The review page collects them right after the roast (kept on the pending payload), the edit page changes them later, the lookup detail shows them beside the client-side key temperatures (`buildKeyTemperatures`).

**Server-side roast math** — `app/services/roast_math.py` mirrors the client helpers (`parse_timestamp` for `HH:MM:SS[.mmm]`/ISO, `EVENT_ROLES`, `phase_summary`, `area_under_curve`, `key_temperatures`, `roast_report_row`). Keep the two in sync when changing phase or AUC definitions; `tests/test_roast_math.py` and `tests/js/live_charts.test.js` pin the same numbers. **Timezones:** sample stamps are the server's *local* wall clock while event times are UTC ISO instants; both parsers apply the clock to the anchor's local date and convert to UTC (the browser via `setHours`, Python via `astimezone()`), so the Pi and the browser must share a timezone. Test helpers that fabricate clock stamps must derive them from the UTC instant with `.astimezone()`.

**AUC** — Area under the bean curve above `aucBaseC` (default 150 °C) from Dry End (else the turning point, else charge) to drop, trapezoidal, in °C·min. `buildAuc()` client-side (session, review, lookup), `roast_math.area_under_curve()` for the report (`?auc_base=`).

**Exports** — `GET /api/roasts/<id>/export.csv` (elapsed seconds from charge, sample timestamp, bean temp, flame %, event labels attached to the nearest sample) and `GET /api/roasts/<id>/export.alog` (Artisan profile: a Python dict literal with `timex`/`temp2` = bean temp, `temp1` = -1 for the missing environment probe, `timeindex` sample indices for CHARGE/DRYe/FCs/FCe/SCs/SCe/DROP/COOL, flame moves as Burner events with `specialeventsvalue = flame/10 + 1`). Artisan opens it via File › Open; `ast.literal_eval` parses it in tests.

**Ranking report** — `/reports` renders `reports.html`; `reports.js` fetches `GET /api/roasts/report` (one `roast_report_row` per saved roast), sorts client-side, downloads CSV, and deep-links rows to `/lookup?roast=<id>` (handled in `lookup_page.js`).

**Safety cutoffs** — `sockets.py` enforces `MAX_BEAN_TEMP_C` (flame to 0% once the probe reaches it, re-armed 5 °C below) and `SENSOR_FAULT_FLAME_POLICY=min` (flame to 0% after `SENSOR_FAULT_FLAME_AFTER` consecutive faults; `hold` leaves it). `_safety_cutoff()` emits a `safety_event` Socket.IO message plus `sensor_state`; `roast_session.js` logs a `Safety Cutoff` event, beeps, and disables flame assist. `/api/sensor/health` reports the limits under `safety`; the settings page shows them.

**Flame assist** — `roast_assist.js` keeps settings in `localStorage` (`roasterFlameAssist`) and exposes the pure `computeAssistAdjustment({ror, target, currentFlame, settings})`: a step controller (not PID) that moves the flame by `stepPercent` when the smoothed RoR is outside `target ± deadband`, bounded by min/max flame. `roast_session.js` runs it on the 1 s tick once per `intervalSeconds`, only while recording after Charge with a RoR available; any non-assist flame change (slider, alarm) pauses it for one interval, and Drop or a safety cutoff disables it. Target is fixed or the reference roast's RoR at the same elapsed time (`roastReference.rorSeries`).

**UI system** — `app/static/css/app.css` is a flat dark theme driven by tokens on `:root` (`--surface`, `--surface-2/3` for nested cards, `--border`, `--accent` reserved for primary actions and live values, `--radius` 14px / `--radius-sm` 10px, `--touch-target`). Rules of thumb: panels are `.panel` cards, nested blocks are `.summary-block` / `.history-item`, labels are `.metric-label` (uppercase; wrap units like `(µs)` in `<span class="no-caps">`), key/value rows are `.status-pill` with the value in the **first `<span>`** (it is pushed right), and every grid child gets `min-width: 0` so wide content (tables, canvases) never widens the page. The generic `button` rule is `inline-flex` + centered, so a button that contains block children (`.lookup-item`, `.calendar-cell`) must set `display: grid; justify-content: stretch`. Below 720px the nav becomes a fixed five-tab bottom bar. Headless Chrome will not shrink below ~500px wide, so check the mobile breakpoint at 540px, not 414px.

**Toasts** — `toast.js` exposes a global `showToast(message, type)` (`success`/`error`/`info`); it's loaded in `base.html` before `live_charts.js` and renders into `#toastRegion`. Used alongside (not replacing) existing inline messages for save/delete/edit outcomes.

**PWA / offline** — The app is an installable, offline-capable PWA so it works on the Pi's internet-less direct-AP network. Third-party libs (Chart.js, Socket.IO, Leaflet + images) are **vendored** in `app/static/vendor/` — never re-add CDN `<script>`/`<link>` tags. `app/static/sw.js` is the service worker, served from root via the `/sw.js` route (with `Service-Worker-Allowed: /`) and registered in `base.html`; it precaches the app shell, is network-first for navigations and `/api/roasts*` (cache fallback), and **network-only** for Socket.IO and `/api/sensor/health`. Bump `CACHE_VERSION` in `sw.js` when precached assets change. `manifest.webmanifest` + `app/static/icons/` make it installable (`.webmanifest` MIME type registered in `app/__init__.py`). Map tiles are vendored locally (CARTO dark_all, zoom 0–4) under `app/static/vendor/tiles/{z}/{x}/{y}.png`; `origin_map.js` points Leaflet there with `maxZoom: 4`, so the world map works fully offline. The roast session keeps a screen Wake Lock while recording, fires `notifyRoast()` alerts (turn point / RoR crash / hardware issue), and persists an in-progress roast draft + the pending-review payload to `localStorage` so they survive a tab close/crash.

## Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `SECRET_KEY` | `devkey` | Must be overridden in production |
| `SENSOR_MODE` | `simulated` | Set to `pigpio` on Pi hardware |
| `DATABASE_URL` | `sqlite:///roasts.db` | SQLite path, resolved relative to `instance/` |
| `SENSOR_INTERVAL_SECONDS` | `2` | Sensor broadcast rate |
| `MAX6675_CS_PIN` | `8` | GPIO chip-select for thermocouple |
| `MAX6675_CLK_PIN` | `11` | GPIO clock |
| `MAX6675_DO_PIN` | `9` | GPIO data-out |
| `SERVO_CONTROL_PIN` | `18` | GPIO for flame servo |
| `WIFI_SETUP_MODE` | `false` | Enables `/setup/wifi` provisioning page |
| `MAX_BEAN_TEMP_C` | `250` | Flame cut to 0% at this bean temp; `0` disables |
| `SENSOR_FAULT_FLAME_POLICY` | `hold` | `min` cuts the flame after repeated thermocouple faults |
| `SENSOR_FAULT_FLAME_AFTER` | `5` | Consecutive faults before the `min` policy acts |

## API Surface

```
GET  /api/roasts                list saved roasts (?limit=N|all, default 8; bad limit → 400)
POST /api/roasts                save roast + curve + photo
GET  /api/roasts/<id>           roast detail with curve + events
PATCH /api/roasts/<id>          update metadata, notes, rating, tasting notes
DELETE /api/roasts/<id>         remove roast + photo file
GET  /api/roasts/<id>/export    download a single roast as portable JSON
GET  /api/roasts/<id>/export.csv   curve + events as CSV
GET  /api/roasts/<id>/export.alog  Artisan profile (dict literal) for File › Open in Artisan
GET  /api/roasts/report         per-roast statistics for the ranking report (?auc_base=150)
POST /api/roasts/import         restore one or many roasts from exported JSON
GET  /api/sensor/health         hardware health check (incl. servo pulse-width range)
POST /api/sensor/calibration    set + persist servo min/max pulse width (flame endpoints)
GET  /uploads/<filename>        serve saved photo files
```

## Test Suite

```bash
PYTHONPATH=. pytest -q
```

All tests use an in-memory SQLite DB and disable the background sensor task. 112 tests currently pass. Extend `test_app.py` for new routes or storage behavior, `test_roast_features.py` for properties/exports/report, `test_roast_math.py` for the server-side math, `test_sockets.py` for the sensor loop and safety cutoffs, and `test_sensor_service.py` for hardware mode changes. Frontend roast math lives in `tests/js/*.test.js` (node's built-in runner, invoked by `tests/test_frontend_js.py`); `live_charts.js`, `roast_alarms.js` and `roast_assist.js` export their pure helpers via a `module.exports` guard for this.

## Common Gotchas

- `leaflet.js` must be loaded before `origin_map.js` on every page that shows a map. The lookup page loads it in `{% block scripts %}`, not `{% block head %}`.
- The `_originMap` singleton in `origin_map.js` is per-page-load. Calling `renderOriginMarkers` with a different container on the same page will silently reuse the first container.
- `wifi_service` only exposes the provisioning routes while `WIFI_SETUP_MODE=true`. The dashboard redirects to `/setup/wifi` when that flag is set.
- `make check` runs `python -m compileall` first — catch syntax errors before pytest.
