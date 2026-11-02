// Ranking report: one row per saved roast with the statistics Artisan's
// Ranking Report shows, sortable by any column and downloadable as CSV.
const reportHeaderRowEl = document.getElementById("reportHeaderRow");
const reportBodyEl = document.getElementById("reportBody");
const reportSummaryEl = document.getElementById("reportSummary");
const reportAucBaseEl = document.getElementById("reportAucBase");
const refreshReportButtonEl = document.getElementById("refreshReportButton");
const downloadReportCsvButtonEl = document.getElementById("downloadReportCsvButton");

const REPORT_COLUMNS = [
    { key: "id", label: "#", format: (v) => `#${v}` },
    { key: "created_at", label: "Date", format: (v) => formatReportDate(v) },
    { key: "bean_name", label: "Bean", format: (v) => v || "--" },
    { key: "batch_label", label: "Batch", format: (v) => v || "--" },
    { key: "roast_level", label: "Level", format: (v) => v || "--" },
    { key: "weight_grams", label: "In (g)", format: (v) => num(v, 0) },
    { key: "roasted_weight_grams", label: "Out (g)", format: (v) => num(v, 0) },
    { key: "weight_loss_percent", label: "Loss", format: (v) => pct(v, 1) },
    { key: "total_seconds", label: "Total", format: (v) => dur(v) },
    { key: "turning_point_seconds", label: "TP", format: (v) => dur(v) },
    { key: "dry_end_seconds", label: "Dry End", format: (v) => dur(v) },
    { key: "first_crack_seconds", label: "FC", format: (v) => dur(v) },
    { key: "development_seconds", label: "Dev", format: (v) => dur(v) },
    { key: "dtr", label: "DTR", format: (v) => pct(v, 0) },
    { key: "charge_temp", label: "Charge °C", format: (v) => num(v, 0) },
    { key: "first_crack_temp", label: "FC °C", format: (v) => num(v, 0) },
    { key: "drop_temp", label: "Drop °C", format: (v) => num(v, 0) },
    { key: "auc", label: "AUC", format: (v) => num(v, 0) },
    { key: "roast_color", label: "Color", format: (v) => v || "--" },
    { key: "rating", label: "Cup", format: (v) => (v ? `${v}/5` : "--") },
];

let reportRows = [];
let sortKey = "created_at";
let sortDirection = -1;

function num(value, digits) {
    return Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value).toFixed(digits) : "--";
}

function pct(value, digits) {
    return Number.isFinite(Number(value)) && value !== null && value !== "" ? `${Number(value).toFixed(digits)}%` : "--";
}

function dur(value) {
    return Number.isFinite(Number(value)) && value !== null && value !== "" ? formatDuration(Number(value)) : "--";
}

function formatReportDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? (value || "--") : date.toLocaleDateString();
}

function compareValues(a, b) {
    const aMissing = a === null || a === undefined || a === "";
    const bMissing = b === null || b === undefined || b === "";
    if (aMissing && bMissing) {
        return 0;
    }
    if (aMissing) {
        return 1; // missing values always sink to the bottom
    }
    if (bMissing) {
        return -1;
    }
    const aNumber = Number(a);
    const bNumber = Number(b);
    if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && a !== "" && b !== "") {
        return (aNumber - bNumber) * sortDirection;
    }
    return String(a).localeCompare(String(b)) * sortDirection;
}

function sortedRows() {
    return [...reportRows].sort((a, b) => compareValues(a[sortKey], b[sortKey]));
}

function renderHeader() {
    reportHeaderRowEl.innerHTML = REPORT_COLUMNS.map((column) => `
        <th>
            <button type="button" class="report-sort ${column.key === sortKey ? "active" : ""}" data-sort="${escapeHtml(column.key)}">
                ${escapeHtml(column.label)}${column.key === sortKey ? (sortDirection > 0 ? " ▲" : " ▼") : ""}
            </button>
        </th>
    `).join("");
    reportHeaderRowEl.querySelectorAll("[data-sort]").forEach((button) => {
        button.addEventListener("click", () => {
            if (sortKey === button.dataset.sort) {
                sortDirection *= -1;
            } else {
                sortKey = button.dataset.sort;
                sortDirection = sortKey === "created_at" || sortKey === "id" ? -1 : 1;
            }
            renderReport();
        });
    });
}

function renderReport() {
    renderHeader();
    const rows = sortedRows();
    if (!rows.length) {
        reportBodyEl.innerHTML = `<tr><td colspan="${REPORT_COLUMNS.length}" class="empty-state">No roasts saved yet.</td></tr>`;
        return;
    }
    reportBodyEl.innerHTML = rows.map((row) => `
        <tr class="report-row" data-roast-id="${escapeHtml(row.id)}" tabindex="0">
            ${REPORT_COLUMNS.map((column) => `<td>${escapeHtml(column.format(row[column.key]))}</td>`).join("")}
        </tr>
    `).join("");
    reportBodyEl.querySelectorAll("[data-roast-id]").forEach((tr) => {
        const open = () => {
            window.location.href = `/lookup?roast=${encodeURIComponent(tr.dataset.roastId)}`;
        };
        tr.addEventListener("click", open);
        tr.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                open();
            }
        });
    });
}

function downloadCsv() {
    const header = REPORT_COLUMNS.map((column) => column.label);
    const lines = [header, ...sortedRows().map((row) => REPORT_COLUMNS.map((column) => {
        const value = row[column.key];
        return value === null || value === undefined ? "" : String(value);
    }))];
    const csv = lines.map((cells) => cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "roast-report.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function loadReport() {
    const settings = getRoastSettings();
    reportAucBaseEl.textContent = `${settings.aucBaseC} °C`;
    const response = await fetch(`/api/roasts/report?auc_base=${encodeURIComponent(settings.aucBaseC)}`);
    if (!response.ok) {
        throw new Error("report unavailable");
    }
    const payload = await response.json();
    reportRows = payload.items || [];
    renderReport();
    reportSummaryEl.textContent = `${reportRows.length} roast${reportRows.length === 1 ? "" : "s"}. Click a column to sort; click again to reverse.`;
}

refreshReportButtonEl.addEventListener("click", () => {
    loadReport().catch(() => {
        reportSummaryEl.textContent = "Unable to load the report right now.";
    });
});

downloadReportCsvButtonEl.addEventListener("click", downloadCsv);

loadReport().catch(() => {
    reportSummaryEl.textContent = "Unable to load the report right now.";
    reportBodyEl.innerHTML = '<tr><td class="empty-state">Report unavailable.</td></tr>';
});
