const roastId = Number(document.body.dataset.roastId || 0);

const editFeedbackMessageEl = document.getElementById("editFeedbackMessage");
const editRoastTitleEl = document.getElementById("editRoastTitle");
const editRoastSubtitleEl = document.getElementById("editRoastSubtitle");
const editRoastOriginEl = document.getElementById("editRoastOrigin");
const editRoastLevelEl = document.getElementById("editRoastLevel");
const editRoastCurrentWeightEl = document.getElementById("editRoastCurrentWeight");
const editRoastCurrentNotesEl = document.getElementById("editRoastCurrentNotes");
const editRoastCurrentTasteNotesEl = document.getElementById("editRoastCurrentTasteNotes");
const editBeanNameInputEl = document.getElementById("editBeanNameInput");
const editOriginInputEl = document.getElementById("editOriginInput");
const editRoastLevelInputEl = document.getElementById("editRoastLevelInput");
const editWeightInputEl = document.getElementById("editWeightInput");
const editRoastNotesInputEl = document.getElementById("editRoastNotesInput");
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
    editRoastCurrentWeightEl.textContent = roast.weight_grams !== null && roast.weight_grams !== undefined
        ? `${Number(roast.weight_grams).toFixed(1)} g`
        : "--";
    editRoastCurrentNotesEl.textContent = roast.notes || "No roast notes saved yet.";
    editRoastCurrentTasteNotesEl.textContent = roast.taste_notes || "No tasting notes saved yet.";
    editBeanNameInputEl.value = roast.bean_name || "";
    editOriginInputEl.value = roast.origin || "";
    editRoastLevelInputEl.value = roast.roast_level || "Medium";
    editWeightInputEl.value = roast.weight_grams !== null && roast.weight_grams !== undefined
        ? String(roast.weight_grams)
        : "";
    editRoastNotesInputEl.value = roast.notes || "";
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
    editFeedbackMessageEl.textContent = "Update roast details and post-brew notes, then save.";
}

saveTasteFeedbackButtonEl.addEventListener("click", async () => {
    const payload = {
        bean_name: editBeanNameInputEl.value.trim(),
        origin: editOriginInputEl.value.trim(),
        roast_level: editRoastLevelInputEl.value,
        weight_grams: editWeightInputEl.value ? Number(editWeightInputEl.value) : null,
        notes: editRoastNotesInputEl.value.trim(),
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
    editFeedbackMessageEl.textContent = "Roast changes saved. Returning to lookup...";
    window.setTimeout(() => {
        window.location.href = "/lookup";
    }, 900);
});

loadRoastFeedback().catch(() => {
    editFeedbackMessageEl.textContent = "Unable to load the saved roast for editing.";
});
