/**
 * ContextualActions
 *
 * Generates context-sensitive action buttons/shortcuts to show in the UI
 * after each assistant response.
 *
 * Action categories:
 *   - Code    → "Run", "Test", "Explain", "Refactor", "Copy"
 *   - Analysis → "Dig Deeper", "Compare with...", "Export as PDF", "Summarise"
 *   - Search   → "Read Full Article", "Find Related", "Save to Memory"
 *   - Error    → "Fix It", "Explain Error", "Try Alternative"
 *   - Creative → "Make it longer", "Change tone", "Write a sequel"
 *   - General  → "Translate", "Simplify", "Follow up"
 *
 * Each action carries:
 *   - id, label, icon (emoji), category, priority
 *   - promptTemplate: the message to send when user clicks the action
 *   - enabled: whether the action makes sense right now
 */

import { z }      from 'zod';
import { Logger } from '../lib/logger';
import type { Intent } from '../pipeline/MessagePreprocessor';

// ─── Types ────────────────────────────────────────────────────────────────────

export const ActionCategorySchema = z.enum([
  'code', 'analysis', 'search', 'error', 'creative', 'general', 'memory',
]);
export type ActionCategory = z.infer<typeof ActionCategorySchema>;

export const ContextualActionSchema = z.object({
  id              : z.string(),
  label           : z.string(),
  icon            : z.string(),
  category        : ActionCategorySchema,
  priority        : z.number().int().min(1).max(10),
  promptTemplate  : z.string(),
  enabled         : z.boolean(),
  requiresContext : z.boolean(),
  tooltip         : z.string().optional(),
});
export type ContextualAction = z.infer<typeof ContextualActionSchema>;

export interface ConversationState {
  intent?          : Intent;
  hasCode?         : boolean;
  hasError?        : boolean;
  hasUrls?         : boolean;
  isCreative?      : boolean;
  isAnalysis?      : boolean;
  lastResponseLen? : number;
  language?        : string;
  userQuestion?    : string;
}

// ─── Action templates ─────────────────────────────────────────────────────────

type ActionTemplate = Omit<ContextualAction, 'enabled'>;

const CODE_ACTIONS: ActionTemplate[] = [
  {
    id             : 'run_code',
    label          : 'Run',
    icon           : '▶',
    category       : 'code',
    priority       : 1,
    promptTemplate : 'Run the code from your last response and show the output.',
    requiresContext: true,
    tooltip        : 'Execute the code and show output',
  },
  {
    id             : 'add_tests',
    label          : 'Add Tests',
    icon           : '✓',
    category       : 'code',
    priority       : 2,
    promptTemplate : 'Write unit tests for the code in your last response.',
    requiresContext: true,
    tooltip        : 'Generate unit tests',
  },
  {
    id             : 'explain_code',
    label          : 'Explain',
    icon           : '📖',
    category       : 'code',
    priority       : 3,
    promptTemplate : 'Explain line by line how the code in your last response works.',
    requiresContext: true,
    tooltip        : 'Get a line-by-line explanation',
  },
  {
    id             : 'refactor',
    label          : 'Refactor',
    icon           : '♻',
    category       : 'code',
    priority       : 4,
    promptTemplate : 'Refactor the code in your last response for better readability and performance.',
    requiresContext: true,
    tooltip        : 'Clean up and optimise the code',
  },
  {
    id             : 'add_types',
    label          : 'Add Types',
    icon           : 'T',
    category       : 'code',
    priority       : 5,
    promptTemplate : 'Add TypeScript type annotations to the code in your last response.',
    requiresContext: true,
    tooltip        : 'Add TypeScript types',
  },
];

const ANALYSIS_ACTIONS: ActionTemplate[] = [
  {
    id             : 'dig_deeper',
    label          : 'Dig Deeper',
    icon           : '🔍',
    category       : 'analysis',
    priority       : 1,
    promptTemplate : 'Go into more depth on the most important point from your last response.',
    requiresContext: true,
    tooltip        : 'Explore the most important aspect further',
  },
  {
    id             : 'compare',
    label          : 'Compare Alternatives',
    icon           : '⇄',
    category       : 'analysis',
    priority       : 2,
    promptTemplate : 'Compare the approach in your last response with 2–3 alternative approaches.',
    requiresContext: true,
    tooltip        : 'See alternative approaches',
  },
  {
    id             : 'summarise',
    label          : 'Summarise',
    icon           : '≡',
    category       : 'analysis',
    priority       : 3,
    promptTemplate : 'Give me a 3-bullet summary of your last response.',
    requiresContext: true,
    tooltip        : 'Get a brief summary',
  },
  {
    id             : 'pros_cons',
    label          : 'Pros & Cons',
    icon           : '±',
    category       : 'analysis',
    priority       : 4,
    promptTemplate : 'List the pros and cons of what was discussed in your last response.',
    requiresContext: true,
    tooltip        : 'See advantages and disadvantages',
  },
];

const ERROR_ACTIONS: ActionTemplate[] = [
  {
    id             : 'fix_error',
    label          : 'Fix It',
    icon           : '🔧',
    category       : 'error',
    priority       : 1,
    promptTemplate : 'Fix the error described in my last message and explain what was wrong.',
    requiresContext: true,
    tooltip        : 'Automatically fix the error',
  },
  {
    id             : 'explain_error',
    label          : 'Explain Error',
    icon           : '?',
    category       : 'error',
    priority       : 2,
    promptTemplate : 'Explain in plain English what this error means and its most common causes.',
    requiresContext: true,
    tooltip        : 'Understand the error',
  },
  {
    id             : 'try_alternative',
    label          : 'Try Alternative',
    icon           : '↺',
    category       : 'error',
    priority       : 3,
    promptTemplate : 'Suggest a completely different approach that avoids this error entirely.',
    requiresContext: true,
    tooltip        : 'Find a different solution',
  },
];

const CREATIVE_ACTIONS: ActionTemplate[] = [
  {
    id             : 'make_longer',
    label          : 'Expand',
    icon           : '↕',
    category       : 'creative',
    priority       : 1,
    promptTemplate : 'Expand your last response with more detail and depth.',
    requiresContext: true,
    tooltip        : 'Make it longer and more detailed',
  },
  {
    id             : 'change_tone',
    label          : 'Change Tone',
    icon           : '🎨',
    category       : 'creative',
    priority       : 2,
    promptTemplate : 'Rewrite your last response in a different tone (more formal, casual, humorous, or poetic).',
    requiresContext: true,
    tooltip        : 'Adjust the writing style',
  },
  {
    id             : 'write_sequel',
    label          : 'Continue',
    icon           : '→',
    category       : 'creative',
    priority       : 3,
    promptTemplate : 'Continue from where your last response left off.',
    requiresContext: true,
    tooltip        : 'Write what comes next',
  },
];

const GENERAL_ACTIONS: ActionTemplate[] = [
  {
    id             : 'translate',
    label          : 'Translate',
    icon           : '🌐',
    category       : 'general',
    priority       : 1,
    promptTemplate : 'Translate your last response to {language}.',
    requiresContext: false,
    tooltip        : 'Translate to another language',
  },
  {
    id             : 'simplify',
    label          : 'Simplify',
    icon           : '◎',
    category       : 'general',
    priority       : 2,
    promptTemplate : 'Rewrite your last response in simpler language, as if explaining to a beginner.',
    requiresContext: true,
    tooltip        : 'Make it easier to understand',
  },
  {
    id             : 'save_to_memory',
    label          : 'Save to Memory',
    icon           : '💾',
    category       : 'memory',
    priority       : 3,
    promptTemplate : 'Save the key information from your last response to memory for future reference.',
    requiresContext: true,
    tooltip        : 'Remember this for later',
  },
  {
    id             : 'follow_up',
    label          : 'Follow Up',
    icon           : '+',
    category       : 'general',
    priority       : 5,
    promptTemplate : 'What should I ask next to learn more about this topic?',
    requiresContext: false,
    tooltip        : 'Get suggested follow-up questions',
  },
];

const ALL_TEMPLATES: ActionTemplate[] = [
  ...CODE_ACTIONS,
  ...ANALYSIS_ACTIONS,
  ...ERROR_ACTIONS,
  ...CREATIVE_ACTIONS,
  ...GENERAL_ACTIONS,
];

// ─── Selector logic ───────────────────────────────────────────────────────────

function shouldEnable(template: ActionTemplate, state: ConversationState): boolean {
  switch (template.category) {
    case 'code'    : return !!(state.hasCode || state.intent === 'code');
    case 'error'   : return !!(state.hasError);
    case 'analysis': return !!(state.isAnalysis || state.intent === 'analysis' || state.intent === 'question');
    case 'creative': return !!(state.isCreative || state.intent === 'creative');
    case 'memory'  : return true;
    case 'general' : return true;
    case 'search'  : return !!(state.hasUrls);
    default        : return true;
  }
}

function buildActions(state: ConversationState, maxActions = 6): ContextualAction[] {
  return ALL_TEMPLATES
    .map(t => ({
      ...t,
      enabled: shouldEnable(t, state),
    }))
    .filter(a => a.enabled)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, maxActions);
}

// ─── Main class ───────────────────────────────────────────────────────────────

export interface ContextualActionsOptions {
  maxActions?     : number;
  includeDisabled?: boolean;
  language?       : string;
}

export class ContextualActionsEngine {
  /**
   * Generate contextual actions for the current conversation state.
   */
  generate(
    state: ConversationState,
    opts : ContextualActionsOptions = {},
  ): ContextualAction[] {
    const maxActions = opts.maxActions ?? 6;
    const actions    = buildActions(state, maxActions);

    // Personalise translate action with detected language
    if (opts.language && opts.language !== 'en') {
      const translate = actions.find(a => a.id === 'translate');
      if (translate) {
        translate.promptTemplate = `Translate your last response to English.`;
        translate.label = 'Translate to English';
      }
    }

    Logger.debug('[ContextualActions] generated actions', {
      intent : state.intent,
      count  : actions.length,
      actions: actions.map(a => a.id),
    });

    return actions;
  }

  /**
   * Look up a specific action by ID and fill in its prompt template.
   */
  buildPrompt(actionId: string, context: Record<string, string> = {}): string | null {
    const template = ALL_TEMPLATES.find(t => t.id === actionId);
    if (!template) return null;
    let prompt = template.promptTemplate;
    for (const [key, value] of Object.entries(context)) {
      prompt = prompt.replace(`{${key}}`, value);
    }
    return prompt;
  }

  /** Return all available action templates. */
  allTemplates(): ActionTemplate[] {
    return ALL_TEMPLATES;
  }
}

export const contextualActions = new ContextualActionsEngine();
