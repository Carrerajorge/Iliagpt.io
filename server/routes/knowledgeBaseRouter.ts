/**
 * Knowledge Base Router — CRUD for collections, document upload, and search.
 */

import { Router, type Request, type Response } from "express";
import { getUserId } from "../types/express";
import multer from "multer";
import {
  createCollection,
  listCollections,
  getCollection,
  deleteCollection,
  addDocument,
  listDocuments,
  removeDocument,
} from "../rag/knowledgeBase";
import { search } from "../rag/vectorStore";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

export function createKnowledgeBaseRouter(): Router {
  const router = Router();

  // List all collections for the current user
  router.get("/collections", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    try {
      const collections = await listCollections(userId);
      return res.json({ collections });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to list collections" });
    }
  });

  // Create a new collection
  router.post("/collections", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    const { name, description } = req.body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Name is required" });
    }

    try {
      const collection = await createCollection({ userId, name: name.trim(), description });
      return res.status(201).json({ collection });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to create collection" });
    }
  });

  // Get a specific collection
  router.get("/collections/:id", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    try {
      const collection = await getCollection(userId, req.params.id);
      if (!collection) return res.status(404).json({ error: "Collection not found" });
      const documents = await listDocuments(userId, req.params.id);
      return res.json({ collection, documents });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to get collection" });
    }
  });

  // Delete a collection
  router.delete("/collections/:id", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    try {
      await deleteCollection(userId, req.params.id);
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to delete collection" });
    }
  });

  // Upload a document to a collection
  router.post(
    "/collections/:id/documents",
    upload.single("file"),
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Auth required" });

      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });

      try {
        const result = await addDocument({
          collectionId: req.params.id,
          userId,
          file: {
            buffer: file.buffer,
            filename: file.originalname,
            mimeType: file.mimetype,
          },
        });

        return res.status(201).json(result);
      } catch (err: any) {
        return res.status(500).json({ error: err?.message || "Failed to process document" });
      }
    },
  );

  // List documents in a collection
  router.get("/collections/:id/documents", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    try {
      const documents = await listDocuments(userId, req.params.id);
      return res.json({ documents });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to list documents" });
    }
  });

  // Remove a document from a collection
  router.delete("/documents/:docId", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    try {
      const removed = await removeDocument(userId, req.params.docId);
      if (!removed) return res.status(404).json({ error: "Document not found" });
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to remove document" });
    }
  });

  // Search across all user's knowledge bases
  router.post("/search", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    const { query, collectionId, topK, hybrid } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Query is required" });
    }

    try {
      const results = await search({
        query,
        userId,
        topK: topK || 10,
        collectionId,
        hybrid: hybrid !== false,
      });
      return res.json({ results });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Search failed" });
    }
  });

  return router;
}
