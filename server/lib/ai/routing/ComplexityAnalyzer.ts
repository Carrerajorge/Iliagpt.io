/**
 * Complexity Analyzer
 * Produces a 0-1 complexity score for a chat request.
 * Higher scores route to more capable (and expensive) models.
 *
 * Signals analysed:
 *   - token count vs model context window
 *   - code presence & density
 *   - multi-step reasoning markers
 *   - domain-specific vocabulary
 *   - multi-modal content
 *   - chain-of-thought / math indicators
 *   - conversation depth
 */

import { IChatRequest, IChatMessage, MessageRole } from '../providers/core/types';

// ─── Signal weights (must sum ≤ 1.0) ─────────────────────────────────────────

const WEIGHTS = {
  tokenLength: 0.15,
  codePresence: 0.15,
  multiStepReasoning: 0.20,
  domainKeywords: 0.15,
  mathSymbols: 0.10,
  multiModal: 0.10,
  conversationDepth: 0.10,
  ambiguity: 0.05,
} as const;

// ─── Domain keyword banks ─────────────────────────────────────────────────────

const HARD_DOMAIN_KEYWORDS = [
  'eigenvalue', 'fourier', 'gradient descent', 'backpropagation', 'topology',
  'manifold', 'bayesian', 'stochastic', 'thermodynamics', 'quantum',
  'constitutional law', 'jurisprudence', 'pharmacokinetics', 'pathophysiology',
  'securitization', 'derivatives', 'arbitrage', 'cryptography', 'zero-knowledge',
  'formal verification', 'type theory', 'denotational', 'category theory',
];

const REASONING_MARKERS = [
  'because', 'therefore', 'thus', 'hence', 'consequently', 'as a result',
  'given that', 'assuming', 'prove that', 'derive', 'explain why',
  'what if', 'compare and contrast', 'analyze the tradeoffs',
  'step by step', 'reasoning', 'justify',
];

const MULTI_STEP_PATTERNS = [
  /\b(?:first|second|third|finally)\b/gi,
  /\b(?:then|next|after that|subsequently)\b/gi,
  /if\s+.+then\s+/gi,
  /\b(?:however|nevertheless|on the other hand)\b/gi,
];

const CODE_INDICATORS = [
  /```[\s\S]*?```/g,     // fenced code blocks
  /`[^`]+`/g,            // inline code
  /\b(?:function|class|import|export|def|const|let|var|return)\b/g,
  /[{};()=>]\s*\n/g,     // code-like punctuation
];

const MATH_PATTERNS = [
  /\$\$?[\s\S]+?\$\$?/g,   // LaTeX
  /\\(?:frac|sqrt|sum|int|lim|prod)\{/g,
  /\b\d+\s*[+\-*/^]\s*\d+\b/g,   // arithmetic expressions
  /\b(?:equation|formula|integral|derivative|matrix)\b/gi,
];

// ─── Analyzer ─────────────────────────────────────────────────────────────────

export interface ComplexityBreakdown {
  score: number;         // 0-1 composite
  signals: {
    tokenLength: number;
    codePresence: number;
    multiStepReasoning: number;
    domainKeywords: number;
    mathSymbols: number;
    multiModal: number;
    conversationDepth: number;
    ambiguity: number;
  };
  dominant: string;      // highest contributing signal name
  recommendation: 'fast' | 'balanced' | 'powerful';
}

export class ComplexityAnalyzer {

  analyze(request: IChatRequest): ComplexityBreakdown {
    const allText = this._extractText(request.messages);
    const userMessages = request.messages.filter((m) => m.role === MessageRole.User);
    const lastUser = userMessages[userMessages.length - 1];
    const lastText = lastUser
      ? (typeof lastUser.content === 'string' ? lastUser.content : lastUser.content.map((c) => c.text ?? '').join(' '))
      : '';

    const signals = {
      tokenLength: this._scoreTokenLength(allText),
      codePresence: this._scoreCode(allText),
      multiStepReasoning: this._scoreReasoning(lastText),
      domainKeywords: this._scoreDomainKeywords(allText),
      mathSymbols: this._scoreMath(allText),
      multiModal: this._scoreMultiModal(request.messages),
      conversationDepth: this._scoreConversationDepth(request.messages),
      ambiguity: this._scoreAmbiguity(lastText),
    };

    // Weighted sum
    let score = 0;
    for (const [key, weight] of Object.entries(WEIGHTS)) {
      score += (signals[key as keyof typeof signals] ?? 0) * weight;
    }
    score = Math.min(1, Math.max(0, score));

    // Dominant signal
    const dominant = Object.entries(signals).reduce((a, b) => (b[1] > a[1] ? b : a))[0];

    const recommendation: ComplexityBreakdown['recommendation'] =
      score < 0.30 ? 'fast'
      : score < 0.65 ? 'balanced'
      : 'powerful';

    return { score, signals, dominant, recommendation };
  }

  /** Convenience: return only the 0-1 score. */
  score(request: IChatRequest): number {
    return this.analyze(request).score;
  }

  // ── Signal scorers ───────────────────────────────────────────────────────────

  private _scoreTokenLength(text: string): number {
    const approxTokens = text.length / 4;
    // >32k tokens → 1.0; linear below
    return Math.min(1, approxTokens / 32_000);
  }

  private _scoreCode(text: string): number {
    let matches = 0;
    for (const pattern of CODE_INDICATORS) {
      const m = text.match(new RegExp(pattern.source, pattern.flags));
      matches += m?.length ?? 0;
    }
    return Math.min(1, matches / 20);
  }

  private _scoreReasoning(text: string): number {
    const lower = text.toLowerCase();
    let hits = 0;
    for (const marker of REASONING_MARKERS) {
      if (lower.includes(marker)) hits++;
    }
    let patternHits = 0;
    for (const pattern of MULTI_STEP_PATTERNS) {
      const m = text.match(new RegExp(pattern.source, pattern.flags));
      patternHits += m?.length ?? 0;
    }
    return Math.min(1, (hits / 8) + (patternHits / 10));
  }

  private _scoreDomainKeywords(text: string): number {
    const lower = text.toLowerCase();
    let hits = 0;
    for (const kw of HARD_DOMAIN_KEYWORDS) {
      if (lower.includes(kw)) hits++;
    }
    return Math.min(1, hits / 5);
  }

  private _scoreMath(text: string): number {
    let matches = 0;
    for (const pattern of MATH_PATTERNS) {
      const m = text.match(new RegExp(pattern.source, pattern.flags));
      matches += m?.length ?? 0;
    }
    return Math.min(1, matches / 10);
  }

  private _scoreMultiModal(messages: IChatMessage[]): number {
    let imageCount = 0;
    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        imageCount += msg.content.filter((c) => c.type === 'image_url' || c.type === 'image_base64').length;
      }
    }
    return Math.min(1, imageCount / 3);
  }

  private _scoreConversationDepth(messages: IChatMessage[]): number {
    // Longer conversation → more context needed → harder to reason about
    const turns = messages.filter((m) => m.role !== MessageRole.System).length;
    return Math.min(1, turns / 20);
  }

  private _scoreAmbiguity(text: string): number {
    const ambiguityMarkers = [
      'not sure', 'unclear', 'ambiguous', 'can you clarify', 'what do you mean',
      'depends', 'it depends', 'there are multiple', 'several ways',
    ];
    const lower = text.toLowerCase();
    let hits = 0;
    for (const marker of ambiguityMarkers) {
      if (lower.includes(marker)) hits++;
    }
    return Math.min(1, hits / 3);
  }

  private _extractText(messages: IChatMessage[]): string {
    return messages
      .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((c) => c.text ?? '').join(' ')))
      .join('\n');
  }
}

export const complexityAnalyzer = new ComplexityAnalyzer();
