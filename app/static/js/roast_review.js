const reviewMessageEl = document.getElementById("reviewMessage");
const reviewTitleEl = document.getElementById("reviewTitle");
const reviewSubtitleEl = document.getElementById("reviewSubtitle");
const reviewOriginEl = document.getElementById("reviewOrigin");
const reviewRoastLevelEl = document.getElementById("reviewRoastLevel");
const reviewSampleCountEl = document.getElementById("reviewSampleCount");
const reviewWeightGramsEl = document.getElementById("reviewWeightGrams");
const reviewEventsEl = document.getElementById("reviewEvents");
const reviewDurationEl = document.getElementById("reviewDuration");
const reviewDevelopmentEl = document.getElementById("reviewDevelopment");
const reviewDevelopmentRatioEl = document.getElementById("reviewDevelopmentRatio");
const reviewPeakTemperatureEl = document.getElementById("reviewPeakTemperature");
const reviewAnalyticsCopyEl = document.getElementById("reviewAnalyticsCopy");
const saveRoastButtonEl = document.getElementById("saveRoastButton");
const cancelRoastButtonEl = document.getElementById("cancelRoastButton");
const photoInputEl = document.getElementById("photoInput");
const photoPreviewWrapEl = document.getElementById("photoPreviewWrap");
const photoPreviewEl = document.getElementById("photoPreview");

const reviewTemperatureChart = createLineChart(
    "reviewTemperatureChart",
    "Roast Review Temperature",
    "#b4542b"
);

let pendingRoast = null;

function renderPendingRoast() {
    if (!pendingRoast) {
        reviewMessageEl.textContent = "No roast is waiting for review.";
        reviewSubtitleEl.textContent = "Return to the roast page to begin a session.";
        reviewAnalyticsCopyEl.textContent = "No analytics are available because no roast is waiting for review.";
        reviewTemperatureChart.data.labels = [];
        reviewTemperatureChart.data.datasets[0].data = [];
        reviewTemperatureChart.update();
        return;
    }

    const analytics = buildRoastAnalytics(pendingRoast.curve || [], pendingRoast.events || [], {
        startedAt: pendingRoast.started_at,
        endedAt: pendingRoast.ended_at,
    });

    reviewTitleEl.textContent = pendingRoast.bean_name || "Pending Roast";
    reviewSubtitleEl.textContent = `Started ${new Date(pendingRoast.started_at).toLocaleString()} and finished ${new Date(pendingRoast.ended_at).toLocaleString()}.`;
    reviewOriginEl.textContent = pendingRoast.origin || "--";
    reviewRoastLevelEl.textContent = pendingRoast.roast_level || "--";
    reviewSampleCountEl.textContent = String((pendingRoast.curve || []).length);
    reviewWeightGramsEl.textContent = pendingRoast.weight_grams !== null && pendingRoast.weight_grams !== undefined
        ? `${Number(pendingRoast.weight_grams).toFixed(1)} g`
        : "--";
    reviewDurationEl.textContent = formatDuration(
        pendingRoast.total_roast_seconds !== null && pendingRoast.total_roast_seconds !== undefined
            ? Number(pendingRoast.total_roast_seconds)
            : analytics.totalDurationSeconds
    );
    reviewDevelopmentEl.textContent = formatDuration(analytics.developmentSeconds);
    reviewDevelopmentRatioEl.textContent = analytics.developmentRatio !== null && Number.isFinite(analytics.developmentRatio)
        ? `${analytics.developmentRatio.toFixed(0)}%`
        : "--";
    reviewPeakTemperatureEl.textContent = Number.isFinite(analytics.peakTemperature)
        ? `${analytics.peakTemperature.toFixed(1)} °C`
        : "--";
    reviewMessageEl.textContent = "Review the roast and choose Save or Cancel.";
    reviewAnalyticsCopyEl.textContent = analytics.developmentSeconds !== null
        ? `This review includes the graph that will be saved. Development ran ${formatDuration(analytics.developmentSeconds)} and peak temperature reached ${Number.isFinite(analytics.peakTemperature) ? `${analytics.peakTemperature.toFixed(1)} °C` : "--"}.`
        : "First crack was not marked, so development metrics are limited for this roast.";

    reviewTemperatureChart.data.labels = (pendingRoast.curve || []).map((point) => point.timestamp);
    reviewTemperatureChart.data.datasets[0].data = (pendingRoast.curve || []).map((point) => Number(point.temperature));
    reviewTemperatureChart.update();
    setStageMarkers(reviewTemperatureChart, []);
    setStageBadges(
        reviewTemperatureChart,
        (pendingRoast.events || [])
            .filter((event) => event.chart_label)
            .map((event) => ({
                label: event.chart_label,
                text: event.label,
                shortText: event.label
                    .split(" ")
                    .map((word) => word[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase(),
                color: event.color || "#7f3417",
            }))
    );

    if (!(pendingRoast.events || []).length) {
        reviewEventsEl.innerHTML = '<div class="empty-state">No events captured.</div>';
        return;
    }

    reviewEventsEl.innerHTML = pendingRoast.events.map((event) => `
        <article class="history-item">
            <div class="history-topline">
                <span>${event.label}</span>
                <span>${new Date(event.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
            </div>
            <div class="history-meta">${event.detail}</div>
        </article>
    `).join("");
}

function loadPendingRoast() {
    const raw = sessionStorage.getItem("pendingRoastReview");
    pendingRoast = raw ? JSON.parse(raw) : null;
    renderPendingRoast();
}

photoInputEl.addEventListener("change", () => {
    const [file] = photoInputEl.files || [];
    if (!file || !pendingRoast) {
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        pendingRoast.photo_data = String(reader.result || "");
        photoPreviewEl.src = pendingRoast.photo_data;
        photoPreviewWrapEl.style.display = "block";
        sessionStorage.setItem("pendingRoastReview", JSON.stringify(pendingRoast));
    };
    reader.readAsDataURL(file);
});

saveRoastButtonEl.addEventListener("click", async () => {
    if (!pendingRoast) {
        reviewMessageEl.textContent = "No roast is waiting to be saved.";
        return;
    }

    const response = await fetch("/api/roasts", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(pendingRoast),
    });

    const body = await response.json();
    if (!response.ok) {
        reviewMessageEl.textContent = body.error || "Unable to save roast.";
        return;
    }

    sessionStorage.removeItem("pendingRoastReview");
    reviewMessageEl.textContent = `Roast saved as #${body.id}. Redirecting to lookup...`;
    window.setTimeout(() => {
        window.location.href = "/lookup";
    }, 800);
});

cancelRoastButtonEl.addEventListener("click", () => {
    sessionStorage.removeItem("pendingRoastReview");
    window.location.href = "/";
});

loadPendingRoast();
