import { useState, useEffect, Suspense, lazy } from "react";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Terminal,
  Code2,
  Download,
  Maximize2,
  X
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

const MonacoEditorLazy = lazy(() => import("@monaco-editor/react"));

interface CodeArtifact {
  id: string;
  type: string;
  name: string;
  data: string;
  mimeType: string;
}

interface CodeRun {
  id: string;
  code: string;
  language: string;
  status: string;
  stdout: string | null;
  stderr: string | null;
  executionTimeMs: number | null;
}

interface CodeExecutionBlockProps {
  code: string;
  language?: string;
  conversationId?: string;
  autoRun?: boolean;
  onExecuted?: (run: CodeRun, artifacts: CodeArtifact[]) => void;
}

function generateCodeDescription(code: string): string {
  const lines = code.toLowerCase();

  if (lines.includes('plt.bar') || lines.includes('bar(')) {
    return 'Generando gráfica de barras';
  }
  if (lines.includes('plt.plot') || lines.includes('.plot(')) {
    return 'Generando gráfica de líneas';
  }
  if (lines.includes('plt.pie') || lines.includes('pie(')) {
    return 'Generando gráfica circular';
  }
  if (lines.includes('plt.scatter') || lines.includes('scatter(')) {
    return 'Generando gráfica de dispersión';
  }
  if (lines.includes('plt.hist') || lines.includes('histogram')) {
    return 'Generando histograma';
  }
  if (lines.includes('matplotlib') || lines.includes('plt.')) {
    return 'Generando visualización';
  }
  if (lines.includes('pandas') || lines.includes('read_csv') || lines.includes('dataframe')) {
    return 'Procesando datos';
  }
  if (lines.includes('requests') || lines.includes('urllib') || lines.includes('fetch')) {
    return 'Realizando petición HTTP';
  }
  if (lines.includes('open(') && (lines.includes('write') || lines.includes('read'))) {
    return 'Procesando archivo';
  }
  if (lines.includes('def ') || lines.includes('class ')) {
    return 'Definiendo función/clase';
  }
  if (lines.includes('print(')) {
    return 'Ejecutando código Python';
  }

  return 'Código Python ejecutable';
}

export function CodeExecutionBlock({
  code,
  language = "python",
  conversationId,
  autoRun = true,
  onExecuted,
}: CodeExecutionBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [run, setRun] = useState<CodeRun | null>(null);
  const [artifacts, setArtifacts] = useState<CodeArtifact[]>([]);
  const [hasAutoRun, setHasAutoRun] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const { toast } = useToast();

  const description = generateCodeDescription(code);

  const [editableCode, setEditableCode] = useState(code);
  const [isDirty, setIsDirty] = useState(false);

  // Sync with prop updates unless user has edited
  useEffect(() => {
    if (!isDirty && code !== editableCode) {
      setEditableCode(code);
    }
  }, [code, isDirty, editableCode]);

  const handleDownloadImage = (dataUrl: string, filename: string) => {
    // ... existing implementation ...
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename || 'grafica.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "Imagen descargada" });
  };

  const handleCopyImage = async (dataUrl: string) => {
    try {
      // Convert base64 to blob
      const base64Data = dataUrl.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });

      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      setCopiedImage(true);
      toast({ title: "Imagen copiada al portapapeles" });
      setTimeout(() => setCopiedImage(false), 2000);
    } catch (error) {
      // Fallback: download the image instead
      console.error("Copy failed, using fallback:", error);
      handleDownloadImage(dataUrl, 'grafica.png');
      toast({ title: "Imagen descargada (el navegador no soporta copiar imágenes)" });
    }
  };

  // Auto-execute code on mount
  useEffect(() => {
    if (autoRun && !hasAutoRun && !isRunning && !run) {
      setHasAutoRun(true);
      executeCode();
    }
  }, [autoRun, hasAutoRun, isRunning, run]);

  const executeCode = async () => {
    if (isRunning) return;

    setIsRunning(true);
    setRun(null);
    setArtifacts([]);

    try {
      const response = await fetch("/api/code-interpreter/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Use editableCode for execution
        body: JSON.stringify({ code: editableCode, conversationId, language }),
      });

      if (!response.ok) {
        throw new Error("Error ejecutando código");
      }

      const result = await response.json();
      setRun(result.run);
      setArtifacts(result.artifacts || []);

      if (onExecuted) {
        onExecuted(result.run, result.artifacts || []);
      }
    } catch (error) {
      console.error("Code execution error:", error);
      setRun({
        id: "error",
        code,
        language,
        status: "error",
        stdout: null,
        stderr: "No se pudo ejecutar el código. El servidor no está disponible.",
        executionTimeMs: null,
      });
    } finally {
      setIsRunning(false);
    }
  };

  const handleCopyCode = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(code);
    setCopied(true);
    toast({
      title: "Código copiado",
      description: "El código ha sido copiado al portapapeles.",
    });
    setTimeout(() => setCopied(false), 2000);
  };


  const getStatusBadge = () => {
    if (isRunning) {
      return (
        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-xs">
          <Loader2 className="w-3 h-3 animate-spin" />
          Ejecutando...
        </span>
      );
    }
    if (run?.status === "success") {
      return (
        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-xs">
          <CheckCircle2 className="w-3 h-3" />
          Completado
          {run.executionTimeMs && (
            <span className="text-green-500/70">
              ({(run.executionTimeMs / 1000).toFixed(1)}s)
            </span>
          )}
        </span>
      );
    }
    if (run?.status === "error") {
      return (
        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs">
          <AlertCircle className="w-3 h-3" />
          Error
        </span>
      );
    }
    return null;
  };

  return (
    <div
      className="my-4 rounded-xl border border-border/50 overflow-hidden bg-gradient-to-b from-[#1a1a1a] to-[#141414] shadow-lg"
      data-testid="code-execution-block"
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#1e1e1e] hover:bg-[#252525] transition-colors cursor-pointer border-b border-border/30"
        aria-expanded={isExpanded}
        data-testid="toggle-code"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30">
            <Terminal className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex flex-col items-start">
            <span className="text-sm font-medium text-gray-200">
              {description}
            </span>
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <Code2 className="w-3 h-3" />
              {language} • {code.split('\n').length} líneas
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {getStatusBadge()}

          <div className="flex items-center gap-1 ml-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-gray-400 hover:text-white hover:bg-white/10"
              onClick={handleCopyCode}
              data-testid="copy-code"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </div>

          <div className="w-6 h-6 flex items-center justify-center text-gray-500">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="h-[400px] border-b border-border/30">
          <Suspense
            fallback={
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Cargando editor...
              </div>
            }
          >
            <MonacoEditorLazy
              height="100%"
              defaultLanguage={language}
              value={editableCode}
              theme="vs-dark"
              onChange={(value) => {
                setEditableCode(value || "");
                setIsDirty(true);
              }}
              options={{
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
                padding: { top: 16, bottom: 16 },
                lineNumbers: "on",
                renderLineHighlight: "none",
              }}
            />
          </Suspense>
        </div>
      )}

      {run && run.stdout && (
        <div className="border-t border-border/30">
          <div className="px-4 py-2 bg-[#1a1a1a] flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-xs text-gray-500 uppercase tracking-wide font-medium">
              Salida de consola
            </span>
          </div>
          <pre className="px-4 py-3 text-sm text-gray-300 font-mono whitespace-pre-wrap overflow-auto max-h-[200px] bg-black/20">
            {run.stdout}
          </pre>
        </div>
      )}

      {run && run.stderr && (
        <div className="border-t border-red-500/20">
          <div className="px-4 py-2 bg-red-950/30 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-red-400" />
            <span className="text-xs text-red-400 uppercase tracking-wide font-medium">
              Error
            </span>
          </div>
          <pre className="px-4 py-3 text-sm text-red-400 font-mono whitespace-pre-wrap overflow-auto max-h-[200px] bg-red-950/10">
            {run.stderr}
          </pre>
        </div>
      )}

      {artifacts.length > 0 && (
        <div className="border-t border-border/30 bg-white dark:bg-gray-900">
          {artifacts.map((artifact) => {
            const imageDataUrl = `data:${artifact.mimeType};base64,${artifact.data}`;
            return (
              <div key={artifact.id} data-testid={`artifact-${artifact.id}`}>
                {artifact.type === "image" && artifact.mimeType?.startsWith("image/") && (
                  <div className="p-4 flex justify-center">
                    <div className="relative group">
                      <img
                        src={imageDataUrl}
                        alt={artifact.name}
                        className="max-w-full h-auto rounded-lg shadow-md cursor-pointer"
                        style={{ maxHeight: "500px" }}
                        onClick={() => setFullscreenImage(imageDataUrl)}
                      />
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="secondary"
                          size="icon"
                          className="h-8 w-8 bg-black/60 hover:bg-black/80 text-white border-0"
                          onClick={(e) => { e.stopPropagation(); handleDownloadImage(imageDataUrl, artifact.name || 'grafica.png'); }}
                          data-testid="download-image"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="icon"
                          className="h-8 w-8 bg-black/60 hover:bg-black/80 text-white border-0"
                          onClick={(e) => { e.stopPropagation(); setFullscreenImage(imageDataUrl); }}
                          data-testid="fullscreen-image"
                        >
                          <Maximize2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="icon"
                          className="h-8 w-8 bg-black/60 hover:bg-black/80 text-white border-0"
                          onClick={(e) => { e.stopPropagation(); handleCopyImage(imageDataUrl); }}
                          data-testid="copy-image"
                        >
                          {copiedImage ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                {artifact.type === "file" && (
                  <div className="p-4">
                    <div className="flex items-center gap-2 p-3 bg-gray-100 rounded-lg">
                      <Code2 className="w-4 h-4 text-gray-600" />
                      <span className="text-sm text-gray-700">{artifact.name}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {fullscreenImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setFullscreenImage(null)}
        >
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 h-10 w-10 text-white hover:bg-white/20"
            onClick={() => setFullscreenImage(null)}
          >
            <X className="h-6 w-6" />
          </Button>
          <img
            src={fullscreenImage}
            alt="Imagen en pantalla completa"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
