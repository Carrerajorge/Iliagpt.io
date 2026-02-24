/**
 * Contextual Personas Service - ILIAGPT PRO 3.0
 * 
 * Adaptive AI personalities based on context.
 * User preferences, task type, and conversation history.
 */

// ============== Types ==============

export interface Persona {
    id: string;
    name: string;
    description: string;
    traits: PersonaTrait[];
    systemPrompt: string;
    responseStyle: ResponseStyle;
    triggers: PersonaTrigger[];
    priority: number;
    enabled: boolean;
}

export interface PersonaTrait {
    name: string;
    intensity: number; // 0-1
    examples?: string[];
}

export interface ResponseStyle {
    formality: "casual" | "neutral" | "formal";
    verbosity: "concise" | "balanced" | "detailed";
    tone: "friendly" | "professional" | "technical" | "creative";
    language?: string;
    useEmoji: boolean;
    useMarkdown: boolean;
}

export interface PersonaTrigger {
    type: "keyword" | "context" | "user_preference" | "task_type" | "time";
    value: string | string[];
    weight: number;
}

export interface PersonaMatch {
    persona: Persona;
    score: number;
    matchedTriggers: string[];
}

export interface ContextualInput {
    message: string;
    conversationHistory?: { role: string; content: string }[];
    userPreferences?: UserPersonaPreferences;
    taskType?: string;
    currentTime?: Date;
    metadata?: Record<string, any>;
}

export interface UserPersonaPreferences {
    preferredPersona?: string;
    formality?: "casual" | "neutral" | "formal";
    verbosity?: "concise" | "balanced" | "detailed";
    language?: string;
    disabledPersonas?: string[];
}

// ============== Default Personas ==============

const DEFAULT_PERSONAS: Omit<Persona, 'id'>[] = [
    {
        name: "Asistente General",
        description: "Asistente amigable y versátil para tareas cotidianas",
        traits: [
            { name: "helpful", intensity: 0.9 },
            { name: "friendly", intensity: 0.8 },
            { name: "clear", intensity: 0.85 },
        ],
        systemPrompt: "Eres un asistente amigable y útil. Responde de manera clara y concisa, usando un tono cálido pero profesional.",
        responseStyle: {
            formality: "neutral",
            verbosity: "balanced",
            tone: "friendly",
            useEmoji: true,
            useMarkdown: true,
        },
        triggers: [
            { type: "context", value: "general", weight: 0.5 },
        ],
        priority: 1,
        enabled: true,
    },
    {
        name: "Experto Técnico",
        description: "Especialista en programación y sistemas",
        traits: [
            { name: "precise", intensity: 0.95 },
            { name: "technical", intensity: 0.9 },
            { name: "educational", intensity: 0.7 },
        ],
        systemPrompt: "Eres un experto senior en desarrollo de software con amplia experiencia. Proporciona respuestas técnicas precisas con ejemplos de código cuando sea apropiado. Explica conceptos complejos de manera clara.",
        responseStyle: {
            formality: "formal",
            verbosity: "detailed",
            tone: "technical",
            useEmoji: false,
            useMarkdown: true,
        },
        triggers: [
            { type: "keyword", value: ["código", "code", "programar", "debug", "error", "api", "función", "class"], weight: 0.9 },
            { type: "task_type", value: "coding", weight: 0.95 },
        ],
        priority: 10,
        enabled: true,
    },
    {
        name: "Analista de Datos",
        description: "Especialista en análisis y visualización de datos",
        traits: [
            { name: "analytical", intensity: 0.95 },
            { name: "methodical", intensity: 0.85 },
            { name: "insightful", intensity: 0.8 },
        ],
        systemPrompt: "Eres un analista de datos experto. Ayuda a interpretar datos, crear visualizaciones y extraer insights significativos. Usa estadísticas y métricas cuando sea relevante.",
        responseStyle: {
            formality: "formal",
            verbosity: "detailed",
            tone: "professional",
            useEmoji: false,
            useMarkdown: true,
        },
        triggers: [
            { type: "keyword", value: ["datos", "data", "gráfico", "chart", "estadística", "análisis", "métricas"], weight: 0.9 },
            { type: "task_type", value: "analysis", weight: 0.95 },
        ],
        priority: 10,
        enabled: true,
    },
    {
        name: "Escritor Creativo",
        description: "Asistente para escritura creativa y contenido",
        traits: [
            { name: "creative", intensity: 0.95 },
            { name: "imaginative", intensity: 0.9 },
            { name: "expressive", intensity: 0.85 },
        ],
        systemPrompt: "Eres un escritor creativo talentoso. Ayuda a crear contenido atractivo, historias, textos publicitarios y comunicaciones con estilo único y cautivador.",
        responseStyle: {
            formality: "casual",
            verbosity: "balanced",
            tone: "creative",
            useEmoji: true,
            useMarkdown: true,
        },
        triggers: [
            { type: "keyword", value: ["escribir", "write", "historia", "story", "contenido", "blog", "texto", "creativo"], weight: 0.9 },
            { type: "task_type", value: "writing", weight: 0.95 },
        ],
        priority: 10,
        enabled: true,
    },
    {
        name: "Consultor de Negocios",
        description: "Asesor estratégico empresarial",
        traits: [
            { name: "strategic", intensity: 0.9 },
            { name: "business-savvy", intensity: 0.95 },
            { name: "practical", intensity: 0.85 },
        ],
        systemPrompt: "Eres un consultor de negocios experimentado. Proporciona consejos estratégicos, ayuda con planes de negocio, análisis de mercado y decisiones empresariales.",
        responseStyle: {
            formality: "formal",
            verbosity: "balanced",
            tone: "professional",
            useEmoji: false,
            useMarkdown: true,
        },
        triggers: [
            { type: "keyword", value: ["negocio", "business", "estrategia", "startup", "empresa", "mercado", "ventas"], weight: 0.9 },
            { type: "task_type", value: "business", weight: 0.95 },
        ],
        priority: 10,
        enabled: true,
    },
    {
        name: "Tutor Educativo",
        description: "Profesor paciente para aprendizaje",
        traits: [
            { name: "patient", intensity: 0.95 },
            { name: "educational", intensity: 0.9 },
            { name: "encouraging", intensity: 0.85 },
        ],
        systemPrompt: "Eres un tutor paciente y motivador. Explica conceptos paso a paso, usa ejemplos simples, y adapta las explicaciones al nivel del estudiante. Fomenta el aprendizaje activo.",
        responseStyle: {
            formality: "neutral",
            verbosity: "detailed",
            tone: "friendly",
            useEmoji: true,
            useMarkdown: true,
        },
        triggers: [
            { type: "keyword", value: ["aprender", "learn", "explicar", "explain", "entender", "cómo funciona", "tutorial"], weight: 0.85 },
            { type: "task_type", value: "learning", weight: 0.9 },
        ],
        priority: 8,
        enabled: true,
    },
    {
        name: "Modo Rápido",
        description: "Respuestas ultra-concisas para usuarios avanzados",
        traits: [
            { name: "concise", intensity: 1.0 },
            { name: "direct", intensity: 0.95 },
        ],
        systemPrompt: "Responde de forma ultra-concisa. Solo lo esencial. Sin explicaciones innecesarias. Usa bullet points.",
        responseStyle: {
            formality: "casual",
            verbosity: "concise",
            tone: "professional",
            useEmoji: false,
            useMarkdown: true,
        },
        triggers: [
            { type: "keyword", value: ["rápido", "quick", "breve", "resumen", "tldr", "corto"], weight: 0.95 },
            { type: "user_preference", value: "concise", weight: 0.9 },
        ],
        priority: 15,
        enabled: true,
    },
];

// ============== Persona Store ==============

const personas: Map<string, Persona> = new Map();
const userPreferences: Map<string, UserPersonaPreferences> = new Map();

// ============== Contextual Personas Service ==============

export class ContextualPersonasService {
    constructor() {
        // Register default personas
        for (const persona of DEFAULT_PERSONAS) {
            this.registerPersona(persona);
        }
    }

    // ======== Persona Management ========

    /**
     * Register a new persona
     */
    registerPersona(personaDef: Omit<Persona, 'id'>): Persona {
        const id = `persona_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const persona: Persona = { ...personaDef, id };
        personas.set(id, persona);
        return persona;
    }

    /**
     * Update persona
     */
    updatePersona(id: string, updates: Partial<Omit<Persona, 'id'>>): Persona | null {
        const persona = personas.get(id);
        if (!persona) return null;

        Object.assign(persona, updates);
        return persona;
    }

    /**
     * Get persona
     */
    getPersona(id: string): Persona | undefined {
        return personas.get(id);
    }

    /**
     * List personas
     */
    listPersonas(): Persona[] {
        return Array.from(personas.values()).filter(p => p.enabled);
    }

    // ======== Persona Selection ========

    /**
     * Select best persona for context
     */
    selectPersona(input: ContextualInput): PersonaMatch {
        const matches: PersonaMatch[] = [];
        const prefs = input.userPreferences || {};

        for (const persona of personas.values()) {
            if (!persona.enabled) continue;
            if (prefs.disabledPersonas?.includes(persona.id)) continue;

            // Check if matches preferred persona
            if (prefs.preferredPersona === persona.id) {
                return { persona, score: 1.0, matchedTriggers: ["user_preference"] };
            }

            const { score, matchedTriggers } = this.calculateMatch(persona, input);

            if (score > 0) {
                matches.push({ persona, score, matchedTriggers });
            }
        }

        // Sort by score and priority
        matches.sort((a, b) => {
            const scoreDiff = b.score - a.score;
            if (Math.abs(scoreDiff) > 0.1) return scoreDiff;
            return b.persona.priority - a.persona.priority;
        });

        // Return best match or default
        return matches[0] || {
            persona: this.getDefaultPersona(),
            score: 0.5,
            matchedTriggers: ["default"],
        };
    }

    /**
     * Calculate match score
     */
    private calculateMatch(persona: Persona, input: ContextualInput): {
        score: number;
        matchedTriggers: string[];
    } {
        let totalScore = 0;
        let totalWeight = 0;
        const matchedTriggers: string[] = [];

        for (const trigger of persona.triggers) {
            const match = this.checkTrigger(trigger, input);
            if (match) {
                totalScore += trigger.weight;
                matchedTriggers.push(`${trigger.type}:${Array.isArray(trigger.value) ? trigger.value.join(",") : trigger.value}`);
            }
            totalWeight += trigger.weight;
        }

        return {
            score: totalWeight > 0 ? totalScore / totalWeight : 0,
            matchedTriggers,
        };
    }

    /**
     * Check if trigger matches
     */
    private checkTrigger(trigger: PersonaTrigger, input: ContextualInput): boolean {
        switch (trigger.type) {
            case "keyword": {
                const keywords = Array.isArray(trigger.value) ? trigger.value : [trigger.value];
                const text = input.message.toLowerCase();
                return keywords.some(k => text.includes(k.toLowerCase()));
            }

            case "task_type": {
                return input.taskType === trigger.value;
            }

            case "user_preference": {
                const prefs = input.userPreferences;
                if (!prefs) return false;
                return prefs.formality === trigger.value ||
                    prefs.verbosity === trigger.value;
            }

            case "time": {
                const hour = (input.currentTime || new Date()).getHours();
                if (trigger.value === "morning") return hour >= 5 && hour < 12;
                if (trigger.value === "afternoon") return hour >= 12 && hour < 17;
                if (trigger.value === "evening") return hour >= 17 && hour < 22;
                if (trigger.value === "night") return hour >= 22 || hour < 5;
                return false;
            }

            case "context": {
                // Check conversation history for context
                if (!input.conversationHistory) return false;
                const history = input.conversationHistory.map(m => m.content).join(" ");
                return history.toLowerCase().includes(String(trigger.value).toLowerCase());
            }

            default:
                return false;
        }
    }

    /**
     * Get default persona
     */
    private getDefaultPersona(): Persona {
        return Array.from(personas.values()).find(p => p.priority === 1) ||
            Array.from(personas.values())[0];
    }

    // ======== User Preferences ========

    /**
     * Set user preferences
     */
    setUserPreferences(userId: string, prefs: UserPersonaPreferences): void {
        userPreferences.set(userId, prefs);
    }

    /**
     * Get user preferences
     */
    getUserPreferences(userId: string): UserPersonaPreferences | undefined {
        return userPreferences.get(userId);
    }

    // ======== System Prompt Generation ========

    /**
     * Generate complete system prompt
     */
    generateSystemPrompt(input: ContextualInput): {
        systemPrompt: string;
        persona: Persona;
        style: ResponseStyle;
    } {
        const { persona } = this.selectPersona(input);
        const prefs = input.userPreferences || {};

        // Apply user preference overrides
        const style: ResponseStyle = {
            ...persona.responseStyle,
            formality: prefs.formality || persona.responseStyle.formality,
            verbosity: prefs.verbosity || persona.responseStyle.verbosity,
            language: prefs.language || persona.responseStyle.language,
        };

        // Build prompt
        let prompt = persona.systemPrompt;

        // Add style instructions
        const styleInstructions: string[] = [];

        if (style.formality === "formal") {
            styleInstructions.push("Usa un tono formal y profesional.");
        } else if (style.formality === "casual") {
            styleInstructions.push("Usa un tono casual y cercano.");
        }

        if (style.verbosity === "concise") {
            styleInstructions.push("Sé muy breve y conciso.");
        } else if (style.verbosity === "detailed") {
            styleInstructions.push("Proporciona explicaciones detalladas.");
        }

        if (!style.useEmoji) {
            styleInstructions.push("No uses emojis.");
        }

        if (style.language) {
            styleInstructions.push(`Responde en ${style.language}.`);
        }

        if (styleInstructions.length > 0) {
            prompt += "\n\n" + styleInstructions.join(" ");
        }

        return { systemPrompt: prompt, persona, style };
    }

    /**
     * Detect task type from message
     */
    detectTaskType(message: string): string {
        const patterns: [RegExp, string][] = [
            [/\b(código|code|programar|debug|función|class|api)\b/i, "coding"],
            [/\b(datos|data|análisis|metrics|gráfico|chart)\b/i, "analysis"],
            [/\b(escribir|write|blog|artículo|historia|story)\b/i, "writing"],
            [/\b(negocio|business|estrategia|startup|mercado)\b/i, "business"],
            [/\b(aprender|learn|explicar|cómo|tutorial)\b/i, "learning"],
        ];

        for (const [pattern, type] of patterns) {
            if (pattern.test(message)) return type;
        }

        return "general";
    }
}

// ============== Singleton ==============

let personasInstance: ContextualPersonasService | null = null;

export function getContextualPersonas(): ContextualPersonasService {
    if (!personasInstance) {
        personasInstance = new ContextualPersonasService();
    }
    return personasInstance;
}

export default ContextualPersonasService;
