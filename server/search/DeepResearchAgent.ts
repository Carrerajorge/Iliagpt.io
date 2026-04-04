import { Logger } from "../lib/logger"
import { llmGateway } from "../lib/llmGateway"
import { multiSearchProvider } from "./MultiSearchProvider"
import { webScraper } from "./WebScraperRobust"

export interface ResearchTask {
  question: string
  depth: 1 | 2 | 3
  maxSources?: number
  userId?: string
  onProgress?: (event: ProgressEvent) => void
}

export interface SourceInfo {
  url: string
  title: string
  domain: string
  publishedAt?: string
}

export interface ExtractedFact {
  fact: string
  source: string
  confidence: number
  supportedBy: string[]
}

export interface ResearchResult {
  question: string
  answer: string
  confidence: number
  sources: SourceInfo[]
  facts: ExtractedFact[]
  relatedQuestions: string[]
  searchQueriesUsed: string[]
  processingTimeMs: number
}

export type ProgressEvent =
  | { type: "searching"; query: string; step: number; totalSteps: number }
  | { type: "reading"; url: string; title: string }
  | { type: "extracting"; url: string; factsFound: number }
  | { type: "synthesizing"; factsTotal: number }
  | { type: "complete"; result: ResearchResult }

const DEPTH_CONFIG: Record<number, { searches: number; maxSources: number }> = {
  1: { searches: 3, maxSources: 3 },
  2: { searches: 8, maxSources: 6 },
  3: { searches: 15, maxSources: 10 },
}

const PAGE_TIMEOUT_MS = 30000

class DeepResearchAgent {
  async research(task: ResearchTask): Promise<ResearchResult> {
    const startTime = Date.now()
    const { question, depth, maxSources, userId, onProgress } = task
    const config = DEPTH_CONFIG[depth]
    const sourceCap = maxSources ?? config.maxSources

    Logger.info("[DeepResearch] Starting research", { question, depth })

    // Step 1: Generate search queries
    const queries = await this.generateSearchQueries(question, config.searches)
    Logger.info("[DeepResearch] Generated queries", { count: queries.length })

    // Step 2: Execute searches
    const allUrls: string[] = []
    const seenUrls = new Set<string>()

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i]
      onProgress?.({ type: "searching", query, step: i + 1, totalSteps: queries.length })

      try {
        const results = await multiSearchProvider.search({
          query,
          maxResults: Math.ceil(sourceCap / queries.length) + 2,
        })
        for (const r of results) {
          if (!seenUrls.has(r.url)) {
            seenUrls.add(r.url)
            allUrls.push(r.url)
          }
        }
      } catch (err: any) {
        Logger.warn("[DeepResearch] Search failed for query", { query, error: err?.message })
      }
    }

    // Step 3: Read pages and extract facts
    const urlsToRead = allUrls.slice(0, sourceCap)
    const allFacts: ExtractedFact[] = []
    const sources: SourceInfo[] = []

    for (const url of urlsToRead) {
      let title = url
      try {
        onProgress?.({ type: "reading", url, title })

        const pagePromise = webScraper.scrape(url, { timeout: PAGE_TIMEOUT_MS, useCache: true })
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Page read timeout")), PAGE_TIMEOUT_MS)
        )

        const page = await Promise.race([pagePromise, timeoutPromise])
        title = page.title

        onProgress?.({ type: "reading", url, title })

        // Truncate content to avoid LLM token limits (~6000 words)
        const contentForExtraction = page.content.slice(0, 24000)

        const facts = await this.extractFacts(url, contentForExtraction, question)
        onProgress?.({ type: "extracting", url, factsFound: facts.length })

        allFacts.push(...facts)
        sources.push({
          url,
          title: page.title,
          domain: (() => { try { return new URL(url).hostname.replace(/^www\./, "") } catch { return url } })(),
          publishedAt: page.publishedAt,
        })
      } catch (err: any) {
        Logger.warn("[DeepResearch] Failed to process URL", { url, error: err?.message })
      }
    }

    // Step 4: Cross-reference facts
    const crossReferenced = await this.crossReference(allFacts)
    onProgress?.({ type: "synthesizing", factsTotal: crossReferenced.length })

    // Step 5: Synthesize answer
    const answer = await this.synthesize(question, crossReferenced, sources)

    // Step 6: Generate related questions
    const relatedQuestions = await this.generateRelatedQuestions(question, answer)

    // Calculate confidence based on fact corroboration
    const avgConfidence = crossReferenced.length > 0
      ? crossReferenced.reduce((sum, f) => sum + f.confidence, 0) / crossReferenced.length
      : 0

    const result: ResearchResult = {
      question,
      answer,
      confidence: Math.min(avgConfidence, 1),
      sources,
      facts: crossReferenced,
      relatedQuestions,
      searchQueriesUsed: queries,
      processingTimeMs: Date.now() - startTime,
    }

    onProgress?.({ type: "complete", result })
    Logger.info("[DeepResearch] Research complete", {
      question,
      sourcesRead: sources.length,
      factsExtracted: crossReferenced.length,
      processingTimeMs: result.processingTimeMs,
    })

    return result
  }

  private async generateSearchQueries(question: string, count: number): Promise<string[]> {
    try {
      const messages = [
        {
          role: "user" as const,
          content: `Generate ${count} different search queries to thoroughly research this question: "${question}"

Requirements:
- Each query should approach the topic from a different angle
- Include specific technical terms, general terms, and related concepts
- Vary the phrasing (some specific, some broad)
- Output ONLY a JSON array of strings, no other text

Example output: ["query 1", "query 2", "query 3"]`,
        },
      ]

      const response = await (llmGateway as any).chat(messages, { maxTokens: 500, temperature: 0.7 })
      const content = typeof response === "string" ? response : response?.content ?? ""

      const jsonMatch = content.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed)) {
          return parsed.slice(0, count).map(String)
        }
      }
    } catch (err: any) {
      Logger.warn("[DeepResearch] Query generation failed", { error: err?.message })
    }

    // Fallback: generate simple variations
    return [
      question,
      `${question} overview`,
      `${question} research`,
      `${question} explained`,
      `${question} analysis`,
    ].slice(0, count)
  }

  private async extractFacts(url: string, content: string, question: string): Promise<ExtractedFact[]> {
    if (!content || content.length < 50) return []

    try {
      const messages = [
        {
          role: "user" as const,
          content: `Extract key facts relevant to this question from the content below.

Question: "${question}"

Content from ${url}:
${content.slice(0, 8000)}

Extract facts as a JSON array. Each fact should be a concise, specific statement.
Output ONLY valid JSON array, no other text:
[
  { "fact": "specific fact statement", "confidence": 0.9 },
  ...
]

Confidence: 0.9=directly stated, 0.7=implied, 0.5=tangentially related.
Include only facts relevant to the question. Maximum 10 facts.`,
        },
      ]

      const response = await (llmGateway as any).chat(messages, { maxTokens: 800, temperature: 0.3 })
      const content2 = typeof response === "string" ? response : response?.content ?? ""

      const jsonMatch = content2.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed)) {
          return parsed.slice(0, 10).map((f: any) => ({
            fact: String(f.fact ?? ""),
            source: url,
            confidence: Number(f.confidence ?? 0.7),
            supportedBy: [],
          })).filter((f) => f.fact.length > 0)
        }
      }
    } catch (err: any) {
      Logger.warn("[DeepResearch] Fact extraction failed", { url, error: err?.message })
    }

    return []
  }

  private async crossReference(facts: ExtractedFact[]): Promise<ExtractedFact[]> {
    if (facts.length === 0) return []

    // Group similar facts using simple text similarity
    const groups: ExtractedFact[][] = []
    const assigned = new Set<number>()

    for (let i = 0; i < facts.length; i++) {
      if (assigned.has(i)) continue
      const group: ExtractedFact[] = [facts[i]]
      assigned.add(i)

      for (let j = i + 1; j < facts.length; j++) {
        if (assigned.has(j)) continue
        if (this.textSimilarity(facts[i].fact, facts[j].fact) > 0.5) {
          group.push(facts[j])
          assigned.add(j)
        }
      }

      groups.push(group)
    }

    // For each group, produce a merged fact with boosted confidence
    return groups.map((group) => {
      const sources = [...new Set(group.map((f) => f.source))]
      const bestFact = group.reduce((best, f) => f.confidence > best.confidence ? f : best)
      const supportedBy = sources.filter((s) => s !== bestFact.source)
      const confidenceBoost = Math.min(0.1 * (sources.length - 1), 0.3)

      return {
        ...bestFact,
        confidence: Math.min(bestFact.confidence + confidenceBoost, 1.0),
        supportedBy,
      }
    }).sort((a, b) => b.confidence - a.confidence)
  }

  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 3))
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 3))
    if (wordsA.size === 0 || wordsB.size === 0) return 0
    let overlap = 0
    for (const w of wordsA) { if (wordsB.has(w)) overlap++ }
    return overlap / Math.max(wordsA.size, wordsB.size)
  }

  private async synthesize(question: string, facts: ExtractedFact[], sources: SourceInfo[]): Promise<string> {
    if (facts.length === 0) {
      return "Insufficient information was found to answer this question comprehensively."
    }

    const factsText = facts
      .slice(0, 30)
      .map((f, i) => `[${i + 1}] ${f.fact} (confidence: ${(f.confidence * 100).toFixed(0)}%, source: ${f.source})`)
      .join("\n")

    const sourcesText = sources
      .map((s, i) => `[${i + 1}] ${s.title} - ${s.url}`)
      .join("\n")

    try {
      const messages = [
        {
          role: "user" as const,
          content: `Write a comprehensive, well-structured answer to this question using the extracted facts below.

Question: "${question}"

Extracted Facts:
${factsText}

Sources:
${sourcesText}

Instructions:
- Synthesize the facts into a coherent, flowing answer
- Use inline citations like [1], [2] etc. referring to the fact numbers
- Be accurate and don't extrapolate beyond the facts provided
- Structure the answer with clear paragraphs
- Acknowledge any uncertainty or conflicting information
- Length: 200-500 words depending on complexity`,
        },
      ]

      const response = await (llmGateway as any).chat(messages, { maxTokens: 1200, temperature: 0.4 })
      return typeof response === "string" ? response : response?.content ?? "Unable to synthesize answer."
    } catch (err: any) {
      Logger.error("[DeepResearch] Synthesis failed", err)
      // Fallback: concatenate top facts
      return facts.slice(0, 5).map((f) => f.fact).join(" ")
    }
  }

  private async generateRelatedQuestions(question: string, answer: string): Promise<string[]> {
    try {
      const messages = [
        {
          role: "user" as const,
          content: `Based on this question and answer, generate 5 related follow-up questions that would help explore the topic further.

Question: "${question}"
Answer summary: "${answer.slice(0, 500)}"

Output ONLY a JSON array of 5 question strings, no other text.`,
        },
      ]

      const response = await (llmGateway as any).chat(messages, { maxTokens: 400, temperature: 0.8 })
      const content = typeof response === "string" ? response : response?.content ?? ""

      const jsonMatch = content.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed)) return parsed.slice(0, 5).map(String)
      }
    } catch (err: any) {
      Logger.warn("[DeepResearch] Related questions generation failed", { error: err?.message })
    }

    return []
  }
}

export const deepResearchAgent = new DeepResearchAgent()
