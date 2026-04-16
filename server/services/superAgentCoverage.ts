import { ALL_TOOLS } from "../agent/langgraph/tools";
import { SUPER_AGENT_CAPABILITIES, type SuperAgentCapability } from "../data/superAgentCapabilities";
import { CAPABILITY_REQUIREMENTS, SECTION_REQUIREMENTS, type CapabilityRequirement } from "../data/superAgentRequirements";

export type CoverageStatus = "covered" | "partial" | "missing";

export type SuperAgentCoverageSource = "langgraph" | "runtime" | "combined";

export interface ToolMatch {
  name: string;
  description: string;
  score: number;
  matchedTokens: string[];
}

export interface CapabilityCoverage {
  capability: SuperAgentCapability;
  status: CoverageStatus;
  matches: ToolMatch[];
  requirements?: CapabilityRequirement;
  availability: CapabilityAvailability;
}

export interface CoverageSummary {
  total: number;
  covered: number;
  partial: number;
  missing: number;
  ready: number;
  blocked: number;
}

export interface SuperAgentCoverageReport {
  source: SuperAgentCoverageSource;
  toolCount: number;
  summary: CoverageSummary;
  capabilities: CapabilityCoverage[];
  warnings?: string[];
}

export interface CapabilityAvailability {
  osSupported: boolean;
  envSatisfied: boolean;
  missingEnv: string[];
  ready: boolean;
  notes?: string;
}

const STOPWORDS = new Set([
  "de", "y", "la", "el", "los", "las", "un", "una", "unos", "unas", "para", "por", "en", "con", "sin", "sobre", "entre", "al", "del",
  "a", "o", "u", "e", "que", "su", "sus", "se", "es", "como", "mas", "menos", "muy", "ya", "no",
  "and", "or", "the", "a", "an", "to", "for", "with", "without", "on", "in", "of", "by", "from",
  "etc",
  "cualquier", "cualquiera",
  "nuevo", "nuevos", "antiguo", "antiguos",
  "profesional", "profesionales",
  "importante", "importantes",
  "curso", "estado",
]);

const EXPANSIONS: Record<string, string[]> = {
  // Core verbs (ES -> EN)
  ejecutar: ["execute", "run", "shell", "command", "script"],
  comandos: ["command", "commands", "cli", "terminal"],
  instalar: ["install", "setup", "package"],
  desinstalar: ["uninstall", "remove"],
  monitorear: ["monitor", "monitoring", "metrics"],
  matar: ["kill", "terminate", "stop"],
  procesos: ["process", "processes", "pid"],
  programar: ["schedule", "scheduled", "cron"],
  tareas: ["task", "tasks", "job", "jobs", "scheduler"],
  gestionar: ["manage", "administration", "admin"],
  servicio: ["service", "daemon", "systemd"],
  servicios: ["service", "services", "daemon", "systemd"],
  usuarios: ["users", "accounts"],
  usuario: ["user", "account"],
  variables: ["env", "environment"],
  entorno: ["environment", "env"],
  backup: ["respaldo", "copia", "restaurar", "snapshot", "restore"],
  backups: ["backup", "respaldo", "copia", "restaurar", "snapshot", "restore"],
  arrancar: ["startup", "boot", "launch"],
  leer: ["read", "fetch", "get"],
  abrir: ["open", "launch"],
  navegar: ["navigate", "browse"],
  crear: ["create", "generate", "build"],
  convertir: ["convert", "transform"],
  comprimir: ["compress", "zip"],
  descomprimir: ["unzip", "extract"],
  buscar: ["search", "find", "query"],
  llenar: ["fill", "autofill"],
  descargar: ["download"],
  reservar: ["book", "reserve", "booking"],
  renombrar: ["rename"],
  organizar: ["organize", "sort"],
  extraer: ["extract", "parse"],
  enviar: ["send", "dispatch", "deliver"],
  responder: ["reply", "respond"],
  resumir: ["summarize", "summary"],
  traducir: ["translate", "translation"],
  analizar: ["analyze", "analysis"],
  generar: ["generate", "create", "build"],
  limpiar: ["clean", "cleanup", "sanitize"],
  transformar: ["transform", "convert"],

  correo: ["email", "mail"],
  correos: ["email", "emails", "mail", "gmail", "inbox"],
  electronico: ["email"],
  bandeja: ["inbox", "mailbox"],
  entrada: ["inbox"],
  adjunto: ["attachment"],
  adjuntos: ["attachments", "attachment"],
  plantillas: ["templates", "template"],
  reglas: ["rules", "filters", "automation"],
  categoria: ["category", "label"],
  prioridad: ["priority"],
  resumen: ["summary", "digest"],
  diario: ["daily"],
  spam: ["spam", "junk"],
  email: ["correo"],
  whatsapp: ["mensajeria", "mensaje", "chat"],
  mensajeria: ["whatsapp", "mensaje"],
  calendario: ["calendar", "agenda", "schedule", "cron"],
  agenda: ["calendar", "calendario"],
  evento: ["event", "events", "calendar"],
  eventos: ["event", "events", "calendar"],
  reunion: ["meeting", "meetings", "call"],
  reuniones: ["meeting", "meetings", "call"],
  recordatorio: ["reminder", "reminders", "notification", "alert"],
  recordatorios: ["reminder", "reminders", "notification", "alert"],
  horarios: ["time", "times", "schedule", "availability"],
  horario: ["time", "schedule", "availability"],
  enfoque: ["focus", "deepwork"],
  bloquear: ["block", "reserve", "hold"],
  conflicto: ["conflict", "overlap"],
  conflictos: ["conflict", "overlap"],
  sistema: ["system", "os", "operating", "linux", "macos", "windows"],
  equipo: ["computer", "device", "machine", "system"],
  archivos: ["file", "files", "document"],
  archivo: ["file", "document"],
  documento: ["document", "doc", "docx"],
  documentos: ["documents", "document", "doc", "docx"],
  articulos: ["article", "articles"],
  articulo: ["article", "articles"],
  word: ["docx", "documento"],
  excel: ["xlsx", "spreadsheet", "hoja"],
  powerpoint: ["pptx", "presentacion", "slides"],
  presentacion: ["pptx", "slides", "powerpoint"],
  ocr: ["tesseract", "imagen", "texto"],
  imagen: ["image", "ocr", "vision"],
  imagenes: ["images", "image", "ocr", "vision"],
  respaldo: ["backup", "restaurar"],
  seguridad: ["security", "audit", "compliance"],
  monitor: ["monitoring", "metrics", "alert"],
  monitoreo: ["monitoring", "metrics", "alert"],
  web: ["browser", "navigate", "scrape"],
  navegador: ["browser", "web"],
  sitio: ["site", "website", "url"],
  pagina: ["page", "website"],
  paginas: ["pages", "page", "website"],
  formularios: ["form", "forms"],
  formulario: ["form", "forms"],
  login: ["login", "auth", "authenticate", "oauth", "signin"],
  capturas: ["screenshot", "capture"],
  pantalla: ["screen", "screenshot"],
  scraping: ["scrape", "crawler", "extract"],
  cambios: ["changes", "diff", "monitor"],
  comparar: ["compare"],
  precios: ["prices", "price"],
  rastrear: ["track", "tracking"],
  envios: ["shipments", "tracking", "parcel"],
  paquetes: ["packages", "parcel"],
  vuelos: ["flight", "flights"],
  hoteles: ["hotel", "hotels"],
  codigo: ["code", "programacion", "dev"],
  programacion: ["code", "dev"],
  datos: ["data", "analytics", "analysis"],
  memoria: ["memory", "context", "history"],
  historial: ["history", "log", "timeline"],
  conversaciones: ["conversation", "chat", "messages"],
  proyectos: ["project", "projects"],
  contactos: ["contacts", "crm"],
  relaciones: ["relationships", "relations"],
  anticipar: ["anticipate", "predict", "forecast"],
  necesidades: ["needs", "requirements"],
  feedback: ["feedback"],
  conocimiento: ["knowledge", "kb", "wiki"],
  personal: ["personal", "user"],
  aprendizaje: ["learning", "feedback"],
  integraciones: ["integration", "api", "webhook"],
  base: ["database", "db", "sql"],

  // Research / citations
  investigacion: ["research", "investigation"],
  verificar: ["verify", "fact", "factcheck"],
  citas: ["citations", "references"],
  bibliografias: ["bibliography", "references"],
  referencias: ["references", "citations"],
  noticias: ["news"],
  tendencias: ["trends"],

  // Dev / data
  depurar: ["debug", "debugging"],
  bugs: ["bug", "issues"],
  apis: ["api", "rest", "graphql"],
  bases: ["database", "db", "schema", "sql"],
  estadistico: ["statistics", "stats"],
  graficos: ["charts", "plots", "visualization"],
  dashboards: ["dashboard", "dashboards"],
  anomalias: ["anomaly", "anomalies", "outlier"],
  predicciones: ["predict", "prediction", "forecast"],
  realtime: ["realtime", "streaming", "real-time"],
};

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function tokenizeBase(value: string): string[] {
  if (!value) return [];
  const raw = stripAccents(value.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

  const tokens: string[] = [];
  for (const token of raw) {
    if (STOPWORDS.has(token)) continue;
    if (token.length <= 2 && !["ai", "ml", "ocr", "sql", "api", "os", "db"].includes(token)) {
      continue;
    }
    tokens.push(token);
  }

  return Array.from(new Set(tokens));
}

function tokenizeWithExpansions(value: string): string[] {
  const base = tokenizeBase(value);
  const out: string[] = [];
  for (const token of base) {
    out.push(token);
    const expansion = EXPANSIONS[token];
    if (expansion) {
      for (const extra of expansion) {
        // allow multi-word expansions, but tokenize them to keep parity
        for (const t of tokenizeBase(extra)) out.push(t);
      }
    }
  }
  return Array.from(new Set(out));
}

type ToolLike = { name: string; description: string };

function getToolText(tool: any): { name: string; description: string } {
  const name = tool?.name ?? tool?.lc_kwargs?.name ?? "";
  const description = tool?.description ?? tool?.lc_kwargs?.description ?? "";
  return { name: String(name), description: String(description) };
}

function buildCapabilityTokenGroups(capability: SuperAgentCapability): string[][] {
  const baseTokens = new Set<string>([
    ...tokenizeBase(capability.title),
    ...tokenizeBase(capability.section),
    ...capability.tags.flatMap((t) => tokenizeBase(t)),
  ]);

  const groups: string[][] = [];
  for (const token of baseTokens) {
    const expanded = new Set<string>([token]);
    const extras = EXPANSIONS[token] ?? [];
    for (const extra of extras) {
      for (const t of tokenizeBase(extra)) expanded.add(t);
    }
    groups.push(Array.from(expanded));
  }
  return groups;
}

function scoreGroups(capGroups: string[][], toolTokens: Set<string>): { score: number; matched: string[] } {
  if (capGroups.length === 0 || toolTokens.size === 0) return { score: 0, matched: [] };
  let matchedGroups = 0;
  const matchedTokens: string[] = [];

  for (const group of capGroups) {
    let groupMatched = false;
    for (const token of group) {
      if (toolTokens.has(token)) {
        groupMatched = true;
        matchedTokens.push(token);
      }
    }
    if (groupMatched) matchedGroups += 1;
  }

  const score = matchedGroups / capGroups.length;
  return { score, matched: Array.from(new Set(matchedTokens)) };
}

function mergeRequirements(base?: CapabilityRequirement, override?: CapabilityRequirement): CapabilityRequirement | undefined {
  if (!base && !override) return undefined;
  const env = [...(base?.env ?? []), ...(override?.env ?? [])];
  const envAnyOf = [...(base?.envAnyOf ?? []), ...(override?.envAnyOf ?? [])];
  const os = override?.os ?? base?.os;
  const notes = [base?.notes, override?.notes].filter(Boolean).join(" / ");
  return {
    env: env.length ? Array.from(new Set(env)) : undefined,
    envAnyOf: envAnyOf.length ? envAnyOf : undefined,
    os,
    notes: notes || undefined,
  };
}

function isEnvSet(key: string): boolean {
  const value = process.env[key];
  return Boolean(value && value.trim().length > 0);
}

function evaluateAvailability(requirements?: CapabilityRequirement): CapabilityAvailability {
  const osSupported = !requirements?.os || requirements.os.includes(process.platform as any);

  const missingEnv = new Set<string>();
  let envSatisfied = true;

  if (requirements?.env && requirements.env.length > 0) {
    for (const key of requirements.env) {
      if (!isEnvSet(key)) {
        missingEnv.add(key);
        envSatisfied = false;
      }
    }
  }

  if (requirements?.envAnyOf && requirements.envAnyOf.length > 0) {
    const anySatisfied = requirements.envAnyOf.some(group =>
      group.every(key => isEnvSet(key))
    );
    if (!anySatisfied) {
      envSatisfied = false;
      for (const group of requirements.envAnyOf) {
        for (const key of group) {
          if (!isEnvSet(key)) missingEnv.add(key);
        }
      }
    }
  }

  const ready = osSupported && envSatisfied;

  return {
    osSupported,
    envSatisfied,
    missingEnv: Array.from(missingEnv),
    ready,
    notes: requirements?.notes,
  };
}

export function getSuperAgentCoverage(): { summary: CoverageSummary; capabilities: CapabilityCoverage[] } {
  const tools: ToolLike[] = ALL_TOOLS.map((tool) => getToolText(tool));
  return computeCoverage(tools);
}

export async function getSuperAgentCoverageReport(
  source: SuperAgentCoverageSource = "combined"
): Promise<SuperAgentCoverageReport> {
  const langgraphTools: ToolLike[] = ALL_TOOLS.map((tool) => getToolText(tool));

  if (source === "langgraph") {
    const { summary, capabilities } = computeCoverage(langgraphTools);
    return { source, toolCount: langgraphTools.length, summary, capabilities };
  }

  const warnings: string[] = [];

  // Runtime tool registry (actual executors) is optional and imported lazily to
  // avoid heavy side effects when only the catalog is needed.
  let runtimeTools: ToolLike[] | null = null;
  try {
    const { toolRegistry } = await import("../agent/toolRegistry");
    runtimeTools = toolRegistry.list().map((t) => ({ name: t.name, description: t.description }));
  } catch (e: any) {
    const msg = (e as any)?.message ? String((e as any).message) : String(e);
    warnings.push(`Runtime tool registry unavailable: ${msg}`);
  }

  if (source === "runtime") {
    if (!runtimeTools) {
      throw new Error(warnings[0] || "Runtime tool registry unavailable");
    }
    const { summary, capabilities } = computeCoverage(runtimeTools);
    return { source, toolCount: runtimeTools.length, summary, capabilities, warnings: warnings.length ? warnings : undefined };
  }

  if (!runtimeTools) {
    const { summary, capabilities } = computeCoverage(langgraphTools);
    return { source, toolCount: langgraphTools.length, summary, capabilities, warnings: warnings.length ? warnings : undefined };
  }

  // Combined: prefer runtime descriptions when names collide.
  const combined = new Map<string, ToolLike>();
  for (const t of langgraphTools) combined.set(t.name, t);
  for (const t of runtimeTools) {
    const prev = combined.get(t.name);
    if (!prev) combined.set(t.name, t);
    else combined.set(t.name, t.description.length >= prev.description.length ? t : prev);
  }

  const merged = Array.from(combined.values());
  const { summary, capabilities } = computeCoverage(merged);
  return { source, toolCount: merged.length, summary, capabilities, warnings: warnings.length ? warnings : undefined };
}

function computeCoverage(toolsInput: ToolLike[]): { summary: CoverageSummary; capabilities: CapabilityCoverage[] } {
  const tools = toolsInput.map((tool) => {
    const name = tool.name ?? "";
    const description = tool.description ?? "";
    const tokens = new Set([...tokenizeWithExpansions(name), ...tokenizeWithExpansions(description)]);
    return { name, description, tokens };
  });

  const capabilities: CapabilityCoverage[] = SUPER_AGENT_CAPABILITIES.map((capability) => {
    const capGroups = buildCapabilityTokenGroups(capability);
    const requirements = mergeRequirements(
      SECTION_REQUIREMENTS[capability.section],
      CAPABILITY_REQUIREMENTS[capability.id]
    );
    const availability = evaluateAvailability(requirements);

    const matches: ToolMatch[] = tools
      .map((tool) => {
        const { score, matched } = scoreGroups(capGroups, tool.tokens);
        return {
          name: tool.name,
          description: tool.description,
          score,
          matchedTokens: matched,
        };
      })
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const topScore = matches[0]?.score ?? 0;
    let status: CoverageStatus = "missing";
    if (topScore >= 0.45) {
      status = "covered";
    } else if (topScore >= 0.25) {
      status = "partial";
    }

    return {
      capability,
      status,
      matches,
      requirements,
      availability,
    };
  });

  const summary: CoverageSummary = {
    total: capabilities.length,
    covered: capabilities.filter((c) => c.status === "covered").length,
    partial: capabilities.filter((c) => c.status === "partial").length,
    missing: capabilities.filter((c) => c.status === "missing").length,
    ready: capabilities.filter((c) => c.availability.ready).length,
    blocked: capabilities.filter((c) => !c.availability.ready).length,
  };

  return { summary, capabilities };
}
