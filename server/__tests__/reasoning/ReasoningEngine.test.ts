import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Local test implementation — replace with real import when file exists
// ─────────────────────────────────────────────────────────────────────────────

type ReasoningMode = 'fast' | 'deep' | 'creative' | 'analytical'

interface ReasoningTrace {
  steps: string[]
  finalAnswer: string
  confidence: number
  mode: ReasoningMode
  durationMs: number
  refinements: number
  error?: string
}

interface MockLLM {
  complete(prompt: string): Promise<string>
}

class ReasoningEngine {
  private llm: MockLLM

  constructor(llm: MockLLM) {
    this.llm = llm
  }

  async generateCoT(question: string, mode: ReasoningMode): Promise<ReasoningTrace> {
    const start = Date.now()

    const modePrompts: Record<ReasoningMode, string> = {
      fast: `Answer concisely: ${question}`,
      deep: `Think step by step with extended reasoning. Question: ${question}`,
      creative: `Use divergent thinking and creative exploration. Question: ${question}`,
      analytical: `Use structured decomposition and systematic analysis. Question: ${question}`,
    }

    const prompt = modePrompts[mode]

    try {
      const response = await this.llm.complete(prompt)
      const steps = this._parseSteps(response, mode)
      const finalAnswer = this._extractFinalAnswer(response, steps)
      const confidence = this._computeConfidence(steps, mode)

      return {
        steps,
        finalAnswer,
        confidence,
        mode,
        durationMs: Date.now() - start,
        refinements: 0,
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return {
        steps: [],
        finalAnswer: '',
        confidence: 0,
        mode,
        durationMs: Date.now() - start,
        refinements: 0,
        error: errMsg,
      }
    }
  }

  async critiqueAndRefine(
    trace: ReasoningTrace,
    maxRefinements = 3,
  ): Promise<ReasoningTrace> {
    if (trace.confidence >= 0.7 || trace.refinements >= maxRefinements) {
      return trace
    }

    const deeperMode: ReasoningMode =
      trace.mode === 'fast' ? 'deep' : trace.mode === 'deep' ? 'analytical' : trace.mode

    const refined = await this.generateCoT(
      trace.steps.join(' ') || trace.finalAnswer || 'refine',
      deeperMode,
    )

    const newTrace: ReasoningTrace = {
      ...refined,
      mode: trace.mode,
      refinements: trace.refinements + 1,
    }

    // Recurse if still low confidence and under the max
    if (newTrace.confidence < 0.7 && newTrace.refinements < maxRefinements) {
      return this.critiqueAndRefine(newTrace, maxRefinements)
    }

    return newTrace
  }

  private _parseSteps(response: string, mode: ReasoningMode): string[] {
    const lines = response.split('\n').filter((l) => l.trim().length > 0)

    if (mode === 'fast') {
      return lines.length > 0 ? [lines[0]] : ['Step 1: Direct answer computed']
    }

    if (mode === 'analytical') {
      return lines.map((line, i) => `[${i + 1}] ${line}`)
    }

    const steps = lines.map((line) => line.replace(/^(\d+[\.\)]?\s*)/, '').trim())
    return steps.filter(Boolean).length > 0 ? steps : ['Step 1: Reasoning complete']
  }

  private _extractFinalAnswer(response: string, steps: string[]): string {
    const lines = response.split('\n').filter((l) => l.trim().length > 0)
    return lines[lines.length - 1]?.trim() ?? steps[steps.length - 1] ?? response.trim()
  }

  private _computeConfidence(steps: string[], mode: ReasoningMode): number {
    const baseByMode: Record<ReasoningMode, number> = {
      fast: 0.65,
      deep: 0.80,
      creative: 0.70,
      analytical: 0.85,
    }
    const base = baseByMode[mode]
    // More steps = slightly higher confidence, capped at 0.99
    const stepBoost = Math.min(steps.length * 0.02, 0.1)
    return Math.min(base + stepBoost, 0.99)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeMockLLM(responses: string[] = ['Step 1: analyze\nStep 2: conclude\nFinal answer']): MockLLM {
  const completeFn = vi.fn()
  responses.forEach((resp) => completeFn.mockResolvedValueOnce(resp))
  // Default for any extra calls
  completeFn.mockResolvedValue('Step 1: fallback\nFinal answer')
  return { complete: completeFn }
}

function makeLowConfidenceLLM(): MockLLM {
  // Returns single-step response so confidence stays low
  return {
    complete: vi.fn().mockResolvedValue('x'),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ReasoningEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── 1. generateCoT ────────────────────────────────────────────────────────

  describe('generateCoT', () => {
    it('fast mode returns a trace immediately using the fast prompt', async () => {
      const llm = makeMockLLM()
      const engine = new ReasoningEngine(llm)
      const trace = await engine.generateCoT('What is 2+2?', 'fast')
      expect(trace.finalAnswer).toBeTruthy()
      expect(llm.complete).toHaveBeenCalledTimes(1)
      const calledWith: string = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(calledWith).toContain('What is 2+2?')
    })

    it('deep mode calls LLM with extended reasoning prompt', async () => {
      const llm = makeMockLLM()
      const engine = new ReasoningEngine(llm)
      await engine.generateCoT('Explain quantum entanglement', 'deep')
      const calledWith: string = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(calledWith.toLowerCase()).toContain('step by step')
    })

    it('trace has a non-empty steps array', async () => {
      const engine = new ReasoningEngine(makeMockLLM())
      const trace = await engine.generateCoT('What is gravity?', 'deep')
      expect(trace.steps).toBeInstanceOf(Array)
      expect(trace.steps.length).toBeGreaterThan(0)
    })

    it('trace has a non-empty finalAnswer string', async () => {
      const engine = new ReasoningEngine(makeMockLLM())
      const trace = await engine.generateCoT('What is gravity?', 'deep')
      expect(typeof trace.finalAnswer).toBe('string')
      expect(trace.finalAnswer.length).toBeGreaterThan(0)
    })

    it('confidence is between 0 and 1', async () => {
      const engine = new ReasoningEngine(makeMockLLM())
      const trace = await engine.generateCoT('Some question?', 'analytical')
      expect(trace.confidence).toBeGreaterThanOrEqual(0)
      expect(trace.confidence).toBeLessThanOrEqual(1)
    })

    it('durationMs is a positive number', async () => {
      const engine = new ReasoningEngine(makeMockLLM())
      const trace = await engine.generateCoT('How does DNS work?', 'fast')
      expect(typeof trace.durationMs).toBe('number')
      expect(trace.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('creative mode includes divergent thinking in the prompt', async () => {
      const llm = makeMockLLM()
      const engine = new ReasoningEngine(llm)
      await engine.generateCoT('Brainstorm solutions for traffic', 'creative')
      const calledWith: string = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(calledWith.toLowerCase()).toContain('creative')
    })

    it('analytical mode includes structured decomposition in the prompt', async () => {
      const llm = makeMockLLM()
      const engine = new ReasoningEngine(llm)
      await engine.generateCoT('Analyze supply chain risks', 'analytical')
      const calledWith: string = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(calledWith.toLowerCase()).toContain('structured')
    })

    it('mode is preserved in the returned trace', async () => {
      const engine = new ReasoningEngine(makeMockLLM())
      for (const mode of ['fast', 'deep', 'creative', 'analytical'] as ReasoningMode[]) {
        const trace = await engine.generateCoT('Test question', mode)
        expect(trace.mode).toBe(mode)
      }
    })
  })

  // ── 2. critiqueAndRefine ─────────────────────────────────────────────────

  describe('critiqueAndRefine', () => {
    it('trace with confidence >= 0.7 is returned unchanged without additional LLM call', async () => {
      const llm = makeMockLLM()
      const engine = new ReasoningEngine(llm)

      const highConfTrace: ReasoningTrace = {
        steps: ['Step 1: analyze', 'Step 2: conclude'],
        finalAnswer: 'The answer is 42',
        confidence: 0.85,
        mode: 'deep',
        durationMs: 100,
        refinements: 0,
      }

      const result = await engine.critiqueAndRefine(highConfTrace)
      expect(result).toBe(highConfTrace) // same reference returned
      expect(llm.complete).not.toHaveBeenCalled()
    })

    it('trace with confidence < 0.7 triggers re-execution', async () => {
      const llm = makeMockLLM([
        'Step 1: deeper analysis\nStep 2: detailed conclusion\nFinal improved answer',
      ])
      const engine = new ReasoningEngine(llm)

      const lowConfTrace: ReasoningTrace = {
        steps: ['x'],
        finalAnswer: 'x',
        confidence: 0.5,
        mode: 'fast',
        durationMs: 10,
        refinements: 0,
      }

      const result = await engine.critiqueAndRefine(lowConfTrace)
      expect(llm.complete).toHaveBeenCalledTimes(1)
      expect(result.refinements).toBeGreaterThanOrEqual(1)
    })

    it('re-executed trace has refinements = 1', async () => {
      const llm = makeMockLLM(['Step 1: refined\nStep 2: more refined\nStep 3: refined final\nAnswer'])
      const engine = new ReasoningEngine(llm)

      const lowConfTrace: ReasoningTrace = {
        steps: ['initial'],
        finalAnswer: 'initial',
        confidence: 0.6,
        mode: 'deep',
        durationMs: 50,
        refinements: 0,
      }

      const result = await engine.critiqueAndRefine(lowConfTrace)
      expect(result.refinements).toBe(1)
    })

    it('stops refining when maxRefinements is reached', async () => {
      const llm: MockLLM = {
        complete: vi.fn().mockResolvedValue('x'),
      }
      const engine = new ReasoningEngine(llm)

      const lowConfTrace: ReasoningTrace = {
        steps: ['x'],
        finalAnswer: 'x',
        confidence: 0.1,
        mode: 'fast',
        durationMs: 10,
        refinements: 3,
      }

      const result = await engine.critiqueAndRefine(lowConfTrace, 3)
      expect(llm.complete).not.toHaveBeenCalled()
      expect(result.refinements).toBe(3)
    })

    it('high confidence input does not trigger any LLM call', async () => {
      const llm = makeMockLLM()
      const engine = new ReasoningEngine(llm)

      const highConfTrace: ReasoningTrace = {
        steps: ['clear reasoning', 'sound conclusion'],
        finalAnswer: 'definitive answer',
        confidence: 0.95,
        mode: 'analytical',
        durationMs: 200,
        refinements: 0,
      }

      await engine.critiqueAndRefine(highConfTrace)
      expect(llm.complete).not.toHaveBeenCalled()
    })
  })

  // ── 3. Reasoning trace completeness ──────────────────────────────────────

  describe('reasoning trace completeness', () => {
    it('steps array is never empty for a successful LLM response', async () => {
      const engine = new ReasoningEngine(
        makeMockLLM(['Step A\nStep B\nFinal'])
      )
      const trace = await engine.generateCoT('Question?', 'analytical')
      expect(trace.steps.length).toBeGreaterThan(0)
    })

    it('finalAnswer is not an empty string for a successful LLM response', async () => {
      const engine = new ReasoningEngine(
        makeMockLLM(['Step 1: think\nFinal answer here'])
      )
      const trace = await engine.generateCoT('What is life?', 'deep')
      expect(trace.finalAnswer).not.toBe('')
    })

    it('mode is preserved through refinement', async () => {
      const llm = makeMockLLM([
        'Step 1: refined\nStep 2: more\nFinal refined answer',
      ])
      const engine = new ReasoningEngine(llm)

      const lowConfTrace: ReasoningTrace = {
        steps: ['x'],
        finalAnswer: 'x',
        confidence: 0.55,
        mode: 'creative',
        durationMs: 10,
        refinements: 0,
      }

      const result = await engine.critiqueAndRefine(lowConfTrace)
      expect(result.mode).toBe('creative')
    })

    it('refinements field starts at 0 for fresh generateCoT', async () => {
      const engine = new ReasoningEngine(makeMockLLM())
      const trace = await engine.generateCoT('Fresh question', 'fast')
      expect(trace.refinements).toBe(0)
    })
  })

  // ── 4. Error handling ─────────────────────────────────────────────────────

  describe('error handling', () => {
    it('LLM throwing returns error trace with confidence = 0', async () => {
      const llm: MockLLM = {
        complete: vi.fn().mockRejectedValue(new Error('LLM service unavailable')),
      }
      const engine = new ReasoningEngine(llm)
      const trace = await engine.generateCoT('Will this fail?', 'fast')
      expect(trace.confidence).toBe(0)
      expect(trace.error).toBeTruthy()
    })

    it('error trace still has the correct mode field', async () => {
      const llm: MockLLM = {
        complete: vi.fn().mockRejectedValue(new Error('Timeout')),
      }
      const engine = new ReasoningEngine(llm)
      const trace = await engine.generateCoT('Test', 'analytical')
      expect(trace.mode).toBe('analytical')
    })

    it('error trace has empty steps array', async () => {
      const llm: MockLLM = {
        complete: vi.fn().mockRejectedValue(new Error('Network error')),
      }
      const engine = new ReasoningEngine(llm)
      const trace = await engine.generateCoT('Test', 'deep')
      expect(trace.steps).toHaveLength(0)
    })

    it('error trace has empty finalAnswer', async () => {
      const llm: MockLLM = {
        complete: vi.fn().mockRejectedValue(new Error('Timeout')),
      }
      const engine = new ReasoningEngine(llm)
      const trace = await engine.generateCoT('Test', 'fast')
      expect(trace.finalAnswer).toBe('')
    })

    it('error trace has non-negative durationMs', async () => {
      const llm: MockLLM = {
        complete: vi.fn().mockRejectedValue(new Error('fail')),
      }
      const engine = new ReasoningEngine(llm)
      const trace = await engine.generateCoT('Test', 'fast')
      expect(trace.durationMs).toBeGreaterThanOrEqual(0)
    })
  })
})
