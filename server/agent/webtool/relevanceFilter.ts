import { z } from "zod";

export const RelevanceChunkSchema = z.object({
  text: z.string(),
  score: z.number().min(0).max(1),
  startIndex: z.number(),
  endIndex: z.number(),
  matchedTerms: z.array(z.string()),
  context: z.object({
    before: z.string().optional(),
    after: z.string().optional(),
  }).optional(),
});

export type RelevanceChunk = z.infer<typeof RelevanceChunkSchema>;

export const FilteredContentSchema = z.object({
  originalLength: z.number(),
  filteredLength: z.number(),
  chunks: z.array(RelevanceChunkSchema),
  overallScore: z.number().min(0).max(1),
  extractedAnswer: z.string().optional(),
  keyFacts: z.array(z.string()),
  summary: z.string().optional(),
});

export type FilteredContent = z.infer<typeof FilteredContentSchema>;

export interface FilterOptions {
  maxChunks: number;
  chunkSize: number;
  chunkOverlap: number;
  minScore: number;
  extractAnswer: boolean;
  includeSummary: boolean;
  maxOutputLength: number;
}

const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  maxChunks: 5,
  chunkSize: 500,
  chunkOverlap: 50,
  minScore: 0.1,
  extractAnswer: true,
  includeSummary: true,
  maxOutputLength: 3000,
};

export class RelevanceFilter {
  private options: FilterOptions;

  constructor(options: Partial<FilterOptions> = {}) {
    this.options = { ...DEFAULT_FILTER_OPTIONS, ...options };
  }

  filter(content: string, query: string, entities: string[] = []): FilteredContent {
    const queryTerms = this.extractQueryTerms(query);
    const allTerms = [...queryTerms, ...entities.map(e => e.toLowerCase())];
    
    const chunks = this.chunkContent(content);
    const scoredChunks = chunks
      .map(chunk => this.scoreChunk(chunk, allTerms, content))
      .filter(chunk => chunk.score >= this.options.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.options.maxChunks);
    
    const overallScore = scoredChunks.length > 0
      ? scoredChunks.reduce((sum, c) => sum + c.score, 0) / scoredChunks.length
      : 0;
    
    const keyFacts = this.extractKeyFacts(scoredChunks, allTerms);
    
    let extractedAnswer: string | undefined;
    if (this.options.extractAnswer && scoredChunks.length > 0) {
      extractedAnswer = this.extractAnswer(scoredChunks, query);
    }
    
    let summary: string | undefined;
    if (this.options.includeSummary && scoredChunks.length > 0) {
      summary = this.generateSummary(scoredChunks);
    }
    
    const filteredLength = scoredChunks.reduce((sum, c) => sum + c.text.length, 0);
    
    return {
      originalLength: content.length,
      filteredLength,
      chunks: scoredChunks,
      overallScore,
      extractedAnswer,
      keyFacts,
      summary,
    };
  }

  private extractQueryTerms(query: string): string[] {
    const stopWords = new Set([
      "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "what", "which", "who", "whom", "this", "that", "these", "those",
      "how", "why", "when", "where", "que", "qué", "como", "cómo", "para",
      "por", "con", "sin", "sobre", "entre", "hasta", "desde", "cuál",
    ]);
    
    return query
      .toLowerCase()
      .replace(/[^\w\sáéíóúüñ]/g, " ")
      .split(/\s+/)
      .filter(term => term.length >= 2 && !stopWords.has(term));
  }

  private chunkContent(content: string): { text: string; startIndex: number; endIndex: number }[] {
    const chunks: { text: string; startIndex: number; endIndex: number }[] = [];
    const sentences = this.splitIntoSentences(content);
    
    let currentChunk = "";
    let chunkStart = 0;
    let currentIndex = 0;
    
    for (const sentence of sentences) {
      const separator = currentChunk.length > 0 ? " " : "";
      if (currentChunk.length + separator.length + sentence.length > this.options.chunkSize && currentChunk.length > 0) {
        chunks.push({
          text: currentChunk.trim(),
          startIndex: chunkStart,
          endIndex: currentIndex,
        });
        
        const overlapStart = Math.max(0, currentChunk.length - this.options.chunkOverlap);
        currentChunk = currentChunk.slice(overlapStart) + " " + sentence;
        chunkStart = currentIndex - (currentChunk.length - sentence.length - 1);
      } else {
        if (currentChunk.length === 0) {
          chunkStart = currentIndex;
        }
        currentChunk += separator + sentence;
      }
      
      currentIndex += sentence.length;
    }
    
    if (currentChunk.trim().length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        startIndex: chunkStart,
        endIndex: currentIndex,
      });
    }
    
    return chunks;
  }

  private splitIntoSentences(text: string): string[] {
    const normalized = text.replace(/\s+/g, " ").trim();
    const sentenceEnders = /(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚ])/g;
    const sentences = normalized.split(sentenceEnders);
    return sentences.filter(s => s.trim().length > 0);
  }

  private scoreChunk(
    chunk: { text: string; startIndex: number; endIndex: number },
    terms: string[],
    fullContent: string
  ): RelevanceChunk {
    const lowerText = chunk.text.toLowerCase();
    const matchedTerms: string[] = [];
    let termScore = 0;
    
    for (const term of terms) {
      const regex = new RegExp(`\\b${this.escapeRegex(term)}\\b`, "gi");
      const matches = lowerText.match(regex);
      if (matches) {
        matchedTerms.push(term);
        termScore += matches.length * (term.length > 5 ? 2 : 1);
      }
    }
    
    const uniqueTermRatio = matchedTerms.length / Math.max(terms.length, 1);
    
    const densityScore = Math.min(termScore / (chunk.text.length / 100), 1);
    
    const positionScore = 1 - (chunk.startIndex / fullContent.length) * 0.3;
    
    const hasNumbers = /\d+/.test(chunk.text);
    const hasQuotes = /"[^"]+"/.test(chunk.text);
    const hasLists = /^\s*[-•*]\s/m.test(chunk.text);
    const factualBonus = (hasNumbers ? 0.1 : 0) + (hasQuotes ? 0.05 : 0) + (hasLists ? 0.05 : 0);
    
    const totalScore = Math.min(
      (uniqueTermRatio * 0.4) + (densityScore * 0.3) + (positionScore * 0.2) + factualBonus,
      1
    );
    
    const contextBefore = chunk.startIndex > 0
      ? fullContent.slice(Math.max(0, chunk.startIndex - 50), chunk.startIndex).trim()
      : undefined;
    const contextAfter = chunk.endIndex < fullContent.length
      ? fullContent.slice(chunk.endIndex, Math.min(fullContent.length, chunk.endIndex + 50)).trim()
      : undefined;
    
    return {
      text: chunk.text,
      score: totalScore,
      startIndex: chunk.startIndex,
      endIndex: chunk.endIndex,
      matchedTerms,
      context: (contextBefore || contextAfter) ? { before: contextBefore, after: contextAfter } : undefined,
    };
  }

  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private extractKeyFacts(chunks: RelevanceChunk[], terms: string[]): string[] {
    const facts: string[] = [];
    const seenFacts = new Set<string>();
    
    for (const chunk of chunks) {
      const sentences = this.splitIntoSentences(chunk.text);
      
      for (const sentence of sentences) {
        const lowerSentence = sentence.toLowerCase();
        const hasTerms = terms.some(term => lowerSentence.includes(term));
        
        if (hasTerms && sentence.length >= 30 && sentence.length <= 300) {
          const normalizedSentence = sentence.replace(/\s+/g, " ").trim();
          
          if (!seenFacts.has(normalizedSentence.toLowerCase())) {
            facts.push(normalizedSentence);
            seenFacts.add(normalizedSentence.toLowerCase());
          }
        }
        
        if (facts.length >= 5) break;
      }
      
      if (facts.length >= 5) break;
    }
    
    return facts;
  }

  private extractAnswer(chunks: RelevanceChunk[], query: string): string {
    const isQuestion = /^(what|who|when|where|why|how|which|is|are|can|does|did|will|qué|quién|cuándo|dónde|por qué|cómo|cuál)/i.test(query);
    
    if (!isQuestion) {
      return chunks.slice(0, 2).map(c => c.text).join(" ").slice(0, this.options.maxOutputLength);
    }
    
    const topChunk = chunks[0];
    const sentences = this.splitIntoSentences(topChunk.text);
    
    for (const sentence of sentences) {
      if (topChunk.matchedTerms.some(term => sentence.toLowerCase().includes(term))) {
        return sentence.trim();
      }
    }
    
    return sentences[0]?.trim() || topChunk.text.slice(0, 300);
  }

  private generateSummary(chunks: RelevanceChunk[]): string {
    const uniqueSentences: string[] = [];
    const seen = new Set<string>();
    
    for (const chunk of chunks) {
      const sentences = this.splitIntoSentences(chunk.text);
      
      for (const sentence of sentences.slice(0, 2)) {
        const normalized = sentence.replace(/\s+/g, " ").trim();
        if (!seen.has(normalized.toLowerCase()) && normalized.length >= 30) {
          uniqueSentences.push(normalized);
          seen.add(normalized.toLowerCase());
        }
        
        if (uniqueSentences.length >= 3) break;
      }
      
      if (uniqueSentences.length >= 3) break;
    }
    
    return uniqueSentences.join(" ");
  }

  combineRelevantContent(filteredContents: FilteredContent[]): string {
    const allChunks = filteredContents
      .flatMap(fc => fc.chunks)
      .sort((a, b) => b.score - a.score);
    
    let combined = "";
    const usedTexts = new Set<string>();
    
    for (const chunk of allChunks) {
      const normalizedText = chunk.text.toLowerCase().slice(0, 100);
      if (!usedTexts.has(normalizedText)) {
        if (combined.length + chunk.text.length <= this.options.maxOutputLength) {
          combined += (combined ? "\n\n" : "") + chunk.text;
          usedTexts.add(normalizedText);
        }
      }
    }
    
    return combined;
  }
}

export const relevanceFilter = new RelevanceFilter();
