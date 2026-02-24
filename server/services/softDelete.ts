/**
 * Soft Delete Pattern (#86)
 * Recoverable deletion with retention policies
 */

import { db } from '../db';
import { sql } from 'drizzle-orm';

// ============================================
// TYPES
// ============================================

interface SoftDeleteOptions {
    retention?: number; // Days to retain before permanent deletion
    cascade?: boolean;  // Soft delete related entities
    reason?: string;    // Deletion reason for audit
}

interface DeletedEntity {
    id: string | number;
    tableName: string;
    data: any;
    deletedAt: Date;
    deletedBy: number | null;
    expiresAt: Date;
    reason?: string;
}

// ============================================
// SOFT DELETE SERVICE
// ============================================

class SoftDeleteService {
    private defaultRetention = 30; // 30 days

    /**
     * Soft delete an entity
     */
    async softDelete(
        tableName: string,
        id: string | number,
        userId: number | null,
        options: SoftDeleteOptions = {}
    ): Promise<boolean> {
        const retention = options.retention || this.defaultRetention;
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + retention);

        try {
            // Get current data before marking as deleted
            const entity = await db.execute(sql`
        SELECT * FROM ${sql.identifier(tableName)} 
        WHERE id = ${id} AND deleted_at IS NULL
        LIMIT 1
      `);

            if (!entity.rows?.[0]) {
                return false;
            }

            // Mark as deleted
            await db.execute(sql`
        UPDATE ${sql.identifier(tableName)}
        SET 
          deleted_at = NOW(),
          deleted_by = ${userId},
          expires_at = ${expiresAt}
        WHERE id = ${id}
      `);

            // Log deletion for audit
            console.log(`[SoftDelete] ${tableName}:${id} deleted by user ${userId}, expires ${expiresAt}`);

            return true;
        } catch (error) {
            console.error(`[SoftDelete] Error soft deleting ${tableName}:${id}:`, error);
            throw error;
        }
    }

    /**
     * Restore a soft-deleted entity
     */
    async restore(
        tableName: string,
        id: string | number,
        userId: number | null
    ): Promise<boolean> {
        try {
            const result = await db.execute(sql`
        UPDATE ${sql.identifier(tableName)}
        SET 
          deleted_at = NULL,
          deleted_by = NULL,
          expires_at = NULL,
          restored_at = NOW(),
          restored_by = ${userId}
        WHERE id = ${id} AND deleted_at IS NOT NULL
      `);

            const success = (result.rowCount || 0) > 0;

            if (success) {
                console.log(`[SoftDelete] ${tableName}:${id} restored by user ${userId}`);
            }

            return success;
        } catch (error) {
            console.error(`[SoftDelete] Error restoring ${tableName}:${id}:`, error);
            throw error;
        }
    }

    /**
     * Get deleted entities for a user (trash)
     */
    async getDeletedByUser(
        tableName: string,
        userId: number,
        options: { limit?: number; offset?: number } = {}
    ): Promise<DeletedEntity[]> {
        const { limit = 50, offset = 0 } = options;

        try {
            const result = await db.execute(sql`
        SELECT 
          id, 
          deleted_at,
          deleted_by,
          expires_at,
          *
        FROM ${sql.identifier(tableName)}
        WHERE 
          deleted_at IS NOT NULL 
          AND (deleted_by = ${userId} OR user_id = ${userId})
          AND expires_at > NOW()
        ORDER BY deleted_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `);

            return result.rows?.map((row: any) => ({
                id: row.id,
                tableName,
                data: row,
                deletedAt: row.deleted_at,
                deletedBy: row.deleted_by,
                expiresAt: row.expires_at,
            })) || [];
        } catch (error) {
            console.error(`[SoftDelete] Error getting deleted ${tableName}:`, error);
            return [];
        }
    }

    /**
     * Permanently delete expired entities (cleanup job)
     */
    async purgeExpired(tableName: string): Promise<number> {
        try {
            const result = await db.execute(sql`
        DELETE FROM ${sql.identifier(tableName)}
        WHERE deleted_at IS NOT NULL AND expires_at < NOW()
      `);

            const count = result.rowCount || 0;

            if (count > 0) {
                console.log(`[SoftDelete] Purged ${count} expired entities from ${tableName}`);
            }

            return count;
        } catch (error) {
            console.error(`[SoftDelete] Error purging ${tableName}:`, error);
            return 0;
        }
    }

    /**
     * Force permanent deletion (admin only)
     */
    async permanentDelete(tableName: string, id: string | number): Promise<boolean> {
        try {
            const result = await db.execute(sql`
        DELETE FROM ${sql.identifier(tableName)}
        WHERE id = ${id}
      `);

            return (result.rowCount || 0) > 0;
        } catch (error) {
            console.error(`[SoftDelete] Error permanently deleting ${tableName}:${id}:`, error);
            throw error;
        }
    }

    /**
     * Empty trash for user
     */
    async emptyTrash(tableName: string, userId: number): Promise<number> {
        try {
            const result = await db.execute(sql`
        DELETE FROM ${sql.identifier(tableName)}
        WHERE 
          deleted_at IS NOT NULL 
          AND (deleted_by = ${userId} OR user_id = ${userId})
      `);

            const count = result.rowCount || 0;
            console.log(`[SoftDelete] User ${userId} emptied trash: ${count} items from ${tableName}`);

            return count;
        } catch (error) {
            console.error(`[SoftDelete] Error emptying trash for user ${userId}:`, error);
            return 0;
        }
    }
}

// Singleton
export const softDelete = new SoftDeleteService();

// ============================================
// DRIZZLE HELPERS
// ============================================

/**
 * Add soft delete columns to a table schema
 * Usage: Add these columns to your Drizzle schema
 */
export const softDeleteColumns = {
    deletedAt: 'timestamp("deleted_at")',
    deletedBy: 'integer("deleted_by")',
    expiresAt: 'timestamp("expires_at")',
    restoredAt: 'timestamp("restored_at")',
    restoredBy: 'integer("restored_by")',
};

/**
 * Query modifier to exclude soft deleted
 */
export function whereNotDeleted() {
    return sql`deleted_at IS NULL`;
}

/**
 * Query modifier to only get soft deleted
 */
export function whereDeleted() {
    return sql`deleted_at IS NOT NULL AND expires_at > NOW()`;
}

// ============================================
// EXPRESS ROUTER
// ============================================

import { Router, Request, Response } from 'express';

export function createTrashRouter(): Router {
    const router = Router();

    // Get trash
    router.get('/:table', async (req: Request, res: Response) => {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { table } = req.params;
        const allowedTables = ['chats', 'messages', 'projects', 'documents'];

        if (!allowedTables.includes(table)) {
            return res.status(400).json({ error: 'Invalid table' });
        }

        const items = await softDelete.getDeletedByUser(table, userId);
        res.json(items);
    });

    // Restore item
    router.post('/:table/:id/restore', async (req: Request, res: Response) => {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { table, id } = req.params;
        const success = await softDelete.restore(table, id, userId);

        if (!success) {
            return res.status(404).json({ error: 'Item not found or already restored' });
        }

        res.json({ success: true, message: 'Item restored' });
    });

    // Empty trash
    router.delete('/:table', async (req: Request, res: Response) => {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { table } = req.params;
        const count = await softDelete.emptyTrash(table, userId);

        res.json({ success: true, deletedCount: count });
    });

    return router;
}

// ============================================
// CLEANUP JOB
// ============================================

const TABLES_WITH_SOFT_DELETE = ['chats', 'messages', 'projects', 'documents'];

export async function runSoftDeleteCleanup(): Promise<void> {
    console.log('[SoftDelete] Starting cleanup job...');

    for (const table of TABLES_WITH_SOFT_DELETE) {
        const purged = await softDelete.purgeExpired(table);
        if (purged > 0) {
            console.log(`[SoftDelete] Purged ${purged} expired items from ${table}`);
        }
    }

    console.log('[SoftDelete] Cleanup job complete');
}

// Run cleanup daily
setInterval(runSoftDeleteCleanup, 24 * 60 * 60 * 1000);
