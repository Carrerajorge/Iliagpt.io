/**
 * Skill Auto-Dispatcher
 *
 * Central orchestrator that maps ANY user message to the correct skill handler
 * and ensures professional output is generated and delivered in the chat.
 *
 * Flow:
 * 1. Receives user message + intent result from intent engine
 * 2. Matches to one of 120+ skills using intent + keyword analysis
 * 3. Dispatches to the appropriate handler (document, data, code, integration, automation, media, search)
 * 4. Saves artifacts and returns result with download URLs
 * 5. Never throws - graceful fallback on any error
 */

import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import type { IntentResult } from "../../shared/schemas/intent";
import { handleDocument } from "./skillHandlers/documentHandler";
import { handleDataAnalysis } from "./skillHandlers/dataAnalysisHandler";
import { handleCodeExecution } from "./skillHandlers/codeExecutionHandler";
import { handleIntegration } from "./skillHandlers/integrationHandler";
import { handleAutomation } from "./skillHandlers/automationHandler";
import { handleMedia } from "./skillHandlers/mediaHandler";
import { handleSearch } from "./skillHandlers/searchHandler";
import { libraryService } from "./libraryService";

// ============================================================================
// Types
// ============================================================================

export interface SkillDispatchRequest {
  message: string;
  intentResult: IntentResult | null;
  userId: string;
  chatId: string;
  conversationId?: string | null;
  requestId?: string;
  assistantMessageId?: string | null;
  locale: string;
  attachments?: Array<{
    name?: string;
    mimeType?: string;
    storagePath?: string;
    fileId?: string;
  }>;
  /** Callback to emit agentic step events to the SSE stream. */
  onStep?: (step: { type: string; title: string; status: string; [key: string]: any }) => void;
}

export interface SkillArtifact {
  type: string;
  filename: string;
  buffer: Buffer;
  mimeType: string;
  size: number;
  downloadUrl?: string;
  metadata?: Record<string, unknown>;
  library?: { fileUuid: string; storageUrl: string };
}

export interface SkillDispatchResult {
  handled: boolean;
  skillId: string;
  skillName: string;
  category: string;
  artifacts: SkillArtifact[];
  textResponse: string;
  suggestions?: string[];
  error?: {
    code: string;
    message: string;
    fallbackText: string;
  };
  metrics?: {
    latencyMs: number;
    handlerUsed: string;
    cached: boolean;
  };
}

// ============================================================================
// Skill Keyword Map
// Maps skill IDs to keywords and their handler type
// ============================================================================

interface SkillMapping {
  keywords: string[];
  handler: "document" | "data_analysis" | "code_execution" | "integration" | "automation" | "media" | "search";
  name: string;
  category: string;
  outputFormat?: string;
  mediaType?: "image" | "video" | "audio";
  searchType?: "web" | "academic";
}

const SKILL_KEYWORD_MAP: Record<string, SkillMapping> = {
  // === DOCUMENTS ===
  excel: {
    keywords: ["excel", "xlsx", "spreadsheet", "hoja de calculo", "hoja de cálculo", "tabla de datos", "planilla", "crear excel", "generar excel", "hacer tabla"],
    handler: "document", name: "Excel", category: "documents", outputFormat: "xlsx",
  },
  word: {
    keywords: ["word", "docx", "documento", "informe", "reporte", "carta", "ensayo", "manual", "guia", "redactar", "crear documento"],
    handler: "document", name: "Word", category: "documents", outputFormat: "docx",
  },
  powerpoint: {
    keywords: ["ppt", "pptx", "powerpoint", "presentacion", "presentación", "diapositivas", "slides", "slide deck"],
    handler: "document", name: "PowerPoint", category: "documents", outputFormat: "pptx",
  },
  pdf: {
    keywords: ["pdf", "extraer pdf", "convertir pdf", "llenar formulario pdf", "documento pdf"],
    handler: "document", name: "PDF", category: "documents", outputFormat: "pdf",
  },
  csv: {
    keywords: ["csv", "comma separated", "exportar csv", "datos csv", "archivo csv"],
    handler: "document", name: "CSV", category: "documents", outputFormat: "csv",
  },

  // === DATA & ANALYSIS ===
  analyze_spreadsheet: {
    keywords: ["analizar datos", "análisis de datos", "estadísticas", "estadisticas", "visualización", "visualizacion", "dashboard", "métricas", "tendencias", "correlación", "pivot", "kpi", "indicadores"],
    handler: "data_analysis", name: "Análisis de Datos", category: "data",
  },
  formula_engine: {
    keywords: ["formula", "fórmula", "cálculo", "calculo", "financiero", "científico", "tasa de interés", "amortización", "roi", "vpn", "tir"],
    handler: "data_analysis", name: "Motor de Fórmulas", category: "data",
  },

  // === CODE EXECUTION ===
  code_execution: {
    keywords: ["ejecutar código", "ejecutar codigo", "python", "javascript", "script", "programar", "algoritmo", "código python", "código javascript"],
    handler: "code_execution", name: "Ejecución de Código", category: "automation",
  },

  // === WEB SEARCH ===
  web_search: {
    keywords: ["buscar en internet", "buscar online", "google", "investigar en web", "buscar información", "search web"],
    handler: "search", name: "Búsqueda Web", category: "data", searchType: "web",
  },
  academic_search: {
    keywords: ["buscar artículos", "google scholar", "scopus", "pubmed", "artículos científicos", "papers", "artículos académicos", "scielo"],
    handler: "search", name: "Búsqueda Académica", category: "data", searchType: "academic",
  },

  // === MEDIA ===
  generate_image: {
    keywords: ["generar imagen", "crear imagen", "dibujar", "ilustrar", "diseñar logo", "generate image", "dall-e", "midjourney", "foto"],
    handler: "media", name: "Generador de Imágenes", category: "custom", mediaType: "image",
  },
  generate_video: {
    keywords: ["generar video", "crear video", "video ai", "animación", "clip de video"],
    handler: "media", name: "Generador de Video", category: "custom", mediaType: "video",
  },
  tts: {
    keywords: ["text to speech", "tts", "generar voz", "sintetizar voz", "leer en voz alta", "audio de voz", "elevenlabs"],
    handler: "media", name: "Síntesis de Voz", category: "custom", mediaType: "audio",
  },

  // === INTEGRATIONS ===
  gmail: { keywords: ["gmail", "correo", "email", "enviar correo", "leer correos", "bandeja de entrada"], handler: "integration", name: "Gmail", category: "integrations" },
  whatsapp: { keywords: ["whatsapp", "wsp", "enviar whatsapp", "mensaje de whatsapp"], handler: "integration", name: "WhatsApp", category: "integrations" },
  slack: { keywords: ["slack", "canal de slack", "mensaje slack", "slack channel"], handler: "integration", name: "Slack", category: "integrations" },
  discord: { keywords: ["discord", "servidor discord", "canal discord"], handler: "integration", name: "Discord", category: "integrations" },
  calendar: { keywords: ["calendario", "evento", "recordatorio", "cita", "agendar", "google calendar", "programar reunión"], handler: "integration", name: "Calendario y Tareas", category: "integrations" },
  notion: { keywords: ["notion", "base de datos notion", "página notion"], handler: "integration", name: "Notion", category: "integrations" },
  trello: { keywords: ["trello", "tablero trello", "tarjeta trello"], handler: "integration", name: "Trello", category: "integrations" },
  github: { keywords: ["github", "repositorio", "pull request", "issue github", "commit"], handler: "integration", name: "GitHub", category: "integrations" },
  gitlab: { keywords: ["gitlab", "merge request", "pipeline gitlab"], handler: "integration", name: "GitLab", category: "integrations" },
  jira: { keywords: ["jira", "ticket jira", "incidencia jira", "sprint"], handler: "integration", name: "Jira", category: "integrations" },
  linear: { keywords: ["linear", "ticket linear", "ciclo linear"], handler: "integration", name: "Linear", category: "integrations" },
  "1password": { keywords: ["1password", "contraseña", "bóveda", "secreto", "password manager"], handler: "integration", name: "1Password", category: "integrations" },
  "apple-notes": { keywords: ["apple notes", "notas apple", "notas icloud"], handler: "integration", name: "Apple Notes", category: "integrations" },
  "apple-reminders": { keywords: ["apple reminders", "recordatorios apple", "recordatorios iphone"], handler: "integration", name: "Apple Reminders", category: "integrations" },
  "bear-notes": { keywords: ["bear", "notas bear", "bear app"], handler: "integration", name: "Bear Notes", category: "integrations" },
  obsidian: { keywords: ["obsidian", "bóveda obsidian", "vault obsidian", "notas obsidian"], handler: "integration", name: "Obsidian", category: "integrations" },
  spotify: { keywords: ["spotify", "reproducir", "playlist", "canción", "música spotify"], handler: "integration", name: "Spotify", category: "integrations" },
  weather: { keywords: ["clima", "tiempo", "pronóstico", "temperatura", "weather", "lluvia"], handler: "integration", name: "Weather", category: "integrations" },
  zoom: { keywords: ["zoom", "reunión zoom", "sala zoom", "zoom meeting"], handler: "integration", name: "Zoom", category: "integrations" },
  "google-meet": { keywords: ["google meet", "meet", "videollamada google"], handler: "integration", name: "Google Meet", category: "integrations" },
  teams: { keywords: ["teams", "microsoft teams", "teams message"], handler: "integration", name: "MS Teams", category: "integrations" },
  stripe: { keywords: ["stripe", "pago", "suscripción", "factura stripe", "cobro"], handler: "integration", name: "Stripe", category: "integrations" },
  hubspot: { keywords: ["hubspot", "crm", "lead", "embudo de ventas", "contacto hubspot"], handler: "integration", name: "HubSpot CRM", category: "integrations" },
  salesforce: { keywords: ["salesforce", "soql", "registro salesforce", "oportunidad"], handler: "integration", name: "Salesforce", category: "integrations" },
  zendesk: { keywords: ["zendesk", "ticket soporte", "soporte al cliente", "zendesk ticket"], handler: "integration", name: "Zendesk", category: "integrations" },
  intercom: { keywords: ["intercom", "chat intercom", "intercom message"], handler: "integration", name: "Intercom", category: "integrations" },
  twilio: { keywords: ["twilio", "sms twilio", "enviar sms", "llamada twilio"], handler: "integration", name: "Twilio SMS", category: "integrations" },
  sendgrid: { keywords: ["sendgrid", "email transaccional", "plantilla sendgrid"], handler: "integration", name: "SendGrid", category: "integrations" },
  mailchimp: { keywords: ["mailchimp", "campaña email", "audiencia mailchimp", "newsletter"], handler: "integration", name: "Mailchimp", category: "integrations" },
  calendly: { keywords: ["calendly", "agendar cita", "disponibilidad calendly"], handler: "integration", name: "Calendly", category: "integrations" },
  typeform: { keywords: ["typeform", "formulario typeform", "encuesta typeform"], handler: "integration", name: "TypeForm", category: "integrations" },
  "survey-monkey": { keywords: ["survey monkey", "surveymonkey", "encuesta survey"], handler: "integration", name: "SurveyMonkey", category: "integrations" },
  "google-analytics": { keywords: ["google analytics", "ga4", "analytics", "tráfico web"], handler: "integration", name: "Google Analytics", category: "integrations" },
  mixpanel: { keywords: ["mixpanel", "eventos mixpanel", "funnel mixpanel"], handler: "integration", name: "Mixpanel", category: "integrations" },
  amplitude: { keywords: ["amplitude", "cohorte amplitude", "experimento ab"], handler: "integration", name: "Amplitude", category: "integrations" },
  firebase: { keywords: ["firebase", "firestore", "cloud functions", "firebase auth"], handler: "integration", name: "Firebase", category: "integrations" },
  supabase: { keywords: ["supabase", "supabase db", "edge functions", "supabase auth"], handler: "integration", name: "Supabase", category: "integrations" },
  sentry: { keywords: ["sentry", "error sentry", "excepción sentry", "sentry alert"], handler: "integration", name: "Sentry", category: "integrations" },
  datadog: { keywords: ["datadog", "métricas datadog", "apm datadog", "monitor datadog"], handler: "integration", name: "Datadog", category: "integrations" },
  pagerduty: { keywords: ["pagerduty", "incidente", "on-call", "guardia pagerduty"], handler: "integration", name: "PagerDuty", category: "integrations" },
  figma: { keywords: ["figma", "diseño figma", "tokens figma", "activos figma"], handler: "integration", name: "Figma", category: "integrations" },
  webex: { keywords: ["webex", "cisco webex", "llamada webex"], handler: "integration", name: "WebEx", category: "integrations" },
  summarize: { keywords: ["resumir", "resumen", "sintetizar", "condensar", "puntos clave", "tldr"], handler: "integration", name: "Summarize", category: "documents" },

  // === AUTOMATION / DEVOPS ===
  docker: { keywords: ["docker", "contenedor", "dockerfile", "docker compose", "docker-compose"], handler: "automation", name: "Docker", category: "automation" },
  kubernetes: { keywords: ["kubernetes", "k8s", "pod", "deployment", "kubectl", "helm"], handler: "automation", name: "Kubernetes", category: "automation" },
  terraform: { keywords: ["terraform", "infraestructura como código", "iac", "terraform plan", "terraform apply"], handler: "automation", name: "Terraform", category: "automation" },
  ansible: { keywords: ["ansible", "playbook", "ansible play", "provisioning"], handler: "automation", name: "Ansible", category: "automation" },
  aws: { keywords: ["aws", "amazon web services", "ec2", "s3", "lambda", "cloudformation"], handler: "automation", name: "AWS", category: "automation" },
  vercel: { keywords: ["vercel", "deploy vercel", "vercel deploy", "edge functions"], handler: "automation", name: "Vercel", category: "automation" },
  "ci-cd": { keywords: ["ci/cd", "pipeline ci", "github actions", "jenkins", "circleci"], handler: "automation", name: "CI/CD", category: "automation" },

  // === DATABASE ===
  postgres: { keywords: ["postgres", "postgresql", "consulta sql", "sql query"], handler: "automation", name: "PostgreSQL", category: "data" },
  mongodb: { keywords: ["mongodb", "mongo", "nosql", "aggregation pipeline"], handler: "automation", name: "MongoDB", category: "data" },
  redis: { keywords: ["redis", "caché", "pub/sub", "redis cli"], handler: "automation", name: "Redis", category: "data" },
  elasticsearch: { keywords: ["elasticsearch", "elastic", "lucene", "búsqueda full-text"], handler: "automation", name: "Elasticsearch", category: "data" },
  kafka: { keywords: ["kafka", "tópico kafka", "productor kafka", "consumer kafka"], handler: "automation", name: "Kafka", category: "data" },
  rabbitmq: { keywords: ["rabbitmq", "cola de mensajes", "amqp", "exchange rabbitmq"], handler: "automation", name: "RabbitMQ", category: "data" },

  // === SECURITY ===
  nmap: { keywords: ["nmap", "escaneo de red", "puertos abiertos", "scan nmap"], handler: "automation", name: "Nmap", category: "custom" },
  wireshark: { keywords: ["wireshark", "captura de paquetes", "pcap", "tráfico de red"], handler: "automation", name: "Wireshark", category: "custom" },
  burpsuite: { keywords: ["burpsuite", "burp suite", "pentesting", "fuzzing http"], handler: "automation", name: "BurpSuite", category: "custom" },

  // === MONITORING ===
  nagios: { keywords: ["nagios", "monitoreo nagios", "plugin nagios"], handler: "automation", name: "Nagios", category: "data" },
  splunk: { keywords: ["splunk", "spl query", "logs splunk"], handler: "automation", name: "Splunk", category: "data" },
  newrelic: { keywords: ["new relic", "newrelic", "apm newrelic"], handler: "automation", name: "New Relic", category: "data" },
  grafana: { keywords: ["grafana", "dashboard grafana", "panel grafana"], handler: "automation", name: "Grafana", category: "data" },
  prometheus: { keywords: ["prometheus", "promql", "alertmanager"], handler: "automation", name: "Prometheus", category: "data" },
};

// ============================================================================
// Intent -> Handler Mapping
// ============================================================================

const INTENT_TO_HANDLER: Record<string, { handler: string; outputFormat?: string; mediaType?: string; searchType?: string }> = {
  CREATE_DOCUMENT: { handler: "document", outputFormat: "docx" },
  CREATE_SPREADSHEET: { handler: "document", outputFormat: "xlsx" },
  CREATE_PRESENTATION: { handler: "document", outputFormat: "pptx" },
  SUMMARIZE: { handler: "integration" },
  TRANSLATE: { handler: "integration" },
  SEARCH_WEB: { handler: "search", searchType: "web" },
  ANALYZE_DOCUMENT: { handler: "data_analysis" },
  ANALYZE_DATA: { handler: "data_analysis" },
  EXECUTE_CODE: { handler: "code_execution" },
  MANAGE_EMAIL: { handler: "integration" },
  MANAGE_CALENDAR: { handler: "integration" },
  MANAGE_TASKS: { handler: "integration" },
  SEND_MESSAGE: { handler: "integration" },
  MANAGE_DATABASE: { handler: "automation" },
  AUTOMATE_WORKFLOW: { handler: "automation" },
  MANAGE_INFRASTRUCTURE: { handler: "automation" },
  SECURITY_AUDIT: { handler: "automation" },
  MEDIA_GENERATE: { handler: "media", mediaType: "image" },
  INTEGRATION_ACTION: { handler: "integration" },
};

// ============================================================================
// Artifact Storage (reused from productionHandler pattern)
// ============================================================================

const ARTIFACTS_DIR = path.join(process.cwd(), "artifacts");

function ensureArtifactsDir(): void {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }
}

async function saveSkillArtifact(
  artifact: { filename: string; buffer: Buffer; mimeType: string; size: number },
  runId: string,
  userId: string,
  chatId: string
): Promise<{ downloadUrl: string; library?: { fileUuid: string; storageUrl: string } }> {
  ensureArtifactsDir();

  const timestamp = Date.now();
  const safeFilename = artifact.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storedFilename = `${timestamp}_${safeFilename}`;
  const filePath = path.join(ARTIFACTS_DIR, storedFilename);

  await fs.promises.writeFile(filePath, artifact.buffer);
  const downloadUrl = `/api/artifacts/${storedFilename}`;

  console.log(`[SkillDispatcher] Saved artifact: ${artifact.filename} -> ${downloadUrl}`);

  let library: { fileUuid: string; storageUrl: string } | undefined;
  try {
    const contentType = artifact.mimeType || "application/octet-stream";
    const upload = await libraryService.generateUploadUrl(userId, storedFilename, contentType);
    await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: artifact.buffer,
    });
    const ext = path.extname(storedFilename).replace(/^\./, "");
    const type = ext === "xlsx" || ext === "csv" ? "spreadsheet"
      : ext === "pptx" ? "presentation"
      : ext === "docx" || ext === "pdf" ? "document"
      : "other";
    const saved = await libraryService.saveFileMetadata(userId, upload.objectPath, {
      name: storedFilename,
      originalName: artifact.filename,
      description: `Generated by skill dispatcher (run: ${runId})`,
      type,
      mimeType: contentType,
      extension: ext,
      size: artifact.size,
      metadata: { runId, chatId, source: "skillAutoDispatcher" },
    });
    library = { fileUuid: saved.uuid, storageUrl: saved.storageUrl };
  } catch (e: any) {
    console.warn("[SkillDispatcher] Library save failed:", e?.message || e);
  }

  return { downloadUrl, library };
}

// ============================================================================
// Matching Logic
// ============================================================================

function matchSkillFromMessage(message: string, intentResult: IntentResult | null): {
  skillId: string;
  mapping: SkillMapping;
  matchedVia: "intent" | "keyword";
  confidence: number;
} | null {
  const lowerMessage = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Priority 1: Intent-based matching (high confidence)
  if (intentResult && intentResult.confidence >= 0.4) {
    const intentMapping = INTENT_TO_HANDLER[intentResult.intent];
    if (intentMapping && intentMapping.handler !== "integration") {
      // Find best skill for this intent
      for (const [skillId, mapping] of Object.entries(SKILL_KEYWORD_MAP)) {
        if (mapping.handler === intentMapping.handler) {
          if (intentMapping.outputFormat && mapping.outputFormat === intentMapping.outputFormat) {
            return { skillId, mapping, matchedVia: "intent", confidence: intentResult.confidence };
          }
          if (intentMapping.mediaType && mapping.mediaType === intentMapping.mediaType) {
            return { skillId, mapping, matchedVia: "intent", confidence: intentResult.confidence };
          }
          if (intentMapping.searchType && mapping.searchType === intentMapping.searchType) {
            return { skillId, mapping, matchedVia: "intent", confidence: intentResult.confidence };
          }
        }
      }
      // Fallback: return first skill matching the handler
      for (const [skillId, mapping] of Object.entries(SKILL_KEYWORD_MAP)) {
        if (mapping.handler === intentMapping.handler) {
          return { skillId, mapping, matchedVia: "intent", confidence: intentResult.confidence };
        }
      }
    }
  }

  // Priority 2: Keyword-based matching
  let bestMatch: { skillId: string; mapping: SkillMapping; score: number } | null = null;

  for (const [skillId, mapping] of Object.entries(SKILL_KEYWORD_MAP)) {
    let score = 0;
    for (const keyword of mapping.keywords) {
      const normalizedKeyword = keyword.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (lowerMessage.includes(normalizedKeyword)) {
        // Longer keywords get higher scores (more specific)
        score += normalizedKeyword.split(/\s+/).length;
      }
    }
    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { skillId, mapping, score };
    }
  }

  if (bestMatch && bestMatch.score >= 1) {
    const confidence = Math.min(0.95, 0.5 + bestMatch.score * 0.1);
    return {
      skillId: bestMatch.skillId,
      mapping: bestMatch.mapping,
      matchedVia: "keyword",
      confidence,
    };
  }

  // Priority 3: Intent-based for integration actions
  if (intentResult && intentResult.confidence >= 0.4) {
    const intentMapping = INTENT_TO_HANDLER[intentResult.intent];
    if (intentMapping) {
      const fallbackSkillId = intentResult.intent.toLowerCase().replace(/_/g, "-");
      return {
        skillId: fallbackSkillId,
        mapping: {
          keywords: [],
          handler: intentMapping.handler as any,
          name: intentResult.intent,
          category: "integrations",
        },
        matchedVia: "intent",
        confidence: intentResult.confidence,
      };
    }
  }

  return null;
}

// ============================================================================
// Main Dispatcher
// ============================================================================

const SKILL_DISPATCH_TIMEOUT_MS = 45_000;

export async function dispatchSkill(request: SkillDispatchRequest): Promise<SkillDispatchResult> {
  const startMs = Date.now();
  const runId = uuidv4();

  // Default empty result
  const emptyResult: SkillDispatchResult = {
    handled: false,
    skillId: "",
    skillName: "",
    category: "",
    artifacts: [],
    textResponse: "",
  };

  try {
    // Skip for CHAT_GENERAL intents
    if (request.intentResult?.intent === "CHAT_GENERAL" || request.intentResult?.intent === "NEED_CLARIFICATION") {
      return emptyResult;
    }

    // Try to match a skill
    const match = matchSkillFromMessage(request.message, request.intentResult);
    if (!match) {
      return emptyResult;
    }

    console.log(`[SkillDispatcher] Matched skill: ${match.skillId} (${match.mapping.name}) via ${match.matchedVia} (confidence: ${match.confidence.toFixed(2)})`);

    // Emit step: analyzing user request
    const emitStep = request.onStep || (() => {});
    const stepId = () => `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    emitStep({ id: stepId(), type: "analyzing", title: "Analizando solicitud del usuario", status: "completed", expandable: false, timestamp: new Date().toISOString() });

    // Determine step type based on skill category
    const categoryStepMap: Record<string, { type: string; titleRunning: string; titleDone: string }> = {
      documents: { type: "generating", titleRunning: `Generando documento ${match.mapping.name}...`, titleDone: "Documento creado exitosamente" },
      data: { type: "generating", titleRunning: "Generando hoja de cálculo...", titleDone: "Hoja de cálculo creada" },
      presentations: { type: "generating", titleRunning: "Generando presentación...", titleDone: "Presentación creada" },
      code: { type: "executing", titleRunning: "Ejecutando código...", titleDone: "Ejecución completada" },
      search: { type: "searching", titleRunning: "Buscando información...", titleDone: "Búsqueda completada" },
      integrations: { type: "searching", titleRunning: "Conectando con servicio...", titleDone: "Integración completada" },
    };
    const stepInfo = categoryStepMap[match.mapping.category] || { type: "generating", titleRunning: `Ejecutando ${match.mapping.name}...`, titleDone: `${match.mapping.name} completado` };

    // Emit step: running
    const runningStepId = stepId();
    emitStep({ id: runningStepId, type: stepInfo.type, title: stepInfo.titleRunning, status: "running", expandable: false, timestamp: new Date().toISOString() });

    const handlerRequest = {
      message: request.message,
      userId: request.userId,
      chatId: request.chatId,
      locale: request.locale || "es",
      attachments: request.attachments,
    };

    // Execute with timeout
    let handlerResult: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Skill handler timeout after ${SKILL_DISPATCH_TIMEOUT_MS}ms`)), SKILL_DISPATCH_TIMEOUT_MS);
    });

    try {
      const executionPromise = executeHandler(match.mapping, match.skillId, handlerRequest);
      handlerResult = await Promise.race([executionPromise, timeoutPromise]);
    } catch (timeoutError: any) {
      console.warn(`[SkillDispatcher] Handler timeout for ${match.skillId}:`, timeoutError?.message);
      return {
        ...emptyResult,
        handled: true,
        skillId: match.skillId,
        skillName: match.mapping.name,
        category: match.mapping.category,
        textResponse: `La skill **${match.mapping.name}** tardó más de lo esperado. El resultado se está procesando. Intenta de nuevo en unos momentos.`,
        error: { code: "TIMEOUT", message: timeoutError?.message, fallbackText: "" },
      };
    }

    if (!handlerResult || !handlerResult.handled) {
      return emptyResult;
    }

    // Save artifacts and get download URLs
    const savedArtifacts: SkillArtifact[] = [];
    if (handlerResult.artifacts && handlerResult.artifacts.length > 0) {
      for (const artifact of handlerResult.artifacts) {
        if (!artifact.buffer || artifact.buffer.length === 0) continue;
        try {
          const stored = await saveSkillArtifact(
            artifact,
            runId,
            request.userId,
            request.chatId
          );
          savedArtifacts.push({
            ...artifact,
            downloadUrl: stored.downloadUrl,
            library: stored.library,
          });
        } catch (saveError: any) {
          console.warn(`[SkillDispatcher] Failed to save artifact ${artifact.filename}:`, saveError?.message);
        }
      }
    }

    const latencyMs = Date.now() - startMs;
    console.log(`[SkillDispatcher] Completed ${match.skillId} in ${latencyMs}ms with ${savedArtifacts.length} artifacts`);

    // Emit step: completed
    emitStep({ id: runningStepId, type: stepInfo.type, title: stepInfo.titleDone, status: "completed", duration: latencyMs, expandable: false, timestamp: new Date().toISOString() });
    emitStep({ id: stepId(), type: "completed", title: savedArtifacts.length > 0 ? `${savedArtifacts.length} archivo${savedArtifacts.length > 1 ? "s" : ""} generado${savedArtifacts.length > 1 ? "s" : ""}` : stepInfo.titleDone, status: "completed", expandable: false, timestamp: new Date().toISOString() });

    return {
      handled: true,
      skillId: handlerResult.skillId || match.skillId,
      skillName: handlerResult.skillName || match.mapping.name,
      category: handlerResult.category || match.mapping.category,
      artifacts: savedArtifacts,
      textResponse: handlerResult.textResponse || "",
      suggestions: handlerResult.suggestions,
      metrics: {
        latencyMs,
        handlerUsed: match.mapping.handler,
        cached: false,
      },
    };
  } catch (error: any) {
    console.warn("[SkillDispatcher] Unexpected error:", error?.message || error);
    return {
      ...emptyResult,
      error: {
        code: "DISPATCH_ERROR",
        message: error?.message || "Unknown error",
        fallbackText: "Hubo un error procesando tu solicitud. Continuando con el asistente.",
      },
    };
  }
}

// ============================================================================
// Handler Router
// ============================================================================

async function executeHandler(
  mapping: SkillMapping,
  skillId: string,
  request: { message: string; userId: string; chatId: string; locale: string; attachments?: any[] }
): Promise<any> {
  switch (mapping.handler) {
    case "document":
      return handleDocument(request, mapping.outputFormat || "docx");

    case "data_analysis":
      return handleDataAnalysis(request);

    case "code_execution":
      return handleCodeExecution(request);

    case "integration":
      return handleIntegration(skillId, request);

    case "automation":
      return handleAutomation(request, skillId);

    case "media":
      return handleMedia(request, mapping.mediaType || "image");

    case "search":
      return handleSearch(request, (mapping.searchType as "web" | "academic") || "web");

    default:
      console.warn(`[SkillDispatcher] Unknown handler: ${mapping.handler}`);
      return { handled: false, textResponse: "", artifacts: [] };
  }
}

// Export for use in chatAiRouter
export const skillAutoDispatcher = {
  dispatch: dispatchSkill,
  matchSkill: matchSkillFromMessage,
};
