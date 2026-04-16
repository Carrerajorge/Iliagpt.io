/**
 * ThinkingModes
 *
 * Defines HOW the AI processes a request by composing a complete
 * inference configuration: model, temperature, token budget, system
 * prompt addendum, and post-processing hooks.
 *
 * Available modes
 * ───────────────
 *   QuickAnswer      Fast, concise.  No reasoning chain.
 *   DeepThinking     Extended reasoning with self-critique.
 *   Creative         High temperature, divergent exploration.
 *   Precise          Low temperature, factual, citation-heavy.
 *   CodeMode         Optimised for code; low temp; fenced blocks.
 *   ResearchMode     Multi-source, academic rigour, citations.
 *   DebateMode       Multiple perspectives, pros/cons.
 *
 * Auto-detection uses keyword + intent signals from MessagePreprocessor.
 * Users can override with slash commands: /quick, /deep, /creative, etc.
 */

import { z }      from 'zod';
import { Logger } from '../lib/logger';
import type { Intent } from '../pipeline/MessagePreprocessor';

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const ThinkingModeNameSchema = z.enum([
  'QuickAnswer',
  'DeepThinking',
  'Creative',
  'Precise',
  'CodeMode',
  'ResearchMode',
  'DebateMode',
]);
export type ThinkingModeName = z.infer<typeof ThinkingModeNameSchema>;

export const ThinkingModeSchema = z.object({
  name              : ThinkingModeNameSchema,
  displayName       : z.string(),
  temperature       : z.number().min(0).max(2),
  maxTokens         : z.number().int().positive(),
  /** Preferred model tag hint for provider routing. */
  modelHint         : z.string(),
  /** Extra lines appended to the system prompt for this mode. */
  systemAddendum    : z.string(),
  /** Enable chain-of-thought reasoning step. */
  enableReasoning   : z.boolean(),
  /** Enable post-generation self-reflection. */
  enableReflection  : z.boolean(),
  /** Enable uncertainty estimation. */
  enableUncertainty : z.boolean(),
  /** Enable fact-checking post-pass. */
  enableFactCheck   : z.boolean(),
  /** Slash command that activates this mode (e.g. '/quick'). */
  slashCommand      : z.string(),
  /** Short description shown in the UI. */
  description       : z.string(),
});
export type ThinkingMode = z.infer<typeof ThinkingModeSchema>;

// ─── Mode definitions ─────────────────────────────────────────────────────────

const MODES: Record<ThinkingModeName, ThinkingMode> = {
  QuickAnswer: {
    name             : 'QuickAnswer',
    displayName      : 'Quick Answer',
    temperature      : 0.3,
    maxTokens        : 500,
    modelHint        : 'fast',
    systemAddendum   : 'Be concise and direct.  Aim for 1–3 sentences unless more is essential.',
    enableReasoning  : false,
    enableReflection : false,
    enableUncertainty: false,
    enableFactCheck  : false,
    slashCommand     : '/quick',
    description      : 'Fast, brief answers.  Best for simple lookups.',
  },

  DeepThinking: {
    name             : 'DeepThinking',
    displayName      : 'Deep Thinking',
    temperature      : 0.7,
    maxTokens        : 3000,
    modelHint        : 'reasoning',
    systemAddendum   : 'Think carefully step by step.  Show your reasoning.  Challenge your own assumptions before concluding.',
    enableReasoning  : true,
    enableReflection : true,
    enableUncertainty: true,
    enableFactCheck  : false,
    slashCommand     : '/deep',
    description      : 'Extended reasoning with self-critique.  Best for complex problems.',
  },

  Creative: {
    name             : 'Creative',
    displayName      : 'Creative',
    temperature      : 0.9,
    maxTokens        : 2000,
    modelHint        : 'balanced',
    systemAddendum   : 'Be imaginative, original, and expressive.  Explore unconventional ideas.  Vary your structure and vocabulary.',
    enableReasoning  : false,
    enableReflection : false,
    enableUncertainty: false,
    enableFactCheck  : false,
    slashCommand     : '/creative',
    description      : 'High-temperature creative generation.  Best for stories, ideas, brainstorming.',
  },

  Precise: {
    name             : 'Precise',
    displayName      : 'Precise',
    temperature      : 0.1,
    maxTokens        : 1500,
    modelHint        : 'balanced',
    systemAddendum   : 'Provide only verified, precise information.  Include citations where available.  State confidence levels for uncertain claims.',
    enableReasoning  : false,
    enableReflection : false,
    enableUncertainty: true,
    enableFactCheck  : true,
    slashCommand     : '/precise',
    description      : 'Low-temperature factual responses with citations.',
  },

  CodeMode: {
    name             : 'CodeMode',
    displayName      : 'Code Mode',
    temperature      : 0.2,
    maxTokens        : 2500,
    modelHint        : 'code',
    systemAddendum   : 'Produce production-quality code.  Use fenced code blocks with language tags.  Include type annotations.  Add inline comments only for non-obvious logic.',
    enableReasoning  : false,
    enableReflection : false,
    enableUncertainty: false,
    enableFactCheck  : false,
    slashCommand     : '/code',
    description      : 'Optimised for code generation and debugging.',
  },

  ResearchMode: {
    name             : 'ResearchMode',
    displayName      : 'Research Mode',
    temperature      : 0.3,
    maxTokens        : 3000,
    modelHint        : 'reasoning',
    systemAddendum   : 'Approach this as a researcher.  Cite sources.  Acknowledge limitations and contradictory evidence.  Structure your response with headings.',
    enableReasoning  : true,
    enableReflection : true,
    enableUncertainty: true,
    enableFactCheck  : true,
    slashCommand     : '/research',
    description      : 'Multi-source academic rigour with full citations.',
  },

  DebateMode: {
    name             : 'DebateMode',
    displayName      : 'Debate Mode',
    temperature      : 0.6,
    maxTokens        : 2000,
    modelHint        : 'balanced',
    systemAddendum   : 'Present multiple perspectives on this topic: proponents, critics, and nuanced middle-ground views.  Use "For:", "Against:", and "Nuance:" headings.',
    enableReasoning  : false,
    enableReflection : false,
    enableUncertainty: false,
    enableFactCheck  : false,
    slashCommand     : '/debate',
    description      : 'Multiple perspectives, pros/cons, balanced analysis.',
  },
};

// ─── Auto-detection ───────────────────────────────────────────────────────────

const QUICK_WORDS     = /^(?:what is|who is|when is|where is|define|spell|translate|convert|how many|what does)\b/i;
const DEEP_WORDS      = /\b(?:explain why|analyze|reason(?:ing)?|think through|step.by.step|cause|mechanism|philosophy|implication|consequence|trade.off)\b/i;
const CREATIVE_WORDS  = /\b(?:story|poem|song|imagine|creative|write a|brainstorm|idea|novel|script|metaphor)\b/i;
const PRECISE_WORDS   = /\b(?:exactly|precisely|accurate|definitive|fact|statistic|percentage|number|date|citation|source|evidence|proof)\b/i;
const CODE_WORDS      = /\b(?:code|function|class|implement|debug|refactor|typescript|javascript|python|api|sql|bug|error)\b|```/i;
const RESEARCH_WORDS  = /\b(?:research|study|academic|literature|review|journal|paper|findings|methodology|hypothesis)\b/i;
const DEBATE_WORDS    = /\b(?:pros and cons|advantages|disadvantages|for and against|perspectives|sides|debate|controversy|arguments)\b/i;

const SLASH_COMMANDS: Record<string, ThinkingModeName> = {
  '/quick'   : 'QuickAnswer',
  '/deep'    : 'DeepThinking',
  '/creative': 'Creative',
  '/precise' : 'Precise',
  '/code'    : 'CodeMode',
  '/research': 'ResearchMode',
  '/debate'  : 'DebateMode',
};

function detectFromSlashCommand(text: string): ThinkingModeName | null {
  for (const [cmd, mode] of Object.entries(SLASH_COMMANDS)) {
    if (text.startsWith(cmd) || text.includes(` ${cmd} `) || text.includes(`\n${cmd}`)) {
      return mode;
    }
  }
  return null;
}

function detectFromContent(text: string, intent?: Intent): ThinkingModeName {
  if (CODE_WORDS.test(text) || intent === 'code')       return 'CodeMode';
  if (CREATIVE_WORDS.test(text) || intent === 'creative') return 'Creative';
  if (RESEARCH_WORDS.test(text))                         return 'ResearchMode';
  if (DEBATE_WORDS.test(text))                           return 'DebateMode';
  if (PRECISE_WORDS.test(text))                          return 'Precise';
  if (DEEP_WORDS.test(text) || intent === 'analysis')    return 'DeepThinking';
  if (QUICK_WORDS.test(text))                            return 'QuickAnswer';
  return 'QuickAnswer'; // default
}

// ─── Main class ───────────────────────────────────────────────────────────────

export class ThinkingModeSelector {
  /**
   * Detect the most appropriate thinking mode for a message.
   *
   * @param text    - The user's message text
   * @param intent  - Intent from MessagePreprocessor (optional)
   * @param override - Explicit mode name (overrides detection)
   */
  select(
    text    : string,
    intent? : Intent,
    override?: ThinkingModeName,
  ): ThinkingMode {
    if (override) {
      const mode = MODES[override];
      Logger.debug('[ThinkingModes] mode set via override', { mode: override });
      return mode;
    }

    // Check for slash command
    const fromSlash = detectFromSlashCommand(text);
    if (fromSlash) {
      Logger.debug('[ThinkingModes] mode detected from slash command', { mode: fromSlash });
      return MODES[fromSlash];
    }

    const detected = detectFromContent(text, intent);
    Logger.debug('[ThinkingModes] mode auto-detected', { mode: detected });
    return MODES[detected];
  }

  /** Strip slash commands from the message text before passing to LLM. */
  stripSlashCommand(text: string): string {
    return text.replace(/^\/\w+\s*/, '').trim();
  }

  /** Return all available modes. */
  allModes(): ThinkingMode[] {
    return Object.values(MODES);
  }

  /** Look up a mode by name. */
  get(name: ThinkingModeName): ThinkingMode {
    return MODES[name];
  }

  /** Check if text contains a known slash command. */
  hasSlashCommand(text: string): boolean {
    return detectFromSlashCommand(text) !== null;
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const thinkingModeSelector = new ThinkingModeSelector();
