/**
 * Enhanced Service Worker Cache (#15)
 * Advanced caching strategies for PWA
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `dynamic-${CACHE_VERSION}`;
const API_CACHE = `api-${CACHE_VERSION}`;
const IMAGE_CACHE = `images-${CACHE_VERSION}`;

// Assets to precache
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/offline.html',
];

// Cache strategies
const CACHE_STRATEGIES = {
    networkFirst: ['api', 'chats', 'messages'],
    cacheFirst: ['fonts', 'css', 'js', 'images'],
    staleWhileRevalidate: ['avatars', 'thumbnails'],
    networkOnly: ['auth', 'login', 'logout', 'stream'],
};

// ============================================
// INSTALL EVENT
// ============================================

self.addEventListener('install', (event: ExtendableEvent) => {
    console.log('[SW] Installing service worker...');

    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => {
                console.log('[SW] Precaching static assets');
                return cache.addAll(PRECACHE_ASSETS);
            })
            .then(() => {
                console.log('[SW] Installation complete');
                return (self as any).skipWaiting();
            })
    );
});

// ============================================
// ACTIVATE EVENT
// ============================================

self.addEventListener('activate', (event: ExtendableEvent) => {
    console.log('[SW] Activating service worker...');

    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(name => !name.endsWith(CACHE_VERSION))
                        .map(name => {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('[SW] Activation complete');
                return (self as any).clients.claim();
            })
    );
});

// ============================================
// FETCH EVENT
// ============================================

self.addEventListener('fetch', (event: FetchEvent) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Skip WebSocket/SSE connections
    if (url.pathname.includes('/stream') || event.request.headers.get('accept')?.includes('text/event-stream')) {
        return;
    }

    // Determine strategy based on URL
    const strategy = determineStrategy(url);

    switch (strategy) {
        case 'network-first':
            event.respondWith(networkFirst(event.request));
            break;
        case 'cache-first':
            event.respondWith(cacheFirst(event.request));
            break;
        case 'stale-while-revalidate':
            event.respondWith(staleWhileRevalidate(event.request));
            break;
        case 'network-only':
            // Let it pass through
            break;
        default:
            event.respondWith(networkFirst(event.request));
    }
});

// ============================================
// CACHING STRATEGIES
// ============================================

function determineStrategy(url: URL): string {
    const pathname = url.pathname;

    if (pathname.startsWith('/api/auth') || pathname.includes('login') || pathname.includes('logout')) {
        return 'network-only';
    }

    if (pathname.startsWith('/api/')) {
        return 'network-first';
    }

    if (pathname.match(/\.(js|css|woff2?|ttf|eot)$/)) {
        return 'cache-first';
    }

    if (pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|ico)$/)) {
        return 'stale-while-revalidate';
    }

    return 'network-first';
}

async function networkFirst(request: Request): Promise<Response> {
    const cache = await caches.open(DYNAMIC_CACHE);

    try {
        const response = await fetch(request);

        // Cache successful responses
        if (response.ok) {
            cache.put(request, response.clone());
        }

        return response;
    } catch (error) {
        // Try cache
        const cached = await cache.match(request);
        if (cached) {
            console.log('[SW] Serving from cache (offline):', request.url);
            return cached;
        }

        // Return offline page for navigation requests
        if (request.mode === 'navigate') {
            const offlinePage = await caches.match('/offline.html');
            if (offlinePage) {
                return offlinePage;
            }
        }

        throw error;
    }
}

async function cacheFirst(request: Request): Promise<Response> {
    const cached = await caches.match(request);

    if (cached) {
        return cached;
    }

    const cache = await caches.open(STATIC_CACHE);
    const response = await fetch(request);

    if (response.ok) {
        cache.put(request, response.clone());
    }

    return response;
}

async function staleWhileRevalidate(request: Request): Promise<Response> {
    const cache = await caches.open(IMAGE_CACHE);
    const cached = await cache.match(request);

    // Fetch in background to update cache
    const fetchPromise = fetch(request)
        .then(response => {
            if (response.ok) {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => null);

    // Return cached immediately if available
    if (cached) {
        return cached;
    }

    // Otherwise wait for network
    const response = await fetchPromise;
    if (response) {
        return response;
    }

    throw new Error('No cached or network response');
}

// ============================================
// BACKGROUND SYNC
// ============================================

self.addEventListener('sync', (event: any) => {
    console.log('[SW] Sync event:', event.tag);

    if (event.tag === 'sync-messages') {
        event.waitUntil(syncPendingMessages());
    }
});

async function syncPendingMessages(): Promise<void> {
    // Get pending messages from IndexedDB
    // Send them to server
    // Remove from pending queue on success
    console.log('[SW] Syncing pending messages...');
}

// ============================================
// PUSH NOTIFICATIONS
// ============================================

self.addEventListener('push', (event: any) => {
    const data = event.data?.json() || {
        title: 'ILIAGPT',
        body: 'Nuevo mensaje',
        icon: '/icons/icon-192x192.png',
    };

    event.waitUntil(
        (self as any).registration.showNotification(data.title, {
            body: data.body,
            icon: data.icon,
            badge: '/icons/badge-72x72.png',
            data: data.data,
            actions: data.actions || [
                { action: 'open', title: 'Abrir' },
                { action: 'dismiss', title: 'Descartar' },
            ],
        })
    );
});

self.addEventListener('notificationclick', (event: any) => {
    event.notification.close();

    if (event.action === 'dismiss') {
        return;
    }

    const urlToOpen = event.notification.data?.url || '/';

    event.waitUntil(
        (self as any).clients.matchAll({ type: 'window' })
            .then((clientList: any[]) => {
                // Focus existing window if available
                for (const client of clientList) {
                    if (client.url === urlToOpen && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Open new window
                return (self as any).clients.openWindow(urlToOpen);
            })
    );
});

// ============================================
// MESSAGE HANDLING
// ============================================

self.addEventListener('message', (event: any) => {
    const { type, payload } = event.data || {};

    switch (type) {
        case 'SKIP_WAITING':
            (self as any).skipWaiting();
            break;

        case 'CACHE_URLS':
            caches.open(DYNAMIC_CACHE).then(cache => {
                cache.addAll(payload.urls);
            });
            break;

        case 'CLEAR_CACHE':
            caches.keys().then(names => {
                names.forEach(name => caches.delete(name));
            });
            break;

        case 'GET_CACHE_SIZE':
            getCacheSize().then(size => {
                event.ports[0].postMessage({ size });
            });
            break;
    }
});

async function getCacheSize(): Promise<number> {
    const cacheNames = await caches.keys();
    let totalSize = 0;

    for (const name of cacheNames) {
        const cache = await caches.open(name);
        const requests = await cache.keys();

        for (const request of requests) {
            const response = await cache.match(request);
            if (response) {
                const blob = await response.blob();
                totalSize += blob.size;
            }
        }
    }

    return totalSize;
}

// Export for TypeScript
export { };
