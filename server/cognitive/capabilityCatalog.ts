/**
 * Cognitive Middleware — default capability catalog (Turn I).
 *
 * Declares one `CapabilityDescriptor` per entry from the ILIAGPT
 * capability spec so:
 *
 *   • The UI can render the full product menu from the day the
 *     registry is wired, even when some entries are stubs.
 *
 *   • Dashboards + analytics can graph "which capabilities are
 *     actually available vs. stubbed" by filtering on `status`.
 *
 *   • New capabilities go live by swapping `status: "stub"` to
 *     `status: "available"` + registering a real handler.
 *     Nothing else has to change — routes, smoke tests, persisted
 *     run records, and OTel span names are all already in place.
 *
 * This file is declarative — no runtime logic beyond
 * `buildDefaultCapabilityCatalog()`, which returns a fresh
 * `InMemoryCapabilityRegistry` with every descriptor pre-loaded.
 * Tests that need to augment the default set can clone it and
 * `register()` overrides before handing it to the middleware.
 *
 * All descriptors start at `status: "stub"`. Callers that want
 * specific capabilities to be live replace them via
 * `registry.register(descriptor, handler)` after construction.
 */

import {
  InMemoryCapabilityRegistry,
  type CapabilityCategory,
  type CapabilityDescriptor,
  type CapabilityHandler,
} from "./capabilities";

// ---------------------------------------------------------------------------
// Descriptor factory
// ---------------------------------------------------------------------------

/**
 * Helper that builds a descriptor with sensible defaults. Keeps
 * the catalog below short and readable — every entry only has to
 * specify the fields that differ from the defaults.
 */
function descriptor(
  partial: Pick<CapabilityDescriptor, "id" | "category" | "title" | "description"> &
    Partial<CapabilityDescriptor>,
): CapabilityDescriptor {
  return {
    intents: partial.intents ?? ["chat"],
    inputSchema: partial.inputSchema ?? {
      type: "object",
      properties: {},
      required: [],
    },
    requiresApproval: partial.requiresApproval ?? false,
    timeoutMs: partial.timeoutMs ?? 60_000,
    supportedTools: partial.supportedTools ?? [],
    status: partial.status ?? "stub",
    version: partial.version,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

/**
 * The full ILIAGPT capability catalog. One entry per bullet from
 * the spec. Grouped by the 18 top-level sections for readability;
 * the `category` field on each descriptor mirrors the section.
 */
export const DEFAULT_CAPABILITY_DESCRIPTORS: ReadonlyArray<CapabilityDescriptor> =
  Object.freeze([
    // ── 1. File generation ──────────────────────────────────────
    descriptor({
      id: "file_generation.create_excel_workbook",
      category: "file_generation",
      title: "Crear workbook de Excel",
      description:
        "Genera un archivo .xlsx con hojas, fórmulas, formato condicional, gráficos y múltiples pestañas.",
      intents: ["doc_generation", "data_analysis"],
      timeoutMs: 120_000,
    }),
    descriptor({
      id: "file_generation.create_powerpoint",
      category: "file_generation",
      title: "Crear presentación PowerPoint",
      description:
        "Genera un .pptx desde cero o desde notas/transcripciones, con layouts, imágenes y speaker notes.",
      intents: ["doc_generation"],
      timeoutMs: 120_000,
    }),
    descriptor({
      id: "file_generation.create_word_document",
      category: "file_generation",
      title: "Crear documento Word",
      description:
        "Genera reportes, memos, cartas o papers en formato .docx con jerarquía de headings, tablas y redlines.",
      intents: ["doc_generation"],
      timeoutMs: 120_000,
    }),
    descriptor({
      id: "file_generation.create_pdf",
      category: "file_generation",
      title: "Crear PDF",
      description: "Genera PDFs nuevos, llena formularios, une o divide PDFs existentes.",
      intents: ["doc_generation"],
      timeoutMs: 120_000,
    }),
    descriptor({
      id: "file_generation.render_chart_image",
      category: "file_generation",
      title: "Render de gráfico PNG con matplotlib",
      description:
        "Ejecuta matplotlib en sandbox para producir un .png de un gráfico descrito en lenguaje natural.",
      intents: ["data_analysis", "image_generation"],
      timeoutMs: 60_000,
    }),
    descriptor({
      id: "file_generation.create_code_file",
      category: "file_generation",
      title: "Generar archivo de código",
      description:
        "Produce un archivo fuente en cualquier lenguaje (TS/JS/Python/React/Latex/etc.) listo para descarga.",
      intents: ["code_generation"],
    }),

    // ── 2. File management (local) ──────────────────────────────
    descriptor({
      id: "file_management.organize_folder",
      category: "file_management",
      title: "Organizar carpeta",
      description:
        "Lee el contenido real (no solo nombres) de una carpeta autorizada y propone una reorganización con subcarpetas lógicas.",
      intents: ["agent_task"],
      requiresApproval: true,
    }),
    descriptor({
      id: "file_management.bulk_rename",
      category: "file_management",
      title: "Renombrado masivo",
      description:
        "Aplica un patrón de renombrado (por ejemplo prefijos de fecha YYYY-MM-DD) a todos los archivos de una carpeta.",
      intents: ["agent_task"],
      requiresApproval: true,
    }),
    descriptor({
      id: "file_management.deduplicate",
      category: "file_management",
      title: "Deduplicar archivos",
      description: "Identifica duplicados por contenido y propone qué borrar preservando el más reciente.",
      intents: ["agent_task"],
      requiresApproval: true,
    }),

    // ── 3. Data analysis + data science ─────────────────────────
    descriptor({
      id: "data_analysis.describe_dataset",
      category: "data_analysis",
      title: "Describir dataset",
      description:
        "Estadísticos descriptivos, detección de outliers, cross-tabulation y series temporales sobre un CSV/Excel.",
      intents: ["data_analysis"],
    }),
    descriptor({
      id: "data_analysis.train_predictive_model",
      category: "data_analysis",
      title: "Entrenar modelo predictivo",
      description: "Machine learning básico (regresión, clasificación) sobre un dataset subido por el usuario.",
      intents: ["data_analysis"],
      timeoutMs: 300_000,
    }),
    descriptor({
      id: "data_analysis.clean_and_transform",
      category: "data_analysis",
      title: "Limpieza + transformación de dataset",
      description: "Normaliza valores, rellena nulos, deduplica filas, convierte tipos y emite un CSV limpio.",
      intents: ["data_analysis"],
    }),
    descriptor({
      id: "data_analysis.forecast_series",
      category: "data_analysis",
      title: "Forecasting de series temporales",
      description: "Modelos simples (moving average, exponential smoothing) con intervalos de confianza.",
      intents: ["data_analysis"],
    }),

    // ── 4. Research + synthesis ─────────────────────────────────
    descriptor({
      id: "research_synthesis.multi_doc_report",
      category: "research_synthesis",
      title: "Reporte de síntesis multi-documento",
      description:
        "Lee múltiples documentos, identifica patrones, detecta contradicciones y cita fuentes específicas.",
      intents: ["summarization", "rag_search"],
      timeoutMs: 180_000,
    }),
    descriptor({
      id: "research_synthesis.executive_summary",
      category: "research_synthesis",
      title: "Resumen ejecutivo",
      description: "Produce un resumen de una página destacando los puntos clave de un corpus.",
      intents: ["summarization"],
    }),
    descriptor({
      id: "research_synthesis.web_research",
      category: "research_synthesis",
      title: "Investigación web",
      description: "Búsqueda web integrada con fuentes citadas y síntesis.",
      intents: ["rag_search"],
      timeoutMs: 120_000,
    }),

    // ── 5. Format conversion ────────────────────────────────────
    descriptor({
      id: "format_conversion.pdf_to_pptx",
      category: "format_conversion",
      title: "PDF → PowerPoint",
      description: "Convierte un PDF en una presentación editable con un slide por sección.",
      intents: ["doc_generation"],
      timeoutMs: 120_000,
    }),
    descriptor({
      id: "format_conversion.csv_to_excel_model",
      category: "format_conversion",
      title: "CSV → Modelo financiero en Excel",
      description: "Toma un CSV crudo y produce un modelo .xlsx con fórmulas, supuestos y escenarios.",
      intents: ["data_analysis", "doc_generation"],
    }),
    descriptor({
      id: "format_conversion.word_to_pptx",
      category: "format_conversion",
      title: "Word → Presentación",
      description: "Convierte un documento Word en un .pptx editable.",
      intents: ["doc_generation"],
    }),
    descriptor({
      id: "format_conversion.image_to_spreadsheet",
      category: "format_conversion",
      title: "Imagen de factura/recibo → Spreadsheet",
      description: "OCR + parsing de screenshots de facturas en un spreadsheet organizado.",
      intents: ["data_analysis"],
    }),

    // ── 6. Browser automation ───────────────────────────────────
    descriptor({
      id: "browser_automation.fill_form",
      category: "browser_automation",
      title: "Llenar formulario web",
      description: "Navega a una URL, rellena un formulario con los datos provistos y envía.",
      intents: ["agent_task"],
      requiresApproval: true,
      timeoutMs: 180_000,
    }),
    descriptor({
      id: "browser_automation.extract_page",
      category: "browser_automation",
      title: "Extraer contenido de página",
      description: "Abre una URL, extrae texto visible, tablas y enlaces estructurados.",
      intents: ["rag_search"],
      timeoutMs: 60_000,
    }),
    descriptor({
      id: "browser_automation.screenshot",
      category: "browser_automation",
      title: "Screenshot de página",
      description: "Captura una página web completa o un elemento específico.",
      intents: ["agent_task"],
      timeoutMs: 60_000,
    }),

    // ── 7. Computer use ─────────────────────────────────────────
    descriptor({
      id: "computer_use.open_application",
      category: "computer_use",
      title: "Abrir aplicación del escritorio",
      description: "Lanza una aplicación del usuario tras aprobación explícita.",
      intents: ["agent_task"],
      requiresApproval: true,
    }),
    descriptor({
      id: "computer_use.fill_desktop_form",
      category: "computer_use",
      title: "Llenar formulario de desktop",
      description:
        "Completa campos en una aplicación de desktop con los datos provistos, operando el mouse/teclado.",
      intents: ["agent_task"],
      requiresApproval: true,
      timeoutMs: 300_000,
    }),

    // ── 8. Scheduled + recurring tasks ──────────────────────────
    descriptor({
      id: "scheduled_tasks.create_recurring",
      category: "scheduled_tasks",
      title: "Crear tarea recurrente",
      description:
        "Registra una tarea con cadencia (daily/weekly/custom cron) que el agent ejecuta automáticamente.",
      intents: ["agent_task"],
    }),
    descriptor({
      id: "scheduled_tasks.list_user_schedules",
      category: "scheduled_tasks",
      title: "Listar tareas programadas del usuario",
      description: "Devuelve todas las tareas recurrentes activas del usuario actual.",
      intents: ["agent_task"],
    }),

    // ── 9. Connectors + integrations (MCP) ──────────────────────
    descriptor({
      id: "connectors.list_available",
      category: "connectors",
      title: "Listar conectores disponibles",
      description:
        "Enumera los conectores MCP configurados (Gmail, Drive, Zoom, Slack, Jira, etc.) con su estado.",
      intents: ["agent_task"],
    }),
    descriptor({
      id: "connectors.invoke_mcp_tool",
      category: "connectors",
      title: "Invocar herramienta MCP",
      description:
        "Ejecuta una herramienta de un conector MCP registrado (por ejemplo enviar email por Gmail).",
      intents: ["agent_task", "tool_call"],
      requiresApproval: true,
    }),

    // ── 10. Plugins + personalization ───────────────────────────
    descriptor({
      id: "plugins.list_marketplace",
      category: "plugins",
      title: "Listar plugins del marketplace",
      description: "Devuelve los plugins públicos y privados disponibles para el workspace actual.",
      intents: ["agent_task"],
    }),
    descriptor({
      id: "plugins.install",
      category: "plugins",
      title: "Instalar plugin",
      description: "Instala un plugin del marketplace tras aprobación del usuario.",
      intents: ["agent_task"],
      requiresApproval: true,
    }),

    // ── 11. Code execution ──────────────────────────────────────
    descriptor({
      id: "code_execution.run_python",
      category: "code_execution",
      title: "Ejecutar Python en sandbox",
      description: "Corre un script Python dentro de una VM aislada con pandas/matplotlib/numpy disponibles.",
      intents: ["code_generation", "data_analysis"],
      timeoutMs: 120_000,
    }),
    descriptor({
      id: "code_execution.run_node",
      category: "code_execution",
      title: "Ejecutar Node.js en sandbox",
      description: "Corre un script Node.js dentro de la VM sandbox.",
      intents: ["code_generation"],
      timeoutMs: 120_000,
    }),

    // ── 12. Sub-agents + complex tasks ──────────────────────────
    descriptor({
      id: "sub_agents.decompose_task",
      category: "sub_agents",
      title: "Descomponer tarea en subtareas",
      description: "Toma una tarea compleja y produce una todo-list con subtareas ejecutables en paralelo.",
      intents: ["agent_task"],
    }),
    descriptor({
      id: "sub_agents.coordinate_parallel",
      category: "sub_agents",
      title: "Coordinar sub-agentes en paralelo",
      description: "Lanza múltiples sub-agentes, supervisa su progreso y agrega resultados.",
      intents: ["agent_task"],
      timeoutMs: 600_000,
    }),

    // ── 13. Projects + cowork ───────────────────────────────────
    descriptor({
      id: "projects.create_workspace",
      category: "projects",
      title: "Crear proyecto / workspace",
      description: "Crea un workspace persistente con archivos, memoria y instrucciones propias.",
      intents: ["agent_task"],
    }),
    descriptor({
      id: "projects.list_my_projects",
      category: "projects",
      title: "Listar mis proyectos",
      description: "Enumera todos los workspaces del usuario con su descripción y última actividad.",
      intents: ["agent_task"],
    }),

    // ── 14. Security + governance ───────────────────────────────
    descriptor({
      id: "security_governance.audit_recent_actions",
      category: "security_governance",
      title: "Auditar acciones recientes",
      description:
        "Genera un reporte de las acciones del agent en las últimas N horas con categoría + outcome.",
      intents: ["agent_task"],
    }),
    descriptor({
      id: "security_governance.configure_egress",
      category: "security_governance",
      title: "Configurar egress de red",
      description: "Ajusta la lista blanca de hosts a los que el sandbox puede conectarse.",
      intents: ["agent_task"],
      requiresApproval: true,
    }),

    // ── 15. Enterprise ──────────────────────────────────────────
    descriptor({
      id: "enterprise.rbac_check",
      category: "enterprise",
      title: "Verificar permisos RBAC",
      description: "Comprueba si un usuario tiene permiso para una acción bajo el modelo RBAC del workspace.",
      intents: ["agent_task"],
    }),
    descriptor({
      id: "enterprise.usage_analytics",
      category: "enterprise",
      title: "Analytics de uso enterprise",
      description: "Reporta métricas de uso (tokens, requests, costos) por equipo/departamento.",
      intents: ["data_analysis"],
    }),

    // ── 16. Dispatch mobile ─────────────────────────────────────
    descriptor({
      id: "dispatch_mobile.queue_task",
      category: "dispatch_mobile",
      title: "Encolar tarea desde móvil",
      description:
        "Envía una tarea desde iOS/Android al desktop del usuario para que Claude la ejecute al abrirlo.",
      intents: ["agent_task"],
    }),

    // ── 17. Availability ────────────────────────────────────────
    descriptor({
      id: "availability.platform_status",
      category: "availability",
      title: "Estado de la plataforma",
      description:
        "Devuelve build info, limits, disponibilidad por plan (Pro/Max/Team/Enterprise) y health de conectores.",
      intents: ["agent_task"],
      status: "available", // always-available no matter what — acts as a liveness ping
    }),

    // ── 18. Echo helper (always-available so smoke tests have a real capability to invoke) ──
    descriptor({
      id: "availability.echo",
      category: "availability",
      title: "Echo helper",
      description:
        "Devuelve los args tal cual. Capability de referencia para demos + smoke tests del registry.",
      intents: ["chat", "unknown"],
      status: "available",
    }),
  ]);

// ---------------------------------------------------------------------------
// Default handlers for the always-available entries
// ---------------------------------------------------------------------------

/**
 * Handlers for the two descriptors whose `status` is
 * `"available"`. Every other descriptor stays as a stub and will
 * return a structured `not_implemented` outcome on invoke — which
 * is exactly what the UI wants until a real implementation ships.
 */
const DEFAULT_HANDLERS: ReadonlyMap<string, CapabilityHandler> = new Map<
  string,
  CapabilityHandler
>([
  [
    "availability.platform_status",
    async () => ({
      result: {
        buildInfo: "iliagpt-cognitive",
        roadmap: "turns A-I complete",
        plans: ["Pro", "Max", "Team", "Enterprise"],
        platforms: ["macOS", "Windows", "Web"],
        fileSizeLimitMb: 30,
      },
      message: "Platform status OK",
    }),
  ],
  [
    "availability.echo",
    async (args: Record<string, unknown>) => ({
      result: { echoed: args },
      message: "echo handler ran",
    }),
  ],
]);

// ---------------------------------------------------------------------------
// Catalog builder
// ---------------------------------------------------------------------------

export interface BuildDefaultCapabilityCatalogOptions {
  /**
   * Additional descriptors to merge into the catalog. Existing
   * entries with the same id are OVERWRITTEN so callers can swap
   * a stub for a real implementation without editing this file.
   */
  extraDescriptors?: ReadonlyArray<CapabilityDescriptor>;
  /**
   * Additional handlers. Keys must match descriptor ids from the
   * catalog or from `extraDescriptors`. When a handler is
   * provided, the matching descriptor's status is promoted to
   * "available" automatically.
   */
  handlers?: ReadonlyMap<string, CapabilityHandler>;
  /** Registry name override. */
  name?: string;
}

/**
 * Build a new `InMemoryCapabilityRegistry` pre-populated with the
 * full ILIAGPT capability catalog. Most entries are stubs; two
 * (`availability.platform_status` + `availability.echo`) are
 * always-available so callers have at least one real handler to
 * invoke out of the box.
 */
export function buildDefaultCapabilityCatalog(
  options: BuildDefaultCapabilityCatalogOptions = {},
): InMemoryCapabilityRegistry {
  const registry = new InMemoryCapabilityRegistry([], {
    name: options.name ?? "default-capability-catalog",
  });

  // Merge base + extra descriptors, letting extras overwrite.
  const byId = new Map<string, CapabilityDescriptor>();
  for (const d of DEFAULT_CAPABILITY_DESCRIPTORS) {
    byId.set(d.id, d);
  }
  for (const d of options.extraDescriptors ?? []) {
    byId.set(d.id, d);
  }

  for (const descriptor of byId.values()) {
    const override = options.handlers?.get(descriptor.id);
    const builtin = DEFAULT_HANDLERS.get(descriptor.id);
    const handler = override ?? builtin;
    if (handler) {
      // Promote the descriptor's status to "available" when we
      // have a handler, so UIs render it as live.
      const promoted: CapabilityDescriptor = {
        ...descriptor,
        status: "available",
      };
      registry.register(promoted, handler);
    } else {
      registry.register(descriptor);
    }
  }

  return registry;
}

/**
 * Convenience: return a simple count of descriptors per category
 * from the default catalog. Used by tests + analytics dashboards.
 */
export function summarizeDefaultCatalog(): Record<CapabilityCategory, number> {
  const out: Partial<Record<CapabilityCategory, number>> = {};
  for (const d of DEFAULT_CAPABILITY_DESCRIPTORS) {
    out[d.category] = (out[d.category] ?? 0) + 1;
  }
  return out as Record<CapabilityCategory, number>;
}
