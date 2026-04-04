import { randomUUID } from 'crypto';
import { Logger } from '../../lib/logger';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface DocumentSection {
  id: string;
  title: string;
  level: number; // 1-6 for headings, 0 for body
  content: string;
  wordCount: number;
  startChar: number;
  endChar: number;
  subsections: DocumentSection[];
}

export interface ExtractedTable {
  id: string;
  caption?: string;
  headers: string[];
  rows: string[][];
  location: string;
  complexity: 'simple' | 'complex';
  rowCount: number;
  colCount: number;
}

export interface ExtractedFigure {
  id: string;
  type: 'image' | 'diagram' | 'chart' | 'equation';
  caption?: string;
  altText?: string;
  location: string;
  description: string;
}

export interface KnowledgeNode {
  id: string;
  type: 'concept' | 'entity' | 'process' | 'relationship';
  label: string;
  aliases: string[];
  attributes: Record<string, unknown>;
}

export interface KnowledgeEdge {
  fromId: string;
  toId: string;
  relation: string;
  weight: number; // 0-1
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  rootConcepts: string[];
}

export interface DocumentIntelligenceResult {
  documentId: string;
  title: string;
  structure: DocumentSection[];
  tables: ExtractedTable[];
  figures: ExtractedFigure[];
  knowledgeGraph: KnowledgeGraph;
  summary: string;
  keyTerms: string[];
  language: string;
  readabilityScore: number;
  wordCount: number;
  sentenceCount: number;
  avgWordsPerSentence: number;
  metadata: Record<string, unknown>;
}

export interface DocumentIntelligenceConfig {
  extractTables: boolean;
  extractFigures: boolean;
  buildKnowledgeGraph: boolean;
  maxKeyTerms: number;
  minTermFrequency: number;
  summarize: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: DocumentIntelligenceConfig = {
  extractTables: true,
  extractFigures: true,
  buildKnowledgeGraph: true,
  maxKeyTerms: 20,
  minTermFrequency: 2,
  summarize: false,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface HeadingMatch {
  index: number;
  length: number;
  title: string;
  level: number;
}

// ---------------------------------------------------------------------------
// DocumentIntelligence
// ---------------------------------------------------------------------------

export class DocumentIntelligence {
  private readonly config: DocumentIntelligenceConfig;

  constructor(config?: Partial<DocumentIntelligenceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Main orchestrator
  // -------------------------------------------------------------------------

  async analyze(
    documentId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<DocumentIntelligenceResult> {
    Logger.info('DocumentIntelligence.analyze start', {
      documentId,
      contentLength: content.length,
    });

    const structure = this.extractStructure(content);
    const tables = this.config.extractTables
      ? this.extractTables(content)
      : [];
    const figures = this.config.extractFigures
      ? this.extractFigures(content)
      : [];
    const knowledgeGraph = this.config.buildKnowledgeGraph
      ? this.buildKnowledgeGraph(structure)
      : { nodes: [], edges: [], rootConcepts: [] };

    const keyTerms = this.computeKeyTerms(content, this.config.maxKeyTerms);
    const readabilityScore = this.computeReadability(content);
    const summary = await this.generateSummary(content, 5);

    // Basic stats
    const words = content.split(/\s+/).filter(Boolean);
    const sentences = content.match(/[^.!?]+[.!?]+/g) ?? [];
    const wordCount = words.length;
    const sentenceCount = sentences.length || 1;
    const avgWordsPerSentence = Math.round(wordCount / sentenceCount);

    // Title: first h1 or first non-empty line
    const firstSection = structure.find((s) => s.level === 1);
    const title =
      firstSection?.title ??
      content.split('\n').find((l) => l.trim().length > 0)?.trim().slice(0, 80) ??
      'Untitled';

    // Naive language detection
    const language = this._detectLanguage(content);

    Logger.info('DocumentIntelligence.analyze complete', {
      documentId,
      sections: structure.length,
      tables: tables.length,
      figures: figures.length,
      knowledgeNodes: knowledgeGraph.nodes.length,
      keyTerms: keyTerms.length,
      readabilityScore,
    });

    return {
      documentId,
      title,
      structure,
      tables,
      figures,
      knowledgeGraph,
      summary,
      keyTerms,
      language,
      readabilityScore,
      wordCount,
      sentenceCount,
      avgWordsPerSentence,
      metadata: metadata ?? {},
    };
  }

  // -------------------------------------------------------------------------
  // Structure extraction
  // -------------------------------------------------------------------------

  extractStructure(content: string): DocumentSection[] {
    const lines = content.split('\n');
    const headings: HeadingMatch[] = [];
    let charPos = 0;

    for (const line of lines) {
      const mdMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (mdMatch) {
        headings.push({
          index: charPos,
          length: line.length + 1,
          title: mdMatch[2].trim(),
          level: mdMatch[1].length,
        });
      } else {
        // ALL CAPS line with at least 3 words treated as level-3 heading
        const trimmed = line.trim();
        if (
          trimmed.length >= 6 &&
          trimmed === trimmed.toUpperCase() &&
          /[A-Z]/.test(trimmed) &&
          trimmed.split(/\s+/).length >= 3
        ) {
          headings.push({
            index: charPos,
            length: line.length + 1,
            title: trimmed,
            level: 3,
          });
        }
      }
      charPos += line.length + 1; // +1 for newline
    }

    if (headings.length === 0) {
      return [
        {
          id: randomUUID(),
          title: 'Body',
          level: 0,
          content: content.trim(),
          wordCount: content.split(/\s+/).filter(Boolean).length,
          startChar: 0,
          endChar: content.length,
          subsections: [],
        },
      ];
    }

    // Build flat section list with content ranges
    const flatSections: DocumentSection[] = [];
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const nextH = headings[i + 1];
      const contentStart = h.index + h.length;
      const contentEnd = nextH ? nextH.index : content.length;
      const sectionContent = content.slice(contentStart, contentEnd).trim();
      flatSections.push({
        id: randomUUID(),
        title: h.title,
        level: h.level,
        content: sectionContent,
        wordCount: sectionContent.split(/\s+/).filter(Boolean).length,
        startChar: h.index,
        endChar: contentEnd,
        subsections: [],
      });
    }

    // Build tree by nesting sections under lower-level parents
    const root: DocumentSection[] = [];
    const stack: DocumentSection[] = [];

    for (const section of flatSections) {
      while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
        stack.pop();
      }
      if (stack.length === 0) {
        root.push(section);
      } else {
        stack[stack.length - 1].subsections.push(section);
      }
      stack.push(section);
    }

    return root;
  }

  // -------------------------------------------------------------------------
  // Table extraction
  // -------------------------------------------------------------------------

  extractTables(content: string): ExtractedTable[] {
    const tables: ExtractedTable[] = [];
    const lines = content.split('\n');
    let currentSectionTitle = 'Document';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const mdHead = line.match(/^#{1,6}\s+(.+)/);
      if (mdHead) {
        currentSectionTitle = mdHead[1].trim();
        continue;
      }

      // Must contain at least two pipe characters to be a table row
      if (!line.includes('|') || line.trim().split('|').length < 3) continue;

      // Next line must be a separator row (---|---)
      if (i + 1 >= lines.length) continue;
      if (!lines[i + 1].match(/^\|?[\s\-|:]+\|/)) continue;

      const headers = this._parseTableRow(line);
      if (headers.length < 2) continue;

      const rows: string[][] = [];
      let j = i + 2; // skip separator
      while (j < lines.length && lines[j].includes('|')) {
        const row = this._parseTableRow(lines[j]);
        if (row.length > 0) rows.push(row);
        j++;
      }

      // Look for a caption on the line immediately before the header
      let caption: string | undefined;
      if (i > 0) {
        const prevLine = lines[i - 1].trim();
        if (/^(Table|Tabla)\s/i.test(prevLine)) {
          caption = prevLine;
        }
      }

      const colCount = headers.length;
      const rowCount = rows.length;
      const complexity: 'simple' | 'complex' =
        colCount > 6 || rowCount > 20 ? 'complex' : 'simple';

      tables.push({
        id: randomUUID(),
        caption,
        headers,
        rows,
        location: currentSectionTitle,
        complexity,
        rowCount,
        colCount,
      });

      i = j - 1; // advance past processed rows
    }

    return tables;
  }

  private _parseTableRow(line: string): string[] {
    return line
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
  }

  // -------------------------------------------------------------------------
  // Figure extraction
  // -------------------------------------------------------------------------

  extractFigures(content: string): ExtractedFigure[] {
    const figures: ExtractedFigure[] = [];
    const lines = content.split('\n');
    let currentSectionTitle = 'Document';

    const mdImageRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const figureRefRe = /Figure\s+(\d+)\s*[:--]\s*(.+)/i;
    const equationRe = /\$\$[^$]+\$\$/;
    const diagramKeywords = /\b(diagram|flowchart|architecture|schema|workflow)\b/i;
    const chartKeywords = /\b(chart|graph|plot|histogram|scatter)\b/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const mdHead = line.match(/^#{1,6}\s+(.+)/);
      if (mdHead) {
        currentSectionTitle = mdHead[1].trim();
        continue;
      }

      // Markdown images: ![alt](url)
      mdImageRe.lastIndex = 0;
      let imgMatch: RegExpExecArray | null;
      while ((imgMatch = mdImageRe.exec(line)) !== null) {
        const altText = imgMatch[1];
        const url = imgMatch[2];
        const lowerAlt = altText.toLowerCase();
        const lowerUrl = url.toLowerCase();

        let figType: ExtractedFigure['type'] = 'image';
        if (diagramKeywords.test(lowerAlt) || diagramKeywords.test(lowerUrl))
          figType = 'diagram';
        else if (chartKeywords.test(lowerAlt) || chartKeywords.test(lowerUrl))
          figType = 'chart';

        figures.push({
          id: randomUUID(),
          type: figType,
          altText: altText || undefined,
          location: currentSectionTitle,
          description: altText
            ? `${figType} — ${altText}`
            : `${figType} at ${url}`,
        });
      }

      // Inline Figure N: references
      const figRefMatch = line.match(figureRefRe);
      if (figRefMatch) {
        const caption = figRefMatch[2].trim();
        const lowerCaption = caption.toLowerCase();
        let figType: ExtractedFigure['type'] = 'image';
        if (diagramKeywords.test(lowerCaption)) figType = 'diagram';
        else if (chartKeywords.test(lowerCaption)) figType = 'chart';
        else if (equationRe.test(caption)) figType = 'equation';

        figures.push({
          id: randomUUID(),
          type: figType,
          caption,
          location: currentSectionTitle,
          description: caption,
        });
      }

      // Block equations: $$ ... $$
      if (equationRe.test(line)) {
        figures.push({
          id: randomUUID(),
          type: 'equation',
          location: currentSectionTitle,
          description: line.trim().slice(0, 120),
        });
      }
    }

    return figures;
  }

  // -------------------------------------------------------------------------
  // Knowledge graph construction
  // -------------------------------------------------------------------------

  buildKnowledgeGraph(sections: DocumentSection[]): KnowledgeGraph {
    const nodeMap = new Map<string, KnowledgeNode>(); // label.lower -> node
    const edgeCounts = new Map<string, number>(); // "fromId|toId" -> count

    const allSections = this._flattenSections(sections);

    for (const section of allSections) {
      const text = section.title + ' ' + section.content;
      const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) ?? [text];

      for (const sentence of sentences) {
        const phrases = this._extractNounPhrases(sentence);
        if (phrases.length < 2) continue;

        const nodeIds: string[] = [];
        for (const phrase of phrases) {
          const key = phrase.toLowerCase();
          if (!nodeMap.has(key)) {
            nodeMap.set(key, {
              id: randomUUID(),
              type: this._classifyNodeType(phrase),
              label: phrase,
              aliases: [],
              attributes: {},
            });
          }
          nodeIds.push(nodeMap.get(key)!.id);
        }

        // Co-occurrence edges between all phrase pairs in the sentence
        for (let a = 0; a < nodeIds.length; a++) {
          for (let b = a + 1; b < nodeIds.length; b++) {
            const edgeKey = `${nodeIds[a]}|${nodeIds[b]}`;
            const reverseKey = `${nodeIds[b]}|${nodeIds[a]}`;
            const canonicalKey = edgeCounts.has(reverseKey) ? reverseKey : edgeKey;
            edgeCounts.set(canonicalKey, (edgeCounts.get(canonicalKey) ?? 0) + 1);
          }
        }
      }
    }

    // Normalise edge weights by max co-occurrence count
    const maxCount = Math.max(1, ...Array.from(edgeCounts.values()));
    const edges: KnowledgeEdge[] = Array.from(edgeCounts.entries()).map(
      ([key, count]) => {
        const pipeIdx = key.indexOf('|');
        return {
          fromId: key.slice(0, pipeIdx),
          toId: key.slice(pipeIdx + 1),
          relation: 'co-occurs',
          weight: Math.round((count / maxCount) * 100) / 100,
        };
      },
    );

    // Rank nodes by degree for root concept selection
    const nodeDegree = new Map<string, number>();
    for (const edge of edges) {
      nodeDegree.set(edge.fromId, (nodeDegree.get(edge.fromId) ?? 0) + 1);
      nodeDegree.set(edge.toId, (nodeDegree.get(edge.toId) ?? 0) + 1);
    }

    const nodes = Array.from(nodeMap.values());
    const rootConcepts = [...nodes]
      .sort((a, b) => (nodeDegree.get(b.id) ?? 0) - (nodeDegree.get(a.id) ?? 0))
      .slice(0, 5)
      .map((n) => n.id);

    Logger.debug('DocumentIntelligence KG built', {
      nodes: nodes.length,
      edges: edges.length,
      rootConcepts: rootConcepts.length,
    });

    return { nodes, edges, rootConcepts };
  }

  private _classifyNodeType(phrase: string): KnowledgeNode['type'] {
    const lower = phrase.toLowerCase();
    const processWords = ['process', 'method', 'procedure', 'algorithm', 'workflow', 'system'];
    const relationWords = ['relation', 'correlation', 'impact', 'effect', 'influence'];
    if (processWords.some((w) => lower.includes(w))) return 'process';
    if (relationWords.some((w) => lower.includes(w))) return 'relationship';
    if (/^[A-Z][a-z]/.test(phrase) && phrase.includes(' ')) return 'entity';
    return 'concept';
  }

  private _flattenSections(sections: DocumentSection[]): DocumentSection[] {
    const result: DocumentSection[] = [];
    for (const s of sections) {
      result.push(s);
      if (s.subsections.length > 0) {
        result.push(...this._flattenSections(s.subsections));
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // TF-IDF key terms
  // -------------------------------------------------------------------------

  computeKeyTerms(content: string, topN = 20): string[] {
    const ESTIMATED_CORPUS_SIZE = 10000;

    const tokens = content
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3 && !this._isStopword(w));

    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    // Filter by minimum frequency threshold
    const docTokenCount = tokens.length || 1;
    const filteredTf = new Map<string, number>();
    for (const [term, count] of tf.entries()) {
      if (count >= this.config.minTermFrequency) {
        filteredTf.set(term, count / docTokenCount);
      }
    }

    // Sort by TF descending to assign Zipf rank for IDF estimation
    const sorted = Array.from(filteredTf.entries()).sort(([, a], [, b]) => b - a);
    const tfidfScores: Array<{ term: string; score: number }> = sorted.map(
      ([term, termTf], rank) => {
        const idf = Math.log(ESTIMATED_CORPUS_SIZE / (rank + 1));
        return { term, score: termTf * idf };
      },
    );

    tfidfScores.sort((a, b) => b.score - a.score);
    return tfidfScores.slice(0, topN).map((e) => e.term);
  }

  // -------------------------------------------------------------------------
  // Readability (Flesch Reading Ease)
  // -------------------------------------------------------------------------

  computeReadability(content: string): number {
    const sentences = content.match(/[^.!?]+[.!?]+/g) ?? [];
    const sentenceCount = sentences.length || 1;
    const words = content.split(/\s+/).filter(Boolean);
    const wordCount = words.length || 1;

    let totalSyllables = 0;
    for (const word of words) {
      totalSyllables += this._countSyllables(word);
    }

    const asl = wordCount / sentenceCount;
    const asw = totalSyllables / wordCount;
    const score = 206.835 - 1.015 * asl - 84.6 * asw;

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  private _countSyllables(word: string): number {
    const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
    if (cleaned.length === 0) return 1;

    // Remove trailing silent 'e' before counting vowel groups
    const withoutTrailingE =
      cleaned.endsWith('e') && cleaned.length > 2
        ? cleaned.slice(0, -1)
        : cleaned;

    const matches = withoutTrailingE.match(/[aeiouy]+/g);
    return Math.max(1, matches ? matches.length : 1);
  }

  // -------------------------------------------------------------------------
  // Noun phrase extraction (used by knowledge graph builder)
  // -------------------------------------------------------------------------

  private _extractNounPhrases(sentence: string): string[] {
    const phrases: string[] = [];
    const words = sentence.split(/\s+/).filter(Boolean);
    let currentPhrase: string[] = [];

    for (const word of words) {
      const clean = word.replace(/[^\w]/g, '');
      if (clean.length === 0) {
        if (currentPhrase.length >= 1) {
          phrases.push(currentPhrase.join(' '));
          currentPhrase = [];
        }
        continue;
      }
      if (/^[A-Z]/.test(clean)) {
        currentPhrase.push(clean);
      } else {
        if (currentPhrase.length >= 1) {
          phrases.push(currentPhrase.join(' '));
          currentPhrase = [];
        }
        // Include meaningful single lowercase words
        if (clean.length > 4 && !this._isStopword(clean.toLowerCase())) {
          phrases.push(clean);
        }
      }
    }
    if (currentPhrase.length >= 1) phrases.push(currentPhrase.join(' '));

    // Strip purely numeric or single-character results
    return phrases.filter((p) => p.length > 1 && !/^\d+$/.test(p));
  }

  // -------------------------------------------------------------------------
  // Summary generation
  // -------------------------------------------------------------------------

  async generateSummary(
    content: string,
    maxSentences = 5,
  ): Promise<string> {
    if (!this.config.summarize) {
      // Extractive: first sentence of each top-level section
      const structure = this.extractStructure(content);
      const topLevel = structure.filter((s) => s.level <= 1);
      const sentences: string[] = [];

      for (const section of topLevel) {
        if (sentences.length >= maxSentences) break;
        const firstSentence = section.content.match(/[^.!?]+[.!?]+/)?.[0];
        if (firstSentence) sentences.push(firstSentence.trim());
      }

      if (sentences.length === 0) {
        const allSentences = content.match(/[^.!?]+[.!?]+/g) ?? [];
        return allSentences.slice(0, maxSentences).join(' ').trim();
      }

      return sentences.join(' ').trim();
    }

    // LLM path: requires an injected LLM client in a real deployment.
    // Fall back to extractive to avoid a hard dependency here.
    Logger.warn(
      'DocumentIntelligence.generateSummary: summarize=true but no LLM client injected — using extractive fallback',
    );
    const allSentences = content.match(/[^.!?]+[.!?]+/g) ?? [];
    return allSentences.slice(0, maxSentences).join(' ').trim();
  }

  // -------------------------------------------------------------------------
  // Language detection
  // -------------------------------------------------------------------------

  private _detectLanguage(content: string): string {
    const lower = content.toLowerCase();
    const esSignals = ['que', 'del', 'los', 'las', 'una', 'con', 'por', 'para', 'esta'];
    const enSignals = ['the', 'and', 'that', 'for', 'are', 'with', 'this', 'from'];
    const esCount = esSignals.filter((w) => new RegExp(`\\b${w}\\b`).test(lower)).length;
    const enCount = enSignals.filter((w) => new RegExp(`\\b${w}\\b`).test(lower)).length;
    return esCount > enCount ? 'es' : 'en';
  }

  // -------------------------------------------------------------------------
  // Stopword list (English + Spanish, 60+ entries)
  // -------------------------------------------------------------------------

  private _isStopword(word: string): boolean {
    const STOPWORDS = new Set([
      // English
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can',
      'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him',
      'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'way',
      'who', 'did', 'use', 'man', 'too', 'she', 'they', 'from', 'that',
      'this', 'with', 'have', 'been', 'were', 'said', 'each', 'which',
      'their', 'will', 'more', 'also', 'into', 'some', 'than', 'then',
      'these', 'would', 'other', 'when', 'there', 'about', 'many', 'such',
      'just', 'over', 'after', 'under', 'while', 'being', 'should', 'could',
      // Spanish
      'que', 'del', 'los', 'las', 'una', 'con', 'por', 'para', 'esta',
      'como', 'pero', 'sus', 'ser', 'entre', 'desde', 'hasta', 'sobre',
      'hacia', 'durante', 'mediante', 'porque', 'aunque', 'cuando', 'donde',
      'todo', 'este', 'ese', 'unos', 'unas', 'tambien', 'mismo', 'cada',
    ]);
    return STOPWORDS.has(word.toLowerCase());
  }
}
