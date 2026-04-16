/**
 * ClientSideInference — ILIAGPT client-side ML intelligence layer
 * Uses @xenova/transformers via dynamic import with full heuristic fallbacks.
 */

export interface InferenceCapabilities {
  sentiment: boolean
  languageDetection: boolean
  intentClassification: boolean
  embeddings: boolean
  typingPrediction: boolean
}

export interface SentimentResult {
  label: 'positive' | 'negative' | 'neutral'
  score: number
}

export interface LanguageResult {
  language: string
  confidence: number
  name: string
}

export type IntentLabel =
  | 'question'
  | 'command'
  | 'creative'
  | 'code'
  | 'analysis'
  | 'conversation'
  | 'search'

export interface IntentResult {
  intent: IntentLabel
  confidence: number
  suggestedModel?: string
  suggestedSlashCommand?: string
}

export interface TypingPrediction {
  completions: string[]
  confidence: number
}

// ---------------------------------------------------------------------------
// Language metadata
// ---------------------------------------------------------------------------

const LANGUAGE_META: Record<string, { name: string }> = {
  en: { name: 'English' },
  es: { name: 'Spanish' },
  fr: { name: 'French' },
  de: { name: 'German' },
  pt: { name: 'Portuguese' },
  zh: { name: 'Chinese' },
  ja: { name: 'Japanese' },
  ar: { name: 'Arabic' },
}

// ---------------------------------------------------------------------------
// Heuristic helpers
// ---------------------------------------------------------------------------

const POSITIVE_KEYWORDS = new Set([
  'great', 'love', 'excellent', 'perfect', 'good', 'happy',
  'awesome', 'amazing', 'wonderful', 'fantastic', 'nice', 'best',
])

const NEGATIVE_KEYWORDS = new Set([
  'bad', 'terrible', 'hate', 'awful', 'error', 'bug',
  'broken', 'wrong', 'fail', 'failure', 'crash', 'issue', 'worst',
])

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/\b\w+\b/g) ?? []
}

function heuristicSentiment(text: string): SentimentResult {
  const words = tokenize(text)
  let pos = 0
  let neg = 0
  for (const w of words) {
    if (POSITIVE_KEYWORDS.has(w)) pos++
    if (NEGATIVE_KEYWORDS.has(w)) neg++
  }
  if (pos === 0 && neg === 0) return { label: 'neutral', score: 0.5 }
  if (pos > neg) return { label: 'positive', score: Math.min(1, 0.5 + pos * 0.1) }
  if (neg > pos) return { label: 'negative', score: Math.min(1, 0.5 + neg * 0.1) }
  return { label: 'neutral', score: 0.5 }
}

function heuristicLanguage(text: string): LanguageResult {
  // Chinese — CJK Unified Ideographs
  if (/[\u4E00-\u9FFF]/.test(text)) {
    return { language: 'zh', confidence: 0.95, name: 'Chinese' }
  }
  // Japanese — Hiragana / Katakana
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) {
    return { language: 'ja', confidence: 0.95, name: 'Japanese' }
  }
  // Arabic
  if (/[\u0600-\u06FF]/.test(text)) {
    return { language: 'ar', confidence: 0.95, name: 'Arabic' }
  }

  const lower = text.toLowerCase()
  const words = new Set(tokenize(text))

  // German — distinctive characters + function words
  const deChars = /[äöüß]/i.test(text)
  const deWords = ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'sie'].filter(w => words.has(w)).length
  const deScore = (deChars ? 2 : 0) + deWords

  // French
  const frChars = /[àâçèêëîïôùûü]/i.test(text)
  const frWords = ['le', 'la', 'les', 'un', 'une', 'et', 'est', 'je', 'tu'].filter(w => words.has(w)).length
  const frScore = (frChars ? 2 : 0) + frWords

  // Spanish
  const esChars = /[¿¡ñáéíóúü]/i.test(text) || lower.includes('¿') || lower.includes('¡')
  const esWords = ['es', 'la', 'el', 'de', 'que', 'y', 'en', 'un', 'una', 'los', 'las'].filter(w => words.has(w)).length
  const esScore = (esChars ? 3 : 0) + esWords

  // Portuguese
  const ptChars = /[ãõçáéíóú]/i.test(text)
  const ptWords = ['de', 'da', 'do', 'em', 'para', 'com', 'uma', 'um', 'não'].filter(w => words.has(w)).length
  const ptScore = (ptChars ? 2 : 0) + ptWords

  const scores: Array<[string, number]> = [
    ['de', deScore],
    ['fr', frScore],
    ['es', esScore],
    ['pt', ptScore],
  ]

  scores.sort((a, b) => b[1] - a[1])
  const [lang, score] = scores[0]

  if (score >= 3) {
    return {
      language: lang,
      confidence: Math.min(0.95, 0.5 + score * 0.08),
      name: LANGUAGE_META[lang]?.name ?? lang,
    }
  }

  return { language: 'en', confidence: 0.7, name: 'English' }
}

const INTENT_PATTERNS: Array<{
  intent: IntentLabel
  test: (lower: string, words: string[]) => boolean
  confidence: number
  command?: string
}> = [
  {
    intent: 'code',
    test: (l, w) =>
      /```/.test(l) ||
      /\b(function|def|class|const|let|var|import|export|return|async|await|=>)\b/.test(l) ||
      /(write a|implement|create a|build a|code for|code that|snippet|algorithm)\b/.test(l) ||
      w.includes('typescript') || w.includes('javascript') || w.includes('python') || w.includes('rust'),
    confidence: 0.85,
    command: '/code',
  },
  {
    intent: 'creative',
    test: (l) =>
      /^(write|create|generate|compose|draft)\s.*(story|poem|essay|article|blog|narrative|fiction|script|song|lyrics|letter)/i.test(l),
    confidence: 0.85,
    command: '/creative',
  },
  {
    intent: 'analysis',
    test: (l) =>
      /\b(analyze|analyse|compare|evaluate|assess|review|examine|investigate|study)\b/.test(l),
    confidence: 0.8,
    command: '/analyze',
  },
  {
    intent: 'search',
    test: (l) =>
      /\b(find|search|look up|latest|current|recent|news|what is the)\b/.test(l),
    confidence: 0.75,
    command: '/research',
  },
  {
    intent: 'question',
    test: (l, w) =>
      l.trimEnd().endsWith('?') ||
      /^(what|why|how|when|where|who|which|is|are|was|were|can|could|should|would|do|does|did|has|have|had)\b/.test(l),
    confidence: 0.8,
  },
  {
    intent: 'command',
    test: (l) =>
      /^(show|tell|list|give|make|set|run|execute|start|stop|open|close|delete|remove|add|update|change|fix|help)\b/.test(l),
    confidence: 0.7,
  },
]

function heuristicIntent(text: string): IntentResult {
  const lower = text.toLowerCase().trim()
  const words = tokenize(text)

  for (const pattern of INTENT_PATTERNS) {
    if (pattern.test(lower, words)) {
      return {
        intent: pattern.intent,
        confidence: pattern.confidence,
        suggestedSlashCommand: pattern.command,
      }
    }
  }

  return { intent: 'conversation', confidence: 0.6 }
}

// Deterministic hash-based 384-dim embedding fallback
async function hashEmbedding(text: string): Promise<number[]> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  const dim = 384
  const vec = new Array<number>(dim).fill(0)

  // Spread 32 bytes across 384 dimensions with deterministic noise
  for (let i = 0; i < dim; i++) {
    const byteIndex = i % hashArray.length
    const phase = (i * 2.399963) % (2 * Math.PI) // golden-angle spacing
    vec[i] = (hashArray[byteIndex] / 255) * Math.cos(phase)
  }

  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map(v => v / norm)
}

// ---------------------------------------------------------------------------
// Offline Q&A cache
// ---------------------------------------------------------------------------

const OFFLINE_QA: Array<{ q: string; a: string; keywords: string[] }> = [
  {
    q: 'what is iliagpt',
    a: 'IliaGPT is an advanced AI assistant platform that supports multiple LLM providers, voice interaction, document analysis, and agent-based task execution.',
    keywords: ['iliagpt', 'what is'],
  },
  {
    q: 'hello',
    a: 'Hello! How can I help you today?',
    keywords: ['hello', 'hi', 'hey', 'good morning', 'good afternoon'],
  },
  {
    q: 'how are you',
    a: "I'm doing well, thanks for asking! Ready to help you.",
    keywords: ['how are you', 'how r u'],
  },
  {
    q: 'what can you do',
    a: 'I can answer questions, write code, analyze documents, search the web, generate creative content, and much more.',
    keywords: ['what can you do', 'capabilities', 'features'],
  },
  {
    q: 'voice mode',
    a: 'IliaGPT supports voice input and output. Click the microphone icon to start speaking, or use the voice mode button in settings.',
    keywords: ['voice', 'speak', 'microphone', 'speech'],
  },
  {
    q: 'slash commands',
    a: 'Type "/" to see available slash commands like /deep, /code, /research, /creative, /analyze, and more.',
    keywords: ['slash', 'commands', '/'],
  },
  {
    q: 'how to upload file',
    a: 'Drag and drop a file onto the chat window, or click the attachment icon in the input area.',
    keywords: ['upload', 'file', 'attach', 'document', 'pdf'],
  },
  {
    q: 'agent mode',
    a: 'Agent mode enables IliaGPT to autonomously break down complex tasks into steps and execute them using tools like web search, code execution, and memory.',
    keywords: ['agent', 'autonomous', 'agent mode'],
  },
  {
    q: 'models supported',
    a: 'IliaGPT supports Claude, GPT-4, Gemini, and other major language models. Select your preferred model in the settings.',
    keywords: ['model', 'models', 'gpt', 'claude', 'gemini', 'which model'],
  },
  {
    q: 'thank you',
    a: "You're welcome! Let me know if there's anything else I can help with.",
    keywords: ['thank you', 'thanks', 'gracias', 'merci'],
  },
  {
    q: 'what is 2 plus 2',
    a: '2 + 2 = 4',
    keywords: ['2 + 2', '2+2', 'two plus two'],
  },
  {
    q: 'what is 1 plus 1',
    a: '1 + 1 = 2',
    keywords: ['1 + 1', '1+1', 'one plus one'],
  },
  {
    q: 'dark mode',
    a: 'Toggle dark mode from the settings panel or the theme icon in the top navigation bar.',
    keywords: ['dark mode', 'theme', 'dark', 'light mode'],
  },
  {
    q: 'keyboard shortcuts',
    a: 'Press Ctrl+K (or Cmd+K on Mac) to open the command palette. Use Enter to send, Shift+Enter for new line.',
    keywords: ['keyboard', 'shortcut', 'hotkey'],
  },
  {
    q: 'memory',
    a: 'IliaGPT has long-term memory that stores important context from your conversations for future reference.',
    keywords: ['memory', 'remember', 'forget'],
  },
  {
    q: 'export chat',
    a: 'You can export your chat history as Markdown or PDF from the chat menu (three dots icon).',
    keywords: ['export', 'download', 'save chat'],
  },
  {
    q: 'projects',
    a: 'Projects let you organize conversations and documents into workspaces for better focus and context management.',
    keywords: ['project', 'projects', 'workspace'],
  },
  {
    q: 'offline',
    a: 'IliaGPT has limited offline functionality including cached responses and queued messages that sync when you reconnect.',
    keywords: ['offline', 'no internet', 'without internet'],
  },
  {
    q: 'billing',
    a: 'Manage your subscription and billing from the account settings page.',
    keywords: ['billing', 'subscription', 'price', 'cost', 'plan'],
  },
  {
    q: 'privacy',
    a: 'IliaGPT takes your privacy seriously. Conversations are encrypted and you can delete your data at any time from settings.',
    keywords: ['privacy', 'data', 'secure', 'security'],
  },
]

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

class ClientSideInference {
  private capabilities: InferenceCapabilities = {
    sentiment: false,
    languageDetection: true, // heuristic always available
    intentClassification: true, // heuristic always available
    embeddings: false,
    typingPrediction: true,
  }

  private pipelineFactory: ((task: string, model: string) => Promise<any>) | null = null
  private sentimentPipeline: any = null
  private embeddingPipeline: any = null
  private initialized = false
  private initPromise: Promise<void> | null = null
  private offlineCache: Map<string, string> = new Map()

  constructor() {
    this.buildOfflineCache()
  }

  async initialize(): Promise<InferenceCapabilities> {
    if (this.initialized) return this.capabilities
    if (this.initPromise) {
      await this.initPromise
      return this.capabilities
    }

    this.initPromise = (async () => {
      try {
        const transformers = await import('@xenova/transformers' as any)
        this.pipelineFactory = transformers.pipeline
        this.capabilities.sentiment = true
        this.capabilities.embeddings = true
      } catch {
        // Transformers.js not available — heuristic fallbacks will be used
        this.pipelineFactory = null
        this.capabilities.sentiment = false
        this.capabilities.embeddings = false
      }
      this.initialized = true
    })()

    await this.initPromise
    return this.capabilities
  }

  async analyzeSentiment(text: string): Promise<SentimentResult> {
    if (!this.initialized) await this.initialize()

    if (this.pipelineFactory && this.capabilities.sentiment) {
      try {
        if (!this.sentimentPipeline) {
          this.sentimentPipeline = await this.pipelineFactory(
            'sentiment-analysis',
            'Xenova/distilbert-base-uncased-finetuned-sst-2-english'
          )
        }
        const result = await this.sentimentPipeline(text.slice(0, 512))
        const raw = Array.isArray(result) ? result[0] : result
        const label = (raw.label as string).toLowerCase()
        return {
          label: label === 'positive' ? 'positive' : label === 'negative' ? 'negative' : 'neutral',
          score: raw.score as number,
        }
      } catch {
        // Fall through to heuristic
      }
    }

    return heuristicSentiment(text)
  }

  async detectLanguage(text: string): Promise<LanguageResult> {
    // Heuristic is accurate enough and doesn't need a model
    return heuristicLanguage(text)
  }

  async classifyIntent(text: string): Promise<IntentResult> {
    return heuristicIntent(text)
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.initialized) await this.initialize()

    if (this.pipelineFactory && this.capabilities.embeddings) {
      try {
        if (!this.embeddingPipeline) {
          this.embeddingPipeline = await this.pipelineFactory(
            'feature-extraction',
            'Xenova/all-MiniLM-L6-v2'
          )
        }
        const output = await this.embeddingPipeline(text.slice(0, 512), {
          pooling: 'mean',
          normalize: true,
        })
        // output.data is a Float32Array
        return Array.from(output.data as Float32Array)
      } catch {
        // Fall through to hash fallback
      }
    }

    return hashEmbedding(text)
  }

  async predictTyping(text: string, cursorPosition: number): Promise<TypingPrediction> {
    const beforeCursor = text.slice(0, cursorPosition).trimEnd()
    const lower = beforeCursor.toLowerCase()

    // Slash command completions
    if (beforeCursor.trimStart().startsWith('/')) {
      const partial = beforeCursor.trimStart().slice(1).toLowerCase()
      const commands = [
        '/deep', '/quick', '/code', '/research', '/creative',
        '/analyze', '/summarize', '/translate', '/explain', '/compare',
      ]
      const matches = commands
        .filter(c => c.slice(1).startsWith(partial) && c.slice(1) !== partial)
        .slice(0, 3)
      if (matches.length) {
        return { completions: matches, confidence: 0.9 }
      }
    }

    // Common phrase completions
    const PHRASE_COMPLETIONS: Array<{ pattern: RegExp; completions: string[] }> = [
      { pattern: /how do i\s*$/i, completions: ['solve this', 'implement this', 'fix this issue'] },
      { pattern: /what is\s*$/i, completions: ['the difference between', 'the best way to', 'a good approach for'] },
      { pattern: /can you\s*$/i, completions: ['help me with', 'explain how to', 'write a'] },
      { pattern: /write a\s*$/i, completions: ['function that', 'component for', 'script to'] },
      { pattern: /explain\s*$/i, completions: ['how this works', 'the concept of', 'the difference between'] },
      { pattern: /create a\s*$/i, completions: ['React component', 'TypeScript interface', 'utility function'] },
      { pattern: /analyze\s*$/i, completions: ['this code', 'the following data', 'the performance of'] },
      { pattern: /compare\s*$/i, completions: ['these two approaches', 'the pros and cons of', 'the performance of'] },
      { pattern: /help me\s*$/i, completions: ['understand', 'implement', 'debug'] },
      { pattern: /generate\s*$/i, completions: ['a summary of', 'test cases for', 'documentation for'] },
    ]

    for (const { pattern, completions } of PHRASE_COMPLETIONS) {
      if (pattern.test(lower)) {
        return { completions: completions.slice(0, 3), confidence: 0.75 }
      }
    }

    // Last word completion for common starters
    const lastWord = lower.split(/\s+/).pop() ?? ''
    const WORD_COMPLETIONS: Record<string, string[]> = {
      'wh': ['what is', 'why does', 'how do I'],
      'ho': ['how do I', 'how can I', 'how does'],
      'wha': ['what is the', 'what are the', 'what does'],
      'why': ['why does this', 'why is it', 'why should I'],
      'imp': ['implement', 'improve', 'import'],
    }

    if (lastWord.length >= 2 && WORD_COMPLETIONS[lastWord]) {
      return { completions: WORD_COMPLETIONS[lastWord].slice(0, 3), confidence: 0.6 }
    }

    return { completions: [], confidence: 0 }
  }

  shouldUseServer(text: string, intent: IntentResult): boolean {
    const lower = text.toLowerCase().trim()

    // Simple greetings
    if (/^(hello|hi|hey|good morning|good afternoon|good evening|thanks|thank you|bye|goodbye)[\s!.]*$/.test(lower)) {
      return false
    }

    // Check offline cache
    if (this.tryOfflineCacheSync(lower) !== null) return false

    // Everything else goes to server
    return true
  }

  getCapabilities(): InferenceCapabilities {
    return { ...this.capabilities }
  }

  private buildOfflineCache(): void {
    for (const entry of OFFLINE_QA) {
      this.offlineCache.set(entry.q, entry.a)
      for (const kw of entry.keywords) {
        this.offlineCache.set(kw, entry.a)
      }
    }
  }

  private tryOfflineCacheSync(query: string): string | null {
    const lower = query.toLowerCase().trim()

    // Exact match
    if (this.offlineCache.has(lower)) return this.offlineCache.get(lower)!

    // Keyword match
    for (const [key, answer] of this.offlineCache.entries()) {
      if (lower.includes(key) || key.includes(lower)) return answer
    }

    return null
  }

  async tryOfflineAnswer(query: string): Promise<string | null> {
    return this.tryOfflineCacheSync(query)
  }
}

export const clientSideInference = new ClientSideInference()
