const lookupListEl = document.getElementById("lookupList");
const refreshLookupButtonEl = document.getElementById("refreshLookupButton");
const summaryRoastsEl = document.getElementById("summaryRoasts");
const summarySamplesEl = document.getElementById("summarySamples");
const summaryLevelsEl = document.getElementById("summaryLevels");
const summaryLatestEl = document.getElementById("summaryLatest");
const detailTitleEl = document.getElementById("detailTitle");
const detailCopyEl = document.getElementById("detailCopy");
const detailOriginEl = document.getElementById("detailOrigin");
const detailLevelEl = document.getElementById("detailLevel");
const detailSamplesEl = document.getElementById("detailSamples");
const detailNotesEl = document.getElementById("detailNotes");
const detailEventsEl = document.getElementById("detailEvents");
const detailPhotoWrapEl = document.getElementById("detailPhotoWrap");
const detailPhotoEl = document.getElementById("detailPhoto");

const lookupTemperatureChart = createLineChart(
    "lookupTemperatureChart",
    "Saved Temperature",
    "#b4542b"
);

let selectedRoastId = null;

function formatLookupDate(dateString) {
    if (!dateString) {
        return "Unknown time";
    }

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
        return dateString;
    }

    return date.toLocaleString();
}

function setLookupSummary(summary) {
    summaryRoastsEl.textContent = String(summary.roast_count || 0);
    summarySamplesEl.textContent = String(summary.sample_count || 0);
    summaryLevelsEl.textContent = String((summary.levels || []).length);
    summaryLatestEl.textContent = summary.latest_roast_at
        ? `Latest roast saved ${formatLookupDate(summary.latest_roast_at)}.`
        : "No saved roast sessions yet.";
}

function renderLookupList(items) {
    if (!items.length) {
        lookupListEl.innerHTML = '<div class="empty-state">No roast sessions saved yet.</div>';
        return;
    }

    lookupListEl.innerHTML = items.map((item) => `
        <button class="lookup-item ${item.id === selectedRoastId ? "active" : ""}" type="button" data-roast-id="${item.id}">
            <div class="lookup-topline">
                <span>${item.bean_name}</span>
                <span>${item.roast_level}</span>
            </div>
            <div class="lookup-meta">
                ${item.origin}<br>
                Saved ${formatLookupDate(item.created_at)}<br>
                ${item.sample_count} samples
            </div>
        </button>
    `).join("");

    lookupListEl.querySelectorAll("[data-roast-id]").forEach((button) => {
        button.addEventListener("click", () => {
            loadRoastDetail(Number(button.dataset.roastId)).catch(() => {
                detailCopyEl.textContent = "Unable to load roast detail right now.";
            });
        });
    });
}

function fillLookupChart(chart, curve, extractor) {
    chart.data.labels = curve.map((point) => point.timestamp);
    chart.data.datasets[0].data = curve.map(extractor);
    chart.update();
}

function renderLookupEvents(events) {
    if (!events.length) {
        detailEventsEl.innerHTML = '<div class="empty-state">No event markers saved.</div>';
        return;
    }

    detailEventsEl.innerHTML = events.map((event) => `
        <article class="history-item">
            <div class="history-topline">
                <span>${event.label}</span>
                <span>${formatLookupDate(event.time)}</span>
            </div>
            <div class="history-meta">
                ${event.detail || "No details"}<br>
                ${event.temperature !== null && event.temperature !== undefined ? `Temp ${Number(event.temperature).toFixed(1)} °C` : ""}
                ${event.speed !== null && event.speed !== undefined ? `<br>Speed ${event.speed}%` : ""}
            </div>
        </article>
    `).join("");
}

function buildEventBadges(events) {
    return events
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
        }));
}

function setLookupDetail(roast) {
    selectedRoastId = roast.id;
    detailTitleEl.textContent = `${roast.bean_name} (#${roast.id})`;
    detailCopyEl.textContent = `Captured ${formatLookupDate(roast.started_at)} through ${formatLookupDate(roast.ended_at)}.`;
    detailOriginEl.textContent = roast.origin || "--";
    detailLevelEl.textContent = roast.roast_level || "--";
    detailSamplesEl.textContent = String(roast.sample_count || 0);
    detailNotesEl.textContent = roast.notes || "No notes recorded.";
    renderLookupEvents(roast.events || []);

    fillLookupChart(
        lookupTemperatureChart,
        roast.curve || [],
        (point) => Number(point.temperature)
    );
    setStageMarkers(lookupTemperatureChart, []);
    setStageBadges(lookupTemperatureChart, buildEventBadges(roast.events || []));

    if (roast.photo_data) {
        detailPhotoEl.src = roast.photo_data;
        detailPhotoWrapEl.style.display = "block";
    } else {
        detailPhotoEl.removeAttribute("src");
        detailPhotoWrapEl.style.display = "none";
    }
}

async function loadRoastDetail(roastId) {
    const response = await fetch(`/api/roasts/${roastId}`);
    if (!response.ok) {
        throw new Error("Unable to load roast detail.");
    }

    const roast = await response.json();
    setLookupDetail(roast);
    const listResponse = await fetch("/api/roasts");
    const listPayload = await listResponse.json();
    renderLookupList(listPayload.items || []);
}

async function loadLookupPage() {
    const [listResponse, summaryResponse] = await Promise.all([
        fetch("/api/roasts"),
        fetch("/api/roasts/summary"),
    ]);

    const listPayload = await listResponse.json();
    const summaryPayload = await summaryResponse.json();

    renderLookupList(listPayload.items || []);
    setLookupSummary(summaryPayload);

    if ((listPayload.items || []).length && selectedRoastId === null) {
        await loadRoastDetail(listPayload.items[0].id);
    }
}

refreshLookupButtonEl.addEventListener("click", () => {
    loadLookupPage().catch(() => {
        detailCopyEl.textContent = "Unable to refresh roast lookup data right now.";
    });
});

loadLookupPage().catch(() => {
    detailCopyEl.textContent = "Unable to load roast lookup data right now.";
});
