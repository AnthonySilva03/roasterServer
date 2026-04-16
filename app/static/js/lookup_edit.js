const roastId = Number(document.body.dataset.roastId || 0);

const editFeedbackMessageEl = document.getElementById("editFeedbackMessage");
const editRoastTitleEl = document.getElementById("editRoastTitle");
const editRoastSubtitleEl = document.getElementById("editRoastSubtitle");
const editRoastOriginEl = document.getElementById("editRoastOrigin");
const editRoastLevelEl = document.getElementById("editRoastLevel");
const editRoastCurrentRatingEl = document.getElementById("editRoastCurrentRating");
const editRoastCurrentNotesEl = document.getElementById("editRoastCurrentNotes");
const tasteRatingInputEl = document.getElementById("tasteRatingInput");
const tasteNotesInputEl = document.getElementById("tasteNotesInput");
const saveTasteFeedbackButtonEl = document.getElementById("saveTasteFeedbackButton");

function formatLookupEditDate(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
        return dateString;
    }

    return date.toLocaleString();
}

function renderRoastFeedback(roast) {
    editRoastTitleEl.textContent = `${roast.bean_name} (#${roast.id})`;
    editRoastSubtitleEl.textContent = `Roasted ${formatLookupEditDate(roast.started_at)} through ${formatLookupEditDate(roast.ended_at)}.`;
    editRoastOriginEl.textContent = roast.origin || "--";
    editRoastLevelEl.textContent = roast.roast_level || "--";
    editRoastCurrentRatingEl.textContent = roast.rating ? `${roast.rating}/5` : "Not rated";
    editRoastCurrentNotesEl.textContent = roast.taste_notes || "No tasting notes saved yet.";
    tasteRatingInputEl.value = roast.rating ? String(roast.rating) : "";
    tasteNotesInputEl.value = roast.taste_notes || "";
}

async function loadRoastFeedback() {
    const response = await fetch(`/api/roasts/${roastId}`);
    if (!response.ok) {
        throw new Error("Unable to load roast feedback.");
    }

    const roast = await response.json();
    renderRoastFeedback(roast);
    editFeedbackMessageEl.textContent = "Update the cup score and tasting notes, then save.";
}

saveTasteFeedbackButtonEl.addEventListener("click", async () => {
    const payload = {
        rating: tasteRatingInputEl.value ? Number(tasteRatingInputEl.value) : null,
        taste_notes: tasteNotesInputEl.value.trim(),
    };

    const response = await fetch(`/api/roasts/${roastId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    const body = await response.json();
    if (!response.ok) {
        editFeedbackMessageEl.textContent = body.error || "Unable to save cup feedback.";
        return;
    }

    renderRoastFeedback(body);
    editFeedbackMessageEl.textContent = "Cup feedback saved. Returning to lookup...";
    window.setTimeout(() => {
        window.location.href = "/lookup";
    }, 900);
});

loadRoastFeedback().catch(() => {
    editFeedbackMessageEl.textContent = "Unable to load the saved roast for editing.";
});
