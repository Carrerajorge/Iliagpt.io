/**
 * Document Version Control (#80)
 * Version history and rollback for documents
 */

import crypto from 'crypto';
import { db } from '../db';
import { sql } from 'drizzle-orm';

// ============================================
// TYPES
// ============================================

interface DocumentVersion {
    id: string;
    documentId: string;
    version: number;
    content: string;
    title: string;
    metadata?: Record<string, any>;
    createdAt: Date;
    createdBy: number;
    changeDescription?: string;
    checksum: string;
    size: number;
}

interface VersionDiff {
    additions: number;
    deletions: number;
    changes: DiffChange[];
}

interface DiffChange {
    type: 'add' | 'remove' | 'unchanged';
    line: number;
    content: string;
}

// ============================================
// VERSION CONTROL SERVICE
// ============================================

class DocumentVersionControl {
    private versions = new Map<string, DocumentVersion[]>();
    private maxVersions = 50;

    /**
     * Create initial version
     */
    async createVersion(
        documentId: string,
        content: string,
        title: string,
        userId: number,
        description?: string
    ): Promise<DocumentVersion> {
        const existingVersions = this.versions.get(documentId) || [];
        const nextVersion = existingVersions.length + 1;

        const version: DocumentVersion = {
            id: crypto.randomUUID(),
            documentId,
            version: nextVersion,
            content,
            title,
            createdAt: new Date(),
            createdBy: userId,
            changeDescription: description || `Version ${nextVersion}`,
            checksum: this.calculateChecksum(content),
            size: content.length,
        };

        // Add to history
        existingVersions.push(version);

        // Limit versions
        if (existingVersions.length > this.maxVersions) {
            existingVersions.shift();
        }

        this.versions.set(documentId, existingVersions);

        return version;
    }

    /**
     * Get version history
     */
    getHistory(documentId: string): DocumentVersion[] {
        return this.versions.get(documentId) || [];
    }

    /**
     * Get specific version
     */
    getVersion(documentId: string, version: number): DocumentVersion | null {
        const versions = this.versions.get(documentId) || [];
        return versions.find(v => v.version === version) || null;
    }

    /**
     * Get latest version
     */
    getLatest(documentId: string): DocumentVersion | null {
        const versions = this.versions.get(documentId) || [];
        return versions[versions.length - 1] || null;
    }

    /**
     * Restore a previous version
     */
    async restore(
        documentId: string,
        version: number,
        userId: number
    ): Promise<DocumentVersion | null> {
        const targetVersion = this.getVersion(documentId, version);

        if (!targetVersion) {
            return null;
        }

        // Create new version with old content
        return this.createVersion(
            documentId,
            targetVersion.content,
            targetVersion.title,
            userId,
            `Restored from version ${version}`
        );
    }

    /**
     * Compare two versions
     */
    compare(documentId: string, v1: number, v2: number): VersionDiff | null {
        const version1 = this.getVersion(documentId, v1);
        const version2 = this.getVersion(documentId, v2);

        if (!version1 || !version2) {
            return null;
        }

        const lines1 = version1.content.split('\n');
        const lines2 = version2.content.split('\n');

        // Simple line-by-line diff
        const changes: DiffChange[] = [];
        let additions = 0;
        let deletions = 0;

        const maxLines = Math.max(lines1.length, lines2.length);

        for (let i = 0; i < maxLines; i++) {
            const line1 = lines1[i];
            const line2 = lines2[i];

            if (line1 === undefined) {
                changes.push({ type: 'add', line: i + 1, content: line2 });
                additions++;
            } else if (line2 === undefined) {
                changes.push({ type: 'remove', line: i + 1, content: line1 });
                deletions++;
            } else if (line1 !== line2) {
                changes.push({ type: 'remove', line: i + 1, content: line1 });
                changes.push({ type: 'add', line: i + 1, content: line2 });
                additions++;
                deletions++;
            }
        }

        return { additions, deletions, changes };
    }

    /**
     * Calculate content checksum
     */
    private calculateChecksum(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
    }

    /**
     * Auto-save with change detection
     */
    async autoSave(
        documentId: string,
        content: string,
        title: string,
        userId: number
    ): Promise<DocumentVersion | null> {
        const latest = this.getLatest(documentId);

        // Skip if no changes
        if (latest) {
            const newChecksum = this.calculateChecksum(content);
            if (latest.checksum === newChecksum) {
                return null;
            }
        }

        return this.createVersion(documentId, content, title, userId, 'Auto-save');
    }

    /**
     * Get version statistics
     */
    getStats(documentId: string): {
        totalVersions: number;
        firstVersion?: Date;
        lastVersion?: Date;
        contributors: number[];
        totalEdits: number;
    } {
        const versions = this.versions.get(documentId) || [];

        return {
            totalVersions: versions.length,
            firstVersion: versions[0]?.createdAt,
            lastVersion: versions[versions.length - 1]?.createdAt,
            contributors: [...new Set(versions.map(v => v.createdBy))],
            totalEdits: versions.length,
        };
    }

    /**
     * Clean up old versions (keep last N)
     */
    cleanup(documentId: string, keepCount: number = 20): number {
        const versions = this.versions.get(documentId) || [];
        const toRemove = versions.length - keepCount;

        if (toRemove > 0) {
            versions.splice(0, toRemove);
            this.versions.set(documentId, versions);
            return toRemove;
        }

        return 0;
    }
}

// Singleton
export const documentVersions = new DocumentVersionControl();

// ============================================
// EXPRESS ROUTER
// ============================================

import { Router, Request, Response } from 'express';

export function createVersionRouter(): Router {
    const router = Router();

    // Get version history
    router.get('/:documentId/history', (req: Request, res: Response) => {
        const { documentId } = req.params;
        const history = documentVersions.getHistory(documentId);

        // Return without full content for listing
        const summary = history.map(v => ({
            id: v.id,
            version: v.version,
            title: v.title,
            createdAt: v.createdAt,
            createdBy: v.createdBy,
            changeDescription: v.changeDescription,
            size: v.size,
        }));

        res.json(summary);
    });

    // Get specific version
    router.get('/:documentId/version/:version', (req: Request, res: Response) => {
        const { documentId, version } = req.params;
        const v = documentVersions.getVersion(documentId, parseInt(version));

        if (!v) {
            return res.status(404).json({ error: 'Version not found' });
        }

        res.json(v);
    });

    // Compare versions
    router.get('/:documentId/compare', (req: Request, res: Response) => {
        const { documentId } = req.params;
        const v1 = parseInt(req.query.v1 as string);
        const v2 = parseInt(req.query.v2 as string);

        const diff = documentVersions.compare(documentId, v1, v2);

        if (!diff) {
            return res.status(404).json({ error: 'Versions not found' });
        }

        res.json(diff);
    });

    // Restore version
    router.post('/:documentId/restore/:version', async (req: Request, res: Response) => {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { documentId, version } = req.params;
        const restored = await documentVersions.restore(documentId, parseInt(version), userId);

        if (!restored) {
            return res.status(404).json({ error: 'Version not found' });
        }

        res.json({ message: 'Version restored', version: restored });
    });

    // Get stats
    router.get('/:documentId/stats', (req: Request, res: Response) => {
        const { documentId } = req.params;
        const stats = documentVersions.getStats(documentId);
        res.json(stats);
    });

    return router;
}
