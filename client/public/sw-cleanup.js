// This script runs immediately and clears stale service workers before the main app loads
// It must be executed BEFORE any other JavaScript to break the cache cycle
(function() {
  var APP_VERSION = '2.0.2';
  // Keep the key consistent with client/src/main.tsx so both mechanisms agree.
  var VERSION_KEY = 'iliagpt_app_version';
  var stored = localStorage.getItem(VERSION_KEY);

  // In development (served by Vite), skip version enforcement to avoid
  // infinite reload loops with main.tsx which uses "dev" as its version.
  var isDev = window.location.port === '5050' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  if (isDev) {
    return;
  }

  if (stored !== APP_VERSION) {
    console.log('[IliaGPT Cleanup] Version changed: ' + stored + ' -> ' + APP_VERSION);
    localStorage.setItem(VERSION_KEY, APP_VERSION);

    // Immediately unregister all service workers
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for (var i = 0; i < registrations.length; i++) {
          registrations[i].unregister();
          console.log('[IliaGPT Cleanup] Unregistered SW:', registrations[i].scope);
        }
        // Clear all caches
        if ('caches' in window) {
          caches.keys().then(function(names) {
            for (var j = 0; j < names.length; j++) {
              caches.delete(names[j]);
              console.log('[IliaGPT Cleanup] Deleted cache:', names[j]);
            }
            // Force reload after cleanup
            if (registrations.length > 0 || names.length > 0) {
              console.log('[IliaGPT Cleanup] Reloading...');
              window.location.reload(true);
            }
          });
        }
      });
    }
  }
})();
