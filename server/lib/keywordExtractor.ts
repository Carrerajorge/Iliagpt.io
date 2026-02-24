import { Utils } from "./searchEngines";

export interface ExtractedEntity {
  text: string;
  type: 'person' | 'org' | 'date' | 'number' | 'unknown';
}

export class KeywordExtractor {
  static extract(text: string, maxKeywords: number = 10): string[] {
    if (!text) return [];

    const tokens = Utils.tokenize(text);
    const capitalizedWords = this.extractCapitalizedWords(text);
    const numbers = this.extractNumbersAndDates(text);

    const wordFrequency = new Map<string, number>();
    for (const token of tokens) {
      wordFrequency.set(token, (wordFrequency.get(token) || 0) + 1);
    }

    for (const word of capitalizedWords) {
      const normalized = word.toLowerCase();
      wordFrequency.set(normalized, (wordFrequency.get(normalized) || 0) + 2);
    }

    for (const num of numbers) {
      wordFrequency.set(num, (wordFrequency.get(num) || 0) + 1);
    }

    const sorted = Array.from(wordFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxKeywords)
      .map(([word]) => word);

    return sorted;
  }

  static extractEntities(text: string): ExtractedEntity[] {
    if (!text) return [];

    const entities: ExtractedEntity[] = [];
    const seen = new Set<string>();

    const datePattern = /\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}/g;
    let match;
    while ((match = datePattern.exec(text)) !== null) {
      if (!seen.has(match[0])) {
        entities.push({ text: match[0], type: 'date' });
        seen.add(match[0]);
      }
    }

    const numberPattern = /\d+(?:\.\d+)?\s*(?:usd|eur|%|kg|km|m2|gb|mb|kb|tb)/gi;
    while ((match = numberPattern.exec(text)) !== null) {
      const normalized = match[0].toLowerCase().trim();
      if (!seen.has(normalized)) {
        entities.push({ text: normalized, type: 'number' });
        seen.add(normalized);
      }
    }

    const capitalizedPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
    while ((match = capitalizedPattern.exec(text)) !== null) {
      const value = match[0].trim();
      if (!seen.has(value) && value.length <= 50) {
        const type = this.guessEntityType(value);
        entities.push({ text: value, type });
        seen.add(value);
      }
    }

    const singleCapPattern = /\b[A-Z][a-z]{2,}\b/g;
    while ((match = singleCapPattern.exec(text)) !== null) {
      const value = match[0];
      if (!seen.has(value) && !Utils.STOP_WORDS.has(value.toLowerCase())) {
        entities.push({ text: value, type: 'unknown' });
        seen.add(value);
      }
    }

    return entities;
  }

  private static extractCapitalizedWords(text: string): string[] {
    const pattern = /\b[A-Z][a-záéíóúñü]+\b/g;
    const matches = text.match(pattern) || [];
    return matches.filter(word => 
      word.length > 2 && 
      !Utils.STOP_WORDS.has(word.toLowerCase())
    );
  }

  private static extractNumbersAndDates(text: string): string[] {
    const results: string[] = [];

    const datePattern = /\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}/g;
    const dateMatches = text.match(datePattern) || [];
    results.push(...dateMatches);

    // Keep the regex deterministic and bounded to reduce worst-case backtracking on crafted input.
    const numberPattern =
      /\b\d{1,18}(?:\.\d{1,6})?\s*(?:(?:usd|eur|kg|km|m2|gb|mb|kb|tb)\b|%(?=$|\s|[.,;:!?]))/gi;
    const numberMatches = text.match(numberPattern) || [];
    results.push(...numberMatches.map(m => m.toLowerCase().replace(/\s+/g, '')));

    return results;
  }

  private static guessEntityType(text: string): 'person' | 'org' | 'unknown' {
    const orgIndicators = ['Inc', 'Corp', 'LLC', 'Ltd', 'Company', 'Corporation', 'Group', 'Foundation', 'Institute', 'University', 'Association'];
    for (const indicator of orgIndicators) {
      if (text.includes(indicator)) return 'org';
    }

    const words = text.split(/\s+/);
    if (words.length >= 2 && words.length <= 4) {
      const allCapitalized = words.every(w => /^[A-Z][a-z]+$/.test(w));
      if (allCapitalized) return 'person';
    }

    return 'unknown';
  }
}
