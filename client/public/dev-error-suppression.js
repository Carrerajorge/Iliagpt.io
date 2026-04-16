(function () {
  const originalError = console.error;
  const originalWarn = console.warn;
  const suppressedPatterns = [
    '[vite] failed to connect to websocket',
    'Could not parse CSS stylesheet',
    'adoptedStyleSheets'
  ];
  const shouldSuppress = (args) => {
    const msg = args[0];
    if (!msg) return false;
    const str = typeof msg === 'string' ? msg : (msg.message || String(msg));
    return suppressedPatterns.some(p => str.includes(p));
  };
  console.error = function (...args) {
    if (shouldSuppress(args)) return;
    originalError.apply(console, args);
  };
  console.warn = function (...args) {
    if (shouldSuppress(args)) return;
    originalWarn.apply(console, args);
  };
})();
