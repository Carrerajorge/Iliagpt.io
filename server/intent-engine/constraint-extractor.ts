import { Constraints, NormalizedInput, IntentClassification, ToneType, OutputFormat, TaskDomain } from './types';

const TONE_KEYWORDS: Record<ToneType, string[]> = {
  formal: ['formal', 'profesional', 'serio', 'corporativo', 'oficial'],
  informal: ['informal', 'casual', 'coloquial', 'relajado', 'amigable'],
  academic: ['académico', 'academico', 'científico', 'cientifico', 'universitario', 'tesis', 'paper'],
  professional: ['profesional', 'empresarial', 'negocio', 'ejecutivo'],
  creative: ['creativo', 'original', 'innovador', 'artístico'],
  neutral: ['neutral', 'objetivo', 'imparcial']
};

const FORMAT_PATTERNS: { pattern: RegExp; format: OutputFormat }[] = [
  { pattern: /(?:en\s+)?(?:formato\s+)?json/i, format: 'json' },
  { pattern: /(?:en\s+)?(?:formato\s+)?markdown/i, format: 'markdown' },
  { pattern: /(?:como\s+)?(?:una\s+)?lista/i, format: 'list' },
  { pattern: /(?:como\s+)?(?:una\s+)?tabla/i, format: 'table' },
  { pattern: /estructurad[oa]/i, format: 'structured' }
];

export class ConstraintExtractor {
  extract(input: NormalizedInput, intent: IntentClassification): Constraints {
    const text = input.cleanedText;
    const lowerText = text.toLowerCase();

    const result: Constraints = {
      domain: input.entities.domain,
      task: intent.intent,
      n: input.entities.quantity,
      mustKeep: this.extractMustKeep(text, input.entities.fixedParts),
      mustNotUse: this.extractMustNotUse(text, input.entities.prohibitions),
      editableParts: this.extractEditableParts(text),
      tone: this.detectTone(lowerText),
      language: input.language,
      format: this.detectFormat(lowerText, intent.intent),
      maxLength: this.extractMaxLength(text),
      minLength: this.extractMinLength(text),
    };

    if (intent.intent === 'CITATION_FORMAT' || intent.intent === 'ACADEMIC_SEARCH' || intent.intent === 'RESEARCH') {
      result.citationStyle = this.detectCitationStyle(lowerText);
      result.citationEdition = this.detectCitationEdition(lowerText);
      result.academicDepth = this.detectAcademicDepth(lowerText);
      if (intent.intent === 'CITATION_FORMAT' || intent.intent === 'ACADEMIC_SEARCH') {
        result.tone = 'academic';
      }
    }

    return result;
  }

  private extractMustKeep(text: string, fixedParts: string[]): string[] {
    const mustKeep = [...fixedParts];

    const keepPatterns = [
      /mantener\s+(.+?)(?:\.|,|y\s|$)/gi,
      /conservar\s+(.+?)(?:\.|,|y\s|$)/gi,
      /no\s+(?:cambiar|tocar|modificar)\s+(.+?)(?:\.|,|y\s|$)/gi,
      /incluir\s+siempre\s+(.+?)(?:\.|,|y\s|$)/gi
    ];

    for (const pattern of keepPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const part = match[1].trim();
        if (part && !mustKeep.includes(part)) {
          mustKeep.push(part);
        }
      }
      pattern.lastIndex = 0;
    }

    return mustKeep;
  }

  private extractMustNotUse(text: string, prohibitions: string[]): string[] {
    const mustNotUse = [...prohibitions];

    const additionalPatterns = [
      /(?:sin|no)\s+(?:usar?|incluir?|mencionar?)\s+(?:palabras?\s+como\s+)?[""]?(.+?)[""]?(?:\.|,|$)/gi,
      /evitar?\s+(?:palabras?\s+como\s+)?[""]?(.+?)[""]?(?:\.|,|$)/gi,
      /(?:nada\s+(?:de|sobre))\s+(.+?)(?:\.|,|$)/gi
    ];

    for (const pattern of additionalPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const terms = match[1].split(/[,y]/).map(t => t.trim().toLowerCase());
        for (const term of terms) {
          if (term && !mustNotUse.includes(term)) {
            mustNotUse.push(term);
          }
        }
      }
      pattern.lastIndex = 0;
    }

    return mustNotUse;
  }

  private extractEditableParts(text: string): string[] {
    const editableParts: string[] = [];

    const patterns = [
      /(?:cambia|modifica|edita)\s+(?:solo|únicamente)?\s*(?:la|el)\s+(.+?)(?:\.|,|$)/gi,
      /(?:solo|únicamente)\s+(?:cambiar?|modificar?)\s+(.+?)(?:\.|,|$)/gi,
      /parte\s+editable:\s*(.+?)(?:\.|,|$)/gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const part = match[1].trim();
        if (part) {
          editableParts.push(part);
        }
      }
      pattern.lastIndex = 0;
    }

    return editableParts;
  }

  private detectTone(text: string): ToneType {
    for (const [tone, keywords] of Object.entries(TONE_KEYWORDS)) {
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          return tone as ToneType;
        }
      }
    }
    return 'neutral';
  }

  private detectFormat(text: string, intent: string): OutputFormat {
    for (const { pattern, format } of FORMAT_PATTERNS) {
      if (pattern.test(text)) {
        return format;
      }
    }

    switch (intent) {
      case 'TITLE_IDEATION':
        return 'list';
      case 'OUTLINE':
        return 'structured';
      case 'DATA_ANALYSIS':
        return 'structured';
      case 'CODE_GENERATION':
        return 'text';
      default:
        return 'text';
    }
  }

  private extractMaxLength(text: string): number | undefined {
    const patterns = [
      /máximo\s+(\d+)\s+(?:palabras?|caracteres?|líneas?)/i,
      /no\s+más\s+de\s+(\d+)\s+(?:palabras?|caracteres?)/i,
      /(\d+)\s+(?:palabras?|caracteres?)\s+(?:máximo|como\s+máximo)/i
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match) {
        return parseInt(match[1], 10);
      }
    }

    return undefined;
  }

  private extractMinLength(text: string): number | undefined {
    const patterns = [
      /mínimo\s+(\d+)\s+(?:palabras?|caracteres?|líneas?)/i,
      /al\s+menos\s+(\d+)\s+(?:palabras?|caracteres?)/i,
      /(\d+)\s+(?:palabras?|caracteres?)\s+(?:mínimo|como\s+mínimo)/i
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match) {
        return parseInt(match[1], 10);
      }
    }

    return undefined;
  }

  private detectCitationStyle(text: string): Constraints['citationStyle'] {
    if (/\bapa\s*7|apa\s*7ma/i.test(text)) return 'apa7';
    if (/\bapa\s*6|apa\s*6ta/i.test(text)) return 'apa6';
    if (/\bapa\b/i.test(text)) return 'apa7';
    if (/\bmla\b/i.test(text)) return 'mla';
    if (/\bchicago\b/i.test(text)) return 'chicago';
    if (/\bvancouver\b/i.test(text)) return 'vancouver';
    if (/\bieee\b/i.test(text)) return 'ieee';
    if (/\bharvard\b/i.test(text)) return 'harvard';
    if (/\biso[\s-]*690\b/i.test(text)) return 'iso690';
    return undefined;
  }

  private detectCitationEdition(text: string): string | undefined {
    const editionMatch = text.match(/(\d+)\s*(?:ma|va|ta|th|st|nd|rd)?\s*(?:edici[oó]n|edition)/i);
    if (editionMatch) return editionMatch[1];
    return undefined;
  }

  private detectAcademicDepth(text: string): Constraints['academicDepth'] {
    if (/(?:profund[oa]|exhaustiv[oa]|completo|detallad[oa]|extenso|deep|thorough|comprehensive)/i.test(text)) return 'deep';
    if (/(?:breve|rápid[oa]|resumen|overview|brief|quick)/i.test(text)) return 'surface';
    return 'standard';
  }

  mergeWithPrevious(current: Constraints, previous: Constraints | null): Constraints {
    if (!previous) return current;

    if (current.domain === 'general' && previous.domain !== 'general') {
      current.domain = previous.domain;
    }

    if (current.mustNotUse.length === 0 && previous.mustNotUse.length > 0) {
      current.mustNotUse = [...previous.mustNotUse];
    } else if (previous.mustNotUse.length > 0) {
      const combined = new Set([...current.mustNotUse, ...previous.mustNotUse]);
      current.mustNotUse = Array.from(combined);
    }

    if (current.mustKeep.length === 0 && previous.mustKeep.length > 0) {
      current.mustKeep = [...previous.mustKeep];
    }

    if (current.tone === 'neutral' && previous.tone !== 'neutral') {
      current.tone = previous.tone;
    }

    return current;
  }
}

export const constraintExtractor = new ConstraintExtractor();
