import { useEffect, useRef, useState } from "react";
import { Download, Loader2, FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface OfficeArtifactProps {
  /** Title for the toolbar (e.g. "report.edited.docx"). */
  title: string;
  /** URL the binary preview can be fetched from (server endpoint). */
  previewUrl: string;
  /** URL the user can download the final exported file from. */
  downloadUrl: string;
  /** MIME type — currently always DOCX. */
  mimeType: string;
}

/**
 * In-browser DOCX preview using `docx-preview`.
 *
 * The server returns the raw binary; we render it client-side via
 * `docx-preview.renderAsync(buffer, container)`. No server-side LibreOffice
 * required. The download button hits the exported artifact endpoint.
 */
export function OfficeArtifact({ title, previewUrl, downloadUrl, mimeType }: OfficeArtifactProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [byteSize, setByteSize] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = "";
    setStatus("loading");
    setErrorMessage(null);

    (async () => {
      try {
        const res = await fetch(previewUrl, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        setByteSize(buf.byteLength);
        const docxPreview = await import("docx-preview");
        await docxPreview.renderAsync(buf, container, undefined, {
          inWrapper: true,
          ignoreHeight: false,
          ignoreWidth: false,
          ignoreFonts: false,
          breakPages: true,
          experimental: false,
          useBase64URL: false,
        });
        if (!cancelled) setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [previewUrl]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/50">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="secondary" className="text-xs font-mono shrink-0">DOCX</Badge>
          <span className="text-sm truncate" title={title}>{title}</span>
          {byteSize !== null && (
            <span className="text-xs text-muted-foreground shrink-0">{(byteSize / 1024).toFixed(1)} KB</span>
          )}
        </div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
        >
          <a href={downloadUrl} download>
            <Download className="h-3.5 w-3.5" />
            Descargar
          </a>
        </Button>
      </div>

      <div className="flex-1 overflow-auto bg-background">
        {status === "loading" && (
          <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Cargando vista previa…</span>
          </div>
        )}
        {status === "error" && (
          <div className="flex items-center justify-center h-full text-destructive gap-2 px-6 text-center">
            <FileWarning className="h-5 w-5" />
            <span className="text-sm">No se pudo renderizar el documento: {errorMessage}</span>
          </div>
        )}
        <div ref={containerRef} className="p-4" data-mime={mimeType} />
      </div>
    </div>
  );
}
