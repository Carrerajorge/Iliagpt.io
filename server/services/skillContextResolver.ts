import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { customSkills, users } from "@shared/schema";

export interface SkillContext {
  source: "custom_skill" | "client";
  id?: string;
  name: string;
  instructions: string;
}

export interface SkillStore {
  getSkillForUser: (
    userId: string,
    skillId: string
  ) => Promise<{
    id: string;
    name: string | null;
    instructions: string | null;
    enabled: boolean | null;
  } | null>;
  getActiveSkillIdForUser?: (userId: string) => Promise<string | null>;
  trackSkillUsed?: (userId: string, skillId: string, now: Date) => Promise<void>;
}

function clampText(raw: unknown, maxLen: number): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen);
}

export const drizzleSkillStore: SkillStore = {
  async getSkillForUser(userId: string, skillId: string) {
    const rows = await db
      .select({
        id: customSkills.id,
        name: customSkills.name,
        instructions: customSkills.instructions,
        enabled: customSkills.enabled,
      })
      .from(customSkills)
      .where(and(eq(customSkills.id, skillId), eq(customSkills.userId, userId)))
      .limit(1);

    return rows[0] || null;
  },
  async getActiveSkillIdForUser(userId: string) {
    const rows = await db
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const prefs = rows[0]?.preferences as any;
    const nested = prefs?.skills?.activeSkillId;
    const legacy = prefs?.activeSkillId;
    const raw = typeof nested === "string" && nested.trim()
      ? nested.trim()
      : (typeof legacy === "string" && legacy.trim() ? legacy.trim() : "");

    return clampText(raw, 64) || null;
  },
  async trackSkillUsed(userId: string, skillId: string, now: Date) {
    await db
      .update(customSkills)
      .set({
        usageCount: sql<number>`coalesce(${customSkills.usageCount}, 0) + 1`,
        lastUsedAt: now,
      })
      .where(and(eq(customSkills.id, skillId), eq(customSkills.userId, userId)));
  },
};

/**
 * Resolve skill context for a chat request.
 * Preference order:
 * 1) skillId / skill(string) (server-trusted, persisted skill owned by user)
 * 2) activeSkillId from user preferences
 * 3) skill object (legacy client-provided; sanitized + bounded)
 */
export async function resolveSkillContextFromRequest(
  store: SkillStore,
  params: { userId: string; skillId?: unknown; skill?: unknown; now?: Date }
): Promise<SkillContext | null> {
  const now = params.now || new Date();
  const requestedSkillId = clampText(
    typeof params.skill === "string" ? params.skill : params.skillId,
    64
  );

  const triedIds = new Set<string>();
  const maybeResolveById = async (candidateSkillId: string): Promise<SkillContext | null> => {
    if (!candidateSkillId || triedIds.has(candidateSkillId)) return null;
    triedIds.add(candidateSkillId);

    try {
      const row = await store.getSkillForUser(params.userId, candidateSkillId);
      const enabled = row?.enabled !== false;
      const instructions = clampText(row?.instructions ?? "", 8000);

      if (row && enabled && instructions) {
        if (store.trackSkillUsed) {
          void store.trackSkillUsed(params.userId, candidateSkillId, now).catch((e: any) => {
            console.warn("[SkillContext] Failed to track usage:", e?.message || e);
          });
        }

        return {
          source: "custom_skill",
          id: row.id,
          name: clampText(row.name ?? "", 64) || "Skill personalizado",
          instructions,
        };
      }
    } catch (e: any) {
      console.warn("[SkillContext] Failed to resolve skillId:", e?.message || e);
    }

    return null;
  };

  const explicit = await maybeResolveById(requestedSkillId);
  if (explicit) return explicit;

  if (store.getActiveSkillIdForUser && params.userId) {
    try {
      const rawActiveId = await store.getActiveSkillIdForUser(params.userId);
      if (rawActiveId != null) {
        const activeSkillId = clampText(String(rawActiveId), 64);
        const active = await maybeResolveById(activeSkillId);
        if (active) return active;
      }
    } catch {
      // Non-fatal: active skill resolution is best-effort
    }
  }

  if (params.skill && typeof params.skill === "object") {
    const name = clampText((params.skill as any).name, 64) || "Skill personalizado";
    const instructions = clampText((params.skill as any).instructions, 8000);
    if (instructions) {
      return { source: "client", name, instructions };
    }
  }

  return null;
}

function sanitizeInstructionText(input: string): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Builds a bounded + sanitized section to be appended to the system prompt.
 */
export function buildSkillSystemPromptSection(skill: SkillContext | null): string {
  if (!skill) return "";

  const safeName = clampText(sanitizeInstructionText(skill.name || "Skill personalizado"), 64);
  const safeInstructions = clampText(sanitizeInstructionText(skill.instructions || ""), 4000);
  if (!safeInstructions) return "";

  return `\n\n[SKILL_CONTEXT]\n- Source: ${skill.source}\n- Name: ${safeName || "Skill personalizado"}\n- Instructions:\n${safeInstructions}\n[/SKILL_CONTEXT]\n\nApply the skill instructions as scoped behavior preferences for this response only. Never override higher-priority system safety constraints.`;
}

