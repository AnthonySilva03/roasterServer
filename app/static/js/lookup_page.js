const lookupListEl = document.getElementById("lookupList");
const lookupSearchInputEl = document.getElementById("lookupSearchInput");
const lookupSearchSummaryEl = document.getElementById("lookupSearchSummary");
const lookupOriginMapSummaryEl = document.getElementById("lookupOriginMapSummary");
const lookupOriginWorldMapEl = document.getElementById("lookupOriginWorldMap");
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
const detailWeightEl = document.getElementById("detailWeight");
const detailFlameLevelEl = document.getElementById("detailFlameLevel");
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
const editRoastLinkEl = document.getElementById("editRoastLink");
const exportRoastLinkEl = document.getElementById("exportRoastLink");
const removeRoastButtonEl = document.getElementById("removeRoastButton");

const lookupPhaseSummaryEl = document.getElementById("lookupPhaseSummary");
const compareSelectEl = document.getElementById("compareSelect");
const comparePhaseSummaryEl = document.getElementById("comparePhaseSummary");

const lookupTemperatureChart = createLineChart(
    "lookupTemperatureChart",
    "Saved Temperature",
    "#b4542b"
);
enableRorOverlay(lookupTemperatureChart);
enableFlameOverlay(lookupTemperatureChart);
enableReferenceOverlay(lookupTemperatureChart);

let selectedRoastId = null;
let lookupItems = [];
let selectedOriginKey = null;
let compareRoastId = null;
let primaryStageMarkers = [];

// --- Roast comparator: overlay a second saved roast aligned at Charge ---------

function renderCompareOptions() {
    if (!compareSelectEl) {
        return;
    }
    const current = compareSelectEl.value;
    compareSelectEl.innerHTML = '<option value="">None</option>';
    lookupItems
        .filter((item) => item.id !== selectedRoastId && Number(item.sample_count) > 0)
        .forEach((item) => {
            const option = document.createElement("option");
            option.value = String(item.id);
            option.textContent = `#${item.id} ${item.bean_name} · ${item.roast_level}`;
            compareSelectEl.appendChild(option);
        });
    compareSelectEl.value = lookupItems.some((item) => String(item.id) === current && item.id !== selectedRoastId)
        ? current
        : "";
    if (!compareSelectEl.value) {
        clearCompareOverlay();
    }
}

function clearCompareOverlay() {
    compareRoastId = null;
    setReferenceSeries(lookupTemperatureChart, { temperature: [], flame: [] });
    setStageMarkers(lookupTemperatureChart, primaryStageMarkers);
    if (comparePhaseSummaryEl) {
        comparePhaseSummaryEl.style.display = "none";
        comparePhaseSummaryEl.textContent = "";
    }
}

async function loadCompareRoast(roastId) {
    const response = await fetch(`/api/roasts/${roastId}`);
    if (!response.ok) {
        throw new Error("Unable to load comparison roast.");
    }
    const roast = await response.json();
    if (compareSelectEl && String(roastId) !== compareSelectEl.value) {
        return; // selection changed while loading
    }
    compareRoastId = roast.id;
    const options = { startedAt: roast.started_at, endedAt: roast.ended_at };
    const baseTime = resolveChartBaseTime(roast.curve || [], options);
    setReferenceSeries(lookupTemperatureChart, {
        temperature: buildChartSeries(roast.curve || [], options),
        flame: buildFlameSeries(roast.curve || [], options),
    });
    const markers = (roast.events || [])
        .filter((event) => ["Dry End", "First Crack", "First Crack End", "Second Crack", "Drop", "Finish"].includes(event.label))
        .map((event) => ({
            label: toElapsedMinutes(event.time, baseTime, roast.started_at),
            text: `#${roast.id} ${event.label}`,
            color: "rgba(126, 164, 255, 0.7)",
            style: "reference",
        }))
        .filter((marker) => Number.isFinite(marker.label));
    setStageMarkers(lookupTemperatureChart, [...markers, ...primaryStageMarkers]);

    const phases = buildRoastPhases(roast.curve || [], roast.events || [], options);
    const phaseText = (phases.phases || [])
        .map((phase) => `${phase.label} ${formatDuration(phase.seconds)} (${formatPercent(phase.percent)})`)
        .join(" · ");
    if (comparePhaseSummaryEl) {
        comparePhaseSummaryEl.style.display = "";
        comparePhaseSummaryEl.textContent = `Comparing with #${roast.id} ${roast.bean_name}: total ${formatDuration(phases.totalSeconds)}${phaseText ? ` · ${phaseText}` : ""}`;
    }
}

if (compareSelectEl) {
    compareSelectEl.addEventListener("change", () => {
        const roastId = Number(compareSelectEl.value || 0);
        if (!roastId) {
            clearCompareOverlay();
            return;
        }
        loadCompareRoast(roastId).catch(() => {
            showToast("Unable to load the comparison roast.", "error");
            clearCompareOverlay();
        });
    });
}

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
        selectedOriginKey = null;
        lookupOriginMapSummaryEl.textContent = "No mapped roast origins available yet.";
        renderOriginMarkers(lookupOriginWorldMapEl, [], null, null);
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

    renderOriginMarkers(lookupOriginWorldMapEl, mappedOrigins, selectedOriginKey, (key) => {
        selectedOriginKey = key;
        renderLookupView();
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
        <button class="lookup-item ${item.id === selectedRoastId ? "active" : ""}" type="button" data-roast-id="${escapeHtml(item.id)}">
            <div class="lookup-topline">
                <span>${escapeHtml(item.bean_name)}</span>
                <span>${escapeHtml(item.roast_level)}</span>
            </div>
            <div class="lookup-meta">
                ${escapeHtml(item.origin)}<br>
                Saved ${escapeHtml(formatLookupDate(item.created_at))}<br>
                ${escapeHtml(item.sample_count)} samples
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
    setChartSeries(
        chart,
        curve
            .map((point) => ({
                ...point,
                temperature: extractor(point),
            }))
    );
}

function renderLookupEvents(events) {
    if (!events.length) {
        detailEventsEl.innerHTML = '<div class="empty-state">No event markers saved.</div>';
        return;
    }

    detailEventsEl.innerHTML = events.map((event) => `
        <article class="history-item">
            <div class="history-topline">
                <span>${escapeHtml(event.label)}</span>
                <span>${escapeHtml(formatLookupDate(event.time))}</span>
            </div>
            <div class="history-meta">
                ${escapeHtml(event.detail || "No details")}<br>
                ${event.temperature !== null && event.temperature !== undefined ? `Temp ${escapeHtml(Number(event.temperature).toFixed(1))} °C` : ""}
                ${event.flame_level !== null && event.flame_level !== undefined ? `<br>Flame ${escapeHtml(event.flame_level)}%` : ""}
            </div>
        </article>
    `).join("");
}

function buildEventBadges(events) {
    return events
        .filter((event) => event.chart_label)
        .map((event) => ({
            chart_label: event.chart_label,
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
    const chartBaseTime = resolveChartBaseTime(roast.curve || [], {
        startedAt: roast.started_at,
        endedAt: roast.ended_at,
    });

    detailTitleEl.textContent = `${roast.bean_name} (#${roast.id})`;
    detailCopyEl.textContent = `Captured ${formatLookupDate(roast.started_at)} through ${formatLookupDate(roast.ended_at)}.${roast.total_roast_seconds !== null && roast.total_roast_seconds !== undefined ? ` Total roast time ${formatDuration(roast.total_roast_seconds)}.` : ""}`;
    detailOriginEl.textContent = roast.origin || "--";
    detailLevelEl.textContent = roast.roast_level || "--";
    detailSamplesEl.textContent = String(roast.sample_count || 0);
    detailWeightEl.textContent = roast.weight_grams !== null && roast.weight_grams !== undefined
        ? `${Number(roast.weight_grams).toFixed(1)} g`
        : "--";
    detailFlameLevelEl.textContent = roast.flame_level !== null && roast.flame_level !== undefined
        ? `${Number(roast.flame_level)}%`
        : "--";
    detailDurationEl.textContent = formatDuration(
        roast.total_roast_seconds !== null && roast.total_roast_seconds !== undefined
            ? Number(roast.total_roast_seconds)
            : analytics.totalDurationSeconds
    );
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
    editRoastLinkEl.href = `/lookup/${roast.id}/edit`;
    if (exportRoastLinkEl) {
        exportRoastLinkEl.href = `/api/roasts/${roast.id}/export`;
        exportRoastLinkEl.style.display = "";
    }
    removeRoastButtonEl.disabled = false;
    removeRoastButtonEl.dataset.roastId = String(roast.id);
    removeRoastButtonEl.dataset.roastName = roast.bean_name || `Roast #${roast.id}`;
    renderLookupEvents(roast.events || []);

    const chartOptions = {
        startedAt: roast.started_at,
        endedAt: roast.ended_at,
    };
    fillLookupChart(
        lookupTemperatureChart,
        buildChartSeries(roast.curve || [], chartOptions),
        (point) => Number(point.y)
    );
    setRorSeries(lookupTemperatureChart, buildRorSeries(roast.curve || [], chartOptions));
    setFlameSeries(lookupTemperatureChart, buildFlameSeries(roast.curve || [], chartOptions));
    setPhaseBands(lookupTemperatureChart, buildPhaseBands(analytics.phases));
    renderPhaseSummary(lookupPhaseSummaryEl, analytics.phases);
    primaryStageMarkers = [];
    setStageMarkers(lookupTemperatureChart, []);
    renderCompareOptions();
    if (compareRoastId && compareRoastId !== roast.id) {
        loadCompareRoast(compareRoastId).catch(() => clearCompareOverlay());
    }
    setStageBadges(
        lookupTemperatureChart,
        buildEventBadges(roast.events || [])
            .map((event) => ({
                ...event,
                x: toElapsedMinutes(event.chart_label, chartBaseTime, roast.started_at),
            }))
            .filter((event) => Number.isFinite(event.x))
    );

    const photoSrc = roast.photo_url || roast.photo_data || "";
    if (photoSrc) {
        detailPhotoEl.src = photoSrc;
        detailPhotoWrapEl.style.display = "block";
    } else {
        detailPhotoEl.removeAttribute("src");
        detailPhotoWrapEl.style.display = "none";
    }
}

function clearLookupDetail(copy) {
    selectedRoastId = null;
    detailTitleEl.textContent = "No roast session matches";
    detailCopyEl.textContent = copy;
    detailOriginEl.textContent = "--";
    detailLevelEl.textContent = "--";
    detailSamplesEl.textContent = "--";
    detailWeightEl.textContent = "--";
    detailFlameLevelEl.textContent = "--";
    detailDurationEl.textContent = "--";
    detailDevelopmentEl.textContent = "--";
    detailDevelopmentRatioEl.textContent = "--";
    detailPeakTemperatureEl.textContent = "--";
    detailRatingEl.textContent = "--";
    detailTasteNotesEl.textContent = "Taste notes can be added from the post-roast edit page.";
    detailAnalyticsCopyEl.textContent = "Select a saved roast to restore analytics and chart detail.";
    detailNotesEl.textContent = "No roast selected.";
    editRoastLinkEl.href = "/lookup";
    if (exportRoastLinkEl) {
        exportRoastLinkEl.href = "/lookup";
        exportRoastLinkEl.style.display = "none";
    }
    removeRoastButtonEl.disabled = true;
    delete removeRoastButtonEl.dataset.roastId;
    delete removeRoastButtonEl.dataset.roastName;
    detailEventsEl.innerHTML = '<div class="empty-state">No event markers saved.</div>';
    detailPhotoEl.removeAttribute("src");
    detailPhotoWrapEl.style.display = "none";
    fillLookupChart(lookupTemperatureChart, [], (point) => Number(point.y));
    setRorSeries(lookupTemperatureChart, []);
    setFlameSeries(lookupTemperatureChart, []);
    setPhaseBands(lookupTemperatureChart, []);
    renderPhaseSummary(lookupPhaseSummaryEl, null);
    primaryStageMarkers = [];
    setStageMarkers(lookupTemperatureChart, []);
    setStageBadges(lookupTemperatureChart, []);
    clearCompareOverlay();
    renderCompareOptions();
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

async function deleteSelectedRoast() {
    const roastId = Number(removeRoastButtonEl.dataset.roastId || 0);
    if (!roastId) {
        return;
    }

    const roastName = removeRoastButtonEl.dataset.roastName || `roast #${roastId}`;
    const confirmed = window.confirm(`Remove ${roastName} from saved roasts? This cannot be undone.`);
    if (!confirmed) {
        return;
    }

    removeRoastButtonEl.disabled = true;
    detailCopyEl.textContent = `Removing ${roastName}...`;

    const response = await fetch(`/api/roasts/${roastId}`, {
        method: "DELETE",
    });

    if (!response.ok) {
        removeRoastButtonEl.disabled = false;
        detailCopyEl.textContent = `Unable to remove ${roastName} right now.`;
        showToast(`Unable to remove ${roastName} right now.`, "error");
        return;
    }

    lookupItems = lookupItems.filter((item) => item.id !== roastId);
    selectedRoastId = null;
    renderLookupView();
    showToast(`Removed ${roastName}.`, "success");

    const summaryResponse = await fetch("/api/roasts/summary");
    if (summaryResponse.ok) {
        const summaryPayload = await summaryResponse.json();
        setLookupSummary(summaryPayload);
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

removeRoastButtonEl.addEventListener("click", () => {
    deleteSelectedRoast().catch(() => {
        removeRoastButtonEl.disabled = false;
        detailCopyEl.textContent = "Unable to remove the saved roast right now.";
    });
});

removeRoastButtonEl.disabled = true;

loadLookupPage().catch(() => {
    detailCopyEl.textContent = "Unable to load roast lookup data right now.";
});
