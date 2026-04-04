/**
 * MessagePreprocessor
 *
 * First stage in the deterministic chat pipeline.  Composes the existing
 * TextPreprocessor (NFC, language detection, quality flags) and adds:
 *
 *   - Deduplication (SHA-256 hash of normalized text)
 *   - Intent classification: question | command | creative | code | analysis | conversation
 *   - Entity extraction: URLs, code blocks, file paths, dates, mentions
 *   - Enrichment metadata attached to the message for downstream stages
 *
 * Does NOT call an LLM — all classification is deterministic pattern matching.
 * Zero network I/O → always fast (<5 ms).
 */

import { createHash }        from 'crypto';
import { z }                 from 'zod';
import { Logger }            from '../lib/logger';
import { TextPreprocessor }  from './textPreprocessor';

// ─── Public schemas ──────────────────────────────────────────────────────────

export const IntentSchema = z.enum([
  'question',      // Ends with "?" or starts with wh-word / "can/could/would/is/are/do/does/did"
  'command',       // Imperative verb: write, create, fix, explain, summarize, translate…
  'creative',      // Story, poem, idea, brainstorm, imagine…
  'code',          // Code generation / debugging
  'analysis',      // Analyze, compare, evaluate, review, rate…
  'conversation',  // Casual / greeting / small-talk
]);
export type Intent = z.infer<typeof IntentSchema>;

export const EntityTypeSchema = z.enum([
  'url', 'code_block', 'file_path', 'date', 'mention', 'number',
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const ExtractedEntitySchema = z.object({
  type  : EntityTypeSchema,
  value : z.string(),
  start : z.number().int().nonneg(),
  end   : z.number().int().nonneg(),
});
export type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

export const MessageMetaSchema = z.object({
  /** SHA-256 of normalised text (for dedup checks). */
  contentHash    : z.string(),
  /** Detected language BCP-47 code or 'unknown'. */
  language       : z.string(),
  /** Primary intent inferred without LLM. */
  intent         : IntentSchema,
  /** Secondary intent (may equal primary). */
  secondaryIntent: IntentSchema.optional(),
  /** Extracted entities sorted by start offset. */
  entities       : z.array(ExtractedEntitySchema),
  /** True if the message looks like a follow-up to the previous turn. */
  isFollowUp     : z.boolean(),
  /** True when the message is likely a duplicate of a very recent message. */
  isDuplicate    : z.boolean(),
  /** Rough word count (post-normalisation). */
  wordCount      : z.number().int().nonneg(),
  /** True if the message contains at least one code block. */
  hasCode        : z.boolean(),
  /** True if the message contains at least one URL. */
  hasUrls        : z.boolean(),
  /** Quality score 0–1 from TextPreprocessor (grammar, completeness…). */
  qualityScore   : z.number().min(0).max(1),
  /** Processing time in ms. */
  processingMs   : z.number().nonneg(),
});
export type MessageMeta = z.infer<typeof MessageMetaSchema>;

export const PreprocessedMessageSchema = z.object({
  /** Original text as provided by the caller. */
  original  : z.string(),
  /** Cleaned, NFC-normalised text ready for LLM consumption. */
  normalized: z.string(),
  /** Rich metadata attached by the preprocessor. */
  meta      : MessageMetaSchema,
});
export type PreprocessedMessage = z.infer<typeof PreprocessedMessageSchema>;

// ─── Regex patterns ───────────────────────────────────────────────────────────

const URL_RE        = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
const CODE_BLOCK_RE = /```[\s\S]*?```|`[^`\n]+`/g;
const FILE_PATH_RE  = /(?:^|[\s(["'])(\/?(?:[\w.-]+\/)+[\w.-]+\.[a-zA-Z]{1,10})/g;
const DATE_RE       = /\b(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4})\b/gi;
const MENTION_RE    = /@[\w.-]+/g;
const NUMBER_RE     = /\b-?\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|b|%|usd|eur|gbp))?\b/gi;

// ─── Intent classifier (rule-based) ──────────────────────────────────────────

const QUESTION_STARTERS = /^(?:what|where|when|who|whom|whose|which|why|how|is|are|was|were|will|would|could|should|can|do|does|did|has|have|had)\b/i;
const COMMAND_VERBS     = /^(?:write|create|build|make|generate|implement|code|fix|debug|refactor|explain|describe|summarize|summarise|translate|convert|list|give|show|provide|find|search|calculate|solve|format|rewrite|improve|update|add|remove|delete|edit|change|draw|design|suggest|recommend|help|tell|teach|analyze|analyse|compare|review|check|test|run|deploy|install|configure|setup|migrate|parse|extract|classify|predict|optimize|optimise)\b/i;
const CREATIVE_WORDS    = /\b(?:story|poem|song|lyrics|imagine|creative|fictional|write a|compose|brainstorm|idea(?:s)?|concept|novel|narrative|essay|script|dialogue|metaphor|analogy|hypothetical|fantasy|scenario)\b/i;
const CODE_SIGNALS      = /```|`[^`]+`|\bcode\b|\bfunction\b|\bclass\b|\bimport\b|\bconst\b|\blet\b|\bvar\b|\bdef\b|\bif\s*\(|\bfor\s*\(|\bwhile\s*\(|\btypescript\b|\bjavascript\b|\bpython\b|\bjava\b|\bgolang\b|\brust\b|\bsql\b|\bhtml\b|\bcss\b|\bapi\b|\bgit\b|\bbug\b|\berror\b|\bexception\b/i;
const ANALYSIS_WORDS    = /\b(?:analyze|analyse|compare|contrast|evaluate|assess|review|explain why|pros and cons|differences|similarities|impact|effect(?:s)?|cause(?:s)?|relationship|correlation|pattern(?:s)?|trend(?:s)?|performance|benchmark|metric(?:s)?|data|statistic(?:s)?|research|study|report)\b/i;

function classifyIntent(text: string): { primary: Intent; secondary?: Intent } {
  const t         = text.trim();
  const firstLine = t.split('\n')[0] ?? t;

  const isQuestion = t.endsWith('?') || QUESTION_STARTERS.test(firstLine);
  const isCommand  = COMMAND_VERBS.test(firstLine);
  const isCreative = CREATIVE_WORDS.test(t);
  const isCode     = CODE_SIGNALS.test(t);
  const isAnalysis = ANALYSIS_WORDS.test(t);

  // Determine primary intent (priority order)
  let primary: Intent;
  if (isCode && (isCommand || /\b(?:write|implement|create|fix|debug|refactor)\b/i.test(firstLine))) {
    primary = 'code';
  } else if (isCommand && isCreative) {
    primary = 'creative';
  } else if (isCommand && isAnalysis) {
    primary = 'analysis';
  } else if (isCommand) {
    primary = 'command';
  } else if (isQuestion) {
    primary = 'question';
  } else if (isAnalysis) {
    primary = 'analysis';
  } else if (isCreative) {
    primary = 'creative';
  } else {
    primary = 'conversation';
  }

  // Secondary intent (first alternative that isn't primary)
  const candidates: Intent[] = [];
  if (isCode      && primary !== 'code')      candidates.push('code');
  if (isQuestion  && primary !== 'question')  candidates.push('question');
  if (isCommand   && primary !== 'command')   candidates.push('command');
  if (isAnalysis  && primary !== 'analysis')  candidates.push('analysis');
  if (isCreative  && primary !== 'creative')  candidates.push('creative');

  return { primary, secondary: candidates[0] };
}

// ─── Entity extractor ─────────────────────────────────────────────────────────

function extractEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  function addMatches(re: RegExp, type: EntityType): void {
    let m: RegExpExecArray | null;
    const pattern = new RegExp(re.source, re.flags);
    while ((m = pattern.exec(text)) !== null) {
      const value = (type === 'file_path' ? m[1] : m[0]) ?? m[0];
      if (!value) continue;
      const start = type === 'file_path'
        ? m.index + (m[0].length - value.length)
        : m.index;
      entities.push({ type, value, start, end: start + value.length });
    }
  }

  addMatches(URL_RE,        'url');
  addMatches(CODE_BLOCK_RE, 'code_block');
  addMatches(FILE_PATH_RE,  'file_path');
  addMatches(DATE_RE,       'date');
  addMatches(MENTION_RE,    'mention');
  addMatches(NUMBER_RE,     'number');

  // Deduplicate overlapping spans (keep the larger one)
  entities.sort((a, b) => a.start - b.start || b.end - a.end);
  const deduped: ExtractedEntity[] = [];
  let cursor = 0;
  for (const e of entities) {
    if (e.start >= cursor) {
      deduped.push(e);
      cursor = e.end;
    }
  }
  return deduped;
}

// ─── Follow-up detector ───────────────────────────────────────────────────────

const FOLLOWUP_SIGNALS = /^(?:and|also|additionally|but|however|what about|how about|can you also|what if|why|really|that|those|this|these|it|they|he|she)\b/i;

function detectFollowUp(text: string, previousHash?: string): boolean {
  if (!previousHash) return false;
  const trimmed = text.trim();
  return (
    trimmed.length < 120 ||
    FOLLOWUP_SIGNALS.test(trimmed) ||
    trimmed.startsWith('...')
  );
}

// ─── Main class ───────────────────────────────────────────────────────────────

export interface MessagePreprocessorOptions {
  /** Set of recently-seen content hashes for dedup detection (sliding window). */
  recentHashes?: Set<string>;
  /** Content hash of the immediately preceding user turn. */
  previousHash?: string;
}

export class MessagePreprocessor {
  private readonly textPreprocessor = new TextPreprocessor();

  /**
   * Process a raw user message and return a rich PreprocessedMessage.
   *
   * @param raw   - Raw text from the user (may contain markdown, code, etc.)
   * @param opts  - Optional dedup / follow-up context
   */
  async process(
    raw: string,
    opts: MessagePreprocessorOptions = {},
  ): Promise<PreprocessedMessage> {
    const start = Date.now();

    // ── 1. Delegate to TextPreprocessor (NFC, language, quality) ───────────
    const tpResult     = await this.textPreprocessor.process(raw);
    const normalized   = (tpResult.normalized ?? raw.normalize('NFC').trim()) as string;
    const language     = (tpResult.language   ?? 'unknown')                   as string;
    const qualityScore = typeof tpResult.qualityScore === 'number' ? tpResult.qualityScore : 0.8;

    // ── 2. Content hash ─────────────────────────────────────────────────────
    const contentHash = createHash('sha256').update(normalized).digest('hex');
    const isDuplicate = opts.recentHashes?.has(contentHash) ?? false;

    // ── 3. Intent ───────────────────────────────────────────────────────────
    const { primary, secondary } = classifyIntent(normalized);

    // ── 4. Entities ─────────────────────────────────────────────────────────
    const entities = extractEntities(normalized);
    const hasCode  = entities.some(e => e.type === 'code_block') || CODE_SIGNALS.test(normalized);
    const hasUrls  = entities.some(e => e.type === 'url');

    // ── 5. Follow-up detection ──────────────────────────────────────────────
    const followUp = detectFollowUp(normalized, opts.previousHash);

    // ── 6. Word count (rough) ───────────────────────────────────────────────
    const wordCount = normalized.trim().split(/\s+/).filter(Boolean).length;

    const processingMs = Date.now() - start;

    Logger.debug('[MessagePreprocessor] processed message', {
      intent: primary, language, wordCount, isDuplicate,
      entities: entities.length, processingMs,
    });

    const meta: MessageMeta = {
      contentHash,
      language,
      intent         : primary,
      secondaryIntent: secondary,
      entities,
      isFollowUp     : followUp,
      isDuplicate,
      wordCount,
      hasCode,
      hasUrls,
      qualityScore,
      processingMs,
    };

    return { original: raw, normalized, meta };
  }

  /**
   * Batch-process multiple messages (e.g. conversation history).
   * Each message is processed independently; follow-up detection uses
   * the preceding message's hash.
   */
  async processBatch(
    messages: string[],
    opts: Pick<MessagePreprocessorOptions, 'recentHashes'> = {},
  ): Promise<PreprocessedMessage[]> {
    const results: PreprocessedMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
      const previousHash = results[i - 1]?.meta.contentHash;
      const result = await this.process(messages[i]!, { ...opts, previousHash });
      results.push(result);
    }
    return results;
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const messagePreprocessor = new MessagePreprocessor();
