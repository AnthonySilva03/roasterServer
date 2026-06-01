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
            if (!Number.isFinite(x)) {
                return;
            }

            ctx.strokeStyle = marker.color || "#7f3417";
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(x, yScale.top);
            ctx.lineTo(x, yScale.bottom);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = marker.color || "#7f3417";
            ctx.font = "12px Trebuchet MS";
            ctx.fillText(marker.text || "", x + 6, yScale.top + 16);
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

if (typeof Chart !== "undefined") {
    Chart.register(stageMarkerPlugin);
}

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
        },
        scales: {
            x: {
                type: "linear",
                min: 0,
                max: 30,
                grid: {
                    color: "rgba(194, 219, 255, 0.12)",
                },
                ticks: {
                    stepSize: 5,
                    color: "rgba(226, 235, 255, 0.72)",
                    callback(value) {
                        return `${Number(value)}m`;
                    },
                },
                title: {
                    display: true,
                    text: "Roast Time (min)",
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

function createLineChart(id, label, color) {
    return new Chart(document.getElementById(id), {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label,
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

function setChartSeries(chart, points) {
    chart.data.datasets[0].data = points;
    chart.update();
}

function setStageMarkers(chart, markers) {
    chart.options.plugins.stageMarkers.markers = markers;
    chart.update();
}

function setStageBadges(chart, badges) {
    chart.options.plugins.stageMarkers.badges = badges;
    chart.update();
}

function enableRorOverlay(chart, options = {}) {
    if (chart.data.datasets.length > 1) {
        return chart;
    }

    const color = options.color || "#6fae53";
    chart.data.datasets.push({
        label: options.label || "Rate of Rise",
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
    const dataset = chart.data.datasets[1];
    if (!dataset) {
        return;
    }

    dataset.data = points;
    chart.update();
}

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

function buildChartSeries(curve = [], options = {}) {
    const anchorDate = options.anchorDate || options.startedAt || options.endedAt || null;
    const baseTime = resolveChartBaseTime(curve, options);

    return curve
        .map((point) => {
            const x = toElapsedMinutes(point.timestamp, baseTime, anchorDate);
            const y = Number(point.temperature);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                return null;
            }

            return { x, y };
        })
        .filter(Boolean);
}

function buildRorSeries(curve = [], options = {}) {
    const anchorDate = options.anchorDate || options.startedAt || options.endedAt || null;
    const baseTime = resolveChartBaseTime(curve, options);
    const windowSeconds = Number.isFinite(options.windowSeconds) ? options.windowSeconds : 30;

    const points = curve
        .map((point) => {
            const time = parseRoastTimestamp(point.timestamp, anchorDate);
            const temperature = Number(point.temperature);
            const x = toElapsedMinutes(point.timestamp, baseTime, anchorDate);
            if (!time || !Number.isFinite(temperature) || !Number.isFinite(x)) {
                return null;
            }
            return { time, temperature, x };
        })
        .filter(Boolean);

    const series = [];
    for (let i = 0; i < points.length; i += 1) {
        const current = points[i];
        let reference = null;
        for (let j = i - 1; j >= 0; j -= 1) {
            const deltaSeconds = (current.time.getTime() - points[j].time.getTime()) / 1000;
            if (deltaSeconds > windowSeconds) {
                break;
            }
            reference = points[j];
        }

        if (!reference) {
            continue;
        }

        const deltaMinutes = (current.time.getTime() - reference.time.getTime()) / 60000;
        if (deltaMinutes <= 0) {
            continue;
        }

        const ror = (current.temperature - reference.temperature) / deltaMinutes;
        series.push({ x: current.x, y: Number(ror.toFixed(2)) });
    }

    return series;
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

function parseRoastTimestamp(value, anchorDate = null) {
    if (!value) {
        return null;
    }

    const direct = new Date(value);
    if (!Number.isNaN(direct.getTime())) {
        return direct;
    }

    if (typeof value !== "string") {
        return null;
    }

    const match = value.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!match) {
        return null;
    }

    const base = anchorDate ? new Date(anchorDate) : new Date();
    if (Number.isNaN(base.getTime())) {
        return null;
    }

    base.setHours(Number(match[1]), Number(match[2]), Number(match[3]), 0);
    return base;
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

function buildRoastAnalytics(curve = [], events = [], options = {}) {
    const anchorDate = options.anchorDate || options.startedAt || options.endedAt || null;
    const startedAt = parseRoastTimestamp(options.startedAt, anchorDate);
    const endedAt = parseRoastTimestamp(options.endedAt, anchorDate);
    const firstCrack = events.find((event) => event.label === "First Crack");
    const firstCrackAt = parseRoastTimestamp(firstCrack?.time, anchorDate);

    const normalizedCurve = curve
        .map((point, index) => {
            const timestamp = parseRoastTimestamp(point.timestamp, anchorDate);
            return {
                index,
                time: timestamp,
                temperature: Number(point.temperature),
            };
        })
        .filter((point) => point.time && Number.isFinite(point.temperature));

    const startTime = startedAt || normalizedCurve[0]?.time || null;
    const finishTime = endedAt || normalizedCurve[normalizedCurve.length - 1]?.time || null;
    const totalDurationSeconds = startTime && finishTime
        ? Math.max(0, (finishTime.getTime() - startTime.getTime()) / 1000)
        : null;
    const developmentSeconds = firstCrackAt && finishTime
        ? Math.max(0, (finishTime.getTime() - firstCrackAt.getTime()) / 1000)
        : null;

    let peakTemperature = null;
    let currentRor = null;

    normalizedCurve.forEach((point) => {
        peakTemperature = peakTemperature === null
            ? point.temperature
            : Math.max(peakTemperature, point.temperature);
    });

    if (normalizedCurve.length >= 2) {
        const lastPoint = normalizedCurve[normalizedCurve.length - 1];
        const previousPoint = normalizedCurve[normalizedCurve.length - 2];
        const lastDeltaMinutes = (lastPoint.time.getTime() - previousPoint.time.getTime()) / 60000;
        if (lastDeltaMinutes > 0) {
            currentRor = (lastPoint.temperature - previousPoint.temperature) / lastDeltaMinutes;
        }
    }

    const developmentRatio = totalDurationSeconds && developmentSeconds !== null
        ? (developmentSeconds / totalDurationSeconds) * 100
        : null;

    return {
        totalDurationSeconds,
        developmentSeconds,
        developmentRatio,
        peakTemperature,
        currentRor,
    };
}
