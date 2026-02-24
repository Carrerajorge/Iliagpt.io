export interface ComplexityCheckResult {
  agent_required: boolean;
  agent_reason?: string;
  confidence: 'high' | 'medium' | 'low';
}

const AGENT_PATTERNS: Array<{ pattern: RegExp; reason: string; confidence: 'high' | 'medium'; category: string }> = [
  // === INVESTIGACIÓN Y ANÁLISIS ===
  // { pattern: /\b(busca|buscar|search|find|investigar|investigate|research)\b.*\b(web|internet|online|en línea|información|information)\b/i, reason: "Requiere búsqueda web", confidence: 'high', category: "research" },
  // { pattern: /\b(navega|navigate|browse|visita|visit|abre|open)\b.*\b(página|page|sitio|site|url|web)\b/i, reason: "Requiere navegación web", confidence: 'high', category: "research" },
  // { pattern: /\b(verifica|verify|comprueba|check|confirma|confirm)\b.*\b(hechos|facts|información|information|datos|data)\b/i, reason: "Verificación de hechos", confidence: 'high', category: "research" },
  // { pattern: /\b(recopila|collect|gather)\b.*\b(información|information|datos|data)\b.*\b(de|from|sobre|about|múltiples|multiple|varias|several)\b/i, reason: "Recopilación de información", confidence: 'high', category: "research" },
  // { pattern: /\b(tendencias|trends|mercado|market|análisis de mercado|market analysis)\b/i, reason: "Análisis de mercado", confidence: 'high', category: "research" },
  // { pattern: /\b(informe|report|reporte)\b.*\b(investigación|research|completo|complete|detallado|detailed)\b/i, reason: "Generación de informe", confidence: 'high', category: "research" },
  // { pattern: /\b(scrape|scrapear|extraer datos|extract data|web scraping)\b/i, reason: "Extracción de datos web", confidence: 'high', category: "research" },
  // { pattern: /\b(gráfico|graph|chart|visualización|visualization)\b.*\b(datos|data|estadísticas|statistics)\b/i, reason: "Visualización de datos", confidence: 'high', category: "research" },

  // === DESARROLLO DE SOFTWARE ===
  // { pattern: /\b(desarrolla|develop|construye|build|programa|program)\b.*\b(aplicación|application|app|sitio web|website|página web|web page)\b/i, reason: "Desarrollo web", confidence: 'high', category: "development" },
  // { pattern: /\b(landing page|página de aterrizaje|landing)\b/i, reason: "Creación de landing page", confidence: 'high', category: "development" },
  // { pattern: /\b(aplicación móvil|mobile app|app móvil|react native|expo)\b/i, reason: "Desarrollo móvil", confidence: 'high', category: "development" },
  // { pattern: /\b(scaffold|scaffolding|inicializa|initialize|configura|configure)\b.*\b(proyecto|project|entorno|environment)\b/i, reason: "Scaffolding de proyecto", confidence: 'high', category: "development" },
  // { pattern: /\b(base de datos|database|autenticación|authentication|login|registro|register)\b.*\b(usuarios|users|sistema|system)\b/i, reason: "Sistema con BD/auth", confidence: 'high', category: "development" },
  // { pattern: /\b(debug|debugging|depura|depurar|corrige|fix)\b.*\b(código|code|error|bug|problema|problem)\b/i, reason: "Debugging de código", confidence: 'high', category: "development" },
  // { pattern: /\b(ejecuta|execute|run|corre)\b.*\b(código|code|script|programa|program|python|javascript|shell|comando|command)\b/i, reason: "Ejecución de código", confidence: 'high', category: "development" },
  // { pattern: /\b(instala|install|configura|configure|setup)\b.*\b(paquete|package|librería|library|dependencia|dependency)\b/i, reason: "Instalación de dependencias", confidence: 'high', category: "development" },
  // { pattern: /\b(api|endpoint|backend|servidor|server)\b.*\b(crea|create|desarrolla|develop|implementa|implement)\b/i, reason: "Desarrollo de API", confidence: 'high', category: "development" },

  // === CREACIÓN DE CONTENIDO ===
  // { pattern: /\b(transcribe|transcripción|transcription|speech to text|voz a texto)\b/i, reason: "Transcripción de audio", confidence: 'high', category: "content" },
  // { pattern: /\b(redacta|write|escribe|draft|artículo|article|blog|post)\b.*\b(completo|complete|secciones|sections)\b/i, reason: "Redacción de contenido", confidence: 'high', category: "content" },
  // { pattern: /\b(edita|edit|modifica|modify)\b.*\b(imagen|image|foto|photo|video|audio)\b/i, reason: "Edición multimedia", confidence: 'high', category: "content" },

  // === AUTOMATIZACIÓN Y PRODUCTIVIDAD ===
  // { pattern: /\b(automatiza|automate|automatizar|automation|workflow|flujo de trabajo)\b/i, reason: "Automatización", confidence: 'high', category: "automation" },
  // { pattern: /\b(programa|schedule|agenda|planifica|plan)\b.*\b(tarea|task|recordatorio|reminder|recurrente|recurring)\b/i, reason: "Programación de tareas", confidence: 'high', category: "automation" },
  // { pattern: /\b(monitorea|monitor|supervisa|supervise|vigila|watch)\b.*\b(sitio|site|web|página|page|servicio|service)\b/i, reason: "Monitoreo web", confidence: 'high', category: "automation" },
  // { pattern: /\b(reserva|book|booking|compra|purchase|buy)\b.*\b(automática|automatic|proceso|process)\b/i, reason: "Automatización de compras", confidence: 'high', category: "automation" },
  // { pattern: /\b(gestiona|manage|organiza|organize)\b.*\b(archivos|files|carpetas|folders|sistema|system)\b/i, reason: "Gestión de archivos", confidence: 'high', category: "automation" },
  // { pattern: /\b(bot|robot|asistente automático|automatic assistant)\b/i, reason: "Creación de bot", confidence: 'high', category: "automation" },

  // === ANÁLISIS DE ARCHIVOS ===
  // { pattern: /\b(analiza|analyze|procesa|process|lee|read)\b.*\b(archivo|file|documento|document|excel|spreadsheet|hoja de cálculo|pdf)\b/i, reason: "Análisis de archivos", confidence: 'high', category: "files" },
  // { pattern: /\b(descarga|download|obtén|get|extrae|extract)\b.*\b(archivo|file|documento|document|datos|data)\b.*\b(de|from)\b/i, reason: "Descarga de archivos", confidence: 'high', category: "files" },
  // { pattern: /\b(compara|compare|comparar)\b.*\b(varios|multiple|diferentes|different|archivos|files)\b/i, reason: "Comparación de archivos", confidence: 'medium', category: "files" },

  // === TAREAS MULTI-PASO ===
  // { pattern: /\b(primero|first)\b.*\b(luego|then|después|after)\b/i, reason: "Tarea multi-paso", confidence: 'medium', category: "multistep" },
  // { pattern: /\b(paso\s+\d+|step\s+\d+|\d+\.\s+\w+|\d+\)\s+\w+)/i, reason: "Pasos enumerados", confidence: 'high', category: "multistep" },

  // === SOLICITUD EXPLÍCITA ===
  { pattern: /\b(usa el agente|use agent|modo agente|agent mode|con el agente|with agent)\b/i, reason: "Solicitud de agente", confidence: 'high', category: "explicit" },
  // { pattern: /https?:\/\/[^\s]+/i, reason: "URL detectada", confidence: 'medium', category: "research" },
];

const TRIVIAL_PATTERNS = [
  /^(hola|hi|hello|hey|buenos días|buenas tardes|buenas noches|good morning|good afternoon|good evening)[\s!?.,]*$/i,
  /^(gracias|thanks|thank you|thx|ty|muchas gracias)[\s!?.,]*$/i,
  /^(ok|okay|sí|si|yes|no|nope|vale|bien|bueno|sure|got it)[\s!?.,]*$/i,
  /^(adiós|bye|goodbye|chao|hasta luego|see you)[\s!?.,]*$/i
];

export function checkComplexityLocally(message: string, hasAttachments: boolean = false): ComplexityCheckResult {
  const trimmed = message.trim();

  // 1. Trivial checks still apply (to quick-return false)
  if (trimmed.length < 10 || TRIVIAL_PATTERNS.some(p => p.test(trimmed))) {
    return { agent_required: false, confidence: 'high' };
  }

  // 2. Check ONLY for explicit patterns
  for (const { pattern, reason, confidence } of AGENT_PATTERNS) {
    if (pattern.test(message)) {
      return { agent_required: true, agent_reason: reason, confidence };
    }
  }

  // 3. REMOVED: Heuristics based on word count, multi-step, action verbs, or attachments.
  // The user requested that long/complex texts should NOT automatically trigger agent mode.
  // They prefer the standard chat flow unless explicitly requested.

  return { agent_required: false, confidence: 'low' };
}

export async function checkComplexityWithApi(message: string, hasAttachments: boolean = false): Promise<ComplexityCheckResult> {
  // Force local check to respect the disabled heuristics
  return checkComplexityLocally(message, hasAttachments);
}

export function shouldAutoActivateAgent(message: string, hasAttachments: boolean = false): ComplexityCheckResult {
  return checkComplexityLocally(message, hasAttachments);
}
