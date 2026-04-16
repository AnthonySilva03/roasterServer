const roastHistoryEl = document.getElementById("roastHistory");

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
                <span>${item.bean_name}</span>
                <span>${item.roast_level}</span>
            </div>
            <div class="history-meta">
                ${item.origin}<br>
                Saved ${formatRoastDate(item.created_at)}<br>
                ${item.sample_count} samples captured
            </div>
        </article>
    `).join("");
}

async function loadRoastHistory() {
    const response = await fetch("/api/roasts");
    const payload = await response.json();
    renderRoastHistory(payload.items || []);
}

loadRoastHistory().catch(() => {
    roastHistoryEl.innerHTML = '<div class="history-item">Unable to load roast history right now.</div>';
});
