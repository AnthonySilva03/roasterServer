// Install-helper banner. Progressive enhancement:
//  - If the browser fires beforeinstallprompt (Chromium on a secure origin),
//    the Install button triggers the real one-tap install.
//  - Otherwise (e.g. Firefox, or http:// on the Pi AP), it shows manual
//    "Add to Home screen" instructions, which is the only way to install there.
// Hides itself when already running installed, and is dismissible per session.
(function () {
    const banner = document.getElementById("pwaInstallBanner");
    if (!banner) {
        return;
    }
    const installBtn = document.getElementById("pwaInstallButton");
    const dismissBtn = document.getElementById("pwaInstallDismiss");
    const help = document.getElementById("pwaInstallHelp");
    const helpClose = document.getElementById("pwaInstallHelpClose");

    const isInstalled = window.matchMedia("(display-mode: standalone)").matches
        || window.navigator.standalone === true;
    if (isInstalled) {
        return;
    }
    if (sessionStorage.getItem("pwaInstallDismissed") === "1") {
        return;
    }

    let deferredPrompt = null;
    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        deferredPrompt = event;
    });

    window.addEventListener("load", () => {
        // Give beforeinstallprompt a moment to arrive before showing the banner.
        window.setTimeout(() => { banner.hidden = false; }, 600);
    });

    installBtn.addEventListener("click", async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            try {
                await deferredPrompt.userChoice;
            } catch (error) {
                // ignore
            }
            deferredPrompt = null;
            banner.hidden = true;
            return;
        }
        // No native prompt available — show manual instructions.
        if (help) {
            help.hidden = false;
        }
    });

    dismissBtn.addEventListener("click", () => {
        banner.hidden = true;
        sessionStorage.setItem("pwaInstallDismissed", "1");
    });

    if (helpClose) {
        helpClose.addEventListener("click", () => { help.hidden = true; });
    }
    if (help) {
        help.addEventListener("click", (event) => {
            if (event.target === help) {
                help.hidden = true;
            }
        });
    }

    window.addEventListener("appinstalled", () => {
        banner.hidden = true;
    });
})();
