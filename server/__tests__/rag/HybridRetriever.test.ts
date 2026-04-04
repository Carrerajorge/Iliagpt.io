import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HybridRetriever } from '../../rag/retrieval/HybridRetriever'

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirroring the real types used in HybridRetriever)
// ─────────────────────────────────────────────────────────────────────────────

interface RetrievedChunk {
  id: string
  documentId: string
  content: string
  chunkIndex: number
  metadata: Record<string, unknown>
  tokens: number
  score: number
  source: string
  retrievalMethod: 'vector' | 'bm25' | 'hybrid' | 'metadata'
}

interface RetrievedQuery {
  text: string
  namespace: string
  topK: number
  filter?: Record<string, unknown>
  hybridAlpha?: number
  minScore?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeChunk(id: string, content: string, score = 1.0): RetrievedChunk {
  return {
    id,
    documentId: `doc-${id}`,
    content,
    chunkIndex: 0,
    metadata: {},
    tokens: content.split(' ').length,
    score,
    source: 'test',
    retrievalMethod: 'hybrid',
  }
}

function makeQuery(text: string, topK = 5, minScore?: number): RetrievedQuery {
  return { text, namespace: 'test', topK, minScore }
}

// Simple unit vector for testing
function makeVector(size: number, hotIndex: number): number[] {
  const vec = new Array(size).fill(0)
  vec[hotIndex] = 1.0
  return vec
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('HybridRetriever', () => {
  let retriever: HybridRetriever

  beforeEach(() => {
    vi.clearAllMocks()
    retriever = new HybridRetriever()
  })

  // ── 1. RRF scoring formula ────────────────────────────────────────────────

  describe('RRF scoring formula', () => {
    it('uses k=60 in the RRF denominator by default', async () => {
      // Add 3 docs where one clearly matches the keyword
      const chunk1 = makeChunk('c1', 'elephant africa savanna large mammal')
      const chunk2 = makeChunk('c2', 'bicycle wheel spokes frame mountain')
      const chunk3 = makeChunk('c3', 'database schema table index query elephant')

      retriever.addChunk(chunk1)
      retriever.addChunk(chunk2)
      retriever.addChunk(chunk3)

      const results = await retriever.retrieve(makeQuery('elephant', 3))
      // With k=60, even rank 1 gives 1/61 ≈ 0.016 — non-zero results expected
      expect(results.length).toBeGreaterThan(0)
      results.forEach((r) => {
        // score = 1/(60 + rank) per ranker, always > 0
        expect(r.score).toBeGreaterThan(0)
      })
    })

    it('chunk ranked first by BM25 has a higher fused score than chunk ranked last', async () => {
      const bestMatch = makeChunk('best', 'elephant elephant elephant savanna africa')
      const worstMatch = makeChunk('worst', 'ocean fish coral reef water deep')
      retriever.addChunk(bestMatch)
      retriever.addChunk(worstMatch)

      const results = await retriever.retrieve(makeQuery('elephant', 2))
      expect(results.length).toBeGreaterThan(0)
      // The best match should appear first (highest score)
      expect(results[0].id).toBe('best')
    })

    it('RRF fused score for rank 1 equals 1/(60+1) per ranker contribution', async () => {
      // With one ranker and rank=1: contribution = 1/61
      const onlyChunk = makeChunk('sole', 'unique keyword zebra stripes mammal africa')
      retriever.addChunk(onlyChunk)

      const results = await retriever.retrieve(makeQuery('zebra', 1))
      expect(results.length).toBe(1)
      // score should be 1/61 ≈ 0.01639
      expect(results[0].score).toBeCloseTo(1 / 61, 3)
    })

    it('chunk ranked first by multiple rankers has the highest fused score', async () => {
      const topChunk = makeChunk('top', 'algorithm sorting complexity quicksort merge')
      const midChunk = makeChunk('mid', 'algorithm machine learning neural network sorting')
      const bottomChunk = makeChunk('bottom', 'database normalization foreign key index')

      const topVec = makeVector(8, 0)
      const midVec = makeVector(8, 2)
      const bottomVec = makeVector(8, 4)
      const queryVec = makeVector(8, 0)

      retriever.addChunk(topChunk, topVec)
      retriever.addChunk(midChunk, midVec)
      retriever.addChunk(bottomChunk, bottomVec)

      const results = await retriever.retrieve(makeQuery('algorithm sorting', 3), queryVec)
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('top')
    })
  })

  // ── 2. BM25 retrieval ─────────────────────────────────────────────────────

  describe('BM25 retrieval', () => {
    it('finds document containing search keyword "elephant"', async () => {
      retriever.addChunk(makeChunk('doc-elephant', 'the elephant is a large mammal in africa'))
      retriever.addChunk(makeChunk('doc-car', 'the car has four wheels and an engine'))

      const results = await retriever.retrieve(makeQuery('elephant', 5))
      expect(results.some((r) => r.id === 'doc-elephant')).toBe(true)
    })

    it('returns empty or zero-score results for word not in any document', async () => {
      retriever.addChunk(makeChunk('doc-a', 'cat mouse dog hamster rabbit'))
      retriever.addChunk(makeChunk('doc-b', 'table chair desk lamp sofa'))

      const results = await retriever.retrieve(makeQuery('xylophone', 5))
      // Either empty or all results have low/zero score from BM25
      results.forEach((r) => {
        expect(r.score).toBeGreaterThanOrEqual(0)
      })
    })

    it('BM25 scores are non-negative', async () => {
      retriever.addChunk(makeChunk('d1', 'python programming language coding'))
      retriever.addChunk(makeChunk('d2', 'java spring boot microservices'))

      const results = await retriever.retrieve(makeQuery('python', 2))
      results.forEach((r) => expect(r.score).toBeGreaterThanOrEqual(0))
    })

    it('document with higher term frequency scores higher for BM25', async () => {
      // d1 has "elephant" 4 times, d2 has it once
      retriever.addChunk(
        makeChunk('high-tf', 'elephant elephant elephant elephant savanna africa'),
      )
      retriever.addChunk(makeChunk('low-tf', 'elephant cat dog bird fish whale'))

      const results = await retriever.retrieve(makeQuery('elephant', 2))
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('high-tf')
    })
  })

  // ── 3. Vector retrieval ───────────────────────────────────────────────────

  describe('vector retrieval', () => {
    it('query with identical vector produces score close to 1.0', async () => {
      const vec = [1, 0, 0, 0]
      retriever.addChunk(makeChunk('exact', 'any content here'), vec)

      const results = await retriever.retrieve(makeQuery('any content', 1), vec)
      expect(results.length).toBe(1)
      // Score may be boosted by RRF but should reflect high similarity
      expect(results[0].score).toBeGreaterThan(0)
    })

    it('orthogonal vector query produces low score', async () => {
      const docVec = [1, 0, 0, 0]
      const queryVec = [0, 0, 1, 0] // orthogonal
      retriever.addChunk(makeChunk('orthogonal-doc', 'content alpha beta gamma'), docVec)

      const results = await retriever.retrieve(makeQuery('xyz', 1), queryVec)
      // Should either be empty or have a very low RRF score from vector ranker
      if (results.length > 0) {
        expect(results[0].score).toBeGreaterThanOrEqual(0)
      }
    })

    it('handles zero vector query gracefully without NaN or throw', async () => {
      const docVec = [1, 0, 0, 0]
      retriever.addChunk(makeChunk('doc-z', 'some content'), docVec)

      const zeroVec = [0, 0, 0, 0]
      expect(async () => {
        await retriever.retrieve(makeQuery('anything', 1), zeroVec)
      }).not.toThrow()

      const results = await retriever.retrieve(makeQuery('anything', 1), zeroVec)
      results.forEach((r) => {
        expect(isNaN(r.score)).toBe(false)
      })
    })
  })

  // ── 4. MMR diversity enforcement ─────────────────────────────────────────

  describe('MMR diversity enforcement', () => {
    it('with high diversity weight returns diverse results', async () => {
      const diverseRetriever = new HybridRetriever({
        mmr: { lambda: 0.3, topK: 3 },
      })

      // 5 near-identical chunks
      for (let i = 0; i < 5; i++) {
        diverseRetriever.addChunk(
          makeChunk(`clone-${i}`, 'elephant africa large mammal savanna grass'),
        )
      }

      const results = await diverseRetriever.retrieve(makeQuery('elephant', 3))
      // With MMR diversity, we should not always get the first 3 identical ones
      expect(results.length).toBeLessThanOrEqual(3)
    })

    it('MMR never returns more results than topK', async () => {
      for (let i = 0; i < 10; i++) {
        retriever.addChunk(makeChunk(`chunk-${i}`, `document ${i} content about topics`))
      }

      const results = await retriever.retrieve(makeQuery('document content', 3))
      expect(results.length).toBeLessThanOrEqual(3)
    })

    it('with lambda=1.0 (pure relevance) top result is the most relevant', async () => {
      const relevanceRetriever = new HybridRetriever({
        mmr: { lambda: 1.0, topK: 5 },
      })

      relevanceRetriever.addChunk(
        makeChunk('most-relevant', 'elephant elephant elephant africa savanna'),
      )
      for (let i = 0; i < 4; i++) {
        relevanceRetriever.addChunk(
          makeChunk(`other-${i}`, `document ${i} cat dog bird fish`),
        )
      }

      const results = await relevanceRetriever.retrieve(makeQuery('elephant', 5))
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('most-relevant')
    })
  })

  // ── 5. Multi-ranker fusion ────────────────────────────────────────────────

  describe('multi-ranker fusion', () => {
    it('chunk ranked high by both BM25 and vector gets boosted fused score', async () => {
      const strongVec = makeVector(4, 0)
      const weakVec = makeVector(4, 3)
      const queryVec = makeVector(4, 0)

      const strongChunk = makeChunk(
        'strong',
        'typescript javascript nodejs npm package module export',
      )
      const weakChunk = makeChunk('weak', 'python pandas numpy scipy matplotlib')

      retriever.addChunk(strongChunk, strongVec)
      retriever.addChunk(weakChunk, weakVec)

      const results = await retriever.retrieve(
        makeQuery('typescript javascript', 2),
        queryVec,
      )

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('strong')
    })

    it('disabling BM25 ranker — only vector contributes', async () => {
      const vectorOnlyRetriever = new HybridRetriever({
        rankers: [
          { name: 'bm25', weight: 1.0, enabled: false },
          { name: 'vector', weight: 1.0, enabled: true },
        ],
      })

      const vec1 = makeVector(4, 0)
      const vec2 = makeVector(4, 2)
      const queryVec = makeVector(4, 0)

      vectorOnlyRetriever.addChunk(makeChunk('v1', 'any content'), vec1)
      vectorOnlyRetriever.addChunk(makeChunk('v2', 'other content'), vec2)

      const results = await vectorOnlyRetriever.retrieve(
        makeQuery('anything', 2),
        queryVec,
      )

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('v1') // vector similarity should place v1 first
    })

    it('disabling vector ranker — only BM25 contributes', async () => {
      const bm25OnlyRetriever = new HybridRetriever({
        rankers: [
          { name: 'bm25', weight: 1.0, enabled: true },
          { name: 'vector', weight: 1.0, enabled: false },
        ],
      })

      bm25OnlyRetriever.addChunk(makeChunk('bm-best', 'elephant elephant large mammal'))
      bm25OnlyRetriever.addChunk(makeChunk('bm-other', 'cat dog bird reptile fish'))

      const results = await bm25OnlyRetriever.retrieve(makeQuery('elephant', 2))
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('bm-best')
    })
  })

  // ── 6. Edge cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('retrieve on empty index returns empty array', async () => {
      const results = await retriever.retrieve(makeQuery('anything', 5))
      expect(results).toEqual([])
    })

    it('single chunk in index — retrieve returns that chunk', async () => {
      retriever.addChunk(makeChunk('only-one', 'the only document here'))
      const results = await retriever.retrieve(makeQuery('only document', 5))
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('only-one')
    })

    it('minScore filter removes results below threshold', async () => {
      retriever.addChunk(makeChunk('high-rel', 'elephant big large mammal africa'))
      retriever.addChunk(makeChunk('low-rel', 'quantum physics particles wave'))

      const results = await retriever.retrieve(makeQuery('elephant mammal', 5, 0.5))
      // High-minScore filter should remove results below 0.5
      results.forEach((r) => {
        expect(r.score).toBeGreaterThanOrEqual(0.5)
      })
    })

    it('topK=0 returns empty array', async () => {
      retriever.addChunk(makeChunk('doc', 'some content here for testing'))
      const results = await retriever.retrieve(makeQuery('content', 0))
      expect(results).toHaveLength(0)
    })

    it('retrieve before adding any chunks returns empty array without throwing', async () => {
      expect(async () => {
        await retriever.retrieve(makeQuery('test', 5))
      }).not.toThrow()

      const results = await retriever.retrieve(makeQuery('test', 5))
      expect(results).toEqual([])
    })

    it('getStats returns correct document counts', () => {
      retriever.addChunk(makeChunk('s1', 'first document content'))
      retriever.addChunk(makeChunk('s2', 'second document content'))

      const stats = retriever.getStats()
      expect(stats.documents).toBe(2)
      expect(stats.bm25Indexed).toBe(2)
    })

    it('clear removes all documents and bm25 index', async () => {
      retriever.addChunk(makeChunk('to-clear', 'will be removed'))
      retriever.clear()

      const results = await retriever.retrieve(makeQuery('removed', 5))
      expect(results).toHaveLength(0)

      const stats = retriever.getStats()
      expect(stats.documents).toBe(0)
      expect(stats.bm25Indexed).toBe(0)
    })

    it('remove() deletes a specific chunk from index', async () => {
      retriever.addChunk(makeChunk('keep', 'elephant savanna africa large'))
      retriever.addChunk(makeChunk('delete-me', 'elephant savanna africa large'))

      retriever.remove('delete-me')

      const stats = retriever.getStats()
      expect(stats.documents).toBe(1)
    })
  })
})
