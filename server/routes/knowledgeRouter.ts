import { Router } from "express";
import { knowledgeBaseService } from "../services/knowledgeBase";

export const knowledgeRouter = Router();

function getUserId(req: any): string | undefined {
    return req?.user?.claims?.sub || req?.user?.id;
}

knowledgeRouter.get("/", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ error: "Not authenticated" });

        const { q, limit, types, tags } = req.query as { q?: string; limit?: string; types?: string; tags?: string };
        const parsedLimit = limit ? parseInt(limit, 10) : 20;
        const nodeTypes = types ? types.split(",").map(t => t.trim()).filter(Boolean) : undefined;
        const tagList = tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : undefined;

        if (q && q.trim().length > 0) {
            const results = await knowledgeBaseService.search(userId, q, {
                limit: parsedLimit,
                nodeTypes,
                tags: tagList,
            });
            return res.json(results);
        }

        const nodes = await knowledgeBaseService.listNodes(userId, {
            limit: parsedLimit,
            nodeTypes,
            tags: tagList,
        });
        return res.json(nodes);
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || "Failed to load knowledge" });
    }
});

knowledgeRouter.get("/:id", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ error: "Not authenticated" });

        const node = await knowledgeBaseService.getNode(userId, req.params.id);
        if (!node) return res.status(404).json({ error: "Not found" });

        const related = await knowledgeBaseService.getRelated(userId, node.id);
        return res.json({ node, related });
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || "Failed to load node" });
    }
});

knowledgeRouter.post("/", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ error: "Not authenticated" });

        const { title, content, nodeType, sourceType, sourceId, tags, metadata, importance } = req.body || {};
        if (!title || !content) {
            return res.status(400).json({ error: "title and content are required" });
        }

        const node = await knowledgeBaseService.createNode(userId, {
            title,
            content,
            nodeType,
            sourceType,
            sourceId,
            tags,
            metadata,
            importance,
        });

        return res.json(node);
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || "Failed to create node" });
    }
});

knowledgeRouter.post("/:id/relate", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ error: "Not authenticated" });

        const { targetId, relationType, weight, metadata } = req.body || {};
        if (!targetId || !relationType) {
            return res.status(400).json({ error: "targetId and relationType are required" });
        }

        const edge = await knowledgeBaseService.addEdge(userId, {
            sourceNodeId: req.params.id,
            targetNodeId: targetId,
            relationType,
            weight,
            metadata,
        });

        return res.json({ edge });
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || "Failed to create relation" });
    }
});

knowledgeRouter.get("/:id/related", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ error: "Not authenticated" });

        const related = await knowledgeBaseService.getRelated(userId, req.params.id);
        return res.json(related);
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || "Failed to load relations" });
    }
});

knowledgeRouter.post("/export", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ error: "Not authenticated" });

        const { outputDir, nodeIds, tags } = req.body || {};
        if (!outputDir) return res.status(400).json({ error: "outputDir is required" });

        const result = await knowledgeBaseService.exportToObsidian(userId, { outputDir, nodeIds, tags });
        return res.json(result);
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || "Failed to export" });
    }
});

knowledgeRouter.post("/backfill", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ error: "Not authenticated" });

        const { limit, since, includeDocuments } = req.body || {};
        const result = await knowledgeBaseService.backfillUser(userId, {
            limit: typeof limit === "number" ? limit : undefined,
            since: typeof since === "string" ? since : undefined,
            includeDocuments: typeof includeDocuments === "boolean" ? includeDocuments : true,
        });

        return res.json(result);
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || "Failed to backfill" });
    }
});
