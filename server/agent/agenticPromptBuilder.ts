/**
 * Agentic System Prompt Builder
 *
 * Builds context-aware, token-efficient system prompts by loading only the
 * sections relevant to the detected intent. Three tiers:
 *   compact  (~300 tokens) — greetings, simple chat
 *   medium   (~800 tokens) — documents, code, single-domain tasks
 *   full    (~1500 tokens) — research, multi-step agentic workflows
 */

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
  promptSize?: "compact" | "medium" | "full";
  hasAttachments?: boolean;
  attachmentTypes?: string[];
  conversationLength?: number;
  userFacts?: string[];
  availableTools?: ToolDescription[];
  model?: string;
  latencyMode?: string;
}

// -- Tool catalog by category -----------------------------------------------

const TOOL_CATEGORIES: Record<string, ToolDescription[]> = {
  documents: [
    { name: "create_document", description: "Generate a Word (.docx) document", when_to_use: "User asks for a Word document, report, or written deliverable" },
    { name: "create_spreadsheet", description: "Generate an Excel (.xlsx) spreadsheet", when_to_use: "User asks for a spreadsheet, data table, or financial model" },
    { name: "create_presentation", description: "Generate a PowerPoint (.pptx) presentation", when_to_use: "User asks for a presentation, pitch deck, or slideshow" },
    { name: "create_pdf", description: "Generate a PDF with precise layout", when_to_use: "User explicitly asks for PDF output" },
  ],
  research: [
    { name: "web_search", description: "Search the internet for current information", when_to_use: "User needs recent events, facts, or up-to-date data" },
    { name: "search_academic", description: "Search scholarly papers and citations", when_to_use: "User asks for academic research or scientific references" },
    { name: "browse_url", description: "Navigate to a URL and extract content", when_to_use: "User provides a URL or asks to read a web page" },
  ],
  code: [
    { name: "execute_code", description: "Run Python/JS/shell in a sandbox", when_to_use: "User asks to run, test, or compute something with code" },
    { name: "read_file", description: "Read and parse uploaded files", when_to_use: "User uploads or references a file" },
    { name: "write_file", description: "Write content to a file", when_to_use: "User asks to save, export, or create a file" },
  ],
  data: [
    { name: "analyze_data", description: "Statistical analysis and summarisation", when_to_use: "User uploads data or asks for analysis" },
    { name: "generate_chart", description: "Create data visualisations", when_to_use: "User asks for charts, graphs, or visualisations" },
    { name: "calculate", description: "Math calculations and unit conversions", when_to_use: "User asks for calculations or formulas" },
  ],
  visual: [
    { name: "render_diagram", description: "Generate Mermaid diagrams (flowcharts, sequence, ER, Gantt)", when_to_use: "User asks for a diagram or visual process representation" },
    { name: "generate_image", description: "Create images from text descriptions", when_to_use: "User asks to create, draw, or design an image" },
  ],
  memory: [
    { name: "memory_store", description: "Store and retrieve user preferences", when_to_use: "User shares preferences or asks to remember something" },
  ],
  communication: [
    { name: "send_email", description: "Draft and send emails", when_to_use: "User asks to send or compose an email" },
  ],
};

export const DEFAULT_TOOLS: readonly ToolDescription[] = Object.values(TOOL_CATEGORIES).flat();

// -- Intent profiles --------------------------------------------------------

interface IntentProfile { size: "compact" | "medium" | "full"; categories: string[] }

const INTENT_PROFILES: Record<string, IntentProfile> = {
  chat_general:          { size: "compact", categories: [] },
  greeting:              { size: "compact", categories: [] },
  translation:           { size: "compact", categories: [] },
  calculation:           { size: "medium",  categories: ["data"] },
  document_generation:   { size: "medium",  categories: ["documents", "research"] },
  spreadsheet_creation:  { size: "medium",  categories: ["documents", "data"] },
  presentation_creation: { size: "medium",  categories: ["documents", "visual"] },
  pdf_generation:        { size: "medium",  categories: ["documents"] },
  code_generation:       { size: "medium",  categories: ["code", "research"] },
  code_execution:        { size: "medium",  categories: ["code"] },
  image_generation:      { size: "medium",  categories: ["visual"] },
  diagram:               { size: "medium",  categories: ["visual"] },
  file_operation:        { size: "medium",  categories: ["code"] },
  web_search:            { size: "full",    categories: ["research"] },
  web_automation:        { size: "full",    categories: ["research", "code"] },
  research:              { size: "full",    categories: ["research", "documents", "data"] },
  data_analysis:         { size: "full",    categories: ["data", "code", "documents"] },
  agent_task:            { size: "full",    categories: Object.keys(TOOL_CATEGORIES) },
};

function resolveProfile(intent?: string): IntentProfile {
  if (!intent) return { size: "full", categories: Object.keys(TOOL_CATEGORIES) };
  return INTENT_PROFILES[intent] ?? { size: "full", categories: Object.keys(TOOL_CATEGORIES) };
}

export function getToolsForIntent(intent: string): ToolDescription[] {
  const profile = INTENT_PROFILES[intent];
  if (!profile || profile.categories.length === 0) return [...DEFAULT_TOOLS];
  return profile.categories.flatMap((cat) => TOOL_CATEGORIES[cat] ?? []);
}

// -- Memory -----------------------------------------------------------------

export function buildMemorySection(facts: string[]): string {
  if (!facts?.length) return "";
  return `Datos del usuario:\n${facts.map((f) => `- ${f}`).join("\n")}`;
}

// -- Intent instructions ----------------------------------------------------

const INTENT_INSTRUCTIONS: Record<string, { es: string; en: string }> = {
  document_generation:   { es: "Genera documentos profesionales con formato, estructura y tabla de contenidos.", en: "Generate professional documents with formatting, structure, and table of contents." },
  spreadsheet_creation:  { es: "Estructura los datos con encabezados claros, formulas y formato condicional.", en: "Structure data with clear headers, formulas, and conditional formatting." },
  presentation_creation: { es: "Disenha diapositivas con un punto clave por slide, visual y conciso.", en: "Design slides with one key point per slide, visual and concise." },
  data_analysis:         { es: "Presenta hallazgos con estadisticas, tendencias y visualizaciones.", en: "Present findings with statistics, trends, and visualisations." },
  code_generation:       { es: "Codigo limpio, tipado, con manejo de errores y comentarios utiles.", en: "Clean, typed code with error handling and useful comments." },
  research:              { es: "Consulta multiples fuentes, contrasta hallazgos y cita con formato.", en: "Consult multiple sources, cross-reference, and cite with proper format." },
  web_search:            { es: "Busca informacion actualizada y cita las fuentes con URLs.", en: "Search for current information and cite sources with URLs." },
  diagram:               { es: "Para diagramas de flujo, secuencia, clases o procesos usa ```mermaid con graph TD, sequenceDiagram, classDiagram, etc. Para ilustraciones, iconos, logos, organigramas complejos o graficos personalizados usa ```svg con SVG completo. Reglas SVG: siempre incluir viewBox para responsividad, colores profesionales (#1e3a5f, #2563eb, #059669), bordes redondeados (rx), tipografia sans-serif, sin dependencias externas. El SVG se renderiza automaticamente inline con alta nitidez.", en: "For flowcharts, sequences, class or process diagrams use ```mermaid with graph TD, sequenceDiagram, classDiagram, etc. For illustrations, icons, logos, complex org charts or custom graphics use ```svg with complete SVG. SVG rules: always include viewBox for responsiveness, professional colors (#1e3a5f, #2563eb, #059669), rounded corners (rx), sans-serif typography, no external dependencies. SVG renders automatically inline with high quality." },
  image_generation:      { es: "Crea imagenes detalladas que coincidan con la descripcion. Pide detalles si es ambigua.", en: "Create detailed images matching the description. Ask for details if ambiguous." },
};

export function getIntentInstructions(intent: string, locale: string): string {
  const lang = locale.startsWith("es") ? "es" : "en";
  return INTENT_INSTRUCTIONS[intent]?.[lang] ?? "";
}

// -- Bilingual prompt fragments ---------------------------------------------

const IDENTITY = {
  es: "Eres IliaGPT, un asistente de inteligencia artificial avanzado, disenado para ser excepcionalmente util, preciso y eficiente. Combinas la calidez de una conversacion natural con la potencia de herramientas profesionales.",
  en: "You are IliaGPT, an advanced AI assistant designed to be exceptionally helpful, accurate, and efficient. You combine the warmth of natural conversation with the power of professional tools.",
};

const QUALITY_RULES = {
  es: `Reglas de respuesta:
- Responde PRIMERO con la respuesta directa, luego desarrolla si es necesario
- Nunca empieces con "Como asistente de IA..." ni "Dejame pensar..."
- Si no sabes algo, dilo claramente: "No tengo informacion sobre esto"
- Usa markdown: **negrita** para enfasis, \`codigo\` para terminos tecnicos, listas para pasos
- Adapta la extension: breve para preguntas simples, detallado para complejas
- Cita fuentes cuando uses datos de busqueda web
- Para codigo: incluye comentarios, manejo de errores y tipado si es TypeScript`,
  en: `Response rules:
- Lead with the direct answer FIRST, then elaborate if needed
- Never start with "As an AI assistant..." or "Let me think..."
- If you don't know something, say it clearly: "I don't have information on this"
- Use markdown: **bold** for emphasis, \`code\` for technical terms, lists for steps
- Adapt length: brief for simple questions, detailed for complex ones
- Cite sources when using web search data
- For code: include comments, error handling, and types if TypeScript`,
};

const ANTI_PATTERNS = {
  es: `NUNCA: "Dejame analizar tu solicitud...", "Como modelo de lenguaje...", "Es importante mencionar que...", parrafos de introduccion, repetir la pregunta del usuario.
SIEMPRE: primera frase = respuesta directa, markdown para estructura, listas numeradas, bloques de codigo con lenguaje, tablas para datos comparativos.`,
  en: `NEVER: "Let me analyse your request...", "As a language model...", "It's important to mention that...", intro paragraphs, repeat the user's question.
ALWAYS: first sentence = direct answer, markdown for structure, numbered lists, code blocks with language, tables for comparative data.`,
};

const THINKING = {
  es: "Razonamiento: 1) Comprende el objetivo 2) Selecciona herramientas 3) Ejecuta y verifica 4) Presenta con estructura clara.",
  en: "Reasoning: 1) Understand objective 2) Select tools 3) Execute and verify 4) Present with clear structure.",
};

const LATENCY: Record<string, { es: string; en: string }> = {
  fast: { es: "Modo rapido: se conciso, prioriza velocidad.", en: "Fast mode: be concise, prioritise speed." },
  deep: { es: "Modo profundo: se exhaustivo, verifica afirmaciones.", en: "Deep mode: be thorough, verify claims." },
  auto: { es: "Equilibra velocidad y profundidad segun la complejidad.", en: "Balance speed and thoroughness based on complexity." },
};

// -- Main builder -----------------------------------------------------------

export function buildAgenticSystemPrompt(ctx: AgenticPromptContext): string {
  const lang = ctx.locale?.startsWith("es") ? "es" : "en";
  const profile = resolveProfile(ctx.intent);
  const size = ctx.promptSize ?? profile.size;
  const locale_display = ctx.locale || "en";
  const langDirective = lang === "es"
    ? `Responde en el idioma del usuario (detectado: ${locale_display}).`
    : `Respond in the user's language (detected: ${locale_display}).`;
  const sections: string[] = [];

  // Always: identity + quality rules
  sections.push(IDENTITY[lang]);
  sections.push(QUALITY_RULES[lang]);

  // Compact: minimal prompt — just personality, rules, language, memory
  if (size === "compact") {
    sections.push(langDirective);
    if (ctx.userFacts?.length) sections.push(buildMemorySection(ctx.userFacts));
    return sections.join("\n\n");
  }

  // Medium & Full: anti-patterns + tools + intent instructions
  sections.push(ANTI_PATTERNS[lang]);

  const tools = ctx.availableTools ?? getToolsForIntent(ctx.intent ?? "");
  if (tools.length > 0) {
    const header = lang === "es" ? "Herramientas disponibles:" : "Available tools:";
    sections.push(`${header}\n${tools.map((t) => `- **${t.name}**: ${t.description}`).join("\n")}`);
  }

  if (ctx.intent) {
    const instruction = getIntentInstructions(ctx.intent, ctx.locale);
    if (instruction) sections.push(instruction);
  }

  // Document code generation prompt (external module, only for document intents)
  if (profile.categories.includes("documents")) {
    try {
      const { getDocumentCodePrompt } = require("../../services/documentGenerators/codeExecutionGenerator");
      sections.push(getDocumentCodePrompt(ctx.locale));
    } catch { /* module unavailable */ }
  }

  if (ctx.userFacts?.length) sections.push(buildMemorySection(ctx.userFacts));

  // Full only: thinking framework + attachment context
  if (size === "full") {
    sections.push(THINKING[lang]);
    if (ctx.hasAttachments && ctx.attachmentTypes?.length) {
      sections.push(
        lang === "es"
          ? `Archivos adjuntos (${ctx.attachmentTypes.join(", ")}). Analiza los archivos como parte de tu respuesta.`
          : `Attached files (${ctx.attachmentTypes.join(", ")}). Analyse the attached files as part of your response.`,
      );
    }
  }

  sections.push((LATENCY[ctx.latencyMode || "auto"] ?? LATENCY.auto)[lang]);
  sections.push(langDirective);
  return sections.join("\n\n");
}
