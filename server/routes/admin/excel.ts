/**
 * Excel Manager Admin Routes — Hardened
 * Parameterised queries, input validation, safe errors, audit logging.
 */

import { Router } from "express";
import { storage } from "../../storage";
import { auditLog, AuditActions } from "../../services/auditLogger";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const excelRouter = Router();

const MAX_NAME_LENGTH = 255;
const MAX_DATA_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_SHEETS = 50;
const UUID_PATTERN = /^[a-zA-Z0-9_-]{4,128}$/;

function sanitizeText(value: unknown, maxLen: number): string | null {
    if (typeof value !== "string") return null;
    const cleaned = value.replace(/[\u0000-\u001f]/g, " ").trim();
    return cleaned ? cleaned.slice(0, maxLen) : null;
}

function validateId(id: string): boolean {
    return UUID_PATTERN.test(id);
}

// GET /api/admin/excel/list - List all Excel documents
excelRouter.get("/list", async (req, res) => {
    try {
        const result = await db.execute(sql`
            SELECT id, name, sheets, size, created_at, updated_at, created_by
            FROM excel_documents
            ORDER BY updated_at DESC
            LIMIT 100
        `).catch(() => ({ rows: [] }));

        res.json(result.rows || []);
    } catch (error: any) {
        res.status(500).json({ error: "Failed to list Excel documents" });
    }
});

// GET /api/admin/excel/:id - Get single document
excelRouter.get("/:id", async (req, res) => {
    try {
        if (!validateId(req.params.id)) {
            return res.status(400).json({ error: "Invalid document ID" });
        }

        const result = await db.execute(sql`
            SELECT * FROM excel_documents WHERE id = ${req.params.id}
        `).catch(() => ({ rows: [] }));

        if (!result.rows?.length) {
            return res.status(404).json({ error: "Document not found" });
        }

        res.json(result.rows[0]);
    } catch (error: any) {
        res.status(500).json({ error: "Failed to fetch document" });
    }
});

excelRouter.get("/sheets", async (_req, res) => {
    try {
        res.json([]);
    } catch (error: any) {
        res.status(500).json({ error: "Failed to list sheets" });
    }
});

// POST /api/admin/excel/save - Save Excel document
excelRouter.post("/save", async (req, res) => {
    try {
        const { id, name: rawName, data } = req.body;

        // Validate ID
        if (!id || typeof id !== "string") {
            return res.status(400).json({ error: "Document ID is required" });
        }
        if (!validateId(id)) {
            return res.status(400).json({ error: "Invalid document ID format" });
        }

        // Validate name
        const name = sanitizeText(rawName, MAX_NAME_LENGTH);
        if (!name) {
            return res.status(400).json({ error: "Document name is required (max 255 chars)" });
        }

        // Validate data size
        const dataStr = JSON.stringify(data || []);
        if (dataStr.length > MAX_DATA_SIZE_BYTES) {
            return res.status(400).json({ error: `Data exceeds maximum size (${MAX_DATA_SIZE_BYTES / 1024 / 1024} MB)` });
        }

        // Validate sheet count
        const sheetCount = Array.isArray(data) ? data.length : 1;
        if (sheetCount > MAX_SHEETS) {
            return res.status(400).json({ error: `Too many sheets (max ${MAX_SHEETS})` });
        }

        const createdBy = (req as any).user?.email || "admin";

        // Upsert document — fully parameterised
        await db.execute(sql`
            INSERT INTO excel_documents (id, name, data, sheets, size, created_by, updated_at)
            VALUES (${id}, ${name}, ${dataStr}, ${sheetCount}, ${dataStr.length}, ${createdBy}, NOW())
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                data = EXCLUDED.data,
                sheets = EXCLUDED.sheets,
                size = EXCLUDED.size,
                updated_at = NOW()
        `);

        await auditLog(req, {
            action: "excel.saved",
            resource: "excel_documents",
            resourceId: id,
            details: { name, sheets: sheetCount, sizeBytes: dataStr.length, savedBy: createdBy },
            category: "data",
            severity: "info",
        });

        res.json({ success: true, id, name });
    } catch (error: any) {
        console.error("[Excel] Save error:", error.message);
        res.status(500).json({ error: "Failed to save document" });
    }
});

// DELETE /api/admin/excel/:id - Delete Excel document
excelRouter.delete("/:id", async (req, res) => {
    try {
        if (!validateId(req.params.id)) {
            return res.status(400).json({ error: "Invalid document ID" });
        }

        // Check existence before delete
        const existing = await db.execute(sql`
            SELECT name FROM excel_documents WHERE id = ${req.params.id}
        `);

        if (!existing.rows?.length) {
            return res.status(404).json({ error: "Document not found" });
        }

        await db.execute(sql`
            DELETE FROM excel_documents WHERE id = ${req.params.id}
        `);

        await auditLog(req, {
            action: "excel.deleted",
            resource: "excel_documents",
            resourceId: req.params.id,
            details: { name: existing.rows[0].name, deletedBy: (req as any).user?.email },
            category: "data",
            severity: "warning",
        });

        res.json({ success: true });
    } catch (error: any) {
        console.error("[Excel] Delete error:", error.message);
        res.status(500).json({ error: "Failed to delete document" });
    }
});

excelRouter.post("/export", async (req, res) => {
    try {
        const { data, filename: rawFilename } = req.body;
        const filename = sanitizeText(rawFilename, 200) || "export.xlsx";

        await auditLog(req, {
            action: AuditActions.ADMIN_EXPORT_DATA,
            resource: "excel",
            details: { filename, exportedBy: (req as any).user?.email },
            category: "data",
            severity: "info",
        });

        res.json({ success: true, message: "Export logged" });
    } catch (error: any) {
        res.status(500).json({ error: "Failed to export" });
    }
});
