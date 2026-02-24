import { LIMITS } from "./lib/constants";

export interface TextChunk {
  content: string;
  chunkIndex: number;
  pageNumber?: number;
}

export function chunkText(text: string, chunkSize = 1000, overlap = 200): TextChunk[] {
  const chunks: TextChunk[] = [];
  const cleanedText = text.replace(/\s+/g, " ").trim();
  
  if (cleanedText.length <= chunkSize) {
    return [{ content: cleanedText, chunkIndex: 0 }];
  }

  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < cleanedText.length) {
    let endIndex = Math.min(startIndex + chunkSize, cleanedText.length);
    
    if (endIndex < cleanedText.length) {
      const lastSpace = cleanedText.lastIndexOf(" ", endIndex);
      if (lastSpace > startIndex) {
        endIndex = lastSpace;
      }
    }

    const chunkContent = cleanedText.slice(startIndex, endIndex).trim();
    if (chunkContent.length > 0) {
      chunks.push({ content: chunkContent, chunkIndex });
      chunkIndex++;
    }

    startIndex = endIndex - overlap;
    if (startIndex >= cleanedText.length || endIndex >= cleanedText.length) break;
  }

  return chunks;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
    'y', 'o', 'a', 'en', 'que', 'es', 'por', 'para', 'con', 'no', 'se', 'su',
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'this', 'that', 'these', 'those', 'it', 'its', 'as', 'if', 'then', 'than'
  ]);
  
  return text
    .toLowerCase()
    .replace(/[^\w\sáéíóúñü]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
}

const EMBEDDING_DIMENSIONS = 1536;

export async function generateEmbedding(text: string): Promise<number[]> {
  // Guard against type confusion via parameter tampering (CodeQL: type-confusion)
  if (typeof text !== "string") {
    throw new TypeError("generateEmbedding: text must be a string");
  }
  const keywords = extractKeywords(text.slice(0, LIMITS.MAX_EMBEDDING_INPUT));
  const embedding = new Array(EMBEDDING_DIMENSIONS).fill(0);
  
  keywords.forEach((word, idx) => {
    const hash = Math.abs(simpleHash(word));
    const position = hash % embedding.length;
    embedding[position] += 1 / (idx + 1);
  });
  
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= magnitude;
    }
  }
  
  return embedding;
}

export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  
  const embeddings: number[][] = [];
  
  for (const text of texts) {
    const embedding = await generateEmbedding(text);
    embeddings.push(embedding);
  }
  
  return embeddings;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}
