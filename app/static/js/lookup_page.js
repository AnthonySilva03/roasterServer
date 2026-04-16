const lookupListEl = document.getElementById("lookupList");
const lookupSearchInputEl = document.getElementById("lookupSearchInput");
const lookupSearchSummaryEl = document.getElementById("lookupSearchSummary");
const lookupOriginMapSummaryEl = document.getElementById("lookupOriginMapSummary");
const lookupOriginMapMarkersEl = document.getElementById("lookupOriginMapMarkers");
const clearOriginFilterButtonEl = document.getElementById("clearOriginFilterButton");
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
const detailDurationEl = document.getElementById("detailDuration");
const detailDevelopmentEl = document.getElementById("detailDevelopment");
const detailDevelopmentRatioEl = document.getElementById("detailDevelopmentRatio");
const detailPeakTemperatureEl = document.getElementById("detailPeakTemperature");
const detailAnalyticsCopyEl = document.getElementById("detailAnalyticsCopy");
const detailRatingEl = document.getElementById("detailRating");
const detailTasteNotesEl = document.getElementById("detailTasteNotes");
const detailNotesEl = document.getElementById("detailNotes");
const detailEventsEl = document.getElementById("detailEvents");
const detailPhotoWrapEl = document.getElementById("detailPhotoWrap");
const detailPhotoEl = document.getElementById("detailPhoto");
const editTasteFeedbackLinkEl = document.getElementById("editTasteFeedbackLink");

const lookupTemperatureChart = createLineChart(
    "lookupTemperatureChart",
    "Saved Temperature",
    "#b4542b"
);

let selectedRoastId = null;
let lookupItems = [];
let selectedOriginKey = null;

function roastMatchesSearch(item, query) {
    if (!query) {
        return true;
    }

    const haystack = [
        item.bean_name,
        item.origin,
        item.roast_level,
        item.notes,
        item.taste_notes,
        item.rating ? `${item.rating}/5` : "",
        formatLookupDate(item.created_at),
    ].join(" ").toLowerCase();

    return haystack.includes(query);
}

function getFilteredLookupItems() {
    const query = (lookupSearchInputEl.value || "").trim().toLowerCase();
    return lookupItems.filter((item) => {
        const matchesSearch = roastMatchesSearch(item, query);
        if (!matchesSearch) {
            return false;
        }

        if (!selectedOriginKey) {
            return true;
        }

        const resolvedOrigin = resolveOriginLocation(item.origin);
        return resolvedOrigin && resolvedOrigin.key === selectedOriginKey;
    });
}

function updateLookupSearchSummary(filteredItems) {
    const query = (lookupSearchInputEl.value || "").trim();
    if (!lookupItems.length) {
        lookupSearchSummaryEl.textContent = "Search your roast history by bean, origin, level, or saved date.";
        return;
    }

    if (!query) {
        lookupSearchSummaryEl.textContent = `${filteredItems.length} saved session${filteredItems.length === 1 ? "" : "s"} ready to browse${selectedOriginKey ? " from the selected origin" : ""}.`;
        return;
    }

    lookupSearchSummaryEl.textContent = filteredItems.length
        ? `${filteredItems.length} match${filteredItems.length === 1 ? "" : "es"} for "${query}".`
        : `No saved sessions matched "${query}".`;
}

function renderLookupOriginMap() {
    const mappedOrigins = buildMappedOrigins(lookupItems);
    if (!mappedOrigins.length) {
        lookupOriginMapSummaryEl.textContent = "No mapped roast origins available yet.";
        lookupOriginMapMarkersEl.innerHTML = "";
        clearOriginFilterButtonEl.disabled = true;
        return;
    }

    if (selectedOriginKey && !mappedOrigins.some((origin) => origin.key === selectedOriginKey)) {
        selectedOriginKey = null;
    }

    const selectedOrigin = mappedOrigins.find((origin) => origin.key === selectedOriginKey);
    lookupOriginMapSummaryEl.textContent = selectedOriginKey
        ? `Filtering lookup to ${(selectedOrigin && selectedOrigin.canonicalLabel) || "selected origin"}.`
        : `Click a mapped origin to filter ${mappedOrigins.length} origin${mappedOrigins.length === 1 ? "" : "s"}.`;

    renderOriginMarkers(lookupOriginMapMarkersEl, mappedOrigins, selectedOriginKey);
    lookupOriginMapMarkersEl.querySelectorAll("[data-origin-key]").forEach((button) => {
        button.addEventListener("click", () => {
            selectedOriginKey = button.dataset.originKey;
            renderLookupView();
        });
    });
    clearOriginFilterButtonEl.disabled = !selectedOriginKey;
}

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
        lookupListEl.innerHTML = lookupItems.length
            ? '<div class="empty-state">No roast sessions matched the current search.</div>'
            : '<div class="empty-state">No roast sessions saved yet.</div>';
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
    const analytics = buildRoastAnalytics(roast.curve || [], roast.events || [], {
        startedAt: roast.started_at,
        endedAt: roast.ended_at,
    });

    detailTitleEl.textContent = `${roast.bean_name} (#${roast.id})`;
    detailCopyEl.textContent = `Captured ${formatLookupDate(roast.started_at)} through ${formatLookupDate(roast.ended_at)}.`;
    detailOriginEl.textContent = roast.origin || "--";
    detailLevelEl.textContent = roast.roast_level || "--";
    detailSamplesEl.textContent = String(roast.sample_count || 0);
    detailDurationEl.textContent = formatDuration(analytics.totalDurationSeconds);
    detailDevelopmentEl.textContent = formatDuration(analytics.developmentSeconds);
    detailDevelopmentRatioEl.textContent = analytics.developmentRatio !== null && Number.isFinite(analytics.developmentRatio)
        ? `${analytics.developmentRatio.toFixed(0)}%`
        : "--";
    detailPeakTemperatureEl.textContent = Number.isFinite(analytics.peakTemperature)
        ? `${analytics.peakTemperature.toFixed(1)} °C`
        : "--";
    detailRatingEl.textContent = roast.rating ? `${roast.rating}/5` : "Not rated";
    detailTasteNotesEl.textContent = roast.taste_notes || "Taste notes can be added from the post-roast edit page.";
    detailAnalyticsCopyEl.textContent = analytics.developmentSeconds !== null
        ? `Development lasted ${formatDuration(analytics.developmentSeconds)} and peak temperature reached ${Number.isFinite(analytics.peakTemperature) ? `${analytics.peakTemperature.toFixed(1)} °C` : "--"}.`
        : "First crack was not marked for this roast, so development metrics are incomplete.";
    detailNotesEl.textContent = roast.notes || "No notes recorded.";
    editTasteFeedbackLinkEl.href = `/lookup/${roast.id}/edit`;
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

function clearLookupDetail(copy) {
    detailTitleEl.textContent = "No roast session matches";
    detailCopyEl.textContent = copy;
    detailOriginEl.textContent = "--";
    detailLevelEl.textContent = "--";
    detailSamplesEl.textContent = "--";
    detailDurationEl.textContent = "--";
    detailDevelopmentEl.textContent = "--";
    detailDevelopmentRatioEl.textContent = "--";
    detailPeakTemperatureEl.textContent = "--";
    detailRatingEl.textContent = "--";
    detailTasteNotesEl.textContent = "Taste notes can be added from the post-roast edit page.";
    detailAnalyticsCopyEl.textContent = "Select a saved roast to restore analytics and chart detail.";
    detailNotesEl.textContent = "No roast selected.";
    editTasteFeedbackLinkEl.href = "/lookup";
    detailEventsEl.innerHTML = '<div class="empty-state">No event markers saved.</div>';
    detailPhotoEl.removeAttribute("src");
    detailPhotoWrapEl.style.display = "none";
    fillLookupChart(lookupTemperatureChart, [], (point) => Number(point.temperature));
    setStageMarkers(lookupTemperatureChart, []);
    setStageBadges(lookupTemperatureChart, []);
}

function renderLookupView() {
    const filteredItems = getFilteredLookupItems();
    renderLookupOriginMap();
    updateLookupSearchSummary(filteredItems);
    renderLookupList(filteredItems);

    if (!filteredItems.length) {
        clearLookupDetail("Try a different search to bring a saved roast back into view.");
        return;
    }

    const selectedStillVisible = filteredItems.some((item) => item.id === selectedRoastId);
    if (!selectedStillVisible) {
        loadRoastDetail(filteredItems[0].id).catch(() => {
            detailCopyEl.textContent = "Unable to load roast detail right now.";
        });
    }
}

async function loadRoastDetail(roastId) {
    const response = await fetch(`/api/roasts/${roastId}`);
    if (!response.ok) {
        throw new Error("Unable to load roast detail.");
    }

    const roast = await response.json();
    setLookupDetail(roast);
    renderLookupList(getFilteredLookupItems());
}

async function loadLookupPage() {
    const [listResponse, summaryResponse] = await Promise.all([
        fetch("/api/roasts"),
        fetch("/api/roasts/summary"),
    ]);

    const listPayload = await listResponse.json();
    const summaryPayload = await summaryResponse.json();

    lookupItems = listPayload.items || [];
    renderLookupView();
    setLookupSummary(summaryPayload);

    if (lookupItems.length && selectedRoastId === null) {
        await loadRoastDetail(lookupItems[0].id);
    }
}

refreshLookupButtonEl.addEventListener("click", () => {
    loadLookupPage().catch(() => {
        detailCopyEl.textContent = "Unable to refresh roast lookup data right now.";
    });
});

lookupSearchInputEl.addEventListener("input", () => {
    renderLookupView();
});

clearOriginFilterButtonEl.addEventListener("click", () => {
    selectedOriginKey = null;
    renderLookupView();
});

loadLookupPage().catch(() => {
    detailCopyEl.textContent = "Unable to load roast lookup data right now.";
});
