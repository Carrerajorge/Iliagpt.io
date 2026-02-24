/**
 * API Keys Management
 * Create, manage, and rotate API keys
 */

import { Router } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { generateApiKey, hashApiKey, maskSensitive } from "../services/encryption";
import { auditLog } from "../services/auditLogger";

export const apiKeysRouter = Router();

const ALLOWED_PERMISSIONS = ["read", "write", "delete", "admin"] as const;

// Ensure table exists
const ensureTable = async () => {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS api_keys (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        key_hash VARCHAR(255) NOT NULL,
        key_prefix VARCHAR(20) NOT NULL,
        permissions JSONB DEFAULT '["read"]',
        rate_limit INTEGER DEFAULT 1000,
        last_used_at TIMESTAMP,
        expires_at TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`);
  } catch (e) {
    // Table might exist
  }
};

ensureTable();

// GET /api/api-keys - List user's API keys
apiKeysRouter.get("/", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const result = await db.execute(sql`
      SELECT id, name, key_prefix, permissions, rate_limit, last_used_at, expires_at, is_active, created_at
      FROM api_keys 
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `);
    
    res.json(result.rows || []);
  } catch (error: any) {
    console.error("[API Keys] List error:", error);
    res.status(500).json({ error: "Failed to list API keys" });
  }
});

// POST /api/api-keys - Create new API key
apiKeysRouter.post("/", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const { name, permissions = ["read"], rateLimit = 1000, expiresIn } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    // Validate permissions against allowed values
    if (!Array.isArray(permissions) || !permissions.every(p => typeof p === 'string' && ALLOWED_PERMISSIONS.includes(p as any))) {
      return res.status(400).json({ error: `Invalid permissions. Allowed values: ${ALLOWED_PERMISSIONS.join(', ')}` });
    }

    // Validate rateLimit
    if (typeof rateLimit !== 'number' || rateLimit < 1 || rateLimit > 100000) {
      return res.status(400).json({ error: "rateLimit must be a number between 1 and 100000" });
    }
    
    // Generate key
    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);
    const keyPrefix = apiKey.slice(0, 12) + "...";
    
    // Calculate expiry
    let expiresAt = null;
    if (expiresIn) {
      const days = parseInt(expiresIn);
      if (!isNaN(days)) {
        expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      }
    }
    
    const result = await db.execute(sql`
      INSERT INTO api_keys (user_id, name, key_hash, key_prefix, permissions, rate_limit, expires_at)
      VALUES (${userId}, ${name}, ${keyHash}, ${keyPrefix}, ${JSON.stringify(permissions)}, ${rateLimit}, ${expiresAt})
      RETURNING id, name, key_prefix, permissions, rate_limit, expires_at, created_at
    `);
    
    await auditLog(req, {
      action: "api_key.created",
      resource: "api_keys",
      resourceId: result.rows?.[0]?.id,
      details: { name, permissions },
      category: "security",
      severity: "warning"
    });
    
    // Return the full key only once
    res.json({
      ...result.rows?.[0],
      key: apiKey,
      message: "Save this key now. You won't be able to see it again."
    });
  } catch (error: any) {
    console.error("[API Keys] Create error:", error);
    res.status(500).json({ error: "Failed to create API key" });
  }
});

// PATCH /api/api-keys/:id - Update API key
apiKeysRouter.patch("/:id", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const { name, permissions, rateLimit, isActive } = req.body;
    
    // Validate permissions if provided
    if (permissions !== undefined) {
      if (!Array.isArray(permissions) || !permissions.every((p: any) => typeof p === 'string' && ALLOWED_PERMISSIONS.includes(p as any))) {
        return res.status(400).json({ error: `Invalid permissions. Allowed values: ${ALLOWED_PERMISSIONS.join(', ')}` });
      }
    }

    // Validate rateLimit if provided
    if (rateLimit !== undefined && (typeof rateLimit !== 'number' || rateLimit < 1 || rateLimit > 100000)) {
      return res.status(400).json({ error: "rateLimit must be a number between 1 and 100000" });
    }

    const result = await db.execute(sql`
      UPDATE api_keys SET
        name = COALESCE(${name}, name),
        permissions = COALESCE(${permissions ? JSON.stringify(permissions) : null}, permissions),
        rate_limit = COALESCE(${rateLimit}, rate_limit),
        is_active = COALESCE(${isActive}, is_active),
        updated_at = NOW()
      WHERE id = ${req.params.id} AND user_id = ${userId}
      RETURNING id, name, key_prefix, permissions, rate_limit, is_active
    `);
    
    if (!result.rows?.length) {
      return res.status(404).json({ error: "API key not found" });
    }
    
    res.json(result.rows[0]);
  } catch (error: any) {
    console.error("[API Keys] Update error:", error);
    res.status(500).json({ error: "Failed to update API key" });
  }
});

// DELETE /api/api-keys/:id - Delete API key
apiKeysRouter.delete("/:id", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const result = await db.execute(sql`
      DELETE FROM api_keys WHERE id = ${req.params.id} AND user_id = ${userId}
      RETURNING id, name
    `);
    
    if (!result.rows?.length) {
      return res.status(404).json({ error: "API key not found" });
    }
    
    await auditLog(req, {
      action: "api_key.deleted",
      resource: "api_keys",
      resourceId: req.params.id,
      details: { name: result.rows[0].name },
      category: "security",
      severity: "warning"
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error("[API Keys] Delete error:", error);
    res.status(500).json({ error: "Failed to delete API key" });
  }
});

// POST /api/api-keys/:id/rotate - Rotate API key
apiKeysRouter.post("/:id/rotate", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    // Verify key exists
    const existing = await db.execute(sql`
      SELECT id, name FROM api_keys WHERE id = ${req.params.id} AND user_id = ${userId}
    `);
    
    if (!existing.rows?.length) {
      return res.status(404).json({ error: "API key not found" });
    }
    
    // Generate new key
    const newKey = generateApiKey();
    const newHash = hashApiKey(newKey);
    const newPrefix = newKey.slice(0, 12) + "...";
    
    await db.execute(sql`
      UPDATE api_keys SET 
        key_hash = ${newHash},
        key_prefix = ${newPrefix},
        updated_at = NOW()
      WHERE id = ${req.params.id} AND user_id = ${userId}
    `);
    
    await auditLog(req, {
      action: "api_key.rotated",
      resource: "api_keys",
      resourceId: req.params.id,
      details: { name: existing.rows[0].name },
      category: "security",
      severity: "warning"
    });
    
    res.json({
      id: req.params.id,
      key: newKey,
      key_prefix: newPrefix,
      message: "Key rotated. Save this new key now."
    });
  } catch (error: any) {
    console.error("[API Keys] Rotate error:", error);
    res.status(500).json({ error: "Failed to rotate API key" });
  }
});

// ============= MIDDLEWARE FOR API KEY AUTH =============

export async function validateApiKey(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith("Bearer ilgpt_")) {
    return next(); // Not an API key, try other auth
  }
  
  const apiKey = authHeader.slice(7);
  const keyHash = hashApiKey(apiKey);
  
  try {
    const result = await db.execute(sql`
      SELECT ak.*, u.id as uid, u.email, u.role
      FROM api_keys ak
      JOIN users u ON ak.user_id = u.id
      WHERE ak.key_hash = ${keyHash}
      AND ak.is_active = true
      AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
    `);
    
    if (!result.rows?.length) {
      return res.status(401).json({ error: "Invalid or expired API key" });
    }
    
    const keyData = result.rows[0];
    
    // Update last used
    await db.execute(sql`
      UPDATE api_keys SET last_used_at = NOW() WHERE id = ${keyData.id}
    `);
    
    // Set user on request
    req.user = {
      id: keyData.uid,
      email: keyData.email,
      role: keyData.role
    };
    req.apiKey = {
      id: keyData.id,
      permissions: keyData.permissions,
      rateLimit: keyData.rate_limit
    };
    
    next();
  } catch (error) {
    console.error("[API Key] Validation error:", error);
    return res.status(500).json({ error: "Authentication failed" });
  }
}
