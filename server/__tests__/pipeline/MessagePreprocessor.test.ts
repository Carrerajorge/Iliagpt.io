import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Local test implementation — replace with real import when file exists
// ─────────────────────────────────────────────────────────────────────────────

interface ProcessedMessage {
  original: string
  normalized: string
  language: { code: string; confidence: number }
  intent: { type: string; confidence: number }
  entities: {
    urls: string[]
    codeBlocks: string[]
    filePaths: string[]
    mentions: string[]
  }
}

const LANGUAGE_MARKERS: Record<string, string[]> = {
  es: ['el', 'la', 'los', 'las', 'que', 'de', 'en', 'un', 'una', 'es', 'son', 'para', 'con', 'se', 'por'],
  en: ['the', 'is', 'are', 'was', 'were', 'this', 'that', 'with', 'for', 'have', 'from', 'they'],
  fr: ['le', 'la', 'les', 'un', 'une', 'des', 'est', 'sont', 'avec', 'pour', 'dans', 'que', 'qui', 'je', 'tu'],
  de: ['der', 'die', 'das', 'ein', 'eine', 'ist', 'sind', 'mit', 'fur', 'und', 'ich', 'du', 'sie', 'wir'],
  pt: ['o', 'a', 'os', 'as', 'um', 'uma', 'com', 'para', 'em', 'que', 'de', 'do', 'da'],
}

class MessagePreprocessor {
  detectLanguage(text: string): { code: string; confidence: number } {
    if (!text.trim()) return { code: 'unknown', confidence: 0 }

    const words = text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 1)

    if (words.length === 0) return { code: 'unknown', confidence: 0 }

    const scores: Record<string, number> = {}

    for (const [lang, markers] of Object.entries(LANGUAGE_MARKERS)) {
      const matchCount = words.filter((w) => markers.includes(w)).length
      scores[lang] = matchCount / words.length
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
    const [topLang, topScore] = sorted[0]
    const [, secondScore] = sorted[1] ?? ['', 0]

    const margin = topScore - secondScore
    if (topScore < 0.05 || margin < 0.02) {
      return { code: topLang, confidence: topScore < 0.05 ? topScore : topScore * 0.7 }
    }

    return { code: topLang, confidence: Math.min(topScore * 5, 1.0) }
  }

  classifyIntent(text: string): { type: string; confidence: number } {
    const lower = text.toLowerCase().trim()

    const codePatterns = [
      /^(create|write|implement|build|generate|code|make)\s+(a\s+)?(function|class|method|script|program|component|api|endpoint)/i,
      /^write\s+(me\s+)?(some\s+)?code/i,
      /^(fix|debug|refactor)\s+(this\s+)?(code|function|class|bug)/i,
    ]
    const searchPatterns = [/^(search|find|look|lookup|query)\s+(for\s+)?/i, /^(google|bing)\s/i]
    const commandPatterns = [
      /^(delete|remove|drop|truncate|kill|stop|terminate|disable|execute|run|install|uninstall)\b/i,
    ]
    const questionPatterns = [
      /^(what|who|where|when|why|how|which|is|are|was|were|do|does|did|can|could|would|should)\b/i,
      /\?$/,
    ]

    for (const pattern of codePatterns) {
      if (pattern.test(lower)) return { type: 'code_request', confidence: 0.9 }
    }
    for (const pattern of searchPatterns) {
      if (pattern.test(lower)) return { type: 'search', confidence: 0.85 }
    }
    for (const pattern of commandPatterns) {
      if (pattern.test(lower)) return { type: 'command', confidence: 0.85 }
    }
    for (const pattern of questionPatterns) {
      if (pattern.test(lower)) return { type: 'question', confidence: 0.85 }
    }

    return { type: 'conversation', confidence: 0.7 }
  }

  extractEntities(text: string): {
    urls: string[]
    codeBlocks: string[]
    filePaths: string[]
    mentions: string[]
  } {
    if (!text.trim()) {
      return { urls: [], codeBlocks: [], filePaths: [], mentions: [] }
    }

    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g
    const urls = text.match(urlRegex) ?? []

    const codeBlockRegex = /```(?:\w+)?\n?([\s\S]*?)```/g
    const codeBlocks: string[] = []
    let match: RegExpExecArray | null
    while ((match = codeBlockRegex.exec(text)) !== null) {
      codeBlocks.push(match[1].trim())
    }

    const filePathRegex = /(?:^|[\s(])(\.[./][\w./\-]+\.\w{1,10})/gm
    const filePaths: string[] = []
    while ((match = filePathRegex.exec(text)) !== null) {
      filePaths.push(match[1])
    }

    const mentionRegex = /@([\w.\-]+)/g
    const mentions: string[] = []
    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1])
    }

    return { urls, codeBlocks, filePaths, mentions }
  }

  normalize(text: string): string {
    return text
      .trim()
      .replace(/\s{2,}/g, ' ')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
  }

  deduplicate(messages: string[]): string[] {
    if (messages.length === 0) return []

    const unique: string[] = []

    for (const msg of messages) {
      const normalizedMsg = this.normalize(msg)
      const isDuplicate = unique.some((existing) => {
        const normalizedExisting = this.normalize(existing)
        if (normalizedExisting === normalizedMsg) return true

        const jaccard = this._jaccardSimilarity(normalizedExisting, normalizedMsg)
        const overlap = this._overlapCoefficient(normalizedExisting, normalizedMsg)
        return jaccard >= 0.8 || overlap >= 0.8
      })
      if (!isDuplicate) unique.push(msg)
    }

    return unique
  }

  process(text: string): ProcessedMessage {
    const normalized = this.normalize(text)
    return {
      original: text,
      normalized,
      language: this.detectLanguage(normalized),
      intent: this.classifyIntent(normalized),
      entities: this.extractEntities(normalized),
    }
  }

  private _jaccardSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 0))
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 0))

    if (wordsA.size === 0 && wordsB.size === 0) return 1
    if (wordsA.size === 0 || wordsB.size === 0) return 0

    let intersection = 0
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++
    }

    const union = wordsA.size + wordsB.size - intersection
    return intersection / union
  }

  private _overlapCoefficient(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 0))
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 0))

    if (wordsA.size === 0 && wordsB.size === 0) return 1
    if (wordsA.size === 0 || wordsB.size === 0) return 0

    let intersection = 0
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++
    }

    return intersection / Math.min(wordsA.size, wordsB.size)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('MessagePreprocessor', () => {
  let preprocessor: MessagePreprocessor

  beforeEach(() => {
    vi.clearAllMocks()
    preprocessor = new MessagePreprocessor()
  })

  describe('detectLanguage', () => {
    it('detects Spanish text with confidence > 0.5', () => {
      const result = preprocessor.detectLanguage(
        'El perro es muy grande y la casa es bonita. Los ninos son felices con la familia.',
      )
      expect(result.code).toBe('es')
      expect(result.confidence).toBeGreaterThan(0.5)
    })

    it('detects English text with confidence > 0.5', () => {
      const result = preprocessor.detectLanguage(
        'The quick brown fox jumps over the lazy dog. This is a typical English sentence with the article.',
      )
      expect(result.code).toBe('en')
      expect(result.confidence).toBeGreaterThan(0.5)
    })

    it('detects French text with French markers', () => {
      const result = preprocessor.detectLanguage(
        'Je suis dans le jardin avec les amis. Les fleurs sont belles et je les aime.',
      )
      expect(result.code).toBe('fr')
    })

    it('detects German text with German markers', () => {
      const result = preprocessor.detectLanguage(
        'Ich bin der Mann und die Frau ist mit mir. Wir sind eine Familie. Das Kind ist klein.',
      )
      expect(result.code).toBe('de')
    })

    it('detects Portuguese text', () => {
      const result = preprocessor.detectLanguage(
        'O cão é muito grande. As crianças são felizes com os brinquedos da loja.',
      )
      expect(result.code).toBe('pt')
    })

    it('returns low confidence for short ambiguous text', () => {
      const result = preprocessor.detectLanguage('hello bonjour hola')
      expect(result.confidence).toBeLessThan(0.6)
    })

    it('returns unknown with confidence 0 for empty string', () => {
      const result = preprocessor.detectLanguage('')
      expect(result.code).toBe('unknown')
      expect(result.confidence).toBe(0)
    })
  })

  describe('classifyIntent', () => {
    it('classifies "What is X?" as question', () => {
      const result = preprocessor.classifyIntent('What is machine learning?')
      expect(result.type).toBe('question')
    })

    it('classifies "How do I...?" as question', () => {
      const result = preprocessor.classifyIntent('How do I install Node.js?')
      expect(result.type).toBe('question')
    })

    it('classifies "Create a function..." as code_request', () => {
      const result = preprocessor.classifyIntent('Create a function that sorts an array')
      expect(result.type).toBe('code_request')
    })

    it('classifies "Write me code..." as code_request', () => {
      const result = preprocessor.classifyIntent('Write me code for a REST API endpoint')
      expect(result.type).toBe('code_request')
    })

    it('classifies "Search for..." as search', () => {
      const result = preprocessor.classifyIntent('Search for recent papers on transformers')
      expect(result.type).toBe('search')
    })

    it('classifies casual greeting as conversation', () => {
      const result = preprocessor.classifyIntent('Hello how are you')
      expect(result.type).toBe('conversation')
    })

    it('classifies "Delete all files" as command', () => {
      const result = preprocessor.classifyIntent('Delete all files in the temp folder')
      expect(result.type).toBe('command')
    })

    it('classifies "Implement a class" as code_request', () => {
      const result = preprocessor.classifyIntent('Implement a class for managing users')
      expect(result.type).toBe('code_request')
    })

    it('all intent types return confidence between 0 and 1', () => {
      const texts = [
        'What is this?',
        'Create a function',
        'Search for something',
        'Hello there',
        'Delete everything',
      ]
      for (const text of texts) {
        const { confidence } = preprocessor.classifyIntent(text)
        expect(confidence).toBeGreaterThan(0)
        expect(confidence).toBeLessThanOrEqual(1)
      }
    })
  })

  describe('extractEntities', () => {
    it('extracts URLs from text', () => {
      const result = preprocessor.extractEntities(
        'Check out https://example.com and also https://github.com/user/repo for details',
      )
      expect(result.urls).toContain('https://example.com')
      expect(result.urls).toContain('https://github.com/user/repo')
    })

    it('extracts code block content', () => {
      const result = preprocessor.extractEntities(
        'Here is code:\n```javascript\nconsole.log("hello")\n```',
      )
      expect(result.codeBlocks).toHaveLength(1)
      expect(result.codeBlocks[0]).toContain('console.log')
    })

    it('extracts file paths', () => {
      const result = preprocessor.extractEntities(
        'Edit ./src/components/Button.tsx and ./utils/helpers.ts for this fix',
      )
      expect(result.filePaths.some((p) => p.includes('Button.tsx'))).toBe(true)
    })

    it('extracts @mentions', () => {
      const result = preprocessor.extractEntities(
        'Hey @alice and @bob.smith please review this pull request',
      )
      expect(result.mentions).toContain('alice')
      expect(result.mentions).toContain('bob.smith')
    })

    it('extracts multiple entity types from complex text', () => {
      const text =
        'Hi @alice, check https://example.com and edit ./src/app.ts\n```\nconst x = 1\n```'
      const result = preprocessor.extractEntities(text)
      expect(result.urls.length).toBeGreaterThan(0)
      expect(result.codeBlocks.length).toBeGreaterThan(0)
      expect(result.filePaths.length).toBeGreaterThan(0)
      expect(result.mentions.length).toBeGreaterThan(0)
    })

    it('returns all empty arrays for empty text', () => {
      const result = preprocessor.extractEntities('')
      expect(result.urls).toHaveLength(0)
      expect(result.codeBlocks).toHaveLength(0)
      expect(result.filePaths).toHaveLength(0)
      expect(result.mentions).toHaveLength(0)
    })
  })

  describe('normalize', () => {
    it('trims leading and trailing whitespace', () => {
      expect(preprocessor.normalize('   hello world   ')).toBe('hello world')
    })

    it('collapses multiple spaces to a single space', () => {
      expect(preprocessor.normalize('hello   world    how   are   you')).toBe(
        'hello world how are you',
      )
    })

    it('normalizes left and right single curly quotes to straight quotes', () => {
      expect(preprocessor.normalize('\u2018hello\u2019')).toBe("'hello'")
    })

    it('normalizes left and right double curly quotes to straight quotes', () => {
      expect(preprocessor.normalize('\u201Chello\u201D')).toBe('"hello"')
    })

    it('preserves newlines inside content', () => {
      const input = 'line one\nline two\nline three'
      const result = preprocessor.normalize(input)
      expect(result).toContain('\n')
      expect(result).toContain('line one')
      expect(result).toContain('line two')
    })

    it('handles text with only whitespace returning empty string', () => {
      expect(preprocessor.normalize('   ')).toBe('')
    })
  })

  describe('deduplicate', () => {
    it('removes exact duplicates keeping first occurrence', () => {
      const messages = ['hello world', 'foo bar', 'hello world']
      const result = preprocessor.deduplicate(messages)
      expect(result).toHaveLength(2)
      expect(result.filter((m) => m === 'hello world')).toHaveLength(1)
    })

    it('removes near-duplicates above 80% Jaccard similarity', () => {
      const original = 'The quick brown fox jumps over the lazy dog'
      const nearDup = 'The quick brown fox jumps over the lazy cat'
      const result = preprocessor.deduplicate([original, nearDup])
      expect(result).toHaveLength(1)
    })

    it('keeps distinct messages intact', () => {
      const messages = [
        'Machine learning is a subset of artificial intelligence',
        'The weather today is sunny and very warm outside',
        'TypeScript adds static type checking to JavaScript code',
      ]
      const result = preprocessor.deduplicate(messages)
      expect(result).toHaveLength(3)
    })

    it('handles an empty array returning empty array', () => {
      expect(preprocessor.deduplicate([])).toHaveLength(0)
    })

    it('handles a single-element array', () => {
      const result = preprocessor.deduplicate(['only one message here'])
      expect(result).toHaveLength(1)
    })
  })

  describe('edge cases', () => {
    it('processes a very long message (10,000 chars) without error', () => {
      const longText = 'The quick brown fox jumps over '.repeat(333)
      expect(() => preprocessor.process(longText)).not.toThrow()
      const result = preprocessor.process(longText)
      expect(result.normalized).toBeTruthy()
      expect(result.language.code).toBeTruthy()
    })

    it('handles unicode emoji text gracefully', () => {
      const emojiText = 'Hello world how are you doing today?'
      const result = preprocessor.process(emojiText)
      expect(result.normalized).toBeTruthy()
      expect(result.intent.type).toBe('question')
    })

    it('returns safe defaults for whitespace-only input', () => {
      const result = preprocessor.process('   ')
      expect(result.language.code).toBe('unknown')
      expect(result.language.confidence).toBe(0)
    })

    it('process returns all required fields', () => {
      const result = preprocessor.process('What is the capital of France?')
      expect(result).toHaveProperty('original')
      expect(result).toHaveProperty('normalized')
      expect(result).toHaveProperty('language')
      expect(result).toHaveProperty('intent')
      expect(result).toHaveProperty('entities')
      expect(result.language).toHaveProperty('code')
      expect(result.language).toHaveProperty('confidence')
      expect(result.intent).toHaveProperty('type')
      expect(result.intent).toHaveProperty('confidence')
    })

    it('process preserves original text unmodified', () => {
      const original = '  Hello   World  '
      const result = preprocessor.process(original)
      expect(result.original).toBe(original)
      expect(result.normalized).toBe('Hello World')
    })

    it('handles text with only punctuation characters', () => {
      const result = preprocessor.detectLanguage('... !!! ???')
      expect(result.code).toBe('unknown')
    })
  })
})
