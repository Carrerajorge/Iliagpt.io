/**
 * UserProfileLearner — automatically infers and updates user preferences from conversation patterns.
 * Tracks expertise level, communication style, frequent topics, and explicit preferences.
 */

import { createLogger } from "../utils/logger";
import { pgVectorMemoryStore } from "./PgVectorMemoryStore";
import { db } from "../db";
import { sql } from "drizzle-orm";

const logger = createLogger("UserProfileLearner");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExpertiseLevel = "beginner" | "intermediate" | "advanced" | "expert";
export type CommunicationStyle = "concise" | "detailed" | "technical" | "casual" | "formal";

export interface UserProfile {
  userId: string;
  expertiseLevel: ExpertiseLevel;
  communicationStyle: CommunicationStyle;
  preferredLanguage: string;
  frequentTopics: Array<{ topic: string; count: number; lastSeen: Date }>;
  explicitPreferences: Record<string, string>;
  inferredAttributes: Record<string, { value: string; confidence: number; source: string }>;
  totalInteractions: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface ConversationSignal {
  userId: string;
  conversationId: string;
  userMessages: string[];
  assistantMessages: string[];
  topicsDiscussed?: string[];
  feedbackGiven?: Array<{ positive: boolean; context: string }>;
}

export interface ExplicitPreference {
  key: string;
  value: string;
  context: string;
}

// ─── Inference Heuristics ─────────────────────────────────────────────────────

const EXPERTISE_SIGNALS = {
  beginner: [
    "what is", "how do i", "i don't understand", "can you explain", "what does it mean",
    "i'm new to", "i'm learning", "beginner", "newbie", "first time",
  ],
  intermediate: [
    "how to optimize", "best practice", "what's the difference", "which approach",
    "i've been using", "i know how to",
  ],
  advanced: [
    "time complexity", "design pattern", "architecture", "trade-off", "under the hood",
    "internals", "performance bottleneck", "microservice", "distributed",
  ],
  expert: [
    "rfc", "specification", "kernel", "assembly", "proof", "theorem", "formal verification",
    "memory model", "consistency model", "byzantine fault",
  ],
} satisfies Record<ExpertiseLevel, string[]>;

const STYLE_SIGNALS = {
  concise: ["tldr", "brief", "short", "quick", "summarize", "in brief"],
  detailed: ["explain in detail", "step by step", "walk me through", "comprehensive", "thorough"],
  technical: ["code", "implementation", "algorithm", "function", "variable", "syntax", "api"],
  casual: ["hey", "what's up", "cool", "awesome", "lol", "btw", "thanks"],
  formal: ["please", "could you", "i would like", "kindly", "regarding"],
} satisfies Record<CommunicationStyle, string[]>;

const TOPIC_KEYWORDS: Record<string, string[]> = {
  programming: ["code", "function", "variable", "class", "algorithm", "debug", "typescript", "python", "javascript"],
  data_science: ["dataset", "model", "training", "neural network", "machine learning", "statistics", "regression"],
  business: ["strategy", "revenue", "marketing", "customer", "stakeholder", "roi", "kpi", "growth"],
  research: ["paper", "study", "literature", "hypothesis", "experiment", "findings", "citation"],
  writing: ["draft", "essay", "article", "edit", "proofread", "grammar", "paragraph", "thesis"],
  design: ["ui", "ux", "layout", "component", "wireframe", "figma", "color", "typography"],
  devops: ["docker", "kubernetes", "deployment", "ci/cd", "pipeline", "infrastructure", "aws", "cloud"],
};

function detectTopics(text: string): string[] {
  const lower = text.toLowerCase();
  return Object.entries(TOPIC_KEYWORDS)
    .filter(([, keywords]) => keywords.some((k) => lower.includes(k)))
    .map(([topic]) => topic);
}

function scoreExpertiseLevel(messages: string[]): ExpertiseLevel {
  const combined = messages.join(" ").toLowerCase();
  const scores: Record<ExpertiseLevel, number> = { beginner: 0, intermediate: 0, advanced: 0, expert: 0 };

  for (const [level, signals] of Object.entries(EXPERTISE_SIGNALS)) {
    scores[level as ExpertiseLevel] = signals.filter((s) => combined.includes(s)).length;
  }

  // Expert overrides all if any signal found
  if (scores.expert > 0) return "expert";
  if (scores.advanced >= 2) return "advanced";
  if (scores.intermediate >= 2) return "intermediate";
  if (scores.beginner > 0) return "beginner";
  return "intermediate"; // default
}

function scoreCommunicationStyle(messages: string[]): CommunicationStyle {
  const combined = messages.join(" ").toLowerCase();
  const scores: Record<CommunicationStyle, number> = {
    concise: 0, detailed: 0, technical: 0, casual: 0, formal: 0,
  };

  for (const [style, signals] of Object.entries(STYLE_SIGNALS)) {
    scores[style as CommunicationStyle] = signals.filter((s) => combined.includes(s)).length;
  }

  const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return (winner?.[1] ?? 0) > 0 ? (winner![0] as CommunicationStyle) : "detailed";
}

function detectLanguage(text: string): string {
  // Basic heuristic using common words
  const langPatterns: Array<[string, string[]]> = [
    ["es", ["que", "de", "en", "el", "la", "los", "las", "por", "para", "con"]],
    ["fr", ["que", "de", "le", "la", "les", "et", "en", "un", "une", "des"]],
    ["pt", ["que", "de", "o", "a", "os", "as", "em", "do", "da", "por"]],
    ["de", ["der", "die", "das", "und", "in", "zu", "mit", "von", "für", "ist"]],
    ["zh", ["\u6211", "\u4e0d", "\u4e86", "\u4eba", "\u5927", "\u4e2d", "\u5c0f"]],
    ["en", ["the", "is", "are", "was", "were", "have", "has", "that", "this", "with"]],
  ];

  const words = text.toLowerCase().split(/\s+/);
  let bestLang = "en";
  let bestScore = 0;

  for (const [lang, patterns] of langPatterns) {
    const score = patterns.filter((p) => words.includes(p)).length;
    if (score > bestScore) {
      bestScore = score;
      bestLang = lang;
    }
  }

  return bestLang;
}

function extractExplicitPreferences(text: string): ExplicitPreference[] {
  const prefs: ExplicitPreference[] = [];
  const patterns = [
    { regex: /i prefer ([\w\s]+) (answers?|responses?|explanations?)/i, key: "response_style", valueIdx: 1 },
    { regex: /please (always|never|don't) ([\w\s]+)/i, key: "instruction", valueIdx: 2 },
    { regex: /i (like|want|need) ([\w\s]+) format/i, key: "output_format", valueIdx: 2 },
    { regex: /my (role|job|title|profession) is ([\w\s]+)/i, key: "role", valueIdx: 2 },
    { regex: /i (work|am working) (on|in|at|with) ([\w\s]+)/i, key: "work_context", valueIdx: 3 },
  ];

  for (const { regex, key, valueIdx } of patterns) {
    const m = text.match(regex);
    if (m?.[valueIdx]) {
      prefs.push({ key, value: m[valueIdx].trim(), context: text.slice(0, 100) });
    }
  }

  return prefs;
}

// ─── Profile Storage ──────────────────────────────────────────────────────────

async function loadProfile(userId: string): Promise<UserProfile | null> {
  const raw = await pgVectorMemoryStore.getUserMemory(userId, "__profile__");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

async function saveProfile(profile: UserProfile): Promise<void> {
  await pgVectorMemoryStore.storeUserMemory(profile.userId, "__profile__", JSON.stringify(profile), {
    source: "UserProfileLearner",
  });
}

function defaultProfile(userId: string): UserProfile {
  return {
    userId,
    expertiseLevel: "intermediate",
    communicationStyle: "detailed",
    preferredLanguage: "en",
    frequentTopics: [],
    explicitPreferences: {},
    inferredAttributes: {},
    totalInteractions: 0,
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
  };
}

// ─── UserProfileLearner ───────────────────────────────────────────────────────

export class UserProfileLearner {
  async processConversation(signal: ConversationSignal): Promise<UserProfile> {
    let profile = await loadProfile(signal.userId) ?? defaultProfile(signal.userId);

    profile.totalInteractions++;
    profile.lastSeenAt = new Date();

    const userText = signal.userMessages.join(" ");

    // Update expertise level
    const detectedLevel = scoreExpertiseLevel(signal.userMessages);
    profile = this.updateExpertise(profile, detectedLevel);

    // Update communication style
    const detectedStyle = scoreCommunicationStyle(signal.userMessages);
    profile = this.updateStyle(profile, detectedStyle);

    // Update language
    const detectedLang = detectLanguage(userText);
    if (detectedLang !== "en") {
      profile.preferredLanguage = detectedLang;
    }

    // Update topic frequency
    const topics = signal.topicsDiscussed ?? detectTopics(userText);
    for (const topic of topics) {
      const existing = profile.frequentTopics.find((t) => t.topic === topic);
      if (existing) {
        existing.count++;
        existing.lastSeen = new Date();
      } else {
        profile.frequentTopics.push({ topic, count: 1, lastSeen: new Date() });
      }
    }

    // Keep only top 20 topics
    profile.frequentTopics.sort((a, b) => b.count - a.count);
    profile.frequentTopics = profile.frequentTopics.slice(0, 20);

    // Extract explicit preferences
    const explicitPrefs = extractExplicitPreferences(userText);
    for (const pref of explicitPrefs) {
      profile.explicitPreferences[pref.key] = pref.value;
      logger.debug(`Explicit preference detected for ${signal.userId}: ${pref.key} = ${pref.value}`);
    }

    // Process positive feedback signals
    if (signal.feedbackGiven) {
      for (const fb of signal.feedbackGiven) {
        if (fb.positive) {
          profile.inferredAttributes["liked_response_style"] = {
            value: fb.context.slice(0, 100),
            confidence: 0.7,
            source: "feedback",
          };
        }
      }
    }

    await saveProfile(profile);
    logger.debug(`Updated profile for user ${signal.userId} (interactions: ${profile.totalInteractions})`);

    return profile;
  }

  private updateExpertise(profile: UserProfile, detected: ExpertiseLevel): UserProfile {
    const levels: ExpertiseLevel[] = ["beginner", "intermediate", "advanced", "expert"];
    const currentIdx = levels.indexOf(profile.expertiseLevel);
    const detectedIdx = levels.indexOf(detected);

    // Blend: don't downgrade too aggressively, upgrade readily
    if (detectedIdx > currentIdx) {
      profile.expertiseLevel = detected;
    } else if (detectedIdx < currentIdx && profile.totalInteractions > 5) {
      // Only downgrade after enough evidence
      const newIdx = Math.max(detectedIdx, currentIdx - 1);
      profile.expertiseLevel = levels[newIdx]!;
    }

    profile.inferredAttributes["expertise_level"] = {
      value: profile.expertiseLevel,
      confidence: Math.min(0.9, 0.5 + profile.totalInteractions * 0.02),
      source: "message_analysis",
    };

    return profile;
  }

  private updateStyle(profile: UserProfile, detected: CommunicationStyle): UserProfile {
    // Moving average — new signal has 30% weight
    if (profile.totalInteractions <= 3) {
      profile.communicationStyle = detected;
    } else if (detected !== profile.communicationStyle) {
      // Only update if style appears multiple times
      const currentCount = (profile.inferredAttributes["style_count"]?.value as string)?.split(",") ?? [];
      currentCount.push(detected);
      if (currentCount.filter((s) => s === detected).length >= 3) {
        profile.communicationStyle = detected;
      }
      profile.inferredAttributes["style_count"] = {
        value: currentCount.slice(-10).join(","),
        confidence: 0.6,
        source: "style_tracking",
      };
    }

    return profile;
  }

  async getProfile(userId: string): Promise<UserProfile> {
    return await loadProfile(userId) ?? defaultProfile(userId);
  }

  async setExplicitPreference(userId: string, key: string, value: string): Promise<void> {
    const profile = await this.getProfile(userId);
    profile.explicitPreferences[key] = value;
    await saveProfile(profile);
    logger.info(`Explicit preference set for ${userId}: ${key} = ${value}`);
  }

  async deleteProfile(userId: string): Promise<void> {
    await pgVectorMemoryStore.storeUserMemory(userId, "__profile__", "", { deleted: true });
    logger.info(`Profile deleted for user ${userId}`);
  }

  async getSystemPromptAddons(userId: string): Promise<string> {
    const profile = await this.getProfile(userId);
    const lines: string[] = [];

    if (profile.expertiseLevel === "beginner") {
      lines.push("The user is a beginner — explain concepts clearly, avoid jargon, use simple examples.");
    } else if (profile.expertiseLevel === "expert") {
      lines.push("The user is an expert — be concise, use precise technical language, skip basic explanations.");
    } else if (profile.expertiseLevel === "advanced") {
      lines.push("The user has advanced knowledge — provide depth without over-explaining basics.");
    }

    if (profile.communicationStyle === "concise") {
      lines.push("Keep responses brief and to the point.");
    } else if (profile.communicationStyle === "detailed") {
      lines.push("Provide thorough, detailed explanations.");
    }

    if (profile.preferredLanguage !== "en") {
      lines.push(`The user prefers to communicate in language code: ${profile.preferredLanguage}.`);
    }

    for (const [key, value] of Object.entries(profile.explicitPreferences)) {
      lines.push(`User preference — ${key}: ${value}.`);
    }

    const topTopics = profile.frequentTopics.slice(0, 3).map((t) => t.topic);
    if (topTopics.length > 0) {
      lines.push(`User frequently discusses: ${topTopics.join(", ")}.`);
    }

    return lines.join("\n");
  }
}

export const userProfileLearner = new UserProfileLearner();
