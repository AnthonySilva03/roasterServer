# Architecture

## Overview

The application is a small Flask service with two main execution paths:

- HTTP requests render the dashboard and expose the roast-session API.
- Socket.IO pushes live sensor updates to connected browsers.
- A shared hardware service handles thermocouple reads, servo flame control, and health checks.

## System Diagram

```text
                   +----------------------+
                   |   Browser Clients    |
                   |----------------------|
                   | Dashboard            |
                   | Roast Setup/Session  |
                   | Roast Review         |
                   | Lookup               |
                   +----------+-----------+
                              |
                    HTTP + Socket.IO
                              |
                              v
                   +----------------------+
                   | Flask Application    |
                   |----------------------|
                   | app/web/routes.py    |
                   | app/sockets.py       |
                   +----------+-----------+
                              |
                  +-----------+-----------+
                  |                       |
                  v                       v
        +-------------------+   +-------------------+
        | roast_storage.py  |   | sensor_service.py |
        | SQLite persistence|   | temp + servo I/O  |
        +---------+---------+   +---------+---------+
                  |                       |
                  v                       v
           instance/roasts.db      pigpio / simulated
```

## Main Components

### `run.py`

Bootstraps Eventlet and starts the Flask-SocketIO server.

### `app/__init__.py`

Creates the Flask app, loads configuration, registers the HTTP blueprint, starts socket handlers, and initializes the SQLite database.

### `app/web/routes.py`

Owns browser-facing routes and JSON API endpoints, including the sensor health endpoint.

### `app/sockets.py`

Owns Socket.IO events, client connection behavior, background sensor broadcasting, and control commands such as `start`, `stop`, `reset`, and `set_flame_level`.

### `app/services/sensor_service.py`

Provides a single `SensorService` abstraction that either reads real hardware data through `pigpio` or produces simulated roast telemetry for development. In hardware mode it also controls the roast-flame servo and reports sensor health.

### `app/services/roast_storage.py`

Handles SQLite setup and roast-session persistence without requiring a full ORM.

## Data Flow

```text
Roast session:

Roast Setup
   |
   v
Active Roast Session
   |  Socket.IO sensor_data
   |  Socket.IO set_flame_level
   v
Roast Review
   |  POST /api/roasts
   v
SQLite

Hardware health:

Browser
   |
   v
GET /api/sensor/health
   |
   v
sensor_service.health_status()
   |
   v
dashboard / roast widget
```

1. `run.py` starts the application.
2. `create_app()` configures Flask and Socket.IO.
3. `register_socket_handlers()` starts a background sensor loop.
4. The sensor loop emits `sensor_data` to all connected clients.
5. The browser updates charts, metrics, and hardware-health status from those events and the health endpoint.
6. During roasting, the browser can send `set_flame_level` control events over Socket.IO to update the flame controller.
7. When a user saves a roast, the browser posts the current captured curve to `POST /api/roasts`.
8. SQLite stores the roast session in `instance/roasts.db`.

## Why This Structure

- `web/` contains request-response code.
- `services/` contains reusable domain logic and persistence.
- `sockets.py` stays focused on real-time transport.

That split keeps the app easier to extend without mixing UI routes, sensor logic, and storage details in the same files.

## Responsibility Map

```text
run.py
  -> boot server

app/__init__.py
  -> build app
  -> load config
  -> register routes/sockets

app/web/routes.py
  -> HTML pages
  -> JSON APIs

app/sockets.py
  -> live stream
  -> roast controls
  -> flame_level updates

app/services/sensor_service.py
  -> MAX6675 reading
  -> servo pulse control
  -> hardware health

app/services/roast_storage.py
  -> save/load roast sessions
  -> summary queries
```
