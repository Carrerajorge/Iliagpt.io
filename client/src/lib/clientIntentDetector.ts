
export type IntentType =
    | "research"
    | "data_analysis"
    | "code_generation"
    | "spreadsheet_creation"
    | "document_generation"
    | "presentation_creation"
    | "web_automation"
    | "document_analysis"
    | "chat";

const INTENT_PATTERNS: Record<Exclude<IntentType, "chat">, RegExp[]> = {
    research: [
        /\b(investiga|busca|encuentra|search|find|research|look up|investigar)\b/i,
        /\b(qué es|what is|cuál es|who is|quién es)\b/i,
        /\b(información sobre|info about|datos de)\b/i
    ],
    document_analysis: [
        /\b(analiza|analyze|revisa|review|examina|examine)\b.*\b(documento|document|archivo|file|pdf|excel|word)\b/i,
        /\b(resume|summarize|extrae|extract)\b.*\b(de|from)\b/i
    ],
    document_generation: [
        /\b(crea|create|genera|generate|escribe|write|redacta|draft)\b.*\b(documento|document|informe|report|carta|letter)\b/i,
        /\b(hazme|make me|prepara|prepare)\b.*\b(un|a)\b/i
    ],
    presentation_creation: [
        /\b(crea|create|genera|generate|hazme|make)\b.*\b(presentación|presentation|ppt|powerpoint|slides|diapositivas)\b/i
    ],
    spreadsheet_creation: [
        /\b(crea|create|genera|generate|hazme|make)\b.*\b(excel|spreadsheet|hoja de cálculo|tabla|table)\b/i
    ],
    data_analysis: [
        /\b(analiza|analyze|procesa|process)\b.*\b(datos|data|números|numbers|estadísticas|statistics)\b/i,
        /\b(gráfico|chart|graph|visualiza|visualize)\b/i
    ],
    code_generation: [
        /\b(código|code|programa|program|script|función|function|app|aplicación|application)\b/i,
        /\b(implementa|implement|desarrolla|develop|crea|create)\b.*\b(en|in)\b.*\b(python|javascript|typescript|java|c\+\+)\b/i
    ],
    web_automation: [
        /\b(navega|navigate|abre|open|visita|visit|scrape|extrae de)\b.*\b(web|página|page|sitio|site|url)\b/i,
        /\b(automatiza|automate)\b.*\b(browser|navegador)\b/i
    ]
};

export function detectClientIntent(message: string): IntentType {
    const lowerMessage = message.toLowerCase();

    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
        for (const pattern of patterns) {
            if (pattern.test(lowerMessage)) {
                return intent as IntentType;
            }
        }
    }

    return "chat";
}
