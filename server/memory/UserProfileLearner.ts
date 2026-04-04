/**
 * UserProfileLearner — learns user preferences, expertise, and style from conversations.
 * Profiles are cached in Redis and rebuilt from memory entries when missing.
 */

import { redis } from "../lib/redis"
import { llmGateway } from "../lib/llmGateway"
import { Logger } from "../lib/logger"
import { pgVectorMemoryStore } from "./PgVectorMemoryStore"

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ExpertiseMap {
  programming: { level: number; languages: string[] }
  science: { level: number; fields: string[] }
  business: { level: number; areas: string[] }
  creative: { level: number; domains: string[] }
  general: number
}

export interface ImplicitSignal {
  type:
    | "follow_up_question"
    | "correction"
    | "appreciation"
    | "complaint"
    | "confusion"
  context: string
  timestamp: Date
  weight: number
}

export interface UserProfile {
  userId: string
  expertise: ExpertiseMap
  communicationStyle: {
    preferredLength: "concise" | "detailed" | "adaptive"
    technicalLevel: 1 | 2 | 3 | 4 | 5
    preferredFormat: "prose" | "bullets" | "code" | "mixed"
    tone: "formal" | "casual" | "friendly"
  }
  topicInterests: Array<{ topic: string; weight: number; lastMentioned: Date }>
  explicitPreferences: Record<string, string>
  implicitSignals: ImplicitSignal[]
  updatedAt: Date
}

type PartialProfile = Partial<Omit<UserProfile, "userId" | "updatedAt">>

// ─── Defaults ─────────────────────────────────────────────────────────────────

function defaultProfile(userId: string): UserProfile {
  return {
    userId,
    expertise: {
      programming: { level: 3, languages: [] },
      science: { level: 2, fields: [] },
      business: { level: 2, areas: [] },
      creative: { level: 2, domains: [] },
      general: 3,
    },
    communicationStyle: {
      preferredLength: "adaptive",
      technicalLevel: 3,
      preferredFormat: "mixed",
      tone: "friendly",
    },
    topicInterests: [],
    explicitPreferences: {},
    implicitSignals: [],
    updatedAt: new Date(),
  }
}

// ─── Keys ─────────────────────────────────────────────────────────────────────

const PROFILE_KEY = (userId: string) => `user_profile:v2:${userId}`
const PROFILE_TTL = 60 * 60 * 24 * 7 // 7 days

// ─── Class ────────────────────────────────────────────────────────────────────

class UserProfileLearner {
  // ── getProfile ───────────────────────────────────────────────────────────────

  async getProfile(userId: string): Promise<UserProfile> {
    try {
      const cached = await redis.get(PROFILE_KEY(userId))
      if (cached) {
        const parsed = JSON.parse(cached) as UserProfile
        // Rehydrate Date fields
        parsed.updatedAt = new Date(parsed.updatedAt)
        parsed.topicInterests = parsed.topicInterests.map((t) => ({
          ...t,
          lastMentioned: new Date(t.lastMentioned),
        }))
        parsed.implicitSignals = parsed.implicitSignals.map((s) => ({
          ...s,
          timestamp: new Date(s.timestamp),
        }))
        return parsed
      }
    } catch (err) {
      Logger.warn("[UserProfileLearner] Redis read failed, rebuilding profile", err)
    }

    return this.rebuildFromMemory(userId)
  }

  // ── rebuildFromMemory ────────────────────────────────────────────────────────

  private async rebuildFromMemory(userId: string): Promise<UserProfile> {
    const profile = defaultProfile(userId)

    try {
      const preferences = await pgVectorMemoryStore.getByUser(userId, { type: "preference", limit: 100 })
      for (const mem of preferences) {
        const text = mem.content.toLowerCase()
        // Extract explicit preferences like "user prefers X"
        const match = text.match(/(?:prefers?|wants?|likes?|always use|use only)\s+(.+)/i)
        if (match) {
          profile.explicitPreferences[`preference_${mem.id.slice(0, 8)}`] = match[1].trim()
        }
      }

      const instructions = await pgVectorMemoryStore.getByUser(userId, { type: "instruction", limit: 50 })
      for (const mem of instructions) {
        profile.explicitPreferences[`instruction_${mem.id.slice(0, 8)}`] = mem.content
      }
    } catch (err) {
      Logger.warn("[UserProfileLearner] rebuildFromMemory partial failure", err)
    }

    await this.persistProfile(profile)
    return profile
  }

  // ── updateFromConversation ───────────────────────────────────────────────────

  async updateFromConversation(
    userId: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<void> {
    if (messages.length === 0) return

    const profile = await this.getProfile(userId)
    const userMessages = messages.filter((m) => m.role === "user").map((m) => m.content)

    // Detect signals without LLM first (fast path)
    const detectedLevel = this.detectExpertiseLevel(userMessages)
    const detectedStyle = this.detectCommunicationStyle(userMessages)
    const detectedTopics = this.extractTopics(userMessages)

    // Smooth-update expertise (EMA with alpha=0.15)
    const alpha = 0.15
    profile.expertise.general =
      alpha * detectedLevel + (1 - alpha) * profile.expertise.general
    profile.communicationStyle = {
      ...profile.communicationStyle,
      ...detectedStyle,
      technicalLevel: Math.round(
        alpha * detectedLevel + (1 - alpha) * profile.communicationStyle.technicalLevel
      ) as 1 | 2 | 3 | 4 | 5,
    }

    // Merge topics
    const now = new Date()
    for (const topic of detectedTopics) {
      const existing = profile.topicInterests.find((t) => t.topic === topic)
      if (existing) {
        existing.weight = Math.min(1, existing.weight + 0.05)
        existing.lastMentioned = now
      } else {
        profile.topicInterests.push({ topic, weight: 0.3, lastMentioned: now })
      }
    }
    // Cap topic list at 50
    profile.topicInterests = profile.topicInterests
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 50)

    // LLM-based deep extraction (best-effort, not blocking)
    try {
      const llmInsights = await this.extractInsightsWithLLM(messages)
      if (llmInsights) {
        await this.mergeProfiles(userId, llmInsights)
        return // mergeProfiles calls persistProfile
      }
    } catch (err) {
      Logger.warn("[UserProfileLearner] LLM extraction failed, using heuristics only", err)
    }

    profile.updatedAt = now
    await this.persistProfile(profile)
    Logger.debug("[UserProfileLearner] updated profile from conversation", { userId })
  }

  // ── extractInsightsWithLLM ───────────────────────────────────────────────────

  private async extractInsightsWithLLM(
    messages: Array<{ role: string; content: string }>
  ): Promise<PartialProfile | null> {
    const conversation = messages
      .slice(-12) // limit context
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n")

    const prompt = `Analyze this conversation and return a JSON object with these fields:
- preferredLength: "concise" | "detailed" | "adaptive"
- preferredFormat: "prose" | "bullets" | "code" | "mixed"
- tone: "formal" | "casual" | "friendly"
- technicalLevel: 1-5 integer
- topics: string[] (max 5)
- explicitPreferences: Record<string,string> (any explicit instructions from user)
- programmingLanguages: string[]
- signalType: "appreciation" | "complaint" | "confusion" | "correction" | null

Respond with only valid JSON.

CONVERSATION:
${conversation}`

    const response = await llmGateway.chat(
      [{ role: "user", content: prompt }],
      { maxTokens: 400, temperature: 0 }
    )

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null
      const data = JSON.parse(jsonMatch[0]) as Record<string, unknown>

      const insights: PartialProfile = {}

      if (data.preferredLength) {
        insights.communicationStyle = {
          preferredLength: data.preferredLength as "concise" | "detailed" | "adaptive",
          technicalLevel: (parseInt(String(data.technicalLevel)) || 3) as 1 | 2 | 3 | 4 | 5,
          preferredFormat: (data.preferredFormat as "prose" | "bullets" | "code" | "mixed") ?? "mixed",
          tone: (data.tone as "formal" | "casual" | "friendly") ?? "friendly",
        }
      }

      if (Array.isArray(data.topics) && data.topics.length > 0) {
        insights.topicInterests = (data.topics as string[]).map((t: string) => ({
          topic: t,
          weight: 0.4,
          lastMentioned: new Date(),
        }))
      }

      if (data.explicitPreferences && typeof data.explicitPreferences === "object") {
        insights.explicitPreferences = data.explicitPreferences as Record<string, string>
      }

      if (Array.isArray(data.programmingLanguages) && data.programmingLanguages.length > 0) {
        insights.expertise = {
          programming: { level: 3, languages: data.programmingLanguages as string[] },
          science: { level: 2, fields: [] },
          business: { level: 2, areas: [] },
          creative: { level: 2, domains: [] },
          general: 3,
        }
      }

      if (data.signalType) {
        insights.implicitSignals = [
          {
            type: data.signalType as ImplicitSignal["type"],
            context: "conversation analysis",
            timestamp: new Date(),
            weight: 0.5,
          },
        ]
      }

      return insights
    } catch {
      return null
    }
  }

  // ── recordExplicitPreference ─────────────────────────────────────────────────

  async recordExplicitPreference(
    userId: string,
    key: string,
    value: string
  ): Promise<void> {
    const profile = await this.getProfile(userId)
    profile.explicitPreferences[key] = value
    profile.updatedAt = new Date()
    await this.persistProfile(profile)
    Logger.info("[UserProfileLearner] explicit preference recorded", { userId, key })
  }

  // ── recordImplicitSignal ─────────────────────────────────────────────────────

  async recordImplicitSignal(userId: string, signal: ImplicitSignal): Promise<void> {
    const profile = await this.getProfile(userId)
    profile.implicitSignals.unshift(signal)
    // Keep last 100 signals
    profile.implicitSignals = profile.implicitSignals.slice(0, 100)
    profile.updatedAt = new Date()
    await this.persistProfile(profile)
  }

  // ── getSystemPromptAdditions ──────────────────────────────────────────────────

  async getSystemPromptAdditions(userId: string): Promise<string> {
    const profile = await this.getProfile(userId)
    const lines: string[] = []

    const { communicationStyle, expertise, topicInterests, explicitPreferences } = profile

    lines.push("## User Preferences")

    // Communication style
    lines.push(
      `- Response length: ${communicationStyle.preferredLength}`
    )
    lines.push(
      `- Technical level: ${communicationStyle.technicalLevel}/5`
    )
    lines.push(`- Preferred format: ${communicationStyle.preferredFormat}`)
    lines.push(`- Tone: ${communicationStyle.tone}`)

    // Expertise highlights
    if (expertise.programming.languages.length > 0) {
      lines.push(
        `- Programming expertise: ${expertise.programming.languages.join(", ")} (level ${expertise.programming.level}/5)`
      )
    }
    if (expertise.science.fields.length > 0) {
      lines.push(`- Science fields: ${expertise.science.fields.join(", ")}`)
    }

    // Top interests
    const topTopics = topicInterests
      .filter((t) => t.weight > 0.3)
      .slice(0, 5)
      .map((t) => t.topic)
    if (topTopics.length > 0) {
      lines.push(`- Interests: ${topTopics.join(", ")}`)
    }

    // Explicit preferences
    const explicitEntries = Object.entries(explicitPreferences).slice(0, 10)
    if (explicitEntries.length > 0) {
      lines.push("\n## Explicit Instructions from User")
      for (const [, v] of explicitEntries) {
        lines.push(`- ${v}`)
      }
    }

    return lines.join("\n")
  }

  // ── mergeProfiles ────────────────────────────────────────────────────────────

  async mergeProfiles(userId: string, newInsights: PartialProfile): Promise<UserProfile> {
    const profile = await this.getProfile(userId)
    const alpha = 0.2 // blend factor for numeric fields

    if (newInsights.communicationStyle) {
      const incoming = newInsights.communicationStyle
      // Majority-wins for categorical, EMA for numeric
      if (incoming.preferredLength) profile.communicationStyle.preferredLength = incoming.preferredLength
      if (incoming.preferredFormat) profile.communicationStyle.preferredFormat = incoming.preferredFormat
      if (incoming.tone) profile.communicationStyle.tone = incoming.tone
      if (incoming.technicalLevel) {
        profile.communicationStyle.technicalLevel = Math.round(
          alpha * incoming.technicalLevel + (1 - alpha) * profile.communicationStyle.technicalLevel
        ) as 1 | 2 | 3 | 4 | 5
      }
    }

    if (newInsights.expertise) {
      const inc = newInsights.expertise
      const ex = profile.expertise
      ex.general = alpha * inc.general + (1 - alpha) * ex.general
      if (inc.programming.languages.length > 0) {
        const merged = new Set([...ex.programming.languages, ...inc.programming.languages])
        ex.programming.languages = Array.from(merged).slice(0, 20)
      }
      ex.programming.level =
        alpha * inc.programming.level + (1 - alpha) * ex.programming.level
    }

    if (newInsights.topicInterests) {
      for (const t of newInsights.topicInterests) {
        const existing = profile.topicInterests.find((x) => x.topic === t.topic)
        if (existing) {
          existing.weight = Math.min(1, existing.weight + t.weight * alpha)
          existing.lastMentioned = t.lastMentioned
        } else {
          profile.topicInterests.push(t)
        }
      }
      profile.topicInterests = profile.topicInterests
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 50)
    }

    if (newInsights.explicitPreferences) {
      Object.assign(profile.explicitPreferences, newInsights.explicitPreferences)
    }

    if (newInsights.implicitSignals) {
      profile.implicitSignals = [
        ...newInsights.implicitSignals,
        ...profile.implicitSignals,
      ].slice(0, 100)
    }

    profile.updatedAt = new Date()
    await this.persistProfile(profile)
    return profile
  }

  // ── export / delete ──────────────────────────────────────────────────────────

  async exportProfile(userId: string): Promise<UserProfile> {
    return this.getProfile(userId)
  }

  async deleteProfile(userId: string): Promise<void> {
    await redis.del(PROFILE_KEY(userId))
    Logger.info("[UserProfileLearner] profile deleted", { userId })
  }

  // ── private helpers ──────────────────────────────────────────────────────────

  private detectExpertiseLevel(messages: string[]): number {
    const technicalTerms = [
      /\b(algorithm|complexity|async|await|promise|mutex|semaphore|heap|stack|recursion)\b/gi,
      /\b(neural network|gradient descent|regression|hypothesis|p-value|variance|entropy)\b/gi,
      /\b(api|endpoint|rest|graphql|websocket|microservice|kubernetes|docker|ci\/cd)\b/gi,
      /\b(derivative|integral|eigenvalue|manifold|topology|fourier|laplace)\b/gi,
    ]
    const combined = messages.join(" ")
    let termCount = 0
    for (const pattern of technicalTerms) {
      termCount += (combined.match(pattern) ?? []).length
    }
    const codeBlocks = (combined.match(/```/g) ?? []).length / 2
    const totalScore = termCount + codeBlocks * 2
    if (totalScore >= 15) return 5
    if (totalScore >= 8) return 4
    if (totalScore >= 4) return 3
    if (totalScore >= 1) return 2
    return 1
  }

  private extractTopics(messages: string[]): string[] {
    const topicKeywords: Record<string, RegExp> = {
      programming: /\b(code|programming|javascript|python|typescript|rust|java|c\+\+|sql)\b/gi,
      "machine learning": /\b(ml|ai|machine learning|deep learning|model|training|dataset)\b/gi,
      business: /\b(startup|revenue|marketing|sales|product|strategy|market)\b/gi,
      science: /\b(research|experiment|hypothesis|study|biology|chemistry|physics)\b/gi,
      writing: /\b(essay|article|blog|writing|content|draft|edit)\b/gi,
      finance: /\b(investment|stock|crypto|finance|budget|money|revenue)\b/gi,
    }
    const combined = messages.join(" ")
    const found: string[] = []
    for (const [topic, pattern] of Object.entries(topicKeywords)) {
      if (pattern.test(combined)) found.push(topic)
    }
    return found
  }

  private detectCommunicationStyle(
    messages: string[]
  ): Partial<UserProfile["communicationStyle"]> {
    const combined = messages.join(" ")
    const wordCount = combined.split(/\s+/).length
    const avgMessageLength = wordCount / Math.max(messages.length, 1)

    const style: Partial<UserProfile["communicationStyle"]> = {}

    // Length preference from user messages
    if (/\b(brief|short|concise|quick|tldr)\b/i.test(combined)) {
      style.preferredLength = "concise"
    } else if (/\b(detail|explain|elaborate|thorough|comprehensive)\b/i.test(combined)) {
      style.preferredLength = "detailed"
    } else if (avgMessageLength < 10) {
      style.preferredLength = "concise"
    } else if (avgMessageLength > 40) {
      style.preferredLength = "detailed"
    }

    // Format preference
    if (/\b(bullet|list|points?)\b/i.test(combined)) {
      style.preferredFormat = "bullets"
    } else if (/```/.test(combined)) {
      style.preferredFormat = "code"
    }

    // Tone
    if (/\b(please|thanks?|could you|would you mind)\b/i.test(combined)) {
      style.tone = "friendly"
    } else if (/\b(yo|hey|lol|haha|ngl|btw)\b/i.test(combined)) {
      style.tone = "casual"
    }

    return style
  }

  // ── persistProfile ────────────────────────────────────────────────────────────

  private async persistProfile(profile: UserProfile): Promise<void> {
    try {
      await redis.setex(PROFILE_KEY(profile.userId), PROFILE_TTL, JSON.stringify(profile))
    } catch (err) {
      Logger.warn("[UserProfileLearner] failed to persist profile to Redis", err)
    }
  }
}

export const userProfileLearner = new UserProfileLearner()
