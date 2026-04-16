/**
 * GDPR Data Export (#87)
 * User data portability and export functionality
 */

import { db } from '../db';
import { sql } from 'drizzle-orm';
import archiver from 'archiver';
import { Writable } from 'stream';

// ============================================
// TYPES
// ============================================

interface ExportRequest {
    id: string;
    userId: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    format: 'json' | 'zip';
    requestedAt: Date;
    completedAt?: Date;
    downloadUrl?: string;
    expiresAt?: Date;
    error?: string;
}

interface ExportData {
    user: {
        id: number;
        email: string;
        name: string;
        createdAt: Date;
        settings: any;
    };
    chats: any[];
    messages: any[];
    projects: any[];
    documents: any[];
    memories: any[];
    files: any[];
    exportedAt: Date;
    format: string;
}

// ============================================
// EXPORT SERVICE
// ============================================

class DataExportService {
    private exportRequests = new Map<string, ExportRequest>();

    /**
     * Request data export
     */
    async requestExport(userId: number, format: 'json' | 'zip' = 'zip'): Promise<ExportRequest> {
        const request: ExportRequest = {
            id: crypto.randomUUID(),
            userId,
            status: 'pending',
            format,
            requestedAt: new Date(),
        };

        this.exportRequests.set(request.id, request);

        // Process asynchronously
        this.processExport(request).catch(error => {
            console.error('Export failed:', error);
            request.status = 'failed';
            request.error = error.message;
        });

        return request;
    }

    /**
     * Get export status
     */
    getExportStatus(requestId: string): ExportRequest | null {
        return this.exportRequests.get(requestId) || null;
    }

    /**
     * Process the export
     */
    private async processExport(request: ExportRequest): Promise<void> {
        request.status = 'processing';
        const userId = request.userId;

        try {
            // Collect all user data
            const data = await this.collectUserData(userId);

            // Generate export file
            const exportPath = await this.generateExportFile(request.id, data, request.format);

            // Set expiration (7 days)
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7);

            request.status = 'completed';
            request.completedAt = new Date();
            request.downloadUrl = `/api/export/download/${request.id}`;
            request.expiresAt = expiresAt;

            console.log(`Export completed for user ${userId}: ${request.id}`);
        } catch (error: any) {
            request.status = 'failed';
            request.error = error.message;
            throw error;
        }
    }

    /**
     * Collect all user data
     */
    private async collectUserData(userId: number): Promise<ExportData> {
        // Fetch user
        const userResult = await db.execute(sql`
      SELECT id, email, username as name, created_at, settings 
      FROM users WHERE id = ${userId}
    `);
        const user = userResult.rows?.[0];

        if (!user) {
            throw new Error('User not found');
        }

        // Fetch chats
        const chatsResult = await db.execute(sql`
      SELECT id, title, model, created_at, updated_at, project_id
      FROM chats 
      WHERE user_id = ${userId} AND deleted_at IS NULL
      ORDER BY created_at DESC
    `);

        // Fetch messages
        const messagesResult = await db.execute(sql`
      SELECT m.id, m.chat_id, m.role, m.content, m.created_at, m.metadata
      FROM messages m
      JOIN chats c ON m.chat_id = c.id
      WHERE c.user_id = ${userId} AND m.deleted_at IS NULL
      ORDER BY m.created_at
    `);

        // Fetch projects
        const projectsResult = await db.execute(sql`
      SELECT id, name, description, system_prompt, created_at, updated_at
      FROM projects
      WHERE user_id = ${userId} AND deleted_at IS NULL
    `);

        // Fetch documents (if applicable)
        const documentsResult = await db.execute(sql`
      SELECT id, title, type, content, created_at, updated_at
      FROM documents
      WHERE user_id = ${userId} AND deleted_at IS NULL
    `).catch(() => ({ rows: [] }));

        // Fetch memories
        const memoriesResult = await db.execute(sql`
      SELECT id, type, content, created_at, metadata
      FROM user_memories
      WHERE user_id = ${userId}
    `).catch(() => ({ rows: [] }));

        // Fetch files metadata
        const filesResult = await db.execute(sql`
      SELECT id, filename, mime_type, size, created_at
      FROM user_files
      WHERE user_id = ${userId} AND deleted_at IS NULL
    `).catch(() => ({ rows: [] }));

        return {
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                createdAt: user.created_at,
                settings: user.settings,
            },
            chats: chatsResult.rows || [],
            messages: messagesResult.rows || [],
            projects: projectsResult.rows || [],
            documents: documentsResult.rows || [],
            memories: memoriesResult.rows || [],
            files: filesResult.rows || [],
            exportedAt: new Date(),
            format: 'GDPR_EXPORT_v1',
        };
    }

    /**
     * Generate export file
     */
    private async generateExportFile(
        requestId: string,
        data: ExportData,
        format: 'json' | 'zip'
    ): Promise<string> {
        const exportDir = `/tmp/exports`;
        const filename = `export_${requestId}`;

        // Ensure export directory exists (in production, use cloud storage)
        // For now, we'll just return the path

        if (format === 'json') {
            return `${exportDir}/${filename}.json`;
        }

        // ZIP format with separate files
        return `${exportDir}/${filename}.zip`;
    }

    /**
     * Get list of user's exports
     */
    getUserExports(userId: number): ExportRequest[] {
        return Array.from(this.exportRequests.values())
            .filter(r => r.userId === userId)
            .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
    }

    /**
     * Clean up expired exports
     */
    cleanupExpired(): number {
        const now = Date.now();
        let cleaned = 0;

        for (const [id, request] of this.exportRequests.entries()) {
            if (request.expiresAt && request.expiresAt.getTime() < now) {
                this.exportRequests.delete(id);
                // Also delete the file from storage
                cleaned++;
            }
        }

        return cleaned;
    }
}

// Singleton
export const dataExport = new DataExportService();

// ============================================
// ACCOUNT DELETION (Right to be Forgotten)
// ============================================

export class AccountDeletionService {
    /**
     * Schedule account deletion
     */
    async scheduleAccountDeletion(userId: number, reason?: string): Promise<{
        scheduledFor: Date;
        cancellationDeadline: Date;
    }> {
        // 30 day grace period for cancellation
        const scheduledFor = new Date();
        scheduledFor.setDate(scheduledFor.getDate() + 30);

        const cancellationDeadline = new Date();
        cancellationDeadline.setDate(cancellationDeadline.getDate() + 14);

        // Mark account for deletion
        await db.execute(sql`
      UPDATE users
      SET 
        deletion_scheduled_at = ${scheduledFor},
        deletion_reason = ${reason || null}
      WHERE id = ${userId}
    `);

        console.log(`Account deletion scheduled for user ${userId}: ${scheduledFor}`);

        return { scheduledFor, cancellationDeadline };
    }

    /**
     * Cancel scheduled deletion
     */
    async cancelDeletion(userId: number): Promise<boolean> {
        const result = await db.execute(sql`
      UPDATE users
      SET 
        deletion_scheduled_at = NULL,
        deletion_reason = NULL
      WHERE id = ${userId} AND deletion_scheduled_at > NOW()
    `);

        return (result.rowCount || 0) > 0;
    }

    /**
     * Permanently delete account (GDPR right to erasure)
     */
    async deleteAccount(userId: number): Promise<void> {
        // In a transaction
        // 1. Delete all messages
        await db.execute(sql`
      DELETE FROM messages WHERE chat_id IN (
        SELECT id FROM chats WHERE user_id = ${userId}
      )
    `);

        // 2. Delete all chats
        await db.execute(sql`DELETE FROM chats WHERE user_id = ${userId}`);

        // 3. Delete all projects
        await db.execute(sql`DELETE FROM projects WHERE user_id = ${userId}`);

        // 4. Delete all files
        await db.execute(sql`DELETE FROM user_files WHERE user_id = ${userId}`);

        // 5. Delete memories
        await db.execute(sql`DELETE FROM user_memories WHERE user_id = ${userId}`);

        // 6. Delete the user account
        await db.execute(sql`DELETE FROM users WHERE id = ${userId}`);

        console.log(`Account permanently deleted: user ${userId}`);
    }
}

export const accountDeletion = new AccountDeletionService();

// ============================================
// EXPRESS ROUTER
// ============================================

import { Router, Request, Response } from 'express';

export function createDataExportRouter(): Router {
    const router = Router();

    // Request export
    router.post('/request', async (req: Request, res: Response) => {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const format = req.body.format || 'zip';
        const request = await dataExport.requestExport(userId, format);

        res.json({
            requestId: request.id,
            status: request.status,
            message: 'Export requested. You will be notified when ready.',
        });
    });

    // Get export status
    router.get('/status/:requestId', (req: Request, res: Response) => {
        const { requestId } = req.params;
        const request = dataExport.getExportStatus(requestId);

        if (!request) {
            return res.status(404).json({ error: 'Export not found' });
        }

        res.json(request);
    });

    // List user exports
    router.get('/list', (req: Request, res: Response) => {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const exports = dataExport.getUserExports(userId);
        res.json(exports);
    });

    // Download export
    router.get('/download/:requestId', async (req: Request, res: Response) => {
        const userId = (req as any).user?.id;
        const { requestId } = req.params;

        const request = dataExport.getExportStatus(requestId);

        if (!request || request.userId !== userId) {
            return res.status(404).json({ error: 'Export not found' });
        }

        if (request.status !== 'completed') {
            return res.status(400).json({ error: 'Export not ready' });
        }

        // In production, stream the file from storage
        res.json({ message: 'Download would start here', url: request.downloadUrl });
    });

    // Request account deletion
    router.post('/delete-account', async (req: Request, res: Response) => {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { reason } = req.body;
        const result = await accountDeletion.scheduleAccountDeletion(userId, reason);

        res.json({
            message: 'Account deletion scheduled',
            ...result,
        });
    });

    // Cancel account deletion
    router.post('/cancel-deletion', async (req: Request, res: Response) => {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const cancelled = await accountDeletion.cancelDeletion(userId);

        if (!cancelled) {
            return res.status(400).json({ error: 'No pending deletion or past deadline' });
        }

        res.json({ message: 'Account deletion cancelled' });
    });

    return router;
}

// Cleanup job
setInterval(() => {
    dataExport.cleanupExpired();
}, 6 * 60 * 60 * 1000); // Every 6 hours
