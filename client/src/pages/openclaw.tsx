import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ChevronLeft } from "lucide-react";
import { apiFetch } from "@/lib/apiClient";

const OPENCLAW_VERSION = "2026.4.14";
const OPENCLAW_RELEASE_URL = `https://github.com/openclaw/openclaw/releases/tag/v${OPENCLAW_VERSION}`;

const OPENCLAW_OPTIMIZE_STORAGE_KEY = "ilia:openclaw:last-optimize-at";
const OPENCLAW_OPTIMIZE_TTL_MS = 6 * 60 * 60 * 1000;

function readLastOptimizeAt(): number {
  if (typeof window === "undefined") {
    return 0;
  }
  try {
    const raw = window.localStorage.getItem(OPENCLAW_OPTIMIZE_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeLastOptimizeAt(value: number): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(OPENCLAW_OPTIMIZE_STORAGE_KEY, String(value));
  } catch {
    // Ignore storage failures; optimization still ran.
  }
}

export default function OpenClawPage() {
  const [, setLocation] = useLocation();
  const optimizationStartedRef = useRef(false);
  const [iframeReloadToken, setIframeReloadToken] = useState(0);
  const [iframeBootToken] = useState(() => Date.now());

  useEffect(() => {
    if (optimizationStartedRef.current) {
      return;
    }
    optimizationStartedRef.current = true;

    const now = Date.now();
    if (now - readLastOptimizeAt() < OPENCLAW_OPTIMIZE_TTL_MS) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await apiFetch("/api/skills/openclaw/optimize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "all-installable",
            timeoutMs: 300_000,
          }),
          timeoutMs: 305_000,
        });
        if (!response.ok) {
          throw new Error(`OpenClaw optimize failed with status ${response.status}`);
        }

        const result = await response.json();
        writeLastOptimizeAt(Date.now());

        if (!cancelled && result?.changed) {
          setIframeReloadToken(Date.now());
        }
      } catch (error) {
        console.warn("[OpenClawPage] automatic optimization failed:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const iframeSrc =
    iframeReloadToken > 0
      ? `/openclaw-boot?boot=${iframeBootToken}&refresh=${iframeReloadToken}`
      : `/openclaw-boot?boot=${iframeBootToken}`;

  return (
    <div className="flex flex-col h-screen bg-background" data-testid="openclaw-page">
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-background shrink-0">
        <button
          onClick={() => setLocation("/")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          data-testid="button-back-to-app"
        >
          <ChevronLeft className="h-4 w-4" />
          <span>IliaGPT</span>
        </button>
        <span className="text-muted-foreground/50">›</span>
        <span className="text-sm font-medium">OpenClaw</span>
        <a
          href={OPENCLAW_RELEASE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-1 text-[10px] font-mono text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          data-testid="link-openclaw-version"
        >
          v{OPENCLAW_VERSION}
        </a>
      </div>
      <iframe
        src={iframeSrc}
        className="flex-1 w-full border-0"
        title="OpenClaw Control UI"
        data-testid="iframe-openclaw"
      />
    </div>
  );
}
