/**
 * Intent Guard System
 * Prevents context contamination and enforces response contracts for document analysis
 */

export type TaskType = 
  | "document_overview"
  | "document_summary"
  | "document_analysis"
  | "document_extraction"
  | "document_qa"
  | "web_search"
  | "general_chat"
  | "code_generation"
  | "image_generation"
  | "unknown";

export type OutputFormat = 
  | "overview"
  | "summary"
  | "bullet_points"
  | "detailed_analysis"
  | "qa_response"
  | "news_list"
  | "search_results"
  | "free_form";

export interface IntentContract {
  taskType: TaskType;
  userGoal: string;
  outputFormat: OutputFormat;
  sessionMemory: boolean;
  documentPresent: boolean;
  prohibitedPatterns: RegExp[];
  requiredElements: string[];
  createdAt: number;
}

export interface IntentAuditLog {
  intentDetected: TaskType;
  userMessage: string;
  documentPresent: boolean;
  templateUsed: string;
  memoryKeysApplied: string[];
  validatorOutcome: "pass" | "fail" | "retry";
  failureReason?: string;
  timestamp: number;
}

const DOCUMENT_OVERVIEW_PATTERNS = [
  /de\s+qu[eé]\s+(trata|habla|es|va)/i,
  /qu[eé]\s+(dice|contiene|hay\s+en)/i,
  /cu[aá]l\s+es\s+el\s+(tema|contenido|prop[oó]sito)/i,
  /sobre\s+qu[eé]\s+(es|trata|habla)/i,
  /expl[ií]came\s+(el|este|este)\s+documento/i,
  /what\s+is\s+this\s+(document|file)\s+about/i,
  /what\s+does\s+(this|the)\s+(document|file)\s+(say|contain)/i,
];

const DOCUMENT_SUMMARY_PATTERNS = [
  /resumen|resumir|resume|summarize|summary/i,
  /haz(me)?\s+un\s+resumen/i,
  /dame\s+(un\s+)?resumen/i,
  /res[uú]melo/i,
  /sintetiza/i,
  /give\s+me\s+a\s+summary/i,
  /summarize\s+(this|the)/i,
];

const DOCUMENT_ANALYSIS_PATTERNS = [
  /analiza|análisis|analyze|analysis/i,
  /eval[uú]a|evaluar|evaluate/i,
  /examina|examinar|examine/i,
  /estudia|estudiar|study/i,
  /revisa|revisar|review/i,
];

const DOCUMENT_EXTRACTION_PATTERNS = [
  /extrae|extraer|extract/i,
  /saca|sacar/i,
  /obt[eé]n|obtener|get/i,
  /lista(me)?\s+(los|las|todo)/i,
  /cu[aá]les\s+son\s+(los|las)/i,
  /dame\s+(los|las|todo)/i,
  /find\s+(all|the)/i,
  /list\s+(all|the)/i,
];

const DOCUMENT_QA_PATTERNS = [
  /\?$/,
  /pregunta|question/i,
  /d[oó]nde\s+(dice|menciona|est[aá])/i,
  /c[oó]mo\s+(se|dice)/i,
  /cu[aá]nto|cu[aá]ndo|qui[eé]n/i,
  /where\s+does\s+it\s+(say|mention)/i,
  /how\s+(does|is)/i,
];

const WEB_SEARCH_PATTERNS = [
  /busca\s+(en\s+)?(internet|web|google)/i,
  /noticias\s+(de|sobre|del)/i,
  /[uú]ltimas\s+noticias/i,
  /qu[eé]\s+est[aá]\s+pasando/i,
  /search\s+(the\s+)?(web|internet)/i,
  /news\s+(about|on|from)/i,
];

const COMMON_NEWS_CONTAMINATION_PATTERNS = [
  /aqu[ií]\s+tienes?\s+\d+\s+noticias/i,
  /\d+\s+noticias\s+(de|sobre)/i,
  /asistente\s+de\s+noticias/i,
  /como\s+asistente\s+de\s+noticias/i,
  /fuentes?\s+encontradas?/i,
  /resultados?\s+de\s+b[uú]squeda/i,
  /seg[uú]n\s+(google|bing|duckduckgo)/i,
  /en\s+internet\s+encontr[eé]/i,
  /he\s+procesado\s+la\s+[uú]nica\s+fuente/i,
  /basándome\s+en\s+las\s+fuentes/i,
  /\[Fuente:\s*\d+\]/i,
];

const PROHIBITED_PATTERNS_BY_TASK: Record<TaskType, RegExp[]> = {
  document_overview: [...COMMON_NEWS_CONTAMINATION_PATTERNS],
  document_summary: [...COMMON_NEWS_CONTAMINATION_PATTERNS],
  document_analysis: [...COMMON_NEWS_CONTAMINATION_PATTERNS],
  document_extraction: [...COMMON_NEWS_CONTAMINATION_PATTERNS],
  document_qa: [
    ...COMMON_NEWS_CONTAMINATION_PATTERNS,
    /no\s+tengo\s+(acceso|el)\s+documento/i,
    /sube\s+(el|un)\s+documento/i,
    /no\s+has\s+subido/i,
  ],
  web_search: [],
  general_chat: [],
  code_generation: [],
  image_generation: [],
  unknown: [],
};

export function detectIntent(
  userMessage: string,
  hasDocument: boolean,
  hasAttachment: boolean
): IntentContract {
  const message = userMessage.toLowerCase().trim();
  const documentPresent = hasDocument || hasAttachment;
  
  console.log(`[IntentGuard.detectIntent] message="${message.slice(0, 50)}...", hasDocument=${hasDocument}, hasAttachment=${hasAttachment}, documentPresent=${documentPresent}`);
  
  let taskType: TaskType = "unknown";
  let outputFormat: OutputFormat = "free_form";
  let userGoal = "";
  
  if (documentPresent) {
    // AGGRESSIVE DOCUMENT DETECTION: When document is present, 
    // check if user explicitly wants web search, otherwise default to document analysis
    const isExplicitWebSearch = WEB_SEARCH_PATTERNS.some(p => p.test(message));
    
    if (isExplicitWebSearch) {
      console.log(`[IntentGuard.detectIntent] User explicitly requested web search despite having document`);
      taskType = "web_search";
      outputFormat = "search_results";
      userGoal = "Search the web for information";
    } else if (DOCUMENT_OVERVIEW_PATTERNS.some(p => p.test(message))) {
      taskType = "document_overview";
      outputFormat = "overview";
      userGoal = "Understand what the document is about";
    } else if (DOCUMENT_SUMMARY_PATTERNS.some(p => p.test(message))) {
      taskType = "document_summary";
      outputFormat = "summary";
      userGoal = "Get a concise summary of the document";
    } else if (DOCUMENT_ANALYSIS_PATTERNS.some(p => p.test(message))) {
      taskType = "document_analysis";
      outputFormat = "detailed_analysis";
      userGoal = "Get detailed analysis of the document";
    } else if (DOCUMENT_EXTRACTION_PATTERNS.some(p => p.test(message))) {
      taskType = "document_extraction";
      outputFormat = "bullet_points";
      userGoal = "Extract specific information from the document";
    } else if (DOCUMENT_QA_PATTERNS.some(p => p.test(message))) {
      taskType = "document_qa";
      outputFormat = "qa_response";
      userGoal = "Answer a question about the document";
    } else {
      taskType = "document_qa";
      outputFormat = "qa_response";
      userGoal = "Respond about the document content";
    }
  } else {
    if (WEB_SEARCH_PATTERNS.some(p => p.test(message))) {
      taskType = "web_search";
      outputFormat = "search_results";
      userGoal = "Search the web for information";
    } else {
      taskType = "general_chat";
      outputFormat = "free_form";
      userGoal = "General conversation";
    }
  }
  
  const prohibitedPatterns = PROHIBITED_PATTERNS_BY_TASK[taskType] || [];
  
  const requiredElements: string[] = [];
  if (taskType === "document_overview" || taskType === "document_summary") {
    requiredElements.push("main_topic", "key_points");
  }
  
  return {
    taskType,
    userGoal,
    outputFormat,
    sessionMemory: !documentPresent,
    documentPresent,
    prohibitedPatterns,
    requiredElements,
    createdAt: Date.now(),
  };
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  matchedProhibitedPattern?: string;
  suggestedRetryPrompt?: string;
}

export function validateResponse(
  response: string,
  contract: IntentContract
): ValidationResult {
  for (const pattern of contract.prohibitedPatterns) {
    if (pattern.test(response)) {
      return {
        valid: false,
        error: "INTENT_MISMATCH_ERROR",
        matchedProhibitedPattern: pattern.source,
        suggestedRetryPrompt: buildRetryPrompt(contract),
      };
    }
  }
  
  if (contract.taskType.startsWith("document_")) {
    const lowerResponse = response.toLowerCase();
    if (
      lowerResponse.includes("sube un documento") ||
      lowerResponse.includes("sube el documento") ||
      lowerResponse.includes("no has subido") ||
      lowerResponse.includes("upload a document") ||
      lowerResponse.includes("please upload")
    ) {
      return {
        valid: false,
        error: "DOCUMENT_REQUEST_ERROR",
        matchedProhibitedPattern: "asking_for_document_upload",
        suggestedRetryPrompt: buildRetryPrompt(contract),
      };
    }
  }
  
  return { valid: true };
}

function buildRetryPrompt(contract: IntentContract): string {
  const basePrompts: Record<TaskType, string> = {
    document_overview: `Responde ÚNICAMENTE sobre el contenido del documento proporcionado. 
NO menciones noticias, búsquedas web, ni fuentes externas.
Proporciona: 1) Tema principal 2) Puntos clave 3) Conclusiones si las hay.`,
    document_summary: `Resume ÚNICAMENTE el documento proporcionado.
NO menciones noticias, búsquedas web, ni fuentes externas.
Estructura: Resumen ejecutivo seguido de puntos principales.`,
    document_analysis: `Analiza ÚNICAMENTE el documento proporcionado.
NO busques información externa. Basa tu análisis solo en el contenido del documento.`,
    document_extraction: `Extrae la información solicitada ÚNICAMENTE del documento proporcionado.
NO inventes datos ni busques fuentes externas.`,
    document_qa: `Responde la pregunta usando ÚNICAMENTE el contenido del documento.
Si la respuesta no está en el documento, dilo explícitamente.`,
    web_search: "",
    general_chat: "",
    code_generation: "",
    image_generation: "",
    unknown: "",
  };
  
  return basePrompts[contract.taskType] || "";
}

export function buildDocumentPrompt(
  contract: IntentContract,
  documentContext: string,
  userMessage: string
): string {
  const taskInstructions: Record<string, string> = {
    document_overview: `TAREA: Proporciona una visión general del documento.
FORMATO REQUERIDO:
1. **Tema Principal**: [Una oración describiendo de qué trata el documento]
2. **Puntos Clave**: [Lista con viñetas de los puntos más importantes]
3. **Propósito**: [Para qué sirve este documento]`,
    
    document_summary: `TAREA: Resume el documento de forma concisa.
FORMATO REQUERIDO:
1. **Resumen Ejecutivo**: [2-3 oraciones con la esencia del documento]
2. **Puntos Principales**: [Lista con los puntos más relevantes]
3. **Conclusiones**: [Si las hay en el documento]`,
    
    document_analysis: `TAREA: Analiza el documento en detalle.
FORMATO REQUERIDO:
1. **Análisis del Contenido**: [Descripción detallada]
2. **Estructura**: [Cómo está organizado]
3. **Hallazgos Importantes**: [Datos o información relevante]
4. **Observaciones**: [Tu análisis del documento]`,
    
    document_extraction: `TAREA: Extrae la información específica solicitada.
FORMATO: Lista estructurada con la información encontrada.
Si algún dato no está en el documento, indícalo explícitamente.`,
    
    document_qa: `TAREA: Responde la pregunta basándote en el documento.
- Si la respuesta está en el documento, proporciona la respuesta con citas relevantes.
- Si la respuesta NO está en el documento, di "Esta información no aparece en el documento."`,
  };
  
  const instruction = taskInstructions[contract.taskType] || taskInstructions.document_qa;
  
  return `SISTEMA DE ANÁLISIS DE DOCUMENTOS
================================

REGLAS OBLIGATORIAS (NUNCA VIOLAR):
1. Responde ÚNICAMENTE usando el contenido del documento proporcionado
2. NUNCA menciones "noticias", "búsqueda web", ni "fuentes externas"
3. NUNCA digas "sube un documento" - el documento YA está proporcionado abajo
4. NUNCA uses formatos de respuesta de otras tareas (como listas de noticias)
5. Si el documento está vacío o no tiene contenido útil, dilo explícitamente

TIPO DE TAREA: ${contract.taskType}
OBJETIVO: ${contract.userGoal}

${instruction}

=== CONTENIDO DEL DOCUMENTO ===
${documentContext}
=== FIN DEL DOCUMENTO ===

PREGUNTA/SOLICITUD DEL USUARIO:
${userMessage}`;
}

export function createAuditLog(
  contract: IntentContract,
  userMessage: string,
  templateUsed: string,
  validatorOutcome: "pass" | "fail" | "retry",
  failureReason?: string
): IntentAuditLog {
  return {
    intentDetected: contract.taskType,
    userMessage: userMessage.slice(0, 200),
    documentPresent: contract.documentPresent,
    templateUsed,
    memoryKeysApplied: contract.sessionMemory ? ["userSettings", "conversationHistory"] : [],
    validatorOutcome,
    failureReason,
    timestamp: Date.now(),
  };
}
