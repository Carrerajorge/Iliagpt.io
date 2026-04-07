// Local test implementation — replace with real import when file exists
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryRecord {
  id: string
  agentId: string
  userId: string
  content: string
  embedding: number[]
  importance: number // 0-1
  accessCount: number
  createdAt: Date
  lastAccessedAt: Date
  tags: string[]
  expiresAt?: Date
}

interface SearchOptions {
  topK: number
  minScore?: number
  userId?: string
  tags?: string[]
  namespace?: string
}

type StoredResult = MemoryRecord & { score: number }

// ---------------------------------------------------------------------------
// PgVectorMemoryStore implementation (in-memory mock)
// ---------------------------------------------------------------------------

class PgVectorMemoryStore {
  private records = new Map<string, MemoryRecord>()
  private idCounter = 0

  private _generateId(): string {
    return `mem_${++this.idCounter}_${Date.now()}`
  }

  /** Cosine similarity between two vectors */
  private _cosineSim(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    if (denom === 0) return 0
    return dot / denom
  }

  async store(
    record: Omit<MemoryRecord, 'id' | 'createdAt' | 'lastAccessedAt' | 'accessCount'>,
  ): Promise<MemoryRecord> {
    const now = new Date()
    const full: MemoryRecord = {
      ...record,
      id: this._generateId(),
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
    }
    this.records.set(full.id, full)
    return { ...full }
  }

  async search(
    queryEmbedding: number[],
    options: SearchOptions,
  ): Promise<StoredResult[]> {
    const { topK, minScore = 0, userId, tags } = options

    const results: StoredResult[] = []

    for (const record of this.records.values()) {
      if (userId !== undefined && record.userId !== userId) continue
      if (tags && tags.length > 0) {
        const hasTag = tags.every((t) => record.tags.includes(t))
        if (!hasTag) continue
      }

      const score = this._cosineSim(queryEmbedding, record.embedding)
      if (score < minScore) continue

      results.push({ ...record, score })
    }

    // Sort descending by score
    results.sort((a, b) => b.score - a.score)

    const topResults = results.slice(0, topK)

    // Update access count and lastAccessedAt for hits
    for (const r of topResults) {
      const existing = this.records.get(r.id)!
      existing.accessCount++
      existing.lastAccessedAt = new Date()
    }

    return topResults
  }

  computeImportance(record: MemoryRecord): number {
    const now = Date.now()
    const ageMs = now - record.createdAt.getTime()
    const ageDays = ageMs / (1000 * 60 * 60 * 24)

    // Recency: decay over 30 days
    const recency = Math.exp(-ageDays / 30)

    // Frequency boost
    const frequency = Math.min(1, record.accessCount / 10)

    // Tag weight
    const importantTags = new Set(['important', 'critical', 'priority'])
    const tagWeight = record.tags.some((t) => importantTags.has(t)) ? 1.5 : 1.0

    const raw = recency * 0.5 + frequency * 0.5
    return Math.min(1, raw * tagWeight)
  }

  async consolidate(
    agentId: string,
  ): Promise<{ merged: number; pruned: number }> {
    const records = Array.from(this.store.values()).filter(
      (r) => r.agentId === agentId,
    )

    let merged = 0
    let pruned = 0
    const toDelete = new Set<string>()

    // Find near-identical pairs (>90% text overlap by word set)
    for (let i = 0; i < records.length; i++) {
      if (toDelete.has(records[i].id)) continue

      for (let j = i + 1; j < records.length; j++) {
        if (toDelete.has(records[j].id)) continue

        const overlap = this._textOverlap(records[i].content, records[j].content)
        if (overlap > 0.9) {
          // Merge: keep i, absorb j
          const a = records[i]
          const b = records[j]

          a.tags = Array.from(new Set([...a.tags, ...b.tags]))
          a.importance = Math.min(1, Math.max(a.importance, b.importance) * 1.1)
          a.accessCount += b.accessCount

          toDelete.add(b.id)
          merged++
        }
      }
    }

    for (const id of toDelete) {
      this.records.delete(id)
      pruned++
    }

    return { merged, pruned }
  }

  /** Jaccard similarity on word sets */
  private _textOverlap(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/))
    const wordsB = new Set(b.toLowerCase().split(/\s+/))
    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)))
    const union = new Set([...wordsA, ...wordsB])
    return union.size === 0 ? 1 : intersection.size / union.size
  }

  async gc(agentId: string): Promise<number> {
    const now = new Date()
    let removed = 0

    for (const [id, record] of this.records) {
      if (record.agentId !== agentId) continue

      const isExpired = record.expiresAt !== undefined && record.expiresAt <= now
      const recomputedImportance = this.computeImportance(record)
      const isNegligible = recomputedImportance < 0.01

      if (isExpired || isNegligible) {
        this.records.delete(id)
        removed++
      }
    }

    return removed
  }

  getStats(agentId: string): {
    total: number
    avgImportance: number
    totalAccesses: number
  } {
    const records = Array.from(this.records.values()).filter(
      (r) => r.agentId === agentId,
    )

    const total = records.length
    const avgImportance =
      total > 0 ? records.reduce((s, r) => s + r.importance, 0) / total : 0
    const totalAccesses = records.reduce((s, r) => s + r.accessCount, 0)

    return { total, avgImportance, totalAccesses }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVector(size = 10, ...indices: number[]): number[] {
  const v = new Array<number>(size).fill(0)
  for (const i of indices) v[i] = 1
  return v
}

function makeBaseRecord(
  overrides: Partial<
    Omit<MemoryRecord, 'id' | 'createdAt' | 'lastAccessedAt' | 'accessCount'>
  > = {},
): Omit<MemoryRecord, 'id' | 'createdAt' | 'lastAccessedAt' | 'accessCount'> {
  return {
    agentId: 'agent1',
    userId: 'user1',
    content: 'Sample memory content',
    embedding: makeVector(10, 0),
    importance: 0.5,
    tags: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PgVectorMemoryStore', () => {
  let memStore: PgVectorMemoryStore

  beforeEach(() => {
    vi.clearAllMocks()
    memStore = new PgVectorMemoryStore()
  })

  // -------------------------------------------------------------------------
  // 1. Semantic search with mock vectors
  // -------------------------------------------------------------------------
  describe('semantic search with mock vectors', () => {
    it('identical vectors → score ≈ 1.0', async () => {
      const vec = makeVector(10, 0) // [1,0,0,0,0,0,0,0,0,0]
      await memStore.store(makeBaseRecord({ embedding: vec }))

      const results = await memStore.search(vec, { topK: 1 })

      expect(results[0].score).toBeCloseTo(1.0, 4)
    })

    it('orthogonal vectors → score ≈ 0.0', async () => {
      const vec = makeVector(10, 0)   // [1,0,...]
      const query = makeVector(10, 1) // [0,1,...]
      await memStore.store(makeBaseRecord({ embedding: vec }))

      const results = await memStore.search(query, { topK: 1 })

      expect(results[0].score).toBeCloseTo(0.0, 4)
    })

    it('topK=3 from 10 records → returns exactly 3 highest scoring', async () => {
      for (let i = 0; i < 10; i++) {
        await memStore.store(
          makeBaseRecord({ embedding: makeVector(10, i % 10) }),
        )
      }
      const query = makeVector(10, 0)
      const results = await memStore.search(query, { topK: 3 })

      expect(results).toHaveLength(3)
    })

    it('minScore=0.8 filter → excludes low-similarity results', async () => {
      const similar = makeVector(10, 0)
      const different = makeVector(10, 5)
      await memStore.store(makeBaseRecord({ embedding: similar }))
      await memStore.store(makeBaseRecord({ embedding: different }))

      const results = await memStore.search(makeVector(10, 0), {
        topK: 10,
        minScore: 0.8,
      })

      expect(results.every((r) => r.score >= 0.8)).toBe(true)
    })

    it('access count incremented after each search hit', async () => {
      const rec = await memStore.store(makeBaseRecord({ embedding: makeVector(10, 0) }))

      await memStore.search(makeVector(10, 0), { topK: 1 })
      await memStore.search(makeVector(10, 0), { topK: 1 })

      const results = await memStore.search(makeVector(10, 0), { topK: 1 })
      // After 3 searches, accessCount should be 3
      expect(results[0].accessCount).toBe(3)
    })

    it('userId filter returns only matching records', async () => {
      await memStore.store(makeBaseRecord({ userId: 'userA', embedding: makeVector(10, 0) }))
      await memStore.store(makeBaseRecord({ userId: 'userB', embedding: makeVector(10, 0) }))

      const results = await memStore.search(makeVector(10, 0), {
        topK: 10,
        userId: 'userA',
      })

      expect(results.every((r) => r.userId === 'userA')).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // 2. Memory consolidation
  // -------------------------------------------------------------------------
  describe('memory consolidation', () => {
    it('two near-identical records (>90% text overlap) → merged into one', async () => {
      const content = 'The quick brown fox jumps over the lazy dog'
      await memStore.store(makeBaseRecord({ content }))
      await memStore.store(makeBaseRecord({ content })) // identical

      const { merged, pruned } = await memStore.consolidate('agent1')

      expect(merged).toBeGreaterThanOrEqual(1)
      expect(pruned).toBeGreaterThanOrEqual(1)

      const stats = memStore.getStats('agent1')
      expect(stats.total).toBe(1)
    })

    it('merged record has combined tags from both sources', async () => {
      const content = 'Shared content that is very similar indeed'
      await memStore.store(
        makeBaseRecord({ content, tags: ['tag1', 'tag2'] }),
      )
      await memStore.store(
        makeBaseRecord({ content, tags: ['tag2', 'tag3'] }),
      )

      await memStore.consolidate('agent1')

      // Retrieve the remaining record via search
      const results = await memStore.search(makeVector(10, 0), { topK: 5 })
      const remainingRecord = results.find((r) => r.agentId === 'agent1')

      // After merge, tags should include all unique tags
      expect(remainingRecord?.tags).toEqual(
        expect.arrayContaining(['tag1', 'tag2', 'tag3']),
      )
    })

    it('distinct records → no merging', async () => {
      await memStore.store(makeBaseRecord({ content: 'Completely different first record' }))
      await memStore.store(makeBaseRecord({ content: 'Entirely unrelated second piece of text' }))

      const { merged } = await memStore.consolidate('agent1')

      expect(merged).toBe(0)
      expect(memStore.getStats('agent1').total).toBe(2)
    })

    it('merged record has higher importance than either source', async () => {
      const content = 'Identical memory record content for merging test'
      const rec1 = await memStore.store(
        makeBaseRecord({ content, importance: 0.4 }),
      )
      const rec2 = await memStore.store(
        makeBaseRecord({ content, importance: 0.5 }),
      )

      await memStore.consolidate('agent1')

      const results = await memStore.search(makeVector(10, 0), { topK: 1 })
      expect(results[0].importance).toBeGreaterThan(0.5)

      void rec1
      void rec2
    })
  })

  // -------------------------------------------------------------------------
  // 3. Importance scoring
  // -------------------------------------------------------------------------
  describe('importance scoring', () => {
    it('recent record → high recency factor (importance > 0.4)', () => {
      const record: MemoryRecord = {
        id: 'x',
        agentId: 'a',
        userId: 'u',
        content: 'recent',
        embedding: [],
        importance: 0,
        accessCount: 0,
        createdAt: new Date(),
        lastAccessedAt: new Date(),
        tags: [],
      }

      const importance = memStore.computeImportance(record)
      expect(importance).toBeGreaterThan(0.4)
    })

    it('old record (30 days ago) → lower recency factor than fresh record', () => {
      const now = new Date()
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

      const fresh: MemoryRecord = {
        id: 'f', agentId: 'a', userId: 'u', content: 'fresh',
        embedding: [], importance: 0, accessCount: 0,
        createdAt: now, lastAccessedAt: now, tags: [],
      }
      const old: MemoryRecord = {
        id: 'o', agentId: 'a', userId: 'u', content: 'old',
        embedding: [], importance: 0, accessCount: 0,
        createdAt: thirtyDaysAgo, lastAccessedAt: thirtyDaysAgo, tags: [],
      }

      expect(memStore.computeImportance(fresh)).toBeGreaterThan(
        memStore.computeImportance(old),
      )
    })

    it('high access count → importance boost', () => {
      const base: MemoryRecord = {
        id: 'x', agentId: 'a', userId: 'u', content: 'test',
        embedding: [], importance: 0, accessCount: 0,
        createdAt: new Date(), lastAccessedAt: new Date(), tags: [],
      }
      const accessed: MemoryRecord = { ...base, id: 'y', accessCount: 10 }

      expect(memStore.computeImportance(accessed)).toBeGreaterThan(
        memStore.computeImportance(base),
      )
    })

    it('tag "important" → boosted score compared to same record without tag', () => {
      const base: MemoryRecord = {
        id: 'x', agentId: 'a', userId: 'u', content: 'test',
        embedding: [], importance: 0, accessCount: 0,
        createdAt: new Date(), lastAccessedAt: new Date(), tags: [],
      }
      const tagged: MemoryRecord = { ...base, id: 'y', tags: ['important'] }

      expect(memStore.computeImportance(tagged)).toBeGreaterThan(
        memStore.computeImportance(base),
      )
    })

    it('tag "critical" → boosted score', () => {
      const base: MemoryRecord = {
        id: 'x', agentId: 'a', userId: 'u', content: 'test',
        embedding: [], importance: 0, accessCount: 0,
        createdAt: new Date(), lastAccessedAt: new Date(), tags: [],
      }
      const tagged: MemoryRecord = { ...base, id: 'y', tags: ['critical'] }

      expect(memStore.computeImportance(tagged)).toBeGreaterThan(
        memStore.computeImportance(base),
      )
    })

    it('zero access count → lower importance than accessed record', () => {
      const base: MemoryRecord = {
        id: 'x', agentId: 'a', userId: 'u', content: 'test',
        embedding: [], importance: 0, accessCount: 0,
        createdAt: new Date(), lastAccessedAt: new Date(), tags: [],
      }
      const accessed: MemoryRecord = { ...base, id: 'y', accessCount: 5 }

      expect(memStore.computeImportance(accessed)).toBeGreaterThan(
        memStore.computeImportance(base),
      )
    })
  })

  // -------------------------------------------------------------------------
  // 4. Garbage collection
  // -------------------------------------------------------------------------
  describe('garbage collection', () => {
    it('expired record (expiresAt in past) → removed by gc()', async () => {
      const past = new Date(Date.now() - 1000)
      await memStore.store(makeBaseRecord({ expiresAt: past }))

      const removed = await memStore.gc('agent1')

      expect(removed).toBeGreaterThanOrEqual(1)
      expect(memStore.getStats('agent1').total).toBe(0)
    })

    it('gc() returns count of removed records', async () => {
      const past = new Date(Date.now() - 1000)
      await memStore.store(makeBaseRecord({ expiresAt: past }))
      await memStore.store(makeBaseRecord({ expiresAt: past }))

      const removed = await memStore.gc('agent1')

      expect(removed).toBe(2)
    })

    it('important recent records → not removed by gc()', async () => {
      await memStore.store(
        makeBaseRecord({ importance: 0.9, tags: ['critical'] }),
      )

      const removed = await memStore.gc('agent1')

      expect(removed).toBe(0)
      expect(memStore.getStats('agent1').total).toBe(1)
    })

    it('stats reflect removal after gc()', async () => {
      const past = new Date(Date.now() - 1000)
      await memStore.store(makeBaseRecord({ expiresAt: past }))
      await memStore.store(makeBaseRecord({ importance: 0.8 }))

      await memStore.gc('agent1')

      const stats = memStore.getStats('agent1')
      expect(stats.total).toBe(1)
    })

    it('gc only removes records for specified agentId', async () => {
      const past = new Date(Date.now() - 1000)
      await memStore.store(makeBaseRecord({ agentId: 'agent1', expiresAt: past }))
      await memStore.store(makeBaseRecord({ agentId: 'agent2', expiresAt: past }))

      await memStore.gc('agent1')

      expect(memStore.getStats('agent1').total).toBe(0)
      expect(memStore.getStats('agent2').total).toBe(1)
    })
  })
})
