// Local test implementation — replace with real import when file exists
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolNode {
  id: string
  name: string
  fn: (input: unknown) => Promise<unknown>
  dependencies: string[]
  timeoutMs?: number
}

interface DAGResult {
  nodeId: string
  result?: unknown
  error?: string
  durationMs: number
  status: 'success' | 'error' | 'timeout' | 'cancelled'
}

interface ExecutionPlan {
  nodes: ToolNode[]
  totalNodes: number
  parallelBatches: string[][]
}

// ---------------------------------------------------------------------------
// ParallelToolExecutor implementation
// ---------------------------------------------------------------------------

class ParallelToolExecutor {
  private _cancelled = false

  cancel(): void {
    this._cancelled = true
  }

  analyzeDependencies(nodes: ToolNode[]): ExecutionPlan {
    // Build adjacency + in-degree maps
    const nodeMap = new Map(nodes.map((n) => [n.id, n]))
    const inDegree = new Map<string, number>()
    const dependents = new Map<string, string[]>() // node -> nodes that depend on it

    for (const node of nodes) {
      if (!inDegree.has(node.id)) inDegree.set(node.id, 0)
      for (const dep of node.dependencies) {
        if (!nodeMap.has(dep)) {
          throw new Error(`Unknown dependency: ${dep}`)
        }
        inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1)
        if (!dependents.has(dep)) dependents.set(dep, [])
        dependents.get(dep)!.push(node.id)
      }
    }

    // Kahn's algorithm — topological sort grouped into parallel batches
    const batches: string[][] = []
    let available = nodes
      .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
      .map((n) => n.id)

    const visited = new Set<string>()

    while (available.length > 0) {
      batches.push([...available])
      const nextAvailable: string[] = []

      for (const id of available) {
        visited.add(id)
        for (const dependent of dependents.get(id) ?? []) {
          const newDegree = (inDegree.get(dependent) ?? 0) - 1
          inDegree.set(dependent, newDegree)
          if (newDegree === 0) nextAvailable.push(dependent)
        }
      }

      available = nextAvailable
    }

    if (visited.size !== nodes.length) {
      throw new Error('circular dependency detected')
    }

    return {
      nodes,
      totalNodes: nodes.length,
      parallelBatches: batches,
    }
  }

  async execute(nodes: ToolNode[]): Promise<Map<string, DAGResult>> {
    if (nodes.length === 0) return new Map()

    const plan = this.analyzeDependencies(nodes)
    const results = new Map<string, DAGResult>()
    const nodeMap = new Map(nodes.map((n) => [n.id, n]))

    for (const batch of plan.parallelBatches) {
      const batchPromises = batch.map(async (id) => {
        if (this._cancelled) {
          results.set(id, { nodeId: id, durationMs: 0, status: 'cancelled' })
          return
        }

        const node = nodeMap.get(id)!

        // Build input from dependency results
        const input: Record<string, unknown> = {}
        for (const dep of node.dependencies) {
          const depResult = results.get(dep)
          if (depResult?.status !== 'success') {
            // Dependency failed/cancelled — mark this node as cancelled
            results.set(id, { nodeId: id, durationMs: 0, status: 'cancelled' })
            return
          }
          input[dep] = depResult.result
        }

        const start = Date.now()

        try {
          const timeoutMs = node.timeoutMs
          let resultValue: unknown

          if (timeoutMs !== undefined) {
            resultValue = await Promise.race([
              node.fn(input),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('__timeout__')), timeoutMs),
              ),
            ])
          } else {
            resultValue = await node.fn(input)
          }

          results.set(id, {
            nodeId: id,
            result: resultValue,
            durationMs: Date.now() - start,
            status: 'success',
          })
        } catch (err: unknown) {
          const durationMs = Date.now() - start
          const message = err instanceof Error ? err.message : String(err)

          if (message === '__timeout__') {
            results.set(id, { nodeId: id, durationMs, status: 'timeout' })
          } else {
            results.set(id, {
              nodeId: id,
              error: message,
              durationMs,
              status: 'error',
            })
          }
        }
      })

      await Promise.all(batchPromises)
    }

    return results
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  deps: string[] = [],
  fn?: (input: unknown) => Promise<unknown>,
  timeoutMs?: number,
): ToolNode {
  return {
    id,
    name: id,
    fn: fn ?? (() => Promise.resolve(`result_${id}`)),
    dependencies: deps,
    timeoutMs,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ParallelToolExecutor', () => {
  let executor: ParallelToolExecutor

  beforeEach(() => {
    vi.clearAllMocks()
    executor = new ParallelToolExecutor()
  })

  // -------------------------------------------------------------------------
  // 1. DAG dependency analysis
  // -------------------------------------------------------------------------
  describe('DAG dependency analysis', () => {
    it('3 independent nodes → single parallel batch with all 3', () => {
      const nodes = [makeNode('A'), makeNode('B'), makeNode('C')]
      const plan = executor.analyzeDependencies(nodes)

      expect(plan.parallelBatches).toHaveLength(1)
      expect(plan.parallelBatches[0]).toHaveLength(3)
      expect(plan.parallelBatches[0]).toEqual(expect.arrayContaining(['A', 'B', 'C']))
    })

    it('linear chain A→B→C → 3 sequential batches', () => {
      const nodes = [
        makeNode('A'),
        makeNode('B', ['A']),
        makeNode('C', ['B']),
      ]
      const plan = executor.analyzeDependencies(nodes)

      expect(plan.parallelBatches).toHaveLength(3)
      expect(plan.parallelBatches[0]).toEqual(['A'])
      expect(plan.parallelBatches[1]).toEqual(['B'])
      expect(plan.parallelBatches[2]).toEqual(['C'])
    })

    it('diamond A→B, A→C, B+C→D → batches: [A], [B,C], [D]', () => {
      const nodes = [
        makeNode('A'),
        makeNode('B', ['A']),
        makeNode('C', ['A']),
        makeNode('D', ['B', 'C']),
      ]
      const plan = executor.analyzeDependencies(nodes)

      expect(plan.parallelBatches).toHaveLength(3)
      expect(plan.parallelBatches[0]).toEqual(['A'])
      expect(plan.parallelBatches[1]).toEqual(expect.arrayContaining(['B', 'C']))
      expect(plan.parallelBatches[1]).toHaveLength(2)
      expect(plan.parallelBatches[2]).toEqual(['D'])
    })

    it('circular dependency A→B→A → throws "circular dependency" error', () => {
      const nodes = [makeNode('A', ['B']), makeNode('B', ['A'])]
      expect(() => executor.analyzeDependencies(nodes)).toThrowError(/circular dependency/i)
    })

    it('isolated node with no deps → placed in first batch', () => {
      const nodes = [makeNode('A', []), makeNode('B', ['A'])]
      const plan = executor.analyzeDependencies(nodes)

      expect(plan.parallelBatches[0]).toContain('A')
    })

    it('totalNodes matches input length', () => {
      const nodes = [makeNode('A'), makeNode('B'), makeNode('C')]
      const plan = executor.analyzeDependencies(nodes)
      expect(plan.totalNodes).toBe(3)
    })
  })

  // -------------------------------------------------------------------------
  // 2. Parallel execution
  // -------------------------------------------------------------------------
  describe('parallel execution', () => {
    it('independent nodes run concurrently (3×50ms finishes in ~50ms not 150ms)', async () => {
      const nodes = [
        makeNode('A', [], async () => { await sleep(50); return 'a' }),
        makeNode('B', [], async () => { await sleep(50); return 'b' }),
        makeNode('C', [], async () => { await sleep(50); return 'c' }),
      ]

      const start = Date.now()
      await executor.execute(nodes)
      const elapsed = Date.now() - start

      // Should be roughly 50ms not 150ms — allow generous margin
      expect(elapsed).toBeLessThan(130)
    })

    it('results map contains all node IDs', async () => {
      const nodes = [makeNode('A'), makeNode('B'), makeNode('C')]
      const results = await executor.execute(nodes)

      expect(results.has('A')).toBe(true)
      expect(results.has('B')).toBe(true)
      expect(results.has('C')).toBe(true)
    })

    it('each result has durationMs >= 0', async () => {
      const nodes = [makeNode('A'), makeNode('B')]
      const results = await executor.execute(nodes)

      for (const result of results.values()) {
        expect(result.durationMs).toBeGreaterThanOrEqual(0)
      }
    })

    it('dependent nodes receive dependency results as input', async () => {
      let receivedInput: unknown

      const nodes = [
        makeNode('A', [], async () => 42),
        makeNode('B', ['A'], async (input) => {
          receivedInput = input
          return 'done'
        }),
      ]

      await executor.execute(nodes)
      expect((receivedInput as Record<string, unknown>)['A']).toBe(42)
    })
  })

  // -------------------------------------------------------------------------
  // 3. Error isolation
  // -------------------------------------------------------------------------
  describe('error isolation', () => {
    it('node B fails → nodes with no dependency on B still complete', async () => {
      const nodes = [
        makeNode('A', [], async () => 'ok'),
        makeNode('B', [], async () => { throw new Error('B failed') }),
        makeNode('C', [], async () => 'ok'),
      ]

      const results = await executor.execute(nodes)

      expect(results.get('A')?.status).toBe('success')
      expect(results.get('C')?.status).toBe('success')
    })

    it('node B fails → node C (depends on B) gets "cancelled" status', async () => {
      const nodes = [
        makeNode('B', [], async () => { throw new Error('B failed') }),
        makeNode('C', ['B'], async () => 'ok'),
      ]

      const results = await executor.execute(nodes)

      expect(results.get('B')?.status).toBe('error')
      expect(results.get('C')?.status).toBe('cancelled')
    })

    it('error in node is captured in DAGResult — not thrown', async () => {
      const nodes = [
        makeNode('A', [], async () => { throw new Error('boom') }),
      ]

      await expect(executor.execute(nodes)).resolves.toBeDefined()
      const results = await executor.execute(nodes)
      expect(results.get('A')?.status).toBe('error')
      expect(results.get('A')?.error).toMatch(/boom/)
    })
  })

  // -------------------------------------------------------------------------
  // 4. Timeout handling
  // -------------------------------------------------------------------------
  describe('timeout handling', () => {
    it('node with timeoutMs=50 that takes 200ms → status "timeout"', async () => {
      const nodes = [
        makeNode('A', [], async () => { await sleep(200); return 'done' }, 50),
      ]

      const results = await executor.execute(nodes)
      expect(results.get('A')?.status).toBe('timeout')
    }, 1000)

    it('timed-out node result is DAGResult with status "timeout"', async () => {
      const nodes = [
        makeNode('slow', [], async () => { await sleep(300); return 'done' }, 30),
      ]

      const results = await executor.execute(nodes)
      const r = results.get('slow')!
      expect(r.nodeId).toBe('slow')
      expect(r.status).toBe('timeout')
    }, 1000)

    it('other nodes continue after one times out', async () => {
      const nodes = [
        makeNode('slow', [], async () => { await sleep(300) }, 50),
        makeNode('fast', [], async () => 'fast_result'),
      ]

      const results = await executor.execute(nodes)
      expect(results.get('fast')?.status).toBe('success')
    }, 1000)
  })

  // -------------------------------------------------------------------------
  // 5. Cancellation
  // -------------------------------------------------------------------------
  describe('cancellation', () => {
    it('cancel mid-execution → remaining unstarted nodes get "cancelled"', async () => {
      // Use a barrier: A runs and triggers cancel before B can start (B depends on A)
      let resolveA!: () => void
      const aStarted = new Promise<void>((res) => { resolveA = res })

      const nodes = [
        makeNode('A', [], async () => {
          resolveA()
          await sleep(80)
          return 'a'
        }),
        makeNode('B', ['A'], async () => 'b'),
      ]

      const execPromise = executor.execute(nodes)
      await aStarted
      executor.cancel()
      const results = await execPromise

      // B was not started (A was already running when cancel hit)
      expect(results.get('B')?.status).toBe('cancelled')
    }, 1000)

    it('already-running nodes complete their execution', async () => {
      let resolveA!: () => void
      const aStarted = new Promise<void>((res) => { resolveA = res })

      const nodes = [
        makeNode('A', [], async () => {
          resolveA()
          await sleep(80)
          return 'finished'
        }),
      ]

      const execPromise = executor.execute(nodes)
      await aStarted
      executor.cancel()
      const results = await execPromise

      // A was already running — it should finish
      expect(results.get('A')?.status).toBe('success')
      expect(results.get('A')?.result).toBe('finished')
    }, 1000)

    it('cancel() is idempotent — calling twice does not throw', () => {
      expect(() => {
        executor.cancel()
        executor.cancel()
      }).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // 6. Edge cases
  // -------------------------------------------------------------------------
  describe('edge cases', () => {
    it('empty nodes array → returns empty Map', async () => {
      const results = await executor.execute([])
      expect(results.size).toBe(0)
    })

    it('single node → executes and returns result', async () => {
      const nodes = [makeNode('solo', [], async () => 'solo_result')]
      const results = await executor.execute(nodes)

      expect(results.size).toBe(1)
      expect(results.get('solo')?.status).toBe('success')
      expect(results.get('solo')?.result).toBe('solo_result')
    })

    it('all nodes fail → returns Map with all "error" statuses', async () => {
      const nodes = [
        makeNode('A', [], async () => { throw new Error('fail A') }),
        makeNode('B', [], async () => { throw new Error('fail B') }),
        makeNode('C', [], async () => { throw new Error('fail C') }),
      ]

      const results = await executor.execute(nodes)

      expect(results.get('A')?.status).toBe('error')
      expect(results.get('B')?.status).toBe('error')
      expect(results.get('C')?.status).toBe('error')
    })
  })
})
