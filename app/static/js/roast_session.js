const roastSessionSocket = io();
const beanName = document.body.dataset.beanName || "Unnamed Roast";
const origin = document.body.dataset.origin || "Unknown origin";
const roastLevel = document.body.dataset.roastLevel || "Medium";
const roastWeightGrams = document.body.dataset.weightGrams || "";
const requestedReferenceId = Number(document.body.dataset.referenceId || 0) || null;

const sessionMessageEl = document.getElementById("sessionMessage");
const sensorStatusEl = document.getElementById("sensorStatus");
const sensorSourceEl = document.getElementById("sensorSource");
const lastUpdatedEl = document.getElementById("lastUpdated");
const temperatureValueEl = document.getElementById("temperatureValue");
const referenceSummaryEl = document.getElementById("referenceSummary");
const flameControlEl = document.getElementById("flameControl");
const flameValueEl = document.getElementById("flameValue");
const preRoastButtonEl = document.getElementById("preRoastButton");
const startRoastButtonEl = document.getElementById("startRoastButton");
const dryEndButtonEl = document.getElementById("dryEndButton");
const firstCrackButtonEl = document.getElementById("firstCrackButton");
const firstCrackEndButtonEl = document.getElementById("firstCrackEndButton");
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
const simulatedBadgeEl = document.getElementById("simulatedBadge");
const analyticsDurationEl = document.getElementById("analyticsDuration");
const analyticsDevelopmentEl = document.getElementById("analyticsDevelopment");
const analyticsDevelopmentRatioEl = document.getElementById("analyticsDevelopmentRatio");
const analyticsPeakTemperatureEl = document.getElementById("analyticsPeakTemperature");
const analyticsRorEl = document.getElementById("analyticsRor");
const analyticsAucEl = document.getElementById("analyticsAuc");
const analyticsCopyEl = document.getElementById("analyticsCopy");
const assistModeEl = document.getElementById("assistMode");
const assistTargetEl = document.getElementById("assistTarget");
const assistDeadbandEl = document.getElementById("assistDeadband");
const assistStepEl = document.getElementById("assistStep");
const assistIntervalEl = document.getElementById("assistInterval");
const assistMinEl = document.getElementById("assistMin");
const assistMaxEl = document.getElementById("assistMax");
const assistToggleEl = document.getElementById("assistToggle");
const assistStatusEl = document.getElementById("assistStatus");
const assistCopyEl = document.getElementById("assistCopy");
const phaseSummaryEl = document.getElementById("phaseSummary");
const phaseProjectionEl = document.getElementById("phaseProjection");
const lcdTemperatureEl = document.getElementById("lcdTemperature");
const lcdRorEl = document.getElementById("lcdRor");
const lcdElapsedEl = document.getElementById("lcdElapsed");
const lcdSinceFirstCrackEl = document.getElementById("lcdSinceFirstCrack");
const lcdDtrEl = document.getElementById("lcdDtr");
const lcdReferenceBlockEl = document.getElementById("lcdReferenceBlock");
const lcdReferenceDeltaEl = document.getElementById("lcdReferenceDelta");
const lcdReferenceTimingEl = document.getElementById("lcdReferenceTiming");
const alarmListEl = document.getElementById("alarmList");
const alarmFormEl = document.getElementById("alarmForm");
const alarmSourceEl = document.getElementById("alarmSource");
const alarmValueEl = document.getElementById("alarmValue");
const alarmFromEl = document.getElementById("alarmFrom");
const alarmActionEl = document.getElementById("alarmAction");
const alarmFlameFieldEl = document.getElementById("alarmFlameField");
const alarmFlameEl = document.getElementById("alarmFlame");
const alarmMessageEl = document.getElementById("alarmMessage");
const alarmTestSoundEl = document.getElementById("alarmTestSound");

const roastChart = createLineChart("temperatureChart", "Temperature", "#b4542b");
enableRorOverlay(roastChart);
enableFlameOverlay(roastChart);
enableReferenceOverlay(roastChart);

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
let screenWakeLock = null;
let turnPointAlerted = false;
let rorCrashAlerted = false;
let sensorFaultActive = false;
let latestAnalytics = null;

// Reference (background) roast overlay state.
let roastReference = null;
const referenceCuesFired = new Set();

// Alarms.
let roastAlarms = loadRoastAlarms();
const firedAlarmIds = new Set();

// Flame assist.
let assistSettings = loadAssistSettings();
let assistEnabled = false;
let lastAssistAdjustAt = 0;
let lastManualFlameAt = 0;

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

function chartBaseOptions() {
    return { startedAt: roastStartedAt || preRoastAt };
}

async function acquireWakeLock() {
    if (!("wakeLock" in navigator)) {
        return;
    }
    try {
        screenWakeLock = await navigator.wakeLock.request("screen");
        screenWakeLock.addEventListener("release", () => {
            screenWakeLock = null;
        });
    } catch (error) {
        // Wake lock can be denied (e.g. low battery); the roast still runs.
        screenWakeLock = null;
    }
}

function releaseWakeLock() {
    if (screenWakeLock) {
        screenWakeLock.release().catch(() => {});
        screenWakeLock = null;
    }
}

function ensureNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
    }
}

// Alert the roaster about an automatic event. Uses a system notification when
// the page is backgrounded, and always mirrors it as an in-page toast.
function notifyRoast(title, body, type = "info") {
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        try {
            new Notification(title, {
                body,
                icon: "/static/icons/icon-192.png",
                tag: "roaster-event",
            });
        } catch (error) {
            // fall through to the toast
        }
    }
    if (typeof showToast === "function") {
        showToast(body ? `${title} — ${body}` : title, type);
    }
}

// --- In-progress roast persistence (survives tab close / crash) ---
const ROAST_DRAFT_KEY = "roastDraft";

function saveRoastDraft() {
    if (!roastRecording || roastFinished) {
        return;
    }
    try {
        localStorage.setItem(ROAST_DRAFT_KEY, JSON.stringify({
            version: 2,
            savedAt: currentTimestamp(),
            beanName,
            origin,
            roastLevel,
            weightGrams: roastWeightGrams,
            curve: roastCurve,
            events: roastEvents,
            preRoastAt,
            roastStartedAt,
            explicitPreRoast,
            referenceId: roastReference?.id || null,
            firedAlarmIds: Array.from(firedAlarmIds),
        }));
    } catch (error) {
        // localStorage may be unavailable or full; the roast still runs live.
    }
}

function clearRoastDraft() {
    try {
        localStorage.removeItem(ROAST_DRAFT_KEY);
    } catch (error) {
        // ignore
    }
}

function restoreRoastDraft(draft) {
    roastCurve.length = 0;
    (draft.curve || []).forEach((point) => roastCurve.push(point));
    roastEvents.length = 0;
    (draft.events || []).forEach((event) => roastEvents.push(event));
    preRoastAt = draft.preRoastAt || null;
    roastStartedAt = draft.roastStartedAt || null;
    explicitPreRoast = Boolean(draft.explicitPreRoast);
    roastFinished = false;
    roastRecording = true;
    (draft.firedAlarmIds || []).forEach((id) => firedAlarmIds.add(String(id)));

    renderEvents();
    refreshChart();
    renderAnalytics();

    acquireWakeLock();
    ensureNotificationPermission();
    roastSessionSocket.emit("control", { command: "start" });
    sessionMessageEl.textContent = "Resumed your in-progress roast. Continue, or mark Drop to review.";

    if (draft.referenceId && !roastReference) {
        loadReferenceRoast(Number(draft.referenceId)).catch(() => {});
    }
}

function maybeOfferDraftResume() {
    let draft = null;
    try {
        const raw = localStorage.getItem(ROAST_DRAFT_KEY);
        draft = raw ? JSON.parse(raw) : null;
    } catch (error) {
        draft = null;
    }

    if (!draft || !Array.isArray(draft.curve) || !draft.curve.length) {
        return;
    }

    const when = new Date(draft.savedAt);
    const label = Number.isNaN(when.getTime()) ? "earlier" : when.toLocaleString();
    const resume = window.confirm(
        `Resume your in-progress roast of ${draft.beanName || "a roast"} from ${label}? Choose Cancel to discard it.`
    );
    if (resume) {
        restoreRoastDraft(draft);
    } else {
        clearRoastDraft();
    }
}

// --- Reference roast overlay -------------------------------------------------

async function loadReferenceRoast(roastId) {
    if (!roastId) {
        return;
    }
    const response = await fetch(`/api/roasts/${roastId}`);
    if (!response.ok) {
        referenceSummaryEl.textContent = `roast #${roastId} not found`;
        return;
    }
    const roast = await response.json();
    const options = { startedAt: roast.started_at, endedAt: roast.ended_at };
    const temperature = buildChartSeries(roast.curve || [], options);
    const baseTime = resolveChartBaseTime(roast.curve || [], options);
    const turningPoint = detectTurningPoint(roast.curve || [], options);
    const cues = (roast.events || [])
        .filter((event) => event.label && !["Pre Roast", "Charge", "Start", "Hardware Issue", "Sensor Recovered"].includes(event.label))
        .map((event) => ({
            label: event.label,
            x: toElapsedMinutes(event.time, baseTime, roast.started_at),
            temperature: Number.isFinite(Number(event.temperature)) ? Number(event.temperature) : null,
            flameLevel: Number.isFinite(Number(event.flame_level)) ? Number(event.flame_level) : null,
            color: event.color || "#7ea4ff",
            isStage: ["Dry End", "First Crack", "First Crack End", "Second Crack", "Drop", "Finish"].includes(event.label),
        }))
        .filter((event) => Number.isFinite(event.x))
        .sort((a, b) => a.x - b.x);

    roastReference = {
        id: roast.id,
        beanName: roast.bean_name || `Roast #${roast.id}`,
        temperature,
        flame: buildFlameSeries(roast.curve || [], options),
        rorSeries: buildRorSeries(roast.curve || [], options),
        cues,
        turnX: turningPoint?.x ?? 0,
        phases: buildRoastPhases(roast.curve || [], roast.events || [], options),
    };
    referenceCuesFired.clear();

    setReferenceSeries(roastChart, { temperature: roastReference.temperature, flame: roastReference.flame });
    referenceSummaryEl.textContent = `${roastReference.beanName} (#${roastReference.id})`;
    lcdReferenceBlockEl.style.display = "";
    rebuildStageMarkers();
    saveRoastDraft();
}

function referenceMarkers() {
    if (!roastReference) {
        return [];
    }
    return roastReference.cues
        .filter((cue) => cue.isStage)
        .map((cue) => ({
            label: cue.x,
            text: `Ref ${cue.label}`,
            color: "rgba(126, 164, 255, 0.7)",
            style: "reference",
        }));
}

// Live comparison against the reference at the current elapsed time.
function renderReferenceDelta(analytics) {
    if (!roastReference || !roastStartedAt) {
        lcdReferenceDeltaEl.textContent = "--";
        lcdReferenceTimingEl.textContent = roastReference ? "waiting for Charge" : "--";
        return;
    }

    const elapsedMinutes = (Date.now() - new Date(roastStartedAt).getTime()) / 60000;
    const referenceTemp = interpolateSeries(roastReference.temperature, elapsedMinutes);
    const currentTemp = analytics?.currentTemperature;
    if (!Number.isFinite(referenceTemp) || !Number.isFinite(currentTemp)) {
        lcdReferenceDeltaEl.textContent = "--";
        lcdReferenceTimingEl.textContent = elapsedMinutes > (roastReference.temperature.at(-1)?.x ?? 0)
            ? "past reference end"
            : "--";
        return;
    }

    const deltaTemp = currentTemp - referenceTemp;
    lcdReferenceDeltaEl.textContent = `${deltaTemp >= 0 ? "+" : ""}${deltaTemp.toFixed(1)} °C`;
    lcdReferenceDeltaEl.classList.toggle("lcd-warn", Math.abs(deltaTemp) >= 5);

    // When did the reference first reach the current temperature (after its turn point)?
    const match = roastReference.temperature.find((point) => point.x >= roastReference.turnX && point.y >= currentTemp);
    if (!match) {
        lcdReferenceTimingEl.textContent = "hotter than reference ever was";
        return;
    }
    const offsetSeconds = (match.x - elapsedMinutes) * 60;
    if (Math.abs(offsetSeconds) < 3) {
        lcdReferenceTimingEl.textContent = "on pace";
    } else {
        lcdReferenceTimingEl.textContent = `${formatDuration(Math.abs(offsetSeconds))} ${offsetSeconds > 0 ? "ahead" : "behind"}`;
    }
}

// Artisan's "playback aid": pop a cue when the live roast reaches the time of
// each reference event so the flame moves can be repeated by hand.
function checkReferenceCues() {
    if (!roastReference || !roastStartedAt || !roastRecording || roastFinished) {
        return;
    }
    const elapsedMinutes = (Date.now() - new Date(roastStartedAt).getTime()) / 60000;
    roastReference.cues.forEach((cue, index) => {
        if (referenceCuesFired.has(index) || elapsedMinutes < cue.x) {
            return;
        }
        referenceCuesFired.add(index);
        const parts = [`${cue.label} at ${formatDuration(cue.x * 60)}`];
        if (Number.isFinite(cue.temperature)) {
            parts.push(`${cue.temperature.toFixed(0)} °C`);
        }
        if (cue.label === "Flame Change" && Number.isFinite(cue.flameLevel)) {
            parts.push(`flame → ${cue.flameLevel}%`);
        }
        notifyRoast("Reference roast", parts.join(" · "), "info");
    });
}

// --- Rendering --------------------------------------------------------------

function renderEvents() {
    if (!roastEvents.length) {
        eventLogEl.innerHTML = '<div class="empty-state">No roast events marked yet.</div>';
        return;
    }

    eventLogEl.innerHTML = roastEvents.map((event) => `
        <article class="history-item">
            <div class="history-topline">
                <span>${escapeHtml(event.label)}</span>
                <span>${escapeHtml(event.displayTime)}</span>
            </div>
            <div class="history-meta">${escapeHtml(event.detail)}</div>
        </article>
    `).join("");
}

function refreshChart() {
    const options = chartBaseOptions();
    setChartSeries(roastChart, buildChartSeries(roastCurve, options));
    setRorSeries(roastChart, buildRorSeries(roastCurve, options));
    setFlameSeries(roastChart, buildFlameSeries(roastCurve, options));
    rebuildStageMarkers();
}

function renderLcds(analytics) {
    lcdTemperatureEl.textContent = Number.isFinite(analytics?.currentTemperature)
        ? analytics.currentTemperature.toFixed(1)
        : (hasSensorTemperature(latestSensorData) ? Number(latestSensorData.temperature).toFixed(1) : "--.-");
    lcdRorEl.textContent = Number.isFinite(analytics?.currentRor) ? analytics.currentRor.toFixed(1) : "--";
    lcdDtrEl.textContent = Number.isFinite(analytics?.phases?.dtr) ? `${analytics.phases.dtr.toFixed(0)}%` : "--";
    renderTimers();
}

// Timers tick every second even between sensor samples.
function renderTimers() {
    const now = Date.now();
    if (roastStartedAt && !roastFinished) {
        lcdElapsedEl.textContent = formatDuration((now - new Date(roastStartedAt).getTime()) / 1000);
    } else if (!roastStartedAt) {
        lcdElapsedEl.textContent = "--";
    }
    const firstCrack = findRoastEvent(roastEvents, "firstCrack");
    if (firstCrack && !roastFinished) {
        lcdSinceFirstCrackEl.textContent = formatDuration((now - new Date(firstCrack.time).getTime()) / 1000);
    } else if (!firstCrack) {
        lcdSinceFirstCrackEl.textContent = "--";
    }
}

function renderProjection(analytics) {
    if (!roastStartedAt || !analytics) {
        phaseProjectionEl.textContent = "Mark Charge to start phase tracking.";
        return;
    }
    const settings = getRoastSettings();
    const dryEnd = findRoastEvent(roastEvents, "dryEnd");
    const firstCrack = findRoastEvent(roastEvents, "firstCrack");
    const parts = [];

    if (!dryEnd && !firstCrack) {
        const seconds = projectSecondsToTemperature(analytics.currentTemperature, settings.dryEndTargetC, analytics.currentRor);
        parts.push(seconds !== null
            ? `Dry End (${settings.dryEndTargetC} °C) in ~${formatDuration(seconds)} at current RoR`
            : `Dry End target ${settings.dryEndTargetC} °C`);
    }
    if (!firstCrack) {
        const seconds = projectSecondsToTemperature(analytics.currentTemperature, settings.firstCrackTargetC, analytics.currentRor);
        parts.push(seconds !== null
            ? `First Crack (${settings.firstCrackTargetC} °C) in ~${formatDuration(seconds)}`
            : `First Crack target ${settings.firstCrackTargetC} °C`);
    } else {
        const development = analytics.phases?.phases?.find((phase) => phase.key === "development");
        if (development) {
            parts.push(`Development ${formatDuration(development.seconds)} · DTR ${formatPercent(development.percent)} (many roasters target 20–25%)`);
        }
    }
    phaseProjectionEl.textContent = parts.join(" · ");
}

function renderAnalytics() {
    const analytics = buildRoastAnalytics(roastCurve, roastEvents, {
        startedAt: roastStartedAt || preRoastAt,
        endedAt: roastFinished ? currentTimestamp() : null,
    });
    latestAnalytics = analytics;

    analyticsDurationEl.textContent = formatDuration(analytics.totalDurationSeconds);
    analyticsDevelopmentEl.textContent = formatDuration(analytics.developmentSeconds);
    analyticsDevelopmentRatioEl.textContent = formatPercent(analytics.developmentRatio);
    analyticsPeakTemperatureEl.textContent = Number.isFinite(analytics.peakTemperature)
        ? `${analytics.peakTemperature.toFixed(1)} °C`
        : "--";
    analyticsRorEl.textContent = formatRate(analytics.currentRor);
    analyticsAucEl.textContent = formatAuc(analytics.auc);

    renderLcds(analytics);
    renderProjection(analytics);
    renderReferenceDelta(analytics);

    if (roastStartedAt) {
        renderPhaseSummary(phaseSummaryEl, analytics.phases);
        setPhaseBands(roastChart, buildPhaseBands(analytics.phases));
    } else {
        renderPhaseSummary(phaseSummaryEl, null);
        setPhaseBands(roastChart, []);
    }

    const firstCrackMarked = Boolean(findRoastEvent(roastEvents, "firstCrack"));
    if (firstCrackMarked && analytics.currentRor !== null && analytics.currentRor < 0 && !rorCrashAlerted) {
        rorCrashAlerted = true;
        notifyRoast("Rate of rise crashed", "RoR dropped below zero after first crack.", "error");
    }

    if (!roastCurve.length) {
        analyticsCopyEl.textContent = "Start the roast to begin calculating analytics.";
        return analytics;
    }

    if (!roastStartedAt) {
        analyticsCopyEl.textContent = "Pre-roast samples are collecting. Mark Charge to track roast duration from charge.";
        return analytics;
    }

    if (analytics.developmentSeconds === null) {
        analyticsCopyEl.textContent = "Development metrics will appear after you mark First Crack.";
        return analytics;
    }

    analyticsCopyEl.textContent = `Development phase is ${formatDuration(analytics.developmentSeconds)} so far with peak temperature at ${Number.isFinite(analytics.peakTemperature) ? `${analytics.peakTemperature.toFixed(1)} °C` : "--"}.`;
    return analytics;
}

function rebuildStageMarkers() {
    const baseTime = resolveChartBaseTime(roastCurve, chartBaseOptions());
    const markers = roastEvents
        .filter((event) => event.showMarker && event.chartLabel)
        .map((event) => ({
            label: toElapsedMinutes(event.chartLabel, baseTime, roastStartedAt || preRoastAt),
            text: event.label,
            color: event.color,
        }))
        .filter((event) => Number.isFinite(event.label));

    const turningPoint = detectTurningPoint(roastCurve, chartBaseOptions());
    if (turningPoint) {
        markers.push({
            label: turningPoint.x,
            text: `Turn ${turningPoint.temperature.toFixed(0)}°C`,
            color: "#9b6dff",
        });
        if (!turnPointAlerted) {
            turnPointAlerted = true;
            notifyRoast("Turn point reached", `${turningPoint.temperature.toFixed(0)} °C — temperature is climbing again.`);
        }
    }

    setStageMarkers(roastChart, [...referenceMarkers(), ...markers]);
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
        temperature: hasSensorTemperature(latestSensorData) ? Number(latestSensorData.temperature) : null,
        flame_level: options.flameLevel ?? currentFlameLevel(),
    };
    roastEvents.push(event);
    renderEvents();
    rebuildStageMarkers();
    saveRoastDraft();
}

function markStageEvent(label, color, message) {
    addEvent(label, `${label} marked at ${temperatureValueEl.textContent} with flame ${flameControlEl.value}%.`, {
        showMarker: true,
        chartLabel: latestSensorData?.timestamp || label,
        color,
        flameLevel: currentFlameLevel(),
    });
    sessionMessageEl.textContent = message;
    renderAnalytics();
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
    notifyRoast("Hardware issue", detail, "error");
}

// Shared by the live sensor stream and the health poll so one fault is logged
// once (recordHardwareIssue dedupes on text + code).
function reportSensorFault(errorText) {
    sensorFaultActive = true;
    recordHardwareIssue(`Sensor fault: ${errorText}.`, { code: "sensor-fault" });
}

function clearSensorFault() {
    if (!sensorFaultActive) {
        return;
    }
    sensorFaultActive = false;
    lastHardwareIssueKey = null;
    roastLatestIssueEl.style.display = "none";
    roastLatestIssueTextEl.textContent = "";
    roastHardwarePanelEl.classList.remove("panel-alert");
    if (roastRecording && !roastFinished) {
        addEvent("Sensor Recovered", "Thermocouple readings resumed.", { color: "#2a7f86" });
    }
    notifyRoast("Sensor recovered", "Thermocouple readings resumed.", "success");
}

function clearRoastGraph() {
    roastCurve.length = 0;
    refreshChart();
    renderAnalytics();
}

function updateLiveTemperature(data) {
    latestSensorData = data;
    temperatureValueEl.textContent = hasSensorTemperature(data)
        ? `${Number(data.temperature).toFixed(1)} °C`
        : "-- °C";
    if (!roastRecording) {
        lcdTemperatureEl.textContent = hasSensorTemperature(data) ? Number(data.temperature).toFixed(1) : "--.-";
    }
    sensorSourceEl.textContent = data.source || "Unknown";
    lastUpdatedEl.textContent = data.timestamp;
}

function captureTemperature(data) {
    if (!hasSensorTemperature(data)) {
        return;
    }

    roastCurve.push({
        timestamp: data.timestamp,
        temperature: Number(data.temperature),
        flame_level: currentFlameLevel(),
    });

    refreshChart();
    const analytics = renderAnalytics();
    checkReferenceCues();
    evaluateAlarms(analytics);
    saveRoastDraft();
}

function beginRecording(fromPreRoast) {
    roastFinished = false;
    roastRecording = true;
    turnPointAlerted = false;
    rorCrashAlerted = false;
    firedAlarmIds.clear();
    referenceCuesFired.clear();
    if (!preRoastAt) {
        preRoastAt = currentTimestamp();
    }
    explicitPreRoast = fromPreRoast || explicitPreRoast;
    acquireWakeLock();
    ensureNotificationPermission();
    roastSessionSocket.emit("control", { command: "start" });
}

// --- Flame control ------------------------------------------------------------

function applyFlameLevel(level, options = {}) {
    const nextFlameLevel = Math.max(0, Math.min(100, Math.round(Number(level))));
    if (!Number.isFinite(nextFlameLevel)) {
        return;
    }
    flameControlEl.value = String(nextFlameLevel);
    flameValueEl.textContent = `${nextFlameLevel}%`;
    roastSessionSocket.emit("control", {
        command: "set_flame_level",
        flame_level: nextFlameLevel,
    });

    if (roastRecording && nextFlameLevel !== lastLoggedFlameLevel) {
        const source = options.source ? ` (${options.source})` : "";
        addEvent("Flame Change", `Flame adjusted from ${lastLoggedFlameLevel}% to ${nextFlameLevel}%${source}.`, {
            color: "#ff8f47",
            flameLevel: nextFlameLevel,
        });
    }

    if (options.source !== "assist") {
        // A hand (or alarm) move pauses the assist for one interval so they never fight.
        lastManualFlameAt = Date.now();
    }
    lastLoggedFlameLevel = nextFlameLevel;
}

// --- Flame assist (RoR step controller) ------------------------------------------

function fillAssistForm() {
    assistModeEl.value = assistSettings.mode;
    assistTargetEl.value = assistSettings.targetRor;
    assistDeadbandEl.value = assistSettings.deadband;
    assistStepEl.value = assistSettings.stepPercent;
    assistIntervalEl.value = assistSettings.intervalSeconds;
    assistMinEl.value = assistSettings.minFlame;
    assistMaxEl.value = assistSettings.maxFlame;
}

function readAssistForm() {
    assistSettings = saveAssistSettings({
        mode: assistModeEl.value,
        targetRor: assistTargetEl.value,
        deadband: assistDeadbandEl.value,
        stepPercent: assistStepEl.value,
        intervalSeconds: assistIntervalEl.value,
        minFlame: assistMinEl.value,
        maxFlame: assistMaxEl.value,
    });
    fillAssistForm();
}

function setAssistEnabled(enabled, reason) {
    assistEnabled = Boolean(enabled);
    assistToggleEl.textContent = assistEnabled ? "Disable assist" : "Enable assist";
    assistStatusEl.classList.toggle("assist-active", assistEnabled);
    if (!assistEnabled) {
        assistStatusEl.textContent = reason ? `Off (${reason})` : "Off";
        return;
    }
    assistStatusEl.textContent = "Armed";
}

function currentAssistTarget(elapsedMinutes) {
    if (assistSettings.mode === "reference") {
        return roastReference ? referenceRorAt(roastReference.rorSeries, elapsedMinutes) : null;
    }
    return assistSettings.targetRor;
}

function runFlameAssist(analytics) {
    if (!assistEnabled || !roastRecording || roastFinished || !roastStartedAt) {
        return;
    }
    if (sensorFaultActive) {
        assistStatusEl.textContent = "Paused (sensor fault)";
        return;
    }
    const now = Date.now();
    const intervalMs = assistSettings.intervalSeconds * 1000;
    const elapsedMinutes = (now - new Date(roastStartedAt).getTime()) / 60000;
    const target = currentAssistTarget(elapsedMinutes);
    const ror = analytics?.currentRor ?? null;
    if (!Number.isFinite(target)) {
        assistStatusEl.textContent = assistSettings.mode === "reference"
            ? "Waiting (no reference RoR at this time)"
            : "Waiting (no target)";
        return;
    }
    if (!Number.isFinite(ror)) {
        assistStatusEl.textContent = "Waiting (no RoR yet)";
        return;
    }
    const manualHold = now - lastManualFlameAt < intervalMs;
    const waiting = now - lastAssistAdjustAt < intervalMs;
    assistStatusEl.textContent = `Target ${target.toFixed(1)} · RoR ${ror.toFixed(1)}${manualHold ? " · paused after manual move" : ""}`;
    if (manualHold || waiting) {
        return;
    }

    const next = computeAssistAdjustment({ ror, target, currentFlame: currentFlameLevel(), settings: assistSettings });
    lastAssistAdjustAt = now;
    if (next === null) {
        return;
    }
    applyFlameLevel(next, { source: "assist" });
    assistCopyEl.textContent = `Assist moved the flame to ${next}% at ${formatDuration(elapsedMinutes * 60)} (RoR ${ror.toFixed(1)} vs target ${target.toFixed(1)}).`;
}

[assistModeEl, assistTargetEl, assistDeadbandEl, assistStepEl, assistIntervalEl, assistMinEl, assistMaxEl].forEach((element) => {
    element.addEventListener("change", readAssistForm);
});

assistToggleEl.addEventListener("click", () => {
    readAssistForm();
    if (!assistEnabled && assistSettings.mode === "reference" && !roastReference) {
        showToast("Pick a reference roast on the setup page to follow its RoR.", "error");
        return;
    }
    setAssistEnabled(!assistEnabled);
    if (assistEnabled) {
        lastAssistAdjustAt = Date.now(); // first adjustment after one full interval
        showToast("Flame assist enabled. Moving the slider pauses it for one interval.", "info");
    }
});

// --- Alarms -----------------------------------------------------------------------

function renderAlarmList() {
    if (!roastAlarms.length) {
        alarmListEl.innerHTML = '<div class="empty-state">No alarms configured.</div>';
        return;
    }
    alarmListEl.innerHTML = roastAlarms.map((alarm) => `
        <article class="history-item alarm-item ${alarm.enabled ? "" : "alarm-disabled"} ${firedAlarmIds.has(alarm.id) ? "alarm-fired" : ""}">
            <div class="history-topline">
                <span>${escapeHtml(alarm.message || describeRoastAlarm(alarm))}</span>
                <span>${firedAlarmIds.has(alarm.id) ? "fired" : (alarm.enabled ? "armed" : "off")}</span>
            </div>
            <div class="history-meta">${escapeHtml(describeRoastAlarm(alarm))}</div>
            <div class="inline-controls alarm-actions">
                <button class="ghost" type="button" data-alarm-toggle="${escapeHtml(alarm.id)}">${alarm.enabled ? "Disable" : "Enable"}</button>
                <button class="ghost" type="button" data-alarm-delete="${escapeHtml(alarm.id)}">Delete</button>
            </div>
        </article>
    `).join("");

    alarmListEl.querySelectorAll("[data-alarm-toggle]").forEach((button) => {
        button.addEventListener("click", () => {
            const alarm = roastAlarms.find((item) => item.id === button.dataset.alarmToggle);
            if (alarm) {
                alarm.enabled = !alarm.enabled;
                saveRoastAlarms(roastAlarms);
                renderAlarmList();
            }
        });
    });
    alarmListEl.querySelectorAll("[data-alarm-delete]").forEach((button) => {
        button.addEventListener("click", () => {
            roastAlarms = roastAlarms.filter((item) => item.id !== button.dataset.alarmDelete);
            saveRoastAlarms(roastAlarms);
            renderAlarmList();
        });
    });
}

function alarmEventTimes() {
    const toDate = (value) => (value ? new Date(value) : null);
    return {
        charge: toDate(roastStartedAt),
        dryEnd: toDate(findRoastEvent(roastEvents, "dryEnd")?.time),
        firstCrack: toDate(findRoastEvent(roastEvents, "firstCrack")?.time),
    };
}

function evaluateAlarms(analytics) {
    if (!roastRecording || roastFinished || !roastAlarms.length) {
        return;
    }
    const context = {
        temperature: analytics?.currentTemperature ?? null,
        ror: analytics?.currentRor ?? null,
        now: new Date(),
        eventTimes: alarmEventTimes(),
    };
    roastAlarms.forEach((alarm) => {
        if (firedAlarmIds.has(alarm.id)) {
            return;
        }
        if (evaluateRoastAlarm(alarm, context)) {
            firedAlarmIds.add(alarm.id);
            fireRoastAlarm(alarm);
        }
    });
}

function fireRoastAlarm(alarm) {
    const message = alarm.message || describeRoastAlarm(alarm);
    if (alarm.action === "beep" || alarm.action === "flame") {
        playAlarmBeep();
    }
    if (alarm.action === "speak") {
        speakAlarm(message);
    }
    if (alarm.action === "flame") {
        applyFlameLevel(alarm.flameLevel, { source: "alarm" });
    }
    notifyRoast("Alarm", message, alarm.action === "flame" ? "success" : "info");
    addEvent("Alarm", `${message} (${describeRoastAlarm(alarm)})`, { color: "#d4a246" });
    renderAlarmList();
}

alarmActionEl.addEventListener("change", () => {
    alarmFlameFieldEl.style.display = alarmActionEl.value === "flame" ? "" : "none";
});

alarmFormEl.addEventListener("submit", (event) => {
    event.preventDefault();
    const alarm = normalizeRoastAlarm({
        source: alarmSourceEl.value,
        value: alarmValueEl.value,
        fromEvent: alarmFromEl.value,
        action: alarmActionEl.value,
        flameLevel: alarmFlameEl.value,
        message: alarmMessageEl.value,
        enabled: true,
    });
    if (!alarm) {
        showToast("Enter a numeric alarm value.", "error");
        return;
    }
    roastAlarms.push(alarm);
    saveRoastAlarms(roastAlarms);
    renderAlarmList();
    alarmValueEl.value = "";
    alarmMessageEl.value = "";
    showToast(`Alarm added: ${describeRoastAlarm(alarm)}`, "success");
});

alarmTestSoundEl.addEventListener("click", () => {
    playAlarmBeep();
    speakAlarm("Roaster alarm test");
});

// --- Pending roast payload ------------------------------------------------------

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
    const phaseNotes = (analytics.phases?.phases || []).map((phase) => (
        `${phase.label}: ${formatDuration(phase.seconds)} (${formatPercent(phase.percent)})${phase.deltaTemp !== null ? `, ${phase.deltaTemp >= 0 ? "+" : ""}${phase.deltaTemp.toFixed(0)} °C` : ""}`
    ));
    const analyticsNotes = [
        `Roast duration: ${formatDuration(analytics.totalDurationSeconds)}`,
        `Development time: ${formatDuration(analytics.developmentSeconds)}`,
        `Development ratio: ${formatPercent(analytics.developmentRatio)}`,
        `Peak temperature: ${Number.isFinite(analytics.peakTemperature) ? `${analytics.peakTemperature.toFixed(1)} °C` : "--"}`,
        ...phaseNotes,
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
            roastReference ? `Reference roast: ${roastReference.beanName} (#${roastReference.id})` : "",
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
    // localStorage (not sessionStorage) so the review survives a tab close.
    localStorage.setItem("pendingRoastReview", JSON.stringify(buildPendingRoastPayload()));
    clearRoastDraft();
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
        reportSensorFault(health.last_temperature_error || "sensor or servo controller is offline");
    }
}

// --- Socket wiring ----------------------------------------------------------------

roastSessionSocket.on("connect", () => {
    sensorStatusEl.textContent = "Connected";
    sessionMessageEl.textContent = "Roast session connected. Use Pre Roast to begin logging.";
    sessionMessageEl.classList.remove("message-disconnected");
});

roastSessionSocket.on("disconnect", () => {
    sensorStatusEl.textContent = "Disconnected";
    sessionMessageEl.textContent = "Connection lost — trying to reconnect to the temperature stream.";
    sessionMessageEl.classList.add("message-disconnected");
    if (simulatedBadgeEl) {
        simulatedBadgeEl.style.display = "none";
    }
});

roastSessionSocket.on("sensor_state", (state) => {
    sensorStatusEl.textContent = state.active ? "Streaming" : "Paused";
    sensorSourceEl.textContent = state.source || "Unknown";
    if (simulatedBadgeEl) {
        simulatedBadgeEl.style.display = state.simulated ? "inline" : "none";
    }
    if (state.flame_level !== undefined) {
        flameControlEl.value = String(state.flame_level);
        flameValueEl.textContent = `${state.flame_level}%`;
        roastHardwareFlameLevelEl.textContent = `${state.flame_level}%`;
        lastLoggedFlameLevel = Number(state.flame_level);
    }
});

roastSessionSocket.on("sensor_data", (data) => {
    updateLiveTemperature(data);
    if (data.error) {
        // Hardware fault: show it and leave a gap in the curve. Never plot a stand-in value.
        reportSensorFault(data.error);
        return;
    }
    clearSensorFault();
    if (roastRecording && !roastFinished) {
        captureTemperature(data);
    }
});

roastSessionSocket.on("control_response", (data) => {
    sessionMessageEl.textContent = data.message;
});

// The server cut the flame (over-temperature or sensor-fault policy).
roastSessionSocket.on("safety_event", (data) => {
    const message = data?.message || "The server cut the flame for safety.";
    flameControlEl.value = "0";
    flameValueEl.textContent = "0%";
    roastHardwareFlameLevelEl.textContent = "0%";
    if (roastRecording && !roastFinished) {
        addEvent("Safety Cutoff", message, { color: "#a53d2d", flameLevel: 0 });
    }
    lastLoggedFlameLevel = 0;
    lastManualFlameAt = Date.now();
    setAssistEnabled(false, "safety cutoff");
    playAlarmBeep();
    notifyRoast("Safety cutoff", message, "error");
    sessionMessageEl.textContent = message;
});

flameControlEl.addEventListener("input", () => {
    applyFlameLevel(flameControlEl.value);
});

// --- Event buttons -------------------------------------------------------------------

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
    if (findRoastEvent(roastEvents, "charge") && roastRecording) {
        sessionMessageEl.textContent = "Charge is already marked for this roast.";
        return;
    }
    if (!roastRecording) {
        preRoastAt = null;
        explicitPreRoast = false;
        beginRecording(false);
    }
    roastStartedAt = currentTimestamp();
    lastLoggedFlameLevel = currentFlameLevel();
    addEvent("Charge", `Beans charged at ${temperatureValueEl.textContent} with flame ${flameControlEl.value}%.`, {
        time: roastStartedAt,
        showMarker: true,
        chartLabel: latestSensorData?.timestamp || "Charge",
        color: "#b4542b",
        flameLevel: currentFlameLevel(),
    });
    refreshChart();
    renderAnalytics();
    sessionMessageEl.textContent = "Charge marked. Roast time now counts from here.";
});

dryEndButtonEl.addEventListener("click", () => {
    if (findRoastEvent(roastEvents, "dryEnd")) {
        sessionMessageEl.textContent = "Dry End is already marked.";
        return;
    }
    markStageEvent("Dry End", "#6fae53", "Dry End marked. Maillard phase begins.");
});

firstCrackButtonEl.addEventListener("click", () => {
    if (findRoastEvent(roastEvents, "firstCrack")) {
        sessionMessageEl.textContent = "First Crack is already marked.";
        return;
    }
    markStageEvent("First Crack", "#d4a246", "First crack marked. Development phase begins.");
});

firstCrackEndButtonEl.addEventListener("click", () => {
    if (findRoastEvent(roastEvents, "firstCrackEnd")) {
        sessionMessageEl.textContent = "First Crack End is already marked.";
        return;
    }
    markStageEvent("First Crack End", "#c98b2e", "First crack end marked.");
});

secondCrackButtonEl.addEventListener("click", () => {
    markStageEvent("Second Crack", "#2a7f86", "Second crack marker recorded.");
});

finishRoastButtonEl.addEventListener("click", () => {
    if (roastFinished) {
        return;
    }

    if (!roastCurve.length) {
        sessionMessageEl.textContent = "No temperature points captured yet. Charge or pre-roast first.";
        return;
    }

    roastFinished = true;
    roastRecording = false;
    setAssistEnabled(false, "roast dropped");
    releaseWakeLock();
    roastSessionSocket.emit("control", { command: "stop" });
    addEvent("Drop", `Beans dropped at ${temperatureValueEl.textContent}. Ready for review.`, {
        showMarker: true,
        chartLabel: latestSensorData?.timestamp || "Drop",
        color: "#7f3417",
        flameLevel: currentFlameLevel(),
    });
    sessionMessageEl.textContent = "Opening roast review...";
    goToReview();
});

// --- Boot ------------------------------------------------------------------------------

renderEvents();
renderAnalytics();
renderAlarmList();
fillAssistForm();
setAssistEnabled(false);
maybeOfferDraftResume();
if (requestedReferenceId && !roastReference) {
    loadReferenceRoast(requestedReferenceId).catch(() => {
        referenceSummaryEl.textContent = "unavailable";
    });
}
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

const timerTickId = window.setInterval(() => {
    if (roastRecording && !roastFinished) {
        renderTimers();
        if (roastReference) {
            renderReferenceDelta(latestAnalytics);
            checkReferenceCues();
        }
        evaluateAlarms(latestAnalytics);
        runFlameAssist(latestAnalytics);
    }
}, 1000);

// Screen wake locks are released when the tab is hidden; re-acquire on return.
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && roastRecording && !roastFinished) {
        acquireWakeLock();
    }
});

window.addEventListener("beforeunload", () => {
    if (hardwareHealthPollId) {
        window.clearInterval(hardwareHealthPollId);
    }
    window.clearInterval(timerTickId);
    releaseWakeLock();
});
