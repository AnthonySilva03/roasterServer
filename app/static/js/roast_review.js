const reviewMessageEl = document.getElementById("reviewMessage");
const reviewTitleEl = document.getElementById("reviewTitle");
const reviewSubtitleEl = document.getElementById("reviewSubtitle");
const reviewOriginEl = document.getElementById("reviewOrigin");
const reviewRoastLevelEl = document.getElementById("reviewRoastLevel");
const reviewSampleCountEl = document.getElementById("reviewSampleCount");
const reviewEventsEl = document.getElementById("reviewEvents");
const saveRoastButtonEl = document.getElementById("saveRoastButton");
const cancelRoastButtonEl = document.getElementById("cancelRoastButton");
const photoInputEl = document.getElementById("photoInput");
const photoPreviewWrapEl = document.getElementById("photoPreviewWrap");
const photoPreviewEl = document.getElementById("photoPreview");

let pendingRoast = null;

function renderPendingRoast() {
    if (!pendingRoast) {
        reviewMessageEl.textContent = "No roast is waiting for review.";
        reviewSubtitleEl.textContent = "Return to the roast page to begin a session.";
        return;
    }

    reviewTitleEl.textContent = pendingRoast.bean_name || "Pending Roast";
    reviewSubtitleEl.textContent = `Started ${new Date(pendingRoast.started_at).toLocaleString()} and finished ${new Date(pendingRoast.ended_at).toLocaleString()}.`;
    reviewOriginEl.textContent = pendingRoast.origin || "--";
    reviewRoastLevelEl.textContent = pendingRoast.roast_level || "--";
    reviewSampleCountEl.textContent = String((pendingRoast.curve || []).length);
    reviewMessageEl.textContent = "Review the roast and choose Save or Cancel.";

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
