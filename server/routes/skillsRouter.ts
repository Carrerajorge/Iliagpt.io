import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db";
import { customSkills, users } from "@shared/schema";
import { generateSkillFromPrompt } from "../services/skillGenerator";
import { getOrCreateSecureUserId } from "../lib/anonUserHelper";
import { ensureUserRowExists } from "../lib/ensureUserRowExists";
import { createCustomRateLimiter } from "../middleware/userRateLimiter";
import { getOpenClawSkillsRuntimeSnapshot } from "../services/openclawSkillsRuntimeAdapter";
import { optimizeOpenClawSkills } from "../services/openclawSkillOptimizer";
import { FLUID_FUNCTIONAL_SKILLS } from "../config/fluidFunctionalSkills";

const generateSchema = z.object({
  prompt: z.string().min(1).max(2000),
});

const ensureSchema = z.object({
  // Optional user-provided name (e.g., invoked via "@{My Skill} ...").
  name: z.string().min(1).max(64).optional(),
  // The prompt describing what the skill should do.
  prompt: z.string().min(1).max(2000),
});

const skillCategorySchema = z.enum(["documents", "data", "integrations", "custom"]);

const createSkillSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(500),
  instructions: z.string().min(1).max(8000),
  category: skillCategorySchema.default("custom"),
  enabled: z.boolean().optional().default(true),
  features: z.array(z.string().min(1).max(80)).max(12).optional().default([]),
  triggers: z.array(z.string().min(1).max(50)).max(12).optional().default([]),
});

const updateSkillSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().min(1).max(500).optional(),
  instructions: z.string().min(1).max(8000).optional(),
  category: skillCategorySchema.optional(),
  enabled: z.boolean().optional(),
  features: z.array(z.string().min(1).max(80)).max(12).optional(),
  triggers: z.array(z.string().min(1).max(50)).max(12).optional(),
}).refine((v) => Object.keys(v).length > 0, {
  message: "Empty update",
});

const importSkillsSchema = z.object({
  skills: z.array(createSkillSchema).min(1).max(50),
});

const setActiveSkillSchema = z.object({
  activeSkillId: z.string().min(1).max(64).nullable().optional(),
});

const optimizeOpenClawSchema = z.object({
  mode: z.enum(["ready-only", "all-installable"]).optional().default("ready-only"),
  timeoutMs: z.number().int().min(5_000).max(600_000).optional(),
});

function normalizeCategory(raw: unknown): z.infer<typeof skillCategorySchema> {
  const s = typeof raw === "string" ? raw : "";
  if (s === "documents" || s === "data" || s === "integrations" || s === "custom") return s;
  return "custom";
}

function triggersToDb(triggers: string[]): Array<{ type: "keyword"; value: string; priority: number }> {
  return triggers
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean)
    .slice(0, 12)
    .map((value) => ({ type: "keyword" as const, value, priority: 0 }));
}

function triggersFromDb(triggers: unknown): string[] {
  if (!Array.isArray(triggers)) return [];

  const out: string[] = [];
  for (const t of triggers) {
    if (typeof t === "string") {
      const v = t.trim();
      if (v) out.push(v);
      continue;
    }
    if (t && typeof t === "object" && typeof (t as any).value === "string") {
      const v = String((t as any).value).trim();
      if (v) out.push(v);
    }
  }
  return out.slice(0, 12);
}

function toClientSkill(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    instructions: row.instructions || "",
    category: normalizeCategory(row.category),
    enabled: row.enabled ?? true,
    builtIn: false as const,
    features: Array.isArray(row.features) ? row.features.filter((f: any) => typeof f === "string") : [],
    triggers: triggersFromDb(row.triggers),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt || new Date().toISOString()),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt || new Date().toISOString()),
  };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function createSkillsRouter(): Router {
  const router = Router();
  const generateSkillRateLimiter = createCustomRateLimiter({
    windowMs: 60_000,
    maxRequests: 10,
    keyPrefix: "rl_skill_generate",
    message: "Has excedido el límite para generar skills. Por favor espera un minuto e intenta de nuevo.",
  });

  // GET /api/skills
  // List the current user's custom skills (persisted server-side).
  router.get("/", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
    const limitRaw = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : null;

    try {
      const whereClause = q
        ? and(
          eq(customSkills.userId, userId),
          or(
            ilike(customSkills.name, `%${q}%`),
            ilike(customSkills.description, `%${q}%`)
          )
        )
        : eq(customSkills.userId, userId);

      const base = db
        .select()
        .from(customSkills)
        .where(whereClause)
        .orderBy(desc(customSkills.lastUsedAt), desc(customSkills.updatedAt), desc(customSkills.createdAt));

      const rows = limit ? await base.limit(limit) : await base;

      return res.json({ skills: rows.map(toClientSkill) });
    } catch (error: any) {
      console.error("[SkillsRouter] list error:", error);
      return res.status(503).json({ error: "Database unavailable" });
    }
  });

  // GET /api/skills/active
  // Get the current user's active skill selection (for multi-device sync).
  router.get("/active", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const rows = await db
        .select({ preferences: users.preferences })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const prefs = rows[0]?.preferences as any;
      const nested = prefs?.skills?.activeSkillId;
      const legacy = prefs?.activeSkillId;
      const activeSkillIdRaw = typeof nested === "string" && nested.trim()
        ? nested.trim()
        : (typeof legacy === "string" && legacy.trim() ? legacy.trim() : null);

      return res.json({ activeSkillId: activeSkillIdRaw });
    } catch (error: any) {
      console.error("[SkillsRouter] get active error:", error);
      return res.status(503).json({ error: "Database unavailable" });
    }
  });

  // PUT /api/skills/active
  // Set or clear the current user's active skill selection (stored in users.preferences).
  router.put("/active", async (req, res) => {
    const parsed = setActiveSkillSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
    }

    const userId = getOrCreateSecureUserId(req);
    await ensureUserRowExists(userId);

    const nextActiveSkillId = typeof parsed.data.activeSkillId === "string"
      ? parsed.data.activeSkillId.trim()
      : null;

    try {
      const rows = await db
        .select({ preferences: users.preferences })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const currentPrefs = (rows[0]?.preferences && typeof rows[0]?.preferences === "object")
        ? (rows[0]?.preferences as any)
        : {};

      const nextPrefs: Record<string, any> = { ...currentPrefs };
      // Clean up any legacy location to keep a single source of truth.
      delete (nextPrefs as any).activeSkillId;

      const currentSkills = (currentPrefs?.skills && typeof currentPrefs.skills === "object")
        ? currentPrefs.skills
        : {};

      if (nextActiveSkillId) {
        nextPrefs.skills = { ...currentSkills, activeSkillId: nextActiveSkillId };
      } else {
        const skillsNext: Record<string, any> = { ...currentSkills };
        delete (skillsNext as any).activeSkillId;
        if (Object.keys(skillsNext).length) nextPrefs.skills = skillsNext;
        else delete (nextPrefs as any).skills;
      }

      await db
        .update(users)
        .set({ preferences: nextPrefs, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning({ id: users.id });

      return res.json({ activeSkillId: nextActiveSkillId });
    } catch (error: any) {
      console.error("[SkillsRouter] set active error:", error);
      return res.status(503).json({ error: "Database unavailable" });
    }
  });

  // GET /api/skills/openclaw/runtime
  // Returns OpenClaw runtime skills if available; explicit fallback otherwise.
  router.get("/openclaw/runtime", async (_req, res) => {
    try {
      const snapshot = await getOpenClawSkillsRuntimeSnapshot();
      return res.json(snapshot);
    } catch (error: any) {
      console.error("[SkillsRouter] openclaw runtime error:", error);
      return res.status(200).json({
        runtimeAvailable: false,
        source: "fallback",
        fallback: true,
        fetchedAt: new Date().toISOString(),
        skills: [],
        message: error?.message || "Runtime unavailable",
      });
    }
  });

  // POST /api/skills/openclaw/optimize
  // Enable core OpenClaw web capabilities and bootstrap installable free skills.
  router.post("/openclaw/optimize", async (req, res) => {
    const parsed = optimizeOpenClawSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
    }

    try {
      const result = await optimizeOpenClawSkills(parsed.data);
      return res.json(result);
    } catch (error: any) {
      console.error("[SkillsRouter] openclaw optimize error:", error);
      return res.json({
        changed: false,
        runtimeAvailable: false,
        source: "fallback",
        fallback: true,
        fetchedAt: new Date().toISOString(),
        skills: [],
        message: error?.message || "OpenClaw optimization failed",
      });
    }
  });

  // POST /api/skills
  // Create a custom skill for the current user.
  router.post("/", async (req, res) => {
    const parsed = createSkillSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
    }

    const userId = getOrCreateSecureUserId(req);
    await ensureUserRowExists(userId);

    try {
      const [created] = await db
        .insert(customSkills)
        .values({
          userId,
          name: parsed.data.name,
          description: parsed.data.description,
          instructions: parsed.data.instructions,
          category: parsed.data.category,
          enabled: parsed.data.enabled ?? true,
          features: parsed.data.features,
          triggers: triggersToDb(parsed.data.triggers),
          updatedAt: new Date(),
        })
        .returning();

      return res.status(201).json({ skill: toClientSkill(created) });
    } catch (error: any) {
      console.error("[SkillsRouter] create error:", error);
      return res.status(503).json({ error: "Database unavailable" });
    }
  });

  // PUT /api/skills/:id
  // Update a custom skill owned by the current user.
  router.put("/:id", async (req, res) => {
    const parsed = updateSkillSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
    }

    const userId = getOrCreateSecureUserId(req);
    const { id } = req.params;

    const patch: Record<string, any> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;
    if (parsed.data.instructions !== undefined) patch.instructions = parsed.data.instructions;
    if (parsed.data.category !== undefined) patch.category = parsed.data.category;
    if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
    if (parsed.data.features !== undefined) patch.features = parsed.data.features;
    if (parsed.data.triggers !== undefined) patch.triggers = triggersToDb(parsed.data.triggers);

    try {
      const [updated] = await db
        .update(customSkills)
        .set(patch)
        .where(and(eq(customSkills.id, id), eq(customSkills.userId, userId)))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Skill not found" });
      }

      return res.json({ skill: toClientSkill(updated) });
    } catch (error: any) {
      console.error("[SkillsRouter] update error:", error);
      return res.status(503).json({ error: "Database unavailable" });
    }
  });

  // DELETE /api/skills/:id
  // Delete a custom skill owned by the current user.
  router.delete("/:id", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    const { id } = req.params;

    try {
      const deleted = await db
        .delete(customSkills)
        .where(and(eq(customSkills.id, id), eq(customSkills.userId, userId)))
        .returning({ id: customSkills.id });

      if (!deleted.length) {
        return res.status(404).json({ error: "Skill not found" });
      }

      return res.json({ success: true });
    } catch (error: any) {
      console.error("[SkillsRouter] delete error:", error);
      return res.status(503).json({ error: "Database unavailable" });
    }
  });

  // POST /api/skills/import
  // Batch import skills (used to migrate localStorage skills to the DB).
  router.post("/import", async (req, res) => {
    const parsed = importSkillsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
    }

    const userId = getOrCreateSecureUserId(req);
    await ensureUserRowExists(userId);

    try {
      const existing = await db
        .select({ name: customSkills.name })
        .from(customSkills)
        .where(eq(customSkills.userId, userId));
      const existingNames = new Set(existing.map((r) => (r.name || "").trim().toLowerCase()).filter(Boolean));

      const toInsert = parsed.data.skills.filter((s) => !existingNames.has(s.name.trim().toLowerCase()));

      const inserted = toInsert.length
        ? await db
          .insert(customSkills)
          .values(
            toInsert.map((s) => ({
              userId,
              name: s.name,
              description: s.description,
              instructions: s.instructions,
              category: s.category,
              enabled: s.enabled ?? true,
              features: s.features,
              triggers: triggersToDb(s.triggers),
              updatedAt: new Date(),
            }))
          )
          .returning()
        : [];

      return res.json({
        imported: inserted.map(toClientSkill),
        skipped: parsed.data.skills.length - inserted.length,
      });
    } catch (error: any) {
      console.error("[SkillsRouter] import error:", error);
      return res.status(503).json({ error: "Database unavailable" });
    }
  });

  // GET /api/skills/library/fluid
  // Preview: catálogo de capacidades funcionales listas para activar.
  router.get("/library/fluid", async (_req, res) => {
    return res.json({
      total: FLUID_FUNCTIONAL_SKILLS.length,
      skills: FLUID_FUNCTIONAL_SKILLS,
    });
  });

  // POST /api/skills/bootstrap/fluid
  // Inserta el pack "fluid functional" (20 skills) evitando duplicados por nombre.
  router.post("/bootstrap/fluid", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    await ensureUserRowExists(userId);

    try {
      const existing = await db
        .select({ name: customSkills.name })
        .from(customSkills)
        .where(eq(customSkills.userId, userId));

      const existingNames = new Set(existing.map((r) => (r.name || "").trim().toLowerCase()).filter(Boolean));
      const toInsert = FLUID_FUNCTIONAL_SKILLS.filter((s) => !existingNames.has(s.name.trim().toLowerCase()));

      const inserted = toInsert.length
        ? await db
          .insert(customSkills)
          .values(
            toInsert.map((s) => ({
              userId,
              name: s.name,
              description: s.description,
              instructions: s.instructions,
              category: s.category,
              enabled: true,
              features: s.features,
              triggers: triggersToDb(s.triggers),
              updatedAt: new Date(),
            }))
          )
          .returning()
        : [];

      return res.json({
        catalogTotal: FLUID_FUNCTIONAL_SKILLS.length,
        importedCount: inserted.length,
        skippedCount: FLUID_FUNCTIONAL_SKILLS.length - inserted.length,
        imported: inserted.map(toClientSkill),
      });
    } catch (error: any) {
      console.error("[SkillsRouter] bootstrap fluid error:", error);
      return res.status(503).json({ error: "Database unavailable" });
    }
  });

  // POST /api/skills/ensure
  // Ensure a skill exists (by name, if provided). If it doesn't, generate + create it.
  //
  // This enables single-prompt flows like:
  // "@{Mi Skill} haz X..." when "Mi Skill" doesn't exist yet.
  router.post("/ensure", generateSkillRateLimiter, async (req, res) => {
    const parsed = ensureSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
    }

    const userId = getOrCreateSecureUserId(req);
    await ensureUserRowExists(userId);

    const desiredName = typeof parsed.data.name === "string" ? parsed.data.name.trim() : "";
    const prompt = parsed.data.prompt.trim();

    try {
      if (desiredName) {
        const existing = await db
          .select()
          .from(customSkills)
          .where(and(
            eq(customSkills.userId, userId),
            sql`lower(trim(${customSkills.name})) = ${normalizeName(desiredName)}`
          ))
          .limit(1);

        if (existing[0]) {
          return res.json({ skill: toClientSkill(existing[0]), created: false });
        }
      }

      const generationPrompt = desiredName
        ? `IMPORTANTE: El nombre del skill debe ser EXACTAMENTE: "${desiredName}".\n\n${prompt}`
        : prompt;

      const generated = await generateSkillFromPrompt(generationPrompt, { userId });
      const name = desiredName || generated.name;

      const [created] = await db
        .insert(customSkills)
        .values({
          userId,
          name,
          description: generated.description,
          instructions: generated.instructions,
          category: generated.category,
          enabled: true,
          features: generated.features,
          triggers: triggersToDb(generated.triggers),
          updatedAt: new Date(),
        })
        .returning();

      return res.status(201).json({ skill: toClientSkill(created), created: true });
    } catch (error: any) {
      console.error("[SkillsRouter] ensure error:", error);
      return res.status(503).json({ error: "Database unavailable" });
    }
  });

  // POST /api/skills/generate
  // Generates a Skill spec (name/description/instructions/etc.) from a single prompt.
  router.post("/generate", generateSkillRateLimiter, async (req, res) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
    }

    const userId = getOrCreateSecureUserId(req);

    try {
      const skill = await generateSkillFromPrompt(parsed.data.prompt, { userId });
      return res.json({ skill });
    } catch (error: any) {
      console.error("[SkillsRouter] generate error:", error);
      return res.status(500).json({ error: error?.message || "Failed to generate skill" });
    }
  });

  return router;
}
