/**
 * Enhanced Intent Classifier -- multi-intent detection, contextual
 * classification, confidence scoring, and multilingual keyword matching.
 */

export interface IntentMatch {
  intent: string;
  confidence: number;
  matchedKeywords: string[];
  reasoning: string;
}

export interface ClassifiedIntent {
  primary: IntentMatch;
  secondary?: IntentMatch;
  complexity: "simple" | "moderate" | "complex";
  requiresClarification: boolean;
  clarificationQuestion?: string;
  suggestedApproach: string;
  confidence: number;
  language: "es" | "en" | "pt" | "fr";
}

// -- Intent keyword registry (es | en) ------------------------------------

type KW = { es: string[]; en: string[] };
const kw = (es: string, en: string): KW => ({ es: es.split("|"), en: en.split("|") });

const INTENT_KEYWORDS: Record<string, KW> = {
  document_generation:    kw("documento word|crear documento|crea un documento|generar documento|redactar|crear word|crea un word|generar informe|hacer documento|word sobre|informe sobre|documento sobre",
                             "create document|generate document|write report|write document|create word|draft report|word about|document about"),
  spreadsheet_creation:   kw("crear excel|crea un excel|hoja de calculo|tabla de datos|generar excel|excel con|datos de ventas|excel sobre",
                             "create spreadsheet|create excel|make spreadsheet|data table|generate excel|excel with|spreadsheet about"),
  presentation_creation:  kw("crear presentacion|crea una presentacion|crear powerpoint|crea un powerpoint|hacer ppt|crear diapositivas|generar slides|presentacion sobre|powerpoint sobre|ppt sobre",
                             "create presentation|create powerpoint|make ppt|create slides|generate slides|presentation about|powerpoint about"),
  pdf_generation:         kw("crear pdf|generar pdf|reporte pdf|exportar pdf|crea un pdf",
                             "create pdf|generate pdf|pdf report|export pdf"),
  code_execution:         kw("ejecutar codigo|ejecuta codigo|ejecuta este codigo|correr codigo|ejecutar python|ejecuta python|correr script|ejecutar javascript",
                             "run code|execute code|run this code|run python|run script|execute javascript"),
  code_generation:        kw("escribir codigo|crear funcion|programar|crear script|crear api|generar codigo|codigo para|programa que",
                             "write code|create function|program|create script|create api|generate code|code for|program that"),
  web_search:             kw("buscar|busca|buscar en internet|buscar informacion|encontrar en la web|investiga|informacion sobre|que es",
                             "search|find|search the internet|look up|find information|search the web|research|what is"),
  data_analysis:          kw("analizar datos|analisis de datos|analizar tabla|analizar csv|estadisticas|grafico|graficos|chart",
                             "analyze data|data analysis|analyze table|analyze csv|statistics|chart|graph|visualize"),
  image_generation:       kw("crear imagen|generar imagen|dibujar|crear foto|crear ilustracion|genera una imagen",
                             "create image|generate image|draw|create photo|create illustration|generate a picture"),
  web_automation:         kw("navegar a|abrir pagina|ir a|abrir sitio|abrir url|visitar",
                             "navigate to|open page|go to|open website|open url|browse to|visit"),
  research:               kw("investigar|investigacion|investigar sobre|explorar tema|estudio sobre",
                             "research|investigate|explore topic|study about|deep dive"),
  diagram:                kw("diagrama|diagrama de flujo|flowchart|diagrama de secuencia|diagrama de clases|diagrama er|arquitectura del sistema|mapa de procesos|diagrama mermaid",
                             "diagram|flowchart|flow chart|sequence diagram|class diagram|er diagram|system architecture|process map|mermaid diagram"),
  file_operation:         kw("leer archivo|abrir archivo|crear archivo|guardar archivo",
                             "read file|open file|create file|save file"),
  calculation:            kw("calcular|cuanto es|sumar|multiplicar|formula",
                             "calculate|how much is|add up|multiply|formula|compute"),
  translation:            kw("traducir|traduccion|traducir al|pasar a idioma",
                             "translate|translation|translate to|convert language"),
  chat_general:           { es: [], en: [] },
};

// -- Suggested-approach templates -----------------------------------------

const APPROACHES: Record<string, [string, string]> = {
  document_generation:   ["Crearé el documento solicitado con el formato adecuado",       "I will create the requested document with proper formatting"],
  spreadsheet_creation:  ["Generaré la hoja de cálculo con los datos estructurados",      "I will generate the spreadsheet with structured data"],
  presentation_creation: ["Crearé la presentación con diapositivas organizadas",          "I will create the presentation with organized slides"],
  pdf_generation:        ["Generaré el PDF con el contenido formateado",                  "I will generate the PDF with formatted content"],
  code_execution:        ["Ejecutaré el código en un entorno seguro",                     "I will execute the code in a safe environment"],
  code_generation:       ["Escribiré el código solicitado siguiendo buenas prácticas",    "I will write the requested code following best practices"],
  web_search:            ["Buscaré en internet la información solicitada",                "I will search the internet for the requested information"],
  data_analysis:         ["Analizaré los datos y presentaré los resultados",              "I will analyze the data and present the results"],
  image_generation:      ["Generaré la imagen según la descripción proporcionada",        "I will generate the image based on the provided description"],
  web_automation:        ["Navegaré al sitio web y realizaré las acciones solicitadas",   "I will navigate to the website and perform the requested actions"],
  research:              ["Investigaré el tema en profundidad y resumiré los hallazgos",  "I will research the topic in depth and summarize the findings"],
  file_operation:        ["Procesaré el archivo según lo solicitado",                     "I will process the file as requested"],
  calculation:           ["Realizaré el cálculo solicitado",                              "I will perform the requested calculation"],
  translation:           ["Traduciré el texto al idioma indicado",                        "I will translate the text to the specified language"],
  chat_general:          ["Responderé a tu consulta directamente",                        "I will respond to your query directly"],
};

function getApproach(intent: string, lang: "es" | "en" | "pt" | "fr"): string {
  const pair = APPROACHES[intent] ?? APPROACHES.chat_general;
  return lang === "es" ? pair[0] : pair[1];
}

// -- Language detection ----------------------------------------------------

const ES_MARKERS = ["crear","hacer","buscar","generar","hola","quiero","necesito","puedes","donde","porque","datos","archivo","documento","imagen","pagina","codigo","tabla","por favor"];
const PT_MARKERS = ["criar","fazer","procurar","gerar","olá","quero","preciso","pode","onde","quando","dados","arquivo","imagem","página","código"];
const FR_MARKERS = ["créer","faire","chercher","générer","bonjour","je veux","besoin","pouvez","comment","où","quand","données","fichier"];

export function detectLanguage(text: string): "es" | "en" | "pt" | "fr" {
  const lower = text.toLowerCase();
  const count = (m: string[]) => m.filter((w) => lower.includes(w)).length;
  const es = count(ES_MARKERS), pt = count(PT_MARKERS), fr = count(FR_MARKERS);
  if (es >= 2) return "es";
  if (pt >= 2) return "pt";
  if (fr >= 2) return "fr";
  if (es === 1 && pt === 0 && fr === 0) return "es";
  return "en";
}

// -- Public helpers --------------------------------------------------------

export function getIntentKeywords(intent: string): { es: string[]; en: string[] } {
  return INTENT_KEYWORDS[intent] ?? { es: [], en: [] };
}

// -- Core matching ---------------------------------------------------------

function matchIntent(message: string): IntentMatch[] {
  const lower = message.toLowerCase();
  const matches: IntentMatch[] = [];

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    if (intent === "chat_general") continue;
    const all = [...keywords.es, ...keywords.en];
    const matched = all.filter((k) => lower.includes(k));
    if (matched.length > 0) {
      matches.push({
        intent,
        confidence: Math.min(0.95, 0.4 + matched.length * 0.18),
        matchedKeywords: matched,
        reasoning: `Detected ${matched.map((k) => `'${k}'`).join(" + ")} → ${intent}`,
      });
    }
  }
  matches.sort((a, b) => b.confidence - a.confidence);
  return matches;
}

// -- Contextual boosting ---------------------------------------------------

export function boostFromContext(
  intents: IntentMatch[],
  history: Array<{ role: string; content: string }>,
): IntentMatch[] {
  if (history.length === 0) return intents;

  const recentText = history.slice(-2).map((m) => m.content).join(" ");
  const contextNames = new Set(matchIntent(recentText).map((ci) => ci.intent));
  if (contextNames.size === 0) return intents;

  return intents.map((i) =>
    contextNames.has(i.intent)
      ? { ...i, confidence: Math.min(1, i.confidence + 0.15), reasoning: `${i.reasoning} (boosted +0.15 from context)` }
      : i,
  );
}

// -- Complexity ------------------------------------------------------------

function classifyComplexity(msg: string, matches: IntentMatch[]): "simple" | "moderate" | "complex" {
  if (matches.length >= 2 || msg.length > 200) return "complex";
  if (msg.length > 50) return "moderate";
  return "simple";
}

// -- Clarification questions per language ----------------------------------

const CLARIFY: Record<string, string> = {
  es: "¿Podrías darme más detalles sobre lo que necesitas?",
  pt: "Poderia me dar mais detalhes sobre o que precisa?",
  fr: "Pourriez-vous me donner plus de détails sur ce dont vous avez besoin ?",
  en: "Could you give me more details about what you need?",
};

// -- Main classifier -------------------------------------------------------

export function classifyIntent(
  message: string,
  conversationHistory?: Array<{ role: string; content: string }>,
  userPreferences?: { preferredTools?: string[] },
): ClassifiedIntent {
  const language = detectLanguage(message);
  let matches = matchIntent(message);

  // Contextual boosting from recent conversation
  if (conversationHistory?.length) {
    matches = boostFromContext(matches, conversationHistory);
    matches.sort((a, b) => b.confidence - a.confidence);
  }

  // Boost intents aligned with user-preferred tools
  if (userPreferences?.preferredTools?.length) {
    const prefs = new Set(userPreferences.preferredTools.map((t) => t.toLowerCase()));
    matches = matches.map((m) => prefs.has(m.intent) ? { ...m, confidence: Math.min(1, m.confidence + 0.1) } : m);
    matches.sort((a, b) => b.confidence - a.confidence);
  }

  const primary: IntentMatch = matches[0] ?? {
    intent: "chat_general", confidence: 0.3, matchedKeywords: [],
    reasoning: "No specific intent keywords detected; defaulting to general chat",
  };
  const secondary = matches.length >= 2 ? matches[1] : undefined;
  const complexity = classifyComplexity(message, matches);

  // Clarification when confidence is low or message too short (unless greeting)
  const isGreeting = /^(hola|hi|hello|hey|ola|bonjour)$/i.test(message.trim());
  const needsClarification = primary.confidence < 0.5 || (message.trim().length < 10 && !isGreeting);

  // Suggested approach -- combine primary + secondary when multi-intent
  let suggestedApproach: string;
  if (secondary) {
    const p = getApproach(primary.intent, language);
    const s = getApproach(secondary.intent, language);
    const join = language === "es" ? " y luego " : ", then ";
    suggestedApproach = `${p}${join}${s.charAt(0).toLowerCase()}${s.slice(1)}`;
  } else {
    suggestedApproach = getApproach(primary.intent, language);
  }

  const overallConfidence = secondary
    ? primary.confidence * 0.7 + secondary.confidence * 0.3
    : primary.confidence;

  return {
    primary,
    secondary,
    complexity,
    requiresClarification: needsClarification,
    clarificationQuestion: needsClarification ? CLARIFY[language] : undefined,
    suggestedApproach,
    confidence: Math.round(overallConfidence * 100) / 100,
    language,
  };
}
