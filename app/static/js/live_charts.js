// Shared chart + roast-math helpers. Loaded on every page from base.html.
// Pure functions at the bottom are also exported for node-based tests.

// ---------------------------------------------------------------------------
// Per-device roast settings (localStorage). Artisan keeps these per machine too.
// ---------------------------------------------------------------------------
const ROAST_SETTINGS_KEY = "roasterSettings";
const ROAST_SETTINGS_DEFAULTS = Object.freeze({
    rorWindowSeconds: 30,      // delta span used for the rate-of-rise slope
    rorSmoothingPoints: 5,     // trailing moving-average applied to the RoR
    dryEndTargetC: 150,        // used for the drying-phase ETA projection
    firstCrackTargetC: 196,    // used for the first-crack ETA projection
});

function getRoastSettings() {
    let stored = {};
    try {
        const raw = typeof localStorage !== "undefined" ? localStorage.getItem(ROAST_SETTINGS_KEY) : null;
        stored = raw ? JSON.parse(raw) : {};
    } catch (error) {
        stored = {};
    }
    const settings = { ...ROAST_SETTINGS_DEFAULTS };
    Object.keys(ROAST_SETTINGS_DEFAULTS).forEach((key) => {
        const value = Number(stored?.[key]);
        if (Number.isFinite(value) && value > 0) {
            settings[key] = value;
        }
    });
    return settings;
}

function saveRoastSettings(partial) {
    const next = { ...getRoastSettings(), ...partial };
    try {
        localStorage.setItem(ROAST_SETTINGS_KEY, JSON.stringify(next));
    } catch (error) {
        // localStorage may be unavailable; settings simply fall back to defaults.
    }
    return next;
}

// ---------------------------------------------------------------------------
// Roast events. Labels are what gets stored; roles let analytics accept the
// legacy "Start"/"Finish" labels from roasts saved before Charge/Drop existed.
// ---------------------------------------------------------------------------
const ROAST_EVENT_ROLES = Object.freeze({
    preRoast: ["Pre Roast"],
    charge: ["Charge", "Start"],
    dryEnd: ["Dry End"],
    firstCrack: ["First Crack"],
    firstCrackEnd: ["First Crack End"],
    secondCrack: ["Second Crack"],
    drop: ["Drop", "Finish"],
});

function findRoastEvent(events = [], role) {
    const labels = ROAST_EVENT_ROLES[role] || [role];
    return events.find((event) => labels.includes(event?.label)) || null;
}

const PHASE_COLORS = Object.freeze({
    drying: "#6fae53",
    maillard: "#f1c96b",
    development: "#b4542b",
});

// ---------------------------------------------------------------------------
// Chart.js plugins
// ---------------------------------------------------------------------------
const stageMarkerPlugin = {
    id: "stageMarkerPlugin",
    afterDatasetsDraw(chart) {
        const markers = chart.options.plugins?.stageMarkers?.markers || [];
        const badges = chart.options.plugins?.stageMarkers?.badges || [];
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        const meta = chart.getDatasetMeta(0);

        if (!xScale || !yScale || (!markers.length && !badges.length)) {
            return;
        }

        const { ctx } = chart;
        ctx.save();

        markers.forEach((marker) => {
            const x = xScale.getPixelForValue(marker.label);
            if (!Number.isFinite(x) || x < xScale.left || x > xScale.right) {
                return;
            }

            const isReference = marker.style === "reference";
            ctx.strokeStyle = marker.color || "#7f3417";
            ctx.lineWidth = isReference ? 1 : 2;
            ctx.setLineDash(isReference ? [2, 5] : [6, 6]);
            ctx.beginPath();
            ctx.moveTo(x, yScale.top);
            ctx.lineTo(x, yScale.bottom);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = marker.color || "#7f3417";
            ctx.font = isReference ? "11px Trebuchet MS" : "12px Trebuchet MS";
            const textY = isReference ? yScale.bottom - 8 : yScale.top + 16;
            ctx.fillText(marker.text || "", x + 6, textY);
        });

        badges.forEach((badge) => {
            const pointIndex = chart.data.datasets[0]?.data?.findIndex((pointData) => (
                Number.isFinite(pointData?.x) && Math.abs(pointData.x - badge.x) < 0.001
            ));
            const point = pointIndex >= 0 ? meta?.data?.[pointIndex] : null;
            if (!point) {
                return;
            }

            const { x, y } = point.getProps(["x", "y"], true);
            const radius = 15;

            ctx.fillStyle = badge.color || "#7f3417";
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = "rgba(255,255,255,0.95)";
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = "#ffffff";
            ctx.font = "11px Trebuchet MS";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(badge.shortText || "", x, y);

            ctx.textAlign = "left";
            ctx.textBaseline = "alphabetic";
            ctx.fillStyle = badge.color || "#7f3417";
            ctx.font = "12px Trebuchet MS";
            ctx.fillText(badge.text || "", x + radius + 8, y - radius);
        });

        ctx.restore();
    },
};

// Translucent drying / Maillard / development bands behind the curves
// (Artisan draws these in green, yellow and brown).
const phaseBandPlugin = {
    id: "phaseBandPlugin",
    beforeDatasetsDraw(chart) {
        const bands = chart.options.plugins?.phaseBands?.bands || [];
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        if (!xScale || !yScale || !bands.length) {
            return;
        }

        const { ctx } = chart;
        ctx.save();
        bands.forEach((band) => {
            const fromX = Math.max(xScale.left, xScale.getPixelForValue(band.from));
            const toX = Math.min(xScale.right, xScale.getPixelForValue(band.to));
            if (!Number.isFinite(fromX) || !Number.isFinite(toX) || toX <= fromX) {
                return;
            }
            ctx.fillStyle = band.color;
            ctx.fillRect(fromX, yScale.top, toX - fromX, yScale.bottom - yScale.top);
            if (band.text) {
                ctx.fillStyle = band.textColor || "rgba(226, 235, 255, 0.55)";
                ctx.font = "11px Trebuchet MS";
                ctx.fillText(band.text, fromX + 6, yScale.bottom - 22);
            }
        });
        ctx.restore();
    },
};

// Writes the flame percentage next to each step of the flame overlay so the
// setting is readable without hovering (Artisan's "Step+" marker style).
const flameStepLabelPlugin = {
    id: "flameStepLabelPlugin",
    afterDatasetsDraw(chart) {
        const index = findDatasetIndex(chart, "flame");
        if (index < 0) {
            return;
        }
        const dataset = chart.data.datasets[index];
        const meta = chart.getDatasetMeta(index);
        if (!dataset?.data?.length || !meta?.data?.length || meta.hidden) {
            return;
        }

        const { ctx } = chart;
        ctx.save();
        ctx.fillStyle = dataset.borderColor || "#ff8f47";
        ctx.font = "10px Trebuchet MS";
        let previous = null;
        dataset.data.forEach((point, i) => {
            if (previous !== null && point.y === previous) {
                return;
            }
            previous = point.y;
            const element = meta.data[i];
            if (!element) {
                return;
            }
            const { x, y } = element.getProps(["x", "y"], true);
            ctx.fillText(`${Math.round(point.y)}%`, x + 3, y - 4);
        });
        ctx.restore();
    },
};

if (typeof Chart !== "undefined") {
    Chart.register(stageMarkerPlugin);
    Chart.register(phaseBandPlugin);
    Chart.register(flameStepLabelPlugin);
}

// ---------------------------------------------------------------------------
// Chart construction
// ---------------------------------------------------------------------------
function createChartDefaults() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
            legend: {
                display: false,
            },
            stageMarkers: {
                markers: [],
                badges: [],
            },
            phaseBands: {
                bands: [],
            },
        },
        scales: {
            x: {
                type: "linear",
                min: 0,
                max: 15,
                grid: {
                    color: "rgba(194, 219, 255, 0.12)",
                },
                ticks: {
                    stepSize: 1,
                    color: "rgba(226, 235, 255, 0.72)",
                    callback(value) {
                        return formatMinutesTick(value);
                    },
                },
                title: {
                    display: true,
                    text: "Roast Time (mm:ss from charge)",
                    color: "rgba(226, 235, 255, 0.72)",
                },
            },
            y: {
                grid: {
                    color: "rgba(194, 219, 255, 0.1)",
                },
                ticks: {
                    color: "rgba(226, 235, 255, 0.72)",
                },
                title: {
                    display: true,
                    text: "Temperature (°C)",
                    color: "rgba(226, 235, 255, 0.72)",
                },
            },
        },
    };
}

function formatMinutesTick(value) {
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) {
        return "";
    }
    const totalSeconds = Math.round(minutes * 60);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

function createLineChart(id, label, color) {
    return new Chart(document.getElementById(id), {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label,
                    roasterRole: "temperature",
                    data: [],
                    borderColor: color,
                    backgroundColor: `${color}1f`,
                    borderWidth: 3,
                    tension: 0.28,
                    pointRadius: 0,
                    fill: true,
                },
            ],
        },
        options: createChartDefaults(),
    });
}

function findDatasetIndex(chart, role) {
    return (chart?.data?.datasets || []).findIndex((dataset) => dataset.roasterRole === role);
}

function findDataset(chart, role) {
    const index = findDatasetIndex(chart, role);
    return index >= 0 ? chart.data.datasets[index] : null;
}

// Grow the time axis in whole minutes so the curve never runs off the right edge.
function fitTimeAxis(chart) {
    const minimum = 15;
    let latest = 0;
    (chart.data.datasets || []).forEach((dataset) => {
        (dataset.data || []).forEach((point) => {
            if (Number.isFinite(point?.x)) {
                latest = Math.max(latest, point.x);
            }
        });
    });
    (chart.options.plugins?.stageMarkers?.markers || []).forEach((marker) => {
        if (Number.isFinite(marker.label)) {
            latest = Math.max(latest, marker.label);
        }
    });
    const next = Math.max(minimum, Math.ceil(latest + 0.5));
    if (chart.options.scales.x.max !== next) {
        chart.options.scales.x.max = next;
        chart.options.scales.x.ticks.stepSize = next > 30 ? 5 : 1;
    }
}

function setChartSeries(chart, points) {
    chart.data.datasets[0].data = points;
    fitTimeAxis(chart);
    chart.update();
}

function setStageMarkers(chart, markers) {
    chart.options.plugins.stageMarkers.markers = markers;
    fitTimeAxis(chart);
    chart.update();
}

function setStageBadges(chart, badges) {
    chart.options.plugins.stageMarkers.badges = badges;
    chart.update();
}

function setPhaseBands(chart, bands) {
    chart.options.plugins.phaseBands.bands = bands;
    chart.update();
}

function enableRorOverlay(chart, options = {}) {
    if (findDataset(chart, "ror")) {
        return chart;
    }

    const color = options.color || "#6fae53";
    chart.data.datasets.push({
        label: options.label || "Rate of Rise",
        roasterRole: "ror",
        data: [],
        borderColor: color,
        backgroundColor: "transparent",
        borderWidth: 2,
        borderDash: [4, 4],
        tension: 0.3,
        pointRadius: 0,
        fill: false,
        yAxisID: "y1",
    });

    chart.options.scales.y1 = {
        type: "linear",
        position: "right",
        beginAtZero: true,
        suggestedMax: 20,
        grid: {
            drawOnChartArea: false,
        },
        ticks: {
            color: "rgba(150, 214, 130, 0.8)",
        },
        title: {
            display: true,
            text: "RoR (°C/min)",
            color: "rgba(150, 214, 130, 0.8)",
        },
    };

    chart.update();
    return chart;
}

function setRorSeries(chart, points) {
    const dataset = findDataset(chart, "ror");
    if (!dataset) {
        return;
    }

    dataset.data = points;
    chart.update();
}

// Flame % as a step plot on its own hidden axis. The axis tops out at 320 so
// the 0-100% steps sit in the lower third of the chart, under the bean curve.
function enableFlameOverlay(chart, options = {}) {
    if (findDataset(chart, "flame")) {
        return chart;
    }

    const color = options.color || "#ff8f47";
    chart.data.datasets.push({
        label: options.label || "Flame %",
        roasterRole: "flame",
        data: [],
        borderColor: color,
        backgroundColor: `${color}14`,
        borderWidth: 1.5,
        stepped: "after",
        pointRadius: 0,
        fill: true,
        yAxisID: "y2",
    });

    chart.options.scales.y2 = {
        type: "linear",
        position: "right",
        min: 0,
        max: 320,
        display: false,
    };

    chart.update();
    return chart;
}

function setFlameSeries(chart, points) {
    const dataset = findDataset(chart, "flame");
    if (!dataset) {
        return;
    }
    dataset.data = points;
    chart.update();
}

// A faint earlier roast drawn behind the live one (Artisan's background profile).
function enableReferenceOverlay(chart, options = {}) {
    if (findDataset(chart, "referenceTemperature")) {
        return chart;
    }

    const color = options.color || "rgba(126, 164, 255, 0.55)";
    chart.data.datasets.push({
        label: options.label || "Reference",
        roasterRole: "referenceTemperature",
        data: [],
        borderColor: color,
        backgroundColor: "transparent",
        borderWidth: 2,
        tension: 0.28,
        pointRadius: 0,
        fill: false,
        order: 10,
    });

    if (findDataset(chart, "flame")) {
        chart.data.datasets.push({
            label: "Reference flame",
            roasterRole: "referenceFlame",
            data: [],
            borderColor: "rgba(126, 164, 255, 0.4)",
            backgroundColor: "transparent",
            borderWidth: 1,
            borderDash: [3, 3],
            stepped: "after",
            pointRadius: 0,
            fill: false,
            yAxisID: "y2",
            order: 10,
        });
    }

    chart.update();
    return chart;
}

function setReferenceSeries(chart, series = {}) {
    const temperature = findDataset(chart, "referenceTemperature");
    const flame = findDataset(chart, "referenceFlame");
    if (temperature) {
        temperature.data = series.temperature || [];
    }
    if (flame) {
        flame.data = series.flame || [];
    }
    fitTimeAxis(chart);
    chart.update();
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------
function resolveChartBaseTime(curve = [], options = {}) {
    const anchorDate = options.anchorDate || options.startedAt || options.endedAt || null;
    const startedAt = parseRoastTimestamp(options.startedAt, anchorDate);
    if (startedAt) {
        return startedAt;
    }

    const firstPoint = curve[0]?.timestamp;
    return parseRoastTimestamp(firstPoint, anchorDate);
}

function toElapsedMinutes(value, baseTime, anchorDate = null) {
    if (!baseTime) {
        return null;
    }

    const pointTime = parseRoastTimestamp(value, anchorDate || baseTime);
    if (!pointTime) {
        return null;
    }

    return Math.max(0, (pointTime.getTime() - baseTime.getTime()) / 60000);
}

function parseRoastTimestamp(value, anchorDate = null) {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value !== "string") {
        const direct = new Date(value);
        return Number.isNaN(direct.getTime()) ? null : direct;
    }

    // Sensor samples are wall-clock "HH:MM:SS" or "HH:MM:SS.mmm"; events are ISO.
    const match = value.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (match) {
        const base = anchorDate ? new Date(anchorDate) : new Date();
        if (Number.isNaN(base.getTime())) {
            return null;
        }
        const millis = match[4] ? Number(match[4].padEnd(3, "0")) : 0;
        base.setHours(Number(match[1]), Number(match[2]), Number(match[3]), millis);
        return base;
    }

    const direct = new Date(value);
    return Number.isNaN(direct.getTime()) ? null : direct;
}

function formatDuration(totalSeconds) {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
        return "--";
    }

    const rounded = Math.round(totalSeconds);
    const minutes = Math.floor(rounded / 60);
    const seconds = rounded % 60;
    const hours = Math.floor(minutes / 60);
    const displayMinutes = minutes % 60;

    if (hours > 0) {
        return `${hours}:${String(displayMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    return `${displayMinutes}:${String(seconds).padStart(2, "0")}`;
}

function formatRate(value) {
    if (!Number.isFinite(value)) {
        return "--";
    }

    return `${value.toFixed(1)} °C/min`;
}

function formatPercent(value) {
    return Number.isFinite(value) ? `${value.toFixed(0)}%` : "--";
}

// ---------------------------------------------------------------------------
// Series builders
// ---------------------------------------------------------------------------
function normalizeCurve(curve = [], options = {}) {
    const anchorDate = options.anchorDate || options.startedAt || options.endedAt || null;
    const baseTime = resolveChartBaseTime(curve, options);
    return curve
        .map((point) => {
            const time = parseRoastTimestamp(point?.timestamp, anchorDate);
            const temperature = Number(point?.temperature);
            const x = toElapsedMinutes(point?.timestamp, baseTime, anchorDate);
            if (!time || !Number.isFinite(temperature) || !Number.isFinite(x)) {
                return null;
            }
            const flame = Number(point?.flame_level);
            return {
                time,
                temperature,
                x,
                flame: point?.flame_level === null || point?.flame_level === undefined || !Number.isFinite(flame)
                    ? null
                    : flame,
                timestamp: point.timestamp,
            };
        })
        .filter(Boolean);
}

function buildChartSeries(curve = [], options = {}) {
    return normalizeCurve(curve, options).map((point) => ({ x: point.x, y: point.temperature }));
}

function buildFlameSeries(curve = [], options = {}) {
    return normalizeCurve(curve, options)
        .filter((point) => point.flame !== null)
        .map((point) => ({ x: point.x, y: point.flame }));
}

// Least-squares slope (°C/min) over the samples in the trailing window, then a
// trailing moving average. Endpoint differences on a 0.25 °C thermocouple are
// far too noisy to read; Artisan smooths the same way.
function buildRorSeries(curve = [], options = {}) {
    const settings = getRoastSettings();
    const windowSeconds = Number.isFinite(options.windowSeconds) ? options.windowSeconds : settings.rorWindowSeconds;
    const smoothingPoints = Number.isFinite(options.smoothingPoints)
        ? Math.max(1, Math.round(options.smoothingPoints))
        : Math.max(1, Math.round(settings.rorSmoothingPoints));
    const points = normalizeCurve(curve, options);

    const raw = [];
    for (let i = 0; i < points.length; i += 1) {
        const current = points[i];
        const windowPoints = [];
        for (let j = i; j >= 0; j -= 1) {
            const deltaSeconds = (current.time.getTime() - points[j].time.getTime()) / 1000;
            if (deltaSeconds > windowSeconds) {
                break;
            }
            windowPoints.push(points[j]);
        }
        if (windowPoints.length < 2) {
            continue;
        }
        const span = (current.time.getTime() - windowPoints[windowPoints.length - 1].time.getTime()) / 1000;
        if (span < windowSeconds / 2) {
            continue;
        }

        const slope = leastSquaresSlope(windowPoints.map((point) => ({
            x: (point.time.getTime() - current.time.getTime()) / 60000,
            y: point.temperature,
        })));
        if (!Number.isFinite(slope)) {
            continue;
        }
        raw.push({ x: current.x, y: slope });
    }

    return raw.map((point, index) => {
        const start = Math.max(0, index - smoothingPoints + 1);
        const slice = raw.slice(start, index + 1);
        const mean = slice.reduce((sum, item) => sum + item.y, 0) / slice.length;
        return { x: point.x, y: Number(mean.toFixed(2)) };
    });
}

function leastSquaresSlope(samples) {
    const n = samples.length;
    if (n < 2) {
        return NaN;
    }
    let sumX = 0;
    let sumY = 0;
    samples.forEach((sample) => {
        sumX += sample.x;
        sumY += sample.y;
    });
    const meanX = sumX / n;
    const meanY = sumY / n;
    let numerator = 0;
    let denominator = 0;
    samples.forEach((sample) => {
        numerator += (sample.x - meanX) * (sample.y - meanY);
        denominator += (sample.x - meanX) ** 2;
    });
    return denominator === 0 ? NaN : numerator / denominator;
}

function detectTurningPoint(curve = [], options = {}) {
    const anchorDate = options.anchorDate || options.startedAt || options.endedAt || null;
    const baseTime = resolveChartBaseTime(curve, options);
    const startTime = parseRoastTimestamp(options.startedAt, anchorDate);
    const riseThreshold = Number.isFinite(options.riseThreshold) ? options.riseThreshold : 2;

    const points = curve
        .map((point) => {
            const time = parseRoastTimestamp(point.timestamp, anchorDate);
            const temperature = Number(point.temperature);
            if (!time || !Number.isFinite(temperature)) {
                return null;
            }
            if (startTime && time.getTime() < startTime.getTime()) {
                return null;
            }
            return { time, temperature, timestamp: point.timestamp };
        })
        .filter(Boolean);

    if (points.length < 3) {
        return null;
    }

    let minIndex = 0;
    for (let i = 1; i < points.length; i += 1) {
        if (points[i].temperature < points[minIndex].temperature) {
            minIndex = i;
        }
    }

    // A real turn is the post-charge minimum, confirmed by a subsequent rise.
    if (minIndex >= points.length - 1) {
        return null;
    }

    const maxAfter = points
        .slice(minIndex + 1)
        .reduce((peak, point) => Math.max(peak, point.temperature), -Infinity);
    if (maxAfter - points[minIndex].temperature < riseThreshold) {
        return null;
    }

    const turn = points[minIndex];
    const x = toElapsedMinutes(turn.timestamp, baseTime, anchorDate);
    if (!Number.isFinite(x)) {
        return null;
    }

    return { x, temperature: turn.temperature, timestamp: turn.timestamp };
}

// Value of an {x, y} series at x, linearly interpolated. Null outside the range.
function interpolateSeries(series = [], x) {
    if (!series.length || !Number.isFinite(x)) {
        return null;
    }
    if (x < series[0].x) {
        return null;
    }
    for (let i = 1; i < series.length; i += 1) {
        if (series[i].x >= x) {
            const prev = series[i - 1];
            const next = series[i];
            const span = next.x - prev.x;
            if (span <= 0) {
                return next.y;
            }
            return prev.y + ((next.y - prev.y) * (x - prev.x)) / span;
        }
    }
    return series.length === 1 && series[0].x === x ? series[0].y : null;
}

// Seconds until the curve reaches targetTemp at the current rate of rise.
function projectSecondsToTemperature(currentTemp, targetTemp, rorPerMinute) {
    if (!Number.isFinite(currentTemp) || !Number.isFinite(targetTemp) || !Number.isFinite(rorPerMinute)) {
        return null;
    }
    if (targetTemp <= currentTemp || rorPerMinute < 0.5) {
        return null;
    }
    return ((targetTemp - currentTemp) / rorPerMinute) * 60;
}

// ---------------------------------------------------------------------------
// Phases (Artisan's drying / Maillard / development model)
// ---------------------------------------------------------------------------
function buildRoastPhases(curve = [], events = [], options = {}) {
    const anchorDate = options.anchorDate || options.startedAt || options.endedAt || null;
    const points = normalizeCurve(curve, options);
    const chargeEvent = findRoastEvent(events, "charge");
    const chargeTime = parseRoastTimestamp(options.startedAt, anchorDate)
        || parseRoastTimestamp(chargeEvent?.time, anchorDate)
        || points[0]?.time
        || null;
    const dropEvent = findRoastEvent(events, "drop");
    const dropTime = parseRoastTimestamp(options.endedAt, anchorDate)
        || parseRoastTimestamp(dropEvent?.time, anchorDate)
        || points[points.length - 1]?.time
        || null;
    const dryEndTime = parseRoastTimestamp(findRoastEvent(events, "dryEnd")?.time, anchorDate);
    const firstCrackTime = parseRoastTimestamp(findRoastEvent(events, "firstCrack")?.time, anchorDate);

    const empty = {
        chargeTime,
        dropTime,
        dryEndTime,
        firstCrackTime,
        totalSeconds: null,
        phases: [],
        dtr: null,
        minutes: {},
    };
    if (!chargeTime || !dropTime) {
        return empty;
    }

    const totalSeconds = Math.max(0, (dropTime.getTime() - chargeTime.getTime()) / 1000);
    const minutesFromCharge = (time) => (time ? Math.max(0, (time.getTime() - chargeTime.getTime()) / 60000) : null);
    const tempAt = (time) => {
        if (!time || !points.length) {
            return null;
        }
        let best = points[0];
        for (const point of points) {
            if (Math.abs(point.time.getTime() - time.getTime()) < Math.abs(best.time.getTime() - time.getTime())) {
                best = point;
            }
        }
        return Math.abs(best.time.getTime() - time.getTime()) <= 15000 ? best.temperature : null;
    };

    const boundaries = [];
    if (dryEndTime && dryEndTime > chargeTime && (!firstCrackTime || dryEndTime <= firstCrackTime)) {
        boundaries.push({ key: "drying", label: "Drying", from: chargeTime, to: dryEndTime });
        if (firstCrackTime && firstCrackTime > dryEndTime) {
            boundaries.push({ key: "maillard", label: "Maillard", from: dryEndTime, to: firstCrackTime });
        } else {
            boundaries.push({ key: "maillard", label: "Maillard", from: dryEndTime, to: dropTime, open: !firstCrackTime });
        }
    } else if (firstCrackTime && firstCrackTime > chargeTime) {
        boundaries.push({ key: "drying", label: "Drying + Maillard", from: chargeTime, to: firstCrackTime });
    } else {
        boundaries.push({ key: "drying", label: "Drying", from: chargeTime, to: dropTime, open: true });
    }
    if (firstCrackTime && firstCrackTime > chargeTime) {
        boundaries.push({ key: "development", label: "Development", from: firstCrackTime, to: dropTime });
    }

    const phases = boundaries
        .filter((phase) => phase.to && phase.from && phase.to >= phase.from)
        .map((phase) => {
            const seconds = (phase.to.getTime() - phase.from.getTime()) / 1000;
            const tempStart = tempAt(phase.from);
            const tempEnd = tempAt(phase.to);
            const deltaTemp = Number.isFinite(tempStart) && Number.isFinite(tempEnd) ? tempEnd - tempStart : null;
            return {
                key: phase.key,
                label: phase.label,
                open: Boolean(phase.open),
                seconds,
                percent: totalSeconds > 0 ? (seconds / totalSeconds) * 100 : null,
                fromMinutes: minutesFromCharge(phase.from),
                toMinutes: minutesFromCharge(phase.to),
                tempStart,
                tempEnd,
                deltaTemp,
                avgRor: deltaTemp !== null && seconds > 0 ? deltaTemp / (seconds / 60) : null,
                color: PHASE_COLORS[phase.key],
            };
        });

    const development = phases.find((phase) => phase.key === "development");
    return {
        chargeTime,
        dropTime,
        dryEndTime,
        firstCrackTime,
        totalSeconds,
        phases,
        dtr: development?.percent ?? null,
        minutes: {
            dryEnd: minutesFromCharge(dryEndTime),
            firstCrack: minutesFromCharge(firstCrackTime),
            drop: minutesFromCharge(dropTime),
        },
    };
}

function buildPhaseBands(phaseSummary) {
    return (phaseSummary?.phases || [])
        .filter((phase) => Number.isFinite(phase.fromMinutes) && Number.isFinite(phase.toMinutes))
        .map((phase) => ({
            from: phase.fromMinutes,
            to: phase.toMinutes,
            color: hexToRgba(phase.color, phase.key === "maillard" ? 0.1 : 0.12),
            text: `${phase.label} ${formatDuration(phase.seconds)}${Number.isFinite(phase.percent) ? ` · ${phase.percent.toFixed(0)}%` : ""}`,
        }));
}

function hexToRgba(hex, alpha) {
    const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    if (!match) {
        return `rgba(255, 255, 255, ${alpha})`;
    }
    return `rgba(${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)}, ${alpha})`;
}

// Renders the drying / Maillard / development bar + per-phase stats into a
// container. Shared by the session, review and lookup pages.
function renderPhaseSummary(containerEl, phaseSummary) {
    if (!containerEl) {
        return;
    }
    const phases = phaseSummary?.phases || [];
    if (!phases.length) {
        containerEl.innerHTML = '<div class="empty-state">Phase breakdown appears after Charge is marked.</div>';
        return;
    }

    const bar = phases.map((phase) => {
        const width = Number.isFinite(phase.percent) ? Math.max(phase.percent, 2) : 100 / phases.length;
        return `<div class="phase-segment" style="width:${width.toFixed(2)}%;background:${escapeHtml(hexToRgba(phase.color, 0.55))};" title="${escapeHtml(phase.label)}">${escapeHtml(formatPercent(phase.percent))}</div>`;
    }).join("");

    const rows = phases.map((phase) => `
        <div class="phase-row">
            <span class="phase-swatch" style="background:${escapeHtml(phase.color)};"></span>
            <span class="phase-name">${escapeHtml(phase.label)}${phase.open ? " (so far)" : ""}</span>
            <span class="phase-stat">${escapeHtml(formatDuration(phase.seconds))}</span>
            <span class="phase-stat">${escapeHtml(formatPercent(phase.percent))}</span>
            <span class="phase-stat">${phase.deltaTemp !== null ? `${phase.deltaTemp >= 0 ? "+" : ""}${escapeHtml(phase.deltaTemp.toFixed(0))} °C` : "--"}</span>
            <span class="phase-stat">${Number.isFinite(phase.avgRor) ? `${escapeHtml(phase.avgRor.toFixed(1))} °C/min` : "--"}</span>
        </div>
    `).join("");

    containerEl.innerHTML = `
        <div class="phase-bar">${bar}</div>
        <div class="phase-rows">
            <div class="phase-row phase-row-head">
                <span></span><span>Phase</span><span>Time</span><span>Share</span><span>ΔT</span><span>Avg RoR</span>
            </div>
            ${rows}
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Roast analytics summary used by the session, review and lookup pages
// ---------------------------------------------------------------------------
function buildRoastAnalytics(curve = [], events = [], options = {}) {
    const anchorDate = options.anchorDate || options.startedAt || options.endedAt || null;
    const startedAt = parseRoastTimestamp(options.startedAt, anchorDate);
    const endedAt = parseRoastTimestamp(options.endedAt, anchorDate);
    const firstCrack = findRoastEvent(events, "firstCrack");
    const firstCrackAt = parseRoastTimestamp(firstCrack?.time, anchorDate);

    const normalizedCurve = normalizeCurve(curve, options);

    const startTime = startedAt || normalizedCurve[0]?.time || null;
    const finishTime = endedAt || normalizedCurve[normalizedCurve.length - 1]?.time || null;
    const totalDurationSeconds = startTime && finishTime
        ? Math.max(0, (finishTime.getTime() - startTime.getTime()) / 1000)
        : null;
    const developmentSeconds = firstCrackAt && finishTime
        ? Math.max(0, (finishTime.getTime() - firstCrackAt.getTime()) / 1000)
        : null;

    let peakTemperature = null;
    normalizedCurve.forEach((point) => {
        peakTemperature = peakTemperature === null
            ? point.temperature
            : Math.max(peakTemperature, point.temperature);
    });

    const rorSeries = buildRorSeries(curve, options);
    const currentRor = rorSeries.length ? rorSeries[rorSeries.length - 1].y : null;
    const currentTemperature = normalizedCurve.length
        ? normalizedCurve[normalizedCurve.length - 1].temperature
        : null;

    const developmentRatio = totalDurationSeconds && developmentSeconds !== null
        ? (developmentSeconds / totalDurationSeconds) * 100
        : null;

    const phases = buildRoastPhases(curve, events, options);

    return {
        totalDurationSeconds,
        developmentSeconds,
        developmentRatio,
        peakTemperature,
        currentRor,
        currentTemperature,
        phases,
        rorSeries,
    };
}

// True when a sensor_data payload carries a real reading. Fault samples from
// hardware arrive with temperature null and an error string.
function hasSensorTemperature(data) {
    return Boolean(data) && data.temperature !== null && data.temperature !== undefined
        && Number.isFinite(Number(data.temperature));
}

// Escape text for interpolation into innerHTML templates (text nodes and
// quoted attribute values). Bean names, origins, notes, and event text are
// user-entered and can also arrive from imported JSON files.
function escapeHtml(value) {
    if (value === null || value === undefined) {
        return "";
    }
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        ROAST_EVENT_ROLES,
        ROAST_SETTINGS_DEFAULTS,
        getRoastSettings,
        findRoastEvent,
        parseRoastTimestamp,
        buildChartSeries,
        buildFlameSeries,
        buildRorSeries,
        leastSquaresSlope,
        detectTurningPoint,
        interpolateSeries,
        projectSecondsToTemperature,
        buildRoastPhases,
        buildPhaseBands,
        buildRoastAnalytics,
        formatDuration,
        formatMinutesTick,
        hasSensorTemperature,
        escapeHtml,
    };
}
