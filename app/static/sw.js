// Roaster Server service worker.
// Bump CACHE_VERSION whenever precached assets change to invalidate old caches.
const CACHE_VERSION = "roaster-v1";
const PRECACHE = `${CACHE_VERSION}-precache`;
const RUNTIME = `${CACHE_VERSION}-runtime`;

// App shell: a navigation fallback plus every static asset a page needs offline.
const STATIC_ASSETS = [
    "/",
    "/static/css/app.css",
    "/static/js/toast.js",
    "/static/js/live_charts.js",
    "/static/js/dashboard.js",
    "/static/js/roast_session.js",
    "/static/js/roast_review.js",
    "/static/js/roast_setup.js",
    "/static/js/lookup_page.js",
    "/static/js/lookup_edit.js",
    "/static/js/origin_map.js",
    "/static/vendor/socket.io.min.js",
    "/static/vendor/chart.umd.min.js",
    "/static/vendor/leaflet.js",
    "/static/vendor/leaflet.css",
    "/static/vendor/images/marker-icon.png",
    "/static/vendor/images/marker-icon-2x.png",
    "/static/vendor/images/marker-shadow.png",
    "/static/vendor/images/layers.png",
    "/static/vendor/images/layers-2x.png",
    "/static/icons/icon-192.png",
    "/static/icons/icon-512.png",
    "/static/icons/apple-touch-icon.png",
    "/static/icons/favicon-32.png",
    "/static/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(PRECACHE);
        // allSettled so one missing asset doesn't abort the whole install.
        await Promise.allSettled(STATIC_ASSETS.map((url) => cache.add(url)));
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(
            names
                .filter((name) => !name.startsWith(CACHE_VERSION))
                .map((name) => caches.delete(name))
        );
        await self.clients.claim();
    })());
});

function isLiveRequest(url) {
    // Socket.IO transport and the sensor health probe are always live.
    return url.pathname.startsWith("/socket.io") || url.pathname === "/api/sensor/health";
}

self.addEventListener("fetch", (event) => {
    const { request } = event;

    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);

    // Only handle same-origin requests; let cross-origin (e.g. map tiles) pass through.
    if (url.origin !== self.location.origin) {
        return;
    }

    // Never cache the live socket stream or the hardware health endpoint.
    if (isLiveRequest(url)) {
        return;
    }

    // Saved-roast API is handled in a later milestone; pass through for now.
    if (url.pathname.startsWith("/api/")) {
        return;
    }

    // Navigations: network-first so fresh pages win, fall back to cache offline.
    if (request.mode === "navigate") {
        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                const cache = await caches.open(RUNTIME);
                cache.put(request, response.clone());
                return response;
            } catch (error) {
                const cached = await caches.match(request);
                return cached || (await caches.match("/"));
            }
        })());
        return;
    }

    // Static assets: cache-first, then network (and cache the result).
    event.respondWith((async () => {
        const cached = await caches.match(request);
        if (cached) {
            return cached;
        }
        try {
            const response = await fetch(request);
            if (response && response.ok && response.type === "basic") {
                const cache = await caches.open(RUNTIME);
                cache.put(request, response.clone());
            }
            return response;
        } catch (error) {
            return cached || Response.error();
        }
    })());
});
