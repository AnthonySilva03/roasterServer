const roastSessionSocket = io();
const roastSessionMaxPoints = Number(document.body.dataset.maxPoints || 30);
const beanName = document.body.dataset.beanName || "Unnamed Roast";
const origin = document.body.dataset.origin || "Unknown origin";
const roastLevel = document.body.dataset.roastLevel || "Medium";
const roastWeightGrams = document.body.dataset.weightGrams || "";

const sessionMessageEl = document.getElementById("sessionMessage");
const sensorStatusEl = document.getElementById("sensorStatus");
const sensorSourceEl = document.getElementById("sensorSource");
const lastUpdatedEl = document.getElementById("lastUpdated");
const temperatureValueEl = document.getElementById("temperatureValue");
const flameControlEl = document.getElementById("flameControl");
const flameValueEl = document.getElementById("flameValue");
const preRoastButtonEl = document.getElementById("preRoastButton");
const startRoastButtonEl = document.getElementById("startRoastButton");
const firstCrackButtonEl = document.getElementById("firstCrackButton");
const secondCrackButtonEl = document.getElementById("secondCrackButton");
const finishRoastButtonEl = document.getElementById("finishRoastButton");
const eventLogEl = document.getElementById("eventLog");
const roastHealthSummaryEl = document.getElementById("roastHealthSummary");
const roastHardwarePanelEl = document.getElementById("roastHardwarePanel");
const roastTemperatureHealthEl = document.getElementById("roastTemperatureHealth");
const roastServoHealthEl = document.getElementById("roastServoHealth");
const roastHardwareFlameLevelEl = document.getElementById("roastHardwareFlameLevel");
const roastHardwareModeEl = document.getElementById("roastHardwareMode");
const roastHardwareErrorEl = document.getElementById("roastHardwareError");
const roastLatestIssueEl = document.getElementById("roastLatestIssue");
const roastLatestIssueTextEl = document.getElementById("roastLatestIssueText");
const analyticsDurationEl = document.getElementById("analyticsDuration");
const analyticsDevelopmentEl = document.getElementById("analyticsDevelopment");
const analyticsDevelopmentRatioEl = document.getElementById("analyticsDevelopmentRatio");
const analyticsPeakTemperatureEl = document.getElementById("analyticsPeakTemperature");
const analyticsCopyEl = document.getElementById("analyticsCopy");

const roastChart = createLineChart("temperatureChart", "Temperature", "#b4542b");
const roastCurve = [];
const roastEvents = [];
let roastRecording = false;
let roastFinished = false;
let preRoastAt = null;
let roastStartedAt = null;
let latestSensorData = null;
let explicitPreRoast = false;
let lastHardwareIssueKey = null;
let hardwareHealthPollId = null;
let lastLoggedFlameLevel = Number(flameControlEl.value);

function formatNow() {
    return new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
    });
}

function setHealthChip(element, ok, okText, failText) {
    element.textContent = ok ? okText : failText;
    element.classList.toggle("health-ok", Boolean(ok));
    element.classList.toggle("health-fail", !ok);
}

function currentTimestamp() {
    return new Date().toISOString();
}

function currentFlameLevel() {
    return Number(flameControlEl.value);
}

function renderEvents() {
    if (!roastEvents.length) {
        eventLogEl.innerHTML = '<div class="empty-state">No roast events marked yet.</div>';
        return;
    }

    eventLogEl.innerHTML = roastEvents.map((event) => `
        <article class="history-item">
            <div class="history-topline">
                <span>${event.label}</span>
                <span>${event.displayTime}</span>
            </div>
            <div class="history-meta">${event.detail}</div>
        </article>
    `).join("");
}

function renderAnalytics() {
    const analytics = buildRoastAnalytics(roastCurve, roastEvents, {
        startedAt: roastStartedAt || preRoastAt,
        endedAt: roastFinished ? currentTimestamp() : null,
    });

    analyticsDurationEl.textContent = formatDuration(analytics.totalDurationSeconds);
    analyticsDevelopmentEl.textContent = formatDuration(analytics.developmentSeconds);
    analyticsDevelopmentRatioEl.textContent = analytics.developmentRatio !== null && Number.isFinite(analytics.developmentRatio)
        ? `${analytics.developmentRatio.toFixed(0)}%`
        : "--";
    analyticsPeakTemperatureEl.textContent = Number.isFinite(analytics.peakTemperature)
        ? `${analytics.peakTemperature.toFixed(1)} °C`
        : "--";

    if (!roastCurve.length) {
        analyticsCopyEl.textContent = "Start the roast to begin calculating analytics.";
        return;
    }

    if (!roastStartedAt) {
        analyticsCopyEl.textContent = "Pre-roast samples are collecting. Mark Start to track roast duration from charge.";
        return;
    }

    if (analytics.developmentSeconds === null) {
        analyticsCopyEl.textContent = "Development metrics will appear after you mark First Crack.";
        return;
    }

    analyticsCopyEl.textContent = `Development phase is ${formatDuration(analytics.developmentSeconds)} so far with peak temperature at ${Number.isFinite(analytics.peakTemperature) ? `${analytics.peakTemperature.toFixed(1)} °C` : "--"}.`;
}

function rebuildStageMarkers() {
    const baseTime = resolveChartBaseTime(roastCurve, {
        startedAt: roastStartedAt || preRoastAt,
    });
    const markers = roastEvents
        .filter((event) => event.showMarker && event.chartLabel)
        .map((event) => ({
            label: toElapsedMinutes(event.chartLabel, baseTime, roastStartedAt || preRoastAt),
            text: event.label,
            color: event.color,
        }))
        .filter((event) => Number.isFinite(event.label));
    setStageMarkers(roastChart, markers);
}

function addEvent(label, detail, options = {}) {
    const event = {
        label,
        detail,
        time: options.time || currentTimestamp(),
        displayTime: formatNow(),
        showMarker: Boolean(options.showMarker),
        chartLabel: options.chartLabel || null,
        color: options.color || "#7f3417",
        temperature: latestSensorData ? Number(latestSensorData.temperature) : null,
        flame_level: options.flameLevel ?? currentFlameLevel(),
    };
    roastEvents.push(event);
    renderEvents();
    rebuildStageMarkers();
}

function recordHardwareIssue(detail, options = {}) {
    const issueKey = `${detail}|${options.code || ""}`;
    if (issueKey === lastHardwareIssueKey) {
        return;
    }

    lastHardwareIssueKey = issueKey;
    roastLatestIssueTextEl.textContent = detail;
    roastLatestIssueEl.style.display = "block";
    roastHardwarePanelEl.classList.add("panel-alert");
    addEvent("Hardware Issue", detail, {
        color: "#a53d2d",
        ...options,
    });
}

function clearRoastGraph() {
    roastCurve.length = 0;
    setChartSeries(roastChart, []);
    rebuildStageMarkers();
    renderAnalytics();
}

function updateLiveTemperature(data) {
    latestSensorData = data;
    temperatureValueEl.textContent = `${Number(data.temperature).toFixed(1)} °C`;
    sensorSourceEl.textContent = data.source || "Unknown";
    lastUpdatedEl.textContent = data.timestamp;
}

function captureTemperature(data) {
    roastCurve.push({
        timestamp: data.timestamp,
        temperature: Number(data.temperature),
        flame_level: currentFlameLevel(),
    });

    if (roastCurve.length > roastSessionMaxPoints) {
        roastCurve.shift();
    }

    setChartSeries(
        roastChart,
        buildChartSeries(roastCurve, {
            startedAt: roastStartedAt || preRoastAt,
        })
    );
    rebuildStageMarkers();
    renderAnalytics();
}

function beginRecording(fromPreRoast) {
    roastFinished = false;
    roastRecording = true;
    if (!preRoastAt) {
        preRoastAt = currentTimestamp();
    }
    explicitPreRoast = fromPreRoast || explicitPreRoast;
    roastSessionSocket.emit("control", { command: "start" });
}

function buildPendingRoastPayload() {
    const startedAt = roastStartedAt || preRoastAt || currentTimestamp();
    const endedAt = currentTimestamp();
    const stageNotes = roastEvents
        .map((event) => `${event.time} - ${event.label}: ${event.detail}`)
        .join("\n");
    const analytics = buildRoastAnalytics(roastCurve, roastEvents, {
        startedAt,
        endedAt,
    });
    const analyticsNotes = [
        `Roast duration: ${formatDuration(analytics.totalDurationSeconds)}`,
        `Development time: ${formatDuration(analytics.developmentSeconds)}`,
        `Development ratio: ${analytics.developmentRatio !== null && Number.isFinite(analytics.developmentRatio) ? `${analytics.developmentRatio.toFixed(0)}%` : "--"}`,
        `Peak temperature: ${Number.isFinite(analytics.peakTemperature) ? `${analytics.peakTemperature.toFixed(1)} °C` : "--"}`,
    ].join("\n");

    return {
        bean_name: beanName,
        origin,
        roast_level: roastLevel,
        weight_grams: roastWeightGrams ? Number(roastWeightGrams) : null,
        flame_level: currentFlameLevel(),
        total_roast_seconds: analytics.totalDurationSeconds !== null
            ? Math.round(analytics.totalDurationSeconds)
            : null,
        started_at: startedAt,
        ended_at: endedAt,
        created_at: endedAt,
        notes: [
            `Pre-roast used: ${explicitPreRoast ? "yes" : "no"}`,
            `Batch weight: ${roastWeightGrams ? `${roastWeightGrams} g` : "--"}`,
            `Final flame setting: ${flameControlEl.value}%`,
            analyticsNotes,
            stageNotes,
        ].filter(Boolean).join("\n"),
        curve: roastCurve,
        events: roastEvents.map((event) => ({
            label: event.label,
            detail: event.detail,
            time: event.time,
            chart_label: event.chartLabel,
            color: event.color,
            temperature: event.temperature,
            flame_level: event.flame_level,
        })),
        photo_data: "",
    };
}

function goToReview() {
    sessionStorage.setItem("pendingRoastReview", JSON.stringify(buildPendingRoastPayload()));
    window.location.href = "/roast/review";
}

async function loadRoastHardwareHealth() {
    const response = await fetch("/api/sensor/health");
    const health = await response.json();

    setHealthChip(roastTemperatureHealthEl, health.temperature_ok, "Online", "Offline");
    setHealthChip(roastServoHealthEl, health.servo_ok, "Online", "Offline");
    roastHardwareFlameLevelEl.textContent = `${health.flame_level ?? 0}%`;
    roastHardwareModeEl.textContent = health.mode || "Unknown";
    roastHardwareErrorEl.textContent = health.last_temperature_error || "No hardware errors reported.";
    roastHealthSummaryEl.textContent = response.ok
        ? `Hardware ready in ${health.source || "unknown"} mode.`
        : `Hardware needs attention in ${health.source || "unknown"} mode.`;

    if (response.ok) {
        lastHardwareIssueKey = null;
        roastLatestIssueEl.style.display = "none";
        roastLatestIssueTextEl.textContent = "";
        roastHardwarePanelEl.classList.remove("panel-alert");
    } else {
        recordHardwareIssue(
            health.last_temperature_error
                ? `Health check failed: ${health.last_temperature_error}.`
                : "Health check failed: sensor or servo controller is offline.",
            { code: "health-check" }
        );
    }
}

roastSessionSocket.on("connect", () => {
    sensorStatusEl.textContent = "Connected";
    sessionMessageEl.textContent = "Roast session connected. Use Pre Roast to begin logging.";
});

roastSessionSocket.on("disconnect", () => {
    sensorStatusEl.textContent = "Disconnected";
    sessionMessageEl.textContent = "Trying to reconnect to the temperature stream...";
});

roastSessionSocket.on("sensor_state", (state) => {
    sensorStatusEl.textContent = state.active ? "Streaming" : "Paused";
    sensorSourceEl.textContent = state.source || "Unknown";
    if (state.flame_level !== undefined) {
        flameControlEl.value = String(state.flame_level);
        flameValueEl.textContent = `${state.flame_level}%`;
        roastHardwareFlameLevelEl.textContent = `${state.flame_level}%`;
        lastLoggedFlameLevel = Number(state.flame_level);
    }
});

roastSessionSocket.on("sensor_data", (data) => {
    updateLiveTemperature(data);
    if (roastRecording && !roastFinished) {
        captureTemperature(data);
    }
});

roastSessionSocket.on("control_response", (data) => {
    sessionMessageEl.textContent = data.message;
});

flameControlEl.addEventListener("input", () => {
    const nextFlameLevel = currentFlameLevel();
    flameValueEl.textContent = `${nextFlameLevel}%`;
    roastSessionSocket.emit("control", {
        command: "set_flame_level",
        flame_level: nextFlameLevel,
    });

    if (roastRecording && nextFlameLevel !== lastLoggedFlameLevel) {
        addEvent("Flame Change", `Flame adjusted from ${lastLoggedFlameLevel}% to ${nextFlameLevel}%.`, {
            color: "#ff8f47",
            flameLevel: nextFlameLevel,
        });
    }

    lastLoggedFlameLevel = nextFlameLevel;
});

preRoastButtonEl.addEventListener("click", () => {
    roastFinished = false;
    explicitPreRoast = true;
    preRoastAt = currentTimestamp();
    roastStartedAt = null;
    roastEvents.length = 0;
    clearRoastGraph();
    beginRecording(true);
    lastLoggedFlameLevel = currentFlameLevel();
    addEvent("Pre Roast", `Recording started at ${temperatureValueEl.textContent} with flame ${flameControlEl.value}%.`, {
        time: preRoastAt,
        showMarker: true,
        chartLabel: latestSensorData?.timestamp || "Pre Roast",
        color: "#566a8e",
        flameLevel: currentFlameLevel(),
    });
    sessionMessageEl.textContent = "Pre-roast started. Recording time, temperature, and flame setting every sensor update.";
});

startRoastButtonEl.addEventListener("click", () => {
    if (!roastRecording) {
        preRoastAt = null;
        explicitPreRoast = false;
        beginRecording(false);
    }
    roastStartedAt = currentTimestamp();
    lastLoggedFlameLevel = currentFlameLevel();
    addEvent("Start", `Roast start marked at ${temperatureValueEl.textContent} with flame ${flameControlEl.value}%.`, {
        time: roastStartedAt,
        showMarker: true,
        chartLabel: latestSensorData?.timestamp || "Start",
        color: "#b4542b",
        flameLevel: currentFlameLevel(),
    });
    sessionMessageEl.textContent = "Start marker recorded on the graph.";
});

firstCrackButtonEl.addEventListener("click", () => {
    addEvent("First Crack", `First crack marked at ${temperatureValueEl.textContent}.`, {
        showMarker: true,
        chartLabel: latestSensorData?.timestamp || "First Crack",
        color: "#d4a246",
        flameLevel: currentFlameLevel(),
    });
    sessionMessageEl.textContent = "First crack marker recorded.";
});

secondCrackButtonEl.addEventListener("click", () => {
    addEvent("Second Crack", `Second crack marked at ${temperatureValueEl.textContent}.`, {
        showMarker: true,
        chartLabel: latestSensorData?.timestamp || "Second Crack",
        color: "#2a7f86",
        flameLevel: currentFlameLevel(),
    });
    sessionMessageEl.textContent = "Second crack marker recorded.";
});

finishRoastButtonEl.addEventListener("click", () => {
    if (roastFinished) {
        return;
    }

    if (!roastCurve.length) {
        sessionMessageEl.textContent = "No temperature points captured yet. Start or pre-roast first.";
        return;
    }

    roastFinished = true;
    roastRecording = false;
    roastSessionSocket.emit("control", { command: "stop" });
    addEvent("Finish", `Roast finished at ${temperatureValueEl.textContent}. Ready for review.`, {
        showMarker: true,
        chartLabel: latestSensorData?.timestamp || "Finish",
        color: "#7f3417",
        flameLevel: currentFlameLevel(),
    });
    sessionMessageEl.textContent = "Opening roast review...";
    goToReview();
});

renderEvents();
renderAnalytics();
loadRoastHardwareHealth().catch(() => {
    roastHealthSummaryEl.textContent = "Unable to fetch hardware health right now.";
    roastHardwareErrorEl.textContent = "Health endpoint unavailable.";
    setHealthChip(roastTemperatureHealthEl, false, "Online", "Offline");
    setHealthChip(roastServoHealthEl, false, "Online", "Offline");
    recordHardwareIssue("Health endpoint unavailable during roast session.", {
        code: "health-endpoint",
    });
});

hardwareHealthPollId = window.setInterval(() => {
    if (roastFinished) {
        return;
    }

    loadRoastHardwareHealth().catch(() => {
        roastHealthSummaryEl.textContent = "Unable to refresh hardware health right now.";
        roastHardwareErrorEl.textContent = "Health endpoint unavailable.";
        setHealthChip(roastTemperatureHealthEl, false, "Online", "Offline");
        setHealthChip(roastServoHealthEl, false, "Online", "Offline");
        recordHardwareIssue("Health endpoint unavailable during roast session.", {
            code: "health-endpoint",
        });
    });
}, 10000);

window.addEventListener("beforeunload", () => {
    if (hardwareHealthPollId) {
        window.clearInterval(hardwareHealthPollId);
    }
});
