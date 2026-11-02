// Flavour-wheel tags and roast-defect flags (Artisan's cupping flags), plus a
// small chip picker shared by the review and edit pages and a read-only chip
// renderer for the lookup page. Pure data/helpers are exported for tests.

const FLAVOR_TAG_GROUPS = Object.freeze([
    { group: "Fruity", tags: ["Berry", "Citrus", "Stone fruit", "Tropical", "Dried fruit", "Apple / pear"] },
    { group: "Floral & sweet", tags: ["Floral", "Honey", "Caramel", "Brown sugar", "Vanilla", "Maple"] },
    { group: "Chocolate & nutty", tags: ["Cocoa", "Dark chocolate", "Milk chocolate", "Almond", "Hazelnut", "Peanut"] },
    { group: "Spice & roast", tags: ["Baking spice", "Clove", "Tobacco", "Smoky", "Toasty", "Burnt"] },
    { group: "Acidity & body", tags: ["Bright", "Winey", "Juicy", "Mellow", "Syrupy", "Light body", "Heavy body"] },
    { group: "Off notes", tags: ["Grassy", "Papery", "Earthy", "Rubbery", "Sour", "Astringent", "Flat"] },
]);

const DEFECT_FLAGS = Object.freeze([
    "Underdeveloped",
    "Baked",
    "Scorched",
    "Tipping",
    "Facing",
    "Uneven roast",
    "Quakers",
    "Stalled RoR",
    "Too fast",
    "Too slow",
    "Over-roasted",
]);

function allFlavorTags() {
    return FLAVOR_TAG_GROUPS.flatMap((group) => group.tags);
}

// Toggle a tag in a list (case-insensitive), returning a new list.
function toggleTag(list, tag) {
    const current = Array.isArray(list) ? list : [];
    const match = current.find((item) => item.toLowerCase() === tag.toLowerCase());
    return match ? current.filter((item) => item !== match) : [...current, tag];
}

function hasTag(list, tag) {
    return Array.isArray(list) && list.some((item) => item.toLowerCase() === tag.toLowerCase());
}

// Renders chip buttons into containerEl. groups: [{group, tags}]. onToggle(tag).
function renderTagPicker(containerEl, groups, selected, onToggle) {
    if (!containerEl) {
        return;
    }
    const custom = (selected || []).filter((tag) => !groups.some((group) => group.tags.some((known) => known.toLowerCase() === tag.toLowerCase())));
    containerEl.innerHTML = groups.map((group) => `
        <div class="tag-group">
            ${group.group ? `<div class="metric-label">${escapeHtml(group.group)}</div>` : ""}
            <div class="tag-chips">
                ${group.tags.map((tag) => `
                    <button type="button" class="tag-chip ${hasTag(selected, tag) ? "tag-chip-on" : ""}" data-tag="${escapeHtml(tag)}" aria-pressed="${hasTag(selected, tag)}">${escapeHtml(tag)}</button>
                `).join("")}
                ${custom.map((tag) => `
                    <button type="button" class="tag-chip tag-chip-on tag-chip-custom" data-tag="${escapeHtml(tag)}" aria-pressed="true">${escapeHtml(tag)}</button>
                `).join("")}
            </div>
        </div>
    `).join("");
    containerEl.querySelectorAll("[data-tag]").forEach((button) => {
        button.addEventListener("click", () => onToggle(button.dataset.tag));
    });
}

function renderTagChips(containerEl, tags, emptyText) {
    if (!containerEl) {
        return;
    }
    if (!Array.isArray(tags) || !tags.length) {
        containerEl.innerHTML = `<span class="helper-text">${escapeHtml(emptyText || "None")}</span>`;
        return;
    }
    containerEl.innerHTML = `<div class="tag-chips">${tags.map((tag) => `<span class="tag-chip tag-chip-static">${escapeHtml(tag)}</span>`).join("")}</div>`;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { FLAVOR_TAG_GROUPS, DEFECT_FLAGS, allFlavorTags, toggleTag, hasTag };
}
