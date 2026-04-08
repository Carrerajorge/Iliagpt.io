/**
 * Agentic System Prompt Builder
 *
 * Builds a context-aware, tool-aware system prompt that enables the AI to
 * reason step-by-step and use tools effectively. Replaces the basic static
 * system prompt with dynamic sections driven by intent, locale, available
 * tools, and user memory.
 */

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface ToolDescription {
  name: string;
  description: string;
  when_to_use: string;
}

export interface AgenticPromptContext {
  userId: string;
  locale: string;
  intent?: string;
  intentConfidence?: number;
  hasAttachments?: boolean;
  attachmentTypes?: string[];
  conversationLength?: number;
  userFacts?: string[];
  availableTools?: ToolDescription[];
  model?: string;
  latencyMode?: string;
}

// ---------------------------------------------------------------------------
// Default tool catalog (15+)
// ---------------------------------------------------------------------------

export const DEFAULT_TOOLS: readonly ToolDescription[] = [
  { name: "web_search", description: "Search the internet for current information", when_to_use: "When user asks about recent events, facts, or anything that may require up-to-date information" },
  { name: "create_document", description: "Generate a Word (.docx) document with professional formatting", when_to_use: "When user asks to create a Word document, report, essay, or written deliverable" },
  { name: "create_spreadsheet", description: "Generate an Excel (.xlsx) spreadsheet with data, formulas, and charts", when_to_use: "When user asks to create a spreadsheet, data table, or financial model" },
  { name: "create_presentation", description: "Generate a PowerPoint (.pptx) presentation with slides and visuals", when_to_use: "When user asks to create a presentation, pitch deck, or slideshow" },
  { name: "create_pdf", description: "Generate a PDF document with precise layout control", when_to_use: "When user explicitly asks for PDF output or needs a print-ready document" },
  { name: "execute_code", description: "Run Python, JavaScript, or shell code in a sandboxed environment", when_to_use: "When user asks to run code, test a snippet, or perform computation" },
  { name: "analyze_data", description: "Perform statistical analysis, summarization, and visualization of datasets", when_to_use: "When user uploads data or asks for analysis, trends, or insights" },
  { name: "browse_url", description: "Navigate to a URL and extract its content", when_to_use: "When user provides a URL or asks to read a specific web page" },
  { name: "generate_image", description: "Create an image from a text description using AI image generation", when_to_use: "When user asks to create, draw, design, or generate an image" },
  { name: "read_file", description: "Read and parse uploaded files (PDF, DOCX, images, CSV, etc.)", when_to_use: "When user uploads a file or asks to read/analyze an attachment" },
  { name: "write_file", description: "Write content to a file in the workspace", when_to_use: "When user asks to save, export, or create a file with specific content" },
  { name: "calculate", description: "Perform mathematical calculations and unit conversions", when_to_use: "When user asks for calculations, math problems, or unit conversions" },
  { name: "search_academic", description: "Search academic databases for scholarly papers and citations", when_to_use: "When user asks for academic research, scientific papers, or scholarly references" },
  { name: "generate_chart", description: "Create data visualizations (bar, line, pie, scatter charts)", when_to_use: "When user asks for charts, graphs, or data visualizations" },
  { name: "memory_store", description: "Store and retrieve user preferences and important facts", when_to_use: "When user shares personal preferences, or asks to remember/recall something" },
  { name: "send_email", description: "Draft and send emails via connected accounts", when_to_use: "When user asks to send, draft, or compose an email" },
] as const;

// ---------------------------------------------------------------------------
// Intent -> tools mapping
// ---------------------------------------------------------------------------

const INTENT_TOOL_MAP: Record<string, string[]> = {
  document_generation: ["create_document", "create_spreadsheet", "create_presentation", "create_pdf", "read_file", "web_search"],
  data_analysis: ["analyze_data", "execute_code", "generate_chart", "read_file", "calculate", "create_spreadsheet"],
  code_generation: ["execute_code", "write_file", "read_file", "web_search"],
  web_automation: ["browse_url", "web_search", "read_file", "write_file"],
  research: ["web_search", "search_academic", "browse_url", "memory_store", "create_document"],
  image_generation: ["generate_image", "write_file"],
};

export function getToolsForIntent(intent: string): ToolDescription[] {
  const names = INTENT_TOOL_MAP[intent];
  if (!names) return [...DEFAULT_TOOLS];
  return DEFAULT_TOOLS.filter((t) => names.includes(t.name));
}

// ---------------------------------------------------------------------------
// Intent-specific instructions (bilingual)
// ---------------------------------------------------------------------------

const INTENT_INSTRUCTIONS: Record<string, { es: string; en: string }> = {
  document_generation: {
    es: "Genera documentos profesionales con formato adecuado. Incluye tabla de contenidos para documentos largos. Utiliza encabezados, estilos y estructura coherente.",
    en: "Generate professional documents with proper formatting. Include table of contents for long documents. Use headings, styles, and coherent structure.",
  },
  data_analysis: {
    es: "Analiza los datos de forma exhaustiva. Presenta los hallazgos con estadisticas y visualizaciones claras. Identifica tendencias y anomalias.",
    en: "Analyze data thoroughly. Present findings with statistics and clear visualizations. Identify trends and anomalies.",
  },
  code_generation: {
    es: "Escribe codigo limpio y bien documentado. Incluye manejo de errores y tipos adecuados. Sigue las mejores practicas del lenguaje.",
    en: "Write clean, well-documented code. Include error handling and proper types. Follow language best practices.",
  },
  web_automation: {
    es: "Navega con cuidado por las paginas web. Extrae la informacion relevante y cita las fuentes con sus URLs.",
    en: "Navigate web pages carefully. Extract relevant information and cite sources with their URLs.",
  },
  research: {
    es: "Busca en multiples fuentes. Contrasta los hallazgos entre si. Cita todas las fuentes utilizadas con formato apropiado.",
    en: "Search multiple sources. Cross-reference findings. Cite all sources used with appropriate formatting.",
  },
  image_generation: {
    es: "Crea imagenes detalladas y de alta calidad que coincidan con la descripcion proporcionada. Pregunta por detalles si la descripcion es ambigua.",
    en: "Create detailed, high-quality images matching the provided description. Ask for details if the description is ambiguous.",
  },
};

const DEFAULT_INSTRUCTION = {
  es: "Responde de forma util y concisa.",
  en: "Respond helpfully and concisely.",
};

export function getIntentInstructions(intent: string, locale: string): string {
  const lang = locale.startsWith("es") ? "es" : "en";
  const entry = INTENT_INSTRUCTIONS[intent];
  return entry ? entry[lang] : DEFAULT_INSTRUCTION[lang];
}

// ---------------------------------------------------------------------------
// Memory section
// ---------------------------------------------------------------------------

export function buildMemorySection(facts: string[]): string {
  if (!facts || facts.length === 0) return "";
  const items = facts.map((f) => `- ${f}`).join("\n");
  return `Known facts about this user:\n${items}`;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildAgenticSystemPrompt(ctx: AgenticPromptContext): string {
  const lang = ctx.locale?.startsWith("es") ? "es" : "en";
  const sections: string[] = [];

  // 1. Identity
  sections.push(
    lang === "es"
      ? "Eres IliaGPT, un asistente de IA con capacidades agenticas. Puedes razonar paso a paso, usar herramientas y producir artefactos reales."
      : "You are IliaGPT, an AI assistant with agentic capabilities. You can reason step-by-step, use tools, and produce real artifacts.",
  );

  // 2. Thinking instructions
  sections.push(
    lang === "es"
      ? `Antes de responder solicitudes complejas, piensa paso a paso:
1) Comprende lo que el usuario necesita
2) Planifica que herramientas usar
3) Ejecuta las herramientas
4) Verifica los resultados
5) Presenta los hallazgos de forma clara`
      : `Before answering complex requests, think step-by-step:
1) Understand what the user needs
2) Plan which tools to use
3) Execute tools
4) Verify results
5) Present findings clearly`,
  );

  // 3. Available tools
  const tools = ctx.availableTools ?? (ctx.intent ? getToolsForIntent(ctx.intent) : [...DEFAULT_TOOLS]);
  if (tools.length > 0) {
    const header = lang === "es" ? "Herramientas disponibles:" : "Available tools:";
    const toolLines = tools.map(
      (t) => `- **${t.name}**: ${t.description} | ${lang === "es" ? "Usar cuando" : "Use when"}: ${t.when_to_use}`,
    );
    sections.push(`${header}\n${toolLines.join("\n")}`);
  }

  // 4. Memory context
  if (ctx.userFacts && ctx.userFacts.length > 0) {
    sections.push(buildMemorySection(ctx.userFacts));
  }

  // 5. Intent-specific instructions
  if (ctx.intent) {
    const label = lang === "es" ? "Instrucciones para esta tarea:" : "Task-specific instructions:";
    sections.push(`${label} ${getIntentInstructions(ctx.intent, ctx.locale)}`);
  }

  // 6. Attachment context
  if (ctx.hasAttachments && ctx.attachmentTypes && ctx.attachmentTypes.length > 0) {
    const note =
      lang === "es"
        ? `El usuario ha adjuntado archivos (${ctx.attachmentTypes.join(", ")}). Analiza los archivos adjuntos como parte de tu respuesta.`
        : `The user has attached files (${ctx.attachmentTypes.join(", ")}). Analyze the attached files as part of your response.`;
    sections.push(note);
  }

  // 7. Response quality rules
  const locale_display = ctx.locale || "en";
  sections.push(
    lang === "es"
      ? `Reglas de calidad:
- Siempre verifica tu trabajo antes de presentarlo
- Si no estas seguro, dilo y explica tu nivel de confianza
- Al usar herramientas, explica que estas haciendo y por que
- Si una tarea requiere varios pasos, presenta tu plan primero
- Responde en el idioma del usuario (detectado: ${locale_display})`
      : `Quality rules:
- Always verify your work before presenting it
- If uncertain, say so and explain your confidence level
- When using tools, explain what you are doing and why
- If a task requires multiple steps, outline your plan first
- Respond in the user's language (detected: ${locale_display})`,
  );

  // 8. Constraints based on latency mode
  const mode = ctx.latencyMode || "auto";
  const constraints: Record<string, { es: string; en: string }> = {
    fast: {
      es: "Modo rapido: se conciso. Prioriza velocidad sobre detalle.",
      en: "Fast mode: be concise. Prioritize speed over detail.",
    },
    deep: {
      es: "Modo profundo: se exhaustivo. Explora multiples angulos. Verifica las afirmaciones.",
      en: "Deep mode: be thorough. Explore multiple angles. Verify claims.",
    },
    auto: {
      es: "Equilibra velocidad y profundidad segun la complejidad de la pregunta.",
      en: "Balance speed and thoroughness based on question complexity.",
    },
  };
  const constraint = constraints[mode] ?? constraints.auto;
  sections.push(constraint[lang]);

  return sections.join("\n\n");
}
