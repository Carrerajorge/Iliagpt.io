import type { TraceEvent } from "./runStreamClient";

export interface NarrationMetrics {
  // Plan
  providers: string[];
  yearStart: number;
  yearEnd: number;
  target: number;

  // Search
  currentProvider: string;
  queryIdx: number;
  queryTotal: number;
  page: number;
  foundInQuery: number;
  candidatesTotal: number;

  // Filter
  regions: string[];
  geoMismatch: number;
  yearOutOfRange: number;
  duplicate: number;
  lowRelevance: number;

  // Verify
  checked: number;
  ok: number;
  dead: number;

  // Accept
  accepted: number;

  // Export
  columnsCount: number;
  rowsWritten: number;
  filename: string;

  // Complete
  rejectedTotal: number;
}

export interface NarrationState {
  currentNarration: string;
  phase: string;
  lastUpdated: number;
  metrics: NarrationMetrics;
}

const NARRATION_TEMPLATES = {
  planning: "Estoy preparando el plan: fuentes={providers}, años={yearStart}-{yearEnd}, objetivo={target} artículos.",
  search: "Buscando en {provider}: consulta {queryIdx}/{queryTotal}, página {page}; encontrados +{found} (total {candidatesTotal}).",
  filter: "Aplicando filtros: región={regions} y años={yearStart}-{yearEnd}; descartados: región {geoMismatch}, año {yearOutOfRange}, duplicados {duplicate}, baja relevancia {lowRelevance}.",
  verify: "Verificando enlaces/DOI: {checked} revisados, {ok} válidos, {dead} caídos.",
  accept: "Seleccionados {accepted}/{target}; sigo hasta completar el objetivo.",
  export: "Generando Excel con {columnsCount} columnas: fila {rowsWritten}/{target}…",
  complete: "Listo: exporté {filename} y reporte de descartes ({rejectedTotal} descartados)."
};

const PHASE_FALLBACKS: Record<string, string> = {
  planning: "Planificando búsqueda…",
  signals: "Buscando artículos…",
  verification: "Verificando enlaces…",
  enrichment: "Enriqueciendo metadatos…",
  export: "Generando archivo…",
  finalization: "Finalizando…"
};

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
    ok: 0,
    dead: 0,
    accepted: 0,
    columnsCount: 0,
    rowsWritten: 0,
    filename: "",
    rejectedTotal: 0,
  };
}

function createDefaultState(): NarrationState {
  return {
    currentNarration: "",
    phase: "idle",
    lastUpdated: 0,
    metrics: createDefaultMetrics(),
  };
}

function interpolateTemplate(template: string, values: Record<string, string | number | string[]>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = values[key];
    if (Array.isArray(value)) {
      return value.join(", ");
    }
    return String(value ?? "");
  });
}

function generateNarration(phase: string, metrics: NarrationMetrics): string {
  switch (phase) {
    case "planning":
      if (metrics.providers.length > 0 || metrics.target > 0) {
        const providers = metrics.providers.length > 0 ? metrics.providers.join(", ") : "OpenAlex, CrossRef, Semantic Scholar";
        return `Estoy preparando el plan: fuentes=${providers}, años=${metrics.yearStart || 2020}-${metrics.yearEnd || 2025}, objetivo=${metrics.target || 50} artículos.`;
      }
      return "Planificando búsqueda académica…";

    case "signals":
      // Always show something meaningful in search phase
      if (metrics.currentProvider) {
        return `Buscando en ${metrics.currentProvider}: consulta ${metrics.queryIdx || 1}/${metrics.queryTotal || "?"}, página ${metrics.page || 1}; encontrados +${metrics.foundInQuery || 0} (total ${metrics.candidatesTotal || 0}).`;
      }
      if (metrics.candidatesTotal > 0) {
        return `Buscando artículos: encontrados ${metrics.candidatesTotal} candidatos hasta ahora.`;
      }
      return "Buscando artículos en fuentes académicas…";

    case "verification":
      if (metrics.checked > 0 || metrics.ok > 0) {
        return `Verificando enlaces/DOI (HTTP 200 + coincidencia de título): ${metrics.checked} revisados, ${metrics.ok} válidos, ${metrics.dead} caídos.`;
      }
      return "Verificando enlaces y DOIs…";

    case "enrichment":
      if (metrics.accepted > 0) {
        return `Enriqueciendo metadatos: ${metrics.accepted} artículos aceptados.`;
      }
      return "Enriqueciendo metadatos de artículos…";

    case "export":
      if (metrics.rowsWritten > 0 || metrics.columnsCount > 0) {
        return `Generando Excel (.xlsx) con ${metrics.columnsCount || 15} columnas: escribiendo fila ${metrics.rowsWritten}/${metrics.target || "?"}…`;
      }
      if (metrics.filename) {
        return `Generando archivo ${metrics.filename}…`;
      }
      return "Generando archivo Excel…";

    case "finalization":
      if (metrics.filename) {
        return `Listo: exporté ${metrics.filename} y reporte de descartes (${metrics.rejectedTotal} descartados).`;
      }
      if (metrics.accepted > 0) {
        return `Finalizando: ${metrics.accepted} artículos exportados.`;
      }
      return "Finalizando exportación…";

    default:
      return PHASE_FALLBACKS[phase] || "Procesando solicitud…";
  }
}

function extractMetricsFromEvent(
  event: TraceEvent,
  currentMetrics: NarrationMetrics
): Partial<NarrationMetrics> {
  const updates: Partial<NarrationMetrics> = {};
  const anyEvent = event as any;

  switch (event.event_type) {
    case "run_started":
      if (event.evidence?.target !== undefined) {
        updates.target = event.evidence.target;
      }
      // Extract from message if available
      if (event.message) {
        const targetMatch = event.message.match(/objetivo[:\s]+(\d+)/i);
        if (targetMatch) updates.target = parseInt(targetMatch[1], 10);
      }
      break;

    case "plan_created":
      if (event.evidence?.year_start !== undefined) {
        updates.yearStart = event.evidence.year_start;
      }
      if (event.evidence?.year_end !== undefined) {
        updates.yearEnd = event.evidence.year_end;
      }
      if (event.evidence?.target !== undefined) {
        updates.target = event.evidence.target;
      }
      if (event.evidence?.regions) {
        updates.regions = event.evidence.regions;
      }
      break;

    case "search_progress":
      // Extract provider from agent name or message
      if (event.agent) {
        const agentLower = event.agent.toLowerCase();
        if (agentLower.includes("openalex")) updates.currentProvider = "OpenAlex";
        else if (agentLower.includes("crossref")) updates.currentProvider = "CrossRef";
        else if (agentLower.includes("semantic")) updates.currentProvider = "Semantic Scholar";
        else if (agentLower.includes("scopus")) updates.currentProvider = "Scopus";
        else if (agentLower.includes("wos")) updates.currentProvider = "Web of Science";
      }
      // Also check message for provider hints
      if (event.message) {
        const msgLower = event.message.toLowerCase();
        if (msgLower.includes("openalex")) updates.currentProvider = "OpenAlex";
        else if (msgLower.includes("crossref")) updates.currentProvider = "CrossRef";
        else if (msgLower.includes("semantic scholar")) updates.currentProvider = "Semantic Scholar";
      }
      // Extract from metrics or custom fields
      if (anyEvent.provider) updates.currentProvider = anyEvent.provider;
      if (event.metrics?.queries_current !== undefined) {
        updates.queryIdx = event.metrics.queries_current;
      }
      if (event.metrics?.queries_total !== undefined) {
        updates.queryTotal = event.metrics.queries_total;
      }
      if (event.metrics?.pages_searched !== undefined) {
        updates.page = event.metrics.pages_searched;
      }
      if (event.metrics?.candidates_found !== undefined) {
        const prevTotal = currentMetrics.candidatesTotal || 0;
        updates.foundInQuery = Math.max(0, event.metrics.candidates_found - prevTotal);
        updates.candidatesTotal = event.metrics.candidates_found;
      }
      break;

    case "filter_progress":
      if (event.metrics) {
        const m = event.metrics as Record<string, number | undefined>;
        if (m.geo_mismatch !== undefined) updates.geoMismatch = m.geo_mismatch;
        if (m.year_out_of_range !== undefined) updates.yearOutOfRange = m.year_out_of_range;
        if (m.duplicate !== undefined) updates.duplicate = m.duplicate;
        if (m.low_relevance !== undefined) updates.lowRelevance = m.low_relevance;
      }
      break;

    case "verify_progress":
      if (event.metrics) {
        const m = event.metrics as Record<string, number | undefined>;
        if (m.checked !== undefined) updates.checked = m.checked;
        if (m.ok !== undefined) updates.ok = m.ok;
        if (m.dead !== undefined) updates.dead = m.dead;
      }
      break;

    case "accepted_progress":
      if (event.metrics?.articles_accepted !== undefined) {
        updates.accepted = event.metrics.articles_accepted;
      }
      break;

    case "artifact_declared":
    case "artifact_generating":
      if (event.message) {
        const match = event.message.match(/([^/\\]+\.(xlsx|csv|pdf))$/i);
        if (match) {
          updates.filename = match[1];
        }
      }
      break;

    case "export_progress":
      if (event.metrics) {
        const m = event.metrics as Record<string, number | undefined>;
        if (m.columns_count !== undefined) updates.columnsCount = m.columns_count;
        if (m.rows_written !== undefined) updates.rowsWritten = m.rows_written;
      }
      break;

    case "run_completed":
      if (event.evidence?.final_url) {
        const match = event.evidence.final_url.match(/([^/\\]+\.(xlsx|csv|pdf))$/i);
        if (match) {
          updates.filename = match[1];
        }
      }
      if (event.metrics?.reject_count !== undefined) {
        updates.rejectedTotal = event.metrics.reject_count;
      }
      break;

    case "source_collected":
      // Extract provider from agent or message
      if (event.agent) {
        const agentLower = event.agent.toLowerCase();
        if (agentLower.includes("openalex")) updates.currentProvider = "OpenAlex";
        else if (agentLower.includes("crossref")) updates.currentProvider = "CrossRef";
        else if (agentLower.includes("semantic")) updates.currentProvider = "Semantic Scholar";
      }
      if (event.metrics?.candidates_found !== undefined) {
        updates.candidatesTotal = event.metrics.candidates_found;
      }
      if (event.metrics?.articles_collected !== undefined) {
        const prevTotal = currentMetrics.candidatesTotal || 0;
        updates.foundInQuery = Math.max(0, event.metrics.articles_collected - prevTotal);
        updates.candidatesTotal = event.metrics.articles_collected;
      }
      break;

    case "source_verified":
      if (event.metrics?.articles_verified !== undefined) {
        updates.ok = event.metrics.articles_verified;
        updates.checked = (currentMetrics.checked || 0) + 1;
      }
      break;

    case "source_rejected":
      if (event.metrics?.reject_count !== undefined) {
        updates.rejectedTotal = event.metrics.reject_count;
      }
      updates.dead = (currentMetrics.dead || 0) + 1;
      updates.checked = (currentMetrics.checked || 0) + 1;
      break;
    
    // Handle step_started events to get phase info
    case "step_started":
    case "phase_started":
      // These update phase through the phase field, not metrics
      break;

    // Handle generic progress events
    case "progress_update":
      if (event.metrics?.candidates_found !== undefined) {
        updates.candidatesTotal = event.metrics.candidates_found;
      }
      if (event.metrics?.articles_verified !== undefined) {
        updates.ok = event.metrics.articles_verified;
      }
      if (event.metrics?.articles_accepted !== undefined) {
        updates.accepted = event.metrics.articles_accepted;
      }
      break;
  }

  return updates;
}

export function processEventForNarration(
  event: TraceEvent,
  currentState: NarrationState
): NarrationState {
  const now = Date.now();
  const phaseChanged = event.phase && event.phase !== currentState.phase;
  const timeSinceLastUpdate = now - currentState.lastUpdated;
  const shouldUpdate = phaseChanged || timeSinceLastUpdate >= 1000;

  const metricUpdates = extractMetricsFromEvent(event, currentState.metrics);
  const newMetrics: NarrationMetrics = {
    ...currentState.metrics,
    ...metricUpdates,
  };

  const newPhase = event.phase || currentState.phase;

  if (!shouldUpdate) {
    return {
      ...currentState,
      phase: newPhase,
      metrics: newMetrics,
    };
  }

  const newNarration = generateNarration(newPhase, newMetrics);

  return {
    currentNarration: newNarration,
    phase: newPhase,
    lastUpdated: now,
    metrics: newMetrics,
  };
}

export class NarrationAgent {
  private state: NarrationState;
  private lastEmitTime: number = 0;
  private lastPhase: string = "";

  constructor(initialState?: Partial<NarrationState>) {
    this.state = {
      ...createDefaultState(),
      ...initialState,
      metrics: {
        ...createDefaultMetrics(),
        ...initialState?.metrics,
      },
    };
    this.lastPhase = this.state.phase;
  }

  processEvent(event: TraceEvent): NarrationState {
    const now = Date.now();
    const phaseChanged = event.phase !== undefined && event.phase !== this.lastPhase;
    const timeSinceLastEmit = now - this.lastEmitTime;
    const shouldEmit = phaseChanged || timeSinceLastEmit >= 1000;

    const metricUpdates = extractMetricsFromEvent(event, this.state.metrics);
    this.state.metrics = {
      ...this.state.metrics,
      ...metricUpdates,
    };

    if (event.phase) {
      this.state.phase = event.phase;
    }

    if (shouldEmit) {
      this.state.currentNarration = generateNarration(this.state.phase, this.state.metrics);
      this.state.lastUpdated = now;
      this.lastEmitTime = now;
      this.lastPhase = this.state.phase;
    }

    return { ...this.state };
  }

  getCurrentNarration(): string {
    return this.state.currentNarration;
  }

  getMetrics(): NarrationMetrics {
    return { ...this.state.metrics };
  }

  getState(): NarrationState {
    return { ...this.state };
  }

  reset(): void {
    this.state = createDefaultState();
    this.lastEmitTime = 0;
    this.lastPhase = "";
  }
}
