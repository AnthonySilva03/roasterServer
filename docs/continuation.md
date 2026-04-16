# Continuation Notes

Last updated: 2026-04-15

## Purpose

This document is a restart point for future development sessions. It summarizes what already exists, what is important not to forget, and where the most likely next changes should happen.

## Current Priorities

1. Improve the active roast workflow with richer roast analytics.
   - Implemented: roast duration, development time, development ratio, and peak temperature now appear across the roast flow.
   - Good follow-up candidates: turn-point detection, stronger graph annotations, and comparative batch overlays.

2. Improve persistence for media and roast records.
   - Implemented: post-roast cup ratings and tasting notes now save separately from roast-time notes through a dedicated edit flow.
   - The biggest near-term win is still moving photo storage out of SQLite data URLs.

3. Improve Raspberry Pi hardware polish.
   - Servo calibration, clearer diagnostics, and better recovery from hardware faults are the main gaps.

## Current Product State

The app is currently a Flask + Socket.IO coffee roast tracker with these main user flows:

```text
Dashboard
  -> monthly roast calendar
  -> interactive global roast origin map
  -> clickable selected-origin roast list
  -> hardware health panel

Roast setup
  -> bean name
  -> origin
  -> roast level

Active roast session
  -> live temperature graph
  -> pre-roast / start / first crack / second crack / finish
  -> servo speed control
  -> hardware widget with issue logging

Roast review
  -> summary before save
  -> graph preview of the exact curve to be saved
  -> optional photo upload
  -> save or cancel

Lookup
  -> saved roast list + search
  -> compact global origin filter map
  -> temperature curve with event badges
  -> cup rating and tasting notes display
  -> saved photo

Post-roast edit
  -> rating after tasting
  -> taste notes after brewing/cupping
```

## Important Technical Decisions

- Temperature-only telemetry is used now. Humidity and pressure were intentionally removed.
- `SensorService` is the single hardware abstraction layer.
- `pigpio` hardware mode supports:
  - MAX6675 temperature reads
  - servo pulse control for roast speed
  - hardware health reporting
- Simulated mode is still first-class and should keep working for development without Raspberry Pi hardware.
- Roast sessions are not written to the database immediately on `Finish`.
  - The active roast page stores a pending roast in browser `sessionStorage`.
  - The review page shows the exact graph curve that will be saved, then decides whether to save or cancel.
- Cup feedback is intentionally separate from roast capture.
  - Rating and tasting notes can only be edited later from the lookup edit page.
  - This keeps roast-time observations separate from after-tasting impressions.
- Hardware issues during roasting are:
  - shown in the roast-session hardware widget
  - recorded into the roast event log
  - carried forward into the review/save flow through roast notes/events

## Key Files

### Server

- `run.py`
  - app entry point
  - eventlet monkey patch + server start

- `app/__init__.py`
  - Flask app factory
  - config load
  - route and socket registration

- `app/web/routes.py`
  - HTML routes
  - JSON API routes
  - sensor health endpoint

- `app/sockets.py`
  - background sensor loop
  - Socket.IO control handling
  - speed-control events

### Services

- `app/services/sensor_service.py`
  - simulated mode
  - MAX6675 pigpio mode
  - servo speed control
  - health checks

- `app/services/roast_storage.py`
  - SQLite setup
  - roast session persistence
  - stores curve, events, and photo data

### Frontend

- `app/templates/dashboard.html`
  - monthly roast calendar
  - interactive origin map
  - selected-origin roast list
  - hardware health widget

- `app/templates/roast.html`
  - roast setup page

- `app/templates/roast_session.html`
  - active roast UI
  - live graph
  - roast control buttons
  - hardware widget

- `app/templates/roast_review.html`
  - save/cancel step
  - saved-curve preview
  - photo upload

- `app/templates/lookup.html`
  - saved roast browser
  - map-based origin filter
  - read-only tasting feedback

- `app/templates/lookup_edit.html`
  - post-roast feedback editor

- `app/static/js/dashboard.js`
  - dashboard calendar and health panel
  - origin map markers, legend, and selected-origin drilldown

- `app/static/js/roast_session.js`
  - most active frontend logic right now
  - roast stage markers
  - speed control messages
  - hardware polling and issue recording

- `app/static/js/roast_review.js`
  - pending roast review and save/cancel logic
  - review chart preview

- `app/static/js/lookup_page.js`
  - roast detail loading
  - origin map filtering
  - event badges on saved graph
  - tasting feedback display
  - saved photo display

- `app/static/js/lookup_edit.js`
  - post-roast feedback loading and saving

- `app/static/js/origin_map.js`
  - shared coffee-region geo matching
  - origin marker projection helpers

## Current Storage Shape

The `roast_sessions` table currently stores:

- roast metadata
- `curve_json`
- `events_json`
- `photo_data`
- `rating`
- `taste_notes`

If this schema changes later, remember that `init_db()` currently handles additive migration for some new columns using `PRAGMA table_info(...)`.

## Current Hardware Behavior

```text
SENSOR_MODE=simulated
  -> simulated temperature
  -> simulated health returns healthy
  -> speed still tracked logically

SENSOR_MODE=pigpio
  -> MAX6675 read via pigpio bit-banging
  -> servo pulsewidth updates from speed slider
  -> /api/sensor/health checks temperature + servo path
```

## Known Constraints / Risks

- `photo_data` is currently stored directly in SQLite as a data URL string.
  - This is simple, but database size can grow quickly if users attach large photos.
- Origin mapping is alias-based.
  - New or unusual origin strings may need extra aliases added to `app/static/js/origin_map.js`.
- Roast review persistence depends on browser `sessionStorage`.
  - If the browser tab is closed unexpectedly before save, the pending roast may be lost.
- Sensor polling and health checks are simple and synchronous right now.
  - If hardware latency grows, this could affect responsiveness.
- The active roast page polls hardware health every 10 seconds.
  - Good enough now, but this is not event-driven.

## Suggested Next Development Options

Choose one of these when resuming:

1. Improve roast data quality
   - add roast duration display
   - add rate-of-rise calculations
   - add graph annotations beyond vertical markers

2. Improve persistence
   - move photos from SQLite data URLs to file storage
   - add export/import for roast sessions
   - add delete support for saved roasts
   - consider richer tasting-history tracking per roast

3. Improve hardware integration
   - add explicit servo calibration UI
   - add multi-sensor support
   - add more detailed Pi diagnostics

4. Improve frontend usability
   - better mobile layout on roast session page
   - toast notifications
   - richer lookup filters/search
   - map clustering or tooltips for dense origin regions

## Recommended Restart Checklist

When continuing development later:

```bash
make check
make run
```

Then verify:

1. Dashboard loads.
2. Roast setup opens `/roast/session`.
3. Roast review opens after `Finish`.
4. Roast review shows the graph preview before save.
5. Lookup displays saved roasts and links to post-roast edit.
6. `/api/sensor/health` returns expected hardware status.

## Test Coverage Snapshot

Current automated coverage includes:

- page rendering
- roast create/detail/summary APIs
- roast feedback patch API
- lookup edit page render
- sensor health endpoint
- simulated sensor behavior
- MAX6675 reading behavior
- servo pulse mapping
- hardware health reporting

Recent manual verification also covered:

- interactive dashboard origin selection
- interactive lookup origin filtering
- testing logs during app startup and socket control

If you add new hardware features, extend:

- `tests/test_sensor_service.py`
- `tests/test_app.py`

## Notes For Future Me

- Start by reading `docs/architecture.md` if you need the big picture.
- Start by reading `app/static/js/roast_session.js` if the next task is roast-flow related.
- Start by reading `app/services/sensor_service.py` if the next task is Pi hardware related.
- Start by reading `app/services/roast_storage.py` if the next task is persistence related.
