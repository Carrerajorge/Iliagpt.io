/**
 * PreviewPanel — Iframe preview with console log capture,
 * runtime error surface, and loading/error status indicators.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, ExternalLink, Monitor, Tablet, Smartphone,
  Terminal, X, AlertTriangle, Loader2, ChevronDown, ChevronUp, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsoleEntry {
  level: "log" | "warn" | "error" | "info";
  message: string;
  timestamp: number;
}

interface PreviewPanelProps {
  sessionId: string;
  /** Parent can supply console entries collected elsewhere */
  consoleEntries?: ConsoleEntry[];
  onConsoleEntry?: (entry: ConsoleEntry) => void;
}

type DeviceSize = "desktop" | "tablet" | "mobile";
type PreviewStatus = "loading" | "ready" | "error";

const DEVICE_SIZES: Record<DeviceSize, string> = {
  desktop: "w-full",
  tablet: "w-[768px] mx-auto",
  mobile: "w-[375px] mx-auto",
};

const LEVEL_STYLES: Record<ConsoleEntry["level"], string> = {
  log: "text-gray-300",
  info: "text-blue-400",
  warn: "text-amber-400",
  error: "text-red-400",
};

// ---------------------------------------------------------------------------
// Console capture script injected into the iframe
// ---------------------------------------------------------------------------

const CONSOLE_CAPTURE_SCRIPT = `
<script>
(function() {
  var origConsole = {};
  ['log','warn','error','info'].forEach(function(level) {
    origConsole[level] = console[level];
    console[level] = function() {
      origConsole[level].apply(console, arguments);
      try {
        var msg = Array.prototype.slice.call(arguments).map(function(a) {
          if (typeof a === 'object') try { return JSON.stringify(a, null, 2); } catch(e) { return String(a); }
          return String(a);
        }).join(' ');
        window.parent.postMessage({ __codex_console: true, level: level, message: msg }, '*');
      } catch(e) {}
    };
  });
  window.addEventListener('error', function(e) {
    window.parent.postMessage({
      __codex_console: true,
      level: 'error',
      message: (e.message || 'Unknown error') + (e.filename ? ' at ' + e.filename + ':' + e.lineno : '')
    }, '*');
  });
  window.addEventListener('unhandledrejection', function(e) {
    window.parent.postMessage({
      __codex_console: true,
      level: 'error',
      message: 'Unhandled rejection: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason))
    }, '*');
  });
})();
</script>
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PreviewPanel({ sessionId, consoleEntries: externalEntries, onConsoleEntry }: PreviewPanelProps) {
  const [key, setKey] = useState(0);
  const [device, setDevice] = useState<DeviceSize>("desktop");
  const [status, setStatus] = useState<PreviewStatus>("loading");
  const [showConsole, setShowConsole] = useState(false);
  const [localEntries, setLocalEntries] = useState<ConsoleEntry[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  const entries = externalEntries || localEntries;
  const errorCount = entries.filter(e => e.level === "error").length;
  const warnCount = entries.filter(e => e.level === "warn").length;

  const previewUrl = `/api/codex/${sessionId}/preview`;

  // Listen for postMessage console entries from iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data && e.data.__codex_console) {
        const entry: ConsoleEntry = {
          level: e.data.level,
          message: e.data.message,
          timestamp: Date.now(),
        };
        if (onConsoleEntry) onConsoleEntry(entry);
        else setLocalEntries(prev => [...prev.slice(-199), entry]);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onConsoleEntry]);

  // Auto-scroll console
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  // Track iframe load state
  const handleIframeLoad = useCallback(() => {
    setStatus("ready");
    // Inject console capture script
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc) {
        const script = doc.createElement("script");
        script.textContent = CONSOLE_CAPTURE_SCRIPT.replace(/<\/?script>/g, "");
        doc.head?.appendChild(script);
      }
    } catch {
      // cross-origin — use srcdoc approach instead
    }
  }, []);

  const handleIframeError = useCallback(() => {
    setStatus("error");
  }, []);

  const refresh = useCallback(() => {
    setKey(k => k + 1);
    setStatus("loading");
  }, []);

  const clearConsole = useCallback(() => {
    setLocalEntries([]);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refresh} title="Refresh">
            <RefreshCw className={cn("h-3.5 w-3.5", status === "loading" && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => window.open(previewUrl, "_blank")} title="Open in new tab">
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>

          {/* Status indicator */}
          {status === "loading" && (
            <Badge variant="outline" className="text-xs gap-1 ml-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading
            </Badge>
          )}
          {status === "error" && (
            <Badge variant="destructive" className="text-xs gap-1 ml-1">
              <AlertTriangle className="h-3 w-3" /> Failed to load
            </Badge>
          )}
          {status === "ready" && errorCount > 0 && (
            <Badge variant="destructive" className="text-xs gap-1 ml-1">
              {errorCount} error{errorCount > 1 ? "s" : ""}
            </Badge>
          )}
          {status === "ready" && warnCount > 0 && errorCount === 0 && (
            <Badge variant="outline" className="text-xs gap-1 ml-1 text-amber-600 border-amber-300">
              {warnCount} warning{warnCount > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Console toggle */}
          <Button
            variant={showConsole ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7 relative"
            onClick={() => setShowConsole(!showConsole)}
            title="Toggle console"
          >
            <Terminal className="h-3.5 w-3.5" />
            {entries.length > 0 && !showConsole && (
              <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-blue-500 text-[8px] text-white flex items-center justify-center">
                {entries.length > 99 ? "!" : entries.length}
              </span>
            )}
          </Button>

          <div className="w-px h-5 bg-border mx-1" />

          <Button variant={device === "desktop" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setDevice("desktop")}>
            <Monitor className="h-3.5 w-3.5" />
          </Button>
          <Button variant={device === "tablet" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setDevice("tablet")}>
            <Tablet className="h-3.5 w-3.5" />
          </Button>
          <Button variant={device === "mobile" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setDevice("mobile")}>
            <Smartphone className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Preview iframe */}
      <div className={cn("flex-1 bg-white dark:bg-gray-900 overflow-auto", showConsole && "flex-[2]")}>
        <div className={cn("h-full transition-all duration-300", DEVICE_SIZES[device])}>
          <iframe
            ref={iframeRef}
            key={key}
            src={previewUrl}
            className="w-full h-full border-0"
            title="Project Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={handleIframeLoad}
            onError={handleIframeError}
          />
        </div>
      </div>

      {/* Console panel */}
      {showConsole && (
        <div className="border-t flex flex-col max-h-48 min-h-[80px]">
          <div className="flex items-center justify-between px-3 py-1 bg-muted/30 border-b shrink-0">
            <span className="text-xs font-medium flex items-center gap-1">
              <Terminal className="h-3 w-3" /> Console
              {entries.length > 0 && (
                <Badge variant="outline" className="text-[10px] ml-1 h-4 px-1">{entries.length}</Badge>
              )}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={clearConsole} title="Clear console">
                <Trash2 className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowConsole(false)}>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-gray-950 p-2">
            {entries.length === 0 ? (
              <div className="text-xs text-gray-500 text-center py-2">No console output</div>
            ) : (
              entries.map((entry, i) => (
                <div key={i} className={cn("text-xs font-mono py-0.5 border-b border-gray-800/50 flex items-start gap-2", LEVEL_STYLES[entry.level])}>
                  <span className="text-gray-600 shrink-0 w-12 text-right tabular-nums">
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span className="shrink-0 w-10 uppercase text-[10px] font-semibold opacity-70">{entry.level}</span>
                  <span className="whitespace-pre-wrap break-all">{entry.message}</span>
                </div>
              ))
            )}
            <div ref={consoleEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
