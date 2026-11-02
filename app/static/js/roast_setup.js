const roastHistoryEl = document.getElementById("roastHistory");
const referenceSelectEl = document.getElementById("referenceSelect");

function formatRoastDate(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
        return dateString;
    }

    return date.toLocaleString();
}

function renderRoastHistory(items) {
    if (!items.length) {
        roastHistoryEl.innerHTML = '<div class="history-item">No roast sessions saved yet.</div>';
        return;
    }

    roastHistoryEl.innerHTML = items.map((item) => `
        <article class="history-item">
            <div class="history-topline">
                <span>${escapeHtml(item.bean_name)}</span>
                <span>${escapeHtml(item.roast_level)}</span>
            </div>
            <div class="history-meta">
                ${escapeHtml(item.origin)}<br>
                Saved ${escapeHtml(formatRoastDate(item.created_at))}<br>
                ${item.weight_grams !== null && item.weight_grams !== undefined ? `${escapeHtml(Number(item.weight_grams).toFixed(1))} g` : "Weight --"}<br>
                ${item.total_roast_seconds !== null && item.total_roast_seconds !== undefined ? `Roast time ${escapeHtml(formatDuration(item.total_roast_seconds))}` : "Roast time --"}<br>
                ${escapeHtml(item.sample_count)} samples captured
            </div>
        </article>
    `).join("");
}

// Reference roast picker: any saved roast with a curve can be followed.
function renderReferenceOptions(items) {
    if (!referenceSelectEl) {
        return;
    }
    const options = items
        .filter((item) => Number(item.sample_count) > 0)
        .map((item) => {
            const option = document.createElement("option");
            option.value = String(item.id);
            const duration = item.total_roast_seconds !== null && item.total_roast_seconds !== undefined
                ? formatDuration(item.total_roast_seconds)
                : "--";
            option.textContent = `#${item.id} ${item.bean_name} · ${item.roast_level} · ${duration} · ${formatRoastDate(item.created_at)}`;
            return option;
        });
    options.forEach((option) => referenceSelectEl.appendChild(option));
}

async function loadRoastHistory() {
    const response = await fetch("/api/roasts");
    const payload = await response.json();
    renderRoastHistory(payload.items || []);

    const allResponse = await fetch("/api/roasts?limit=all");
    const allPayload = allResponse.ok ? await allResponse.json() : payload;
    renderReferenceOptions(allPayload.items || payload.items || []);
}

loadRoastHistory().catch(() => {
    roastHistoryEl.innerHTML = '<div class="history-item">Unable to load roast history right now.</div>';
});
