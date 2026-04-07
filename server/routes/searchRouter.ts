import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { hybridSearch, type SearchResultType } from "../search/unifiedSearch";
import { getSecureUserId } from "../lib/anonUserHelper";
import { createLogger } from "../utils/logger";

const log = createLogger("search-router");

const router = Router();

/**
 * GET /api/search?q=text&type=all|messages|chats|documents&from=date&to=date&model=string&limit=20&offset=0
 *
 * Advanced hybrid search combining full-text (tsvector) and semantic (pgvector)
 * results via Reciprocal Rank Fusion.
 */
router.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const { q, type, from, to, model, limit, offset } = req.query;

    if (!q || typeof q !== "string" || !q.trim()) {
      return res.status(400).json({ error: "Query parameter 'q' is required" });
    }

    const userId = getSecureUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const validTypes: SearchResultType[] = ["message", "chat", "document"];
    let types: SearchResultType[] | undefined;
    if (type && type !== "all") {
      const requested = String(type).split(",").map((t) => t.trim()) as SearchResultType[];
      types = requested.filter((t) => validTypes.includes(t));
      if (types.length === 0) types = undefined;
    }

    const results = await hybridSearch({
      query: q.trim(),
      userId,
      types,
      dateFrom: from ? new Date(from as string) : undefined,
      dateTo: to ? new Date(to as string) : undefined,
      model: model as string | undefined,
      limit: Math.min(parseInt(limit as string) || 20, 100),
      offset: Math.max(parseInt(offset as string) || 0, 0),
    });

    res.json(results);
  } catch (err) {
    log.error("Search endpoint error", { error: err });
    res.status(500).json({ error: "Internal search error" });
  }
});

export default router;
