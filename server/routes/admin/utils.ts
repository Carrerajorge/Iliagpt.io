import { Request, Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../types/express";
import { storage } from "../../storage";
import { db } from "../../db";
import { users, excelDocuments } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { auditLog, AuditActions } from "../../services/auditLogger";

// SECURITY: Admin emails come from env; DB role is the preferred source of truth.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase(); // legacy
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const ADMIN_EMAIL_ALLOWLIST = Array.from(new Set([ADMIN_EMAIL, ...ADMIN_EMAILS].filter(Boolean)));

function maskEmail(email?: string | null): string | undefined {
  if (!email) return undefined;
  if (email.length <= 3) return "***";
  return `${email.slice(0, 3)}***`;
}

function maskId(id?: string | null): string | undefined {
  if (!id) return undefined;
  if (id.length <= 8) return `${id.slice(0, 3)}***`;
  return `${id.slice(0, 8)}***`;
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
    try {
        const userReq = req as AuthenticatedRequest;
        const session = (req as any).session as any | undefined;

        const rawEmail =
            userReq.user?.claims?.email ||
            (userReq.user as any)?.email ||
            session?.passport?.user?.claims?.email ||
            session?.passport?.user?.email ||
            (req as any).user?.profile?.emails?.[0]?.value ||
            (req as any).user?.email;
        const userEmail = rawEmail ? String(rawEmail).toLowerCase().trim() : null;

        const passportUser = session?.passport?.user;
        const rawUserId =
            userReq.user?.claims?.sub ||
            (userReq.user as any)?.id ||
            session?.authUserId ||
            (typeof passportUser === "string" ? passportUser : undefined) ||
            passportUser?.claims?.sub ||
            passportUser?.id ||
            passportUser?.sub;
        const userId = rawUserId ? String(rawUserId) : null;

        if (!userId && !userEmail) {
            return res.status(401).json({ error: "Authentication required" });
        }

        let isAdmin = false;

        // Preferred: DB role check
        if (userId) {
            const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
            isAdmin = user?.role === "admin";
        }

        // Fallback: DB role check by email (useful when the session isn't bound to a DB id yet)
        if (!isAdmin && userEmail) {
            const [user] = await db
                .select({ role: users.role })
                .from(users)
                .where(sql`LOWER(${users.email}) = ${userEmail}`)
                .limit(1);
            isAdmin = user?.role === "admin";
        }

        // Last resort: env allowlist (initial bootstrap)
        if (!isAdmin && userEmail && ADMIN_EMAIL_ALLOWLIST.length > 0 && ADMIN_EMAIL_ALLOWLIST.includes(userEmail)) {
            isAdmin = true;
            console.warn(`[Admin] Using email allowlist fallback for: ${maskEmail(userEmail)}`);
        }

        if (!isAdmin) {
            await auditLog(req, {
                action: AuditActions.ADMIN_DENIED,
                resource: "admin_panel",
                details: {
                    email: maskEmail(userEmail),
                    userId: maskId(userId),
                    path: req.path,
                    ip: req.ip,
                },
                category: "admin",
                severity: "warning",
            });
            return res.status(403).json({ error: "Admin access restricted" });
        }

        // Propagate role for downstream middleware (e.g. 2FA enforcement).
        if (userReq.user && typeof userReq.user === "object") {
            (userReq.user as any).role = "admin";
        } else {
            const existingUser = (req as any).user;
            (req as any).user = { ...(existingUser || {}), role: "admin" };
        }
        (req as any).isAdmin = true;

        next();
    } catch (error) {
        console.error("[Admin] Authorization check failed:", error instanceof Error ? error.message : "Unknown error");
        return res.status(500).json({ error: "Authorization check failed" });
    }
}

export async function seedDefaultExcelDocuments() {
    const existing = await db.select().from(excelDocuments).limit(1);
    if (existing.length === 0) {
        await db.insert(excelDocuments).values([
            {
                uuid: nanoid(),
                name: 'Reporte Q4 2024.xlsx',
                sheets: [{ name: 'Sheet1', data: [] }, { name: 'Sheet2', data: [] }, { name: 'Sheet3', data: [] }],
                size: 45000,
                isTemplate: false,
                version: 1
            },
            {
                uuid: nanoid(),
                name: 'Análisis Ventas.xlsx',
                sheets: [{ name: 'Ventas', data: [] }, { name: 'Resumen', data: [] }, { name: 'Gráficos', data: [] }, { name: 'Proyecciones', data: [] }, { name: 'Datos', data: [] }],
                size: 128000,
                isTemplate: false,
                version: 1
            },
            {
                uuid: nanoid(),
                name: 'Inventario.xlsx',
                sheets: [{ name: 'Productos', data: [] }, { name: 'Stock', data: [] }],
                size: 67000,
                isTemplate: false,
                version: 1
            },
            {
                uuid: nanoid(),
                name: 'Factura',
                sheets: [{
                    name: 'Factura', data: [
                        ['FACTURA', '', '', '', ''],
                        ['', '', '', '', ''],
                        ['Cliente:', '', '', 'Fecha:', ''],
                        ['Dirección:', '', '', 'No. Factura:', ''],
                        ['', '', '', '', ''],
                        ['Descripción', 'Cantidad', 'Precio Unit.', 'Total', ''],
                        ['', '', '', '', ''],
                        ['', '', '', '', ''],
                        ['', '', '', '', ''],
                        ['', '', '', '', ''],
                        ['', '', 'Subtotal:', '', ''],
                        ['', '', 'IVA (16%):', '', ''],
                        ['', '', 'TOTAL:', '', '']
                    ], metadata: { formatting: { '0-0': { bold: true, fontSize: 18 }, '5-0': { bold: true }, '5-1': { bold: true }, '5-2': { bold: true }, '5-3': { bold: true }, '12-2': { bold: true }, '12-3': { bold: true } } }
                }],
                size: 5000,
                isTemplate: true,
                templateCategory: 'Finanzas',
                version: 1
            },
            {
                uuid: nanoid(),
                name: 'Presupuesto Mensual',
                sheets: [{
                    name: 'Presupuesto', data: [
                        ['PRESUPUESTO MENSUAL', '', '', ''],
                        ['', '', '', ''],
                        ['Categoría', 'Presupuestado', 'Real', 'Diferencia'],
                        ['Ingresos', '', '', ''],
                        ['Salario', '', '', ''],
                        ['Otros', '', '', ''],
                        ['', '', '', ''],
                        ['Gastos', '', '', ''],
                        ['Vivienda', '', '', ''],
                        ['Alimentación', '', '', ''],
                        ['Transporte', '', '', ''],
                        ['Servicios', '', '', ''],
                        ['Entretenimiento', '', '', ''],
                        ['Ahorros', '', '', ''],
                        ['', '', '', ''],
                        ['TOTAL', '', '', '']
                    ], metadata: { formatting: { '0-0': { bold: true, fontSize: 16 }, '2-0': { bold: true }, '2-1': { bold: true }, '2-2': { bold: true }, '2-3': { bold: true }, '15-0': { bold: true } } }
                }],
                size: 4000,
                isTemplate: true,
                templateCategory: 'Finanzas',
                version: 1
            },
            {
                uuid: nanoid(),
                name: 'Lista de Tareas',
                sheets: [{
                    name: 'Tareas', data: [
                        ['LISTA DE TAREAS', '', '', '', ''],
                        ['', '', '', '', ''],
                        ['#', 'Tarea', 'Prioridad', 'Estado', 'Fecha Límite'],
                        ['1', '', '', 'Pendiente', ''],
                        ['2', '', '', 'Pendiente', ''],
                        ['3', '', '', 'Pendiente', ''],
                        ['4', '', '', 'Pendiente', ''],
                        ['5', '', '', 'Pendiente', '']
                    ], metadata: { formatting: { '0-0': { bold: true, fontSize: 16 }, '2-0': { bold: true }, '2-1': { bold: true }, '2-2': { bold: true }, '2-3': { bold: true }, '2-4': { bold: true } } }
                }],
                size: 2500,
                isTemplate: true,
                templateCategory: 'Productividad',
                version: 1
            },
            {
                uuid: nanoid(),
                name: 'Inventario de Productos',
                sheets: [{
                    name: 'Inventario', data: [
                        ['INVENTARIO DE PRODUCTOS', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['Código', 'Producto', 'Categoría', 'Stock', 'Precio', 'Valor Total'],
                        ['', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['', '', '', 'TOTAL:', '', '']
                    ], metadata: { formatting: { '0-0': { bold: true, fontSize: 16 }, '2-0': { bold: true }, '2-1': { bold: true }, '2-2': { bold: true }, '2-3': { bold: true }, '2-4': { bold: true }, '2-5': { bold: true } } }
                }],
                size: 3500,
                isTemplate: true,
                templateCategory: 'Negocio',
                version: 1
            },
            {
                uuid: nanoid(),
                name: 'Registro de Ventas',
                sheets: [{
                    name: 'Ventas', data: [
                        ['REGISTRO DE VENTAS', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['Fecha', 'Cliente', 'Producto', 'Cantidad', 'Precio', 'Total'],
                        ['', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['', '', '', '', 'TOTAL:', '']
                    ], metadata: { formatting: { '0-0': { bold: true, fontSize: 16 }, '2-0': { bold: true }, '2-1': { bold: true }, '2-2': { bold: true }, '2-3': { bold: true }, '2-4': { bold: true }, '2-5': { bold: true } } }
                }],
                size: 3000,
                isTemplate: true,
                templateCategory: 'Negocio',
                version: 1
            }
        ]);
    }
}

export function checkApiKeyExists(provider: string): boolean {
    if (!provider) return false;

    const normalized = String(provider).toLowerCase();
    const keyMap: Record<string, string | undefined> = {
        'openai': process.env.OPENAI_API_KEY,
        'anthropic': process.env.ANTHROPIC_API_KEY,
        'google': process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
        'gemini': process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
        // Legacy/alias support: some deployments use GROK_API_KEY, some use XAI_API_KEY.
        'xai': process.env.XAI_API_KEY || process.env.GROK_API_KEY || process.env.ILIAGPT_API_KEY,
        'grok': process.env.GROK_API_KEY || process.env.XAI_API_KEY || process.env.ILIAGPT_API_KEY,
        'openrouter': process.env.OPENROUTER_API_KEY,
        'perplexity': process.env.PERPLEXITY_API_KEY,
        'deepseek': process.env.DEEPSEEK_API_KEY,
        'mistral': process.env.MISTRAL_API_KEY,
        'cohere': process.env.COHERE_API_KEY,
        'scopus': process.env.SCOPUS_API_KEY,
        'scielo': process.env.SCIELO_API_KEY,
    };
    return !!keyMap[normalized];
}
