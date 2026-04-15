import { Router, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";

export function createCustomAgentsRouter(): Router {
  const router = Router();

  // Helper to extract the acting user id from auth or anonymous header
  function getActorId(req: Request): string | null {
    return (req as any).user?.id || (req.headers["x-anonymous-user-id"] as string) || null;
  }

  // GET /api/custom-agents - list user's own agents + public agents
  router.get("/api/custom-agents", async (req: Request, res: Response) => {
    const actorId = getActorId(req);
    if (!actorId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const result = await db.execute(
        sql`SELECT * FROM custom_agents WHERE user_id = ${actorId} OR is_public = true ORDER BY updated_at DESC`
      );
      return res.json(result.rows);
    } catch (error: any) {
      console.error("[CustomAgents] List error:", error);
      return res.status(500).json({ error: error.message });
    }
  });

  // GET /api/custom-agents/explore - public agents ordered by popularity
  router.get("/api/custom-agents/explore", async (req: Request, res: Response) => {
    const actorId = getActorId(req);
    if (!actorId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const result = await db.execute(
        sql`SELECT * FROM custom_agents WHERE is_public = true ORDER BY usage_count DESC`
      );
      return res.json(result.rows);
    } catch (error: any) {
      console.error("[CustomAgents] Explore error:", error);
      return res.status(500).json({ error: error.message });
    }
  });

  // GET /api/custom-agents/:id - get a single agent
  router.get("/api/custom-agents/:id", async (req: Request, res: Response) => {
    const actorId = getActorId(req);
    if (!actorId) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;

    try {
      const result = await db.execute(
        sql`SELECT * FROM custom_agents WHERE id = ${id} AND (user_id = ${actorId} OR is_public = true)`
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Agent not found" });
      }
      return res.json(result.rows[0]);
    } catch (error: any) {
      console.error("[CustomAgents] Get error:", error);
      return res.status(500).json({ error: error.message });
    }
  });

  // POST /api/custom-agents - create a new agent
  router.post("/api/custom-agents", async (req: Request, res: Response) => {
    const actorId = getActorId(req);
    if (!actorId) return res.status(401).json({ error: "Unauthorized" });

    const {
      name,
      description,
      avatar_emoji,
      system_prompt,
      model,
      temperature,
      tools,
      knowledge_files,
      conversation_starters,
      is_public,
      category,
    } = req.body;

    if (!name || !system_prompt) {
      return res.status(400).json({ error: "name and system_prompt are required" });
    }

    try {
      const result = await db.execute(
        sql`INSERT INTO custom_agents (user_id, name, description, avatar_emoji, system_prompt, model, temperature, tools, knowledge_files, conversation_starters, is_public, category, created_at, updated_at)
            VALUES (${actorId}, ${name}, ${description ?? null}, ${avatar_emoji ?? null}, ${system_prompt}, ${model ?? null}, ${temperature ?? null}, ${tools ? JSON.stringify(tools) : null}::jsonb, ${knowledge_files ? JSON.stringify(knowledge_files) : null}::jsonb, ${conversation_starters ? JSON.stringify(conversation_starters) : null}::jsonb, ${is_public ?? false}, ${category ?? null}, NOW(), NOW())
            RETURNING *`
      );
      return res.status(201).json(result.rows[0]);
    } catch (error: any) {
      console.error("[CustomAgents] Create error:", error);
      return res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/custom-agents/:id - update an agent (owner only)
  router.put("/api/custom-agents/:id", async (req: Request, res: Response) => {
    const actorId = getActorId(req);
    if (!actorId) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const {
      name,
      description,
      avatar_emoji,
      system_prompt,
      model,
      temperature,
      tools,
      knowledge_files,
      conversation_starters,
      is_public,
      category,
    } = req.body;

    try {
      // Verify ownership
      const existing = await db.execute(
        sql`SELECT * FROM custom_agents WHERE id = ${id} AND user_id = ${actorId}`
      );
      if (existing.rows.length === 0) {
        return res.status(403).json({ error: "Forbidden: you do not own this agent" });
      }

      const result = await db.execute(
        sql`UPDATE custom_agents
            SET name = COALESCE(${name ?? null}, name),
                description = COALESCE(${description ?? null}, description),
                avatar_emoji = COALESCE(${avatar_emoji ?? null}, avatar_emoji),
                system_prompt = COALESCE(${system_prompt ?? null}, system_prompt),
                model = COALESCE(${model ?? null}, model),
                temperature = COALESCE(${temperature ?? null}, temperature),
                tools = COALESCE(${tools ? JSON.stringify(tools) : null}::jsonb, tools),
                knowledge_files = COALESCE(${knowledge_files ? JSON.stringify(knowledge_files) : null}::jsonb, knowledge_files),
                conversation_starters = COALESCE(${conversation_starters ? JSON.stringify(conversation_starters) : null}::jsonb, conversation_starters),
                is_public = COALESCE(${is_public ?? null}, is_public),
                category = COALESCE(${category ?? null}, category),
                updated_at = NOW()
            WHERE id = ${id} AND user_id = ${actorId}
            RETURNING *`
      );
      return res.json(result.rows[0]);
    } catch (error: any) {
      console.error("[CustomAgents] Update error:", error);
      return res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/custom-agents/:id - delete an agent (owner only)
  router.delete("/api/custom-agents/:id", async (req: Request, res: Response) => {
    const actorId = getActorId(req);
    if (!actorId) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;

    try {
      const result = await db.execute(
        sql`DELETE FROM custom_agents WHERE id = ${id} AND user_id = ${actorId} RETURNING *`
      );
      if (result.rows.length === 0) {
        return res.status(403).json({ error: "Forbidden: you do not own this agent or it does not exist" });
      }
      return res.json({ message: "Agent deleted", agent: result.rows[0] });
    } catch (error: any) {
      console.error("[CustomAgents] Delete error:", error);
      return res.status(500).json({ error: error.message });
    }
  });

  // POST /api/custom-agents/:id/duplicate - duplicate a public agent to user's account
  router.post("/api/custom-agents/:id/duplicate", async (req: Request, res: Response) => {
    const actorId = getActorId(req);
    if (!actorId) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;

    try {
      const original = await db.execute(
        sql`SELECT * FROM custom_agents WHERE id = ${id} AND is_public = true`
      );
      if (original.rows.length === 0) {
        return res.status(404).json({ error: "Public agent not found" });
      }

      const agent = original.rows[0] as any;

      const result = await db.execute(
        sql`INSERT INTO custom_agents (user_id, name, description, avatar_emoji, system_prompt, model, temperature, tools, knowledge_files, conversation_starters, is_public, category, created_at, updated_at)
            VALUES (${actorId}, ${agent.name + ' (copy)'}, ${agent.description}, ${agent.avatar_emoji}, ${agent.system_prompt}, ${agent.model}, ${agent.temperature}, ${agent.tools}::jsonb, ${agent.knowledge_files}::jsonb, ${agent.conversation_starters}::jsonb, false, ${agent.category}, NOW(), NOW())
            RETURNING *`
      );
      return res.status(201).json(result.rows[0]);
    } catch (error: any) {
      console.error("[CustomAgents] Duplicate error:", error);
      return res.status(500).json({ error: error.message });
    }
  });

  // POST /api/custom-agents/:id/use - increment usage_count
  router.post("/api/custom-agents/:id/use", async (req: Request, res: Response) => {
    const actorId = getActorId(req);
    if (!actorId) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;

    try {
      const result = await db.execute(
        sql`UPDATE custom_agents SET usage_count = usage_count + 1 WHERE id = ${id} RETURNING *`
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Agent not found" });
      }
      return res.json(result.rows[0]);
    } catch (error: any) {
      console.error("[CustomAgents] Use error:", error);
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}
