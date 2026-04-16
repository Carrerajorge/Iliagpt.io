import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { users, memoryFacts, conversationContexts, conversationStates } from "@shared/schema";

export interface UserPreference {
  key: string;
  value: string;
  confidence: number;
  source: "explicit" | "inferred" | "system";
  lastUpdated: Date;
}

export interface UserProfile {
  userId: string;
  language: string;
  responseStyle: "concise" | "detailed" | "balanced";
  expertise: string[];
  interests: string[];
  timezone?: string;
  preferences: Record<string, UserPreference>;
}

const userProfileCache = new Map<string, { profile: UserProfile; timestamp: number }>();
const CACHE_TTL = 300000;

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const cached = userProfileCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.profile;
  }

  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return null;

    const facts = await db
      .select()
      .from(memoryFacts)
      .innerJoin(conversationStates, eq(memoryFacts.stateId, conversationStates.id))
      .where(eq(conversationStates.userId, userId))
      .limit(100);

    const preferences: Record<string, UserPreference> = {};
    const expertise: string[] = [];
    const interests: string[] = [];
    let detectedLanguage = "es";

    for (const { memory_facts: fact } of facts) {
      if (fact.factType === "user_preference") {
        const key = extractPreferenceKey(fact.content);
        if (key) {
          preferences[key] = {
            key,
            value: fact.content,
            confidence: fact.confidence || 80,
            source: fact.source as "explicit" | "inferred" | "system" || "inferred",
            lastUpdated: fact.createdAt,
          };
        }
      }

      if (fact.content.toLowerCase().includes("prefer") || 
          fact.content.toLowerCase().includes("prefier")) {
        if (fact.content.match(/respuestas?\s*(cortas?|breves?|concisas?)/i)) {
          preferences["response_style"] = {
            key: "response_style",
            value: "concise",
            confidence: fact.confidence || 80,
            source: "inferred",
            lastUpdated: fact.createdAt,
          };
        } else if (fact.content.match(/respuestas?\s*(largas?|detalladas?|completas?)/i)) {
          preferences["response_style"] = {
            key: "response_style",
            value: "detailed",
            confidence: fact.confidence || 80,
            source: "inferred",
            lastUpdated: fact.createdAt,
          };
        }
      }

      const expertiseMatch = fact.content.match(
        /(trabaja|works?|especializa|specializes?)\s*(en|in|como|as)?\s*(.+)/i
      );
      if (expertiseMatch) {
        expertise.push(expertiseMatch[3].trim());
      }

      const interestMatch = fact.content.match(
        /(interesa|interested|gusta|likes?|estudia|studies)\s*(en|in)?\s*(.+)/i
      );
      if (interestMatch) {
        interests.push(interestMatch[3].trim());
      }
    }

    const recentMessages = await getRecentUserMessages(userId, 10);
    if (recentMessages.length > 0) {
      detectedLanguage = detectLanguageFromMessages(recentMessages);
    }

    const profile: UserProfile = {
      userId,
      language: detectedLanguage,
      responseStyle: (preferences["response_style"]?.value as any) || "balanced",
      expertise: [...new Set(expertise)],
      interests: [...new Set(interests)],
      preferences,
    };

    userProfileCache.set(userId, { profile, timestamp: Date.now() });

    return profile;
  } catch (error) {
    console.error("[UserPreferencesMemory] Error loading profile:", error);
    return null;
  }
}

export async function updateUserPreference(
  userId: string,
  key: string,
  value: string,
  source: "explicit" | "inferred" = "inferred"
): Promise<void> {
  try {
    const states = await db
      .select()
      .from(conversationStates)
      .where(eq(conversationStates.userId, userId))
      .orderBy(conversationStates.updatedAt)
      .limit(1);

    if (states.length === 0) return;

    await db.insert(memoryFacts).values({
      stateId: states[0].id,
      factType: "user_preference",
      content: `${key}: ${value}`,
      confidence: source === "explicit" ? 95 : 75,
      source,
    });

    userProfileCache.delete(userId);
  } catch (error) {
    console.error("[UserPreferencesMemory] Error updating preference:", error);
  }
}

export async function inferPreferencesFromMessage(
  userId: string,
  message: string
): Promise<void> {
  const patterns = [
    { pattern: /prefer[io]?\s*(respuestas?)?\s*(cortas?|breves?)/i, key: "response_style", value: "concise" },
    { pattern: /prefer[io]?\s*(respuestas?)?\s*(largas?|detalladas?)/i, key: "response_style", value: "detailed" },
    { pattern: /soy\s*(m[ée]dico|doctor|ingeniero|abogado|profesor)/i, key: "profession", extract: true },
    { pattern: /trabajo\s*(en|como)\s*(.+)/i, key: "profession", extract: true },
    { pattern: /h[aá]blame\s*(siempre)?\s*en\s*(espa[ñn]ol|ingl[ée]s|portugu[ée]s)/i, key: "language", extract: true },
  ];

  for (const { pattern, key, value, extract } of patterns) {
    const match = message.match(pattern);
    if (match) {
      const finalValue = extract 
        ? match[match.length - 1] || match[1]
        : value;
      
      if (finalValue) {
        await updateUserPreference(userId, key, finalValue, "inferred");
      }
    }
  }
}

export function buildSystemPromptFromPreferences(
  basePrompt: string,
  profile: UserProfile | null
): string {
  if (!profile) return basePrompt;

  const additions: string[] = [];

  if (profile.language === "es") {
    additions.push("Responde siempre en español.");
  } else if (profile.language === "en") {
    additions.push("Always respond in English.");
  }

  if (profile.responseStyle === "concise") {
    additions.push("El usuario prefiere respuestas concisas y directas. Ve al punto sin rodeos.");
  } else if (profile.responseStyle === "detailed") {
    additions.push("El usuario prefiere respuestas detalladas y completas. Proporciona contexto y explicaciones.");
  }

  if (profile.expertise.length > 0) {
    additions.push(`El usuario tiene experiencia en: ${profile.expertise.join(", ")}. Puedes usar terminología técnica apropiada.`);
  }

  if (additions.length === 0) return basePrompt;

  return `${basePrompt}\n\n## Preferencias del Usuario\n${additions.join("\n")}`;
}

async function getRecentUserMessages(userId: string, limit: number): Promise<string[]> {
  return [];
}

function detectLanguageFromMessages(messages: string[]): string {
  const spanishIndicators = /\b(el|la|de|que|en|los|las|es|por|con|para|una|del)\b/gi;
  const englishIndicators = /\b(the|is|are|was|were|have|has|had|will|would|can|could)\b/gi;
  
  let spanishCount = 0;
  let englishCount = 0;
  
  for (const msg of messages) {
    spanishCount += (msg.match(spanishIndicators) || []).length;
    englishCount += (msg.match(englishIndicators) || []).length;
  }
  
  return spanishCount >= englishCount ? "es" : "en";
}

function extractPreferenceKey(content: string): string | null {
  const match = content.match(/^([^:]+):/);
  return match ? match[1].trim().toLowerCase().replace(/\s+/g, "_") : null;
}

export function clearUserProfileCache(userId?: string): void {
  if (userId) {
    userProfileCache.delete(userId);
  } else {
    userProfileCache.clear();
  }
}

export default {
  getUserProfile,
  updateUserPreference,
  inferPreferencesFromMessage,
  buildSystemPromptFromPreferences,
  clearUserProfileCache,
};
