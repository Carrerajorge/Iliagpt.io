import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, FileWarning, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { downloadArtifact } from "@/lib/localArtifactAccess";

export type OfficeDocKind = "docx" | "xlsx" | "pptx" | "pdf";

interface OfficeArtifactProps {
  /** Title for the toolbar (e.g. "report.edited.docx"). */
  title: string;
  /** URL the binary preview can be fetched from (server endpoint). */
  previewUrl: string;
  /** URL the user can download the final exported file from. */
  downloadUrl: string;
  /** MIME type (drives the renderer selection). */
  mimeType: string;
  /** Document kind hint. If not given, inferred from the mime type. */
  docKind?: OfficeDocKind;
}

/**
 * In-browser preview for Office Engine artifacts.
 *
 *   DOCX → `docx-preview.renderAsync` (real OOXML rendering)
 *   XLSX → SheetJS-style rendering: exceljs-parsed rows → <table>
 *   PPTX → thumbnail + explicit "open external" fallback
 *   PDF  → native browser viewer via <iframe>
 *
 * Regardless of kind, the toolbar always exposes a Download button that uses
 * the app-wide `downloadArtifact` helper (which fetches as Blob + honors
 * Content-Disposition + creates an object URL + clicks an `<a download>`
 * element, with an `window.open` fallback).
 */
export function OfficeArtifact({ title, previewUrl, downloadUrl, mimeType, docKind }: OfficeArtifactProps) {
  const kind: OfficeDocKind = useMemo(() => {
    if (docKind) return docKind;
    if (mimeType.includes("wordprocessingml")) return "docx";
    if (mimeType.includes("spreadsheetml")) return "xlsx";
    if (mimeType.includes("presentationml")) return "pptx";
    if (mimeType.includes("pdf")) return "pdf";
    // Fallback by title extension
    if (title.toLowerCase().endsWith(".xlsx")) return "xlsx";
    if (title.toLowerCase().endsWith(".pptx")) return "pptx";
    if (title.toLowerCase().endsWith(".pdf")) return "pdf";
    return "docx";
  }, [docKind, mimeType, title]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [byteSize, setByteSize] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Incrementing this re-runs the render effect (Preview refresh button).
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    // Reset container on every refresh.
    container.innerHTML = "";
    setStatus("loading");
    setErrorMessage(null);

    if (kind === "pdf") {
      // PDF → let the browser render it natively. We still verify via fetch
      // that the server returned a valid artifact (surfaces 4xx/5xx errors).
      (async () => {
        try {
          const res = await fetch(previewUrl, { credentials: "include" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const size = parseInt(res.headers.get("content-length") ?? "0", 10);
          if (size > 0) setByteSize(size);
          if (cancelled) return;
          // Revoke any prior object URL to avoid leaking.
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const iframe = document.createElement("iframe");
          iframe.src = url;
          iframe.className = "w-full h-full border-0";
          iframe.title = title;
          container.appendChild(iframe);
          setStatus("ready");
        } catch (err) {
          if (!cancelled) {
            setErrorMessage(err instanceof Error ? err.message : String(err));
            setStatus("error");
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const res = await fetch(previewUrl, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        setByteSize(buf.byteLength);

        if (kind === "docx") {
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
          return;
        }

        if (kind === "xlsx") {
          const ExcelJS = (await import("exceljs")).default;
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buf);
          // Render every sheet as an <h3> + <table>.
          const frag = document.createDocumentFragment();
          wb.eachSheet((sheet) => {
            const h = document.createElement("h3");
            h.textContent = sheet.name;
            h.className = "text-sm font-semibold mt-4 mb-2";
            frag.appendChild(h);
            const table = document.createElement("table");
            table.className = "border-collapse text-xs";
            sheet.eachRow({ includeEmpty: false }, (row) => {
              const tr = document.createElement("tr");
              row.eachCell({ includeEmpty: true }, (cell) => {
                const td = document.createElement("td");
                td.className = "border border-border px-2 py-0.5";
                let value: string;
                const raw = cell.value;
                if (raw == null) value = "";
                else if (typeof raw === "object" && "result" in raw) value = String((raw as { result: unknown }).result ?? "");
                else if (typeof raw === "object" && "text" in raw) value = String((raw as { text: unknown }).text ?? "");
                else if (raw instanceof Date) value = raw.toISOString().slice(0, 10);
                else value = String(raw);
                td.textContent = value;
                tr.appendChild(td);
              });
              table.appendChild(tr);
            });
            frag.appendChild(table);
          });
          container.appendChild(frag);
          if (!cancelled) setStatus("ready");
          return;
        }

        if (kind === "pptx") {
          // Try PptxViewJS for real in-browser PPTX rendering
          try {
            const pptxMod = await import("pptxviewjs");
            const ViewerClass = pptxMod.PPTXViewer ?? (pptxMod.default as any)?.PPTXViewer;
            const viewer = new ViewerClass();
            await viewer.loadFile(buf);
            if (!cancelled) setStatus("ready");
          } catch (pptxErr) {
            console.warn("[OfficeArtifact] PptxViewJS failed, showing download fallback:", pptxErr);
            const wrapper = document.createElement("div");
            wrapper.className = "h-full flex flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground p-6";
            wrapper.innerHTML = `
              <div class="text-base font-medium text-foreground">Presentación lista</div>
              <div>${title}</div>
              <div>${(buf.byteLength / 1024).toFixed(1)} KB · PPTX</div>
              <div class="text-xs">Descarga el archivo para visualizarlo en PowerPoint o Google Slides.</div>
            `;
            container.appendChild(wrapper);
            if (!cancelled) setStatus("ready");
          }
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [previewUrl, kind, title, refreshKey]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadArtifact(downloadUrl, title);
    } catch (err) {
      // Fallback to opening in a new tab if the blob path fails.
      console.error("[OfficeArtifact] download failed, opening in new tab:", err);
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  };

  const kindLabel = kind.toUpperCase();
  return (
    <div className="flex flex-col h-full" data-testid="office-artifact-root" data-kind={kind}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/50">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="secondary" className="text-xs font-mono shrink-0">{kindLabel}</Badge>
          <span className="text-sm truncate" title={title}>{title}</span>
          {byteSize !== null && (
            <span className="text-xs text-muted-foreground shrink-0">{(byteSize / 1024).toFixed(1)} KB</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setRefreshKey((k) => k + 1)}
            data-testid="office-artifact-refresh"
            title="Refrescar preview"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Refrescar
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={handleDownload}
            disabled={downloading}
            data-testid="office-artifact-download"
          >
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Descargar
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-background" data-testid="office-artifact-canvas">
        {status === "loading" && (
          <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Cargando vista previa…</span>
          </div>
        )}
        {status === "error" && (
          <div className="flex items-center justify-center h-full text-destructive gap-2 px-6 text-center">
            <FileWarning className="h-5 w-5" />
            <span className="text-sm" data-testid="office-artifact-error">No se pudo renderizar el documento: {errorMessage}</span>
          </div>
        )}
        <div ref={containerRef} className="p-4 h-full" data-mime={mimeType} />
      </div>
    </div>
  );
}
