/**
 * Memory & Personalization API Routes
 */

import { Router } from "express";
import { memoryService } from "../services/memoryService";
import { 
  ragService, 
  personalizationService, 
  workspaceContextService,
  buildEnhancedContext 
} from "../services/ragService";

export const memoryRouter = Router();

// ============= MEMORY ENDPOINTS =============

// GET /api/memory - Get user memories
memoryRouter.get("/", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const { types, limit = 50, minImportance = 0 } = req.query;
    
    const memories = await memoryService.retrieve(userId, {
      types: types ? (types as string).split(',') as any[] : undefined,
      limit: parseInt(limit as string),
      minImportance: parseFloat(minImportance as string)
    });
    
    res.json(memories);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/memory - Store a memory
memoryRouter.post("/", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const { type, content, importance, context } = req.body;
    
    if (!type || !content) {
      return res.status(400).json({ error: "type and content are required" });
    }
    
    const id = await memoryService.store(userId, type, content, { importance, context });
    
    res.json({ id, success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/memory/:id - Delete a memory
memoryRouter.delete("/:id", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const success = await memoryService.delete(userId, req.params.id);
    
    res.json({ success });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/memory/stats - Get memory statistics
memoryRouter.get("/stats", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const stats = await memoryService.getStats(userId);
    
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/memory/extract - Extract memories from messages
memoryRouter.post("/extract", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const { messages } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array is required" });
    }
    
    const extracted = await memoryService.extractFromConversation(userId, messages);
    
    res.json({ extracted, success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/memory/context - Get memory context for prompt injection
memoryRouter.get("/context", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const context = await memoryService.getContextMemories(userId);
    
    res.json({ context });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============= PERSONALIZATION ENDPOINTS =============

// GET /api/memory/preferences - Get user preferences
memoryRouter.get("/preferences", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const preferences = await personalizationService.getPreferences(userId);
    
    res.json(preferences);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/memory/preferences - Update user preferences
memoryRouter.patch("/preferences", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    await personalizationService.updatePreferences(userId, req.body);
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/memory/learn - Learn from conversation
memoryRouter.post("/learn", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const { messages } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array is required" });
    }
    
    await personalizationService.learnFromConversation(userId, messages);
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============= RAG ENDPOINTS =============

// POST /api/memory/index - Index a message for RAG
memoryRouter.post("/index", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const { chatId, content, role } = req.body;
    
    if (!chatId || !content || !role) {
      return res.status(400).json({ error: "chatId, content, and role are required" });
    }
    
    await ragService.indexMessage(userId, chatId, content, role);
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/memory/search - Search indexed messages
memoryRouter.post("/search", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const { query, limit = 5, chatId, minScore = 0.3 } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }
    
    const results = await ragService.search(userId, query, { limit, chatId, minScore });
    
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============= ENHANCED CONTEXT ENDPOINT =============

// POST /api/memory/enhanced-context - Get full enhanced context
memoryRouter.post("/enhanced-context", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const { message, chatId } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }
    
    const context = await buildEnhancedContext(userId, message, chatId);
    
    res.json({ context });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============= WORKSPACE CONTEXT =============

// POST /api/memory/workspace/index - Index a file
memoryRouter.post("/workspace/index", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const { filePath, content, fileType } = req.body;
    
    if (!filePath || !content) {
      return res.status(400).json({ error: "filePath and content are required" });
    }
    
    await workspaceContextService.indexFile(userId, filePath, content, fileType || 'text');
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/memory/workspace/search - Search workspace files
memoryRouter.post("/workspace/search", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const { query, limit = 5 } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }
    
    const files = await workspaceContextService.getRelevantFiles(userId, query, limit);
    
    res.json(files);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
