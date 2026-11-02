// Rate-of-rise flame assist: a deliberately simple step controller (not a
// full PID) that nudges the flame every `intervalSeconds` so the measured RoR
// tracks a target. The target is a fixed value or the reference roast's RoR at
// the same elapsed time. Manual slider moves pause it for one interval.
// Pure helpers are exported for node-based tests.

const ASSIST_SETTINGS_KEY = "roasterFlameAssist";
const ASSIST_DEFAULTS = Object.freeze({
    mode: "fixed",          // "fixed" | "reference"
    targetRor: 8,           // °C/min, used in fixed mode
    deadband: 1,            // °C/min either side of target with no action
    stepPercent: 5,         // flame change per adjustment
    intervalSeconds: 20,    // minimum seconds between adjustments
    minFlame: 10,
    maxFlame: 100,
});

function loadAssistSettings() {
    let stored = {};
    try {
        const raw = typeof localStorage !== "undefined" ? localStorage.getItem(ASSIST_SETTINGS_KEY) : null;
        stored = raw ? JSON.parse(raw) : {};
    } catch (error) {
        stored = {};
    }
    return normalizeAssistSettings({ ...ASSIST_DEFAULTS, ...(stored || {}) });
}

function saveAssistSettings(settings) {
    const next = normalizeAssistSettings({ ...loadAssistSettings(), ...settings });
    try {
        localStorage.setItem(ASSIST_SETTINGS_KEY, JSON.stringify(next));
    } catch (error) {
        // best effort
    }
    return next;
}

function normalizeAssistSettings(raw) {
    const clamp = (value, low, high, fallback) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(low, Math.min(high, number)) : fallback;
    };
    const minFlame = clamp(raw.minFlame, 0, 100, ASSIST_DEFAULTS.minFlame);
    return {
        mode: raw.mode === "reference" ? "reference" : "fixed",
        targetRor: clamp(raw.targetRor, 0, 60, ASSIST_DEFAULTS.targetRor),
        deadband: clamp(raw.deadband, 0, 20, ASSIST_DEFAULTS.deadband),
        stepPercent: clamp(raw.stepPercent, 1, 50, ASSIST_DEFAULTS.stepPercent),
        intervalSeconds: clamp(raw.intervalSeconds, 5, 300, ASSIST_DEFAULTS.intervalSeconds),
        minFlame,
        maxFlame: Math.max(minFlame, clamp(raw.maxFlame, 0, 100, ASSIST_DEFAULTS.maxFlame)),
    };
}

// Returns the next flame level, or null when no change is warranted.
// context: { ror, target, currentFlame, settings }
function computeAssistAdjustment(context) {
    const { settings } = context;
    // null/undefined mean "no reading"; they must never be treated as 0.
    const asNumber = (value) => (value === null || value === undefined || value === "" ? NaN : Number(value));
    const ror = asNumber(context.ror);
    const target = asNumber(context.target);
    const current = asNumber(context.currentFlame);
    if (!settings || !Number.isFinite(ror) || !Number.isFinite(target) || !Number.isFinite(current)) {
        return null;
    }
    const error = target - ror;
    let next = current;
    if (error > settings.deadband) {
        next = current + settings.stepPercent;
    } else if (error < -settings.deadband) {
        next = current - settings.stepPercent;
    }
    next = Math.max(settings.minFlame, Math.min(settings.maxFlame, Math.round(next)));
    return next === current ? null : next;
}

// RoR of a reference series at an elapsed time (minutes); null when outside.
function referenceRorAt(referenceRorSeries, elapsedMinutes) {
    if (!Array.isArray(referenceRorSeries) || !referenceRorSeries.length) {
        return null;
    }
    return interpolateSeries(referenceRorSeries, elapsedMinutes);
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        ASSIST_DEFAULTS,
        normalizeAssistSettings,
        computeAssistAdjustment,
    };
}
