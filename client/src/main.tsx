import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "katex/dist/katex.min.css";
import "katex/contrib/mhchem";
import "@/lib/i18n";

// Force Service Worker update and cache clear on new version
const APP_VERSION = import.meta.env.VITE_APP_VERSION || "dev";
const STORED_VERSION_KEY = "iliagpt_app_version";
let cleanupInProgress = false;

function isChunkLoadError(err: unknown): boolean {
  const msg =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as any).message)
        : "";
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg);
}

async function clearCacheAndReload() {
  if (cleanupInProgress) return;
  cleanupInProgress = true;
  try {
    // Unregister all service workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    }
    
    // Clear all caches
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }
    
    // Clear localStorage marker and reload
    localStorage.setItem(STORED_VERSION_KEY, APP_VERSION);
    window.location.reload();
  } catch (error) {
    console.error("Error clearing cache:", error);
    localStorage.setItem(STORED_VERSION_KEY, APP_VERSION);
    window.location.reload();
  }
}

// Auto-recover from stale deploys (Vite chunk load errors) by clearing SW caches.
window.addEventListener("error", (event) => {
  if (isChunkLoadError((event as any).error || (event as any).message)) {
    void clearCacheAndReload();
  }
});
window.addEventListener("unhandledrejection", (event) => {
  if (isChunkLoadError((event as any).reason)) {
    void clearCacheAndReload();
  }
});

// Check if we need to clear cache — with loop protection
const storedVersion = localStorage.getItem(STORED_VERSION_KEY);
const RELOAD_GUARD_KEY = "iliagpt_reload_guard";
const reloadCount = parseInt(localStorage.getItem(RELOAD_GUARD_KEY) || "0", 10);

if (storedVersion !== APP_VERSION && reloadCount < 2) {
  console.log(`[IliaGPT] Version mismatch: ${storedVersion} -> ${APP_VERSION}, clearing cache...`);
  localStorage.setItem(RELOAD_GUARD_KEY, String(reloadCount + 1));
  void clearCacheAndReload();
} else {
  // Clear reload guard on successful boot
  localStorage.removeItem(RELOAD_GUARD_KEY);
  // Ensure stored version matches to prevent future mismatches
  if (storedVersion !== APP_VERSION) {
    localStorage.setItem(STORED_VERSION_KEY, APP_VERSION);
  }
  createRoot(document.getElementById("root")!).render(<App />);
}
