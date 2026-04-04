import { Logger } from '../../lib/logger';

// ─── Shared chunk types ────────────────────────────────────────────────────────

interface RetrievedChunk {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
  tokens: number;
  score: number;
  source: string;
  retrievalMethod: string;
}

export interface RankedChunk extends RetrievedChunk {
  rank: number;
  rerankScore?: number;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type CitationStyle = 'inline' | 'bibliography' | 'both' | 'none';

export interface Citation {
  id: string;
  chunkId: string;
  documentId: string;
  source: string;
  page?: number;
  section?: string;
  snippet: string;
  confidence: number;
}

export interface InlineCitation {
  marker: string;
  citation: Citation;
  position: number;
}

export interface BibEntry {
  id: string;
  authors?: string[];
  title: string;
  source: string;
  year?: number;
  page?: string;
  url?: string;
  accessedAt: Date;
}

export interface Bibliography {
  entries: BibEntry[];
  style: 'apa' | 'mla' | 'chicago' | 'simple';
}

export interface CitedAnswer {
  content: string;
  inlineCitations: InlineCitation[];
  bibliography: Bibliography;
  verificationScore: number;
  unverifiedClaims: string[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

// Common English stop words to exclude from term overlap computation
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'this',
  'that', 'these', 'those', 'it', 'its', 'not', 'also', 'which', 'what',
  'how', 'when', 'where', 'who', 'why', 'there', 'their', 'they', 'we',
  'he', 'she', 'i', 'you', 'my', 'your', 'his', 'her', 'our', 'up',
  'out', 'if', 'then', 'than', 'so', 'no', 'just', 'more', 'about',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function splitIntoSentences(text: string): string[] {
  // Split on . ! ? followed by space or end of string, but preserve the punctuation
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isNoun(word: string): boolean {
  // Heuristic: capitalized (after first position), or longer words not in stop words
  return word.length >= 4 && !STOP_WORDS.has(word.toLowerCase());
}

// ─── CitationGenerator ────────────────────────────────────────────────────────

export class CitationGenerator {
  private readonly style: CitationStyle;
  private readonly bibStyle: Bibliography['style'];

  constructor(style: CitationStyle = 'both', bibStyle: Bibliography['style'] = 'simple') {
    this.style = style;
    this.bibStyle = bibStyle;
  }

  generate(answer: string, chunks: RankedChunk[]): CitedAnswer {
    if (this.style === 'none') {
      const { score, unverified } = this.verify(answer, chunks);
      return {
        content: answer,
        inlineCitations: [],
        bibliography: { entries: [], style: this.bibStyle },
        verificationScore: score,
        unverifiedClaims: unverified,
      };
    }

    const sentences = splitIntoSentences(answer);
    const citationMap = new Map<string, { chunk: RankedChunk; confidence: number }>();
    // Map from sentence index to citation assignment
    const sentenceCitations: Array<{ sentence: string; match: { chunk: RankedChunk; confidence: number } | null }> = [];

    for (const sentence of sentences) {
      const match = this._matchClaim(sentence, chunks);
      sentenceCitations.push({ sentence, match });
      if (match) {
        citationMap.set(match.chunk.id, match);
      }
    }

    // Build ordered citations from unique chunks (in order of first mention)
    const orderedChunks: RankedChunk[] = [];
    const seenChunkIds = new Set<string>();
    for (const { match } of sentenceCitations) {
      if (match && !seenChunkIds.has(match.chunk.id)) {
        orderedChunks.push(match.chunk);
        seenChunkIds.add(match.chunk.id);
      }
    }

    // Build Citation objects
    const citationObjects = new Map<string, Citation>();
    orderedChunks.forEach((chunk, idx) => {
      const match = citationMap.get(chunk.id)!;
      const citation: Citation = {
        id: `cite-${idx + 1}`,
        chunkId: chunk.id,
        documentId: chunk.documentId,
        source: chunk.source,
        page: typeof chunk.metadata['page'] === 'number' ? chunk.metadata['page'] : undefined,
        section: typeof chunk.metadata['section'] === 'string' ? chunk.metadata['section'] : undefined,
        snippet: chunk.content.slice(0, 150),
        confidence: match.confidence,
      };
      citationObjects.set(chunk.id, citation);
    });

    // Build inline citations with positions
    const inlineCitations: InlineCitation[] = [];
    let charOffset = 0;
    const annotatedSentences: string[] = [];

    for (const { sentence, match } of sentenceCitations) {
      if (match && (this.style === 'inline' || this.style === 'both')) {
        const citation = citationObjects.get(match.chunk.id)!;
        const markerNum = orderedChunks.indexOf(match.chunk) + 1;
        const marker = `[${markerNum}]`;
        const annotatedSentence = `${sentence} ${marker}`;
        const position = charOffset + sentence.length + 1;
        inlineCitations.push({ marker, citation, position });
        annotatedSentences.push(annotatedSentence);
        charOffset += annotatedSentence.length + 1;
      } else {
        annotatedSentences.push(sentence);
        charOffset += sentence.length + 1;
      }
    }

    const finalContent =
      this.style === 'inline' || this.style === 'both'
        ? annotatedSentences.join(' ')
        : answer;

    // Build bibliography
    const bibEntries: BibEntry[] = orderedChunks.map((chunk, idx) =>
      this._buildBibEntry(chunk, idx + 1),
    );
    const bibliography: Bibliography = { entries: bibEntries, style: this.bibStyle };

    // Verification
    const { score, unverified } = this.verify(answer, chunks);

    Logger.info('[CitationGenerator] Citations generated', {
      sentenceCount: sentences.length,
      citedSentences: inlineCitations.length,
      uniqueSources: orderedChunks.length,
      verificationScore: score,
    });

    return {
      content: finalContent,
      inlineCitations,
      bibliography,
      verificationScore: score,
      unverifiedClaims: unverified,
    };
  }

  private _matchClaim(
    claim: string,
    chunks: RankedChunk[],
  ): { chunk: RankedChunk; confidence: number } | null {
    const claimTokens = tokenize(claim);
    if (claimTokens.length === 0) return null;

    let bestScore = 0;
    let bestChunk: RankedChunk | null = null;

    for (const chunk of chunks) {
      const chunkTokens = tokenize(chunk.content);
      const similarity = jaccardSimilarity(claimTokens, chunkTokens);

      // Weight by chunk rank score to prefer higher-ranked sources
      const weightedScore = similarity * (0.7 + 0.3 * chunk.score);

      if (weightedScore > bestScore) {
        bestScore = weightedScore;
        bestChunk = chunk;
      }
    }

    const JACCARD_THRESHOLD = 0.15;
    if (bestScore < JACCARD_THRESHOLD || !bestChunk) return null;

    return { chunk: bestChunk, confidence: Math.min(1, bestScore * 2) };
  }

  private _insertInlineMarkers(text: string, citations: InlineCitation[]): string {
    // Build a sentence-level mapping and re-annotate
    const sentences = splitIntoSentences(text);
    const positionToCitation = new Map<number, InlineCitation>();
    for (const ic of citations) {
      positionToCitation.set(ic.position, ic);
    }

    // Simple approach: append marker after sentence if citation exists for it
    const markerBySentence = new Map<string, string>();
    for (const ic of citations) {
      // Match by sentence content
      markerBySentence.set(ic.citation.snippet.slice(0, 50), ic.marker);
    }

    return sentences
      .map((s) => {
        const citation = citations.find((ic) =>
          s.includes(ic.citation.snippet.slice(0, 30)),
        );
        return citation ? `${s} ${citation.marker}` : s;
      })
      .join(' ');
  }

  private _buildBibEntry(chunk: RankedChunk, index: number): BibEntry {
    const title =
      typeof chunk.metadata['title'] === 'string'
        ? (chunk.metadata['title'] as string)
        : chunk.content.slice(0, 80).replace(/\n/g, ' ').trim();

    const authors: string[] = [];
    if (Array.isArray(chunk.metadata['authors'])) {
      for (const a of chunk.metadata['authors'] as unknown[]) {
        if (typeof a === 'string') authors.push(a);
      }
    } else if (typeof chunk.metadata['author'] === 'string') {
      authors.push(chunk.metadata['author'] as string);
    }

    const year =
      typeof chunk.metadata['year'] === 'number'
        ? chunk.metadata['year']
        : typeof chunk.metadata['publishedAt'] === 'string'
        ? new Date(chunk.metadata['publishedAt'] as string).getFullYear()
        : undefined;

    const page =
      typeof chunk.metadata['page'] === 'number'
        ? String(chunk.metadata['page'])
        : typeof chunk.metadata['pages'] === 'string'
        ? (chunk.metadata['pages'] as string)
        : undefined;

    const url =
      typeof chunk.metadata['url'] === 'string'
        ? (chunk.metadata['url'] as string)
        : undefined;

    return {
      id: `ref-${index}`,
      authors: authors.length > 0 ? authors : undefined,
      title,
      source: chunk.source,
      year,
      page,
      url,
      accessedAt: new Date(),
    };
  }

  private _formatBibEntry(entry: BibEntry, style: Bibliography['style']): string {
    const authorsStr =
      entry.authors && entry.authors.length > 0
        ? entry.authors.join(', ')
        : 'Unknown Author';
    const yearStr = entry.year ? `${entry.year}` : 'n.d.';
    const pageStr = entry.page ? `, p.${entry.page}` : '';
    const urlStr = entry.url ? ` Retrieved from ${entry.url}` : '';

    switch (style) {
      case 'simple':
        return `[${entry.id}] ${entry.source}${pageStr}: "${entry.title.slice(0, 80)}"`;

      case 'apa':
        return `${authorsStr} (${yearStr}). ${entry.title}. ${entry.source}.${urlStr}`;

      case 'mla':
        return `${authorsStr}. "${entry.title}." ${entry.source}, ${yearStr}.${urlStr}`;

      case 'chicago':
        return `${authorsStr}. ${entry.title}. ${entry.source}: Publisher, ${yearStr}.${urlStr}`;

      default:
        return `${authorsStr} (${yearStr}). ${entry.title}. ${entry.source}.`;
    }
  }

  verify(
    answer: string,
    chunks: RankedChunk[],
  ): { score: number; unverified: string[] } {
    const sentences = splitIntoSentences(answer);
    if (sentences.length === 0) return { score: 1.0, unverified: [] };

    const unverified: string[] = [];
    let verifiedCount = 0;

    for (const sentence of sentences) {
      const words = sentence
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => isNoun(w));

      if (words.length < 2) {
        // Short or stop-word-only sentences are considered verified by default
        verifiedCount++;
        continue;
      }

      const keyNouns = words.slice(0, 8); // Use up to 8 key nouns
      let supported = false;

      for (const chunk of chunks) {
        const chunkLower = chunk.content.toLowerCase();
        const matchCount = keyNouns.filter((noun) => chunkLower.includes(noun)).length;
        if (matchCount >= 2) {
          supported = true;
          break;
        }
      }

      if (supported) {
        verifiedCount++;
      } else {
        unverified.push(sentence);
      }
    }

    const score = sentences.length > 0 ? verifiedCount / sentences.length : 1.0;

    Logger.debug('[CitationGenerator] Verification complete', {
      totalSentences: sentences.length,
      verifiedCount,
      unverifiedCount: unverified.length,
      score,
    });

    return { score, unverified };
  }

  formatBibliography(entries: BibEntry[]): string {
    if (entries.length === 0) return '';

    const lines: string[] = ['References:', ''];
    entries.forEach((entry, idx) => {
      const entryWithId: BibEntry = { ...entry, id: String(idx + 1) };
      lines.push(this._formatBibEntry(entryWithId, this.bibStyle));
    });

    return lines.join('\n');
  }
}
