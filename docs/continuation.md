# Continuation Notes

Last updated: 2026-11-02

## Purpose

Restart point for future development sessions: what exists, what matters, and
where the next changes most likely go. Read `CLAUDE.md` first for the patterns
and gotchas; this file carries the narrative, the deployment state, and the
backlog.

## Where Things Stand

- **Deployed.** The roaster Pi runs `master` as `roaster-server.service` in
  `pigpio` mode behind its own `Roaster` access point (hostapd + dnsmasq at
  `10.42.0.1`), with Ethernet for admin access. It has no GitHub credentials;
  deploy by pushing from a workstation (`docs/pi-setup.md` → Deploying Updates).
  Python changes need a service restart; static-file changes need a
  `CACHE_VERSION` bump in `sw.js` instead.
- **Tests.** 72 pass via `make check`. There is no committed JS test harness;
  frontend changes are checked with `node --check` plus ad-hoc stubbed-DOM
  harnesses (plain Node `vm`, no dependencies) during development.
- **Sudo on the Pi.** `deploy/sudoers-roaster-server` grants `pi` passwordless
  `nmcli` and `systemctl restart roaster-server.service`. Check whether it is
  installed with `sudo -n -l` on the Pi; if the restart rule is missing, run
  step 4 of `docs/pi-setup.md`.
- **No saved roasts yet on the Pi** as of this date, so the 2026-11 changes
  below are verified by tests and harnesses, not by a real roast.

### Changes landed 2026-11-01 → 2026-11-02 (all on `master`, all deployed)

1. Pulled three commits that existed only on the Pi: settings page with
   hardware check, servo flame calibration (persisted), PWA install banner.
2. Saved roast curves are no longer truncated to the last 30 samples
   (`MAX_CHART_POINTS` removed; the chart never needed a rolling window).
3. `SECRET_KEY` guard actually fires (default is `devkey`, placeholders
   rejected); `make run` / `dev.sh run` generate a throwaway dev key.
4. Sensor loop survives read exceptions (`_sensor_tick`), and a thermocouple
   fault is broadcast as `temperature: null` + `error` instead of a fabricated
   simulated value. Pages show `-- °C`; the session logs Hardware Issue /
   Sensor Recovered events and leaves a gap in the curve.
5. Health check no longer bit-bangs the MAX6675 while the loop is sampling
   (reports the loop's last read; all reads hold `_bus_lock`).
6. API hardening: strict `_normalize_roast_payload` (curve/events/notes/rating
   types, numeric-string coercion), atomic import (photos first, one DB
   transaction, cleanup on failure), `?limit` validation.
7. Every innerHTML template escapes data via `escapeHtml()`.
8. Sudoers rules shipped in `deploy/` and installed by
   `scripts/install_pi_service.sh`; docs gained a Deploying Updates section.
9. Docs refreshed; `make run` sets `EVENTLET_HUB=selects` on macOS.

## Current Priorities

1. **Validate on a real roast.** Next time the roaster runs: confirm the saved
   `sample_count` is about `total_roast_seconds / 2`; unplug the thermocouple
   for a few seconds and confirm `-- °C`, a Hardware Issue event, a Sensor
   Recovered event, and a gap in the curve; confirm the turn-point marker.
2. **Roast analytics on saved charts.** RoR overlay and turn point are live-only
   (`live_charts.js`); the review and lookup charts could reuse them.
   Comparative batch overlays remain open.
3. **Persistence / UI gaps.** Import is endpoint-only (no UI on the lookup
   page); batch export of all roasts; richer tasting history.
4. **Hardware polish.** Clearer diagnostics on the settings page, multi-sensor
   support. Servo calibration itself is done.
5. **Dev ergonomics.** Commit a JS test harness (the stubbed-DOM pattern works
   in plain Node); set `MAX_CONTENT_LENGTH` to bound import bodies.

## Current Product State

```text
Dashboard (/)
  -> monthly roast calendar
  -> interactive global roast origin map (Leaflet, vendored tiles z0–4)
  -> clickable selected-origin roast list
  -> hardware health panel, simulated-mode badge
  -> live temperature (shows -- °C on a sensor fault)

Roast setup (/roast)
  -> bean name, origin, roast level, batch weight
  -> recent roast history

Active roast session (/roast/session)
  -> live temperature graph with RoR overlay and turn-point marker
  -> pre-roast / start / first crack / second crack / finish
  -> servo flame slider (flame changes logged as events)
  -> hardware widget, 10 s health poll, fault + recovery events
  -> screen Wake Lock, notifications (turn point, RoR crash, hardware)
  -> full curve kept; draft persisted to localStorage, resumable

Roast review (/roast/review)
  -> summary + analytics, graph preview of the exact curve to be saved
  -> optional photo upload (MIME + size validated)
  -> save (POST /api/roasts) or cancel; payload survives tab close

Lookup (/lookup)
  -> saved roast list + text search, origin filter map
  -> curve with event badges, analytics, rating, tasting notes, photo
  -> edit / export / remove

Post-roast edit (/lookup/<id>/edit)
  -> bean / origin / level / weight, roast notes, rating, taste notes

Settings (/settings)
  -> live hardware check (temperature, servo, mode, last error)
  -> servo min/max pulse-width calibration, persisted to instance/calibration.json

Wi-Fi setup (/setup/wifi, only while WIFI_SETUP_MODE=true)

PWA: installable, offline app shell + saved-roast cache, vendored libs/tiles
```

## Important Technical Decisions

- Temperature-only telemetry. Humidity and pressure were intentionally removed.
- `SensorService` is the single hardware abstraction. Simulated mode is
  first-class and must keep working without hardware, but it is never used to
  paper over a faulting sensor: a failed read in `pigpio` mode is a fault sample.
- All MAX6675 reads hold `_bus_lock`; `health_status()` reports the loop's
  most recent read and only reads the chip directly when the loop is idle.
- The sensor loop is one `_sensor_tick()` per interval and never dies on an
  exception; failures are logged with throttling and recovery is logged.
- Roasts are not written to the database during the roast. The session page
  keeps the full curve in memory, mirrors a draft to `localStorage`, and hands
  the finished payload to the review page through `localStorage`. The review
  page shows exactly what will be saved, then POSTs.
- `POST /api/roasts` and `POST /api/roasts/import` share
  `_normalize_roast_payload`, which rejects malformed records with a 400.
  Import is all-or-nothing: photos first, rows in one transaction
  (`save_roast_sessions`), cleanup on any failure.
- Cup feedback (rating, tasting notes) is only added after a roast is saved.
- Delete is explicit and manual from lookup. No soft deletes.
- Photo storage: files under `instance/uploads/<uuid>.<ext>`, `photo_filename`
  in the DB; legacy rows keep base64 `photo_data`. DELETE removes the file.
- Schema migration: `schema_version` table; bump `_SCHEMA_VERSION` and add
  `_migrate_vN(conn)`. Never alter the baseline `CREATE TABLE`.
- `SECRET_KEY` must be a real value outside tests (`config.INSECURE_SECRET_KEYS`
  lists the rejected placeholders).
- User-entered text only reaches innerHTML through `escapeHtml()`.
- Third-party libraries and map tiles are vendored; no CDN tags.
- Direct-AP networking runs on hostapd + dnsmasq (NetworkManager's AP mode
  fails on the Pi's brcmfmac chip). The systemd unit runs `run.py` directly.

## Key Files

### Server

- `run.py` — eventlet monkey patch + server start
- `app/__init__.py` — app factory, config, `SECRET_KEY` guard, DB init
- `app/web/routes.py` — pages, JSON API, payload validation, photo handling,
  export/import, health, calibration, captive-portal probes, `/sw.js`
- `app/sockets.py` — sensor loop (`_sensor_tick`), fault broadcast, controls
- `app/services/sensor_service.py` — simulated + pigpio modes, servo, bus lock,
  cached health
- `app/services/calibration.py` — servo pulse-width persistence
- `app/services/roast_storage.py` — SQLite, schema versioning,
  `save_roast_sessions`
- `app/services/wifi_service.py` — nmcli wrapper for provisioning

### Frontend

- `app/templates/*.html` — one per page plus `base.html` (PWA metadata,
  install banner, service-worker registration)
- `app/static/js/live_charts.js` — Chart.js setup, stage markers, RoR, turn
  point, analytics, `escapeHtml`, `hasSensorTemperature`
- `app/static/js/roast_session.js` — most of the roast-flow logic
- `app/static/js/roast_review.js`, `lookup_page.js`, `lookup_edit.js`,
  `dashboard.js`, `roast_setup.js`, `settings.js`, `pwa_install.js`, `toast.js`
- `app/static/js/origin_map.js` — Leaflet map singleton + origin alias catalog
- `app/static/sw.js` — service worker; `manifest.webmanifest`; `icons/`
- `app/static/vendor/` — Chart.js, Socket.IO, Leaflet (+ images), map tiles

### Deployment

- `deploy/roaster-server.service`, `deploy/roaster-server.env.example`
- `deploy/sudoers-roaster-server`
- `deploy/ap/` — hostapd, dnsmasq, NetworkManager drop-ins
- `scripts/install_pi_service.sh`, `scripts/install_pi_ap.sh`,
  `scripts/wifi_provisioning_bootstrap.sh`, `scripts/dev.sh`,
  `scripts/seed_test_roasts.py`
- `docs/pi-setup.md` — install, network modes, deploying updates

## Current Storage Shape

`roast_sessions` (schema version 2): bean_name, origin, roast_level, notes,
taste_notes, rating, weight_grams, total_roast_seconds, flame_level,
sample_count, started_at, ended_at, created_at, curve_json, events_json,
photo_filename (new), photo_data (legacy).

Also in `instance/`: `uploads/` (photos) and `calibration.json` (servo range).

## Current Hardware Behavior

```text
SENSOR_MODE=simulated (or pigpio daemon unreachable)
  -> simulated temperature curve, source="simulated", simulated badge shown
  -> health always healthy

SENSOR_MODE=pigpio
  -> MAX6675 read via pigpio bit-banging, under _bus_lock
  -> open circuit -> sample {temperature: null, error: "Thermocouple open circuit"}
  -> read exception -> tick skipped, logged (throttled), loop continues
  -> servo pulse width from flame slider, range from env or saved calibration
  -> /api/sensor/health reports the loop's last read (direct read only if stale)
```

## Known Constraints / Risks

- Curve timestamps are `HH:MM:SS` without a date; elapsed-time math would
  misbehave for a roast that crosses midnight.
- The roast draft is re-serialized to `localStorage` on every sample. Fine for
  hours of roasting; unbounded in principle if a session is left running.
- Health is polled every 10 s; not event-driven.
- `_originMap` is a per-page singleton; origin mapping is alias-based and may
  need new aliases in `coffeeOriginCatalog`.
- The Pi's single Wi-Fi radio: enabling AP mode drops any Wi-Fi SSH session.
  Use Ethernet for admin.
- The Pi cannot reach GitHub; deploys are pushes from a workstation.
- Local dev venv is Python 3.9 with eventlet 0.39 (maintenance mode); the Pi
  runs Python 3.13. On macOS the kqueue hub crashes, hence `EVENTLET_HUB=selects`.
- No request-size limit (`MAX_CONTENT_LENGTH`) on imports yet.
- No committed JS tests.

## Recommended Restart Checklist

```bash
make check
make run
```

Then verify:

1. Dashboard loads with the Leaflet origin map and hardware health panel.
2. `/settings` shows live temperature and the calibration slider.
3. Roast setup opens `/roast/session`; Pre Roast starts logging; Finish opens
   the review with the full curve; Save lands in lookup with the right
   `sample_count`.
4. Lookup detail, edit, export, and remove work; import round-trips an export.
5. `/api/sensor/health` returns the expected shape.
6. On the Pi only: unplug the thermocouple briefly and confirm the fault UI.

## Test Coverage Snapshot

- Pages render (incl. `/settings`); PWA manifest + service worker served.
- Roast create/detail/summary; payload validation (14 malformed cases) and
  coercion; `?limit` validation; patch/delete; photo type/size; export/import
  round trip and atomicity (invalid entry, photo failure, DB failure,
  storage-level rollback).
- Wi-Fi setup routes; captive-portal probes; `SECRET_KEY` guard.
- Sensor service: simulated shape, MAX6675 read, open-circuit fault sample,
  servo mapping, health (cached, stale fallback, direct-read failure), bus lock.
- Sensor loop tick: exception survival, fault broadcast, recovery, paused.

`PYTHONPATH=. pytest -q` — 72 passed on 2026-11-02.

## Latest Commits

- `ab01e21` Ship the Pi sudoers rules in deploy/ and install them from the service script
- `7e0a9a8` Escape user-entered text in every innerHTML template
- `e2501f4` Harden the roast API: strict payload validation, atomic import, limit guard
- `e3cbd69` Report thermocouple faults as faults instead of fabricating temperatures
- `ccf0b91` Stop the health check racing the sensor loop on the MAX6675 bus
- `50f1f06` Make the SECRET_KEY guard real and keep the sensor loop alive on read errors
- `3ae4381` Keep the full roast curve instead of truncating to MAX_CHART_POINTS
- `685eb2e` Add persistent flame calibration to the settings page
- `88865e2` Add settings page: hardware check + flame calibration slider
- `228ca20` Run the Raspberry Pi direct-AP on hostapd instead of NetworkManager

## Notes For Future Me

- Read `CLAUDE.md` first; then `docs/pi-setup.md` before touching the Pi.
- Check the Pi's `git log -1` against `origin/master` before starting: work
  has been committed directly on the Pi before.
- Roast-flow work: `app/static/js/roast_session.js` and `live_charts.js`.
- Map or origin matching: `app/static/js/origin_map.js`.
- Hardware: `app/services/sensor_service.py`, `app/sockets.py`.
- Persistence or schema: `app/services/roast_storage.py`.
