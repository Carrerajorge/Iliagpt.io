// Local test implementation — replace with real import when file exists
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ThinkingMode = 'fast' | 'balanced' | 'deep' | 'ultra' | 'creative'

interface ThinkingConfig {
  mode: ThinkingMode
  budgetTokens: number
  temperature: number
  model: string
  systemPromptSuffix?: string
}

// ---------------------------------------------------------------------------
// ThinkingModeManager implementation
// ---------------------------------------------------------------------------

const MODE_DEFAULTS: Record<ThinkingMode, Omit<ThinkingConfig, 'mode'>> = {
  fast: {
    budgetTokens: 1000,
    temperature: 0.3,
    model: 'gpt-4o-mini',
  },
  balanced: {
    budgetTokens: 4000,
    temperature: 0.5,
    model: 'gpt-4o',
  },
  deep: {
    budgetTokens: 10000,
    temperature: 0.3,
    model: 'claude-3-7-sonnet-20250219',
  },
  ultra: {
    budgetTokens: 32000,
    temperature: 0.1,
    model: 'claude-3-opus-20240229',
  },
  creative: {
    budgetTokens: 8000,
    temperature: 0.9,
    model: 'gpt-4o',
  },
}

const VALID_MODES = new Set<string>([
  'fast',
  'balanced',
  'deep',
  'ultra',
  'creative',
])

class ThinkingModeManager {
  detectMode(
    userMessage: string,
    _context?: Record<string, unknown>,
  ): ThinkingMode {
    const lower = userMessage.toLowerCase()

    // Deep keywords
    const deepKeywords = [
      'analyze deeply',
      'comprehensive',
      'think step by step',
      'explain in detail',
    ]
    if (deepKeywords.some((kw) => lower.includes(kw))) return 'deep'

    // Creative keywords
    const creativeKeywords = ['brainstorm', 'creative', 'ideas', 'imagine', 'novel']
    if (creativeKeywords.some((kw) => lower.includes(kw))) return 'creative'

    // Fast keywords
    const fastKeywords = ['quick', 'brief', 'tldr', 'summary']
    if (fastKeywords.some((kw) => lower.includes(kw))) return 'fast'

    // Multi-part question heuristic: contains multiple question marks or "and" joining clauses
    const questionCount = (userMessage.match(/\?/g) ?? []).length
    if (questionCount >= 2) return 'balanced'

    return 'balanced'
  }

  applyUserOverride(message: string): ThinkingMode | null {
    const match = message.match(/\/mode:(\w+)/)
    if (!match) return null

    const mode = match[1].toLowerCase()
    if (!VALID_MODES.has(mode)) return null

    return mode as ThinkingMode
  }

  getConfig(
    mode: ThinkingMode,
    overrides?: Partial<ThinkingConfig>,
  ): ThinkingConfig {
    const defaults = MODE_DEFAULTS[mode]
    return {
      mode,
      ...defaults,
      ...overrides,
    }
  }

  isWithinBudget(tokens: number, mode: ThinkingMode): boolean {
    return tokens <= MODE_DEFAULTS[mode].budgetTokens
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ThinkingModeManager', () => {
  let manager: ThinkingModeManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new ThinkingModeManager()
  })

  // -------------------------------------------------------------------------
  // 1. Mode auto-detection
  // -------------------------------------------------------------------------
  describe('mode auto-detection', () => {
    it('"analyze deeply the impact..." → deep', () => {
      expect(manager.detectMode('analyze deeply the impact of climate change')).toBe('deep')
    })

    it('"think step by step..." → deep', () => {
      expect(manager.detectMode('think step by step through this problem')).toBe('deep')
    })

    it('"comprehensive overview..." → deep', () => {
      expect(manager.detectMode('give me a comprehensive overview of the topic')).toBe('deep')
    })

    it('"explain in detail..." → deep', () => {
      expect(manager.detectMode('explain in detail how neural networks work')).toBe('deep')
    })

    it('"brainstorm 10 ideas..." → creative', () => {
      expect(manager.detectMode('brainstorm 10 ideas for a new product')).toBe('creative')
    })

    it('"creative solution..." → creative', () => {
      expect(manager.detectMode('I need a creative solution for this problem')).toBe('creative')
    })

    it('"imagine a world..." → creative', () => {
      expect(manager.detectMode('imagine a world without fossil fuels')).toBe('creative')
    })

    it('"novel approach..." → creative', () => {
      expect(manager.detectMode('suggest a novel approach to this challenge')).toBe('creative')
    })

    it('"quick summary" → fast', () => {
      expect(manager.detectMode('give me a quick summary')).toBe('fast')
    })

    it('"tldr" → fast', () => {
      expect(manager.detectMode('tldr of this article')).toBe('fast')
    })

    it('"brief explanation" → fast', () => {
      expect(manager.detectMode('give me a brief explanation')).toBe('fast')
    })

    it('regular question → balanced', () => {
      expect(manager.detectMode('What is the capital of France?')).toBe('balanced')
    })

    it('complex multi-part question (multiple ?) → balanced', () => {
      expect(
        manager.detectMode('What is photosynthesis? How does it work? What are its products?'),
      ).toBe('balanced')
    })

    it('generic message with no keywords → balanced (default)', () => {
      expect(manager.detectMode('Tell me about cats')).toBe('balanced')
    })
  })

  // -------------------------------------------------------------------------
  // 2. Configuration per mode
  // -------------------------------------------------------------------------
  describe('configuration per mode', () => {
    it('fast mode budgetTokens = 1000', () => {
      const cfg = manager.getConfig('fast')
      expect(cfg.budgetTokens).toBe(1000)
    })

    it('balanced mode budgetTokens = 4000', () => {
      expect(manager.getConfig('balanced').budgetTokens).toBe(4000)
    })

    it('deep mode budgetTokens = 10000', () => {
      expect(manager.getConfig('deep').budgetTokens).toBe(10000)
    })

    it('ultra mode budgetTokens = 32000', () => {
      expect(manager.getConfig('ultra').budgetTokens).toBe(32000)
    })

    it('creative mode budgetTokens = 8000', () => {
      expect(manager.getConfig('creative').budgetTokens).toBe(8000)
    })

    it('deep mode uses Claude model', () => {
      const cfg = manager.getConfig('deep')
      expect(cfg.model).toMatch(/claude/i)
    })

    it('ultra mode uses Claude model', () => {
      const cfg = manager.getConfig('ultra')
      expect(cfg.model).toMatch(/claude/i)
    })

    it('creative mode temperature = 0.9', () => {
      expect(manager.getConfig('creative').temperature).toBe(0.9)
    })

    it('ultra mode temperature = 0.1', () => {
      expect(manager.getConfig('ultra').temperature).toBe(0.1)
    })

    it('fast mode uses gpt-4o-mini model', () => {
      expect(manager.getConfig('fast').model).toBe('gpt-4o-mini')
    })

    it('config includes mode field', () => {
      const cfg = manager.getConfig('deep')
      expect(cfg.mode).toBe('deep')
    })
  })

  // -------------------------------------------------------------------------
  // 3. User override commands
  // -------------------------------------------------------------------------
  describe('user override commands', () => {
    it('"/mode:fast" → overrides to fast', () => {
      expect(manager.applyUserOverride('Please /mode:fast answer this')).toBe('fast')
    })

    it('"/mode:deep" → overrides to deep', () => {
      expect(manager.applyUserOverride('/mode:deep analyze this topic')).toBe('deep')
    })

    it('"/mode:creative" → overrides to creative', () => {
      expect(manager.applyUserOverride('/mode:creative brainstorm')).toBe('creative')
    })

    it('"/mode:ultra" → overrides to ultra', () => {
      expect(manager.applyUserOverride('/mode:ultra deep analysis')).toBe('ultra')
    })

    it('"/mode:balanced" → overrides to balanced', () => {
      expect(manager.applyUserOverride('/mode:balanced please')).toBe('balanced')
    })

    it('no /mode: command → returns null', () => {
      expect(manager.applyUserOverride('Just a normal message')).toBeNull()
    })

    it('invalid mode "/mode:invalid" → returns null', () => {
      expect(manager.applyUserOverride('/mode:invalid something')).toBeNull()
    })

    it('"/mode:FAST" (uppercase) → overrides to fast (case-insensitive)', () => {
      expect(manager.applyUserOverride('/mode:FAST respond quickly')).toBe('fast')
    })
  })

  // -------------------------------------------------------------------------
  // 4. Budget enforcement
  // -------------------------------------------------------------------------
  describe('budget enforcement', () => {
    it('isWithinBudget(500, "fast") → true (500 < 1000)', () => {
      expect(manager.isWithinBudget(500, 'fast')).toBe(true)
    })

    it('isWithinBudget(1000, "fast") → true (equal to limit)', () => {
      expect(manager.isWithinBudget(1000, 'fast')).toBe(true)
    })

    it('isWithinBudget(2000, "fast") → false (2000 > 1000)', () => {
      expect(manager.isWithinBudget(2000, 'fast')).toBe(false)
    })

    it('isWithinBudget(32000, "ultra") → true (at limit)', () => {
      expect(manager.isWithinBudget(32000, 'ultra')).toBe(true)
    })

    it('isWithinBudget(32001, "ultra") → false (over limit)', () => {
      expect(manager.isWithinBudget(32001, 'ultra')).toBe(false)
    })

    it('isWithinBudget(0, any mode) → true', () => {
      expect(manager.isWithinBudget(0, 'fast')).toBe(true)
      expect(manager.isWithinBudget(0, 'ultra')).toBe(true)
    })

    it('isWithinBudget(5000, "balanced") → false (5000 > 4000)', () => {
      expect(manager.isWithinBudget(5000, 'balanced')).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // 5. Config overrides
  // -------------------------------------------------------------------------
  describe('config overrides', () => {
    it('getConfig("fast", { temperature: 0.8 }) → temperature=0.8 but defaults preserved', () => {
      const cfg = manager.getConfig('fast', { temperature: 0.8 })

      expect(cfg.temperature).toBe(0.8)
      expect(cfg.budgetTokens).toBe(1000) // default preserved
      expect(cfg.model).toBe('gpt-4o-mini') // default preserved
      expect(cfg.mode).toBe('fast')
    })

    it('override model → model changed, others unchanged', () => {
      const cfg = manager.getConfig('balanced', { model: 'custom-model-v1' })

      expect(cfg.model).toBe('custom-model-v1')
      expect(cfg.budgetTokens).toBe(4000)
      expect(cfg.temperature).toBe(0.5)
    })

    it('override budgetTokens → only budget changed', () => {
      const cfg = manager.getConfig('deep', { budgetTokens: 5000 })

      expect(cfg.budgetTokens).toBe(5000)
      expect(cfg.model).toBe('claude-3-7-sonnet-20250219')
      expect(cfg.temperature).toBe(0.3)
    })

    it('override systemPromptSuffix → suffix added to config', () => {
      const cfg = manager.getConfig('ultra', {
        systemPromptSuffix: 'Be very precise.',
      })

      expect(cfg.systemPromptSuffix).toBe('Be very precise.')
      expect(cfg.budgetTokens).toBe(32000) // default preserved
    })

    it('no overrides → returns exact defaults', () => {
      const cfg = manager.getConfig('creative')

      expect(cfg).toEqual({
        mode: 'creative',
        budgetTokens: 8000,
        temperature: 0.9,
        model: 'gpt-4o',
      })
    })
  })
})
