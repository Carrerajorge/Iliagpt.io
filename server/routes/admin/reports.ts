import { Router } from "express";
import { AuthenticatedRequest } from "../../types/express";
import { storage } from "../../storage";
import { auditLog, AuditActions } from "../../services/auditLogger";
import ExcelJS from "exceljs";
import * as fs from "node:fs/promises";
import path from "node:path";

function toSafeDownloadBaseName(value: string | null | undefined): string {
    const input = (value || "").trim();
    const sanitized = input
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 200);
    return sanitized || "report";
}

function toPdfText(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object") {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

async function generateSimplePdfReport(title: string, rows: Array<Record<string, unknown>>): Promise<Buffer> {
    // Lazy import to avoid hard startup dependency for servers that don't use PDF export.
    const { default: PDFDocument } = await import("pdfkit");
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));

    const done = new Promise<Buffer>((resolve, reject) => {
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
    });

    doc.fontSize(20).text(title);
    doc.moveDown(0.25);
    doc.fontSize(10).fillColor("gray").text(`Generated: ${new Date().toISOString()} | Rows: ${rows.length}`);
    doc.fillColor("black");
    doc.moveDown();

    const keys = rows.length > 0 ? Object.keys(rows[0] || {}) : [];
    const maxRows = 200;
    const slice = rows.slice(0, maxRows);
    if (rows.length > maxRows) {
        doc.fontSize(10).fillColor("gray").text(`Showing first ${maxRows} rows (PDF export is summary-friendly).`);
        doc.fillColor("black");
        doc.moveDown();
    }

    for (let idx = 0; idx < slice.length; idx++) {
        const row = slice[idx];
        doc.fontSize(12).text(`Row ${idx + 1}`, { underline: true });
        doc.moveDown(0.25);
        for (const key of keys) {
            doc.fontSize(10).text(`${key}: ${toPdfText(row?.[key])}`);
        }
        doc.moveDown();

        const pageBottom = doc.page.height - doc.page.margins.bottom;
        if (doc.y > pageBottom - 60) doc.addPage();
    }

    doc.end();
    return done;
}

// SECURITY FIX #48: CSV formula injection prevention
// Characters that trigger formula execution in spreadsheet applications
const CSV_INJECTION_CHARS = ['=', '+', '-', '@', '\t', '\r', '\n'];

function sanitizeCsvValue(value: any): string {
    if (value === null || value === undefined) return "";

    let str = typeof value === "object" ? JSON.stringify(value) : String(value);

    // Escape double quotes by doubling them
    str = str.replace(/"/g, '""');

    // If value starts with dangerous characters, prefix with single quote (standard CSV protection)
    if (CSV_INJECTION_CHARS.some(char => str.startsWith(char))) {
        str = "'" + str;
    }

    // Wrap in quotes if contains comma, newline, or quote
    if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
        str = `"${str}"`;
    }

    return str;
}

export const reportsRouter = Router();

// Get all report templates
reportsRouter.get("/templates", async (req, res) => {
    try {
        let templates = await storage.getReportTemplates();

        // Seed system templates if none exist
        if (templates.length === 0) {
            const systemTemplates = [
                {
                    name: "Users Report",
                    type: "user_report",
                    description: "Export all users with their plan, role, and status information",
                    columns: [
                        { key: "email", label: "Email", type: "string" },
                        { key: "fullName", label: "Name", type: "string" },
                        { key: "plan", label: "Plan", type: "string" },
                        { key: "role", label: "Role", type: "string" },
                        { key: "status", label: "Status", type: "string" },
                        { key: "createdAt", label: "Created At", type: "date" }
                    ],
                    filters: [
                        { key: "plan", label: "Plan", type: "select" },
                        { key: "status", label: "Status", type: "select" },
                        { key: "role", label: "Role", type: "select" }
                    ],
                    isSystem: "true"
                },
                {
                    name: "AI Models Report",
                    type: "ai_models_report",
                    description: "Export all AI models with provider and usage information",
                    columns: [
                        { key: "name", label: "Name", type: "string" },
                        { key: "provider", label: "Provider", type: "string" },
                        { key: "modelId", label: "Model ID", type: "string" },
                        { key: "isEnabled", label: "Enabled", type: "boolean" },
                        { key: "modelType", label: "Type", type: "string" }
                    ],
                    filters: [
                        { key: "provider", label: "Provider", type: "select" },
                        { key: "isEnabled", label: "Enabled", type: "boolean" }
                    ],
                    isSystem: "true"
                },
                {
                    name: "Security Audit Report",
                    type: "security_report",
                    description: "Export audit logs for security analysis",
                    columns: [
                        { key: "createdAt", label: "Timestamp", type: "date" },
                        { key: "action", label: "Action", type: "string" },
                        { key: "resource", label: "Resource", type: "string" },
                        { key: "ipAddress", label: "IP Address", type: "string" },
                        { key: "details", label: "Details", type: "json" }
                    ],
                    filters: [
                        { key: "action", label: "Action", type: "select" },
                        { key: "resource", label: "Resource", type: "select" }
                    ],
                    isSystem: "true"
                },
                {
                    name: "Financial Summary",
                    type: "financial_report",
                    description: "Export payment and revenue data",
                    columns: [
                        { key: "createdAt", label: "Date", type: "date" },
                        { key: "amount", label: "Amount", type: "number" },
                        { key: "status", label: "Status", type: "string" },
                        { key: "method", label: "Method", type: "string" }
                    ],
                    filters: [
                        { key: "status", label: "Status", type: "select" }
                    ],
                    isSystem: "true"
                }
            ];

            for (const template of systemTemplates) {
                await storage.createReportTemplate(template as any);
            }
            templates = await storage.getReportTemplates();
        }

        res.json(templates);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get single report template
reportsRouter.get("/templates/:id", async (req, res) => {
    try {
        const template = await storage.getReportTemplate(req.params.id);
        if (!template) {
            return res.status(404).json({ error: "Template not found" });
        }
        res.json(template);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Create custom template
reportsRouter.post("/templates", async (req, res) => {
    try {
        const { name, type, description, columns, filters, groupBy } = req.body;
        if (!name || !type || !columns) {
            return res.status(400).json({ error: "name, type, and columns are required" });
        }
        const template = await storage.createReportTemplate({
            name, type, description, columns, filters, groupBy, isSystem: "false"
        });
        res.json(template);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

reportsRouter.get("/", async (req, res) => {
    try {
        const reports = await storage.getReports();
        res.json(reports);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

reportsRouter.post("/", async (req, res) => {
    try {
        const report = await storage.createReport({
            ...req.body,
            status: "pending"
        });
        res.json(report);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

reportsRouter.patch("/:id", async (req, res) => {
    try {
        const report = await storage.updateReport(req.params.id, req.body);
        if (!report) {
            return res.status(404).json({ error: "Report not found" });
        }
        res.json(report);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get generated reports with pagination
reportsRouter.get("/generated", async (req, res) => {
    try {
        const { page = "1", limit = "20" } = req.query;
        const pageNum = parseInt(page as string);
        const limitNum = Math.min(parseInt(limit as string), 100);

        const reports = await storage.getGeneratedReports(limitNum * pageNum);
        const paginatedReports = reports.slice((pageNum - 1) * limitNum, pageNum * limitNum);

        res.json({
            data: paginatedReports,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: reports.length,
                totalPages: Math.ceil(reports.length / limitNum)
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Generate a new report
reportsRouter.post("/generate", async (req, res) => {
    try {
        const { templateId, name, parameters, format = "json" } = req.body;
        const userId = (req as AuthenticatedRequest).user?.id || null;

        // Get template if provided
        let template;
        let reportType = "custom";
        let reportName = name || "Custom Report";

        if (templateId) {
            template = await storage.getReportTemplate(templateId);
            if (!template) {
                return res.status(404).json({ error: "Template not found" });
            }
            reportType = template.type;
            reportName = name || template.name;
        }

        // Create report record
        const report = await storage.createGeneratedReport({
            templateId,
            name: reportName,
            type: reportType,
            status: "processing",
            parameters: parameters || {},
            format,
            generatedBy: userId
        });

        // Generate report data asynchronously
        (async () => {
            try {
                let data: any[] = [];
                let rowCount = 0;

                switch (reportType) {
                    case "user_report":
                        const users = await storage.getAllUsers();
                        data = users.map(u => ({
                            email: u.email,
                            fullName: u.fullName || u.username,
                            plan: u.plan,
                            role: u.role,
                            status: u.status,
                            createdAt: u.createdAt
                        }));
                        break;

                    case "ai_models_report":
                        const models = await storage.getAiModels();
                        data = models.map(m => ({
                            name: m.name,
                            provider: m.provider,
                            modelId: m.modelId,
                            isEnabled: m.isEnabled,
                            modelType: m.modelType || "text"
                        }));
                        break;

                    case "security_report":
                        const logs = await storage.getAuditLogs(1000);
                        data = logs.map(l => ({
                            createdAt: l.createdAt,
                            action: l.action,
                            resource: l.resource,
                            ipAddress: l.ipAddress || "N/A",
                            details: l.details
                        }));
                        break;

                    case "financial_report":
                        const payments = await storage.getPayments();
                        data = payments.map(p => ({
                            createdAt: p.createdAt,
                            amount: p.amount,
                            status: p.status,
                            method: p.method || "N/A"
                        }));
                        break;

                    default:
                        data = [];
                }

                rowCount = data.length;

                // Save to file (report.id ensures uniqueness across runs)
                const reportsDir = path.join(process.cwd(), "generated_reports");
                await fs.mkdir(reportsDir, { recursive: true });

                const normalizedFormat = String(format || "json").toLowerCase();
                const fileName = `${report.id}.${normalizedFormat}`;
                const filePath = path.join(reportsDir, fileName);

                if (normalizedFormat === "json") {
                    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
                } else if (normalizedFormat === "csv") {
                    // Secure CSV generation with formula injection protection
                    if (data.length > 0) {
                        const headers = Object.keys(data[0]);
                        const csvRows = [headers.map(h => sanitizeCsvValue(h)).join(",")];
                        for (const row of data) {
                            csvRows.push(headers.map((h: string) => {
                                const val = (row as any)[h];
                                return sanitizeCsvValue(val);
                            }).join(","));
                        }
                        await fs.writeFile(filePath, csvRows.join("\n"), "utf-8");
                    } else {
                        await fs.writeFile(filePath, "", "utf-8");
                    }
                } else if (normalizedFormat === "xlsx") {
                    const workbook = new ExcelJS.Workbook();
                    const sheet = workbook.addWorksheet(reportType.substring(0, 31) || "Report");

                    const keys = data.length > 0 ? Object.keys(data[0]) : [];
                    sheet.columns = keys.map((key) => ({ header: key, key, width: Math.min(40, Math.max(12, key.length + 2)) }));
                    sheet.getRow(1).font = { bold: true };

                    for (const row of data) {
                        // Ensure we only include known keys to keep column order stable.
                        const record: Record<string, any> = {};
                        for (const key of keys) record[key] = row?.[key];
                        sheet.addRow(record);
                    }

                    await workbook.xlsx.writeFile(filePath);
                } else if (normalizedFormat === "pdf") {
                    const pdf = await generateSimplePdfReport(reportName, data as Array<Record<string, unknown>>);
                    await fs.writeFile(filePath, pdf);
                } else {
                    throw new Error(`Unsupported report format: ${normalizedFormat}`);
                }

                // Update report status
                await storage.updateGeneratedReport(report.id, {
                    status: "completed",
                    filePath: fileName,
                    resultSummary: { rowCount },
                    completedAt: new Date()
                });

            } catch (err: any) {
                await storage.updateGeneratedReport(report.id, {
                    status: "failed",
                    resultSummary: { rowCount: 0, aggregates: { error: err.message } }
                });
            }
        })();

        res.json(report);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Download generated report
reportsRouter.get("/download/:id", async (req, res) => {
    try {
        const report = await storage.getGeneratedReport(req.params.id);
        if (!report) {
            return res.status(404).json({ error: "Report not found" });
        }
        if (report.status !== "completed") {
            return res.status(400).json({ error: "Report is not ready for download" });
        }

        const reportsDir = path.join(process.cwd(), "generated_reports");

        const normalizedFormat = String(report.format || "json").toLowerCase();
        const preferredFile = report.filePath ? path.resolve(reportsDir, report.filePath) : null;
        const safePrefix = path.resolve(reportsDir) + path.sep;

        let filePath: string | null = null;
        if (preferredFile && preferredFile.startsWith(safePrefix)) {
            const exists = await fs.stat(preferredFile).then(() => true).catch(() => false);
            if (exists) filePath = preferredFile;
        }

        // Backward compatibility: older reports used name-based search and stored an API URL in filePath.
        if (!filePath) {
            const files = await fs.readdir(reportsDir).catch(() => []);
            const found = files.find((f: string) => f.includes(report.type) && f.endsWith(`.${normalizedFormat}`));
            if (found) filePath = path.join(reportsDir, found);
        }

        if (!filePath) {
            return res.status(404).json({ error: "Report file not found" });
        }

        const buffer = await fs.readFile(filePath);
        const contentType =
            normalizedFormat === "json" ? "application/json" :
            normalizedFormat === "csv" ? "text/csv" :
            normalizedFormat === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :
            normalizedFormat === "pdf" ? "application/pdf" :
            "application/octet-stream";

        res.setHeader("Content-Type", contentType);
        const downloadName = `${toSafeDownloadBaseName(report.name)}.${normalizedFormat}`;
        res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
        res.send(buffer);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Delete generated report
reportsRouter.delete("/generated/:id", async (req, res) => {
    try {
        await storage.deleteGeneratedReport(req.params.id);
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
