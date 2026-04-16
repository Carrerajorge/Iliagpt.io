import * as crypto from "crypto";
import { cosineSimilarity, generateEmbedding } from "../embeddingService";
import { chunkDocument } from "./semanticChunker";

export interface DocumentContextLocation {
  page?: number;
  sheet?: string;
  slide?: number;
  row?: number;
  cell?: string;
  chunkIndex?: number;
}

export interface QueryableDocumentChunk {
  docId?: string;
  filename: string;
  content: string;
  location?: DocumentContextLocation;
}

export interface ConversationDocumentInput {
  id?: string | null;
  fileName?: string | null;
  extractedText?: string | null;
  mimeType?: string | null;
}

export interface RankedDocumentChunk extends QueryableDocumentChunk {
  score: number;
  citation: string;
}

export interface DocumentContextBuildResult {
  context: string;
  chunks: RankedDocumentChunk[];
}

export interface BuildDocumentContextOptions {
  maxChunks?: number;
  maxChars?: number;
  perDocumentLimit?: number;
  minScore?: number;
  candidateMultiplier?: number;
  mmrLambda?: number;
}

const DEFAULT_OPTIONS: Required<BuildDocumentContextOptions> = {
  maxChunks: 8,
  maxChars: 14_000,
  perDocumentLimit: 3,
  minScore: 0.16,
  candidateMultiplier: 8,
  mmrLambda: 0.72,
};

const MAX_EMBEDDING_CHARS = 4_000;
const QUERY_EMBEDDING_CHARS = 1_500;
const STOP_WORDS = new Set([
  "a", "al", "algo", "alguna", "alguno", "and", "ante", "as", "at", "be",
  "con", "como", "de", "del", "desde", "do", "el", "ella", "ellas", "ellos",
  "en", "entre", "era", "eran", "es", "esa", "esas", "ese", "eso", "esos",
  "esta", "estaba", "estaban", "estado", "estamos", "estan", "estar", "estas",
  "este", "esto", "estos", "fue", "fueron", "for", "from", "ha", "han", "hasta",
  "hay", "in", "is", "la", "las", "lo", "los", "me", "mi", "mis", "more",
  "no", "nos", "of", "on", "or", "para", "pero", "por", "que", "se", "ser",
  "si", "sin", "sobre", "su", "sus", "the", "their", "them", "there", "they",
  "this", "to", "tu", "tus", "un", "una", "uno", "unos", "unas", "was", "were",
  "with", "y", "ya",
]);

const chunkEmbeddingCache = new Map<string, number[]>();

function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractQueryTerms(query: string): string[] {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  return Array.from(
    new Set(
      normalized
        .split(" ")
        .map((term) => term.trim())
        .filter((term) => term.length > 2 && !STOP_WORDS.has(term)),
    ),
  );
}

function getExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.at(-1)!.toLowerCase() : "";
}

function hashText(text: string): string {
  return crypto.createHash("sha1").update(text).digest("hex");
}

async function getCachedEmbedding(text: string): Promise<number[]> {
  const safeText = text.slice(0, MAX_EMBEDDING_CHARS);
  const key = hashText(safeText);
  const cached = chunkEmbeddingCache.get(key);
  if (cached) return cached;
  const embedding = await generateEmbedding(safeText);
  chunkEmbeddingCache.set(key, embedding);
  return embedding;
}

function countTermHits(content: string, terms: string[]): {
  matchedTerms: number;
  totalHits: number;
} {
  if (terms.length === 0) return { matchedTerms: 0, totalHits: 0 };
  const normalized = normalizeText(content);
  let matchedTerms = 0;
  let totalHits = 0;
  for (const term of terms) {
    const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    const matches = normalized.match(regex);
    const hits = matches?.length ?? 0;
    if (hits > 0) matchedTerms += 1;
    totalHits += Math.min(hits, 4);
  }
  return { matchedTerms, totalHits };
}

function computeKeywordScore(query: string, filename: string, content: string): number {
  const terms = extractQueryTerms(query);
  if (terms.length === 0) return 0;

  const normalizedContent = normalizeText(content);
  const normalizedFilename = normalizeText(filename);
  const { matchedTerms, totalHits } = countTermHits(content, terms);

  const coverage = matchedTerms / terms.length;
  const density = Math.min(totalHits / Math.max(terms.length * 2, 1), 1);
  const filenameHits = terms.filter((term) => normalizedFilename.includes(term)).length;
  const filenameScore = filenameHits / terms.length;
  const phraseScore =
    query.trim().length > 6 && normalizedContent.includes(normalizeText(query)) ? 1 : 0;

  return coverage * 0.5 + density * 0.25 + filenameScore * 0.15 + phraseScore * 0.1;
}

function computeIntentBoost(query: string, chunk: QueryableDocumentChunk): number {
  const normalizedQuery = normalizeText(query);
  const normalizedContent = normalizeText(chunk.content);
  let boost = 0;

  if (/\b(tabla|table|datos|data|fila|row|columna|cell)\b/.test(normalizedQuery)) {
    if (/\|.+\|/.test(chunk.content) || chunk.location?.cell || chunk.location?.row) {
      boost += 0.08;
    }
  }

  if (/\b(codigo|code|funcion|function|script|error|bug|stack)\b/.test(normalizedQuery)) {
    if (/```|function|const |let |var |class |error|exception/i.test(chunk.content)) {
      boost += 0.08;
    }
  }

  if (/\b(resumen|summary|conclusion|hallazgo|findings)\b/.test(normalizedQuery)) {
    if (/\b(resumen|summary|conclusion|hallazgo|findings)\b/.test(normalizedContent)) {
      boost += 0.05;
    }
  }

  return boost;
}

function dedupeChunks(chunks: QueryableDocumentChunk[]): QueryableDocumentChunk[] {
  const seen = new Set<string>();
  const unique: QueryableDocumentChunk[] = [];

  for (const chunk of chunks) {
    const normalized = normalizeText(chunk.content);
    if (!normalized) continue;
    const key = hashText(normalized.slice(0, 1_200));
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      ...chunk,
      content: chunk.content.trim(),
    });
  }

  return unique;
}

function formatCitation(
  filename: string,
  location?: DocumentContextLocation,
): string {
  const ext = getExtension(filename);
  if (ext === "pdf" || ext === "doc" || ext === "docx") {
    return `doc:${filename}${location?.page ? ` p${location.page}` : location?.chunkIndex ? ` chunk:${location.chunkIndex}` : ""}`;
  }
  if (ext === "ppt" || ext === "pptx") {
    return `doc:${filename}${location?.slide ? ` slide:${location.slide}` : location?.chunkIndex ? ` chunk:${location.chunkIndex}` : ""}`;
  }
  if (ext === "xls" || ext === "xlsx") {
    if (location?.sheet && location?.cell) {
      return `doc:${filename} sheet:${location.sheet} cell:${location.cell}`;
    }
    if (location?.sheet && location?.row) {
      return `doc:${filename} sheet:${location.sheet} row:${location.row}`;
    }
    if (location?.sheet) {
      return `doc:${filename} sheet:${location.sheet}`;
    }
    return `doc:${filename}${location?.chunkIndex ? ` chunk:${location.chunkIndex}` : ""}`;
  }
  if (ext === "csv") {
    return `doc:${filename}${location?.row ? ` row:${location.row}` : location?.chunkIndex ? ` chunk:${location.chunkIndex}` : ""}`;
  }
  return `doc:${filename}${location?.chunkIndex ? ` chunk:${location.chunkIndex}` : ""}`;
}

interface ScoredCandidate {
  chunk: QueryableDocumentChunk;
  embedding: number[];
  score: number;
}

function selectWithMMR(
  candidates: ScoredCandidate[],
  maxChunks: number,
  perDocumentLimit: number,
  lambda: number,
): ScoredCandidate[] {
  if (candidates.length <= 1) return candidates.slice(0, maxChunks);

  const selected: ScoredCandidate[] = [];
  const remaining = [...candidates];
  const perDocumentCounts = new Map<string, number>();

  while (remaining.length > 0 && selected.length < maxChunks) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const docKey = candidate.chunk.filename;
      const docCount = perDocumentCounts.get(docKey) ?? 0;
      if (docCount >= perDocumentLimit) continue;

      let redundancyPenalty = 0;
      for (const chosen of selected) {
        redundancyPenalty = Math.max(
          redundancyPenalty,
          cosineSimilarity(candidate.embedding, chosen.embedding),
        );
      }

      const docPenalty = docCount > 0 ? 0.05 * docCount : 0;
      const mmrScore =
        lambda * candidate.score - (1 - lambda) * redundancyPenalty - docPenalty;

      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = index;
      }
    }

    if (bestIndex === -1) break;
    const [picked] = remaining.splice(bestIndex, 1);
    selected.push(picked);
    perDocumentCounts.set(
      picked.chunk.filename,
      (perDocumentCounts.get(picked.chunk.filename) ?? 0) + 1,
    );
  }

  return selected;
}

export async function selectRelevantDocumentChunks(
  query: string,
  chunks: QueryableDocumentChunk[],
  options: BuildDocumentContextOptions = {},
): Promise<RankedDocumentChunk[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const uniqueChunks = dedupeChunks(chunks);
  if (!query.trim() || uniqueChunks.length === 0) return [];

  const queryEmbedding = await getCachedEmbedding(query.slice(0, QUERY_EMBEDDING_CHARS));
  const cheapRanked = uniqueChunks
    .map((chunk) => {
      const keywordScore = computeKeywordScore(query, chunk.filename, chunk.content);
      const intentBoost = computeIntentBoost(query, chunk);
      return {
        chunk,
        cheapScore: keywordScore + intentBoost,
      };
    })
    .sort((left, right) => right.cheapScore - left.cheapScore);

  const candidateLimit = Math.min(
    cheapRanked.length,
    Math.max(opts.maxChunks * opts.candidateMultiplier, 24),
  );
  const candidates = cheapRanked.slice(0, candidateLimit);

  const embeddings = await Promise.all(
    candidates.map(({ chunk }) => getCachedEmbedding(chunk.content)),
  );

  const scored = candidates
    .map(({ chunk, cheapScore }, index) => {
      const semanticScore = cosineSimilarity(queryEmbedding, embeddings[index]);
      const hybridScore = semanticScore * 0.62 + cheapScore * 0.38;
      return {
        chunk,
        embedding: embeddings[index],
        score: hybridScore,
      };
    })
    .sort((left, right) => right.score - left.score);

  const filtered = scored.filter((candidate) => candidate.score >= opts.minScore);
  const pool = filtered.length > 0 ? filtered : scored.slice(0, opts.maxChunks);
  const selected = selectWithMMR(
    pool,
    opts.maxChunks,
    opts.perDocumentLimit,
    opts.mmrLambda,
  );

  return selected.map(({ chunk, score }) => ({
    ...chunk,
    score,
    citation: formatCitation(chunk.filename, chunk.location),
  }));
}

export async function buildRelevantDocumentContextResult(
  query: string,
  chunks: QueryableDocumentChunk[],
  options: BuildDocumentContextOptions = {},
): Promise<DocumentContextBuildResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const selected = await selectRelevantDocumentChunks(query, chunks, opts);
  if (selected.length === 0) {
    return {
      context: "",
      chunks: [],
    };
  }

  const parts = [
    "[CONTEXTO DOCUMENTAL RELEVANTE]",
    "Se han seleccionado solo los fragmentos mas cercanos a la pregunta actual.",
  ];

  let remainingChars = opts.maxChars - parts.join("\n").length;
  for (const chunk of selected) {
    if (remainingChars <= 0) break;
    const block = `\n--- ${chunk.citation} ---\n${chunk.content.trim()}`;
    if (block.length > remainingChars) {
      const safeLength = Math.max(0, remainingChars - (`\n--- ${chunk.citation} ---\n`).length - 3);
      if (safeLength <= 0) break;
      parts.push(`\n--- ${chunk.citation} ---\n${chunk.content.trim().slice(0, safeLength)}...`);
      break;
    }
    parts.push(block);
    remainingChars -= block.length;
  }

  return {
    context: parts.join("\n").trim(),
    chunks: selected,
  };
}

export async function buildRelevantDocumentContext(
  query: string,
  chunks: QueryableDocumentChunk[],
  options: BuildDocumentContextOptions = {},
): Promise<string> {
  const result = await buildRelevantDocumentContextResult(query, chunks, options);
  return result.context;
}

function chunkPlainDocument(
  filename: string,
  text: string,
  docId?: string | null,
): QueryableDocumentChunk[] {
  const result = chunkDocument(text, {
    maxChunkSize: 1_200,
    minChunkSize: 120,
    overlapSize: 150,
    preserveCodeBlocks: true,
    preserveTables: true,
    respectHeadings: true,
    respectParagraphs: true,
  });

  return result.chunks.map((chunk, index) => ({
    docId: docId ?? undefined,
    filename,
    content: chunk.content,
    location: {
      page: chunk.pageNumber,
      chunkIndex: index + 1,
    },
  }));
}

function chunkDelimitedSections(
  filename: string,
  text: string,
  docId: string | null | undefined,
  regex: RegExp,
  locationKey: "page" | "slide" | "sheet",
): QueryableDocumentChunk[] {
  const matches = Array.from(text.matchAll(regex));
  if (matches.length === 0) {
    return chunkPlainDocument(filename, text, docId);
  }

  const chunks: QueryableDocumentChunk[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const start = current.index ?? 0;
    const end = matches[index + 1]?.index ?? text.length;
    const headerLength = current[0].length;
    const sectionText = text.slice(start + headerLength, end).trim();
    if (!sectionText) continue;

    const subChunks = chunkPlainDocument(filename, sectionText, docId);
    const locationValue = current[1]?.trim();
    for (const [subIndex, chunk] of subChunks.entries()) {
      chunks.push({
        ...chunk,
        location: {
          ...chunk.location,
          [locationKey]:
            locationKey === "sheet" ? locationValue : Number.parseInt(locationValue || "", 10),
          chunkIndex: subIndex + 1,
        },
      });
    }
  }

  return chunks;
}

export function conversationDocumentsToChunks(
  docs: ConversationDocumentInput[],
): QueryableDocumentChunk[] {
  const chunks: QueryableDocumentChunk[] = [];

  for (const doc of docs) {
    const filename = String(doc.fileName || "documento").trim() || "documento";
    const extractedText = String(doc.extractedText || "").trim();
    if (!extractedText) continue;

    if (/(?:^|\n)(?:===|---)\s*Page\s+(\d+)\s*(?:===|---)/i.test(extractedText)) {
      chunks.push(
        ...chunkDelimitedSections(
          filename,
          extractedText,
          doc.id,
          /(?:^|\n)(?:===|---)\s*Page\s+(\d+)\s*(?:===|---)\s*\n?/gi,
          "page",
        ),
      );
      continue;
    }

    if (/(?:^|\n)##\s*Slide\s+(\d+)/i.test(extractedText)) {
      chunks.push(
        ...chunkDelimitedSections(
          filename,
          extractedText,
          doc.id,
          /(?:^|\n)##\s*Slide\s+(\d+)\s*\n?/gi,
          "slide",
        ),
      );
      continue;
    }

    if (/(?:^|\n)###\s*Sheet:\s*([^\n]+)/i.test(extractedText)) {
      chunks.push(
        ...chunkDelimitedSections(
          filename,
          extractedText,
          doc.id,
          /(?:^|\n)###\s*Sheet:\s*([^\n]+)\s*\n?/gi,
          "sheet",
        ),
      );
      continue;
    }

    chunks.push(...chunkPlainDocument(filename, extractedText, doc.id));
  }

  return chunks;
}

export async function buildRelevantConversationDocumentContextResult(
  query: string,
  docs: ConversationDocumentInput[],
  options: BuildDocumentContextOptions = {},
): Promise<DocumentContextBuildResult> {
  return buildRelevantDocumentContextResult(
    query,
    conversationDocumentsToChunks(docs),
    options,
  );
}

export async function buildRelevantConversationDocumentContext(
  query: string,
  docs: ConversationDocumentInput[],
  options: BuildDocumentContextOptions = {},
): Promise<string> {
  const result = await buildRelevantConversationDocumentContextResult(
    query,
    docs,
    options,
  );
  return result.context;
}
