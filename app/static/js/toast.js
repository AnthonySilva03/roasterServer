// Lightweight toast notifications shared across every page.
// Usage: showToast("Saved", "success") | showToast("Failed", "error")
(function (global) {
    const DEFAULT_DURATION = 4000;

    function getRegion() {
        let region = document.getElementById("toastRegion");
        if (!region) {
            region = document.createElement("div");
            region.id = "toastRegion";
            region.className = "toast-region";
            document.body.appendChild(region);
        }
        return region;
    }

    function showToast(message, type = "info", options = {}) {
        if (!message) {
            return null;
        }

        const region = getRegion();
        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        toast.setAttribute("role", type === "error" ? "alert" : "status");
        toast.textContent = message;

        region.appendChild(toast);
        // Trigger the enter transition on the next frame.
        requestAnimationFrame(() => toast.classList.add("toast-visible"));

        const duration = Number.isFinite(options.duration) ? options.duration : DEFAULT_DURATION;
        const dismiss = () => {
            toast.classList.remove("toast-visible");
            toast.addEventListener("transitionend", () => toast.remove(), { once: true });
            // Fallback in case the transition never fires.
            window.setTimeout(() => toast.remove(), 400);
        };

        toast.addEventListener("click", dismiss);
        if (duration > 0) {
            window.setTimeout(dismiss, duration);
        }

        return toast;
    }

    global.showToast = showToast;
})(window);
