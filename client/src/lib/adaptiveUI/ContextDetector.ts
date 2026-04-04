/**
 * ContextDetector.ts
 *
 * Analyzes conversation messages to detect the current context type
 * (code, research, data, document, or default) by scoring keyword
 * patterns, structural signals, and sliding-window recency weighting.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: Date | string;
}

/**
 * Normalized confidence scores (0–1) for each context type.
 * All values sum to ≤ 1; the remainder represents ambiguity.
 */
export interface ContextSignals {
  code: number;
  research: number;
  data: number;
  document: number;
  /** Dominant context type determined by the highest score */
  dominant: 'code' | 'research' | 'data' | 'document' | 'default';
  /** Raw (un-normalized) scores before softmax */
  raw: Record<string, number>;
  /** Number of messages analyzed */
  sampledMessages: number;
}

export interface ContextDetectorConfig {
  /** How many recent messages to analyze (default: 10) */
  windowSize: number;
  /** Weight multiplier for more-recent messages (default: 1.5) */
  recencyBias: number;
  /** Minimum raw score needed to register a signal (default: 0.05) */
  noiseFloor: number;
}

// ─── Keyword Dictionaries ─────────────────────────────────────────────────────

const CODE_KEYWORDS: ReadonlyArray<[RegExp, number]> = [
  [/\bfunction\b/gi, 1.2],
  [/\bconst\b|\blet\b|\bvar\b/gi, 0.8],
  [/\bimport\b|\bexport\b/gi, 1.0],
  [/\bclass\b|\binterface\b|\btype\b/gi, 1.0],
  [/\breturn\b|\basync\b|\bawait\b/gi, 0.9],
  [/\bif\s*\(|\bfor\s*\(|\bwhile\s*\(/gi, 0.8],
  [/\berror\b|\bexception\b|\bstack\s*trace\b/gi, 1.1],
  [/\bdebug\b|\bconsole\.log\b|\bbreakpoint\b/gi, 1.0],
  [/\bnpm\b|\byarn\b|\bpnpm\b/gi, 0.9],
  [/\bgit\b|\bcommit\b|\bbranch\b/gi, 0.7],
  [/\bapi\b|\bendpoint\b|\bhttp\b|\bfetch\b/gi, 0.8],
  [/\bSQL\b|\bquery\b|\bdatabase\b/gi, 0.7],
  [/\btypescript\b|\bjavascript\b|\bpython\b|\bjava\b|\brust\b|\bgo\b/gi, 1.0],
  [/\bcomponent\b|\bhook\b|\bstate\b|\bprops\b/gi, 0.9],
  [/\brefactor\b|\boptimize\b|\bperformance\b/gi, 0.8],
  [/=>|===|!==|\?\?|&&|\|\|/g, 0.6],
];

const RESEARCH_KEYWORDS: ReadonlyArray<[RegExp, number]> = [
  [/\bstudy\b|\bstudies\b/gi, 1.0],
  [/\bpaper\b|\bjournal\b|\barticle\b/gi, 1.1],
  [/\banalysis\b|\banalyze\b/gi, 0.9],
  [/\bsource[s]?\b|\bcitation[s]?\b|\breference[s]?\b/gi, 1.2],
  [/\bresearch\b|\bfindings\b/gi, 1.0],
  [/\bhypothesis\b|\btheory\b|\bevidence\b/gi, 1.1],
  [/\bpublished\b|\bpeer.reviewed\b/gi, 1.2],
  [/\bauthor[s]?\b|\bet al\b/gi, 1.0],
  [/\bdoi\b|\barxiv\b|\bpubmed\b/gi, 1.3],
  [/\bliterature\b|\bbibliograph/gi, 1.1],
  [/\bsurvey\b|\bmeta.analysis\b/gi, 1.2],
  [/\bhttps?:\/\//gi, 0.6],
  [/\bconclusion[s]?\b|\babstract\b|\bmethodolog/gi, 1.0],
  [/\bstatistical(ly)?\b|\bsignificant\b|\bp.value\b/gi, 0.9],
];

const DATA_KEYWORDS: ReadonlyArray<[RegExp, number]> = [
  [/\bcsv\b|\bexcel\b|\bspreadsheet\b/gi, 1.3],
  [/\btable\b|\brow[s]?\b|\bcolumn[s]?\b/gi, 0.9],
  [/\bchart\b|\bgraph\b|\bplot\b|\bvisuali[sz]/gi, 1.1],
  [/\bdataset\b|\bdataframe\b/gi, 1.3],
  [/\bstatistic[s]?\b|\baverage\b|\bmedian\b|\bmode\b/gi, 1.0],
  [/\bpercentage\b|\bproportion\b|\bratio\b/gi, 0.9],
  [/\bmax\b|\bmin\b|\bsum\b|\bcount\b|\baggregate/gi, 0.8],
  [/\bpandas\b|\bnumpy\b|\bmatplotlib\b|\bseaborn\b/gi, 1.3],
  [/\bjson\b|\bxml\b|\bparquet\b|\bparquet\b/gi, 0.9],
  [/\bregression\b|\bclustering\b|\bclassif/gi, 1.2],
  [/\btrend\b|\bforecast\b|\bpredic/gi, 0.9],
  [/\bkpi\b|\bmetric[s]?\b|\bdashboard\b/gi, 1.0],
  [/\|\s*\w+\s*\|/g, 1.1], // markdown tables
  [/\d+\.\d+%|\d+,\d{3}/g, 0.7],
];

const DOCUMENT_KEYWORDS: ReadonlyArray<[RegExp, number]> = [
  [/\bdraft\b|\brevise\b|\bversion\b/gi, 1.1],
  [/\bsection\b|\bchapter\b|\bparagraph\b/gi, 1.0],
  [/\bedit\b|\bproofread\b|\bgrammar\b/gi, 1.1],
  [/\bformat\b|\bstyle\b|\bfont\b|\bheading\b/gi, 0.9],
  [/\breport\b|\bmemo\b|\bletter\b|\bemail\b/gi, 0.9],
  [/\boutline\b|\bstructure\b|\btable of contents/gi, 1.0],
  [/\bword\b|\bdocx\b|\bpdf\b|\bmarkdown\b/gi, 0.9],
  [/\bwrite\b|\bwriting\b|\bauthor/gi, 0.7],
  [/\bintroduction\b|\bconclusion\b|\bsummary\b/gi, 0.9],
  [/\bbullet point[s]?\b|\bnumbered list\b/gi, 0.8],
  [/\btone\b|\bvoice\b|\baudience\b/gi, 1.0],
  [/\bparaphrase\b|\brephrase\b|\bsimplify\b/gi, 1.0],
  [/\bcover letter\b|\bresume\b|\bcv\b/gi, 1.2],
  [/\bproposal\b|\bpresentation\b|\bslide/gi, 1.0],
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countMatches(text: string, patterns: ReadonlyArray<[RegExp, number]>): number {
  let total = 0;
  for (const [regex, weight] of patterns) {
    // Reset lastIndex for global regexes
    regex.lastIndex = 0;
    const matches = text.match(regex);
    if (matches) {
      total += matches.length * weight;
    }
  }
  return total;
}

function hasCodeBlocks(text: string): boolean {
  return /```[\s\S]*?```/g.test(text) || /`[^`]+`/.test(text);
}

function hasUrls(text: string): boolean {
  return /https?:\/\/[^\s]+/g.test(text);
}

function hasCitations(text: string): boolean {
  // Matches patterns like (Author, 2023), [1], [Author et al., 2023]
  return /\(\s*[A-Z][a-z]+(?:\s+et\s+al\.?)?,\s*\d{4}\s*\)|\[\d+\]|\[\d{4}\]/g.test(text);
}

function hasMarkdownTable(text: string): boolean {
  return /\|.+\|[\s\S]*\|[-: |]+\|/m.test(text);
}

/** Softmax-style normalization to map raw scores → [0, 1] range */
function normalize(scores: Record<string, number>): Record<string, number> {
  const values = Object.values(scores);
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) return Object.fromEntries(Object.keys(scores).map(k => [k, 0]));
  return Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v / total]));
}

// ─── ContextDetector ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: ContextDetectorConfig = {
  windowSize: 10,
  recencyBias: 1.5,
  noiseFloor: 0.05,
};

export class ContextDetector {
  private config: ContextDetectorConfig;

  constructor(config: Partial<ContextDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyze a list of messages and return normalized confidence scores
   * for each context type, plus the dominant context.
   */
  detectContext(messages: Message[]): ContextSignals {
    if (!messages || messages.length === 0) {
      return this.emptySignals();
    }

    // Take the most-recent N messages
    const { windowSize, recencyBias, noiseFloor } = this.config;
    const window = messages.slice(-windowSize);
    const n = window.length;

    const raw: Record<string, number> = { code: 0, research: 0, data: 0, document: 0 };

    window.forEach((msg, idx) => {
      const text = msg.content ?? '';
      // Recency weight: messages later in the window get higher weight
      const recencyWeight = 1 + ((idx / Math.max(n - 1, 1)) * (recencyBias - 1));
      // Role weight: user messages count slightly more
      const roleWeight = msg.role === 'user' ? 1.1 : 1.0;
      const w = recencyWeight * roleWeight;

      // ── Keyword scoring ──────────────────────────────
      raw.code     += countMatches(text, CODE_KEYWORDS)     * w;
      raw.research += countMatches(text, RESEARCH_KEYWORDS) * w;
      raw.data     += countMatches(text, DATA_KEYWORDS)     * w;
      raw.document += countMatches(text, DOCUMENT_KEYWORDS) * w;

      // ── Structural bonuses ───────────────────────────
      if (hasCodeBlocks(text)) raw.code     += 5 * w;
      if (hasUrls(text))       raw.research += 2 * w;
      if (hasCitations(text))  raw.research += 4 * w;
      if (hasMarkdownTable(text)) raw.data   += 4 * w;
    });

    // Apply noise floor — suppress very weak signals
    for (const key of Object.keys(raw)) {
      const max = Math.max(...Object.values(raw));
      if (max > 0 && raw[key] / max < noiseFloor) {
        raw[key] = 0;
      }
    }

    const normalized = normalize(raw);

    // Find dominant context
    let dominant: ContextSignals['dominant'] = 'default';
    let maxScore = 0;
    for (const [key, score] of Object.entries(normalized)) {
      if (score > maxScore) {
        maxScore = score;
        dominant = key as ContextSignals['dominant'];
      }
    }

    // If even the highest normalized score is very low, fall back to default
    if (maxScore < 0.25) {
      dominant = 'default';
    }

    return {
      code:     normalized.code     ?? 0,
      research: normalized.research ?? 0,
      data:     normalized.data     ?? 0,
      document: normalized.document ?? 0,
      dominant,
      raw: { ...raw },
      sampledMessages: n,
    };
  }

  /** Update configuration at runtime */
  configure(config: Partial<ContextDetectorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  private emptySignals(): ContextSignals {
    return {
      code: 0,
      research: 0,
      data: 0,
      document: 0,
      dominant: 'default',
      raw: { code: 0, research: 0, data: 0, document: 0 },
      sampledMessages: 0,
    };
  }
}

export default ContextDetector;
