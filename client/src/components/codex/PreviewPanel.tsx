/**
 * PreviewPanel — Iframe preview for Codex projects.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, ExternalLink, Monitor, Tablet, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

interface PreviewPanelProps {
  sessionId: string;
}

type DeviceSize = "desktop" | "tablet" | "mobile";

const DEVICE_SIZES: Record<DeviceSize, string> = {
  desktop: "w-full",
  tablet: "w-[768px] mx-auto",
  mobile: "w-[375px] mx-auto",
};

export function PreviewPanel({ sessionId }: PreviewPanelProps) {
  const [key, setKey] = useState(0);
  const [device, setDevice] = useState<DeviceSize>("desktop");
  const previewUrl = `/api/codex/${sessionId}/preview`;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setKey(k => k + 1)} title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => window.open(previewUrl, "_blank")} title="Open in new tab">
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
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
      <div className="flex-1 bg-white dark:bg-gray-900 overflow-auto">
        <div className={cn("h-full transition-all duration-300", DEVICE_SIZES[device])}>
          <iframe
            key={key}
            src={previewUrl}
            className="w-full h-full border-0"
            title="Project Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      </div>
    </div>
  );
}
