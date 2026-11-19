#!/usr/bin/env python3
"""Sanity-check the real thermocouple against a believable temperature range.

Run on the Pi with the roaster cold (at room temperature):

    python3 scripts/check_thermocouple.py
    python3 scripts/check_thermocouple.py --expect 21      # you know the room is ~21 °C
    python3 scripts/check_thermocouple.py --url http://192.168.1.191

It polls GET /api/sensor/health, which reports the sensor loop's latest
MAX6675 reading, so it never bit-bangs the bus alongside the running app.
Exit status: 0 = pass, 1 = check failed, 2 = could not reach the app.

The unit tests use a fake chip; only this check sees the real wiring. A
doubled reading (room temp showing ~44 °C) is how a bit-order bug in the
MAX6675 read once went unnoticed.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

DEFAULT_URL = "http://127.0.0.1"
ROOM_MIN_C = 5.0
ROOM_MAX_C = 40.0


def evaluate(readings, *, min_c=ROOM_MIN_C, max_c=ROOM_MAX_C, expect_c=None,
             tolerance_c=3.0, max_spread_c=2.0):
    """Return a list of problems with the health readings (empty = pass).

    readings: health dicts from /api/sensor/health, oldest first.
    """
    problems = []
    if not readings:
        return ["No readings were collected."]

    latest = readings[-1]
    if latest.get("mode") != "pigpio" or latest.get("source") != "pigpio-max6675":
        problems.append(
            f"Not reading real hardware (mode={latest.get('mode')!r}, source={latest.get('source')!r}). "
            "Set SENSOR_MODE=pigpio and make sure pigpiod is running."
        )
        return problems

    errors = sorted({r.get("last_temperature_error") for r in readings if r.get("last_temperature_error")})
    for error in errors:
        problems.append(f"Sensor reported an error: {error}")

    temps = [r["temperature"] for r in readings if isinstance(r.get("temperature"), (int, float))]
    if not temps:
        problems.append("No temperature values came back from the sensor.")
        return problems

    average = sum(temps) / len(temps)
    spread = max(temps) - min(temps)

    if not min_c <= average <= max_c:
        hint = ""
        if min_c <= average / 2 <= max_c:
            hint = f" Half of it ({average / 2:.1f} °C) is a room temperature: the MAX6675 bits may be shifted (read order)."
        problems.append(
            f"Average {average:.2f} °C is outside the room range {min_c:g}–{max_c:g} °C.{hint} "
            "If the roaster is still warm, let it cool or widen --min/--max."
        )

    if expect_c is not None and abs(average - expect_c) > tolerance_c:
        problems.append(
            f"Average {average:.2f} °C is more than {tolerance_c:g} °C from the expected {expect_c:g} °C."
        )

    if spread > max_spread_c:
        problems.append(
            f"Readings wandered {spread:.2f} °C (limit {max_spread_c:g} °C): check for a loose SO/SCK/CS wire."
        )

    return problems


def fetch_health(url, timeout=5.0):
    request = urllib.request.Request(url.rstrip("/") + "/api/sensor/health")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # 503 still carries the health JSON (sensor unhealthy).
        return json.load(error)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--url", default=DEFAULT_URL, help=f"app base URL (default {DEFAULT_URL})")
    parser.add_argument("--samples", type=int, default=5, help="health polls to take (default 5)")
    parser.add_argument("--interval", type=float, default=2.5,
                        help="seconds between polls; keep >= SENSOR_INTERVAL_SECONDS (default 2.5)")
    parser.add_argument("--min", dest="min_c", type=float, default=ROOM_MIN_C, help="lowest believable °C")
    parser.add_argument("--max", dest="max_c", type=float, default=ROOM_MAX_C, help="highest believable °C")
    parser.add_argument("--expect", dest="expect_c", type=float, help="known room temperature in °C")
    parser.add_argument("--tolerance", dest="tolerance_c", type=float, default=3.0,
                        help="allowed distance from --expect (default 3 °C)")
    parser.add_argument("--max-spread", dest="max_spread_c", type=float, default=2.0,
                        help="largest allowed min-to-max wander across samples (default 2 °C)")
    args = parser.parse_args(argv)

    readings = []
    for index in range(max(1, args.samples)):
        if index:
            time.sleep(args.interval)
        try:
            health = fetch_health(args.url)
        except (urllib.error.URLError, OSError, ValueError) as error:
            print(f"FAIL: could not reach {args.url}/api/sensor/health ({error})")
            return 2
        readings.append(health)
        temperature = health.get("temperature")
        shown = f"{temperature:.2f} °C ({temperature * 9 / 5 + 32:.1f} °F)" if isinstance(temperature, (int, float)) else "--"
        print(f"  sample {index + 1}: {shown}  error={health.get('last_temperature_error')}")

    problems = evaluate(
        readings,
        min_c=args.min_c,
        max_c=args.max_c,
        expect_c=args.expect_c,
        tolerance_c=args.tolerance_c,
        max_spread_c=args.max_spread_c,
    )
    if problems:
        for problem in problems:
            print(f"FAIL: {problem}")
        return 1
    print("PASS: thermocouple readings look like a believable room temperature.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
