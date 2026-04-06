import { Router } from "express";
import Decimal from "decimal.js";
import ExcelJS from "exceljs";
import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import { storage } from "../../storage";
import { sendPaymentEmail } from "../../services/genericEmailService";
import { auditLog, AuditActions } from "../../services/auditLogger";
import { db, dbRead } from "../../db";
import { invoices, payments, users } from "@shared/schema";
import { createQueue, QUEUE_NAMES } from "../../lib/queueFactory";
import { syncStripePaidInvoicesToPayments } from "../../services/stripePaymentsSyncService";
import { parseMoneyDecimal } from "../../lib/money";

export const financeRouter = Router();

function parseDateInput(value: string | undefined, mode: "start" | "end" = "start"): Date | null {
    if (!value) return null;

    // <input type="date" /> values come in as YYYY-MM-DD. Treat them as local dates.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split("-").map((n) => Number(n));
        if (!y || !m || !d) return null;
        return mode === "end"
            ? new Date(y, m - 1, d, 23, 59, 59, 999)
            : new Date(y, m - 1, d, 0, 0, 0, 0);
    }

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

function parseNumberInput(value: string | undefined): number | null {
    if (!value) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return n;
}

function amountAsNumeric(): SQL<number> {
    // Prefer persisted numeric amounts, fall back to resilient parsing of legacy `amount` strings.
    // Keep this server-side to avoid blowing up on bad/locale-formatted data.
    const legacy = sql<number>`
        nullif(
            case
                when position('.' in ${payments.amount}) > 0 and position(',' in ${payments.amount}) > 0
                    then replace(regexp_replace(${payments.amount}, '[^0-9.,-]', '', 'g'), ',', '')
                else replace(regexp_replace(${payments.amount}, '[^0-9.,-]', '', 'g'), ',', '.')
            end,
            ''
        )::numeric
    `;

    return sql<number>`coalesce(${payments.amountValue}::numeric, ${legacy})`;
}

function buildPaymentsWhereClause(params: {
    status?: string;
    userId?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    currency?: string;
    minAmount?: string;
    maxAmount?: string;
}): SQL | undefined {
    const conditions: SQL[] = [];

    const status = String(params.status || "").trim();
    const userId = String(params.userId || "").trim();
    const search = String(params.search || "").trim();
    const currency = String(params.currency || "").trim().toUpperCase();

    if (status && status !== "all") conditions.push(eq(payments.status, status));
    if (userId) conditions.push(eq(payments.userId, userId));
    if (currency && currency !== "ALL") conditions.push(eq(payments.currency, currency));

    const fromDate = parseDateInput(params.dateFrom, "start");
    if (fromDate) conditions.push(gte(payments.createdAt, fromDate));

    const toDate = parseDateInput(params.dateTo, "end");
    if (toDate) conditions.push(lte(payments.createdAt, toDate));

    const minAmount = parseNumberInput(params.minAmount);
    if (minAmount !== null) conditions.push(gte(amountAsNumeric(), minAmount));

    const maxAmount = parseNumberInput(params.maxAmount);
    if (maxAmount !== null) conditions.push(lte(amountAsNumeric(), maxAmount));

    if (search) {
        const like = `%${search}%`;
        conditions.push(
            or(
                ilike(payments.id, like),
                ilike(payments.userId, like),
                ilike(payments.stripePaymentId, like),
                ilike(payments.stripeCustomerId, like),
                ilike(payments.stripePaymentIntentId, like),
                ilike(payments.stripeChargeId, like),
                ilike(payments.description, like),
                ilike(users.email, like),
                ilike(users.fullName, like),
            )!,
        );
    }

    return conditions.length ? and(...conditions) : undefined;
}

// GET /api/admin/finance/payments - List payments with pagination and filters
financeRouter.get("/payments", async (req, res) => {
    try {
        const {
            page = "1",
            limit = "20",
            status,
            userId,
            search,
            dateFrom,
            dateTo,
            currency,
            minAmount,
            maxAmount,
            sortBy = "createdAt",
            sortOrder = "desc",
        } = req.query as Record<string, string>;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        const sortBySafe = sortBy === "amount" ? "amount" : "createdAt";
        const sortOrderSafe = sortOrder === "asc" ? "asc" : "desc";

        const orderByClause =
            sortBySafe === "amount"
                ? (sortOrderSafe === "asc" ? asc(amountAsNumeric()) : desc(amountAsNumeric()))
                : (sortOrderSafe === "asc" ? asc(payments.createdAt) : desc(payments.createdAt));

        const whereClause = buildPaymentsWhereClause({
            status,
            userId,
            search,
            dateFrom,
            dateTo,
            currency,
            minAmount,
            maxAmount,
        });

        let countQuery = dbRead
            .select({ count: sql<number>`count(*)::int` })
            .from(payments)
            .leftJoin(users, eq(payments.userId, users.id));
        if (whereClause) countQuery = countQuery.where(whereClause);
        const [{ count: total = 0 } = {} as any] = await countQuery;

        let listQuery = dbRead
            .select({
                id: payments.id,
                userId: payments.userId,
                userEmail: users.email,
                userName: users.fullName,
                amount: payments.amount,
                amountValue: payments.amountValue,
                amountMinor: payments.amountMinor,
                currency: payments.currency,
                status: payments.status,
                method: payments.method,
                description: payments.description,
                stripePaymentId: payments.stripePaymentId,
                stripeCustomerId: payments.stripeCustomerId,
                stripePaymentIntentId: payments.stripePaymentIntentId,
                stripeChargeId: payments.stripeChargeId,
                createdAt: payments.createdAt,
            })
            .from(payments)
            .leftJoin(users, eq(payments.userId, users.id));
        if (whereClause) listQuery = listQuery.where(whereClause);

        const paginatedPayments = await listQuery
            .orderBy(orderByClause, desc(payments.createdAt))
            .limit(limitNum)
            .offset(offset);

        res.json({
            payments: paginatedPayments,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            },
            sort: {
                sortBy: sortBySafe,
                sortOrder: sortOrderSafe,
            },
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

financeRouter.get("/payments/stats", async (req, res) => {
    try {
        const { status, userId, search, dateFrom, dateTo, currency, minAmount, maxAmount } = req.query as Record<string, string>;
        const whereClause = buildPaymentsWhereClause({ status, userId, search, dateFrom, dateTo, currency, minAmount, maxAmount });

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const amountExpr = amountAsNumeric();

        let currencyQuery = dbRead
            .select({
                currency: payments.currency,
                total: sql<string>`COALESCE(SUM(CASE WHEN ${payments.status} = 'completed' THEN ${amountExpr} ELSE 0 END), 0)::text`,
                thisMonth: sql<string>`COALESCE(SUM(CASE WHEN ${payments.status} = 'completed' AND ${payments.createdAt} >= ${monthStart} THEN ${amountExpr} ELSE 0 END), 0)::text`,
                count: sql<number>`COALESCE(SUM(CASE WHEN ${payments.status} = 'completed' THEN 1 ELSE 0 END), 0)::int`,

                pendingTotal: sql<string>`COALESCE(SUM(CASE WHEN ${payments.status} = 'pending' THEN ${amountExpr} ELSE 0 END), 0)::text`,
                pendingCount: sql<number>`COALESCE(SUM(CASE WHEN ${payments.status} = 'pending' THEN 1 ELSE 0 END), 0)::int`,

                failedTotal: sql<string>`COALESCE(SUM(CASE WHEN ${payments.status} = 'failed' THEN ${amountExpr} ELSE 0 END), 0)::text`,
                failedCount: sql<number>`COALESCE(SUM(CASE WHEN ${payments.status} = 'failed' THEN 1 ELSE 0 END), 0)::int`,

                refundedTotal: sql<string>`COALESCE(SUM(CASE WHEN ${payments.status} = 'refunded' THEN ${amountExpr} ELSE 0 END), 0)::text`,
                refundedCount: sql<number>`COALESCE(SUM(CASE WHEN ${payments.status} = 'refunded' THEN 1 ELSE 0 END), 0)::int`,

                disputedTotal: sql<string>`COALESCE(SUM(CASE WHEN ${payments.status} = 'disputed' THEN ${amountExpr} ELSE 0 END), 0)::text`,
                disputedCount: sql<number>`COALESCE(SUM(CASE WHEN ${payments.status} = 'disputed' THEN 1 ELSE 0 END), 0)::int`,
            })
            .from(payments)
            .leftJoin(users, eq(payments.userId, users.id))
            .groupBy(payments.currency);
        if (whereClause) currencyQuery = currencyQuery.where(whereClause);

        const currencyRows = await currencyQuery;

        const parseAmount = (v: unknown) => {
            try {
                return parseMoneyDecimal(String(v ?? "0"));
            } catch {
                return parseMoneyDecimal(0);
            }
        };

        type CurrencyStats = {
            total: Decimal;
            thisMonth: Decimal;
            count: number;
            pendingTotal: Decimal;
            pendingCount: number;
            failedTotal: Decimal;
            failedCount: number;
            refundedTotal: Decimal;
            refundedCount: number;
            disputedTotal: Decimal;
            disputedCount: number;
        };

        const byCurrency: Record<string, CurrencyStats> = {};
        for (const row of currencyRows) {
            const cur = String(row.currency || "EUR").toUpperCase();
            byCurrency[cur] = {
                total: parseAmount((row as any).total),
                thisMonth: parseAmount((row as any).thisMonth),
                count: Number((row as any).count || 0),
                pendingTotal: parseAmount((row as any).pendingTotal),
                pendingCount: Number((row as any).pendingCount || 0),
                failedTotal: parseAmount((row as any).failedTotal),
                failedCount: Number((row as any).failedCount || 0),
                refundedTotal: parseAmount((row as any).refundedTotal),
                refundedCount: Number((row as any).refundedCount || 0),
                disputedTotal: parseAmount((row as any).disputedTotal),
                disputedCount: Number((row as any).disputedCount || 0),
            };
        }

        const currencies = Object.keys(byCurrency).sort();
        const primaryCurrency = currencies.length === 1 ? currencies[0] : null;

        const totals = currencies.reduce(
            (acc, cur) => {
                const s = byCurrency[cur]!;
                acc.total = acc.total.plus(s.total);
                acc.thisMonth = acc.thisMonth.plus(s.thisMonth);
                acc.count += s.count;
                acc.pendingTotal = acc.pendingTotal.plus(s.pendingTotal);
                acc.pendingCount += s.pendingCount;
                acc.failedTotal = acc.failedTotal.plus(s.failedTotal);
                acc.failedCount += s.failedCount;
                acc.refundedTotal = acc.refundedTotal.plus(s.refundedTotal);
                acc.refundedCount += s.refundedCount;
                acc.disputedTotal = acc.disputedTotal.plus(s.disputedTotal);
                acc.disputedCount += s.disputedCount;
                return acc;
            },
            {
                total: parseMoneyDecimal(0),
                thisMonth: parseMoneyDecimal(0),
                count: 0,
                pendingTotal: parseMoneyDecimal(0),
                pendingCount: 0,
                failedTotal: parseMoneyDecimal(0),
                failedCount: 0,
                refundedTotal: parseMoneyDecimal(0),
                refundedCount: 0,
                disputedTotal: parseMoneyDecimal(0),
                disputedCount: 0,
            },
        );

        const denom = totals.count + totals.failedCount;
        const successRate = denom > 0 ? (totals.count / denom) * 100 : 0;

        res.json({
            total: totals.total.toFixed(2),
            thisMonth: totals.thisMonth.toFixed(2),
            count: totals.count,
            pendingTotal: totals.pendingTotal.toFixed(2),
            pendingCount: totals.pendingCount,
            failedTotal: totals.failedTotal.toFixed(2),
            failedCount: totals.failedCount,
            refundedTotal: totals.refundedTotal.toFixed(2),
            refundedCount: totals.refundedCount,
            disputedTotal: totals.disputedTotal.toFixed(2),
            disputedCount: totals.disputedCount,
            successRate: Number(successRate.toFixed(1)),
            currencies,
            primaryCurrency,
            byCurrency: Object.fromEntries(
                currencies.map((cur) => {
                    const s = byCurrency[cur]!;
                    return [
                        cur,
                        {
                            total: s.total.toFixed(2),
                            thisMonth: s.thisMonth.toFixed(2),
                            count: s.count,
                            pendingTotal: s.pendingTotal.toFixed(2),
                            pendingCount: s.pendingCount,
                            failedTotal: s.failedTotal.toFixed(2),
                            failedCount: s.failedCount,
                            refundedTotal: s.refundedTotal.toFixed(2),
                            refundedCount: s.refundedCount,
                            disputedTotal: s.disputedTotal.toFixed(2),
                            disputedCount: s.disputedCount,
                        },
                    ] as const;
                }),
            ),
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/finance/payments/sync-stripe - Backfill payments from Stripe invoices (paid)
financeRouter.post("/payments/sync-stripe", async (req, res) => {
    try {
        // Backwards-compatible params: accept both `maxInvoices` and legacy `limit`.
        const maxInvoicesRaw = (req.body?.maxInvoices ?? req.query?.maxInvoices ?? req.body?.limit ?? req.query?.limit ?? 200) as any;
        const startingAfterRaw = (req.body?.startingAfter ?? req.query?.startingAfter) as any;
        const dateFromRaw = (req.body?.dateFrom ?? req.query?.dateFrom) as any;
        const dateToRaw = (req.body?.dateTo ?? req.query?.dateTo) as any;
        const asyncRaw = (req.body?.async ?? req.query?.async) as any;

        const maxInvoices = Math.min(2000, Math.max(1, Number(maxInvoicesRaw) || 200));
        const startingAfter = typeof startingAfterRaw === "string" && startingAfterRaw.trim() ? startingAfterRaw.trim() : undefined;
        const asyncRequested = asyncRaw === true || String(asyncRaw || "").trim().toLowerCase() === "true";

        const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days
        const fromDate = parseDateInput(typeof dateFromRaw === "string" ? dateFromRaw : undefined, "start") || defaultFrom;
        const toDate = parseDateInput(typeof dateToRaw === "string" ? dateToRaw : undefined, "end") || new Date();
        if (fromDate > toDate) {
            return res.status(400).json({ error: "`dateFrom` must be before `dateTo`" });
        }

        if (asyncRequested) {
            const queue = createQueue<{ maxInvoices: number; startingAfter?: string; fromDate: string; toDate: string }>(QUEUE_NAMES.PAYMENTS_SYNC);
            if (queue) {
                const job = await queue.add("sync-stripe-paid-invoices", {
                    maxInvoices,
                    startingAfter,
                    fromDate: fromDate.toISOString(),
                    toDate: toDate.toISOString(),
                }, {
                    attempts: 3,
                });

                await auditLog(req as any, {
                    action: AuditActions.ADMIN_IMPORT_DATA,
                    resource: "payments",
                    resourceId: String(job.id || ""),
                    details: {
                        source: "stripe",
                        async: true,
                        window: { dateFrom: fromDate.toISOString(), dateTo: toDate.toISOString() },
                        maxInvoices,
                        startingAfter: startingAfter || null,
                    },
                    category: "admin",
                    severity: "info",
                });

                return res.json({ success: true, async: true, jobId: String(job.id) });
            }
            // Fall back to synchronous execution if Redis isn't configured.
        }

        const result = await syncStripePaidInvoicesToPayments({
            maxInvoices,
            startingAfter,
            fromDate,
            toDate,
        });

        await auditLog(req as any, {
            action: AuditActions.ADMIN_IMPORT_DATA,
            resource: "payments",
            resourceId: null,
            details: {
                source: "stripe",
                async: false,
                ...result,
                maxInvoices,
                startingAfter: startingAfter || null,
            },
            category: "admin",
            severity: "info",
        });

        res.json(result);
    } catch (error: any) {
        const message = error?.message || "Failed to sync payments from Stripe";
        const isConfig = String(message).includes("STRIPE_SECRET_KEY");
        res.status(isConfig ? 400 : 500).json({ error: message });
    }
});

financeRouter.get("/payments/sync-stripe/jobs/:jobId", async (req, res) => {
    try {
        const queue = createQueue(QUEUE_NAMES.PAYMENTS_SYNC);
        if (!queue) {
            return res.status(400).json({ error: "Redis is not configured" });
        }

        const job = await queue.getJob(String(req.params.jobId || ""));
        if (!job) return res.status(404).json({ error: "Job not found" });

        const state = await job.getState();
        res.json({
            id: String(job.id),
            name: job.name,
            state,
            progress: job.progress,
            returnvalue: (job as any).returnvalue ?? null,
            failedReason: (job as any).failedReason ?? null,
            timestamp: job.timestamp,
            finishedOn: (job as any).finishedOn ?? null,
            processedOn: (job as any).processedOn ?? null,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to fetch job status" });
    }
});

// GET /api/admin/finance/payments/export - Export payments to CSV/Excel
financeRouter.get("/payments/export", async (req, res) => {
    try {
        const format = String((req.query as any)?.format || "csv").toLowerCase();
        const { status, userId, search, dateFrom, dateTo, currency, minAmount, maxAmount, sortBy = "createdAt", sortOrder = "desc" } = req.query as Record<string, string>;
        const whereClause = buildPaymentsWhereClause({ status, userId, search, dateFrom, dateTo, currency, minAmount, maxAmount });

        const sortBySafe = sortBy === "amount" ? "amount" : "createdAt";
        const sortOrderSafe = sortOrder === "asc" ? "asc" : "desc";
        const orderByClause =
            sortBySafe === "amount"
                ? (sortOrderSafe === "asc" ? asc(amountAsNumeric()) : desc(amountAsNumeric()))
                : (sortOrderSafe === "asc" ? asc(payments.createdAt) : desc(payments.createdAt));

        let exportQuery = dbRead
            .select({
                id: payments.id,
                userId: payments.userId,
                userEmail: users.email,
                userName: users.fullName,
                amount: payments.amount,
                amountValue: payments.amountValue,
                amountMinor: payments.amountMinor,
                currency: payments.currency,
                status: payments.status,
                method: payments.method,
                description: payments.description,
                stripePaymentId: payments.stripePaymentId,
                stripeCustomerId: payments.stripeCustomerId,
                stripePaymentIntentId: payments.stripePaymentIntentId,
                stripeChargeId: payments.stripeChargeId,
                invoiceNumber: sql<string | null>`(
                    select ${invoices.invoiceNumber}
                    from ${invoices}
                    where ${invoices.paymentId} = ${payments.id}
                    order by ${invoices.createdAt} desc
                    limit 1
                )`,
                invoiceStatus: sql<string | null>`(
                    select ${invoices.status}
                    from ${invoices}
                    where ${invoices.paymentId} = ${payments.id}
                    order by ${invoices.createdAt} desc
                    limit 1
                )`,
                createdAt: payments.createdAt,
            })
            .from(payments)
            .leftJoin(users, eq(payments.userId, users.id))
            .orderBy(orderByClause, desc(payments.createdAt));
        if (whereClause) exportQuery = exportQuery.where(whereClause);

        const paymentRows = await exportQuery;

        await auditLog(req as any, {
            action: AuditActions.ADMIN_EXPORT_DATA,
            resource: "payments",
            details: { format, count: paymentRows.length },
            category: "admin",
            severity: "info",
        });

        if (format === "csv") {
            const headers = [
                "id",
                "userId",
                "userEmail",
                "userName",
                "amount",
                "amountValue",
                "amountMinor",
                "currency",
                "status",
                "method",
                "description",
                "stripePaymentId",
                "stripeCustomerId",
                "stripePaymentIntentId",
                "stripeChargeId",
                "invoiceNumber",
                "invoiceStatus",
                "createdAt",
            ];

            const csvRows = [headers.join(",")];
            paymentRows.forEach((p: any) => {
                csvRows.push(
                    [
                        p.id,
                        p.userId || "",
                        p.userEmail || "",
                        p.userName || "",
                        p.amount || 0,
                        p.amountValue || "",
                        p.amountMinor ?? "",
                        p.currency || "EUR",
                        p.status || "",
                        p.method || "",
                        p.description || "",
                        p.stripePaymentId || "",
                        p.stripeCustomerId || "",
                        p.stripePaymentIntentId || "",
                        p.stripeChargeId || "",
                        p.invoiceNumber || "",
                        p.invoiceStatus || "",
                        p.createdAt?.toISOString?.() || p.createdAt || "",
                    ]
                        .map((v: any) => `"${String(v).replace(/"/g, '""')}"`)
                        .join(","),
                );
            });

            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename=payments_${Date.now()}.csv`);
            // Add UTF-8 BOM for Excel compatibility.
            res.send("\uFEFF" + csvRows.join("\r\n"));
        } else if (format === "xlsx") {
            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet("Payments");
            sheet.columns = [
                { header: "id", key: "id", width: 36 },
                { header: "userId", key: "userId", width: 36 },
                { header: "userEmail", key: "userEmail", width: 28 },
                { header: "userName", key: "userName", width: 22 },
                { header: "amount", key: "amount", width: 14 },
                { header: "amountValue", key: "amountValue", width: 14 },
                { header: "amountMinor", key: "amountMinor", width: 14 },
                { header: "currency", key: "currency", width: 10 },
                { header: "status", key: "status", width: 12 },
                { header: "method", key: "method", width: 12 },
                { header: "description", key: "description", width: 32 },
                { header: "stripePaymentId", key: "stripePaymentId", width: 24 },
                { header: "stripeCustomerId", key: "stripeCustomerId", width: 24 },
                { header: "stripePaymentIntentId", key: "stripePaymentIntentId", width: 24 },
                { header: "stripeChargeId", key: "stripeChargeId", width: 24 },
                { header: "invoiceNumber", key: "invoiceNumber", width: 22 },
                { header: "invoiceStatus", key: "invoiceStatus", width: 12 },
                { header: "createdAt", key: "createdAt", width: 22 },
            ];

            sheet.addRows(
                paymentRows.map((p: any) => ({
                    ...p,
                    createdAt: p.createdAt?.toISOString?.() || p.createdAt || "",
                })),
            );

            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            res.setHeader("Content-Disposition", `attachment; filename=payments_${Date.now()}.xlsx`);
            const buffer = await workbook.xlsx.writeBuffer();
            res.send(Buffer.from(buffer as any));
        } else if (format === "json") {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename=payments_${Date.now()}.json`);
            res.json(paymentRows);
        } else {
            res.status(400).json({ error: "Invalid format. Use csv, xlsx, or json." });
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/finance/payments/unmatched - List payments that aren't linked to a user yet
financeRouter.get("/payments/unmatched", async (req, res) => {
    try {
        const {
            page = "1",
            limit = "20",
            status,
            search,
            dateFrom,
            dateTo,
            currency,
            minAmount,
            maxAmount,
            sortBy = "createdAt",
            sortOrder = "desc",
        } = req.query as Record<string, string>;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        const sortBySafe = sortBy === "amount" ? "amount" : "createdAt";
        const sortOrderSafe = sortOrder === "asc" ? "asc" : "desc";

        const orderByClause =
            sortBySafe === "amount"
                ? (sortOrderSafe === "asc" ? asc(amountAsNumeric()) : desc(amountAsNumeric()))
                : (sortOrderSafe === "asc" ? asc(payments.createdAt) : desc(payments.createdAt));

        const baseWhere = buildPaymentsWhereClause({ status, search, dateFrom, dateTo, currency, minAmount, maxAmount });
        const whereClause = baseWhere ? and(isNull(payments.userId), baseWhere) : isNull(payments.userId);

        const [{ count: total = 0 } = {} as any] = await dbRead
            .select({ count: sql<number>`count(*)::int` })
            .from(payments)
            .leftJoin(users, eq(payments.userId, users.id))
            .where(whereClause);

        const paginatedPayments = await dbRead
            .select({
                id: payments.id,
                userId: payments.userId,
                userEmail: users.email,
                userName: users.fullName,
                amount: payments.amount,
                amountValue: payments.amountValue,
                amountMinor: payments.amountMinor,
                currency: payments.currency,
                status: payments.status,
                method: payments.method,
                description: payments.description,
                stripePaymentId: payments.stripePaymentId,
                stripeCustomerId: payments.stripeCustomerId,
                stripePaymentIntentId: payments.stripePaymentIntentId,
                stripeChargeId: payments.stripeChargeId,
                createdAt: payments.createdAt,
            })
            .from(payments)
            .leftJoin(users, eq(payments.userId, users.id))
            .where(whereClause)
            .orderBy(orderByClause, desc(payments.createdAt))
            .limit(limitNum)
            .offset(offset);

        res.json({
            payments: paginatedPayments,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
            },
            sort: {
                sortBy: sortBySafe,
                sortOrder: sortOrderSafe,
            },
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/finance/payments/:id - Payment details + related invoices
financeRouter.get("/payments/:id", async (req, res) => {
    try {
        const id = String(req.params.id || "").trim();
        if (!id) return res.status(400).json({ error: "Missing payment id" });

        const [payment] = await dbRead
            .select({
                id: payments.id,
                userId: payments.userId,
                userEmail: users.email,
                userName: users.fullName,
                amount: payments.amount,
                amountValue: payments.amountValue,
                amountMinor: payments.amountMinor,
                currency: payments.currency,
                status: payments.status,
                method: payments.method,
                description: payments.description,
                stripePaymentId: payments.stripePaymentId,
                stripeCustomerId: payments.stripeCustomerId,
                stripePaymentIntentId: payments.stripePaymentIntentId,
                stripeChargeId: payments.stripeChargeId,
                createdAt: payments.createdAt,
            })
            .from(payments)
            .leftJoin(users, eq(payments.userId, users.id))
            .where(eq(payments.id, id))
            .limit(1);

        if (!payment) return res.status(404).json({ error: "Payment not found" });

        const relatedInvoices = await dbRead
            .select({
                id: invoices.id,
                userId: invoices.userId,
                paymentId: invoices.paymentId,
                source: invoices.source,
                invoiceNumber: invoices.invoiceNumber,
                amount: invoices.amount,
                amountValue: invoices.amountValue,
                amountMinor: invoices.amountMinor,
                currency: invoices.currency,
                status: invoices.status,
                dueDate: invoices.dueDate,
                paidAt: invoices.paidAt,
                pdfPath: invoices.pdfPath,
                stripeInvoiceId: invoices.stripeInvoiceId,
                stripeHostedInvoiceUrl: invoices.stripeHostedInvoiceUrl,
                stripeInvoicePdfUrl: invoices.stripeInvoicePdfUrl,
                createdAt: invoices.createdAt,
            })
            .from(invoices)
            .where(eq(invoices.paymentId, id))
            .orderBy(desc(invoices.createdAt));

        res.json({ payment, invoices: relatedInvoices });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to fetch payment" });
    }
});

// POST /api/admin/finance/payments/:id/assign-user - reconcile payment to a user
financeRouter.post("/payments/:id/assign-user", async (req, res) => {
    try {
        const paymentId = String(req.params.id || "").trim();
        if (!paymentId) return res.status(400).json({ error: "Missing payment id" });

        const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
        const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";

        if (!email && !userId) {
            return res.status(400).json({ error: "Provide `email` or `userId`" });
        }

        const [targetUser] = await dbRead
            .select({ id: users.id, email: users.email, fullName: users.fullName })
            .from(users)
            .where(
                userId
                    ? eq(users.id, userId)
                    : sql<boolean>`lower(${users.email}) = ${email}`,
            )
            .limit(1);

        if (!targetUser) {
            return res.status(404).json({ error: "User not found" });
        }

        const updated = await db.transaction(async (tx) => {
            const [payment] = await tx
                .select({ id: payments.id, userId: payments.userId })
                .from(payments)
                .where(eq(payments.id, paymentId))
                .limit(1);

            if (!payment) {
                return { ok: false as const, reason: "not_found" as const };
            }

            if (payment.userId) {
                return { ok: false as const, reason: "already_assigned" as const, existingUserId: payment.userId };
            }

            await tx.update(payments).set({ userId: targetUser.id }).where(eq(payments.id, paymentId));
            await tx.update(invoices).set({ userId: targetUser.id }).where(eq(invoices.paymentId, paymentId));

            const [paymentAfter] = await tx
                .select({
                    id: payments.id,
                    userId: payments.userId,
                    amount: payments.amount,
                    amountValue: payments.amountValue,
                    amountMinor: payments.amountMinor,
                    currency: payments.currency,
                    status: payments.status,
                    method: payments.method,
                    description: payments.description,
                    stripePaymentId: payments.stripePaymentId,
                    stripeCustomerId: payments.stripeCustomerId,
                    stripePaymentIntentId: payments.stripePaymentIntentId,
                    stripeChargeId: payments.stripeChargeId,
                    createdAt: payments.createdAt,
                })
                .from(payments)
                .where(eq(payments.id, paymentId))
                .limit(1);

            return { ok: true as const, payment: paymentAfter };
        });

        if (!updated.ok) {
            if (updated.reason === "not_found") return res.status(404).json({ error: "Payment not found" });
            if (updated.reason === "already_assigned") return res.status(409).json({ error: "Payment already assigned", existingUserId: updated.existingUserId });
            return res.status(400).json({ error: "Cannot assign payment" });
        }

        await auditLog(req as any, {
            action: AuditActions.PAYMENT_RECONCILED,
            resource: "payments",
            resourceId: paymentId,
            details: {
                assignedUserId: targetUser.id,
                assignedUserEmail: targetUser.email,
                input: { email: email || null, userId: userId || null },
            },
            category: "admin",
            severity: "info",
        });

        res.json({ success: true, payment: updated.payment, user: targetUser });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to assign payment" });
    }
});

financeRouter.post("/payments", async (req, res) => {
    try {
        const payment = await storage.createPayment(req.body);
        res.json(payment);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

financeRouter.patch("/payments/:id", async (req, res) => {
    try {
        const payment = await storage.updatePayment(req.params.id, req.body);
        if (!payment) {
            return res.status(404).json({ error: "Payment not found" });
        }
        res.json(payment);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/finance/invoices - List invoices with pagination
financeRouter.get("/invoices", async (req, res) => {
    try {
        const {
            page = "1",
            limit = "20",
            status
        } = req.query as Record<string, string>;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        let invoices = await storage.getInvoices();

        if (status) {
            invoices = invoices.filter(i => i.status === status);
        }

        // Sort by date descending
        invoices.sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
        });

        const total = invoices.length;
        const paginatedInvoices = invoices.slice(offset, offset + limitNum);

        res.json({
            invoices: paginatedInvoices,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

financeRouter.post("/invoices", async (req, res) => {
    try {
        const invoice = await storage.createInvoice(req.body);
        res.json(invoice);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

financeRouter.patch("/invoices/:id", async (req, res) => {
    try {
        const invoice = await storage.updateInvoice(req.params.id, req.body);
        if (!invoice) {
            return res.status(404).json({ error: "Invoice not found" });
        }
        res.json(invoice);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/finance/invoices/:id/mark-paid - Mark invoice as paid
financeRouter.post("/invoices/:id/mark-paid", async (req, res) => {
    try {
        const previousInvoice = await storage.getInvoices().then(invoices => invoices.find(i => i.id === req.params.id));
        const invoice = await storage.updateInvoice(req.params.id, {
            status: "paid",
            paidAt: new Date()
        });
        if (!invoice) {
            return res.status(404).json({ error: "Invoice not found" });
        }

        await auditLog(req, {
            action: AuditActions.INVOICE_PAID,
            resource: "invoices",
            resourceId: req.params.id,
            details: {
                invoiceNumber: previousInvoice?.invoiceNumber,
                amount: previousInvoice?.amount,
                markedBy: (req as any).user?.email
            },
            category: "admin",
            severity: "info"
        });

        res.json({ success: true, invoice });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/finance/invoices/:id/resend - Resend invoice notification
financeRouter.post("/invoices/:id/resend", async (req, res) => {
    try {
        const invoices = await storage.getInvoices();
        const invoice = invoices.find(i => i.id === req.params.id);
        if (!invoice) {
            return res.status(404).json({ error: "Invoice not found" });
        }

        // Get user email
        const user = await storage.getUser(invoice.userId);
        if (!user?.email) {
            return res.status(400).json({ error: "User has no email address" });
        }

        // Send email
        const emailResult = await sendPaymentEmail(user.email, {
            invoiceId: invoice.id,
            amount: invoice.amount || 0,
            currency: invoice.currency || "USD",
            status: (invoice.status as "paid" | "pending" | "failed") || "pending",
            invoiceUrl: `${process.env.APP_URL || "https://iliagpt.com"}/billing/invoices/${invoice.id}`
        });

        await auditLog(req, {
            action: AuditActions.INVOICE_SENT,
            resource: "invoices",
            resourceId: req.params.id,
            details: {
                userId: invoice.userId,
                emailSent: emailResult.success,
                recipientEmail: user.email,
                sentBy: (req as any).user?.email
            },
            category: "admin",
            severity: "info"
        });

        if (!emailResult.success) {
            return res.status(500).json({ error: "Failed to send email", details: emailResult.error });
        }

        res.json({
            success: true,
            message: "Invoice sent successfully",
            invoiceId: req.params.id
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/finance/invoices/export - Export invoices
financeRouter.get("/invoices/export", async (req, res) => {
    try {
        const format = String(req.query.format || "csv").toLowerCase();
        const invoices = await storage.getInvoices();

        await storage.createAuditLog({
            action: "invoices_export",
            resource: "invoices",
            details: { format, count: invoices.length }
        });

        if (format === "csv") {
            const headers = ["id", "userId", "amount", "currency", "status", "dueDate", "createdAt", "paidAt"];
            const csvRows = [headers.join(",")];
            invoices.forEach(i => {
                csvRows.push([
                    i.id,
                    i.userId || "",
                    i.amount || 0,
                    i.currency || "USD",
                    i.status || "",
                    i.dueDate?.toISOString?.() || i.dueDate || "",
                    i.createdAt?.toISOString?.() || i.createdAt || "",
                    i.paidAt?.toISOString?.() || i.paidAt || ""
                ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
            });
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", `attachment; filename=invoices_${Date.now()}.csv`);
            res.send(csvRows.join("\n"));
        } else if (format === "xlsx") {
            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet("Invoices");

            sheet.columns = [
                { header: "ID", key: "id", width: 36 },
                { header: "User ID", key: "userId", width: 28 },
                { header: "Invoice #", key: "invoiceNumber", width: 18 },
                { header: "Amount", key: "amount", width: 14 },
                { header: "Currency", key: "currency", width: 10 },
                { header: "Status", key: "status", width: 14 },
                { header: "Due Date", key: "dueDate", width: 14 },
                { header: "Created At", key: "createdAt", width: 20 },
                { header: "Paid At", key: "paidAt", width: 20 },
            ];
            sheet.getRow(1).font = { bold: true };
            sheet.getColumn("createdAt").numFmt = "yyyy-mm-dd hh:mm";
            sheet.getColumn("paidAt").numFmt = "yyyy-mm-dd hh:mm";
            sheet.getColumn("dueDate").numFmt = "yyyy-mm-dd";

            for (const i of invoices) {
                sheet.addRow({
                    id: i.id,
                    userId: i.userId || "",
                    invoiceNumber: (i as any).invoiceNumber || "",
                    amount: Number(i.amount || 0),
                    currency: i.currency || "USD",
                    status: i.status || "",
                    dueDate: i.dueDate ? new Date(i.dueDate as any) : null,
                    createdAt: i.createdAt ? new Date(i.createdAt as any) : null,
                    paidAt: i.paidAt ? new Date(i.paidAt as any) : null,
                });
            }

            const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
            res.setHeader("Content-Disposition", `attachment; filename=invoices_${Date.now()}.xlsx`);
            res.send(buffer);
        } else if (format === "json") {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename=invoices_${Date.now()}.json`);
            res.json(invoices);
        } else {
            res.status(400).json({ error: "Invalid format. Use csv, xlsx, or json." });
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
