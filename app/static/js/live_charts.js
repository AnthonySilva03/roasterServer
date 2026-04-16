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
            const pointIndex = chart.data.labels.findIndex((label) => label === badge.label);
            const point = meta?.data?.[pointIndex];
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
                ticks: {
                    maxTicksLimit: 6,
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
                    backgroundColor: `${color}22`,
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

function pushChartPoint(chart, label, value, maxPoints) {
    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(value);

    if (chart.data.labels.length > maxPoints) {
        chart.data.labels.shift();
        chart.data.datasets[0].data.shift();
    }

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
