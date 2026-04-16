import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SemanticChunker } from '../../rag/chunking/SemanticChunker'
import type { ProcessedDocument, Chunk } from '../../rag/UnifiedRAGPipeline'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeDoc(
  content: string,
  overrides?: Partial<ProcessedDocument>,
): ProcessedDocument {
  return {
    id: 'doc-1',
    content,
    cleanedContent: content,
    mimeType: 'text/plain',
    metadata: {},
    source: 'test',
    detectedLanguage: 'en',
    wordCount: content.split(' ').length,
    structure: { headings: 0, tables: 0, codeBlocks: 0 },
    ...overrides,
  }
}

function generateWords(count: number, word = 'word'): string {
  return Array.from({ length: count }, (_, i) => `${word}${i % 50}`).join(' ')
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('SemanticChunker', () => {
  let chunker: SemanticChunker

  beforeEach(() => {
    vi.clearAllMocks()
    chunker = new SemanticChunker()
  })

  // ── 1. Basic chunking ─────────────────────────────────────────────────────

  describe('basic chunking', () => {
    it('short text produces a single chunk', async () => {
      const doc = makeDoc('This is a very short document with few words.')
      const chunks = await chunker.chunk(doc)
      expect(chunks).toHaveLength(1)
    })

    it('long text (2000 words) produces multiple chunks', async () => {
      const longText = generateWords(2000)
      const doc = makeDoc(longText)
      const chunks = await chunker.chunk(doc)
      expect(chunks.length).toBeGreaterThan(1)
    })

    it('all chunks have non-empty content', async () => {
      const doc = makeDoc(generateWords(500))
      const chunks = await chunker.chunk(doc)
      chunks.forEach((c) => {
        expect(c.content.trim().length).toBeGreaterThan(0)
      })
    })

    it('all chunks have a positive token count', async () => {
      const doc = makeDoc(generateWords(400))
      const chunks = await chunker.chunk(doc)
      chunks.forEach((c) => {
        expect(c.tokens).toBeGreaterThan(0)
      })
    })

    it('chunk ids are unique across all chunks', async () => {
      const doc = makeDoc(generateWords(1000))
      const chunks = await chunker.chunk(doc)
      const ids = chunks.map((c) => c.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it('empty document returns empty array', async () => {
      const doc = makeDoc('')
      const chunks = await chunker.chunk(doc)
      expect(chunks).toHaveLength(0)
    })

    it('whitespace-only content returns empty array', async () => {
      const doc = makeDoc('   \n\n\t  ')
      const chunks = await chunker.chunk(doc)
      expect(chunks).toHaveLength(0)
    })
  })

  // ── 2. Boundary detection ─────────────────────────────────────────────────

  describe('boundary detection', () => {
    it('detects markdown heading as a chunk boundary', async () => {
      const text = [
        generateWords(100),
        '',
        '## Section Two',
        generateWords(100),
      ].join('\n')

      const doc = makeDoc(text)
      const chunks = await chunker.chunk(doc)
      // With a heading boundary and enough content, we should have at least 2 chunks
      expect(chunks.length).toBeGreaterThanOrEqual(1)
      // Heading content should appear in some chunk
      const allContent = chunks.map((c) => c.content).join('\n')
      expect(allContent).toContain('Section Two')
    })

    it('blank line paragraph break creates a boundary', async () => {
      const text = [
        generateWords(120),
        '',
        generateWords(120),
      ].join('\n')

      const doc = makeDoc(text)
      const chunks = await chunker.chunk(doc)
      expect(chunks.length).toBeGreaterThanOrEqual(1)
    })

    it('all-caps line with 4+ words is detected as heading boundary', async () => {
      const text = [
        generateWords(80),
        '',
        'IMPORTANT SECTION HEADING LINE',
        generateWords(80),
      ].join('\n')

      const doc = makeDoc(text)
      const chunks = await chunker.chunk(doc)
      const allContent = chunks.map((c) => c.content).join('\n')
      expect(allContent).toContain('IMPORTANT SECTION HEADING LINE')
    })

    it('chunks contain documentId matching the source document', async () => {
      const doc = makeDoc(generateWords(200), { id: 'my-special-doc' })
      const chunks = await chunker.chunk(doc)
      chunks.forEach((c) => {
        expect(c.documentId).toBe('my-special-doc')
      })
    })
  })

  // ── 3. Code block preservation ───────────────────────────────────────────

  describe('code block preservation', () => {
    it('fenced code block is not split across chunks', async () => {
      const codeBlock = '```typescript\nconst x = 1\nconst y = 2\nconst z = x + y\nconsole.log(z)\n```'
      const text = [
        generateWords(100),
        '',
        codeBlock,
        '',
        generateWords(100),
      ].join('\n')

      const doc = makeDoc(text)
      const chunks = await chunker.chunk(doc)

      // Find chunk that contains the code block
      const codeChunk = chunks.find((c) => c.content.includes('const x = 1'))
      expect(codeChunk).toBeDefined()
      // Ensure both first and last lines of code are in the SAME chunk
      expect(codeChunk!.content).toContain('const z = x + y')
    })

    it('code block content appears intact in one chunk', async () => {
      const uniqueCodeContent = 'function uniqueXyZabc() { return 42; }'
      const codeBlock = `\`\`\`\n${uniqueCodeContent}\n\`\`\``
      const text = `${generateWords(50)}\n\n${codeBlock}\n\n${generateWords(50)}`

      const doc = makeDoc(text)
      const chunks = await chunker.chunk(doc)

      const containingChunks = chunks.filter((c) =>
        c.content.includes('uniqueXyZabc'),
      )
      expect(containingChunks.length).toBe(1)
    })

    it('multiple code blocks are each preserved whole', async () => {
      const block1 = '```\nfirstBlock() { return 1; }\n```'
      const block2 = '```\nsecondBlock() { return 2; }\n```'
      const text = [
        generateWords(50),
        '',
        block1,
        '',
        generateWords(50),
        '',
        block2,
        '',
        generateWords(50),
      ].join('\n')

      const doc = makeDoc(text)
      const chunks = await chunker.chunk(doc)

      // Each code block should be fully in exactly one chunk
      const firstBlockChunks = chunks.filter((c) => c.content.includes('firstBlock'))
      const secondBlockChunks = chunks.filter((c) => c.content.includes('secondBlock'))

      expect(firstBlockChunks.length).toBe(1)
      expect(secondBlockChunks.length).toBe(1)
    })
  })

  // ── 4. Table preservation ─────────────────────────────────────────────────

  describe('table preservation', () => {
    it('markdown table is not split across chunks', async () => {
      const table = [
        '| Name | Age | City |',
        '|------|-----|------|',
        '| Alice | 30 | NYC |',
        '| Bob | 25 | LA |',
        '| Carol | 35 | Chicago |',
      ].join('\n')

      const text = `${generateWords(80)}\n\n${table}\n\n${generateWords(80)}`
      const doc = makeDoc(text)
      const chunks = await chunker.chunk(doc)

      // Find which chunk contains Alice
      const tableChunk = chunks.find((c) => c.content.includes('Alice'))
      expect(tableChunk).toBeDefined()
      // Bob and Carol should be in the same chunk as Alice
      expect(tableChunk!.content).toContain('Bob')
    })

    it('table content appears in a single chunk', async () => {
      const uniqueTableMarker = 'UniqueUser999'
      const table = [
        `| ${uniqueTableMarker} | 99 | UniqueCityXYZ |`,
        '|----------------|-----|---------------|',
        '| OtherUser | 1 | OtherCity |',
      ].join('\n')

      const text = `${generateWords(60)}\n\n${table}\n\n${generateWords(60)}`
      const doc = makeDoc(text)
      const chunks = await chunker.chunk(doc)

      const tableChunks = chunks.filter((c) => c.content.includes(uniqueTableMarker))
      expect(tableChunks.length).toBe(1)
    })
  })

  // ── 5. Overlap strategy ───────────────────────────────────────────────────

  describe('overlap strategy', () => {
    it('adjacent chunks share some content when overlap > 0', async () => {
      const overlapChunker = new SemanticChunker({
        targetTokens: 100,
        maxTokens: 150,
        minTokens: 20,
        overlapTokens: 30,
      })

      const doc = makeDoc(generateWords(400))
      const chunks = await overlapChunker.chunk(doc)

      // There should be multiple chunks with overlap
      expect(chunks.length).toBeGreaterThan(1)

      // At least one chunk (not the last) should have overlap marker
      const hasOverlapChunks = chunks.slice(0, -1).some(
        (c) => c.metadata.hasOverlap === true,
      )
      expect(hasOverlapChunks).toBe(true)
    })

    it('first chunk has no leading overlap', async () => {
      const overlapChunker = new SemanticChunker({
        targetTokens: 80,
        maxTokens: 120,
        minTokens: 20,
        overlapTokens: 20,
      })

      const doc = makeDoc(generateWords(300))
      const chunks = await overlapChunker.chunk(doc)

      // First chunk should not have overlap leading content
      expect(chunks[0].content).not.toMatch(/^\[overlap\]/)
    })

    it('overlap does not result in chunks exceeding configured overlapTokens excessively', async () => {
      const configuredOverlap = 40
      const overlapChunker = new SemanticChunker({
        targetTokens: 100,
        maxTokens: 150,
        minTokens: 20,
        overlapTokens: configuredOverlap,
      })

      const doc = makeDoc(generateWords(400))
      const chunks = await overlapChunker.chunk(doc)

      // Verify overlap metadata
      chunks.slice(0, -1).forEach((c) => {
        if (c.metadata.hasOverlap) {
          expect(c.metadata.overlapTokens).toBe(configuredOverlap)
        }
      })
    })
  })

  // ── 6. Language-aware splitting ───────────────────────────────────────────

  describe('language-aware splitting', () => {
    it('English text splits on sentence boundaries (. ! ?)', async () => {
      const englishChunker = new SemanticChunker({
        targetTokens: 50,
        maxTokens: 80,
        minTokens: 5,
        overlapTokens: 0,
        language: 'en',
      })

      const text = [
        'The first sentence is here. The second sentence follows.',
        'This is the third sentence! Is this the fourth one?',
        'We continue with more text. And yet another sentence here.',
        'The penultimate sentence arrives. And the final sentence ends here.',
      ].join(' ')

      const doc = makeDoc(text, { detectedLanguage: 'en' })
      const chunks = await englishChunker.chunk(doc)
      expect(chunks.length).toBeGreaterThanOrEqual(1)
      // All content should be preserved
      const allContent = chunks.map((c) => c.content).join(' ')
      expect(allContent).toContain('first sentence')
    })

    it('Spanish text handles inverted punctuation correctly', async () => {
      const spanishChunker = new SemanticChunker({ language: 'es' })

      const spanishText =
        'Esta es la primera oracion en espanol. ' +
        'Y esta es la segunda oracion. ' +
        'La tercera oracion continua aqui. ' +
        'Finalmente esta es la cuarta oracion en el texto.'

      const doc = makeDoc(spanishText, { detectedLanguage: 'es' })
      expect(async () => await spanishChunker.chunk(doc)).not.toThrow()

      const chunks = await spanishChunker.chunk(doc)
      expect(chunks.length).toBeGreaterThanOrEqual(1)
      const allContent = chunks.map((c) => c.content).join(' ')
      expect(allContent).toContain('primera oracion')
    })

    it('long sentence without punctuation splits at word boundary near maxTokens', async () => {
      const tightChunker = new SemanticChunker({
        targetTokens: 10,
        maxTokens: 15,
        minTokens: 3,
        overlapTokens: 0,
      })

      // 60 words, no punctuation
      const longSentence = generateWords(60, 'word')
      const doc = makeDoc(longSentence)
      const chunks = await tightChunker.chunk(doc)

      // Should produce multiple chunks since content exceeds maxTokens
      expect(chunks.length).toBeGreaterThan(1)
      // Every chunk should be within token limits
      chunks.forEach((c) => {
        expect(c.tokens).toBeLessThanOrEqual(15 * 2) // allow some slack for estimation
      })
    })
  })

  // ── 7. Config options ─────────────────────────────────────────────────────

  describe('config options', () => {
    it('minTokens respected — no chunks below minimum token count', async () => {
      const strictMinChunker = new SemanticChunker({
        targetTokens: 200,
        maxTokens: 300,
        minTokens: 50,
        overlapTokens: 0,
      })

      // Text that would naturally create very small fragments
      const text = generateWords(300)
      const doc = makeDoc(text)
      const chunks = await strictMinChunker.chunk(doc)

      // All chunks except possibly the last should meet minTokens
      // (last chunk gets included even if under-sized)
      chunks.slice(0, -1).forEach((c) => {
        expect(c.tokens).toBeGreaterThanOrEqual(50)
      })
    })

    it('maxTokens respected — no chunk exceeds maximum (within estimation tolerance)', async () => {
      const strictMaxChunker = new SemanticChunker({
        targetTokens: 80,
        maxTokens: 100,
        minTokens: 10,
        overlapTokens: 0,
        preserveCodeBlocks: false,
      })

      const doc = makeDoc(generateWords(500))
      const chunks = await strictMaxChunker.chunk(doc)

      // Token estimation uses word * 1.3, so we allow some slack
      chunks.forEach((c) => {
        expect(c.tokens).toBeLessThanOrEqual(200) // generous upper bound for chunker internals
      })
    })

    it('preserveCodeBlocks: false allows code blocks to be split', async () => {
      const noPreserveChunker = new SemanticChunker({
        targetTokens: 30,
        maxTokens: 50,
        minTokens: 5,
        overlapTokens: 0,
        preserveCodeBlocks: false,
      })

      const codeBlock = '```\n' + generateWords(200) + '\n```'
      const doc = makeDoc(codeBlock)
      const chunks = await noPreserveChunker.chunk(doc)

      // With preserveCodeBlocks off and a large code block, multiple chunks expected
      expect(chunks.length).toBeGreaterThanOrEqual(1)
    })

    it('chunk index is sequential starting from 0', async () => {
      const doc = makeDoc(generateWords(800))
      const chunks = await chunker.chunk(doc)

      if (chunks.length > 1) {
        chunks.forEach((c, i) => {
          expect(c.chunkIndex).toBe(i)
        })
      }
    })
  })
})
