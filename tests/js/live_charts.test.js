// Node-based unit tests for the pure roast-math helpers in live_charts.js and
// roast_alarms.js. Run via `node --test tests/js/*.test.js`
// (tests/test_frontend_js.py wraps this for pytest and skips without node).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const charts = require(path.join(__dirname, "..", "..", "app", "static", "js", "live_charts.js"));
const alarms = require(path.join(__dirname, "..", "..", "app", "static", "js", "roast_alarms.js"));

const START = "2026-04-15T12:00:00.000Z";

function at(seconds) {
    return new Date(new Date(START).getTime() + seconds * 1000).toISOString();
}

// Linear ramp from 100 °C at ratePerMinute, one sample every stepSeconds.
function ramp(totalSeconds, ratePerMinute, stepSeconds = 2, noise = () => 0) {
    const curve = [];
    for (let s = 0; s <= totalSeconds; s += stepSeconds) {
        curve.push({
            timestamp: at(s),
            temperature: 100 + (ratePerMinute * s) / 60 + noise(s),
            flame_level: s < 120 ? 80 : 50,
        });
    }
    return curve;
}

test("parseRoastTimestamp accepts HH:MM:SS with and without milliseconds", () => {
    const anchor = "2026-04-15T00:00:00";
    const whole = charts.parseRoastTimestamp("12:00:05", anchor);
    const millis = charts.parseRoastTimestamp("12:00:05.250", anchor);
    assert.equal(millis.getTime() - whole.getTime(), 250);
    assert.equal(charts.parseRoastTimestamp("not a time", anchor), null);
});

test("buildRorSeries recovers a linear ramp's slope and skips the first half window", () => {
    const curve = ramp(120, 12);
    const ror = charts.buildRorSeries(curve, { startedAt: START, windowSeconds: 30, smoothingPoints: 1 });
    assert.ok(ror.length > 0);
    // Nothing before 15 s of history (half the window).
    assert.ok(ror[0].x * 60 >= 15);
    ror.forEach((point) => assert.ok(Math.abs(point.y - 12) < 0.01, `slope ${point.y}`));
});

test("buildRorSeries smoothing reduces the noise of a quantised thermocouple", () => {
    // 0.25 °C quantisation like a MAX6675 plus a tiny deterministic wobble.
    const quantise = (value) => Math.round(value * 4) / 4;
    const curve = ramp(300, 8).map((point, index) => ({
        ...point,
        temperature: quantise(point.temperature + (index % 3 === 0 ? 0.3 : -0.2)),
    }));
    const spread = (series) => {
        const values = series.map((p) => p.y);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
    };
    const raw = charts.buildRorSeries(curve, { startedAt: START, windowSeconds: 30, smoothingPoints: 1 });
    const smooth = charts.buildRorSeries(curve, { startedAt: START, windowSeconds: 30, smoothingPoints: 5 });
    assert.ok(spread(smooth) < spread(raw));
    const last = smooth[smooth.length - 1].y;
    assert.ok(Math.abs(last - 8) < 1, `smoothed slope ${last}`);
});

test("buildFlameSeries exposes the recorded flame level per sample", () => {
    const flame = charts.buildFlameSeries(ramp(240, 10), { startedAt: START });
    assert.equal(flame[0].y, 80);
    assert.equal(flame[flame.length - 1].y, 50);
});

test("buildRoastPhases splits drying, Maillard and development with DTR", () => {
    const curve = ramp(600, 10);
    const events = [
        { label: "Charge", time: at(0) },
        { label: "Dry End", time: at(240) },
        { label: "First Crack", time: at(480) },
        { label: "Drop", time: at(600) },
    ];
    const phases = charts.buildRoastPhases(curve, events, { startedAt: at(0), endedAt: at(600) });
    assert.equal(phases.totalSeconds, 600);
    assert.deepEqual(phases.phases.map((p) => p.key), ["drying", "maillard", "development"]);
    assert.deepEqual(phases.phases.map((p) => Math.round(p.percent)), [40, 40, 20]);
    assert.equal(Math.round(phases.dtr), 20);
    const drying = phases.phases[0];
    assert.ok(Math.abs(drying.deltaTemp - 40) < 0.5);
    assert.ok(Math.abs(drying.avgRor - 10) < 0.1);
});

test("buildRoastPhases accepts legacy Start/Finish labels and merges phases without Dry End", () => {
    const curve = ramp(600, 10);
    const events = [
        { label: "Start", time: at(0) },
        { label: "First Crack", time: at(450) },
        { label: "Finish", time: at(600) },
    ];
    const phases = charts.buildRoastPhases(curve, events, {});
    assert.equal(charts.findRoastEvent(events, "charge").label, "Start");
    assert.equal(charts.findRoastEvent(events, "drop").label, "Finish");
    assert.deepEqual(phases.phases.map((p) => p.label), ["Drying + Maillard", "Development"]);
    assert.equal(Math.round(phases.dtr), 25);
});

test("buildRoastPhases marks an open phase while the roast is still running", () => {
    const curve = ramp(200, 10);
    const phases = charts.buildRoastPhases(curve, [{ label: "Charge", time: at(0) }], { startedAt: at(0) });
    assert.equal(phases.phases.length, 1);
    assert.equal(phases.phases[0].open, true);
    assert.equal(phases.dtr, null);
});

test("interpolateSeries and projectSecondsToTemperature", () => {
    const series = [{ x: 0, y: 100 }, { x: 1, y: 110 }, { x: 2, y: 130 }];
    assert.equal(charts.interpolateSeries(series, 0.5), 105);
    assert.equal(charts.interpolateSeries(series, 1.5), 120);
    assert.equal(charts.interpolateSeries(series, 3), null);
    assert.equal(charts.projectSecondsToTemperature(150, 196, 10), 276);
    assert.equal(charts.projectSecondsToTemperature(200, 196, 10), null);
    assert.equal(charts.projectSecondsToTemperature(150, 196, 0.1), null);
});

test("buildRoastAnalytics uses the smoothed RoR and reports phases", () => {
    const curve = ramp(300, 9);
    const analytics = charts.buildRoastAnalytics(curve, [{ label: "Charge", time: at(0) }], { startedAt: at(0) });
    assert.ok(Math.abs(analytics.currentRor - 9) < 0.05);
    assert.equal(analytics.totalDurationSeconds, 300);
    assert.equal(analytics.phases.phases.length, 1);
});

test("alarms: normalize, describe and evaluate with event gating", () => {
    assert.equal(alarms.normalizeRoastAlarm({ source: "bogus", value: 1 }), null);
    assert.equal(alarms.normalizeRoastAlarm({ source: "temperature_above", value: "x" }), null);

    const alarm = alarms.normalizeRoastAlarm({
        source: "temperature_above", value: 190, fromEvent: "firstCrack", action: "flame", flameLevel: 140,
    });
    assert.equal(alarm.flameLevel, 100);
    assert.match(alarms.describeRoastAlarm(alarm), /Bean temp ≥ 190 °C from First Crack → set flame to 100%/);

    const base = { temperature: 195, ror: 5, now: new Date(at(500)), eventTimes: { charge: new Date(at(0)) } };
    assert.equal(alarms.evaluateRoastAlarm(alarm, base), false, "gated until First Crack is marked");
    assert.equal(alarms.evaluateRoastAlarm(alarm, {
        ...base, eventTimes: { charge: new Date(at(0)), firstCrack: new Date(at(480)) },
    }), true);

    const disabled = { ...alarm, fromEvent: "any", enabled: false };
    assert.equal(alarms.evaluateRoastAlarm(disabled, base), false);

    const rorCrash = alarms.normalizeRoastAlarm({ source: "ror_below", value: 0, fromEvent: "any" });
    assert.equal(alarms.evaluateRoastAlarm(rorCrash, { ...base, ror: -1 }), true);
    assert.equal(alarms.evaluateRoastAlarm(rorCrash, { ...base, ror: null }), false);

    const timer = alarms.normalizeRoastAlarm({ source: "time_after", value: 120, fromEvent: "charge" });
    assert.equal(alarms.evaluateRoastAlarm(timer, { ...base, now: new Date(at(119)) }), false);
    assert.equal(alarms.evaluateRoastAlarm(timer, { ...base, now: new Date(at(120)) }), true);
});
