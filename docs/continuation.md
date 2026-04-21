# Continuation Notes

Last updated: 2026-04-21

## Purpose

This document is a restart point for future development sessions. It summarizes what already exists, what is important not to forget, and where the most likely next changes should happen.

## Current Priorities

1. Improve the active roast workflow with richer roast analytics.
   - Implemented: roast duration, development time, development ratio, peak temperature, batch weight, saved total roast time, flame-level tracking.
   - Good follow-up candidates: turn-point detection, stronger graph annotations, comparative batch overlays, rate-of-rise display.

2. Improve persistence for media and roast records.
   - Implemented: photos now stored on disk at `instance/uploads/<uuid>.<ext>` instead of base64 in SQLite. `schema_version` table drives additive migrations.
   - Still open: export/import for roast sessions, richer tasting-history tracking.

3. Improve Raspberry Pi hardware polish.
   - Servo calibration UI, clearer diagnostics, better recovery from hardware faults are the main remaining gaps.

## Current Product State

```text
Dashboard
  -> monthly roast calendar
  -> interactive global roast origin map (Leaflet)
  -> clickable selected-origin roast list
  -> hardware health panel
  -> simulated-mode badge

Roast setup
  -> bean name
  -> origin
  -> roast level
  -> batch weight

Active roast session
  -> live temperature graph
  -> pre-roast / start / first crack / second crack / finish
  -> servo flame control
  -> hardware widget with issue logging
  -> simulated-mode badge

Roast review
  -> summary before save
  -> batch weight + total roast time
  -> graph preview of the exact curve to be saved
  -> optional photo upload (MIME + size validated)
  -> save or cancel

Lookup
  -> saved roast list + text search
  -> compact interactive global origin filter map (Leaflet)
  -> temperature curve with event badges
  -> edit roast button
  -> remove roast button
  -> cup rating and tasting notes display
  -> saved photo (photo_url for new records, photo_data fallback for legacy)

Post-roast edit
  -> edit bean/origin/level/weight
  -> edit roast notes
  -> rating after tasting
  -> taste notes after brewing/cupping
```

## Important Technical Decisions

- Temperature-only telemetry. Humidity and pressure were intentionally removed.
- `SensorService` is the single hardware abstraction layer.
- `pigpio` hardware mode supports MAX6675 temperature reads, servo pulse control for roast flame, and hardware health reporting.
- Simulated mode is first-class. Development without Pi hardware must keep working.
- Roast sessions are not written to the database immediately on `Finish`. The active roast page stores a pending roast in browser `sessionStorage`. The review page shows the exact graph curve that will be saved, then decides whether to save or cancel.
- Cup feedback is intentionally separate from roast capture. Rating and tasting notes can only be added once the roast has been saved.
- Delete is explicit and manual from lookup. No soft deletes.
- Photo storage: new roasts write files to `instance/uploads/<uuid>.<ext>`. The DB stores `photo_filename`. The API returns `photo_url` for new records and `photo_data` (legacy base64 string) for old ones. The DELETE endpoint removes the file from disk.
- Schema migration: `roast_storage.py` uses a `schema_version` table. Bump `_SCHEMA_VERSION` and add `_migrate_vN(conn)` when adding columns. Never alter the baseline `CREATE TABLE`.
- Both the dashboard and lookup origin maps use Leaflet via `origin_map.js`. The module-level `_originMap` singleton is created on first call to `renderOriginMarkers`. Both pages must load `leaflet.js` before `origin_map.js`.

## Key Files

### Server

- `run.py` — app entry point, eventlet monkey patch + server start
- `app/__init__.py` — Flask app factory, config load, route and socket registration, DB init
- `app/web/routes.py` — HTML routes, JSON API routes, photo validation, sensor health endpoint
- `app/sockets.py` — background sensor loop, Socket.IO control handling, flame-control events, simulated flag

### Services

- `app/services/sensor_service.py` — simulated mode, MAX6675 pigpio mode, servo flame control, health checks
- `app/services/roast_storage.py` — SQLite setup, schema versioning, roast session persistence, photo file storage, roast updates and deletion

### Frontend

- `app/templates/dashboard.html` — monthly roast calendar, Leaflet origin map, selected-origin roast list, hardware health widget
- `app/templates/roast.html` — roast setup page
- `app/templates/roast_session.html` — active roast UI, live graph, roast control buttons, hardware widget
- `app/templates/roast_review.html` — save/cancel step, saved-curve preview, photo upload
- `app/templates/lookup.html` — saved roast browser, Leaflet origin filter map, edit/remove actions, tasting feedback, photo
- `app/templates/lookup_edit.html` — full post-roast editor

- `app/static/js/origin_map.js` — shared Leaflet map init, coffee-region alias matching, `renderOriginMarkers`
- `app/static/js/dashboard.js` — dashboard calendar and health panel, origin map wiring
- `app/static/js/roast_session.js` — most active frontend logic: roast stages, flame control, hardware polling, issue recording
- `app/static/js/roast_review.js` — pending roast review and save/cancel logic, review chart preview
- `app/static/js/lookup_page.js` — roast detail loading, origin map filtering (onSelect callback), event badges, edit/remove, photo display
- `app/static/js/lookup_edit.js` — post-roast property loading and saving

## Current Storage Shape

The `roast_sessions` table stores:

- roast metadata (bean_name, origin, roast_level, notes, taste_notes, rating)
- `weight_grams`, `total_roast_seconds`, `flame_level`
- `curve_json`, `events_json`
- `photo_filename` (new) — path relative to `instance/uploads/`
- `photo_data` (legacy) — base64 data URL for records created before the disk-storage migration

Schema is managed through the `schema_version` table. Current version: 2.

## Current Hardware Behavior

```text
SENSOR_MODE=simulated
  -> simulated temperature curve
  -> simulated health returns healthy
  -> flame level tracked logically
  -> sensor_state events carry simulated=True

SENSOR_MODE=pigpio
  -> MAX6675 read via pigpio bit-banging
  -> servo pulsewidth updates from flame slider
  -> /api/sensor/health checks temperature + servo path
```

## Known Constraints / Risks

- Roast review persistence depends on browser `sessionStorage`. If the tab is closed unexpectedly before save, the pending roast is lost.
- `_originMap` in `origin_map.js` is a module-level singleton per page load. Only one Leaflet map can exist per page. Both pages must load `leaflet.js` before `origin_map.js`.
- Origin mapping is alias-based. New or unusual origin strings may need extra aliases in `coffeeOriginCatalog`.
- Sensor polling and health checks are simple and synchronous. If hardware latency grows this could affect responsiveness.
- The active roast page polls hardware health every 10 seconds. Not event-driven.

## Suggested Next Development Options

1. Improve roast data quality
   - rate-of-rise calculations
   - graph annotations beyond vertical markers
   - comparative batch overlays

2. Improve persistence
   - export/import for roast sessions
   - richer tasting-history tracking per roast

3. Improve hardware integration
   - explicit servo calibration UI
   - multi-sensor support
   - more detailed Pi diagnostics

4. Improve frontend usability
   - better mobile layout on roast session page
   - toast notifications
   - richer lookup filters/search
   - map clustering or tooltips for dense origin regions

## Recommended Restart Checklist

```bash
make check
make run
```

Then verify:

1. Dashboard loads with Leaflet origin map and hardware health panel.
2. Roast setup opens `/roast/session`.
3. Roast review opens after `Finish` and shows graph preview.
4. Dashboard origin markers and rollup entries are clickable.
5. Lookup displays saved roasts, the Leaflet origin filter map, and links to post-roast edit.
6. Lookup origin map markers filter the roast list when clicked.
7. Lookup edit saves roast property changes correctly.
8. Lookup remove deletes the selected roast (and photo file if present) and refreshes the list.
9. `/api/sensor/health` returns expected hardware status.

## Test Coverage Snapshot

Current automated coverage:

- page rendering (dashboard, roast, lookup, lookup edit)
- roast create/detail/summary APIs
- roast feedback patch API, missing-roast 404, malformed body 400
- photo upload: valid type saves to disk, invalid type rejected, oversized rejected, DELETE removes file
- lookup edit page render
- sensor health endpoint
- simulated sensor behavior
- MAX6675 reading behavior
- servo pulse mapping
- hardware health reporting

Latest automated verification:

- `PYTHONPATH=. pytest -q` — 35 passed on 2026-04-20

Latest local commits:

- `0a5385f` Add flame-level tracking and roast seed tooling
- `6d52b5d` Add Pi provisioning flow and mobile UI polish
- `05d35aa` Refresh UI with dark glossy theme and fixed roast timeline
- `eee173e` Add roast editing, deletion, and saved roast metrics
- current — Fix lookup page origin map: replace inline SVG with Leaflet, load leaflet.js, wire onSelect callback

If you add new hardware features, extend `tests/test_sensor_service.py`.
If you add new routes or storage behavior, extend `tests/test_app.py`.

## Notes For Future Me

- Read `CLAUDE.md` first — it has the key patterns and gotchas in one place.
- Read `docs/architecture.md` if you need the system diagram.
- Read `app/static/js/roast_session.js` if the next task is roast-flow related.
- Read `app/static/js/origin_map.js` if the next task is map or origin matching related.
- Read `app/services/sensor_service.py` if the next task is Pi hardware related.
- Read `app/services/roast_storage.py` if the next task is persistence or schema related.
