import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import { Virtuoso } from "react-virtuoso";
import {
  Activity,
  Download,
  FileText,
  Filter,
  RefreshCw,
  Search,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type GatewayLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

type GatewayLogEntry = {
  id: string;
  file: string;
  raw: string;
  time: string;
  level: GatewayLogLevel | "unknown";
  message: string;
  subsystem?: string;
};

type GatewayLogFile = {
  name: string;
  size: number;
  modifiedAt: string;
  isCurrent: boolean;
};

const LEVELS: GatewayLogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];

const LEVEL_CLASSES: Record<GatewayLogLevel | "unknown", string> = {
  trace: "bg-slate-100 text-slate-700 border-slate-200",
  debug: "bg-cyan-100 text-cyan-800 border-cyan-200",
  info: "bg-sky-100 text-sky-800 border-sky-200",
  warn: "bg-amber-100 text-amber-800 border-amber-200",
  error: "bg-rose-100 text-rose-800 border-rose-200",
  fatal: "bg-red-100 text-red-800 border-red-200",
  unknown: "bg-zinc-100 text-zinc-700 border-zinc-200",
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat("es-BO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function GatewayLogViewer() {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const [entries, setEntries] = useState<GatewayLogEntry[]>([]);
  const [files, setFiles] = useState<GatewayLogFile[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [selectedLevels, setSelectedLevels] = useState<Set<GatewayLogLevel>>(() => new Set(LEVELS));
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [autoFollow, setAutoFollow] = useState(true);
  const [connected, setConnected] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [activeFileName, setActiveFileName] = useState("");

  const allLevelsSelected = selectedLevels.size === LEVELS.length;
  const levelParam = useMemo(() => {
    if (allLevelsSelected) return "";
    return LEVELS.filter((level) => selectedLevels.has(level)).join(",");
  }, [allLevelsSelected, selectedLevels]);

  const selectedLevelCount = selectedLevels.size;
  const errorCount = useMemo(
    () => entries.filter((entry) => entry.level === "error" || entry.level === "fatal").length,
    [entries],
  );

  const fetchFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const response = await fetch("/api/admin/gateway-logs/files", { credentials: "include" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      const nextFiles: GatewayLogFile[] = Array.isArray(payload.files) ? payload.files : [];
      setFiles(nextFiles);
      setSelectedFile((current) => {
        if (current && nextFiles.some((file) => file.name === current)) {
          return current;
        }
        return nextFiles[0]?.name || "";
      });
    } catch (error) {
      console.error("[GatewayLogViewer] Failed to fetch files:", error);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    if (!selectedFile) return;

    const params = new URLSearchParams();
    params.set("file", selectedFile);
    params.set("limit", "400");
    if (levelParam) params.set("level", levelParam);
    if (deferredSearch.trim()) params.set("search", deferredSearch.trim());

    const source = new EventSource(`/api/admin/gateway-logs/stream?${params.toString()}`);

    const handleStatus = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data);
      setConnected(Boolean(payload.connected));
      setActiveFileName(String(payload.file || selectedFile));
      setStreamError(null);
    };

    const handleSnapshot = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data);
      const nextEntries = Array.isArray(payload.entries) ? payload.entries : [];
      setEntries(nextEntries);
      setActiveFileName(String(payload.file || selectedFile));
      setConnected(true);
      setStreamError(null);
    };

    const handleBatch = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data);
      const nextEntries = Array.isArray(payload.entries) ? payload.entries : [];
      setEntries((current) => {
        const merged = payload.reset ? nextEntries : [...current, ...nextEntries];
        return merged.slice(-5000);
      });
      setActiveFileName(String(payload.file || selectedFile));
      setConnected(true);
      setStreamError(null);
    };

    const handleError = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data);
      setStreamError(String(payload.message || "El stream de logs falló"));
      setConnected(false);
    };

    source.addEventListener("status", handleStatus as EventListener);
    source.addEventListener("snapshot", handleSnapshot as EventListener);
    source.addEventListener("batch", handleBatch as EventListener);
    source.addEventListener("error", handleError as EventListener);

    source.onerror = () => {
      setConnected(false);
    };

    return () => {
      source.close();
      setConnected(false);
    };
  }, [selectedFile, levelParam, deferredSearch]);

  useEffect(() => {
    if (!autoFollow || entries.length === 0) return;
    virtuosoRef.current?.scrollToIndex({
      index: entries.length - 1,
      align: "end",
      behavior: "auto",
    });
  }, [entries, autoFollow]);

  const toggleLevel = useCallback((level: GatewayLogLevel) => {
    setSelectedLevels((current) => {
      const next = new Set(current);
      if (next.has(level)) {
        if (next.size === 1) return current;
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }, []);

  const handleSelectAllLevels = useCallback(() => {
    setSelectedLevels(new Set(LEVELS));
  }, []);

  const handleExport = useCallback((format: "json" | "csv" = "json") => {
    const params = new URLSearchParams();
    if (selectedFile) params.set("file", selectedFile);
    if (levelParam) params.set("level", levelParam);
    if (deferredSearch.trim()) params.set("search", deferredSearch.trim());
    params.set("limit", "5000");
    params.set("format", format);
    window.open(`/api/admin/gateway-logs/export?${params.toString()}`, "_blank", "noopener,noreferrer");
  }, [selectedFile, levelParam, deferredSearch]);

  return (
    <div className="space-y-4">
      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Activity className="h-5 w-5 text-sky-600" />
                Gateway Logs
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Streaming SSE en vivo del gateway OpenClaw con filtros, archivo histórico y exportación.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn("gap-1.5", connected ? "border-emerald-200 text-emerald-700" : "border-zinc-200 text-zinc-600")}>
                {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                {connected ? "Live" : "Desconectado"}
              </Badge>
              <Badge variant="outline" className="border-slate-200 text-slate-700">
                {entries.length} líneas
              </Badge>
              <Badge variant="outline" className="border-rose-200 text-rose-700">
                {errorCount} errores/fatales
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 xl:grid-cols-[240px_minmax(0,1fr)_auto_auto]">
            <div className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Archivo
              </span>
              <Select value={selectedFile} onValueChange={setSelectedFile} disabled={loadingFiles || files.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingFiles ? "Cargando..." : "Selecciona log"} />
                </SelectTrigger>
                <SelectContent>
                  {files.map((file) => (
                    <SelectItem key={file.name} value={file.name}>
                      {file.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Buscar
              </span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Filtrar por texto, subsystem, mensaje o JSON"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="flex items-end gap-2">
              <Button variant="outline" onClick={() => void fetchFiles()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Recargar
              </Button>
              <Button variant="outline" onClick={() => handleExport("json")}>
                <Download className="mr-2 h-4 w-4" />
                Export JSON
              </Button>
            </div>

            <div className="flex items-end">
              <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
                <span className="text-sm text-slate-700">Auto-follow</span>
                <Switch checked={autoFollow} onCheckedChange={setAutoFollow} />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="mr-2 flex items-center gap-2 text-sm font-medium text-slate-700">
              <Filter className="h-4 w-4" />
              Niveles
            </div>
            {LEVELS.map((level) => {
              const active = selectedLevels.has(level);
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => toggleLevel(level)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide transition-colors",
                    active ? LEVEL_CLASSES[level] : "border-slate-200 text-slate-500 hover:border-slate-300",
                  )}
                >
                  {level}
                </button>
              );
            })}
            {!allLevelsSelected && (
              <Button variant="ghost" size="sm" onClick={handleSelectAllLevels}>
                Restaurar filtros
              </Button>
            )}
            <div className="ml-auto text-xs text-muted-foreground">
              {selectedLevelCount}/{LEVELS.length} activos
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" />
              {activeFileName || selectedFile || "Sin archivo"}
            </span>
            {files.find((file) => file.name === (activeFileName || selectedFile)) && (
              <span>
                {formatBytes(files.find((file) => file.name === (activeFileName || selectedFile))?.size || 0)}
              </span>
            )}
            {streamError && (
              <span className="text-rose-600">{streamError}</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-slate-200/80 shadow-sm">
        <CardContent className="p-0">
          <Virtuoso
            ref={virtuosoRef}
            style={{ height: 640 }}
            totalCount={entries.length}
            itemContent={(index) => {
              const entry = entries[index];
              return (
                <div className="border-b border-slate-100 px-4 py-3 font-mono text-sm">
                  <div className="flex flex-wrap items-start gap-2">
                    <span className="min-w-[152px] text-xs text-slate-500">
                      {formatTimestamp(entry.time)}
                    </span>
                    <Badge variant="outline" className={cn("uppercase", LEVEL_CLASSES[entry.level])}>
                      {entry.level}
                    </Badge>
                    {entry.subsystem && (
                      <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                        {entry.subsystem}
                      </Badge>
                    )}
                    <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-slate-900">
                      {entry.message}
                    </div>
                  </div>
                  {entry.raw !== entry.message && (
                    <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      {entry.raw}
                    </div>
                  )}
                </div>
              );
            }}
            components={{
              EmptyPlaceholder: () => (
                <div className="flex h-full items-center justify-center px-6 py-20 text-center text-sm text-muted-foreground">
                  No hay líneas que coincidan con los filtros actuales.
                </div>
              ),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default GatewayLogViewer;
