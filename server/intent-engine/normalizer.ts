import { NormalizedInput, ExtractedEntities, InputMetadata, TaskDomain } from './types';

const DOMAIN_KEYWORDS: Record<TaskDomain, string[]> = {
  marketing: ['marketing', 'publicidad', 'redes sociales', 'branding', 'ventas', 'clientes', 'promoción', 'campaña', 'leads', 'conversión', 'SEO', 'SEM', 'contenido', 'engagement'],
  academic: ['tesis', 'investigación', 'artículo', 'paper', 'académico', 'universidad', 'científico', 'bibliografía', 'hipótesis', 'metodología', 'estudio'],
  business: ['empresa', 'negocio', 'startup', 'emprendimiento', 'finanzas', 'inversión', 'estrategia', 'KPI', 'ROI', 'presupuesto', 'proyección'],
  technology: ['software', 'programación', 'código', 'API', 'desarrollo', 'aplicación', 'sistema', 'base de datos', 'algoritmo', 'framework'],
  legal: ['ley', 'legal', 'contrato', 'jurídico', 'normativa', 'regulación', 'demanda', 'litigio', 'abogado'],
  medical: ['médico', 'salud', 'paciente', 'diagnóstico', 'tratamiento', 'enfermedad', 'clínico', 'hospital', 'fármaco'],
  education: ['educación', 'enseñanza', 'aprendizaje', 'estudiante', 'docente', 'currículo', 'aula', 'pedagógico', 'escuela'],
  creative: ['creativo', 'historia', 'narrativa', 'ficción', 'personaje', 'guión', 'poesía', 'arte'],
  general: []
};

const PROHIBITION_PATTERNS = [
  /no\s+(?:usar?|incluir?|mencionar?|hablar?\s+de)\s+(.+?)(?:\.|,|$)/gi,
  /sin\s+(?:usar?|incluir?|mencionar?)\s+(.+?)(?:\.|,|$)/gi,
  /evitar?\s+(.+?)(?:\.|,|$)/gi,
  /prohibido\s+(.+?)(?:\.|,|$)/gi,
  /excluir?\s+(.+?)(?:\.|,|$)/gi
];

const QUANTITY_PATTERNS = [
  /(?:dame|genera|crea|escribe|proporciona|haz)\s+(\d+)/gi,
  /(\d+)\s+(?:títulos?|ideas?|opciones?|ejemplos?|puntos?|items?)/gi,
  /(?:lista\s+de\s+)?(\d+)/gi
];

const FIXED_PART_PATTERNS = [
  /mantener\s+["""](.+?)["""]/gi,
  /conservar\s+["""](.+?)["""]/gi,
  /no\s+cambiar\s+["""](.+?)["""]/gi,
  /fijo:\s*["""](.+?)["""]/gi
];

export class InputNormalizer {
  normalize(input: string): NormalizedInput {
    const cleanedText = this.cleanText(input);
    const language = this.detectLanguage(cleanedText);
    const entities = this.extractEntities(input, cleanedText);
    const metadata = this.extractMetadata(input, cleanedText);

    return {
      originalText: input,
      cleanedText,
      language,
      entities,
      metadata
    };
  }

  private cleanText(text: string): string {
    const emojiPattern = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
    let cleaned = text.replace(emojiPattern, '');

    cleaned = cleaned
      .replace(/\s+/g, ' ')
      .replace(/\.{3,}/g, '...')
      .replace(/\?{2,}/g, '?')
      .replace(/!{2,}/g, '!')
      .trim();

    return cleaned;
  }

  private detectLanguage(text: string): string {
    const spanishIndicators = ['que', 'de', 'el', 'la', 'en', 'es', 'y', 'los', 'las', 'para', 'con', 'por', 'una', 'un'];
    const englishIndicators = ['the', 'is', 'are', 'and', 'to', 'of', 'in', 'for', 'with', 'on', 'at', 'by'];
    
    const words = text.toLowerCase().split(/\s+/);
    let spanishCount = 0;
    let englishCount = 0;

    for (const word of words) {
      if (spanishIndicators.includes(word)) spanishCount++;
      if (englishIndicators.includes(word)) englishCount++;
    }

    return spanishCount >= englishCount ? 'es' : 'en';
  }

  private extractEntities(original: string, cleaned: string): ExtractedEntities {
    const lowerText = cleaned.toLowerCase();
    
    const domain = this.detectDomain(lowerText);
    const quantity = this.extractQuantity(original);
    const prohibitions = this.extractProhibitions(original);
    const fixedParts = this.extractFixedParts(original);
    const topic = this.extractTopic(cleaned);
    const keywords = this.extractKeywords(cleaned);

    return {
      topic,
      domain,
      quantity,
      prohibitions,
      fixedParts,
      keywords
    };
  }

  private detectDomain(text: string): TaskDomain {
    const scores: Record<TaskDomain, number> = {
      marketing: 0,
      academic: 0,
      business: 0,
      technology: 0,
      legal: 0,
      medical: 0,
      education: 0,
      creative: 0,
      general: 0
    };

    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      for (const keyword of keywords) {
        if (text.includes(keyword.toLowerCase())) {
          scores[domain as TaskDomain] += 1;
        }
      }
    }

    let maxDomain: TaskDomain = 'general';
    let maxScore = 0;

    for (const [domain, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        maxDomain = domain as TaskDomain;
      }
    }

    return maxDomain;
  }

  private extractQuantity(text: string): number | null {
    for (const pattern of QUANTITY_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > 0 && num <= 100) {
          return num;
        }
      }
      pattern.lastIndex = 0;
    }
    return null;
  }

  private extractProhibitions(text: string): string[] {
    const prohibitions: string[] = [];
    
    for (const pattern of PROHIBITION_PATTERNS) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const prohibition = match[1].trim().toLowerCase();
        if (prohibition && !prohibitions.includes(prohibition)) {
          prohibitions.push(prohibition);
        }
      }
      pattern.lastIndex = 0;
    }

    return prohibitions;
  }

  private extractFixedParts(text: string): string[] {
    const fixedParts: string[] = [];
    
    for (const pattern of FIXED_PART_PATTERNS) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const part = match[1].trim();
        if (part && !fixedParts.includes(part)) {
          fixedParts.push(part);
        }
      }
      pattern.lastIndex = 0;
    }

    return fixedParts;
  }

  private extractTopic(text: string): string | null {
    const topicPatterns = [
      /sobre\s+(.+?)(?:\.|,|$)/i,
      /acerca\s+de\s+(.+?)(?:\.|,|$)/i,
      /tema:\s*(.+?)(?:\.|,|$)/i,
      /para\s+(.+?)(?:\.|,|$)/i
    ];

    for (const pattern of topicPatterns) {
      const match = pattern.exec(text);
      if (match) {
        return match[1].trim();
      }
    }

    const sentences = text.split(/[.!?]/);
    if (sentences.length > 0) {
      const firstSentence = sentences[0].trim();
      if (firstSentence.length > 10 && firstSentence.length < 100) {
        return firstSentence;
      }
    }

    return null;
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'y', 'o', 'que', 'es', 'son', 'para', 'por', 'con', 'sin', 'a', 'al', 'se', 'su', 'sus', 'como', 'más', 'pero', 'si', 'no', 'muy', 'mi', 'me', 'te', 'le', 'lo', 'the', 'is', 'are', 'and', 'or', 'to', 'of', 'in', 'for', 'with', 'on', 'at', 'by', 'an', 'a']);
    
    const words = text.toLowerCase()
      .replace(/[^\w\sáéíóúñü]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.has(word));

    const wordFreq = new Map<string, number>();
    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }

    return Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  private extractMetadata(original: string, cleaned: string): InputMetadata {
    const emojiPattern = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
    const urlPattern = /https?:\/\/[^\s]+/gi;
    
    const hasEmojis = emojiPattern.test(original);
    const hasUrls = urlPattern.test(original);
    const words = cleaned.split(/\s+/).filter(w => w.length > 0);
    const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const isQuestion = cleaned.includes('?') || /^(qué|cómo|cuál|cuándo|dónde|por qué|quién|what|how|which|when|where|why|who)/i.test(cleaned);
    
    let urgencyLevel: 'low' | 'medium' | 'high' = 'low';
    const urgentKeywords = ['urgente', 'ahora', 'rápido', 'inmediato', 'pronto', 'ya', 'urgent', 'asap', 'immediately'];
    const lowerCleaned = cleaned.toLowerCase();
    if (urgentKeywords.some(k => lowerCleaned.includes(k))) {
      urgencyLevel = 'high';
    } else if (cleaned.includes('!') || cleaned.toUpperCase() === cleaned) {
      urgencyLevel = 'medium';
    }

    return {
      hasEmojis,
      hasUrls,
      wordCount: words.length,
      sentenceCount: sentences.length,
      isQuestion,
      urgencyLevel
    };
  }
}

export const normalizer = new InputNormalizer();
