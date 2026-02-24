import type { TraceEvent } from "./runStreamClient";

export interface NarrationMetrics {
  providers: string[];
  yearStart: number;
  yearEnd: number;
  target: number;
  currentProvider: string;
  queryIdx: number;
  queryTotal: number;
  page: number;
  foundInQuery: number;
  candidatesTotal: number;
  regions: string[];
  geoMismatch: number;
  yearOutOfRange: number;
  duplicate: number;
  lowRelevance: number;
  checked: number;
  verified: number;
  dead: number;
  accepted: number;
  columnsCount: number;
  rowsWritten: number;
  rowsTotal: number;
  filename: string;
  rejectedTotal: number;
  currentTool: string;
  retryIn: number;
  rateLimitedProvider: string;
}

export interface PhaseNarratorState {
  narration: string;
  phase: string;
  lastUpdated: number;
  metrics: NarrationMetrics;
}

const DEBOUNCE_MS = 2000;
const MAX_UPDATE_INTERVAL = 3000;

function createDefaultMetrics(): NarrationMetrics {
  return {
    providers: [],
    yearStart: 0,
    yearEnd: 0,
    target: 0,
    currentProvider: "",
    queryIdx: 0,
    queryTotal: 0,
    page: 0,
    foundInQuery: 0,
    candidatesTotal: 0,
    regions: [],
    geoMismatch: 0,
    yearOutOfRange: 0,
    duplicate: 0,
    lowRelevance: 0,
    checked: 0,
    verified: 0,
    dead: 0,
    accepted: 0,
    columnsCount: 0,
    rowsWritten: 0,
    rowsTotal: 0,
    filename: "",
    rejectedTotal: 0,
    currentTool: "",
    retryIn: 0,
    rateLimitedProvider: "",
  };
}

function generateNarration(phase: string, m: NarrationMetrics): string {
  switch (phase) {
    case "idle":
      return "⚡ Iniciando...";

    case "planning":
      if (m.target > 0) {
        return `🎯 Objetivo: ${m.target} artículos • ${m.yearStart}-${m.yearEnd}`;
      }
      return "🧠 Analizando estrategia...";

    case "signals":
    case "search":
      if (m.candidatesTotal > 0) {
        return `🔎 ${m.currentProvider}: ${m.candidatesTotal} encontrados`;
      }
      if (m.currentProvider) {
        return `📡 Conectando con ${m.currentProvider}...`;
      }
      return "🌍 Escaneando fuentes académicas...";

    case "filter":
      const discarded = m.geoMismatch + m.yearOutOfRange + m.duplicate + m.lowRelevance;
      if (discarded > 0) {
        return `🛡️ Filtrando calidad: ${discarded} descartados`;
      }
      return "⚖️ Aplicando filtros de relevancia...";

    case "verification":
    case "deep":
      if (m.verified > 0) {
        return `✅ Verificados: ${m.verified} artículos`;
      }
      return "🔬 Analizando DOIs y Enlaces...";

    case "enrichment":
      return `✨ Enriqueciendo metadatos (${m.accepted} aceptados)`;

    case "export":
    case "creating":
      if (m.filename) {
        return `💾 Generando ${m.filename}...`;
      }
      return "📊 Construyendo reporte...";

    case "finalization":
    case "completed":
      if (m.accepted > 0) {
        return `🚀 ¡Listo! ${m.accepted} artículos procesados`;
      }
      return "🏁 Investigación finalizada";

    case "rate_limited":
      return `⏳ Esperando (${m.retryIn}s) • ${m.rateLimitedProvider}`;

    case "retry":
      return `🔄 Reintentando operación...`;

    case "tool_executing":
      return `🛠️ Ejecutando herramienta...`;

    default:
      return "⚡ Procesando...";
  }
}

function extractMetricsFromEvent(
  event: TraceEvent,
  current: NarrationMetrics
): Partial<NarrationMetrics> {
  const updates: Partial<NarrationMetrics> = {};
  const evt = event as any;

  switch (event.event_type) {
    case "run_started":
      if (evt.evidence?.target) updates.target = evt.evidence.target;
      if (evt.target) updates.target = evt.target;
      break;

    case "plan_created":
      if (evt.evidence?.year_start) updates.yearStart = evt.evidence.year_start;
      if (evt.evidence?.year_end) updates.yearEnd = evt.evidence.year_end;
      if (evt.evidence?.target) updates.target = evt.evidence.target;
      if (evt.evidence?.regions) updates.regions = evt.evidence.regions;
      if (evt.evidence?.providers) updates.providers = evt.evidence.providers;
      break;

    case "search_progress":
    case "source_collected":
      if (evt.provider) updates.currentProvider = evt.provider;
      if (event.agent) {
        const a = event.agent.toLowerCase();
        if (a.includes("openalex")) updates.currentProvider = "OpenAlex";
        else if (a.includes("crossref")) updates.currentProvider = "CrossRef";
        else if (a.includes("semantic")) updates.currentProvider = "Semantic Scholar";
        else if (a.includes("scopus")) updates.currentProvider = "Scopus";
        else if (a.includes("wos")) updates.currentProvider = "Web of Science";
      }
      // Check both root level and metrics for these fields
      const queriesCurrent = evt.queries_current ?? event.metrics?.queries_current;
      const queriesTotal = evt.queries_total ?? event.metrics?.queries_total;
      const pagesSearched = evt.pages_searched ?? event.metrics?.pages_searched;
      const candidatesFound = evt.candidates_found ?? event.metrics?.candidates_found;
      const articlesCollected = evt.articles_collected ?? event.metrics?.articles_collected;

      if (queriesCurrent) updates.queryIdx = queriesCurrent;
      if (queriesTotal) updates.queryTotal = queriesTotal;
      if (pagesSearched) updates.page = pagesSearched;
      if (candidatesFound !== undefined) {
        updates.foundInQuery = Math.max(0, candidatesFound - (current.candidatesTotal || 0));
        updates.candidatesTotal = candidatesFound;
      }
      if (articlesCollected !== undefined) {
        updates.candidatesTotal = articlesCollected;
      }
      // Set default provider if not detected
      if (!updates.currentProvider && !current.currentProvider) {
        updates.currentProvider = "OpenAlex";
      }
      break;

    case "filter_progress":
      if (evt.metrics?.geo_mismatch) updates.geoMismatch = evt.metrics.geo_mismatch;
      if (evt.metrics?.year_out_of_range) updates.yearOutOfRange = evt.metrics.year_out_of_range;
      if (evt.metrics?.duplicate) updates.duplicate = evt.metrics.duplicate;
      if (evt.metrics?.low_relevance) updates.lowRelevance = evt.metrics.low_relevance;
      break;

    case "verify_progress":
    case "source_verified":
      if (event.metrics?.articles_verified !== undefined) {
        updates.verified = event.metrics.articles_verified;
      }
      if (evt.metrics?.checked) updates.checked = evt.metrics.checked;
      if (evt.metrics?.ok) updates.verified = evt.metrics.ok;
      if (evt.metrics?.dead) updates.dead = evt.metrics.dead;
      break;

    case "source_rejected":
      updates.dead = (current.dead || 0) + 1;
      updates.checked = (current.checked || 0) + 1;
      if (event.metrics?.reject_count) updates.rejectedTotal = event.metrics.reject_count;
      break;

    case "accepted_progress":
      if (event.metrics?.articles_accepted !== undefined) {
        updates.accepted = event.metrics.articles_accepted;
      }
      break;

    case "artifact_declared":
    case "artifact_generating":
      if (evt.filename) updates.filename = evt.filename;
      if (evt.artifact_type === "xlsx") updates.filename = evt.filename || "articles.xlsx";
      if (event.message) {
        const match = event.message.match(/([^/\\]+\.(xlsx|csv|pdf|docx))$/i);
        if (match) updates.filename = match[1];
      }
      break;

    case "export_progress":
      if (evt.metrics?.columns_count) updates.columnsCount = evt.metrics.columns_count;
      if (evt.metrics?.rows_written) updates.rowsWritten = evt.metrics.rows_written;
      if (evt.metrics?.rows_total) updates.rowsTotal = evt.metrics.rows_total;
      break;

    case "artifact":
      if (evt.name) updates.filename = evt.name;
      if (evt.type === "xlsx" && !updates.filename) updates.filename = "articles.xlsx";
      break;

    case "run_completed":
      if (evt.evidence?.final_url) {
        const match = evt.evidence.final_url.match(/([^/\\]+\.(xlsx|csv|pdf|docx))$/i);
        if (match) updates.filename = match[1];
      }
      if (event.metrics?.reject_count) updates.rejectedTotal = event.metrics.reject_count;
      if (event.metrics?.articles_accepted) updates.accepted = event.metrics.articles_accepted;
      break;

    case "tool_call":
      if (evt.tool) updates.currentTool = evt.tool;
      break;

    case "tool_result":
      updates.currentTool = "";
      break;

    case "retry_scheduled":
      if (evt.retry_in) updates.retryIn = evt.retry_in;
      if (evt.tool) updates.currentTool = evt.tool;
      break;

    case "rate_limited":
      if (evt.provider) updates.rateLimitedProvider = evt.provider;
      if (evt.retry_after) updates.retryIn = evt.retry_after;
      break;

    case "progress":
    case "progress_update":
      if (event.metrics?.candidates_found) updates.candidatesTotal = event.metrics.candidates_found;
      if (event.metrics?.articles_verified) updates.verified = event.metrics.articles_verified;
      if (event.metrics?.articles_accepted) updates.accepted = event.metrics.articles_accepted;
      if (evt.document_type === "xlsx" && evt.status === "generating") {
        updates.filename = "articles.xlsx";
      }
      if (evt.artifact_id) {
        updates.filename = updates.filename || "articles.xlsx";
      }
      break;

    case "phase_started":
    case "step_started":
      break;
  }

  return updates;
}

function mapPhaseFromEvent(event: TraceEvent, currentPhase: string): string {
  if (event.phase) return event.phase;

  switch (event.event_type) {
    case "run_started":
      return "planning";
    case "plan_created":
      return "planning";
    case "search_progress":
    case "source_collected":
      return "signals";
    case "filter_progress":
      return "filter";
    case "verify_progress":
    case "source_verified":
    case "source_rejected":
      return "verification";
    case "accepted_progress":
      return "enrichment";
    case "artifact_declared":
    case "artifact_generating":
    case "export_progress":
      return "export";
    case "artifact":
      return "export";
    case "run_completed":
      return "finalization";
    case "rate_limited":
      return "rate_limited";
    case "retry_scheduled":
      return "retry";
    case "tool_call":
      return "tool_executing";
    case "phase_started":
    case "step_started":
      return (event as any).phase || currentPhase;
    default:
      return currentPhase;
  }
}

export class PhaseNarrator {
  private state: PhaseNarratorState;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingNarration: string = "";
  private lastPhase: string = "idle";
  private onNarrationChange?: (narration: string) => void;

  constructor(onNarrationChange?: (narration: string) => void) {
    this.state = {
      narration: "Iniciando agente de búsqueda…",
      phase: "idle",
      lastUpdated: Date.now(),
      metrics: createDefaultMetrics(),
    };
    this.onNarrationChange = onNarrationChange;
  }

  processEvent(event: TraceEvent): string {
    const metricUpdates = extractMetricsFromEvent(event, this.state.metrics);
    this.state.metrics = { ...this.state.metrics, ...metricUpdates };

    const newPhase = mapPhaseFromEvent(event, this.state.phase);
    const phaseChanged = newPhase !== this.lastPhase;
    this.state.phase = newPhase;

    const newNarration = generateNarration(newPhase, this.state.metrics);

    if (phaseChanged) {
      this.emitImmediately(newNarration);
      this.lastPhase = newPhase;
    } else if (newNarration !== this.state.narration) {
      this.scheduleEmit(newNarration);
    }

    return this.state.narration;
  }

  private emitImmediately(narration: string): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.state.narration = narration;
    this.state.lastUpdated = Date.now();
    this.pendingNarration = "";
    this.onNarrationChange?.(narration);
  }

  private scheduleEmit(narration: string): void {
    this.pendingNarration = narration;

    if (this.debounceTimer) return;

    const timeSinceLastUpdate = Date.now() - this.state.lastUpdated;
    const delay = Math.min(DEBOUNCE_MS, MAX_UPDATE_INTERVAL - timeSinceLastUpdate);

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.pendingNarration && this.pendingNarration !== this.state.narration) {
        this.state.narration = this.pendingNarration;
        this.state.lastUpdated = Date.now();
        this.onNarrationChange?.(this.pendingNarration);
        this.pendingNarration = "";
      }
    }, Math.max(100, delay));
  }

  getCurrentNarration(): string {
    return this.state.narration;
  }

  getState(): PhaseNarratorState {
    return { ...this.state };
  }

  getMetrics(): NarrationMetrics {
    return { ...this.state.metrics };
  }

  reset(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.state = {
      narration: "Iniciando agente de búsqueda…",
      phase: "idle",
      lastUpdated: Date.now(),
      metrics: createDefaultMetrics(),
    };
    this.lastPhase = "idle";
    this.pendingNarration = "";
  }

  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
