/**
 * PWA Enhancement Service - ILIAGPT PRO 3.0
 *
 * Progressive Web App features and service worker management.
 * Offline support, push notifications, install prompts.
 */

// ============== Types ==============

export interface PWAConfig {
    appName: string;
    appShortName: string;
    description: string;
    themeColor: string;
    backgroundColor: string;
    display: "standalone" | "fullscreen" | "minimal-ui" | "browser";
    orientation: "portrait" | "landscape" | "any";
    startUrl: string;
    scope: string;
    icons: PWAIcon[];
}

export interface PWAIcon {
    src: string;
    sizes: string;
    type: string;
    purpose?: "any" | "maskable" | "monochrome";
}

export interface InstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface CacheConfig {
    name: string;
    version: number;
    maxAge: number;
    maxEntries: number;
    strategies: Record<string, CacheStrategy>;
}

export type CacheStrategy =
    | "cache-first"
    | "network-first"
    | "stale-while-revalidate"
    | "network-only"
    | "cache-only";

// ============== PWA Manager ==============

export class PWAManager {
    private swRegistration: ServiceWorkerRegistration | null = null;
    private deferredPrompt: InstallPromptEvent | null = null;
    private isInstalled = false;
    private isOnline = navigator.onLine;
    private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

    constructor() {
        this.setupListeners();
    }

    // ======== Service Worker ========

    /**
     * Register service worker
     */
    async register(): Promise<ServiceWorkerRegistration | null> {
        if (!("serviceWorker" in navigator)) {
            console.warn("[PWA] Service workers not supported");
            return null;
        }

        try {
            this.swRegistration = await navigator.serviceWorker.register("/sw.js", {
                scope: "/",
            });

            console.log("[PWA] Service worker registered");

            // Listen for updates
            this.swRegistration.addEventListener("updatefound", () => {
                const newWorker = this.swRegistration?.installing;
                if (newWorker) {
                    newWorker.addEventListener("statechange", () => {
                        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                            this.emit("updateAvailable", newWorker);
                        }
                    });
                }
            });

            return this.swRegistration;
        } catch (error) {
            console.error("[PWA] Service worker registration failed:", error);
            return null;
        }
    }

    /**
     * Update service worker
     */
    async update(): Promise<void> {
        if (this.swRegistration) {
            await this.swRegistration.update();
        }
    }

    /**
     * Skip waiting and activate new worker
     */
    skipWaiting(): void {
        if (this.swRegistration?.waiting) {
            this.swRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
    }

    // ======== Installation ========

    /**
     * Check if app is installed
     */
    checkInstalled(): boolean {
        // Check display mode
        if (window.matchMedia("(display-mode: standalone)").matches) {
            this.isInstalled = true;
            return true;
        }

        // Check iOS Safari
        if ((navigator as any).standalone === true) {
            this.isInstalled = true;
            return true;
        }

        return false;
    }

    /**
     * Can show install prompt
     */
    canInstall(): boolean {
        return this.deferredPrompt !== null && !this.isInstalled;
    }

    /**
     * Show install prompt
     */
    async promptInstall(): Promise<boolean> {
        if (!this.deferredPrompt) {
            console.warn("[PWA] No install prompt available");
            return false;
        }

        await this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;

        this.deferredPrompt = null;

        if (outcome === "accepted") {
            console.log("[PWA] User accepted install");
            this.isInstalled = true;
            this.emit("installed");
            return true;
        }

        console.log("[PWA] User dismissed install");
        return false;
    }

    // ======== Caching ========

    /**
     * Pre-cache URLs
     */
    async precache(urls: string[]): Promise<void> {
        if (!this.swRegistration) return;

        const cache = await caches.open("precache-v1");
        await cache.addAll(urls);
        console.log(`[PWA] Pre-cached ${urls.length} URLs`);
    }

    /**
     * Clear cache
     */
    async clearCache(cacheName?: string): Promise<void> {
        if (cacheName) {
            await caches.delete(cacheName);
        } else {
            const names = await caches.keys();
            await Promise.all(names.map(name => caches.delete(name)));
        }
        console.log("[PWA] Cache cleared");
    }

    /**
     * Get cache statistics
     */
    async getCacheStats(): Promise<{
        caches: { name: string; size: number; entries: number }[];
        totalSize: number;
    }> {
        const names = await caches.keys();
        const stats: { name: string; size: number; entries: number }[] = [];
        let totalSize = 0;

        for (const name of names) {
            const cache = await caches.open(name);
            const keys = await cache.keys();

            let cacheSize = 0;
            for (const request of keys) {
                const response = await cache.match(request);
                if (response) {
                    const blob = await response.blob();
                    cacheSize += blob.size;
                }
            }

            stats.push({ name, size: cacheSize, entries: keys.length });
            totalSize += cacheSize;
        }

        return { caches: stats, totalSize };
    }

    // ======== Background Sync ========

    /**
     * Register background sync
     */
    async registerSync(tag: string): Promise<boolean> {
        if (!this.swRegistration?.sync) {
            console.warn("[PWA] Background sync not supported");
            return false;
        }

        try {
            await this.swRegistration.sync.register(tag);
            console.log(`[PWA] Registered sync: ${tag}`);
            return true;
        } catch (error) {
            console.error("[PWA] Sync registration failed:", error);
            return false;
        }
    }

    // ======== Notifications ========

    /**
     * Request notification permission
     */
    async requestNotificationPermission(): Promise<NotificationPermission> {
        if (!("Notification" in window)) {
            return "denied";
        }

        const permission = await Notification.requestPermission();
        console.log(`[PWA] Notification permission: ${permission}`);
        return permission;
    }

    /**
     * Show local notification
     */
    async showNotification(
        title: string,
        options?: NotificationOptions
    ): Promise<void> {
        if (Notification.permission !== "granted") {
            await this.requestNotificationPermission();
        }

        if (this.swRegistration) {
            await this.swRegistration.showNotification(title, options);
        }
    }

    // ======== Network Status ========

    /**
     * Get online status
     */
    getOnlineStatus(): boolean {
        return this.isOnline;
    }

    // ======== Event Handling ========

    private setupListeners(): void {
        // Install prompt
        window.addEventListener("beforeinstallprompt", (e) => {
            e.preventDefault();
            this.deferredPrompt = e as InstallPromptEvent;
            this.emit("installAvailable");
        });

        // App installed
        window.addEventListener("appinstalled", () => {
            this.isInstalled = true;
            this.deferredPrompt = null;
            this.emit("installed");
        });

        // Online/offline
        window.addEventListener("online", () => {
            this.isOnline = true;
            this.emit("online");
        });

        window.addEventListener("offline", () => {
            this.isOnline = false;
            this.emit("offline");
        });

        // Visibility change
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
                this.update();
            }
        });
    }

    /**
     * Subscribe to events
     */
    on(event: string, callback: (...args: any[]) => void): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(callback);

        return () => {
            this.listeners.get(event)?.delete(callback);
        };
    }

    private emit(event: string, ...args: any[]): void {
        this.listeners.get(event)?.forEach(cb => cb(...args));
    }

    // ======== Manifest ========

    /**
     * Generate manifest
     */
    generateManifest(config: PWAConfig): string {
        const manifest = {
            name: config.appName,
            short_name: config.appShortName,
            description: config.description,
            theme_color: config.themeColor,
            background_color: config.backgroundColor,
            display: config.display,
            orientation: config.orientation,
            start_url: config.startUrl,
            scope: config.scope,
            icons: config.icons,
        };

        return JSON.stringify(manifest, null, 2);
    }
}

// ============== Singleton ==============

let pwaInstance: PWAManager | null = null;

export function getPWAManager(): PWAManager {
    if (!pwaInstance) {
        pwaInstance = new PWAManager();
    }
    return pwaInstance;
}

export default PWAManager;
