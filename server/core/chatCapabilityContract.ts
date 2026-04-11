export type ChatCapabilityStatus = "integrated" | "partial" | "gap";

export type ChatCapabilityDomainId =
  | "artifact_generation"
  | "local_file_management"
  | "data_science"
  | "synthesis_research"
  | "format_conversion"
  | "browser_automation"
  | "computer_use"
  | "scheduled_tasks"
  | "dispatch"
  | "connectors"
  | "plugins_customization"
  | "code_execution"
  | "subagents"
  | "project_workspaces"
  | "security_governance"
  | "enterprise"
  | "domain_packs"
  | "availability";

export type ChatCapabilityWorkflow =
  | "artifact_generation"
  | "skill_dispatch"
  | "agent_execution"
  | "conversation";

export type ChatCapabilityHandler =
  | "production_handler"
  | "skill_auto_dispatcher"
  | "model_stream";

export type ChatCapabilityRenderSurface =
  | "artifact_card"
  | "agent_steps"
  | "conversation_stream";

export interface ChatCapabilityDomain {
  domainId: ChatCapabilityDomainId;
  title: string;
  description: string;
  status: ChatCapabilityStatus;
}

export interface ChatCapabilityDefinition {
  capabilityId: string;
  domainId: ChatCapabilityDomainId;
  title: string;
  description: string;
  status: ChatCapabilityStatus;
  priority?: number;
  workflow: ChatCapabilityWorkflow;
  handler: ChatCapabilityHandler;
  renderSurface: ChatCapabilityRenderSurface;
  multiLlm: true;
  requiresApproval: boolean;
  matchers: RegExp[];
}

export interface ChatCapabilityMatch {
  capability: ChatCapabilityDefinition;
  score: number;
}

export const CHAT_CAPABILITY_DOMAINS: readonly ChatCapabilityDomain[] = [
  {
    domainId: "artifact_generation",
    title: "Generación de archivos",
    description: "Artefactos profesionales y salidas estructuradas desde el chat.",
    status: "integrated",
  },
  {
    domainId: "local_file_management",
    title: "Gestión de archivos locales",
    description: "Lectura, organización y escritura en carpetas autorizadas.",
    status: "partial",
  },
  {
    domainId: "data_science",
    title: "Análisis de datos y data science",
    description: "Análisis, forecasting, ML y visualización sobre datasets del usuario.",
    status: "partial",
  },
  {
    domainId: "synthesis_research",
    title: "Síntesis e investigación",
    description: "Síntesis multifuente, contradicciones, citas y web research.",
    status: "partial",
  },
  {
    domainId: "format_conversion",
    title: "Conversión entre formatos",
    description: "Transformaciones entre documentos, hojas, slides e inputs visuales.",
    status: "partial",
  },
  {
    domainId: "browser_automation",
    title: "Automatización de navegador",
    description: "Navegación, extracción, formularios y ejecución JS en páginas.",
    status: "partial",
  },
  {
    domainId: "computer_use",
    title: "Computer use",
    description: "Control de aplicaciones de escritorio con permisos explícitos.",
    status: "gap",
  },
  {
    domainId: "scheduled_tasks",
    title: "Tareas programadas",
    description: "Tareas recurrentes y on-demand persistidas por el chat.",
    status: "partial",
  },
  {
    domainId: "dispatch",
    title: "Dispatch móvil",
    description: "Envío de tareas desde móvil para ejecución en desktop.",
    status: "gap",
  },
  {
    domainId: "connectors",
    title: "Conectores e integraciones",
    description: "Operación sobre MCPs y conectores SaaS desde el chat.",
    status: "partial",
  },
  {
    domainId: "plugins_customization",
    title: "Plugins y personalización",
    description: "Marketplace, skills y configuración global o por proyecto.",
    status: "partial",
  },
  {
    domainId: "code_execution",
    title: "Ejecución de código",
    description: "Python y Node en entornos aislados con librerías comunes.",
    status: "partial",
  },
  {
    domainId: "subagents",
    title: "Sub-agentes",
    description: "Descomposición y coordinación de trabajo paralelo.",
    status: "partial",
  },
  {
    domainId: "project_workspaces",
    title: "Workspaces persistentes",
    description: "Proyecto, memoria, archivos e instrucciones persistentes.",
    status: "partial",
  },
  {
    domainId: "security_governance",
    title: "Seguridad y governance",
    description: "Permisos, aprobaciones, sandbox y controles de riesgo.",
    status: "partial",
  },
  {
    domainId: "enterprise",
    title: "Enterprise",
    description: "RBAC, analytics, OpenTelemetry y toggles por organización.",
    status: "partial",
  },
  {
    domainId: "domain_packs",
    title: "Casos por función",
    description: "Packs de workflows por legal, finanzas, marketing, ops, HR e investigación.",
    status: "partial",
  },
  {
    domainId: "availability",
    title: "Disponibilidad",
    description: "Cobertura por plataforma, plan y restricciones de tamaño/entrega.",
    status: "partial",
  },
] as const;

function rx(source: string): RegExp {
  return new RegExp(source, "i");
}

export const CHAT_CAPABILITY_DEFINITIONS: readonly ChatCapabilityDefinition[] = [
  {
    capabilityId: "artifact.xlsx.professional",
    domainId: "artifact_generation",
    title: "Excel profesional",
    description: "Modelos, dashboards, hojas múltiples, fórmulas y gráficos.",
    status: "integrated",
    priority: 140,
    workflow: "artifact_generation",
    handler: "production_handler",
    renderSurface: "artifact_card",
    multiLlm: true,
    requiresApproval: false,
    matchers: [
      rx("\\b(excel|xlsx|hoja de calculo|spreadsheet|dashboard de ventas|cohortes|funnel|margenes|inventario y demanda|modelo financiero)\\b"),
    ],
  },
  {
    capabilityId: "artifact.pptx.professional",
    domainId: "artifact_generation",
    title: "PowerPoint profesional",
    description: "Presentaciones, layouts, speaker notes y conversión a slides.",
    status: "integrated",
    priority: 140,
    workflow: "artifact_generation",
    handler: "production_handler",
    renderSurface: "artifact_card",
    multiLlm: true,
    requiresApproval: false,
    matchers: [
      rx("\\b(pptx?|powerpoint|presentacion|diapositivas|slides|deck para directorio|propuesta comercial)\\b"),
    ],
  },
  {
    capabilityId: "artifact.docx.professional",
    domainId: "artifact_generation",
    title: "Word profesional",
    description: "Reportes, memos, cartas, papers, headings y tablas.",
    status: "integrated",
    priority: 130,
    workflow: "artifact_generation",
    handler: "production_handler",
    renderSurface: "artifact_card",
    multiLlm: true,
    requiresApproval: false,
    matchers: [
      rx("\\b(word|docx|documento profesional|memo|carta|reporte|paper|informe)\\b"),
    ],
  },
  {
    capabilityId: "artifact.pdf.professional",
    domainId: "artifact_generation",
    title: "PDF profesional",
    description: "Crear PDF, formularios, merge/split y exportes ejecutivos.",
    status: "integrated",
    priority: 150,
    workflow: "artifact_generation",
    handler: "production_handler",
    renderSurface: "artifact_card",
    multiLlm: true,
    requiresApproval: false,
    matchers: [
      rx("\\b(pdf|reporte pdf|formulario pdf|merge pdf|split pdf|combina pdf|divide pdf)\\b"),
    ],
  },
  {
    capabilityId: "artifact.structured.outputs",
    domainId: "artifact_generation",
    title: "Otros formatos estructurados",
    description: "Markdown, HTML, React, LaTeX, CSV, TSV, JSON, PNG y código.",
    status: "partial",
    priority: 80,
    workflow: "artifact_generation",
    handler: "production_handler",
    renderSurface: "artifact_card",
    multiLlm: true,
    requiresApproval: false,
    matchers: [
      rx("\\b(markdown|html|react|jsx|tsx|latex|csv|tsv|json|png|matplotlib|archivo de codigo|archivo .py|archivo .js)\\b"),
    ],
  },
  {
    capabilityId: "files.local.management",
    domainId: "local_file_management",
    title: "Gestión de archivos locales",
    description: "Organizar, renombrar, clasificar y deduplicar carpetas autorizadas.",
    status: "partial",
    priority: 130,
    workflow: "agent_execution",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    multiLlm: true,
    requiresApproval: true,
    matchers: [
      rx("\\b(organiza mi carpeta|renombra archivos|deduplica archivos|clasifica archivos|crea subcarpetas|log de decisiones)\\b"),
    ],
  },
  {
    capabilityId: "data.analytics.science",
    domainId: "data_science",
    title: "Análisis de datos y ML",
    description: "Estadística, forecasting, ML, gráficos y tablas desde datos del usuario.",
    status: "partial",
    priority: 120,
    workflow: "agent_execution",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    multiLlm: true,
    requiresApproval: false,
    matchers: [
      rx("\\b(outliers|cross[- ]?tab|series temporales|forecast|forecasting|machine learning|modelo predictivo|anova|varianza|limpieza de datos|visualizacion de datos)\\b"),
    ],
  },
  {
    capabilityId: "research.synthesis.multisource",
    domainId: "synthesis_research",
    title: "Síntesis e investigación",
    description: "Reporte de síntesis, citas, contradicciones y research integrado.",
    status: "partial",
    priority: 110,
    workflow: "agent_execution",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    multiLlm: true,
    requiresApproval: false,
    matchers: [
      rx("\\b(sintesis|reporte de sintesis|contradicciones entre documentos|cita fuentes|resumen ejecutivo|investigacion web|estudio de mercado)\\b"),
    ],
  },
  {
    capabilityId: "conversion.cross.format",
    domainId: "format_conversion",
    title: "Conversión entre formatos",
    description: "Transformaciones entre PDF, Word, Excel, PPT y capturas.",
    status: "partial",
    priority: 170,
    workflow: "agent_execution",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    multiLlm: true,
    requiresApproval: false,
    matchers: [
      rx("\\b(pdf a powerpoint|notas de reunion a documento|csv a excel|word a presentacion|facturas a spreadsheet|excel a reporte en word)\\b"),
    ],
  },
  {
    capabilityId: "browser.automation",
    domainId: "browser_automation",
    title: "Automatización de navegador",
    description: "Navegar, hacer clic, extraer, llenar formularios y ejecutar JS.",
    status: "partial",
    priority: 150,
    workflow: "agent_execution",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    multiLlm: true,
    requiresApproval: true,
    matchers: [
      rx("\\b(navega .*sitio|haz click|llen(a|e) formulario|screenshot de pagina|extrae contenido de la pagina|ejecuta javascript en la pagina|investigacion web directa)\\b"),
    ],
  },
  {
    capabilityId: "desktop.computer.use",
    domainId: "computer_use",
    title: "Computer use",
    description: "Uso de aplicaciones del escritorio con permiso explícito.",
    status: "gap",
    priority: 180,
    workflow: "agent_execution",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    multiLlm: true,
    requiresApproval: true,
    matchers: [
      rx("\\b(abre excel|abre chrome|usa mi computadora|navega el navegador|llena la hoja de calculo directamente|completa formularios web en mi pc)\\b"),
    ],
  },
  {
    capabilityId: "tasks.scheduled",
    domainId: "scheduled_tasks",
    title: "Tareas programadas y recurrentes",
    description: "Cadencias diarias/semanales y tareas guardadas on-demand.",
    status: "partial",
    priority: 120,
    workflow: "skill_dispatch",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    multiLlm: true,
    requiresApproval: false,
    matchers: [
      rx("\\b(cada manana|cada mañana|semanalmente|programa una tarea|task recurrente|digest semanal|cuando quiera ejecutar)\\b"),
    ],
  },
  {
    capabilityId: "dispatch.mobile.desktop",
    domainId: "dispatch",
    title: "Dispatch móvil",
    description: "Envío desde iOS/Android para ejecución en desktop.",
    status: "gap",
    priority: 110,
    workflow: "conversation",
    handler: "model_stream",
    renderSurface: "conversation_stream",
    multiLlm: true,
    requiresApproval: false,
    matchers: [
      rx("\\b(desde el celular|dispatch|ios|android|ejecuta en tu computadora de escritorio|hilo persistente entre dispositivos)\\b"),
    ],
  },
  {
    capabilityId: "connectors.mcp.operations",
    domainId: "connectors",
    title: "Conectores e integraciones",
    description: "Drive, Gmail, Slack, Notion, GitHub, Linear y otros MCP.",
    status: "partial",
    priority: 130,
    workflow: "skill_dispatch",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    multiLlm: true,
    requiresApproval: true,
    matchers: [
      rx("\\b(google drive|gmail|docusign|factset|zoom|slack|jira|asana|notion|github|linear|crm|fellow)\\b"),
    ],
  },
  {
    capabilityId: "plugins.customization",
    domainId: "plugins_customization",
    title: "Plugins y personalización",
    description: "Marketplace, skills y configuración global o por carpeta.",
    status: "partial",
    priority: 120,
    workflow: "skill_dispatch",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    multiLlm: true,
    requiresApproval: false,
    matchers: [
      rx("\\b(marketplace de plugins|plugin privado|plugin publico|skill creator|crea un skill|instrucciones globales|instrucciones por carpeta|actualiza instrucciones de carpeta)\\b"),
    ],
  },
  {
    capabilityId: "code.execution.sandbox",
    domainId: "code_execution",
    title: "Ejecución de código",
    description: "Python y Node aislados con librerías comunes.",
    status: "partial",
    priority: 160,
    workflow: "skill_dispatch",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    multiLlm: true,
    requiresApproval: true,
    matchers: [
      rx("\\b(ejecuta python|ejecuta node|matplotlib|pandas|script de automatizacion|sandbox seguro|vm aislada)\\b"),
    ],
  },
  {
    capabilityId: "agents.subagents.parallel",
    domainId: "subagents",
    title: "Sub-agentes",
    description: "Descomposición en subtareas y coordinación paralela.",
    status: "partial",
    priority: 120,
    workflow: "agent_execution",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    multiLlm: true,
    requiresApproval: false,
    matchers: [
      rx("\\b(subagentes|sub-agentes|divide en subtareas|trabaja en paralelo|todo list interna|periodos extendidos)\\b"),
    ],
  },
  {
    capabilityId: "workspace.project.cowork",
    domainId: "project_workspaces",
    title: "Workspaces persistentes",
    description: "Memoria, archivos, instrucciones y contexto por proyecto.",
    status: "partial",
    priority: 120,
    workflow: "skill_dispatch",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    multiLlm: true,
    requiresApproval: false,
    matchers: [
      rx("\\b(workspace persistente|cowork|proyecto recurrente|memoria propia por proyecto|archivos y links por proyecto)\\b"),
    ],
  },
  {
    capabilityId: "security.governance.controls",
    domainId: "security_governance",
    title: "Seguridad y governance",
    description: "Aprobaciones, permisos de red, sandbox y protección de borrado.",
    status: "partial",
    priority: 110,
    workflow: "conversation",
    handler: "model_stream",
    renderSurface: "conversation_stream",
    multiLlm: true,
    requiresApproval: false,
    matchers: [
      rx("\\b(acceso solo a carpetas autorizadas|permisos de red|egress|pide aprobacion|proteccion contra borrado|historial almacenado localmente)\\b"),
    ],
  },
  {
    capabilityId: "enterprise.controls.analytics",
    domainId: "enterprise",
    title: "Enterprise",
    description: "RBAC, analytics, OpenTelemetry, toggles y marketplace privado.",
    status: "partial",
    priority: 110,
    workflow: "conversation",
    handler: "model_stream",
    renderSurface: "conversation_stream",
    multiLlm: true,
    requiresApproval: false,
    matchers: [
      rx("\\b(rbac|limites de gasto|analytics de uso|opentelemetry|siem|marketplace privado|toggle on/off por equipo|control granular por conector)\\b"),
    ],
  },
  {
    capabilityId: "domainpacks.functional",
    domainId: "domain_packs",
    title: "Packs por función",
    description: "Workflows orientados a legal, finanzas, marketing, ops, RRHH e investigación.",
    status: "partial",
    priority: 120,
    workflow: "skill_dispatch",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    multiLlm: true,
    requiresApproval: false,
    matchers: [
      rx("\\b(revision de contratos|triage de ndas|asientos contables|conciliacion|voz de marca|briefing diario|reviews de desempeno|sintesis de entrevistas)\\b"),
    ],
  },
  {
    capabilityId: "availability.platforms",
    domainId: "availability",
    title: "Disponibilidad",
    description: "Información sobre plataformas, planes y límites de archivos.",
    status: "partial",
    priority: 100,
    workflow: "conversation",
    handler: "model_stream",
    renderSurface: "conversation_stream",
    multiLlm: true,
    requiresApproval: false,
    matchers: [
      rx("\\b(macos|windows|pro|max|team|enterprise|claude desktop|30mb|google drive o descarga)\\b"),
    ],
  },
] as const;

function normalize(text: string): string {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function matchChatCapabilityRequest(message: string): ChatCapabilityMatch | null {
  const normalized = normalize(message);
  let best: ChatCapabilityMatch | null = null;

  for (const capability of CHAT_CAPABILITY_DEFINITIONS) {
    let score = 0;
    for (const matcher of capability.matchers) {
      if (matcher.test(normalized)) {
        score += 1;
      }
    }

    if (score <= 0) {
      continue;
    }

    const weightedScore = score * 1000 + (capability.priority ?? 100);

    if (!best || weightedScore > best.score) {
      best = { capability, score: weightedScore };
    }
  }

  return best;
}

export function getChatCapabilityById(capabilityId: string): ChatCapabilityDefinition | null {
  return CHAT_CAPABILITY_DEFINITIONS.find((capability) => capability.capabilityId === capabilityId) || null;
}
