// User-defined roast alarms (Artisan-style): a condition, an "active from"
// event guard, and an action. Stored per device in localStorage; evaluated by
// roast_session.js on every sensor sample and fired once per roast.
// Pure functions are exported for node-based tests.

const ROAST_ALARMS_KEY = "roasterAlarms";

const ALARM_SOURCE_LABELS = Object.freeze({
    temperature_above: "Bean temp ≥",
    temperature_below: "Bean temp ≤",
    ror_below: "RoR ≤",
    ror_above: "RoR ≥",
    time_after: "Time ≥",
});

const ALARM_SOURCE_UNITS = Object.freeze({
    temperature_above: "°C",
    temperature_below: "°C",
    ror_below: "°C/min",
    ror_above: "°C/min",
    time_after: "s",
});

const ALARM_FROM_LABELS = Object.freeze({
    charge: "Charge",
    dryEnd: "Dry End",
    firstCrack: "First Crack",
    any: "any time",
});

const ALARM_ACTION_LABELS = Object.freeze({
    notify: "notify",
    beep: "notify + beep",
    speak: "notify + speak",
    flame: "set flame",
});

function loadRoastAlarms() {
    try {
        const raw = typeof localStorage !== "undefined" ? localStorage.getItem(ROAST_ALARMS_KEY) : null;
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.map(normalizeRoastAlarm).filter(Boolean) : [];
    } catch (error) {
        return [];
    }
}

function saveRoastAlarms(alarms) {
    try {
        localStorage.setItem(ROAST_ALARMS_KEY, JSON.stringify(alarms));
    } catch (error) {
        // localStorage unavailable; alarms live only for this page load.
    }
}

function normalizeRoastAlarm(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const source = ALARM_SOURCE_LABELS[raw.source] ? raw.source : null;
    const value = Number(raw.value);
    if (!source || !Number.isFinite(value)) {
        return null;
    }
    const flameLevel = Number(raw.flameLevel);
    return {
        id: String(raw.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
        source,
        value,
        fromEvent: ALARM_FROM_LABELS[raw.fromEvent] ? raw.fromEvent : "charge",
        action: ALARM_ACTION_LABELS[raw.action] ? raw.action : "notify",
        flameLevel: Number.isFinite(flameLevel) ? Math.max(0, Math.min(100, Math.round(flameLevel))) : 50,
        message: typeof raw.message === "string" ? raw.message.trim().slice(0, 120) : "",
        enabled: raw.enabled !== false,
    };
}

function describeRoastAlarm(alarm) {
    const condition = `${ALARM_SOURCE_LABELS[alarm.source]} ${alarm.value} ${ALARM_SOURCE_UNITS[alarm.source]}`;
    const guard = alarm.fromEvent === "any" ? "" : ` from ${ALARM_FROM_LABELS[alarm.fromEvent]}`;
    const action = alarm.action === "flame"
        ? `set flame to ${alarm.flameLevel}%`
        : ALARM_ACTION_LABELS[alarm.action];
    return `${condition}${guard} → ${action}`;
}

// context: {
//   temperature: number|null, ror: number|null, now: Date,
//   eventTimes: { charge: Date|null, dryEnd: Date|null, firstCrack: Date|null },
// }
// Returns true when the alarm's condition holds right now.
function evaluateRoastAlarm(alarm, context) {
    if (!alarm || alarm.enabled === false || !context) {
        return false;
    }

    const eventTimes = context.eventTimes || {};
    let fromTime = null;
    if (alarm.fromEvent !== "any") {
        fromTime = eventTimes[alarm.fromEvent] || null;
        if (!fromTime) {
            return false;
        }
    }

    // null/undefined mean "no reading yet" and must never compare as 0.
    const asNumber = (value) => (value === null || value === undefined || value === "" ? NaN : Number(value));
    const temperature = asNumber(context.temperature);
    const ror = asNumber(context.ror);
    switch (alarm.source) {
        case "temperature_above":
            return Number.isFinite(temperature) && temperature >= alarm.value;
        case "temperature_below":
            return Number.isFinite(temperature) && temperature <= alarm.value;
        case "ror_below":
            return Number.isFinite(ror) && ror <= alarm.value;
        case "ror_above":
            return Number.isFinite(ror) && ror >= alarm.value;
        case "time_after": {
            const anchor = fromTime || eventTimes.charge || null;
            if (!anchor || !(context.now instanceof Date)) {
                return false;
            }
            return (context.now.getTime() - anchor.getTime()) / 1000 >= alarm.value;
        }
        default:
            return false;
    }
}

// Two short tones through WebAudio; no asset to precache and works offline.
let alarmAudioContext = null;
function playAlarmBeep() {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            return;
        }
        if (!alarmAudioContext) {
            alarmAudioContext = new AudioContextClass();
        }
        if (alarmAudioContext.state === "suspended") {
            alarmAudioContext.resume().catch(() => {});
        }
        const now = alarmAudioContext.currentTime;
        [0, 0.28].forEach((offset) => {
            const oscillator = alarmAudioContext.createOscillator();
            const gain = alarmAudioContext.createGain();
            oscillator.type = "square";
            oscillator.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, now + offset);
            gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2);
            oscillator.connect(gain);
            gain.connect(alarmAudioContext.destination);
            oscillator.start(now + offset);
            oscillator.stop(now + offset + 0.22);
        });
    } catch (error) {
        // Audio is best-effort; the toast and notification still show.
    }
}

function speakAlarm(text) {
    try {
        if (!("speechSynthesis" in window) || !text) {
            return;
        }
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } catch (error) {
        // Speech is best-effort.
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        ALARM_SOURCE_LABELS,
        normalizeRoastAlarm,
        describeRoastAlarm,
        evaluateRoastAlarm,
    };
}
