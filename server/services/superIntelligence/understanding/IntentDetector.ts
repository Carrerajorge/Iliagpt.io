/**
 * SUPERINTELLIGENCE - Advanced Intent Detector
 * Detector de intenciones multi-idioma con análisis semántico profundo
 * Tarea 6: Implementar detector de intenciones avanzado
 */

import { EventEmitter } from 'events';
import { Logger } from '../../../lib/logger';
import { redis } from '../../../lib/redis';

// Tipos de intención
export type IntentCategory =
  | 'query'           // Pregunta/consulta de información
  | 'task'            // Solicitud de tarea/acción
  | 'creative'        // Creación de contenido
  | 'analysis'        // Análisis de datos/documentos
  | 'code'            // Programación/desarrollo
  | 'conversation'    // Conversación casual
  | 'clarification'   // Aclaración/follow-up
  | 'feedback'        // Retroalimentación
  | 'navigation'      // Navegación/UI
  | 'system'          // Comandos del sistema
  | 'unknown';

export type IntentComplexity = 'simple' | 'moderate' | 'complex' | 'multi-step';

export type UserSentiment = 'positive' | 'neutral' | 'negative' | 'urgent' | 'frustrated';

export type Language = 'es' | 'en' | 'pt' | 'fr' | 'de' | 'it' | 'auto';

export interface Intent {
  id: string;
  category: IntentCategory;
  subcategory?: string;
  confidence: number;
  complexity: IntentComplexity;
  language: Language;
  sentiment: UserSentiment;
  entities: ExtractedEntity[];
  keywords: string[];
  actionRequired: boolean;
  suggestedAgent?: string;
  originalText: string;
  normalizedText: string;
  timestamp: Date;
}

export interface ExtractedEntity {
  type: EntityType;
  value: string;
  position: { start: number; end: number };
  confidence: number;
  metadata?: Record<string, any>;
}

export type EntityType =
  | 'person'
  | 'organization'
  | 'location'
  | 'date'
  | 'time'
  | 'money'
  | 'percentage'
  | 'email'
  | 'phone'
  | 'url'
  | 'file'
  | 'code_language'
  | 'technical_term'
  | 'product'
  | 'action_verb';

export interface IntentPattern {
  pattern: RegExp;
  category: IntentCategory;
  subcategory?: string;
  confidence: number;
  complexity: IntentComplexity;
  suggestedAgent?: string;
}

export interface LanguageDetectionResult {
  language: Language;
  confidence: number;
  alternativeLanguages: { language: Language; confidence: number }[];
}

export interface IntentAnalysisResult {
  primaryIntent: Intent;
  secondaryIntents: Intent[];
  contextualHints: string[];
  recommendedActions: string[];
  estimatedTokens: number;
  requiresMultiTurn: boolean;
}

// Patrones de intención por idioma
const INTENT_PATTERNS: Record<Language, IntentPattern[]> = {
  es: [
    // Queries
    { pattern: /^(qué|cuál|cómo|dónde|cuándo|por qué|quién)\s/i, category: 'query', confidence: 0.9, complexity: 'simple' },
    { pattern: /explica(me)?\s|describe\s|define\s/i, category: 'query', subcategory: 'explanation', confidence: 0.85, complexity: 'moderate' },
    { pattern: /busca(r)?\s|encuentra\s|investiga\s/i, category: 'query', subcategory: 'search', confidence: 0.85, complexity: 'moderate', suggestedAgent: 'research' },

    // Tasks
    { pattern: /crea(r|me)?\s|genera(r|me)?\s|haz(me)?\s|realiza(r)?\s/i, category: 'task', confidence: 0.9, complexity: 'moderate' },
    { pattern: /escribe\s|redacta\s|compone\s/i, category: 'creative', subcategory: 'writing', confidence: 0.9, complexity: 'moderate' },
    { pattern: /calcula\s|computa\s|suma\s|resta\s/i, category: 'task', subcategory: 'calculation', confidence: 0.9, complexity: 'simple' },
    { pattern: /traduce\s|traducir\s/i, category: 'task', subcategory: 'translation', confidence: 0.95, complexity: 'simple' },
    { pattern: /resume\s|resumir\s|sintetiza\s/i, category: 'task', subcategory: 'summarization', confidence: 0.9, complexity: 'moderate' },

    // Analysis
    { pattern: /analiza\s|examina\s|evalúa\s|revisa\s/i, category: 'analysis', confidence: 0.9, complexity: 'complex', suggestedAgent: 'analyst' },
    { pattern: /compara\s|diferencia\s|contrasta\s/i, category: 'analysis', subcategory: 'comparison', confidence: 0.85, complexity: 'moderate' },

    // Code
    { pattern: /programa\s|codifica\s|implementa\s|desarrolla\s/i, category: 'code', confidence: 0.9, complexity: 'complex', suggestedAgent: 'coder' },
    { pattern: /depura\s|debugea\s|corrige\s(el\s)?(código|error)/i, category: 'code', subcategory: 'debug', confidence: 0.9, complexity: 'complex', suggestedAgent: 'coder' },
    { pattern: /refactoriza\s|mejora\s(el\s)?código/i, category: 'code', subcategory: 'refactor', confidence: 0.85, complexity: 'complex', suggestedAgent: 'coder' },

    // Creative
    { pattern: /diseña\s|dibuja\s|ilustra\s/i, category: 'creative', subcategory: 'design', confidence: 0.85, complexity: 'complex' },
    { pattern: /inventa\s|imagina\s|crea\s(una\s)?historia/i, category: 'creative', subcategory: 'fiction', confidence: 0.85, complexity: 'moderate' },

    // Conversation
    { pattern: /^(hola|buenos?\s(días|tardes|noches)|hey|saludos)/i, category: 'conversation', subcategory: 'greeting', confidence: 0.95, complexity: 'simple' },
    { pattern: /^(gracias|muchas\sgracias|te\sagradezco)/i, category: 'conversation', subcategory: 'gratitude', confidence: 0.95, complexity: 'simple' },
    { pattern: /^(adiós|hasta\s(luego|pronto)|chao|nos\svemos)/i, category: 'conversation', subcategory: 'farewell', confidence: 0.95, complexity: 'simple' },

    // Clarification
    { pattern: /no\sentendí|puedes\srepetir|a\squé\ste\srefieres/i, category: 'clarification', confidence: 0.9, complexity: 'simple' },
    { pattern: /más\sdetalles|explica\smejor|sé\smás\sespecífico/i, category: 'clarification', confidence: 0.85, complexity: 'simple' },

    // System/Navigation
    { pattern: /^(ayuda|help|configuración|ajustes)/i, category: 'system', confidence: 0.95, complexity: 'simple' },
    { pattern: /cancelar|detener|parar|stop/i, category: 'system', subcategory: 'control', confidence: 0.95, complexity: 'simple' },
  ],
  en: [
    // Queries
    { pattern: /^(what|which|how|where|when|why|who)\s/i, category: 'query', confidence: 0.9, complexity: 'simple' },
    { pattern: /explain\s|describe\s|define\s/i, category: 'query', subcategory: 'explanation', confidence: 0.85, complexity: 'moderate' },
    { pattern: /search\s|find\s|look\s(for|up)/i, category: 'query', subcategory: 'search', confidence: 0.85, complexity: 'moderate', suggestedAgent: 'research' },

    // Tasks
    { pattern: /create\s|generate\s|make\s|build\s/i, category: 'task', confidence: 0.9, complexity: 'moderate' },
    { pattern: /write\s|compose\s|draft\s/i, category: 'creative', subcategory: 'writing', confidence: 0.9, complexity: 'moderate' },
    { pattern: /calculate\s|compute\s|sum\s/i, category: 'task', subcategory: 'calculation', confidence: 0.9, complexity: 'simple' },
    { pattern: /translate\s/i, category: 'task', subcategory: 'translation', confidence: 0.95, complexity: 'simple' },
    { pattern: /summarize\s|summarise\s|recap\s/i, category: 'task', subcategory: 'summarization', confidence: 0.9, complexity: 'moderate' },

    // Analysis
    { pattern: /analyze\s|analyse\s|examine\s|evaluate\s|review\s/i, category: 'analysis', confidence: 0.9, complexity: 'complex', suggestedAgent: 'analyst' },
    { pattern: /compare\s|contrast\s|differentiate\s/i, category: 'analysis', subcategory: 'comparison', confidence: 0.85, complexity: 'moderate' },

    // Code
    { pattern: /code\s|program\s|implement\s|develop\s/i, category: 'code', confidence: 0.9, complexity: 'complex', suggestedAgent: 'coder' },
    { pattern: /debug\s|fix\s(the\s)?(code|error|bug)/i, category: 'code', subcategory: 'debug', confidence: 0.9, complexity: 'complex', suggestedAgent: 'coder' },
    { pattern: /refactor\s|improve\s(the\s)?code/i, category: 'code', subcategory: 'refactor', confidence: 0.85, complexity: 'complex', suggestedAgent: 'coder' },

    // Creative
    { pattern: /design\s|draw\s|illustrate\s/i, category: 'creative', subcategory: 'design', confidence: 0.85, complexity: 'complex' },
    { pattern: /invent\s|imagine\s|create\s(a\s)?story/i, category: 'creative', subcategory: 'fiction', confidence: 0.85, complexity: 'moderate' },

    // Conversation
    { pattern: /^(hello|hi|hey|good\s(morning|afternoon|evening))/i, category: 'conversation', subcategory: 'greeting', confidence: 0.95, complexity: 'simple' },
    { pattern: /^(thanks|thank\syou|appreciate)/i, category: 'conversation', subcategory: 'gratitude', confidence: 0.95, complexity: 'simple' },
    { pattern: /^(goodbye|bye|see\syou|farewell)/i, category: 'conversation', subcategory: 'farewell', confidence: 0.95, complexity: 'simple' },

    // Clarification
    { pattern: /didn't\sunderstand|can\syou\srepeat|what\sdo\syou\smean/i, category: 'clarification', confidence: 0.9, complexity: 'simple' },
    { pattern: /more\sdetails|explain\sbetter|be\smore\sspecific/i, category: 'clarification', confidence: 0.85, complexity: 'simple' },

    // System
    { pattern: /^(help|settings|configuration)/i, category: 'system', confidence: 0.95, complexity: 'simple' },
    { pattern: /cancel|stop|abort/i, category: 'system', subcategory: 'control', confidence: 0.95, complexity: 'simple' },
  ],
  pt: [
    { pattern: /^(o\sque|qual|como|onde|quando|por\sque|quem)\s/i, category: 'query', confidence: 0.9, complexity: 'simple' },
    { pattern: /crie\s|gere\s|faça\s/i, category: 'task', confidence: 0.9, complexity: 'moderate' },
    { pattern: /analise\s|examine\s|avalie\s/i, category: 'analysis', confidence: 0.9, complexity: 'complex', suggestedAgent: 'analyst' },
    { pattern: /programe\s|codifique\s|implemente\s/i, category: 'code', confidence: 0.9, complexity: 'complex', suggestedAgent: 'coder' },
    { pattern: /^(olá|oi|bom\s(dia|tarde|noite))/i, category: 'conversation', subcategory: 'greeting', confidence: 0.95, complexity: 'simple' },
  ],
  fr: [
    { pattern: /^(qu'est-ce|quel|comment|où|quand|pourquoi|qui)\s/i, category: 'query', confidence: 0.9, complexity: 'simple' },
    { pattern: /crée\s|génère\s|fais\s/i, category: 'task', confidence: 0.9, complexity: 'moderate' },
    { pattern: /analyse\s|examine\s|évalue\s/i, category: 'analysis', confidence: 0.9, complexity: 'complex', suggestedAgent: 'analyst' },
    { pattern: /programme\s|code\s|implémente\s/i, category: 'code', confidence: 0.9, complexity: 'complex', suggestedAgent: 'coder' },
    { pattern: /^(bonjour|salut|bonsoir)/i, category: 'conversation', subcategory: 'greeting', confidence: 0.95, complexity: 'simple' },
  ],
  de: [
    { pattern: /^(was|welche|wie|wo|wann|warum|wer)\s/i, category: 'query', confidence: 0.9, complexity: 'simple' },
    { pattern: /erstelle\s|generiere\s|mache\s/i, category: 'task', confidence: 0.9, complexity: 'moderate' },
    { pattern: /analysiere\s|untersuche\s|bewerte\s/i, category: 'analysis', confidence: 0.9, complexity: 'complex', suggestedAgent: 'analyst' },
    { pattern: /programmiere\s|codiere\s|implementiere\s/i, category: 'code', confidence: 0.9, complexity: 'complex', suggestedAgent: 'coder' },
    { pattern: /^(hallo|guten\s(tag|morgen|abend))/i, category: 'conversation', subcategory: 'greeting', confidence: 0.95, complexity: 'simple' },
  ],
  it: [
    { pattern: /^(cosa|quale|come|dove|quando|perché|chi)\s/i, category: 'query', confidence: 0.9, complexity: 'simple' },
    { pattern: /crea\s|genera\s|fai\s/i, category: 'task', confidence: 0.9, complexity: 'moderate' },
    { pattern: /analizza\s|esamina\s|valuta\s/i, category: 'analysis', confidence: 0.9, complexity: 'complex', suggestedAgent: 'analyst' },
    { pattern: /programma\s|codifica\s|implementa\s/i, category: 'code', confidence: 0.9, complexity: 'complex', suggestedAgent: 'coder' },
    { pattern: /^(ciao|buongiorno|buonasera)/i, category: 'conversation', subcategory: 'greeting', confidence: 0.95, complexity: 'simple' },
  ],
  auto: [], // Se usa para detección automática
};

// Patrones de entidades
const ENTITY_PATTERNS: { type: EntityType; pattern: RegExp }[] = [
  { type: 'email', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: 'url', pattern: /https?:\/\/[^\s]+/g },
  { type: 'phone', pattern: /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g },
  { type: 'date', pattern: /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b\d{4}[\/\-]\d{2}[\/\-]\d{2}\b/g },
  { type: 'time', pattern: /\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm|AM|PM)?\b/g },
  { type: 'money', pattern: /\$\d+(?:,\d{3})*(?:\.\d{2})?|\d+(?:,\d{3})*(?:\.\d{2})?\s*(USD|EUR|GBP|MXN|ARS|CLP)/g },
  { type: 'percentage', pattern: /\d+(?:\.\d+)?%/g },
  { type: 'file', pattern: /[\w\-]+\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|json|xml|png|jpg|jpeg|gif|mp3|mp4|zip|rar)/gi },
  { type: 'code_language', pattern: /\b(javascript|typescript|python|java|c\+\+|c#|ruby|go|rust|php|swift|kotlin|scala|html|css|sql|bash|shell)\b/gi },
];

// Indicadores de sentimiento
const SENTIMENT_INDICATORS = {
  positive: [
    /gracias|excelente|genial|perfecto|increíble|maravilloso/i,
    /thanks|excellent|great|perfect|amazing|wonderful/i,
    /obrigado|excelente|ótimo|perfeito|incrível/i,
    /😊|👍|🎉|❤️|😄|🙏/,
  ],
  negative: [
    /malo|terrible|horrible|pésimo|error|problema|fallo/i,
    /bad|terrible|horrible|awful|error|problem|fail/i,
    /ruim|terrível|horrível|péssimo|erro|problema/i,
    /😠|😤|😡|👎|💔|😢/,
  ],
  urgent: [
    /urgente|inmediato|ahora|rápido|pronto|emergencia/i,
    /urgent|immediate|now|quick|asap|emergency/i,
    /urgente|imediato|agora|rápido|emergência/i,
    /⚠️|🚨|⏰|🔥/,
  ],
  frustrated: [
    /no\sfunciona|no\sentiendo|otra\svez|ya\ste\sdije/i,
    /doesn't\swork|don't\sunderstand|again|already\stold/i,
    /não\sfunciona|não\sentendo|de\snovo|já\ste\sdisse/i,
  ],
};

export class IntentDetector extends EventEmitter {
  private static instance: IntentDetector;
  private intentHistory: Map<string, Intent[]> = new Map();
  private readonly REDIS_PREFIX = 'intent:detector:';
  private readonly MAX_HISTORY_PER_USER = 100;

  private constructor() {
    super();
  }

  static getInstance(): IntentDetector {
    if (!IntentDetector.instance) {
      IntentDetector.instance = new IntentDetector();
    }
    return IntentDetector.instance;
  }

  // Analizar intención principal
  async analyze(
    text: string,
    userId?: string,
    context?: { previousIntents?: Intent[]; conversationHistory?: string[] }
  ): Promise<IntentAnalysisResult> {
    const normalizedText = this.normalizeText(text);
    const language = this.detectLanguage(text);
    const sentiment = this.detectSentiment(text);
    const entities = this.extractEntities(text);
    const keywords = this.extractKeywords(normalizedText);

    // Detectar intenciones usando patrones
    const detectedIntents = this.detectIntentsFromPatterns(normalizedText, language.language);

    // Si no se detectó ninguna intención, usar análisis heurístico
    if (detectedIntents.length === 0) {
      detectedIntents.push(this.analyzeHeuristically(normalizedText, language.language));
    }

    // Determinar complejidad basada en análisis
    const complexity = this.determineComplexity(normalizedText, entities, keywords);

    // Construir intención primaria
    const primaryIntent: Intent = {
      id: this.generateIntentId(),
      category: detectedIntents[0]?.category || 'unknown',
      subcategory: detectedIntents[0]?.subcategory,
      confidence: detectedIntents[0]?.confidence || 0.5,
      complexity,
      language: language.language,
      sentiment,
      entities,
      keywords,
      actionRequired: this.isActionRequired(detectedIntents[0]?.category),
      suggestedAgent: detectedIntents[0]?.suggestedAgent,
      originalText: text,
      normalizedText,
      timestamp: new Date(),
    };

    // Construir intenciones secundarias
    const secondaryIntents: Intent[] = detectedIntents.slice(1).map(d => ({
      ...primaryIntent,
      id: this.generateIntentId(),
      category: d.category,
      subcategory: d.subcategory,
      confidence: d.confidence,
      suggestedAgent: d.suggestedAgent,
    }));

    // Generar hints contextuales
    const contextualHints = this.generateContextualHints(primaryIntent, context);

    // Generar acciones recomendadas
    const recommendedActions = this.generateRecommendedActions(primaryIntent);

    // Estimar tokens
    const estimatedTokens = this.estimateTokens(text);

    // Determinar si requiere múltiples turnos
    const requiresMultiTurn = complexity === 'complex' || complexity === 'multi-step';

    const result: IntentAnalysisResult = {
      primaryIntent,
      secondaryIntents,
      contextualHints,
      recommendedActions,
      estimatedTokens,
      requiresMultiTurn,
    };

    // Guardar en historial
    if (userId) {
      this.addToHistory(userId, primaryIntent);
    }

    // Emitir evento
    this.emit('intent-detected', result);

    return result;
  }

  // Detectar idioma
  detectLanguage(text: string): LanguageDetectionResult {
    const scores: Record<Language, number> = {
      es: 0, en: 0, pt: 0, fr: 0, de: 0, it: 0, auto: 0
    };

    // Palabras comunes por idioma
    const languageIndicators: Record<Language, RegExp[]> = {
      es: [/\b(el|la|los|las|de|en|que|y|es|un|una|para|por|con|no|se|su|al|lo|como|más|pero|sus|le|ya|o|este|sí|porque|cuando|muy|sin|sobre|también|me|hasta|hay|donde|quien|desde|todo|nos|durante|todos|uno|les|ni|contra|otros|ese|eso|ante|ellos|entre|ser|son|dos|está|vez|solo|ya)\b/gi],
      en: [/\b(the|be|to|of|and|a|in|that|have|I|it|for|not|on|with|he|as|you|do|at|this|but|his|by|from|they|we|say|her|she|or|an|will|my|one|all|would|there|their|what|so|up|out|if|about|who|get|which|go|me|when|make|can|like|time|no|just|him|know|take|people|into|year|your|good|some|could|them|see|other|than|then|now|look|only|come|its|over|think|also|back|after|use|two|how|our|work|first|well|way|even|new|want|because|any|these|give|day|most|us)\b/gi],
      pt: [/\b(o|a|os|as|de|em|que|e|é|um|uma|para|por|com|não|se|seu|sua|ao|como|mais|mas|seus|lhe|já|ou|este|sim|porque|quando|muito|sem|sobre|também|me|até|há|onde|quem|desde|tudo|nos|durante|todos|dois|está|vez|só|já)\b/gi],
      fr: [/\b(le|la|les|de|en|que|et|est|un|une|pour|par|avec|ne|se|son|sa|au|comme|plus|mais|ses|lui|déjà|ou|ce|oui|parce|quand|très|sans|sur|aussi|me|jusqu|il|où|qui|depuis|tout|nous|pendant|tous|deux|fois|seul)\b/gi],
      de: [/\b(der|die|das|den|dem|des|ein|eine|einen|einem|einer|und|ist|von|zu|mit|für|auf|nicht|sich|es|bei|als|auch|nach|wie|noch|oder|wenn|so|werden|können|sein|haben|werden|nur|schon|aber|dann|da|wir|sie|er|ich|was|kann|sehr|durch|über|bis|unter|weil|dort|hier)\b/gi],
      it: [/\b(il|la|i|gli|le|di|in|che|e|è|un|una|per|da|con|non|si|suo|sua|al|come|più|ma|suoi|gli|già|o|questo|sì|perché|quando|molto|senza|su|anche|me|fino|c'è|dove|chi|da|tutto|noi|durante|tutti|due|volte|solo)\b/gi],
      auto: [],
    };

    // Contar coincidencias
    for (const [lang, patterns] of Object.entries(languageIndicators)) {
      if (lang === 'auto') continue;
      for (const pattern of patterns) {
        const matches = text.match(pattern);
        if (matches) {
          scores[lang as Language] += matches.length;
        }
      }
    }

    // Ordenar por puntaje
    const sortedLanguages = (Object.entries(scores) as [Language, number][])
      .filter(([lang]) => lang !== 'auto')
      .sort((a, b) => b[1] - a[1]);

    const totalScore = sortedLanguages.reduce((sum, [, score]) => sum + score, 0);

    return {
      language: sortedLanguages[0]?.[1] > 0 ? sortedLanguages[0][0] : 'en',
      confidence: totalScore > 0 ? sortedLanguages[0][1] / totalScore : 0.5,
      alternativeLanguages: sortedLanguages.slice(1, 3).map(([language, score]) => ({
        language,
        confidence: totalScore > 0 ? score / totalScore : 0,
      })),
    };
  }

  // Detectar sentimiento
  detectSentiment(text: string): UserSentiment {
    let positiveScore = 0;
    let negativeScore = 0;
    let urgentScore = 0;
    let frustratedScore = 0;

    for (const pattern of SENTIMENT_INDICATORS.positive) {
      if (pattern.test(text)) positiveScore++;
    }
    for (const pattern of SENTIMENT_INDICATORS.negative) {
      if (pattern.test(text)) negativeScore++;
    }
    for (const pattern of SENTIMENT_INDICATORS.urgent) {
      if (pattern.test(text)) urgentScore++;
    }
    for (const pattern of SENTIMENT_INDICATORS.frustrated) {
      if (pattern.test(text)) frustratedScore++;
    }

    // Priorizar urgente y frustrado
    if (urgentScore > 0) return 'urgent';
    if (frustratedScore > 0) return 'frustrated';
    if (negativeScore > positiveScore) return 'negative';
    if (positiveScore > negativeScore) return 'positive';
    return 'neutral';
  }

  // Extraer entidades
  extractEntities(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];

    for (const { type, pattern } of ENTITY_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;

      while ((match = regex.exec(text)) !== null) {
        entities.push({
          type,
          value: match[0],
          position: { start: match.index, end: match.index + match[0].length },
          confidence: 0.9,
        });
      }
    }

    return entities;
  }

  // Extraer keywords
  private extractKeywords(text: string): string[] {
    // Eliminar stop words y extraer palabras significativas
    const stopWords = new Set([
      // Spanish
      'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a', 'en', 'y', 'o', 'que', 'es', 'son',
      'para', 'por', 'con', 'sin', 'sobre', 'entre', 'se', 'su', 'sus', 'este', 'esta', 'estos', 'estas', 'ese', 'esa',
      'mi', 'tu', 'me', 'te', 'le', 'nos', 'les', 'lo', 'como', 'más', 'pero', 'muy', 'ya', 'también', 'sí', 'no',
      // English
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'are',
      'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
      'may', 'might', 'must', 'shall', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
      'my', 'your', 'his', 'her', 'its', 'our', 'their', 'me', 'him', 'us', 'them', 'what', 'which', 'who', 'whom', 'whose',
    ]);

    const words = text.toLowerCase()
      .replace(/[^\w\sáéíóúñü]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));

    // Contar frecuencia
    const frequency = new Map<string, number>();
    for (const word of words) {
      frequency.set(word, (frequency.get(word) || 0) + 1);
    }

    // Ordenar por frecuencia y retornar top keywords
    return Array.from(frequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  // Detectar intenciones desde patrones
  private detectIntentsFromPatterns(text: string, language: Language): IntentPattern[] {
    const patterns = INTENT_PATTERNS[language] || INTENT_PATTERNS.en;
    const matches: IntentPattern[] = [];

    for (const pattern of patterns) {
      if (pattern.pattern.test(text)) {
        matches.push(pattern);
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  // Análisis heurístico para intenciones no detectadas
  private analyzeHeuristically(text: string, language: Language): IntentPattern {
    const wordCount = text.split(/\s+/).length;
    const hasQuestion = /\?/.test(text);
    const hasCode = /```|`[^`]+`|function\s|const\s|let\s|var\s|class\s|def\s|import\s/.test(text);
    const hasNumbers = /\d+/.test(text);

    if (hasCode) {
      return { pattern: /./, category: 'code', confidence: 0.7, complexity: 'complex', suggestedAgent: 'coder' };
    }
    if (hasQuestion) {
      return { pattern: /./, category: 'query', confidence: 0.7, complexity: wordCount > 20 ? 'moderate' : 'simple' };
    }
    if (wordCount < 5) {
      return { pattern: /./, category: 'conversation', confidence: 0.6, complexity: 'simple' };
    }
    if (wordCount > 50) {
      return { pattern: /./, category: 'analysis', confidence: 0.6, complexity: 'complex', suggestedAgent: 'analyst' };
    }

    return { pattern: /./, category: 'task', confidence: 0.5, complexity: 'moderate' };
  }

  // Determinar complejidad
  private determineComplexity(text: string, entities: ExtractedEntity[], keywords: string[]): IntentComplexity {
    const wordCount = text.split(/\s+/).length;
    const entityCount = entities.length;
    const hasMultipleTasks = /y\s+(luego|después|también)|and\s+(then|also)|,\s*(luego|después|then|also)/i.test(text);

    if (hasMultipleTasks) return 'multi-step';
    if (wordCount > 100 || entityCount > 5 || keywords.length > 8) return 'complex';
    if (wordCount > 30 || entityCount > 2) return 'moderate';
    return 'simple';
  }

  // Verificar si requiere acción
  private isActionRequired(category?: IntentCategory): boolean {
    const actionCategories: IntentCategory[] = ['task', 'creative', 'code', 'analysis'];
    return category ? actionCategories.includes(category) : false;
  }

  // Generar hints contextuales
  private generateContextualHints(intent: Intent, context?: { previousIntents?: Intent[] }): string[] {
    const hints: string[] = [];

    if (context?.previousIntents?.length) {
      const lastIntent = context.previousIntents[context.previousIntents.length - 1];
      if (lastIntent.category === intent.category) {
        hints.push('Continuación del tema anterior');
      }
      if (intent.category === 'clarification') {
        hints.push('Usuario solicita aclaración sobre respuesta anterior');
      }
    }

    if (intent.sentiment === 'frustrated') {
      hints.push('Usuario puede estar frustrado - considerar respuesta más empática');
    }
    if (intent.sentiment === 'urgent') {
      hints.push('Solicitud urgente - priorizar respuesta rápida');
    }

    if (intent.complexity === 'multi-step') {
      hints.push('Tarea compleja - considerar dividir en pasos');
    }

    return hints;
  }

  // Generar acciones recomendadas
  private generateRecommendedActions(intent: Intent): string[] {
    const actions: string[] = [];

    switch (intent.category) {
      case 'query':
        actions.push('Buscar información relevante');
        if (intent.entities.some(e => e.type === 'technical_term')) {
          actions.push('Incluir definiciones técnicas');
        }
        break;
      case 'task':
        actions.push('Ejecutar tarea solicitada');
        if (intent.complexity === 'complex') {
          actions.push('Confirmar entendimiento antes de proceder');
        }
        break;
      case 'code':
        actions.push('Analizar código existente si aplica');
        actions.push('Generar código con comentarios');
        actions.push('Incluir pruebas si es apropiado');
        break;
      case 'analysis':
        actions.push('Recopilar datos relevantes');
        actions.push('Estructurar análisis en secciones');
        break;
      case 'creative':
        actions.push('Generar múltiples opciones si es posible');
        break;
      case 'clarification':
        actions.push('Reformular respuesta anterior');
        actions.push('Proporcionar ejemplos concretos');
        break;
    }

    return actions;
  }

  // Estimar tokens
  private estimateTokens(text: string): number {
    // Aproximación: ~4 caracteres por token en promedio
    return Math.ceil(text.length / 4);
  }

  // Normalizar texto
  private normalizeText(text: string): string {
    return text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  // Generar ID único
  private generateIntentId(): string {
    return `intent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Agregar al historial
  private addToHistory(userId: string, intent: Intent): void {
    const history = this.intentHistory.get(userId) || [];
    history.push(intent);

    if (history.length > this.MAX_HISTORY_PER_USER) {
      history.shift();
    }

    this.intentHistory.set(userId, history);
  }

  // Obtener historial de usuario
  getHistory(userId: string): Intent[] {
    return this.intentHistory.get(userId) || [];
  }

  // Obtener patrones de usuario
  getUserPatterns(userId: string): {
    mostCommonCategory: IntentCategory;
    preferredLanguage: Language;
    averageComplexity: IntentComplexity;
    sentiment: UserSentiment;
  } | null {
    const history = this.intentHistory.get(userId);
    if (!history || history.length < 5) return null;

    // Contar categorías
    const categoryCounts = new Map<IntentCategory, number>();
    const languageCounts = new Map<Language, number>();
    const complexityCounts = new Map<IntentComplexity, number>();
    const sentimentCounts = new Map<UserSentiment, number>();

    for (const intent of history) {
      categoryCounts.set(intent.category, (categoryCounts.get(intent.category) || 0) + 1);
      languageCounts.set(intent.language, (languageCounts.get(intent.language) || 0) + 1);
      complexityCounts.set(intent.complexity, (complexityCounts.get(intent.complexity) || 0) + 1);
      sentimentCounts.set(intent.sentiment, (sentimentCounts.get(intent.sentiment) || 0) + 1);
    }

    const getMax = <T>(map: Map<T, number>): T => {
      let max: T | undefined;
      let maxCount = 0;
      for (const [key, count] of map) {
        if (count > maxCount) {
          maxCount = count;
          max = key;
        }
      }
      return max!;
    };

    return {
      mostCommonCategory: getMax(categoryCounts),
      preferredLanguage: getMax(languageCounts),
      averageComplexity: getMax(complexityCounts),
      sentiment: getMax(sentimentCounts),
    };
  }

  // Persistir datos
  async persist(): Promise<void> {
    try {
      const data = Object.fromEntries(this.intentHistory);
      await redis.setex(
        `${this.REDIS_PREFIX}history`,
        7 * 24 * 60 * 60, // 7 días
        JSON.stringify(data)
      );
      Logger.info('[IntentDetector] Data persisted');
    } catch (error) {
      Logger.error('[IntentDetector] Error persisting:', error);
    }
  }

  // Restaurar datos
  async restore(): Promise<void> {
    try {
      const data = await redis.get(`${this.REDIS_PREFIX}history`);
      if (data) {
        const parsed = JSON.parse(data);
        this.intentHistory = new Map(
          Object.entries(parsed).map(([k, v]: [string, any[]]) => [
            k,
            v.map(intent => ({ ...intent, timestamp: new Date(intent.timestamp) }))
          ])
        );
        Logger.info('[IntentDetector] Data restored');
      }
    } catch (error) {
      Logger.error('[IntentDetector] Error restoring:', error);
    }
  }
}

// Singleton export
export const intentDetector = IntentDetector.getInstance();
