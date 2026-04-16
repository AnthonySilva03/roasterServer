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
