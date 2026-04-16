const dashboardSocket = io();

const dashboardMessageEl = document.getElementById("dashboardMessage");
const dashboardStatusEl = document.getElementById("sensorStatus");
const dashboardSourceEl = document.getElementById("sensorSource");
const dashboardUpdatedEl = document.getElementById("lastUpdated");
const latestTemperatureEl = document.getElementById("latestTemperature");
const calendarTitleEl = document.getElementById("calendarTitle");
const calendarSubtitleEl = document.getElementById("calendarSubtitle");
const roastCalendarEl = document.getElementById("roastCalendar");
const selectedDayLabelEl = document.getElementById("selectedDayLabel");
const calendarDayListEl = document.getElementById("calendarDayList");
const calendarMonthSummaryEl = document.getElementById("calendarMonthSummary");
const calendarPrevButtonEl = document.getElementById("calendarPrevButton");
const calendarTodayButtonEl = document.getElementById("calendarTodayButton");
const calendarNextButtonEl = document.getElementById("calendarNextButton");
const temperatureHealthEl = document.getElementById("temperatureHealth");
const servoHealthEl = document.getElementById("servoHealth");
const hardwareSpeedEl = document.getElementById("hardwareSpeed");
const hardwareModeEl = document.getElementById("hardwareMode");
const hardwareErrorEl = document.getElementById("hardwareError");
const hardwareHealthSummaryEl = document.getElementById("hardwareHealthSummary");

let dashboardRoasts = [];
let currentMonth = new Date();
let selectedDateKey = null;

function setDashboardMetrics(data) {
    latestTemperatureEl.textContent = `${Number(data.temperature).toFixed(1)} °C`;
    dashboardSourceEl.textContent = data.source || "Unknown";
    dashboardUpdatedEl.textContent = data.timestamp;
}

function toDateKey(dateValue) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatHumanDate(dateValue) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
        return dateValue;
    }

    return date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
    });
}

function groupRoastsByDate(items) {
    return items.reduce((accumulator, roast) => {
        const key = toDateKey(roast.started_at || roast.created_at);
        if (!key) {
            return accumulator;
        }

        if (!accumulator[key]) {
            accumulator[key] = [];
        }

        accumulator[key].push(roast);
        return accumulator;
    }, {});
}

function renderSelectedDay(groupedRoasts) {
    if (!selectedDateKey) {
        selectedDayLabelEl.textContent = "Choose a date on the calendar.";
        calendarDayListEl.innerHTML = '<div class="empty-state">No roast day selected.</div>';
        return;
    }

    const roasts = groupedRoasts[selectedDateKey] || [];
    selectedDayLabelEl.textContent = formatHumanDate(selectedDateKey);

    if (!roasts.length) {
        calendarDayListEl.innerHTML = '<div class="empty-state">No roasts saved on this day.</div>';
        return;
    }

    calendarDayListEl.innerHTML = roasts.map((roast) => `
        <article class="history-item">
            <div class="history-topline">
                <span>${roast.bean_name}</span>
                <span>${roast.roast_level}</span>
            </div>
            <div class="history-meta">
                ${roast.origin}<br>
                Started ${new Date(roast.started_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}<br>
                ${roast.sample_count} samples captured
            </div>
        </article>
    `).join("");
}

function renderCalendar() {
    const monthDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const groupedRoasts = groupRoastsByDate(dashboardRoasts);
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDayOfWeek = monthDate.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayKey = toDateKey(new Date());
    const monthItems = dashboardRoasts.filter((roast) => {
        const date = new Date(roast.started_at || roast.created_at);
        return date.getFullYear() === year && date.getMonth() === month;
    });

    calendarTitleEl.textContent = monthDate.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
    });
    calendarSubtitleEl.textContent = `${monthItems.length} roast${monthItems.length === 1 ? "" : "s"} saved this month.`;
    calendarMonthSummaryEl.textContent = monthItems.length
        ? `${monthItems.length} roast sessions are recorded in ${calendarTitleEl.textContent.toLowerCase()}.`
        : `No roast sessions are recorded in ${calendarTitleEl.textContent.toLowerCase()} yet.`;

    const cells = [];
    for (let index = 0; index < firstDayOfWeek; index += 1) {
        cells.push('<div class="calendar-cell muted-cell"></div>');
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
        const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const roasts = groupedRoasts[dateKey] || [];
        const classNames = [
            "calendar-cell",
            roasts.length ? "has-roasts" : "",
            dateKey === selectedDateKey ? "selected" : "",
            dateKey === todayKey ? "today" : "",
        ].filter(Boolean).join(" ");

        cells.push(`
            <button type="button" class="${classNames}" data-date-key="${dateKey}">
                <span class="calendar-day-number">${day}</span>
                <span class="calendar-day-count">${roasts.length ? `${roasts.length} roast${roasts.length === 1 ? "" : "s"}` : ""}</span>
            </button>
        `);
    }

    roastCalendarEl.innerHTML = cells.join("");
    roastCalendarEl.querySelectorAll("[data-date-key]").forEach((button) => {
        button.addEventListener("click", () => {
            selectedDateKey = button.dataset.dateKey;
            renderCalendar();
        });
    });

    renderSelectedDay(groupedRoasts);
}

function setHealthChip(element, ok, okText, failText) {
    element.textContent = ok ? okText : failText;
    element.classList.toggle("health-ok", Boolean(ok));
    element.classList.toggle("health-fail", !ok);
}

async function loadHardwareHealth() {
    const response = await fetch("/api/sensor/health");
    const health = await response.json();

    setHealthChip(temperatureHealthEl, health.temperature_ok, "Online", "Offline");
    setHealthChip(servoHealthEl, health.servo_ok, "Online", "Offline");
    hardwareSpeedEl.textContent = `${health.speed ?? 0}%`;
    hardwareModeEl.textContent = health.mode || "Unknown";
    hardwareErrorEl.textContent = health.last_temperature_error || "No hardware errors reported.";

    hardwareHealthSummaryEl.textContent = response.ok
        ? `Hardware check passed using ${health.source || "unknown"} mode.`
        : `Hardware check needs attention for ${health.source || "unknown"} mode.`;
}

async function loadDashboardCalendar() {
    const response = await fetch("/api/roasts?limit=all");
    const payload = await response.json();
    dashboardRoasts = payload.items || [];

    if (!selectedDateKey && dashboardRoasts.length) {
        selectedDateKey = toDateKey(dashboardRoasts[0].started_at || dashboardRoasts[0].created_at);
    }

    renderCalendar();
}

dashboardSocket.on("connect", () => {
    dashboardStatusEl.textContent = "Connected";
    dashboardMessageEl.textContent = "Socket connection established.";
});

dashboardSocket.on("disconnect", () => {
    dashboardStatusEl.textContent = "Disconnected";
    dashboardMessageEl.textContent = "Trying to reconnect to the server...";
});

dashboardSocket.on("sensor_state", (state) => {
    dashboardStatusEl.textContent = state.active ? "Streaming" : "Paused";
    dashboardSourceEl.textContent = state.source || "Unknown";
    if (state.speed !== undefined) {
        hardwareSpeedEl.textContent = `${state.speed}%`;
    }
});

dashboardSocket.on("sensor_data", (data) => {
    setDashboardMetrics(data);
});

dashboardSocket.on("control_response", (data) => {
    dashboardMessageEl.textContent = data.message;
});

document.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => {
        dashboardSocket.emit("control", { command: button.dataset.command });
    });
});

calendarPrevButtonEl.addEventListener("click", () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    renderCalendar();
});

calendarTodayButtonEl.addEventListener("click", () => {
    currentMonth = new Date();
    renderCalendar();
});

calendarNextButtonEl.addEventListener("click", () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    renderCalendar();
});

loadDashboardCalendar().catch(() => {
    calendarSubtitleEl.textContent = "Unable to load roast dates right now.";
    calendarMonthSummaryEl.textContent = "Calendar data is unavailable.";
});

loadHardwareHealth().catch(() => {
    hardwareHealthSummaryEl.textContent = "Unable to fetch hardware health right now.";
    hardwareErrorEl.textContent = "Health endpoint unavailable.";
    setHealthChip(temperatureHealthEl, false, "Online", "Offline");
    setHealthChip(servoHealthEl, false, "Online", "Offline");
});
