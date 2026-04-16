import { geminiChat, GEMINI_MODELS } from "./gemini";
import { KeywordExtractor } from "./keywordExtractor";
import { Utils } from "./searchEngines";

export type FactType = 'user_preference' | 'decision' | 'fact' | 'entity' | 'summary';

export interface ExtractedFact {
  type: FactType;
  content: string;
  confidence: number;
  source: 'user_stated' | 'inferred' | 'system';
  validUntil?: Date;
}

export interface ExtractionConfig {
  minConfidence: number;
  maxFactsPerTurn: number;
  extractEntities: boolean;
  language: 'es' | 'en';
}

const DEFAULT_CONFIG: ExtractionConfig = {
  minConfidence: 60,
  maxFactsPerTurn: 3,
  extractEntities: true,
  language: 'es',
};

export class FactExtractor {
  private config: ExtractionConfig;

  private static readonly PREFERENCE_PATTERNS_ES = [
    /(?:prefiero|me gusta|me encanta|me gustaría|amo|adoro)\s+(.{5,100})/gi,
    /(?:no me gusta|odio|detesto|no quiero)\s+(.{5,100})/gi,
    /(?:mi favorito es|mi preferido es)\s+(.{5,100})/gi,
  ];

  private static readonly PREFERENCE_PATTERNS_EN = [
    /(?:I prefer|I like|I love|I enjoy|I\'d prefer|I would prefer)\s+(.{5,100})/gi,
    /(?:I don\'t like|I hate|I dislike|I don\'t want)\s+(.{5,100})/gi,
    /(?:my favorite is|I\'m fond of)\s+(.{5,100})/gi,
  ];

  private static readonly DECISION_PATTERNS_ES = [
    /(?:decidí|he decidido|voy a|quiero|necesito|vamos a|planeo)\s+(.{5,100})/gi,
    /(?:elegí|opté por|me incliné por)\s+(.{5,100})/gi,
  ];

  private static readonly DECISION_PATTERNS_EN = [
    /(?:I decided|I\'ve decided|I will|I want to|I need to|I\'m going to|I plan to)\s+(.{5,100})/gi,
    /(?:I chose|I opted for|I\'ll go with)\s+(.{5,100})/gi,
  ];

  private static readonly FACT_PATTERNS_ES = [
    /(?:soy|yo soy|trabajo en|trabajo como|vivo en|tengo)\s+(.{3,80})/gi,
    /(?:mi nombre es|me llamo|mi edad es|tengo \d+ años)/gi,
    /(?:mi empresa es|mi compañía es|trabajo para)\s+(.{3,80})/gi,
  ];

  private static readonly FACT_PATTERNS_EN = [
    /(?:I am|I\'m|I work at|I work as|I live in|I have)\s+(.{3,80})/gi,
    /(?:my name is|I\'m called|my age is|I\'m \d+ years old)/gi,
    /(?:my company is|I work for)\s+(.{3,80})/gi,
  ];

  private static readonly SEMANTIC_INDICATORS = [
    'siempre', 'nunca', 'normalmente', 'usualmente', 'generalmente',
    'always', 'never', 'usually', 'normally', 'generally',
    'mejor', 'peor', 'mejor que', 'peor que',
    'better', 'worse', 'rather than',
    'en lugar de', 'instead of', 'over',
  ];

  constructor(config?: Partial<ExtractionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async extractFromMessage(
    message: { role: string; content: string },
    previousMessages?: Array<{ role: string; content: string }>
  ): Promise<ExtractedFact[]> {
    if (message.role !== 'user' || !message.content?.trim()) {
      return [];
    }

    const facts: ExtractedFact[] = [];
    const content = message.content;

    const patternFacts = this.extractWithPatterns(content);
    facts.push(...patternFacts);

    if (this.config.extractEntities) {
      const entityFacts = this.extractEntitiesAsFacts(content);
      facts.push(...entityFacts);
    }

    const needsLLM = this.shouldUseLLMExtraction(content, facts);
    if (needsLLM && facts.length < this.config.maxFactsPerTurn) {
      const llmFacts = await this.extractWithLLM(content, previousMessages);
      facts.push(...llmFacts);
    }

    const filteredFacts = facts
      .filter(f => f.confidence >= this.config.minConfidence)
      .slice(0, this.config.maxFactsPerTurn);

    return filteredFacts;
  }

  async extractFromConversation(
    messages: Array<{ role: string; content: string }>,
    existingFacts?: ExtractedFact[]
  ): Promise<ExtractedFact[]> {
    const allFacts: ExtractedFact[] = existingFacts ? [...existingFacts] : [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (message.role !== 'user') continue;

      const previousMessages = messages.slice(0, i);
      const newFacts = await this.extractFromMessage(message, previousMessages);
      
      for (const fact of newFacts) {
        allFacts.push(fact);
      }
    }

    return this.mergeFacts([], allFacts);
  }

  mergeFacts(existing: ExtractedFact[], newFacts: ExtractedFact[]): ExtractedFact[] {
    const merged: ExtractedFact[] = [...existing];
    const contentSet = new Set(existing.map(f => this.normalizeContent(f.content)));

    for (const fact of newFacts) {
      const normalized = this.normalizeContent(fact.content);
      
      const isDuplicate = Array.from(contentSet).some(existing => 
        this.isSimilar(normalized, existing)
      );

      if (!isDuplicate) {
        merged.push(fact);
        contentSet.add(normalized);
      } else {
        const existingIndex = merged.findIndex(f => 
          this.isSimilar(this.normalizeContent(f.content), normalized)
        );
        if (existingIndex >= 0 && fact.confidence > merged[existingIndex].confidence) {
          merged[existingIndex] = fact;
        }
      }
    }

    return merged;
  }

  private extractWithPatterns(content: string): ExtractedFact[] {
    const facts: ExtractedFact[] = [];
    const isSpanish = this.config.language === 'es';

    const preferencePatterns = isSpanish 
      ? FactExtractor.PREFERENCE_PATTERNS_ES 
      : FactExtractor.PREFERENCE_PATTERNS_EN;
    
    for (const pattern of preferencePatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const extracted = match[1]?.trim() || match[0].trim();
        if (extracted.length >= 5) {
          facts.push({
            type: 'user_preference',
            content: this.cleanExtractedText(extracted),
            confidence: 85,
            source: 'user_stated',
          });
        }
      }
    }

    const decisionPatterns = isSpanish 
      ? FactExtractor.DECISION_PATTERNS_ES 
      : FactExtractor.DECISION_PATTERNS_EN;
    
    for (const pattern of decisionPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const extracted = match[1]?.trim() || match[0].trim();
        if (extracted.length >= 5) {
          facts.push({
            type: 'decision',
            content: this.cleanExtractedText(extracted),
            confidence: 80,
            source: 'user_stated',
          });
        }
      }
    }

    const factPatterns = isSpanish 
      ? FactExtractor.FACT_PATTERNS_ES 
      : FactExtractor.FACT_PATTERNS_EN;
    
    for (const pattern of factPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const extracted = match[1]?.trim() || match[0].trim();
        if (extracted.length >= 3) {
          facts.push({
            type: 'fact',
            content: this.cleanExtractedText(match[0]),
            confidence: 90,
            source: 'user_stated',
          });
        }
      }
    }

    return facts;
  }

  private extractEntitiesAsFacts(content: string): ExtractedFact[] {
    const entities = KeywordExtractor.extractEntities(content);
    const facts: ExtractedFact[] = [];

    for (const entity of entities) {
      if (entity.type === 'person' || entity.type === 'org') {
        facts.push({
          type: 'entity',
          content: `${entity.type === 'person' ? 'Persona' : 'Organización'}: ${entity.text}`,
          confidence: 70,
          source: 'inferred',
        });
      } else if (entity.type === 'date') {
        facts.push({
          type: 'entity',
          content: `Fecha mencionada: ${entity.text}`,
          confidence: 85,
          source: 'user_stated',
        });
      }
    }

    return facts.slice(0, 2);
  }

  private shouldUseLLMExtraction(content: string, existingFacts: ExtractedFact[]): boolean {
    if (existingFacts.length >= this.config.maxFactsPerTurn) {
      return false;
    }

    if (content.length < 20) {
      return false;
    }

    const lowerContent = content.toLowerCase();
    const hasSemanticIndicators = FactExtractor.SEMANTIC_INDICATORS.some(
      indicator => lowerContent.includes(indicator)
    );

    if (hasSemanticIndicators && existingFacts.length === 0) {
      return true;
    }

    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    if (sentences.length >= 2 && existingFacts.length < 2) {
      return true;
    }

    return false;
  }

  private async extractWithLLM(
    content: string,
    previousMessages?: Array<{ role: string; content: string }>
  ): Promise<ExtractedFact[]> {
    try {
      const context = previousMessages?.slice(-3)
        .map(m => `${m.role}: ${m.content}`)
        .join('\n') || '';

      const systemPrompt = `You are a fact extraction assistant. Extract user preferences, decisions, and facts from conversation.

Output ONLY valid JSON array. Each item must have:
- type: "user_preference" | "decision" | "fact"
- content: string (the extracted fact, clean and concise)
- confidence: number (0-100)

Example output:
[{"type":"user_preference","content":"prefers dark mode","confidence":85}]

Extract at most 3 facts. Focus on:
1. User preferences (likes, dislikes, preferences)
2. Decisions (plans, choices, intentions)
3. Personal facts (occupation, location, characteristics)

If no facts found, return: []`;

      const userPrompt = context 
        ? `Previous context:\n${context}\n\nCurrent message to analyze:\n${content}`
        : `Analyze this message:\n${content}`;

      const response = await geminiChat(
        [{ role: 'user', parts: [{ text: userPrompt }] }],
        {
          model: GEMINI_MODELS.FLASH,
          systemInstruction: systemPrompt,
          temperature: 0.1,
          maxOutputTokens: 500,
        }
      );

      const parsed = this.parseLLMResponse(response.content);
      return parsed.map(fact => ({
        ...fact,
        source: 'inferred' as const,
      }));
    } catch (error) {
      console.error('[FactExtractor] LLM extraction failed:', error);
      return [];
    }
  }

  private parseLLMResponse(response: string): Array<{
    type: FactType;
    content: string;
    confidence: number;
  }> {
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter(item => 
          item &&
          typeof item.type === 'string' &&
          typeof item.content === 'string' &&
          typeof item.confidence === 'number' &&
          ['user_preference', 'decision', 'fact'].includes(item.type)
        )
        .map(item => ({
          type: item.type as FactType,
          content: item.content.slice(0, 200),
          confidence: Math.min(100, Math.max(0, item.confidence)),
        }));
    } catch {
      return [];
    }
  }

  private cleanExtractedText(text: string): string {
    return text
      .replace(/[.!?,;:]+$/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }

  private normalizeContent(content: string): string {
    return content
      .toLowerCase()
      .replace(/[^\w\sáéíóúñü]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isSimilar(a: string, b: string): boolean {
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;

    const tokensA = Utils.tokenize(a);
    const tokensB = Utils.tokenize(b);
    
    if (tokensA.length === 0 || tokensB.length === 0) return false;

    const intersection = tokensA.filter(t => tokensB.includes(t));
    const union = new Set([...tokensA, ...tokensB]);
    const jaccard = intersection.length / union.size;

    return jaccard > 0.6;
  }
}
