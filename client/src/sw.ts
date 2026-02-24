/**
 * ILIAGPT Service Worker
 *
 * Features:
 * - Offline caching of static assets
 * - Network-first strategy for API calls
 * - Background sync for pending requests
 * - Push notification support
 */

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = "iliagpt-cache-v1";
const STATIC_CACHE = "iliagpt-static-v1";
const API_CACHE = "iliagpt-api-v1";

// Assets to cache immediately
const PRECACHE_ASSETS = [
    "/",
    "/index.html",
    "/offline.html",
    "/manifest.json",
    "/icons/icon-192x192.png",
    "/icons/icon-512x512.png",
];

// Offline fallback page
const OFFLINE_PAGE = "/offline.html";

// API routes to cache with network-first strategy
const CACHEABLE_API_ROUTES = [
    "/api/health",
    "/api/models",
];

// Install event - precache static assets
self.addEventListener("install", (event) => {
    console.log("[ServiceWorker] Installing...");

    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => {
                console.log("[ServiceWorker] Precaching static assets");
                return cache.addAll(PRECACHE_ASSETS);
            })
            .then(() => {
                console.log("[ServiceWorker] Install complete");
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error("[ServiceWorker] Precache failed:", error);
            })
    );
});

// Activate event - clean old caches
self.addEventListener("activate", (event) => {
    console.log("[ServiceWorker] Activating...");

    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) =>
                            name !== CACHE_NAME &&
                            name !== STATIC_CACHE &&
                            name !== API_CACHE
                        )
                        .map((name) => {
                            console.log("[ServiceWorker] Deleting old cache:", name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log("[ServiceWorker] Activate complete");
                return self.clients.claim();
            })
    );
});

// Fetch event - serve from cache or network
self.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== "GET") return;

    // Skip WebSocket and SSE connections
    if (url.pathname.includes("/stream") || url.pathname.includes("/ws")) return;

    // API requests - network first, cache fallback
    if (url.pathname.startsWith("/api/")) {
        if (CACHEABLE_API_ROUTES.some((route) => url.pathname.startsWith(route))) {
            event.respondWith(networkFirstStrategy(request, API_CACHE));
        }
        return;
    }

    // Static assets - cache first
    if (
        url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|eot)$/) ||
        url.pathname === "/" ||
        url.pathname.endsWith(".html")
    ) {
        event.respondWith(cacheFirstStrategy(request, STATIC_CACHE));
        return;
    }

    // Default - network only
    event.respondWith(fetch(request));
});

// Cache-first strategy
async function cacheFirstStrategy(request: Request, cacheName: string): Promise<Response> {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    if (cached) {
        // Return cached, but update in background
        fetchAndCache(request, cacheName);
        return cached;
    }

    return fetchAndCache(request, cacheName);
}

// Network-first strategy
async function networkFirstStrategy(request: Request, cacheName: string): Promise<Response> {
    const cache = await caches.open(cacheName);

    try {
        const response = await fetch(request);

        if (response.ok) {
            cache.put(request, response.clone());
        }

        return response;
    } catch (error) {
        const cached = await cache.match(request);

        if (cached) {
            return cached;
        }

        // Return offline fallback for HTML requests
        if (request.headers.get("Accept")?.includes("text/html")) {
            const offlinePage = await caches.match(OFFLINE_PAGE);
            if (offlinePage) {
                return offlinePage;
            }
            // Fallback to inline HTML if offline page not cached
            return new Response(
                `<!DOCTYPE html>
        <html lang="es">
          <head><meta charset="UTF-8"><title>Sin conexión</title></head>
          <body style="font-family:system-ui;text-align:center;padding:2rem;">
            <h1>Sin conexión</h1>
            <p>No hay conexión a internet. Intenta de nuevo más tarde.</p>
            <button onclick="location.reload()">Reintentar</button>
          </body>
        </html>`,
                {
                    headers: { "Content-Type": "text/html" },
                    status: 503,
                }
            );
        }

        throw error;
    }
}

// Fetch and cache helper
async function fetchAndCache(request: Request, cacheName: string): Promise<Response> {
    const cache = await caches.open(cacheName);

    try {
        const response = await fetch(request);

        if (response.ok) {
            cache.put(request, response.clone());
        }

        return response;
    } catch (error) {
        // Try to return from cache on network error
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
    }
}

// Push notification handler
self.addEventListener("push", (event) => {
    if (!event.data) return;

    const data = event.data.json();

    const options: NotificationOptions = {
        body: data.body || "New notification",
        icon: "/icons/icon-192x192.png",
        badge: "/icons/badge-72x72.png",
        vibrate: [100, 50, 100],
        data: {
            url: data.url || "/",
        },
        actions: [
            {
                action: "open",
                title: "Open",
            },
            {
                action: "dismiss",
                title: "Dismiss",
            },
        ],
    };

    event.waitUntil(
        self.registration.showNotification(data.title || "ILIAGPT", options)
    );
});

// Notification click handler
self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    if (event.action === "dismiss") return;

    const url = event.notification.data?.url || "/";

    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true })
            .then((clients) => {
                // Focus existing window if available
                for (const client of clients) {
                    if (client.url === url && "focus" in client) {
                        return client.focus();
                    }
                }

                // Open new window
                return self.clients.openWindow(url);
            })
    );
});

// Background sync for failed requests
self.addEventListener("sync", (event) => {
    if (event.tag === "sync-messages") {
        event.waitUntil(syncPendingMessages());
    }
});

// Sync pending messages (placeholder)
async function syncPendingMessages(): Promise<void> {
    console.log("[ServiceWorker] Syncing pending messages...");
    // Implementation would retrieve pending messages from IndexedDB
    // and retry sending them
}

// Message handler for client communication
self.addEventListener("message", (event) => {
    if (event.data?.type === "SKIP_WAITING") {
        self.skipWaiting();
    }

    if (event.data?.type === "CLEAR_CACHE") {
        event.waitUntil(
            caches.keys().then((names) =>
                Promise.all(names.map((name) => caches.delete(name)))
            )
        );
    }
});

export { };
