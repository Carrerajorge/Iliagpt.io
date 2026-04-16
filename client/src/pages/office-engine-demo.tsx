/**
 * Office Engine — End-to-end demo page.
 *
 * Self-contained page that exercises the entire DOCX pipeline (POST a DOCX
 * with an objective → subscribe to SSE step events → render the live
 * OfficeStepsPanel → render the OfficeArtifact preview via docx-preview →
 * download the exported file).
 *
 * Lives at /office-engine-demo. No auth required (intended for local
 * verification). The chat integration is intentionally separate so we don't
 * touch the 7k-line chat-interface.tsx in this slice.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, Loader2, CheckCircle2, XCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OfficeStepsPanel } from "@/components/office/OfficeStepsPanel";
import { OfficeArtifact } from "@/components/artifacts/OfficeArtifact";
import { useOfficeEngineStore } from "@/stores/officeEngineStore";

const OFFICE_DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export default function OfficeEngineDemoPage() {
  const [file, setFile] = useState<File | null>(null);
  const [objective, setObjective] = useState<string>("reemplazar hola por adiós");
  const [runId, setRunId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [idempotent, setIdempotent] = useState(false);
  const run = useOfficeEngineStore((s) => (runId ? s.runs.get(runId) : undefined));
  const subscribe = useOfficeEngineStore((s) => s.subscribe);
  const seedSucceeded = useOfficeEngineStore((s) => s.seedSucceeded);

  // Subscribe to SSE the moment we have a runId — unless this run was an
  // idempotent cache hit, in which case we seed the store directly.
  useEffect(() => {
    if (!runId) return;
    if (idempotent) {
      seedSucceeded(runId, file?.name);
      return;
    }
    const unsub = subscribe(runId);
    return () => unsub();
  }, [runId, idempotent, subscribe, seedSucceeded, file?.name]);

  const handleFile = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const f = files[0];
    if (!f.name.toLowerCase().endsWith(".docx")) {
      setSubmitError("Sólo se aceptan archivos .docx en este slice.");
      return;
    }
    setFile(f);
    setSubmitError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!file) {
      setSubmitError("Adjunta un .docx primero.");
      return;
    }
    if (!objective.trim()) {
      setSubmitError("Escribe un objetivo (ej: 'reemplazar X por Y').");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setRunId(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("objective", objective);
      fd.append("docKind", "docx");
      const res = await fetch("/api/office-engine/runs", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        runId?: string;
        idempotent?: boolean;
        error?: string;
      };
      if (!data.runId) throw new Error(data.error ?? "El servidor no devolvió un runId");
      setIdempotent(!!data.idempotent);
      setRunId(data.runId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [file, objective]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      handleFile(e.dataTransfer.files);
    },
    [handleFile],
  );

  const stopDefault = useCallback((e: React.DragEvent<HTMLDivElement>) => e.preventDefault(), []);

  const previewUrl = useMemo(
    () => (runId && run?.status === "succeeded" ? `/api/office-engine/runs/${runId}/artifacts/preview` : null),
    [runId, run?.status],
  );
  const downloadUrl = useMemo(
    () => (runId ? `/api/office-engine/runs/${runId}/artifacts/exported` : null),
    [runId],
  );

  const exportedName = useMemo(() => {
    if (!file) return "documento.edited.docx";
    return file.name.replace(/\.docx$/i, "") + ".edited.docx";
  }, [file]);

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="office-engine-demo-root">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">Office Engine — Demo end-to-end</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sube un DOCX, escribe el objetivo de edición y observa el pipeline completo en vivo:
            unpack → parse → map → edit → validate → repack → round-trip diff → preview → export.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ── Form column ── */}
          <section className="border border-border rounded-lg p-4 bg-card">
            <h2 className="text-sm font-medium mb-3">1 · Adjuntar DOCX</h2>
            <div
              onDrop={handleDrop}
              onDragOver={stopDefault}
              onDragEnter={stopDefault}
              className="border-2 border-dashed border-border rounded-md p-6 text-center cursor-pointer hover:bg-muted/40 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              data-testid="office-engine-demo-dropzone"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => handleFile(e.target.files)}
                data-testid="office-engine-demo-file-input"
              />
              <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
              {file ? (
                <div className="text-sm">
                  <span className="font-medium">{file.name}</span>
                  <span className="text-muted-foreground ml-2">{(file.size / 1024).toFixed(1)} KB</span>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Arrastra un .docx aquí o haz click para seleccionar
                </div>
              )}
            </div>

            <h2 className="text-sm font-medium mt-4 mb-2">2 · Objetivo de edición</h2>
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              className="w-full min-h-[80px] rounded-md border border-border bg-background p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder='reemplazar "hola" por "adiós" — o "fill placeholder name=Luis date=2026-04-10" — o "create a document about ..."'
              data-testid="office-engine-demo-objective"
            />

            <div className="mt-4 flex items-center gap-3">
              <Button
                onClick={handleSubmit}
                disabled={submitting || !file}
                data-testid="office-engine-demo-run-button"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Enviando…
                  </>
                ) : (
                  <>Lanzar Office Engine</>
                )}
              </Button>
              {runId && (
                <span className="text-xs font-mono text-muted-foreground">
                  run_id={runId.slice(0, 8)}…
                </span>
              )}
            </div>

            {submitError && (
              <div className="mt-3 text-sm text-destructive flex items-start gap-2" data-testid="office-engine-demo-error">
                <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            {/* Steps panel below the form, on the same column */}
            <div className="mt-6 border-t border-border pt-4">
              <h2 className="text-sm font-medium mb-2">3 · Pipeline en vivo</h2>
              {runId ? (
                <OfficeStepsPanel runId={runId} />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Lanza un run para ver los pasos del pipeline.
                </p>
              )}
            </div>
          </section>

          {/* ── Preview column ── */}
          <section className="border border-border rounded-lg bg-card flex flex-col min-h-[600px]">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-medium">4 · Vista previa renderizada</h2>
              {run?.status === "succeeded" && downloadUrl && (
                <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 text-xs" data-testid="office-engine-demo-download">
                  <a href={downloadUrl} download={exportedName}>
                    <Download className="h-3.5 w-3.5" />
                    Descargar
                  </a>
                </Button>
              )}
            </div>
            <div className="flex-1 overflow-auto" data-testid="office-engine-demo-preview-area">
              {!runId && (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  Esperando un run…
                </div>
              )}
              {runId && run?.status === "running" && (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Procesando documento…
                </div>
              )}
              {runId && run?.status === "succeeded" && previewUrl && downloadUrl && (
                <div className="h-full" data-testid="office-engine-demo-preview-rendered">
                  <OfficeArtifact
                    title={exportedName}
                    previewUrl={previewUrl}
                    downloadUrl={downloadUrl}
                    mimeType={OFFICE_DOCX_MIME}
                  />
                </div>
              )}
              {runId && run?.status === "failed" && (
                <div className="h-full flex items-center justify-center text-sm text-destructive gap-2 px-6 text-center">
                  <XCircle className="h-5 w-5" />
                  El run falló: {run.error ?? "ver logs del servidor"}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Status badge for testing */}
        <div className="mt-4 text-xs text-muted-foreground" data-testid="office-engine-demo-status">
          {!runId && "estado: esperando"}
          {runId && run && run.status === "running" && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> running
            </span>
          )}
          {runId && run && run.status === "succeeded" && (
            <span className="inline-flex items-center gap-1 text-green-600">
              <CheckCircle2 className="h-3 w-3" /> succeeded
            </span>
          )}
          {runId && run && run.status === "failed" && (
            <span className="inline-flex items-center gap-1 text-destructive">
              <XCircle className="h-3 w-3" /> failed
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
