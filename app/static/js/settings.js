const settingsSocket = io();

let servoMin = Number(document.body.dataset.servoMin || 1000);
let servoMax = Number(document.body.dataset.servoMax || 2000);
let calibrationPrefilled = false;

const settingsMessageEl = document.getElementById("settingsMessage");
const connStatusEl = document.getElementById("connStatus");
const sensorSourceEl = document.getElementById("sensorSource");
const lastUpdatedEl = document.getElementById("lastUpdated");
const simulatedBadgeEl = document.getElementById("simulatedBadge");
const tempValueEl = document.getElementById("tempValue");
const tempHealthEl = document.getElementById("tempHealth");
const hwModeEl = document.getElementById("hwMode");
const tempErrorEl = document.getElementById("tempError");
const flameControlEl = document.getElementById("flameControl");
const flameValueEl = document.getElementById("flameValue");
const pulseValueEl = document.getElementById("pulseValue");
const servoHealthEl = document.getElementById("servoHealth");
const rawServoControlEl = document.getElementById("rawServoControl");
const rawServoValueEl = document.getElementById("rawServoValue");
const calMinEl = document.getElementById("calMin");
const calMaxEl = document.getElementById("calMax");
const saveCalibrationEl = document.getElementById("saveCalibration");
const calMessageEl = document.getElementById("calMessage");

function setHealthChip(element, ok, okText, failText) {
    element.textContent = ok ? okText : failText;
    element.classList.toggle("health-ok", Boolean(ok));
    element.classList.toggle("health-fail", !ok);
}

function flameToPulse(flameLevel) {
    return Math.round(servoMin + (servoMax - servoMin) * (flameLevel / 100));
}

function renderFlame(flameLevel) {
    flameValueEl.textContent = `${flameLevel}%`;
    pulseValueEl.textContent = `${flameToPulse(flameLevel)} µs`;
}

function applyFlame(flameLevel, emit) {
    const bounded = Math.max(0, Math.min(100, Math.round(flameLevel)));
    flameControlEl.value = String(bounded);
    renderFlame(bounded);
    if (emit) {
        settingsSocket.emit("control", { command: "set_flame_level", flame_level: bounded });
    }
}

flameControlEl.addEventListener("input", () => {
    applyFlame(Number(flameControlEl.value), true);
});

document.querySelectorAll("[data-flame]").forEach((button) => {
    button.addEventListener("click", () => applyFlame(Number(button.dataset.flame), true));
});

// --- Raw servo positioning for calibration ---
rawServoControlEl.addEventListener("input", () => {
    const pw = Number(rawServoControlEl.value);
    rawServoValueEl.textContent = `${pw} µs`;
    settingsSocket.emit("control", { command: "set_servo_pulsewidth", pulsewidth: pw });
});

document.querySelectorAll(".cal-use").forEach((button) => {
    button.addEventListener("click", () => {
        const target = document.getElementById(button.dataset.target);
        if (target) {
            target.value = rawServoControlEl.value;
        }
    });
});

saveCalibrationEl.addEventListener("click", async () => {
    const minPw = Number(calMinEl.value);
    const maxPw = Number(calMaxEl.value);
    if (!Number.isFinite(minPw) || !Number.isFinite(maxPw)) {
        showToast("Enter numeric pulse widths.", "error");
        return;
    }
    saveCalibrationEl.disabled = true;
    try {
        const response = await fetch("/api/sensor/calibration", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ servo_min_pulsewidth: minPw, servo_max_pulsewidth: maxPw }),
        });
        const body = await response.json();
        if (!response.ok) {
            showToast(body.error || "Could not save calibration.", "error");
            calMessageEl.textContent = body.error || "Could not save calibration.";
            return;
        }
        servoMin = body.servo_min_pulsewidth;
        servoMax = body.servo_max_pulsewidth;
        renderFlame(Number(flameControlEl.value));
        calMessageEl.textContent = `Saved: 0% = ${servoMin} µs, 100% = ${servoMax} µs (applied and persisted).`;
        showToast("Calibration saved.", "success");
    } catch (error) {
        showToast("Could not reach the calibration endpoint.", "error");
    } finally {
        saveCalibrationEl.disabled = false;
    }
});

settingsSocket.on("connect", () => {
    connStatusEl.textContent = "Connected";
    settingsMessageEl.textContent = "Connected. Watch the temperature and move the flame slider to test the servo.";
    settingsMessageEl.classList.remove("message-disconnected");
});

settingsSocket.on("disconnect", () => {
    connStatusEl.textContent = "Disconnected";
    settingsMessageEl.textContent = "Connection lost — reconnecting to the sensor stream.";
    settingsMessageEl.classList.add("message-disconnected");
    if (simulatedBadgeEl) {
        simulatedBadgeEl.style.display = "none";
    }
});

settingsSocket.on("sensor_data", (data) => {
    tempValueEl.textContent = hasSensorTemperature(data)
        ? `${Number(data.temperature).toFixed(1)} °C`
        : "-- °C";
    sensorSourceEl.textContent = data.source || "Unknown";
    lastUpdatedEl.textContent = data.timestamp || "--";
});

settingsSocket.on("sensor_state", (state) => {
    connStatusEl.textContent = state.active ? "Streaming" : "Paused";
    sensorSourceEl.textContent = state.source || "Unknown";
    if (simulatedBadgeEl) {
        simulatedBadgeEl.style.display = state.simulated ? "inline" : "none";
    }
    if (state.flame_level !== undefined && state.flame_level !== null) {
        applyFlame(Number(state.flame_level), false);
    }
});

async function loadHealth() {
    try {
        const response = await fetch("/api/sensor/health");
        const health = await response.json();
        setHealthChip(tempHealthEl, health.temperature_ok, "Online", "Offline");
        setHealthChip(servoHealthEl, health.servo_ok, "Online", "Offline");
        hwModeEl.textContent = health.mode || "Unknown";
        tempErrorEl.textContent = health.last_temperature_error || "No errors reported.";

        // Keep the flame→µs mapping in sync with the live (possibly recalibrated) range.
        if (Number.isFinite(health.servo_min_pulsewidth) && Number.isFinite(health.servo_max_pulsewidth)) {
            servoMin = health.servo_min_pulsewidth;
            servoMax = health.servo_max_pulsewidth;
            renderFlame(Number(flameControlEl.value));
            if (!calibrationPrefilled) {
                calMinEl.value = servoMin;
                calMaxEl.value = servoMax;
                calibrationPrefilled = true;
            }
        }
    } catch (error) {
        setHealthChip(tempHealthEl, false, "Online", "Unreachable");
        setHealthChip(servoHealthEl, false, "Online", "Unreachable");
        tempErrorEl.textContent = "Health endpoint unavailable.";
    }
}

renderFlame(Number(flameControlEl.value));
loadHealth();
window.setInterval(loadHealth, 10000);
