/**
 * Answer-First Enforcer Service
 * 
 * Ensures that the agent's first sentence directly answers the user's question.
 * Critical for preventing verbose, unhelpful responses.
 */

import { QuestionClassification, QuestionTarget, questionClassifier } from './questionClassifier';

// =============================================================================
// Types
// =============================================================================

export interface AnswerFirstContext {
    userQuestion: string;
    classification: QuestionClassification;
    documentContext?: string;
    enforceStrictMode: boolean;
}

export interface AnswerFirstSystemPrompt {
    fullPrompt: string;
    constraints: string[];
    formatInstructions: string;
    maxTokens: number;
}

export interface ResponseValidation {
    isValid: boolean;
    firstSentenceAnswers: boolean;
    hasRequiredCitation: boolean;
    isWithinLength: boolean;
    issues: string[];
    suggestions: string[];
}

// =============================================================================
// System Prompt Templates
// =============================================================================

const BASE_SYSTEM_PROMPT = `Eres Ilia, un asistente de inteligencia artificial de clase mundial: preciso, directo, cálido, curioso y empático.

TU OBJETIVO PRINCIPAL: Responder EXACTAMENTE lo que el usuario pregunta, siguiendo fielmente sus instrucciones.

REGLAS OBLIGATORIAS (en orden de prioridad):
1. INSTRUCCIONES DEL USUARIO SON PRIORIDAD MÁXIMA: Si el usuario especifica un formato (número de párrafos, extensión, estructura, idioma, tono), sigue esas instrucciones AL PIE DE LA LETRA, incluso si contradicen las reglas de formato por defecto de abajo
2. Tu PRIMERA frase debe contener la respuesta directa a la pregunta
3. NO uses "RESUMEN EJECUTIVO" a menos que se solicite explícitamente
4. NO hagas resúmenes automáticos de documentos
5. Si el usuario hace una pregunta específica, responde SOLO esa pregunta
6. Cita siempre la fuente cuando respondas sobre un documento
7. Fundamenta con evidencia: distingue hechos verificados de inferencias y marca incertidumbre
8. Responde en el mismo idioma que el usuario utiliza, salvo que indique otro

SOBRE EXTENSIÓN Y COMPLETITUD:
- Cuando el usuario pide una extensión específica (e.g. "en 2 párrafos", "500 palabras", "una lista de 10 items"), cúmplela fielmente
- Para preguntas abiertas o complejas, da respuestas completas y bien desarrolladas — no te autocensures ni acortes prematuramente
- Prefiere una respuesta completa y útil sobre una respuesta artificialmente corta`;

const STRICT_ANSWER_FIRST_RULES = `
REGLA CRÍTICA - ANSWER-FIRST:
- Tu respuesta DEBE empezar con la respuesta directa
- NO uses introducciones como "Basándome en el documento..." o "El documento indica..."
- NO uses "RESUMEN EJECUTIVO" ni "HALLAZGOS CLAVE"
- La primera frase debe ser el DATO CONCRETO que el usuario busca

EJEMPLOS DE RESPUESTAS CORRECTAS:
Usuario: "¿Qué día es el vuelo?"
✓ CORRECTO: "El vuelo es el 19 de enero de 2026, con salida a las 09:25 [documento p:1]."
✗ INCORRECTO: "RESUMEN EJECUTIVO: El documento detalla información de un boleto..."
✗ INCORRECTO: "Basándome en el documento adjunto, puedo informarte que..."

Usuario: "¿Cuánto cuesta el boleto?"
✓ CORRECTO: "El boleto cuesta USD 360.64 en total (USD 280.00 + USD 80.64 de impuestos) [documento p:1]."
✗ INCORRECTO: "El documento contiene información detallada sobre los costos..."`;

// Lite rules for non-document contexts. Gemini (and other providers) can behave
// strangely with very verbose system prompts for trivial questions, and citation
// requirements don't apply when no documents were provided.
const STRICT_ANSWER_FIRST_RULES_LITE = `
REGLA CRÍTICA - ANSWER-FIRST:
- Empieza con la respuesta directa (sin introducciones).
- Si es Sí/No: empieza con "Sí" o "No".
- Sé conciso. No agregues información no solicitada.
- No inventes citas ni fuentes si NO hay documentos adjuntos.`;

// =============================================================================
// Format Instructions by Question Type
// =============================================================================

function getFormatInstructions(classification: QuestionClassification, hasDocuments: boolean): string {
    const { type, maxCharacters, extractedTarget } = classification;

    switch (type) {
        case 'factual_simple':
            return `
FORMATO POR DEFECTO (salvo que el usuario indique otro formato):
- Respuesta directa y concisa
- Incluye el dato exacto que busca el usuario${extractedTarget ? `: ${extractedTarget.entity}` : ''}
- ${hasDocuments ? 'Incluye cita [documento p:X]' : 'NO inventes citas ni fuentes'}
- Si el usuario pide una extensión o formato específico, sigue esas instrucciones en vez de estas`;

        case 'yes_no':
            return `
FORMATO POR DEFECTO (salvo que el usuario indique otro formato):
- Primera palabra: "Sí" o "No"
- Seguido de explicación breve
- ${hasDocuments ? 'Incluye cita del documento' : 'NO inventes citas ni fuentes'}`;

        case 'factual_multiple':
            return `
FORMATO POR DEFECTO (salvo que el usuario indique otro formato):
- Lista numerada con los datos relevantes
- ${hasDocuments ? 'Cada item: dato + cita' : 'Cada item: dato (sin inventar citas)'}
- Sin explicaciones innecesarias`;

        case 'extraction':
            return `
FORMATO REQUERIDO: Lista numerada completa.
- Extrae TODOS los items solicitados
- ${hasDocuments ? 'Formato: número. dato [cita]' : 'Formato: número. dato'}
- Sin comentarios adicionales`;

        case 'summary':
            return `
FORMATO PERMITIDO: Resumen estructurado.
Puedes usar secciones como RESUMEN EJECUTIVO, HALLAZGOS CLAVE, etc.
El usuario ha solicitado explícitamente un resumen.`;

        case 'analysis':
            return `
FORMATO PERMITIDO: Análisis detallado.
Puedes estructurar con secciones y profundizar.
El usuario ha solicitado explícitamente un análisis.`;

        case 'greeting':
            return `
FORMATO REQUERIDO: Saludo breve y natural.
- Responde al saludo de forma cordial
- Máximo 1-2 frases
- Si hay contexto de documento, ofrece ayudar brevemente`;

        default:
            return `
FORMATO POR DEFECTO (salvo que el usuario indique otro formato):
- Responde directamente lo que se pregunta
- Da una respuesta completa y bien desarrollada
- ${hasDocuments ? 'Incluye citas del documento' : 'No inventes citas ni fuentes'}`;
    }
}

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Build an Answer-First system prompt based on question classification
 */
export function buildAnswerFirstPrompt(context: AnswerFirstContext): AnswerFirstSystemPrompt {
    const { userQuestion, classification, documentContext, enforceStrictMode } = context;

    const constraints: string[] = [];
    const parts: string[] = [BASE_SYSTEM_PROMPT];
    const hasDocuments = !!documentContext;

    // Add strict rules for factual questions
    if (classification.type === 'factual_simple' ||
        classification.type === 'yes_no' ||
        classification.type === 'factual_multiple') {
        parts.push(hasDocuments ? STRICT_ANSWER_FIRST_RULES : STRICT_ANSWER_FIRST_RULES_LITE);
        constraints.push('Primera frase debe ser la respuesta directa');
        constraints.push('NO usar RESUMEN EJECUTIVO');
        constraints.push(`Máximo ${classification.maxCharacters} caracteres`);
    }

    // Format instructions
    const formatInstructions = getFormatInstructions(classification, hasDocuments);
    parts.push(formatInstructions);

    // Document context instructions
    if (documentContext) {
        parts.push(`
CONTEXTO DEL DOCUMENTO:
El usuario ha adjuntado un documento. Usa la información del documento para responder.
${classification.requiresCitation ? 'SIEMPRE cita la fuente: [documento p:X] o [hoja:X celda:Y]' : ''}`);
        constraints.push('Citar fuente del documento');
    }

    // Target entity hint
    if (classification.extractedTarget) {
        const { entity, context: ctx, expectedType } = classification.extractedTarget;
        parts.push(`
EL USUARIO BUSCA: ${entity}${ctx ? ` (contexto: ${ctx})` : ''}
Tipo de dato esperado: ${expectedType || 'texto'}`);
        constraints.push(`Buscar y responder: ${entity}`);
    }

    // Enforce mode
    if (enforceStrictMode) {
        parts.push(`
MODO ESTRICTO ACTIVADO:
- CERO tolerancia para respuestas largas a preguntas simples
- Si la pregunta es factual, la respuesta debe ser el DATO PURO
- Cualquier respuesta que empiece con resumen será rechazada`);
    }

    return {
        fullPrompt: parts.join('\n\n'),
        constraints,
        formatInstructions,
        maxTokens: classification.maxTokens
    };
}

/**
 * Generate the complete Answer-First system prompt for a user question
 */
export function generateAnswerFirstSystemPrompt(
    userQuestion: string,
    hasDocuments: boolean = false,
    documentContext?: string
): AnswerFirstSystemPrompt {
    const classification = questionClassifier.classifyQuestion(userQuestion);

    // Enable strict mode for factual questions
    const enforceStrictMode =
        classification.type === 'factual_simple' ||
        classification.type === 'yes_no';

    return buildAnswerFirstPrompt({
        userQuestion,
        classification,
        documentContext: hasDocuments ? documentContext : undefined,
        enforceStrictMode
    });
}

/**
 * Validate if a response follows Answer-First principles
 */
export function validateAnswerFirstResponse(
    response: string,
    classification: QuestionClassification
): ResponseValidation {
    const issues: string[] = [];
    const suggestions: string[] = [];

    const trimmedResponse = response.trim();
    const firstSentence = trimmedResponse.split(/[.!?]/)[0] || '';

    // Check for forbidden patterns in factual questions
    const forbiddenPatterns = [
        /^RESUMEN EJECUTIVO/i,
        /^El documento (contiene|detalla|presenta|muestra)/i,
        /^Basándome en/i,
        /^De acuerdo (con|al) (el|la) documento/i,
        /^HALLAZGOS CLAVE/i,
        /^DATOS Y MÉTRICAS/i,
    ];

    let firstSentenceAnswers = true;

    if (classification.type === 'factual_simple' || classification.type === 'yes_no') {
        for (const pattern of forbiddenPatterns) {
            if (pattern.test(trimmedResponse)) {
                firstSentenceAnswers = false;
                issues.push(`Respuesta comienza con patrón prohibido: "${pattern.source}"`);
                suggestions.push('Comienza directamente con el dato solicitado');
                break;
            }
        }
    }

    // Check for yes/no format
    if (classification.type === 'yes_no') {
        if (!/^(sí|si|no)\b/i.test(trimmedResponse)) {
            firstSentenceAnswers = false;
            issues.push('Pregunta Sí/No debe empezar con "Sí" o "No"');
            suggestions.push('Inicia tu respuesta con "Sí" o "No" explícitamente');
        }
    }

    // Check for citation
    const hasCitation = /\[(documento|doc|hoja|sheet|slide|p:?\d*|página)\s*[:\d\w]*\]/i.test(trimmedResponse);
    const hasRequiredCitation = classification.requiresCitation ? hasCitation : true;

    if (classification.requiresCitation && !hasCitation) {
        issues.push('Falta cita del documento');
        suggestions.push('Añade [documento p:X] al final de la respuesta');
    }

    // Check length
    const isWithinLength = trimmedResponse.length <= classification.maxCharacters * 1.2; // 20% tolerance

    if (!isWithinLength) {
        issues.push(`Respuesta muy larga: ${trimmedResponse.length} caracteres (máximo: ${classification.maxCharacters})`);
        suggestions.push('Reduce la respuesta al dato esencial');
    }

    // Check if first sentence likely contains the answer
    if (classification.extractedTarget) {
        const { expectedType } = classification.extractedTarget;

        if (expectedType === 'date') {
            const hasDate = /\d{1,2}\s+(?:de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|\d{1,2}[\/\-]\d{1,2})/i.test(firstSentence);
            if (!hasDate) {
                issues.push('Primera frase no contiene la fecha solicitada');
                suggestions.push('Incluye la fecha en la primera frase');
            }
        }

        if (expectedType === 'currency') {
            const hasCurrency = /(?:USD|EUR|PEN|S\/|US\$|\$)\s*[\d,.]+/i.test(firstSentence);
            if (!hasCurrency) {
                issues.push('Primera frase no contiene el monto solicitado');
                suggestions.push('Incluye el precio en la primera frase');
            }
        }
    }

    const isValid = issues.length === 0;

    return {
        isValid,
        firstSentenceAnswers,
        hasRequiredCitation,
        isWithinLength,
        issues,
        suggestions
    };
}

/**
 * Get a repair prompt if validation fails
 */
export function getRepairPrompt(
    originalResponse: string,
    validation: ResponseValidation,
    classification: QuestionClassification
): string {
    return `Tu respuesta anterior no cumple con los requisitos. Problemas detectados:
${validation.issues.map(i => `- ${i}`).join('\n')}

CORRÍGELA siguiendo estas instrucciones:
${validation.suggestions.map(s => `- ${s}`).join('\n')}

Tu respuesta debe ser de máximo ${classification.maxCharacters} caracteres y empezar DIRECTAMENTE con el dato solicitado.

Respuesta original a corregir:
"${originalResponse.substring(0, 200)}..."

GENERA UNA NUEVA RESPUESTA:`;
}

// =============================================================================
// Export
// =============================================================================

export const answerFirstEnforcer = {
    buildAnswerFirstPrompt,
    generateAnswerFirstSystemPrompt,
    validateAnswerFirstResponse,
    getRepairPrompt,
    BASE_SYSTEM_PROMPT,
    STRICT_ANSWER_FIRST_RULES
};

export default answerFirstEnforcer;
