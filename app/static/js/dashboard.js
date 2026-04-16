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
const originMapSummaryEl = document.getElementById("originMapSummary");
const originMapMarkersEl = document.getElementById("originMapMarkers");
const originMapCountEl = document.getElementById("originMapCount");
const originMapLegendEl = document.getElementById("originMapLegend");
const temperatureHealthEl = document.getElementById("temperatureHealth");
const servoHealthEl = document.getElementById("servoHealth");
const hardwareSpeedEl = document.getElementById("hardwareSpeed");
const hardwareModeEl = document.getElementById("hardwareMode");
const hardwareErrorEl = document.getElementById("hardwareError");
const hardwareHealthSummaryEl = document.getElementById("hardwareHealthSummary");

let dashboardRoasts = [];
let currentMonth = new Date();
let selectedDateKey = null;

const originCoordinateMap = {
    brazil: { lat: -14.2, lng: -51.9 },
    colombia: { lat: 4.6, lng: -74.1 },
    costa_rica: { lat: 9.9, lng: -84.2 },
    guatemala: { lat: 15.7, lng: -90.2 },
    honduras: { lat: 14.8, lng: -86.2 },
    nicaragua: { lat: 12.9, lng: -85.2 },
    mexico: { lat: 23.6, lng: -102.5 },
    peru: { lat: -9.2, lng: -75.0 },
    ethiopia: { lat: 9.1, lng: 40.5 },
    kenya: { lat: 0.1, lng: 37.9 },
    rwanda: { lat: -1.9, lng: 29.9 },
    burundi: { lat: -3.4, lng: 29.9 },
    tanzania: { lat: -6.4, lng: 34.9 },
    uganda: { lat: 1.4, lng: 32.3 },
    yemen: { lat: 15.6, lng: 48.5 },
    india: { lat: 20.6, lng: 78.9 },
    vietnam: { lat: 14.1, lng: 108.3 },
    indonesia: { lat: -2.5, lng: 118.0 },
    sumatra: { lat: -0.6, lng: 101.3 },
    java: { lat: -7.5, lng: 110.0 },
    panama: { lat: 8.5, lng: -80.0 },
    ecuador: { lat: -1.8, lng: -78.2 },
    bolivia: { lat: -16.3, lng: -63.6 },
    china: { lat: 35.8, lng: 104.1 },
    papua_new_guinea: { lat: -6.3, lng: 147.0 },
    el_salvador: { lat: 13.8, lng: -88.9 },
};

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

function normalizeOriginKey(origin) {
    const value = String(origin || "").toLowerCase();
    const replacements = [
        ["costa rica", "costa_rica"],
        ["el salvador", "el_salvador"],
        ["papua new guinea", "papua_new_guinea"],
    ];

    for (const [needle, key] of replacements) {
        if (value.includes(needle)) {
            return key;
        }
    }

    const countries = Object.keys(originCoordinateMap);
    const matched = countries.find((country) => value.includes(country.replace(/_/g, " ")));
    if (matched) {
        return matched;
    }

    const tail = value.split(",").map((part) => part.trim()).filter(Boolean).pop() || value.trim();
    return tail.replace(/[^a-z]+/g, "_");
}

function projectOriginCoordinate(point) {
    const left = ((point.lng + 180) / 360) * 100;
    const top = ((90 - point.lat) / 180) * 100;
    return { left, top };
}

function renderOriginMap() {
    if (!dashboardRoasts.length) {
        originMapSummaryEl.textContent = "Save roasts to start plotting roasted origins around the world.";
        originMapCountEl.textContent = "0";
        originMapMarkersEl.innerHTML = "";
        originMapLegendEl.innerHTML = '<div class="empty-state">Origin markers will appear after roast sessions load.</div>';
        return;
    }

    const groupedOrigins = dashboardRoasts.reduce((accumulator, roast) => {
        const key = normalizeOriginKey(roast.origin);
        if (!originCoordinateMap[key]) {
            return accumulator;
        }

        if (!accumulator[key]) {
            accumulator[key] = {
                label: roast.origin,
                count: 0,
                point: originCoordinateMap[key],
            };
        }

        accumulator[key].count += 1;
        return accumulator;
    }, {});

    const mappedOrigins = Object.values(groupedOrigins).sort((left, right) => right.count - left.count);
    originMapCountEl.textContent = String(mappedOrigins.length);

    if (!mappedOrigins.length) {
        originMapSummaryEl.textContent = "Saved origins have not matched a map coordinate yet.";
        originMapMarkersEl.innerHTML = "";
        originMapLegendEl.innerHTML = '<div class="empty-state">No mapped origins yet. Try saving roasts with country names in the origin field.</div>';
        return;
    }

    originMapSummaryEl.textContent = `${mappedOrigins.length} mapped origin${mappedOrigins.length === 1 ? "" : "s"} from ${dashboardRoasts.length} saved roast session${dashboardRoasts.length === 1 ? "" : "s"}.`;

    originMapMarkersEl.innerHTML = mappedOrigins.map((origin) => {
        const placement = projectOriginCoordinate(origin.point);
        return `
            <button
                type="button"
                class="origin-marker"
                style="left: ${placement.left}%; top: ${placement.top}%;"
                title="${origin.label} (${origin.count})"
            >
                <span class="origin-marker-dot"></span>
                <span class="origin-marker-label">${origin.label.split(",").pop().trim()}</span>
            </button>
        `;
    }).join("");

    originMapLegendEl.innerHTML = mappedOrigins.map((origin) => `
        <article class="history-item">
            <div class="history-topline">
                <span>${origin.label}</span>
                <span>${origin.count} roast${origin.count === 1 ? "" : "s"}</span>
            </div>
            <div class="history-meta">Mapped from saved roast origin data on the dashboard.</div>
        </article>
    `).join("");
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
    renderOriginMap();
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
