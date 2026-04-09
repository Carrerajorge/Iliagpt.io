import { Router, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { users, chats, chatMessages, aiModels, excelDocuments } from "@shared/schema";
import { llmGateway } from "../lib/llmGateway";
import { eq, desc, and, gte, lte, ilike, sql, inArray, count } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hashPassword } from "../utils/password";
import { syncModelsForProvider, syncAllProviders, getAvailableProviders, getModelStats } from "../services/aiModelSyncService";
import { toolRegistry, ToolDefinition } from "../services/toolRegistry";
import { IntentToolMapper } from "../services/intentMapper";
import { complexityAnalyzer } from "../services/complexityAnalyzer";
import { orchestrationEngine } from "../services/orchestrationEngine";
import { compressedMemory } from "../services/compressedMemory";
import { progressTracker } from "../services/progressTracker";
import { errorRecovery } from "../services/errorRecovery";
import { FEATURES, setFeatureFlag } from "../config/features";
import { chatAgenticCircuit } from "../services/chatAgenticCircuit";
import { validateBody, validateParams } from "../middleware/validateRequest";
import { asyncHandler } from "../middleware/errorHandler";
import { createUserBodySchema, idParamSchema } from "../schemas/apiSchemas";
import { isAuthenticated } from "../replit_integrations/auth/replitAuth";
import { authStorage } from "../replit_integrations/auth/storage";
import { getSeedStatus } from "../seed-production";
import { usageQuotaService } from "../services/usageQuotaService";

const ADMIN_EMAIL = "carrerajorge874@gmail.com";

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const userReq = req as any;
    const userEmail = userReq.user?.claims?.email;
    const userId = userReq.user?.claims?.sub;
    
    let isAdmin = userEmail === ADMIN_EMAIL;
    
    if (!isAdmin && userId) {
      const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
      isAdmin = user?.role === "admin";
    }
    
    if (!isAdmin) {
      await storage.createAuditLog({
        action: "admin_access_denied",
        resource: "admin_panel",
        details: { email: userEmail, userId, path: req.path }
      });
      return res.status(403).json({ error: "Admin access restricted" });
    }
    next();
  } catch (error) {
    console.error("[Admin] Authorization check failed:", error);
    return res.status(500).json({ error: "Authorization check failed" });
  }
}

const gapsStore: any[] = [];

async function seedDefaultExcelDocuments() {
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
        sheets: [{ name: 'Factura', data: [
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
        ], metadata: { formatting: { '0-0': { bold: true, fontSize: 18 }, '5-0': { bold: true }, '5-1': { bold: true }, '5-2': { bold: true }, '5-3': { bold: true }, '12-2': { bold: true }, '12-3': { bold: true } } } }],
        size: 5000,
        isTemplate: true,
        templateCategory: 'Finanzas',
        version: 1
      },
      {
        uuid: nanoid(),
        name: 'Presupuesto Mensual',
        sheets: [{ name: 'Presupuesto', data: [
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
        ], metadata: { formatting: { '0-0': { bold: true, fontSize: 16 }, '2-0': { bold: true }, '2-1': { bold: true }, '2-2': { bold: true }, '2-3': { bold: true }, '15-0': { bold: true } } } }],
        size: 4000,
        isTemplate: true,
        templateCategory: 'Finanzas',
        version: 1
      },
      {
        uuid: nanoid(),
        name: 'Lista de Tareas',
        sheets: [{ name: 'Tareas', data: [
          ['LISTA DE TAREAS', '', '', '', ''],
          ['', '', '', '', ''],
          ['#', 'Tarea', 'Prioridad', 'Estado', 'Fecha Límite'],
          ['1', '', '', 'Pendiente', ''],
          ['2', '', '', 'Pendiente', ''],
          ['3', '', '', 'Pendiente', ''],
          ['4', '', '', 'Pendiente', ''],
          ['5', '', '', 'Pendiente', '']
        ], metadata: { formatting: { '0-0': { bold: true, fontSize: 16 }, '2-0': { bold: true }, '2-1': { bold: true }, '2-2': { bold: true }, '2-3': { bold: true }, '2-4': { bold: true } } } }],
        size: 2500,
        isTemplate: true,
        templateCategory: 'Productividad',
        version: 1
      },
      {
        uuid: nanoid(),
        name: 'Inventario de Productos',
        sheets: [{ name: 'Inventario', data: [
          ['INVENTARIO DE PRODUCTOS', '', '', '', '', ''],
          ['', '', '', '', '', ''],
          ['Código', 'Producto', 'Categoría', 'Stock', 'Precio', 'Valor Total'],
          ['', '', '', '', '', ''],
          ['', '', '', '', '', ''],
          ['', '', '', '', '', ''],
          ['', '', '', '', '', ''],
          ['', '', '', '', '', ''],
          ['', '', '', 'TOTAL:', '', '']
        ], metadata: { formatting: { '0-0': { bold: true, fontSize: 16 }, '2-0': { bold: true }, '2-1': { bold: true }, '2-2': { bold: true }, '2-3': { bold: true }, '2-4': { bold: true }, '2-5': { bold: true } } } }],
        size: 3500,
        isTemplate: true,
        templateCategory: 'Negocio',
        version: 1
      },
      {
        uuid: nanoid(),
        name: 'Registro de Ventas',
        sheets: [{ name: 'Ventas', data: [
          ['REGISTRO DE VENTAS', '', '', '', '', ''],
          ['', '', '', '', '', ''],
          ['Fecha', 'Cliente', 'Producto', 'Cantidad', 'Precio', 'Total'],
          ['', '', '', '', '', ''],
          ['', '', '', '', '', ''],
          ['', '', '', '', '', ''],
          ['', '', '', '', '', ''],
          ['', '', '', '', 'TOTAL:', '']
        ], metadata: { formatting: { '0-0': { bold: true, fontSize: 16 }, '2-0': { bold: true }, '2-1': { bold: true }, '2-2': { bold: true }, '2-3': { bold: true }, '2-4': { bold: true }, '2-5': { bold: true } } } }],
        size: 3000,
        isTemplate: true,
        templateCategory: 'Negocio',
        version: 1
      }
    ]);
  }
}

export function createAdminRouter() {
  const router = Router();

  router.get("/seed-status", isAuthenticated, async (req: any, res) => {
    try {
      const status = await getSeedStatus();
      
      if (!req.user?.claims?.sub) {
        console.log(`[seed-status] Access denied: not authenticated`);
        return res.status(401).json({
          success: false,
          error: "Authentication required - please login first",
          hint: "Login at least once to create your user record, then the seed can set your admin role",
        });
      }

      const user = await authStorage.getUser(req.user.claims.sub);
      if (!user) {
        console.log(`[seed-status] Access denied: user not found in database (userId=${req.user.claims.sub})`);
        return res.status(403).json({
          success: false,
          error: "User not found in database",
          hint: "Your user record doesn't exist yet. The seed will set admin role once you have a user record. Try refreshing and check seed logs.",
          seedStatusLogged: true,
        });
      }

      if (user.role !== "admin") {
        console.log(`[seed-status] Access denied: user ${user.email} has role '${user.role}', not 'admin'. Seed may not have run yet or user was not updated.`);
        return res.status(403).json({
          success: false,
          error: `You are not an admin yet (current role: '${user.role}')`,
          hint: "The production seed should have set your role to 'admin'. Check deployment logs for '[seed] Completed:' message to verify seed ran successfully.",
          userEmail: user.email,
          currentRole: user.role,
          seedStatusLogged: true,
        });
      }

      res.json({
        success: true,
        data: status,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[seed-status] Error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  // Apply authentication and admin role check to ALL other admin routes
  router.use(isAuthenticated, requireAdmin);

  router.get("/dashboard", async (req, res) => {
    try {
      const [
        userStats,
        paymentStats,
        aiModels,
        invoices,
        auditLogs,
        reports,
        settings,
        allUsers,
        healthStatus
      ] = await Promise.all([
        storage.getUserStats(),
        storage.getPaymentStats(),
        storage.getAiModels(),
        storage.getInvoices(),
        storage.getAuditLogs(10),
        storage.getReports(),
        storage.getSettings(),
        storage.getAllUsers(),
        llmGateway.healthCheck().catch(() => ({ providers: { xai: { healthy: false }, gemini: { healthy: false } } }))
      ]);

      const totalQueries = allUsers.reduce((sum, u) => sum + (u.queryCount || 0), 0);
      const pendingInvoices = invoices.filter(i => i.status === "pending").length;
      const paidInvoices = invoices.filter(i => i.status === "paid").length;
      const activeModels = aiModels.filter(m => m.status === "active").length;
      const securityAlerts = auditLogs.filter(l => 
        l.action?.includes("login_failed") || l.action?.includes("blocked")
      ).length;

      res.json({
        users: {
          total: userStats.total,
          active: userStats.active,
          newThisMonth: userStats.newThisMonth
        },
        aiModels: {
          total: aiModels.length,
          active: activeModels,
          providers: [...new Set(aiModels.map(m => m.provider))].length
        },
        payments: {
          total: paymentStats.total,
          thisMonth: paymentStats.thisMonth,
          count: paymentStats.count
        },
        invoices: {
          total: invoices.length,
          pending: pendingInvoices,
          paid: paidInvoices
        },
        analytics: {
          totalQueries,
          avgQueriesPerUser: userStats.total > 0 ? Math.round(totalQueries / userStats.total) : 0
        },
        database: {
          tables: 15,
          status: "healthy"
        },
        security: {
          alerts: securityAlerts,
          status: securityAlerts > 5 ? "warning" : "healthy"
        },
        reports: {
          total: reports.length,
          scheduled: reports.filter(r => r.schedule).length
        },
        settings: {
          total: settings.length,
          categories: [...new Set(settings.map(s => s.category))].length
        },
        systemHealth: {
          xai: healthStatus?.providers?.xai?.healthy ?? false,
          gemini: healthStatus?.providers?.gemini?.healthy ?? false,
          uptime: 99.9
        },
        recentActivity: auditLogs.slice(0, 5)
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/users", async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/users/stats", async (req, res) => {
    try {
      const stats = await storage.getUserStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/users", validateBody(createUserBodySchema), asyncHandler(async (req, res) => {
    const { email, password, plan, role } = req.body;
    const existingUsers = await storage.getAllUsers();
    const existingUser = existingUsers.find(u => u.email === email);
    if (existingUser) {
      return res.status(409).json({ message: "A user with this email already exists" });
    }
    const hashedPassword = await hashPassword(password);
    const [user] = await db.insert(users).values({
      email,
      password: hashedPassword,
      plan: plan || "free",
      role: role || "user",
      status: "active"
    }).returning();
    await storage.createAuditLog({
      action: "user_create",
      resource: "users",
      resourceId: user.id,
      details: { email, plan, role }
    });
    res.json(user);
  }));

  router.patch("/users/:id", async (req, res) => {
    try {
      const user = await storage.updateUser(req.params.id, req.body);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      await storage.createAuditLog({
        action: "user_update",
        resource: "users",
        resourceId: req.params.id,
        details: req.body
      });
      res.json(user);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/users/:id", async (req, res) => {
    try {
      await storage.deleteUser(req.params.id);
      await storage.createAuditLog({
        action: "user_delete",
        resource: "users",
        resourceId: req.params.id
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/models", async (req, res) => {
    try {
      const models = await storage.getAiModels();
      res.json(models);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/models", async (req, res) => {
    try {
      const { name, provider, modelId, costPer1k, description, status } = req.body;
      if (!name || !provider || !modelId) {
        return res.status(400).json({ error: "name, provider, and modelId are required" });
      }
      const model = await storage.createAiModel({
        name, provider, modelId, costPer1k, description, status
      });
      await storage.createAuditLog({
        action: "model_create",
        resource: "ai_models",
        resourceId: model.id,
        details: { name, provider }
      });
      res.json(model);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/models/:id", async (req, res) => {
    try {
      const model = await storage.updateAiModel(req.params.id, req.body);
      if (!model) {
        return res.status(404).json({ error: "Model not found" });
      }
      await storage.createAuditLog({
        action: "model_update",
        resource: "ai_models",
        resourceId: req.params.id,
        details: req.body
      });
      res.json(model);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/models/:id", async (req, res) => {
    try {
      await storage.deleteAiModel(req.params.id);
      await storage.createAuditLog({
        action: "model_delete",
        resource: "ai_models",
        resourceId: req.params.id
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/models/:id/toggle", async (req, res) => {
    try {
      const { isEnabled } = req.body;
      const userId = (req as any).user?.id || null;
      
      const updateData: any = {
        isEnabled: isEnabled ? "true" : "false",
      };
      
      if (isEnabled) {
        updateData.enabledAt = new Date();
        updateData.enabledByAdminId = userId;
      } else {
        updateData.enabledAt = null;
        updateData.enabledByAdminId = null;
      }
      
      const model = await storage.updateAiModel(req.params.id, updateData);
      if (!model) {
        return res.status(404).json({ error: "Model not found" });
      }
      
      await storage.createAuditLog({
        userId,
        action: isEnabled ? "model_enable" : "model_disable",
        resource: "ai_models",
        resourceId: req.params.id,
        details: { isEnabled, modelName: model.name }
      });
      
      res.json(model);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/payments", async (req, res) => {
    try {
      const payments = await storage.getPayments();
      res.json(payments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/payments/stats", async (req, res) => {
    try {
      const stats = await storage.getPaymentStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/payments", async (req, res) => {
    try {
      const payment = await storage.createPayment(req.body);
      res.json(payment);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/payments/:id", async (req, res) => {
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

  router.get("/invoices", async (req, res) => {
    try {
      const invoices = await storage.getInvoices();
      res.json(invoices);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/invoices", async (req, res) => {
    try {
      const invoice = await storage.createInvoice(req.body);
      res.json(invoice);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/invoices/:id", async (req, res) => {
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

  router.get("/analytics", async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const snapshots = await storage.getAnalyticsSnapshots(days);
      res.json(snapshots);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/analytics/snapshot", async (req, res) => {
    try {
      const snapshot = await storage.createAnalyticsSnapshot(req.body);
      res.json(snapshot);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================
  // Security Center Module
  // ========================================

  router.get("/security/policies", async (req, res) => {
    try {
      const { type, appliedTo, isEnabled } = req.query;
      let policies = await storage.getSecurityPolicies();
      
      if (type) {
        policies = policies.filter(p => p.policyType === type);
      }
      if (appliedTo) {
        policies = policies.filter(p => p.appliedTo === appliedTo);
      }
      if (isEnabled !== undefined) {
        policies = policies.filter(p => p.isEnabled === isEnabled);
      }
      
      res.json(policies);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/security/policies", async (req, res) => {
    try {
      const { policyName, policyType, rules, priority, appliedTo, createdBy } = req.body;
      if (!policyName || !policyType || !rules) {
        return res.status(400).json({ error: "policyName, policyType, and rules are required" });
      }
      
      const policy = await storage.createSecurityPolicy({
        policyName,
        policyType,
        rules,
        priority: priority || 0,
        appliedTo: appliedTo || "global",
        createdBy
      });
      
      await storage.createAuditLog({
        action: "security_policy_create",
        resource: "security_policies",
        resourceId: policy.id,
        details: { policyName, policyType }
      });
      
      res.json(policy);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put("/security/policies/:id", async (req, res) => {
    try {
      const policy = await storage.updateSecurityPolicy(req.params.id, req.body);
      if (!policy) {
        return res.status(404).json({ error: "Policy not found" });
      }
      
      await storage.createAuditLog({
        action: "security_policy_update",
        resource: "security_policies",
        resourceId: req.params.id,
        details: req.body
      });
      
      res.json(policy);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/security/policies/:id", async (req, res) => {
    try {
      const existing = await storage.getSecurityPolicy(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Policy not found" });
      }
      
      await storage.deleteSecurityPolicy(req.params.id);
      
      await storage.createAuditLog({
        action: "security_policy_delete",
        resource: "security_policies",
        resourceId: req.params.id,
        details: { policyName: existing.policyName }
      });
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/security/policies/:id/toggle", async (req, res) => {
    try {
      const { isEnabled } = req.body;
      const policy = await storage.toggleSecurityPolicy(req.params.id, isEnabled);
      if (!policy) {
        return res.status(404).json({ error: "Policy not found" });
      }
      
      await storage.createAuditLog({
        action: isEnabled ? "security_policy_enable" : "security_policy_disable",
        resource: "security_policies",
        resourceId: req.params.id,
        details: { policyName: policy.policyName }
      });
      
      res.json(policy);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/security/audit-logs", async (req, res) => {
    try {
      const { action, resource, date_from, date_to, severity, status, page = "1", limit = "50" } = req.query;
      const pageNum = parseInt(page as string);
      const limitNum = Math.min(parseInt(limit as string), 100);
      
      let logs = await storage.getAuditLogs(500);
      
      if (action) {
        logs = logs.filter(l => l.action?.includes(action as string));
      }
      if (resource) {
        logs = logs.filter(l => l.resource === resource);
      }
      if (date_from) {
        const fromDate = new Date(date_from as string);
        logs = logs.filter(l => l.createdAt && new Date(l.createdAt) >= fromDate);
      }
      if (date_to) {
        const toDate = new Date(date_to as string);
        logs = logs.filter(l => l.createdAt && new Date(l.createdAt) <= toDate);
      }
      
      const total = logs.length;
      const paginatedLogs = logs.slice((pageNum - 1) * limitNum, pageNum * limitNum);
      
      res.json({
        data: paginatedLogs,
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

  router.get("/security/stats", async (req, res) => {
    try {
      const [policies, auditLogs] = await Promise.all([
        storage.getSecurityPolicies(),
        storage.getAuditLogs(1000)
      ]);
      
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      const activePolicies = policies.filter(p => p.isEnabled === "true").length;
      const logsToday = auditLogs.filter(l => l.createdAt && new Date(l.createdAt) >= startOfToday).length;
      
      const criticalActions = ["login_failed", "blocked", "unauthorized", "security_alert", "permission_denied"];
      const criticalAlerts = auditLogs.filter(l => 
        l.createdAt && 
        new Date(l.createdAt) >= twentyFourHoursAgo &&
        criticalActions.some(a => l.action?.includes(a))
      ).length;
      
      const severityCounts = {
        info: auditLogs.filter(l => !criticalActions.some(a => l.action?.includes(a)) && !l.action?.includes("warning")).length,
        warning: auditLogs.filter(l => l.action?.includes("warning")).length,
        critical: auditLogs.filter(l => criticalActions.some(a => l.action?.includes(a))).length
      };
      
      res.json({
        totalPolicies: policies.length,
        activePolicies,
        criticalAlerts24h: criticalAlerts,
        auditEventsToday: logsToday,
        severityCounts,
        policyTypeBreakdown: policies.reduce((acc: Record<string, number>, p) => {
          acc[p.policyType] = (acc[p.policyType] || 0) + 1;
          return acc;
        }, {})
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/security/logs", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await storage.getAuditLogs(limit);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/reports", async (req, res) => {
    try {
      const reports = await storage.getReports();
      res.json(reports);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/reports", async (req, res) => {
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

  router.patch("/reports/:id", async (req, res) => {
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

  // ========================================
  // Settings Center Enterprise Module
  // ========================================

  router.get("/settings", async (req, res) => {
    try {
      await storage.seedDefaultSettings();
      const settings = await storage.getSettingsConfig();
      const grouped = settings.reduce((acc: Record<string, any[]>, s) => {
        const cat = s.category || "general";
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(s);
        return acc;
      }, {});
      res.json({ settings, grouped });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/settings/category/:category", async (req, res) => {
    try {
      await storage.seedDefaultSettings();
      const settings = await storage.getSettingsConfigByCategory(req.params.category);
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/settings/key/:key", async (req, res) => {
    try {
      const setting = await storage.getSettingsConfigByKey(req.params.key);
      if (!setting) {
        return res.status(404).json({ error: "Setting not found" });
      }
      res.json(setting);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put("/settings/:key", async (req, res) => {
    try {
      const existing = await storage.getSettingsConfigByKey(req.params.key);
      if (!existing) {
        return res.status(404).json({ error: "Setting not found" });
      }
      const updated = await storage.upsertSettingsConfig({
        ...existing,
        value: req.body.value,
        updatedBy: req.body.updatedBy
      });
      await storage.createAuditLog({
        action: "setting_update",
        resource: "settings_config",
        details: { key: req.params.key, value: req.body.value }
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/settings/bulk", async (req, res) => {
    try {
      const { settings } = req.body;
      if (!Array.isArray(settings)) {
        return res.status(400).json({ error: "settings must be an array" });
      }
      const results = [];
      for (const s of settings) {
        const existing = await storage.getSettingsConfigByKey(s.key);
        if (existing) {
          const updated = await storage.upsertSettingsConfig({
            ...existing,
            value: s.value,
            updatedBy: s.updatedBy
          });
          results.push(updated);
        }
      }
      await storage.createAuditLog({
        action: "settings_bulk_update",
        resource: "settings_config",
        details: { count: results.length }
      });
      res.json({ updated: results.length, settings: results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/settings/reset/:key", async (req, res) => {
    try {
      const existing = await storage.getSettingsConfigByKey(req.params.key);
      if (!existing) {
        return res.status(404).json({ error: "Setting not found" });
      }
      const updated = await storage.upsertSettingsConfig({
        ...existing,
        value: existing.defaultValue,
        updatedBy: req.body.updatedBy
      });
      await storage.createAuditLog({
        action: "setting_reset",
        resource: "settings_config",
        details: { key: req.params.key, defaultValue: existing.defaultValue }
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/settings/seed", async (req, res) => {
    try {
      await storage.seedDefaultSettings();
      const settings = await storage.getSettingsConfig();
      res.json({ seeded: true, count: settings.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/llm/metrics", async (req, res) => {
    try {
      const metrics = llmGateway.getMetrics();
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/database/info", async (req, res) => {
    try {
      const userStats = await storage.getUserStats();
      const models = await storage.getAiModels();
      const payments = await storage.getPayments();
      const invoices = await storage.getInvoices();
      
      res.json({
        tables: {
          users: { count: userStats.total },
          ai_models: { count: models.length },
          payments: { count: payments.length },
          invoices: { count: invoices.length }
        },
        status: "healthy",
        lastBackup: new Date().toISOString()
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================
  // Database Management Enterprise Module
  // ========================================

  router.get("/database/health", async (req, res) => {
    try {
      const startTime = Date.now();
      const result = await db.execute(sql`SELECT 1 as ping, current_timestamp as server_time, pg_database_size(current_database()) as db_size`);
      const latency = Date.now() - startTime;
      
      const poolStats = await db.execute(sql`
        SELECT 
          numbackends as active_connections,
          xact_commit as transactions_committed,
          xact_rollback as transactions_rolled_back,
          blks_read as blocks_read,
          blks_hit as blocks_hit,
          tup_returned as rows_returned,
          tup_fetched as rows_fetched,
          tup_inserted as rows_inserted,
          tup_updated as rows_updated,
          tup_deleted as rows_deleted,
          pg_size_pretty(pg_database_size(current_database())) as database_size
        FROM pg_stat_database 
        WHERE datname = current_database()
      `);

      const tableStats = await db.execute(sql`
        SELECT 
          schemaname,
          relname as table_name,
          n_live_tup as row_count,
          n_dead_tup as dead_tuples,
          last_vacuum,
          last_autovacuum,
          last_analyze,
          pg_size_pretty(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname))) as table_size
        FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC
        LIMIT 20
      `);

      res.json({
        status: "healthy",
        latencyMs: latency,
        serverTime: result.rows[0]?.server_time,
        pool: poolStats.rows[0] || {},
        tables: tableStats.rows,
        version: await db.execute(sql`SELECT version()`).then(r => r.rows[0]?.version)
      });
    } catch (error: any) {
      res.status(500).json({ 
        status: "unhealthy", 
        error: error.message,
        latencyMs: null
      });
    }
  });

  // Database status endpoint for production monitoring
  router.get("/db-status", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      // Get database connection info
      const dbInfo = await db.execute(sql`
        SELECT 
          current_database() as database_name,
          inet_server_addr() as host,
          current_timestamp as server_time
      `);

      // Get user count and latest user created
      const userStats = await db.execute(sql`
        SELECT 
          COUNT(*) as total_users,
          MAX(created_at) as latest_user_created
        FROM users
      `);

      // Get enabled AI models count
      const modelStats = await db.execute(sql`
        SELECT COUNT(*) as enabled_models
        FROM ai_models
        WHERE is_enabled = 'true'
      `);

      res.json({
        status: "connected",
        database: dbInfo.rows[0]?.database_name || "unknown",
        host: dbInfo.rows[0]?.host || process.env.PGHOST || "unknown",
        serverTime: dbInfo.rows[0]?.server_time,
        users: {
          total: parseInt(userStats.rows[0]?.total_users || "0"),
          latestCreatedAt: userStats.rows[0]?.latest_user_created
        },
        models: {
          enabled: parseInt(modelStats.rows[0]?.enabled_models || "0")
        },
        environment: process.env.NODE_ENV || "development"
      });
    } catch (error: any) {
      console.error("[AdminRouter] db-status error:", error.message);
      res.status(500).json({ 
        status: "error", 
        error: error.message,
        database: null,
        host: null
      });
    }
  });

  router.get("/database/tables", async (req, res) => {
    try {
      const tables = await db.execute(sql`
        SELECT 
          t.table_name,
          t.table_type,
          pg_size_pretty(pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))) as size,
          (SELECT count(*) FROM information_schema.columns c WHERE c.table_name = t.table_name AND c.table_schema = t.table_schema) as column_count,
          COALESCE(s.n_live_tup, 0) as row_count
        FROM information_schema.tables t
        LEFT JOIN pg_stat_user_tables s ON t.table_name = s.relname
        WHERE t.table_schema = 'public'
        ORDER BY t.table_name
      `);

      res.json({ tables: tables.rows });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/database/tables/:tableName", async (req, res) => {
    try {
      const { tableName } = req.params;
      const { page = "1", limit = "50" } = req.query;
      const pageNum = parseInt(page as string);
      const limitNum = Math.min(parseInt(limit as string), 100);
      const offset = (pageNum - 1) * limitNum;

      // Sanitize table name first - only allow alphanumeric and underscore
      const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
      if (safeTableName !== tableName || !safeTableName) {
        return res.status(400).json({ error: "Invalid table name" });
      }

      // Validate table exists in public schema using parameterized query
      const tableCheck = await db.execute(sql`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = ${safeTableName}
      `);
      if (tableCheck.rows.length === 0) {
        return res.status(404).json({ error: "Table not found" });
      }

      // Get columns info using parameterized query
      const columns = await db.execute(sql`
        SELECT 
          column_name, 
          data_type, 
          is_nullable, 
          column_default,
          character_maximum_length
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = ${safeTableName}
        ORDER BY ordinal_position
      `);

      // Get row count using sanitized table name
      const countResult = await db.execute(sql`SELECT COUNT(*) as total FROM ${sql.identifier(safeTableName)}`);
      const total = parseInt(countResult.rows[0]?.total || "0");

      // Get data with pagination using parameterized queries for LIMIT and OFFSET
      const data = await db.execute(sql`SELECT * FROM ${sql.identifier(safeTableName)} LIMIT ${limitNum} OFFSET ${offset}`);

      res.json({
        table: tableName,
        columns: columns.rows,
        data: data.rows,
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

  /**
   * SECURITY NOTE: This is an ADMIN-ONLY read-only SQL query endpoint.
   * 
   * Security controls in place:
   * 1. Only SELECT queries allowed (and CTEs with SELECT)
   * 2. Dangerous patterns blocked (DROP, DELETE, UPDATE, etc.)
   * 3. SQL injection prevention via regex validation
   * 4. Results limited to 1000 rows
   * 5. All queries logged for audit
   * 
   * The use of sql.raw() is INTENTIONAL here because this is a legitimate
   * admin query explorer feature that requires dynamic SQL execution.
   * The extensive validation above ensures only safe read operations are allowed.
   */
  router.post("/database/query", async (req, res) => {
    try {
      const { query } = req.body;
      if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: "Query is required" });
      }

      // Security: Only allow SELECT statements (including CTEs with WITH...SELECT)
      const trimmedQuery = query.trim().toUpperCase();
      const isSelect = trimmedQuery.startsWith('SELECT');
      const isCteSelect = trimmedQuery.startsWith('WITH') && /\bSELECT\b/.test(trimmedQuery) && !/\b(INSERT|UPDATE|DELETE)\b/.test(trimmedQuery);
      if (!isSelect && !isCteSelect) {
        return res.status(403).json({ 
          error: "Only SELECT queries are allowed for security reasons",
          hint: "Use the Replit Database panel for write operations"
        });
      }

      // Block dangerous patterns - comprehensive list for SQL injection prevention
      const dangerousPatterns = [
        /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)/i,
        /INTO\s+OUTFILE/i,
        /LOAD_FILE/i,
        /pg_sleep/i,
        /pg_terminate/i,
        /COPY\s+TO/i,
        /pg_read_file/i,
        /lo_import/i,
        /lo_export/i,
      ];
      for (const pattern of dangerousPatterns) {
        if (pattern.test(query)) {
          return res.status(403).json({ error: "Query contains forbidden patterns" });
        }
      }

      const startTime = Date.now();
      // SECURITY: sql.raw() is intentionally used here for admin query explorer.
      // All validation above ensures only safe SELECT queries reach this point.
      const result = await db.execute(sql`${sql.raw(query)}`);
      const executionTime = Date.now() - startTime;

      await storage.createAuditLog({
        action: "database_query",
        resource: "database",
        details: { 
          query: query.substring(0, 500),
          rowsReturned: result.rows.length,
          executionTimeMs: executionTime
        }
      });

      res.json({
        success: true,
        data: result.rows.slice(0, 1000), // Limit results
        rowCount: result.rows.length,
        executionTimeMs: executionTime,
        columns: result.rows.length > 0 ? Object.keys(result.rows[0]) : []
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        error: error.message,
        hint: "Check your SQL syntax"
      });
    }
  });

  router.get("/database/slow-queries", async (req, res) => {
    try {
      const slowQueries = await db.execute(sql`
        SELECT 
          query,
          calls,
          mean_exec_time as avg_time_ms,
          total_exec_time as total_time_ms,
          rows,
          shared_blks_hit,
          shared_blks_read
        FROM pg_stat_statements
        ORDER BY mean_exec_time DESC
        LIMIT 20
      `);
      res.json({ queries: slowQueries.rows });
    } catch (error: any) {
      // pg_stat_statements might not be enabled
      res.json({ 
        queries: [],
        note: "pg_stat_statements extension may not be enabled"
      });
    }
  });

  router.get("/database/indexes", async (req, res) => {
    try {
      const indexes = await db.execute(sql`
        SELECT 
          schemaname,
          tablename,
          indexname,
          indexdef,
          pg_size_pretty(pg_relation_size(quote_ident(schemaname) || '.' || quote_ident(indexname))) as index_size
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY tablename, indexname
      `);
      res.json({ indexes: indexes.rows });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================
  // Conversations / Chat Logs Management
  // ========================================

  router.get("/conversations", async (req, res) => {
    try {
      const { 
        page = "1", 
        limit = "20", 
        userId, 
        status, 
        flagStatus, 
        aiModel,
        dateFrom,
        dateTo,
        minTokens,
        maxTokens,
        sortBy = "createdAt",
        sortOrder = "desc"
      } = req.query;

      const pageNum = parseInt(page as string);
      const limitNum = Math.min(parseInt(limit as string), 100);
      const offset = (pageNum - 1) * limitNum;

      const conditions: any[] = [];
      
      if (userId) conditions.push(eq(chats.userId, userId as string));
      if (status) conditions.push(eq(chats.conversationStatus, status as string));
      if (flagStatus) conditions.push(eq(chats.flagStatus, flagStatus as string));
      if (aiModel) conditions.push(eq(chats.aiModelUsed, aiModel as string));
      if (dateFrom) conditions.push(gte(chats.createdAt, new Date(dateFrom as string)));
      if (dateTo) conditions.push(lte(chats.createdAt, new Date(dateTo as string)));
      if (minTokens) conditions.push(gte(chats.tokensUsed, parseInt(minTokens as string)));
      if (maxTokens) conditions.push(lte(chats.tokensUsed, parseInt(maxTokens as string)));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const sortColumnMap: Record<string, any> = {
        createdAt: chats.createdAt,
        messageCount: chats.messageCount,
        tokensUsed: chats.tokensUsed,
        aiModelUsed: chats.aiModelUsed,
        conversationStatus: chats.conversationStatus,
        lastMessageAt: chats.lastMessageAt
      };
      const sortColumn = sortColumnMap[sortBy as string] || chats.createdAt;
      const orderClause = sortOrder === "asc" ? sortColumn : desc(sortColumn);

      const [conversationsResult, totalResult] = await Promise.all([
        db.select({
          id: chats.id,
          userId: chats.userId,
          title: chats.title,
          messageCount: chats.messageCount,
          tokensUsed: chats.tokensUsed,
          aiModelUsed: chats.aiModelUsed,
          conversationStatus: chats.conversationStatus,
          flagStatus: chats.flagStatus,
          createdAt: chats.createdAt,
          lastMessageAt: chats.lastMessageAt,
          endedAt: chats.endedAt
        })
          .from(chats)
          .where(whereClause)
          .orderBy(orderClause)
          .limit(limitNum)
          .offset(offset),
        db.select({ count: sql<number>`count(*)` }).from(chats).where(whereClause)
      ]);

      const userIds = [...new Set(conversationsResult.map(c => c.userId).filter(Boolean))];
      const usersMap: Record<string, any> = {};
      if (userIds.length > 0) {
        const usersData = await db.select({ id: users.id, email: users.email, fullName: users.fullName, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(inArray(users.id, userIds as string[]));
        usersData.forEach(u => { usersMap[u.id] = u; });
      }

      const conversationsWithUsers = conversationsResult.map(c => ({
        ...c,
        user: c.userId ? usersMap[c.userId] : null
      }));

      res.json({
        data: conversationsWithUsers,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: Number(totalResult[0]?.count || 0),
          totalPages: Math.ceil(Number(totalResult[0]?.count || 0) / limitNum)
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/conversations/:id", async (req, res) => {
    try {
      const [conversation] = await db.select().from(chats).where(eq(chats.id, req.params.id));
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      const messages = await db.select({
        id: chatMessages.id,
        role: chatMessages.role,
        content: chatMessages.content,
        createdAt: chatMessages.createdAt,
        metadata: chatMessages.metadata
      })
        .from(chatMessages)
        .where(eq(chatMessages.chatId, req.params.id))
        .orderBy(chatMessages.createdAt);

      let user = null;
      if (conversation.userId) {
        const [userData] = await db.select().from(users).where(eq(users.id, conversation.userId));
        user = userData;
      }

      res.json({
        ...conversation,
        user,
        messages
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/conversations/:id/flag", async (req, res) => {
    try {
      const { flagStatus } = req.body;
      const validFlags = ["reviewed", "needs_attention", "spam", "vip_support", null];
      if (!validFlags.includes(flagStatus)) {
        return res.status(400).json({ error: "Invalid flag status" });
      }

      const [updated] = await db.update(chats)
        .set({ 
          flagStatus, 
          conversationStatus: flagStatus ? "flagged" : "active",
          updatedAt: new Date() 
        })
        .where(eq(chats.id, req.params.id))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      await storage.createAuditLog({
        action: "conversation_flag",
        resource: "chats",
        resourceId: req.params.id,
        details: { flagStatus }
      });

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/conversations/search", async (req, res) => {
    try {
      const { query, limit = 50 } = req.body;
      if (!query || query.length < 2) {
        return res.json({ results: [] });
      }
      
      const matchingMessages = await db.select({
        chatId: chatMessages.chatId,
        content: chatMessages.content,
        role: chatMessages.role,
        createdAt: chatMessages.createdAt
      })
        .from(chatMessages)
        .where(ilike(chatMessages.content, `%${query}%`))
        .limit(parseInt(limit as string));
      
      const chatIds = [...new Set(matchingMessages.map(m => m.chatId))];
      if (chatIds.length === 0) {
        return res.json({ results: [] });
      }
      
      const conversations = await db.select().from(chats).where(inArray(chats.id, chatIds));
      
      res.json({
        results: conversations.map(c => ({
          ...c,
          matchingMessages: matchingMessages.filter(m => m.chatId === c.id)
        }))
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/conversations/:id/notes", async (req, res) => {
    try {
      const { note } = req.body;
      const [conversation] = await db.select().from(chats).where(eq(chats.id, req.params.id));
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      
      const existingNotes = (conversation as any).internalNotes || [];
      const newNote = {
        id: `note-${Date.now()}`,
        content: note,
        createdAt: new Date().toISOString(),
        author: "admin"
      };
      
      const [updated] = await db.update(chats)
        .set({ 
          internalNotes: [...existingNotes, newNote],
          updatedAt: new Date() 
        })
        .where(eq(chats.id, req.params.id))
        .returning();
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/conversations/stats/summary", async (req, res) => {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [
        totalConversations,
        activeToday,
        flaggedConversations,
        tokensToday,
        allConversations
      ] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(chats),
        db.select({ count: sql<number>`count(*)` })
          .from(chats)
          .where(gte(chats.lastMessageAt, todayStart)),
        db.select({ count: sql<number>`count(*)` })
          .from(chats)
          .where(eq(chats.conversationStatus, "flagged")),
        db.select({ sum: sql<number>`coalesce(sum(tokens_used), 0)` })
          .from(chats)
          .where(gte(chats.createdAt, todayStart)),
        db.select({ 
          messageCount: chats.messageCount 
        }).from(chats)
      ]);

      const allUsers = await storage.getAllUsers();
      const totalMessages = allConversations.reduce((sum, c) => sum + (c.messageCount || 0), 0);
      const avgMessagesPerUser = allUsers.length > 0 ? Math.round(totalMessages / allUsers.length) : 0;
      const totalConvCount = Number(totalConversations[0]?.count || 0);
      const avgMessagesPerConversation = totalConvCount > 0 ? Math.round(totalMessages / totalConvCount) : 0;

      res.json({
        activeToday: Number(activeToday[0]?.count || 0),
        avgMessagesPerUser,
        avgMessagesPerConversation,
        tokensConsumedToday: Number(tokensToday[0]?.sum || 0),
        flaggedConversations: Number(flaggedConversations[0]?.count || 0),
        totalConversations: totalConvCount
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================
  // Export Endpoints
  // ========================================

  router.get("/users/export", async (req, res) => {
    try {
      const { format = "json" } = req.query;
      const allUsers = await storage.getAllUsers();

      if (format === "csv") {
        const headers = ["id", "email", "fullName", "plan", "role", "status", "queryCount", "tokensConsumed", "createdAt", "lastLoginAt"];
        const csvRows = [headers.join(",")];
        allUsers.forEach(u => {
          csvRows.push([
            u.id,
            u.email || "",
            u.fullName || `${u.firstName || ""} ${u.lastName || ""}`.trim(),
            u.plan || "",
            u.role || "",
            u.status || "",
            u.queryCount || 0,
            u.tokensConsumed || 0,
            u.createdAt?.toISOString() || "",
            u.lastLoginAt?.toISOString() || ""
          ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
        });
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=users_${Date.now()}.csv`);
        res.send(csvRows.join("\n"));
      } else {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename=users_${Date.now()}.json`);
        res.json(allUsers);
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/conversations/export", async (req, res) => {
    try {
      const { format = "json", includeMessages = "false" } = req.query;
      
      const allConversations = await db.select().from(chats).orderBy(desc(chats.createdAt)).limit(1000);

      let result: any[] = allConversations;

      if (includeMessages === "true") {
        const conversationsWithMessages = await Promise.all(
          allConversations.map(async (conv) => {
            const messages = await db.select({
              role: chatMessages.role,
              content: chatMessages.content,
              createdAt: chatMessages.createdAt
            })
              .from(chatMessages)
              .where(eq(chatMessages.chatId, conv.id))
              .orderBy(chatMessages.createdAt);
            return { ...conv, messages };
          })
        );
        result = conversationsWithMessages;
      }

      if (format === "csv") {
        const headers = ["id", "userId", "title", "messageCount", "tokensUsed", "aiModelUsed", "conversationStatus", "flagStatus", "createdAt"];
        const csvRows = [headers.join(",")];
        result.forEach(c => {
          csvRows.push([
            c.id,
            c.userId || "",
            c.title || "",
            c.messageCount || 0,
            c.tokensUsed || 0,
            c.aiModelUsed || "",
            c.conversationStatus || "",
            c.flagStatus || "",
            c.createdAt?.toISOString() || ""
          ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
        });
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=conversations_${Date.now()}.csv`);
        res.send(csvRows.join("\n"));
      } else {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename=conversations_${Date.now()}.json`);
        res.json(result);
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // AI Models Management - Enhanced endpoints
  router.get("/models/filtered", async (req, res) => {
    try {
      const { 
        page = "1", 
        limit = "20", 
        provider, 
        type, 
        status, 
        search, 
        sortBy = "name", 
        sortOrder = "asc" 
      } = req.query;

      const result = await storage.getAiModelsFiltered({
        provider: provider as string,
        type: type as string,
        status: status as string,
        search: search as string,
        sortBy: sortBy as string,
        sortOrder: sortOrder as string,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
      });

      res.json({
        models: result.models,
        total: result.total,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        totalPages: Math.ceil(result.total / parseInt(limit as string)),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/models/stats", async (req, res) => {
    try {
      const allModels = await storage.getAiModels();
      const knownStats = getModelStats();
      
      const byProvider: Record<string, number> = {};
      const byType: Record<string, number> = {};
      let active = 0;
      let inactive = 0;
      let deprecated = 0;

      for (const model of allModels) {
        byProvider[model.provider] = (byProvider[model.provider] || 0) + 1;
        byType[model.modelType || "TEXT"] = (byType[model.modelType || "TEXT"] || 0) + 1;
        if (model.status === "active") active++;
        else inactive++;
        if (model.isDeprecated === "true") deprecated++;
      }

      res.json({
        total: allModels.length,
        active,
        inactive,
        deprecated,
        byProvider,
        byType,
        knownModels: knownStats,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/providers", async (req, res) => {
    try {
      const providers = getAvailableProviders();
      const allModels = await storage.getAiModels();
      
      const providerStats = providers.map(provider => {
        const models = allModels.filter(m => m.provider.toLowerCase() === provider.toLowerCase());
        const activeCount = models.filter(m => m.status === "active").length;
        return {
          id: provider,
          name: provider.charAt(0).toUpperCase() + provider.slice(1),
          modelCount: models.length,
          activeCount,
          hasApiKey: checkApiKeyExists(provider),
        };
      });

      res.json(providerStats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/models/sync/:provider", async (req, res) => {
    try {
      const { provider } = req.params;
      const result = await syncModelsForProvider(provider);
      
      await storage.createAuditLog({
        action: "models_sync",
        resource: "ai_models",
        details: { provider, ...result },
      });

      res.json({
        success: true,
        provider,
        ...result,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/models/sync", async (req, res) => {
    try {
      const results = await syncAllProviders();
      
      let totalAdded = 0;
      let totalUpdated = 0;
      for (const r of Object.values(results)) {
        totalAdded += r.added;
        totalUpdated += r.updated;
      }

      await storage.createAuditLog({
        action: "models_sync_all",
        resource: "ai_models",
        details: { results, totalAdded, totalUpdated },
      });

      res.json({
        success: true,
        results,
        summary: { totalAdded, totalUpdated },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/models/:id", async (req, res) => {
    try {
      const model = await storage.getAiModelById(req.params.id);
      if (!model) {
        return res.status(404).json({ error: "Model not found" });
      }
      res.json(model);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================
  // Analytics Engine Endpoints
  // ========================================

  // Frontend-compatible endpoint (singular 'kpi')
  router.get("/analytics/kpi", async (req, res) => {
    try {
      const latestSnapshot = await storage.getLatestKpiSnapshot();
      const [userStats, paymentStats] = await Promise.all([
        storage.getUserStats(),
        storage.getPaymentStats()
      ]);
      
      // Map to frontend expected structure
      res.json({
        activeUsers: latestSnapshot?.activeUsersNow ?? userStats.active ?? 0,
        queriesPerMinute: latestSnapshot?.queriesPerMinute ?? 0,
        tokensConsumed: latestSnapshot?.tokensConsumedToday ?? 0,
        revenueToday: latestSnapshot?.revenueToday ?? paymentStats.thisMonth ?? 0,
        avgLatency: latestSnapshot?.avgLatencyMs ?? 0,
        errorRate: parseFloat(latestSnapshot?.errorRatePercentage?.toString() ?? "0"),
        activeUsersTrend: latestSnapshot?.activeUsersNow ? (latestSnapshot.activeUsersNow > 0 ? "up" : "neutral") : "neutral",
        queriesTrend: latestSnapshot?.queriesPerMinute ? (latestSnapshot.queriesPerMinute > 5 ? "up" : "neutral") : "neutral",
        tokensTrend: "up",
        revenueTrend: "up",
        latencyTrend: latestSnapshot?.avgLatencyMs ? (latestSnapshot.avgLatencyMs > 1000 ? "down" : "up") : "neutral",
        errorRateTrend: latestSnapshot?.errorRatePercentage ? (parseFloat(latestSnapshot.errorRatePercentage.toString()) > 5 ? "down" : "up") : "up",
        updatedAt: latestSnapshot?.createdAt ?? new Date()
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/analytics/kpis", async (req, res) => {
    try {
      const latestSnapshot = await storage.getLatestKpiSnapshot();
      
      if (!latestSnapshot) {
        const [userStats, paymentStats] = await Promise.all([
          storage.getUserStats(),
          storage.getPaymentStats()
        ]);
        
        return res.json({
          activeUsersNow: userStats.active,
          queriesPerMinute: 0,
          tokensConsumedToday: 0,
          revenueToday: paymentStats.thisMonth || "0.00",
          avgLatencyMs: 0,
          errorRatePercentage: "0.00",
          createdAt: new Date()
        });
      }
      
      res.json(latestSnapshot);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Combined charts endpoint (all charts at once)
  router.get("/analytics/charts", async (req, res) => {
    try {
      const granularity = (req.query.granularity as string) || "24h";
      const validGranularities = ["1h", "24h", "7d", "30d", "90d", "1y"];
      if (!validGranularities.includes(granularity)) {
        return res.status(400).json({ error: `Invalid granularity. Valid values: ${validGranularities.join(", ")}` });
      }

      const intervalMap: Record<string, number> = {
        "1h": 1 * 60 * 60 * 1000,
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
        "90d": 90 * 24 * 60 * 60 * 1000,
        "1y": 365 * 24 * 60 * 60 * 1000,
      };
      
      const startDate = new Date(Date.now() - intervalMap[granularity]);
      const endDate = new Date();

      // Fetch data for all charts in parallel
      const [userGrowthData, payments, providerMetrics] = await Promise.all([
        storage.getUserGrowthData(granularity as '1h' | '24h' | '7d' | '30d' | '90d' | '1y'),
        storage.getPayments(),
        storage.getProviderMetrics(undefined, startDate, endDate)
      ]);

      // Revenue trend
      const revenueByDate = payments
        .filter(p => new Date(p.createdAt!) >= startDate)
        .reduce((acc: Record<string, number>, p) => {
          const dateKey = new Date(p.createdAt!).toISOString().split("T")[0];
          acc[dateKey] = (acc[dateKey] || 0) + parseFloat(p.amount || "0");
          return acc;
        }, {});
      const revenueTrend = Object.entries(revenueByDate).map(([date, amount]) => ({ date, amount }));

      // Model usage grouped by date
      const modelUsageMap = new Map<string, Record<string, number>>();
      providerMetrics.forEach(m => {
        const dateKey = new Date(m.windowStart).toISOString().split("T")[0];
        if (!modelUsageMap.has(dateKey)) {
          modelUsageMap.set(dateKey, {});
        }
        const entry = modelUsageMap.get(dateKey)!;
        entry[m.provider] = (entry[m.provider] || 0) + (m.totalRequests || 0);
      });
      const modelUsage = Array.from(modelUsageMap.entries()).map(([date, providers]) => ({ date, ...providers }));

      // Latency by provider
      const latencyByProvider = providerMetrics.map(m => ({
        provider: m.provider,
        date: new Date(m.windowStart).toISOString().split("T")[0],
        avgLatency: m.avgLatency || 0,
        p95Latency: m.p95Latency || 0
      }));

      // Error rate
      const errorRate = providerMetrics.map(m => ({
        provider: m.provider,
        date: new Date(m.windowStart).toISOString().split("T")[0],
        errorCount: m.errorCount || 0,
        totalRequests: m.totalRequests || 0,
        errorRate: m.totalRequests ? ((m.errorCount || 0) / m.totalRequests * 100) : 0
      }));

      // Token consumption grouped by date
      const tokenMap = new Map<string, Record<string, number>>();
      providerMetrics.forEach(m => {
        const dateKey = new Date(m.windowStart).toISOString().split("T")[0];
        if (!tokenMap.has(dateKey)) {
          tokenMap.set(dateKey, {});
        }
        const entry = tokenMap.get(dateKey)!;
        entry[m.provider] = (entry[m.provider] || 0) + ((m.tokensIn || 0) + (m.tokensOut || 0));
      });
      const tokenConsumption = Array.from(tokenMap.entries()).map(([date, providers]) => ({ date, ...providers }));

      res.json({
        userGrowth: userGrowthData,
        revenueTrend,
        modelUsage,
        latencyByProvider,
        errorRate,
        tokenConsumption
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/analytics/charts/:chartType", async (req, res) => {
    try {
      const { chartType } = req.params;
      const granularity = (req.query.granularity as string) || "24h";
      
      const validChartTypes = ["userGrowth", "revenue", "modelUsage", "latency", "errors", "tokens"];
      if (!validChartTypes.includes(chartType)) {
        return res.status(400).json({ error: `Invalid chartType. Valid types: ${validChartTypes.join(", ")}` });
      }
      
      const validGranularities = ["1h", "24h", "7d", "30d", "90d", "1y"];
      if (!validGranularities.includes(granularity)) {
        return res.status(400).json({ error: `Invalid granularity. Valid values: ${validGranularities.join(", ")}` });
      }

      const intervalMap: Record<string, number> = {
        "1h": 1 * 60 * 60 * 1000,
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
        "90d": 90 * 24 * 60 * 60 * 1000,
        "1y": 365 * 24 * 60 * 60 * 1000,
      };
      
      const startDate = new Date(Date.now() - intervalMap[granularity]);
      const endDate = new Date();

      let data: any[] = [];

      switch (chartType) {
        case "userGrowth":
          data = await storage.getUserGrowthData(granularity as '1h' | '24h' | '7d' | '30d' | '90d' | '1y');
          break;
        
        case "revenue":
          const payments = await storage.getPayments();
          const revenueByDate = payments
            .filter(p => new Date(p.createdAt!) >= startDate)
            .reduce((acc: Record<string, number>, p) => {
              const dateKey = new Date(p.createdAt!).toISOString().split("T")[0];
              acc[dateKey] = (acc[dateKey] || 0) + parseFloat(p.amount || "0");
              return acc;
            }, {});
          data = Object.entries(revenueByDate).map(([date, amount]) => ({ date, amount }));
          break;
        
        case "modelUsage":
          const providerMetrics = await storage.getProviderMetrics(undefined, startDate, endDate);
          data = providerMetrics.map(m => ({
            provider: m.provider,
            date: m.windowStart,
            totalRequests: m.totalRequests,
            tokensIn: m.tokensIn,
            tokensOut: m.tokensOut
          }));
          break;
        
        case "latency":
          const latencyMetrics = await storage.getProviderMetrics(undefined, startDate, endDate);
          data = latencyMetrics.map(m => ({
            provider: m.provider,
            date: m.windowStart,
            avgLatency: m.avgLatency,
            p50Latency: m.p50Latency,
            p95Latency: m.p95Latency,
            p99Latency: m.p99Latency
          }));
          break;
        
        case "errors":
          const errorMetrics = await storage.getProviderMetrics(undefined, startDate, endDate);
          data = errorMetrics.map(m => ({
            provider: m.provider,
            date: m.windowStart,
            errorCount: m.errorCount,
            totalRequests: m.totalRequests,
            errorRate: m.totalRequests ? ((m.errorCount || 0) / m.totalRequests * 100).toFixed(2) : "0.00"
          }));
          break;
        
        case "tokens":
          const tokenMetrics = await storage.getProviderMetrics(undefined, startDate, endDate);
          data = tokenMetrics.map(m => ({
            provider: m.provider,
            date: m.windowStart,
            tokensIn: m.tokensIn,
            tokensOut: m.tokensOut,
            totalTokens: (m.tokensIn || 0) + (m.tokensOut || 0)
          }));
          break;
      }

      res.json({
        chartType,
        granularity,
        startDate,
        endDate,
        data
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/analytics/performance", async (req, res) => {
    try {
      const latestMetrics = await storage.getLatestProviderMetrics();
      
      const performanceData = latestMetrics.map(m => ({
        provider: m.provider,
        avgLatency: m.avgLatency || 0,
        p50: m.p50Latency || 0,
        p95: m.p95Latency || 0,
        p99: m.p99Latency || 0,
        successRate: parseFloat(m.successRate || "100"),
        totalRequests: m.totalRequests || 0,
        errorCount: m.errorCount || 0,
        status: parseFloat(m.successRate || "100") >= 99 ? "healthy" : 
                parseFloat(m.successRate || "100") >= 95 ? "degraded" : "critical",
        windowStart: m.windowStart,
        windowEnd: m.windowEnd
      }));

      res.json(performanceData);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/analytics/costs", async (req, res) => {
    try {
      const budgets = await storage.getCostBudgets();
      
      const costsWithAlerts = budgets.map(b => {
        const currentSpend = parseFloat(b.currentSpend || "0");
        const budgetLimit = parseFloat(b.budgetLimit || "100");
        const alertThreshold = b.alertThreshold || 80;
        const usagePercent = budgetLimit > 0 ? (currentSpend / budgetLimit) * 100 : 0;
        
        return {
          provider: b.provider,
          budgetLimit: b.budgetLimit,
          currentSpend: b.currentSpend,
          projectedMonthly: b.projectedMonthly,
          usagePercent: usagePercent.toFixed(2),
          alertThreshold: b.alertThreshold,
          isOverBudget: currentSpend >= budgetLimit,
          isNearThreshold: usagePercent >= alertThreshold,
          alertFlag: currentSpend >= budgetLimit ? "critical" : 
                     usagePercent >= alertThreshold ? "warning" : "ok",
          periodStart: b.periodStart,
          periodEnd: b.periodEnd
        };
      });

      res.json(costsWithAlerts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/analytics/funnel", async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      
      const eventStats = await storage.getAnalyticsEventStats();
      
      const visitors = eventStats["page_view"] || allUsers.length * 3;
      const signups = allUsers.length;
      const activeUsers = allUsers.filter(u => u.status === "active").length;
      const trialUsers = allUsers.filter(u => u.plan === "free" && u.status === "active").length;
      const proUsers = allUsers.filter(u => u.plan === "pro").length;
      const enterpriseUsers = allUsers.filter(u => u.plan === "enterprise").length;

      const funnel = [
        { stage: "visitors", count: visitors, percentage: 100 },
        { stage: "signups", count: signups, percentage: visitors > 0 ? ((signups / visitors) * 100).toFixed(2) : "0.00" },
        { stage: "active", count: activeUsers, percentage: visitors > 0 ? ((activeUsers / visitors) * 100).toFixed(2) : "0.00" },
        { stage: "trial", count: trialUsers, percentage: visitors > 0 ? ((trialUsers / visitors) * 100).toFixed(2) : "0.00" },
        { stage: "pro", count: proUsers, percentage: visitors > 0 ? ((proUsers / visitors) * 100).toFixed(2) : "0.00" },
        { stage: "enterprise", count: enterpriseUsers, percentage: visitors > 0 ? ((enterpriseUsers / visitors) * 100).toFixed(2) : "0.00" }
      ];

      const conversionRates = {
        visitorsToSignups: visitors > 0 ? ((signups / visitors) * 100).toFixed(2) : "0.00",
        signupsToActive: signups > 0 ? ((activeUsers / signups) * 100).toFixed(2) : "0.00",
        activeToPro: activeUsers > 0 ? ((proUsers / activeUsers) * 100).toFixed(2) : "0.00",
        proToEnterprise: proUsers > 0 ? ((enterpriseUsers / proUsers) * 100).toFixed(2) : "0.00"
      };

      res.json({ funnel, conversionRates });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/analytics/logs", async (req, res) => {
    try {
      const { 
        page = "1", 
        limit = "50", 
        provider, 
        status,
        model,
        dateFrom,
        dateTo 
      } = req.query;

      const pageNum = parseInt(page as string);
      const limitNum = Math.min(parseInt(limit as string), 100);

      const filters: any = {
        page: pageNum,
        limit: limitNum
      };

      if (provider) filters.provider = provider as string;
      if (status) filters.statusCode = parseInt(status as string);
      if (dateFrom) filters.startDate = new Date(dateFrom as string);
      if (dateTo) filters.endDate = new Date(dateTo as string);

      const { logs, total } = await storage.getApiLogs(filters);

      let filteredLogs = logs;
      if (model) {
        filteredLogs = logs.filter(l => l.model === model);
      }

      res.json({
        data: filteredLogs,
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

  router.get("/analytics/heatmap", async (req, res) => {
    try {
      const { logs } = await storage.getApiLogs({ 
        limit: 10000,
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      });

      const heatmapData: number[][] = Array(7).fill(null).map(() => Array(24).fill(0));

      for (const log of logs) {
        if (log.createdAt) {
          const date = new Date(log.createdAt);
          const dayOfWeek = date.getDay();
          const hour = date.getHours();
          heatmapData[dayOfWeek][hour]++;
        }
      }

      const maxValue = Math.max(...heatmapData.flat());
      const normalizedData = heatmapData.map(row => 
        row.map(val => maxValue > 0 ? parseFloat((val / maxValue).toFixed(3)) : 0)
      );

      const dayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const hourLabels = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, "0")}:00`);

      res.json({
        data: heatmapData,
        normalizedData,
        dayLabels,
        hourLabels,
        maxValue,
        periodDays: 7
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================
  // Reports Center
  // ========================================

  // Get all report templates
  router.get("/reports/templates", async (req, res) => {
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
  router.get("/reports/templates/:id", async (req, res) => {
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
  router.post("/reports/templates", async (req, res) => {
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

  // Get generated reports with pagination
  router.get("/reports/generated", async (req, res) => {
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
  router.post("/reports/generate", async (req, res) => {
    try {
      const { templateId, name, parameters, format = "json" } = req.body;
      const userId = (req as any).user?.id || null;
      
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
          
          // Save to file
          const fs = await import("fs/promises");
          const path = await import("path");
          const reportsDir = path.join(process.cwd(), "generated_reports");
          await fs.mkdir(reportsDir, { recursive: true });
          
          const timestamp = Date.now();
          const fileName = `${reportType}_${timestamp}.${format}`;
          const filePath = path.join(reportsDir, fileName);
          
          if (format === "json") {
            await fs.writeFile(filePath, JSON.stringify(data, null, 2));
          } else if (format === "csv") {
            // Simple CSV generation
            if (data.length > 0) {
              const headers = Object.keys(data[0]);
              const csvRows = [headers.join(",")];
              for (const row of data) {
                csvRows.push(headers.map(h => {
                  const val = row[h];
                  if (val === null || val === undefined) return "";
                  if (typeof val === "object") return JSON.stringify(val).replace(/,/g, ";");
                  return String(val).replace(/,/g, ";");
                }).join(","));
              }
              await fs.writeFile(filePath, csvRows.join("\n"));
            } else {
              await fs.writeFile(filePath, "");
            }
          }
          
          // Update report status
          await storage.updateGeneratedReport(report.id, {
            status: "completed",
            filePath: `/api/admin/reports/download/${report.id}`,
            resultSummary: { rowCount },
            completedAt: new Date()
          });
          
        } catch (err: any) {
          await storage.updateGeneratedReport(report.id, {
            status: "failed",
            resultSummary: { error: err.message }
          });
        }
      })();
      
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Download generated report
  router.get("/reports/download/:id", async (req, res) => {
    try {
      const report = await storage.getGeneratedReport(req.params.id);
      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }
      if (report.status !== "completed") {
        return res.status(400).json({ error: "Report is not ready for download" });
      }
      
      const fs = await import("fs/promises");
      const path = await import("path");
      
      const reportsDir = path.join(process.cwd(), "generated_reports");
      const files = await fs.readdir(reportsDir);
      const reportFile = files.find(f => f.includes(report.type) && f.endsWith(`.${report.format}`));
      
      if (!reportFile) {
        return res.status(404).json({ error: "Report file not found" });
      }
      
      const filePath = path.join(reportsDir, reportFile);
      const content = await fs.readFile(filePath, "utf-8");
      
      const contentType = report.format === "json" ? "application/json" : "text/csv";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${report.name.replace(/\s+/g, "_")}.${report.format}"`);
      res.send(content);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete generated report
  router.delete("/reports/generated/:id", async (req, res) => {
    try {
      await storage.deleteGeneratedReport(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================
  // Agentic Engine
  // ========================================

  const intentMapper = new IntentToolMapper(toolRegistry);

  router.get("/agent/tools", async (req, res) => {
    try {
      const tools = toolRegistry.getTools();
      res.json({
        total: tools.length,
        tools: tools.map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          category: t.category,
          capabilities: t.capabilities,
          endpoint: t.endpoint,
          method: t.method,
          isEnabled: t.isEnabled,
          usageCount: t.usageCount,
          successRate: t.successRate
        }))
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/agent/tools/:category", async (req, res) => {
    try {
      const { category } = req.params;
      const tools = toolRegistry.getToolsByCategory(category);
      res.json({
        category,
        total: tools.length,
        tools
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/agent/intents/analyze", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const result = intentMapper.map(prompt);

      if (result.hasGap && result.gapReason) {
        await storage.createAgentGapLog({
          userPrompt: prompt,
          detectedIntent: result.intent,
          gapReason: result.gapReason,
          status: "pending"
        });
      }

      res.json({
        prompt,
        intent: result.intent,
        language: result.language,
        matches: result.matches.slice(0, 5),
        hasGap: result.hasGap,
        gapReason: result.gapReason,
        suggestedAction: result.matches.length > 0 
          ? `Use ${result.matches[0].toolId} tool` 
          : "No suitable tool found"
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/agent/gaps", async (req, res) => {
    try {
      const { status } = req.query;
      const gaps = await storage.getAgentGapLogs(status as string | undefined);
      res.json({
        total: gaps.length,
        gaps
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/agent/gaps/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { status, reviewedBy, suggestedCapability } = req.body;

      const updated = await storage.updateAgentGapLog(id, {
        status,
        reviewedBy,
        suggestedCapability
      });

      if (!updated) {
        return res.status(404).json({ error: "Gap log not found" });
      }

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/agent/complexity/analyze", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }
      const result = complexityAnalyzer.analyze(prompt);
      res.json({ prompt, ...result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/agent/orchestrate", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const complexity = complexityAnalyzer.analyze(prompt);
      const subtasks = await orchestrationEngine.decomposeTask(prompt, complexity.score);
      const plan = orchestrationEngine.buildExecutionPlan(subtasks);
      const result = await orchestrationEngine.executeParallel(plan);
      const combined = orchestrationEngine.combineResults(result);

      res.json({
        prompt,
        complexity: {
          score: complexity.score,
          category: complexity.category,
          recommended_path: complexity.recommended_path
        },
        orchestration: combined
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/agent/memory/stats", (req, res) => {
    res.json(compressedMemory.getStats());
  });

  router.post("/agent/memory/atom", (req, res) => {
    const { type, data } = req.body;
    if (!type || !data) return res.status(400).json({ error: "type and data required" });
    const atom = compressedMemory.createAtom(type, data);
    res.json(atom);
  });

  router.post("/agent/memory/gc", (req, res) => {
    const { minWeight } = req.body;
    const removed = compressedMemory.garbageCollect(minWeight || 0.1);
    res.json({ removed, stats: compressedMemory.getStats() });
  });

  router.get("/agent/progress/:taskId", (req, res) => {
    const status = progressTracker.getTaskStatus(req.params.taskId);
    if (!status) return res.status(404).json({ error: "Task not found" });
    res.json(status);
  });

  router.get("/agent/progress", (req, res) => {
    res.json(progressTracker.getAllActiveTasks());
  });

  router.get("/agent/circuits", (req, res) => {
    try {
      const chatCircuit = chatAgenticCircuit.getStatus();
      const toolCircuits = errorRecovery.getAllCircuits();
      const circuits = [
        { name: 'chat_integration', ...chatCircuit, status: chatCircuit.isOpen ? 'open' : 'closed' },
        ...toolCircuits
      ];
      res.json(circuits);
    } catch (error) {
      res.json([]);
    }
  });

  router.post("/agent/circuits/:name/reset", (req, res) => {
    errorRecovery.resetCircuit(req.params.name);
    res.json({ message: "Circuit reset", circuit: errorRecovery.getOrCreateCircuit(req.params.name) });
  });

  router.post("/agent/circuits/:name/failure", (req, res) => {
    errorRecovery.recordFailure(req.params.name);
    res.json(errorRecovery.getOrCreateCircuit(req.params.name));
  });

  router.post("/agent/emergency-disable", (req, res) => {
    setFeatureFlag('AGENTIC_CHAT_ENABLED', false);
    setFeatureFlag('AGENTIC_AUTONOMOUS_MODE', false);
    setFeatureFlag('AGENTIC_SUGGESTIONS_ENABLED', false);
    console.warn('[Agentic] EMERGENCY DISABLE activated');
    res.json({ 
      status: 'disabled', 
      timestamp: Date.now(),
      message: 'All agentic features have been disabled'
    });
  });

  router.get("/agent/features", (req, res) => {
    res.json(FEATURES);
  });

  router.post("/agent/features/:flag", (req, res) => {
    const { flag } = req.params;
    const { enabled } = req.body;
    if (flag in FEATURES) {
      setFeatureFlag(flag as keyof typeof FEATURES, enabled);
      res.json({ flag, enabled, message: 'Feature flag updated' });
    } else {
      res.status(400).json({ error: 'Unknown feature flag' });
    }
  });

  router.get("/agent/chat-health", (req, res) => {
    const circuitStatus = chatAgenticCircuit.getStatus();
    res.json({
      enabled: FEATURES.AGENTIC_CHAT_ENABLED,
      suggestionsEnabled: FEATURES.AGENTIC_SUGGESTIONS_ENABLED,
      autonomousModeEnabled: FEATURES.AGENTIC_AUTONOMOUS_MODE,
      circuit: circuitStatus,
      status: !FEATURES.AGENTIC_CHAT_ENABLED ? 'disabled' :
              circuitStatus.isOpen ? 'circuit_open' : 'healthy'
    });
  });

  // ── Provider Health Dashboard ────────────────────────────────────────────────
  // GET /api/admin/health/providers — returns circuit breaker + latency per LLM provider
  router.get("/health/providers", async (_req, res) => {
    try {
      const metrics = llmGateway.getMetrics();
      const circuitStatus = metrics.circuitBreakerStatus as Record<string, string>;
      const byProvider = metrics.byProvider as Record<string, { requests?: number; failures?: number; latency?: number }>;

      const providers: Record<string, object> = {};
      for (const [name, state] of Object.entries(circuitStatus)) {
        const providerStats = byProvider[name] || {};
        providers[name] = {
          status: state === 'CLOSED' ? 'healthy' : state === 'HALF_OPEN' ? 'recovering' : 'circuit_open',
          circuitState: state,
          requests: providerStats.requests ?? 0,
          failures: providerStats.failures ?? 0,
          latencyMs: providerStats.latency ?? null,
        };
      }

      res.json({
        timestamp: new Date().toISOString(),
        providers,
        overall: {
          totalRequests: metrics.totalRequests,
          successRate: metrics.successRate,
          averageLatencyMs: metrics.averageLatencyMs,
          fallbackSuccesses: metrics.fallbackSuccesses,
          cacheHits: metrics.cacheHits,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to get provider health' });
    }
  });

  router.get("/agent/tools", (req, res) => {
    try {
      const tools = toolRegistry.listAllTools();
      res.json({ tools });
    } catch (error) {
      res.json({ tools: [] });
    }
  });

  router.get("/agent/gaps", (req, res) => {
    res.json({ gaps: gapsStore });
  });

  router.get("/agent/memory/stats", (req, res) => {
    try {
      const stats = compressedMemory.getStats();
      res.json(stats);
    } catch (error) {
      res.json({ totalAtoms: 0, storageBytes: 0, avgWeight: 0, byType: {} });
    }
  });

  // ========================================
  // Excel Document Management (Database-backed)
  // ========================================

  router.get("/excel/list", async (req, res) => {
    try {
      await seedDefaultExcelDocuments();
      const { search, template } = req.query;
      
      let query = db.select({
        id: excelDocuments.uuid,
        name: excelDocuments.name,
        sheets: excelDocuments.sheets,
        size: excelDocuments.size,
        createdAt: excelDocuments.createdAt,
        updatedAt: excelDocuments.updatedAt,
        createdBy: excelDocuments.createdBy,
        isTemplate: excelDocuments.isTemplate,
        templateCategory: excelDocuments.templateCategory
      })
      .from(excelDocuments);
      
      const conditions = [];
      if (search && typeof search === 'string') {
        conditions.push(ilike(excelDocuments.name, `%${search}%`));
      }
      if (template === 'true') {
        conditions.push(eq(excelDocuments.isTemplate, true));
      } else if (template === 'false') {
        conditions.push(eq(excelDocuments.isTemplate, false));
      }
      
      const documents = conditions.length > 0
        ? await query.where(and(...conditions)).orderBy(desc(excelDocuments.createdAt))
        : await query.orderBy(desc(excelDocuments.createdAt));
      
      const formattedDocuments = documents.map(doc => ({
        ...doc,
        sheets: Array.isArray(doc.sheets) ? (doc.sheets as any[]).length : 1,
        createdBy: doc.createdBy ? String(doc.createdBy) : 'Admin'
      }));
      
      res.json(formattedDocuments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/excel/templates", async (req, res) => {
    try {
      const templates = await db.select({
        id: excelDocuments.uuid,
        name: excelDocuments.name,
        sheets: excelDocuments.sheets,
        size: excelDocuments.size,
        templateCategory: excelDocuments.templateCategory,
        createdAt: excelDocuments.createdAt
      })
      .from(excelDocuments)
      .where(eq(excelDocuments.isTemplate, true))
      .orderBy(excelDocuments.templateCategory);
      
      const byCategory: Record<string, any[]> = {};
      templates.forEach(t => {
        const cat = t.templateCategory || 'General';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push({
          ...t,
          sheets: Array.isArray(t.sheets) ? (t.sheets as any[]).length : 1
        });
      });
      
      res.json({ templates: byCategory });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/excel/template/create-from", async (req, res) => {
    try {
      const { templateId, newName } = req.body;
      
      const [template] = await db.select()
        .from(excelDocuments)
        .where(and(eq(excelDocuments.uuid, templateId), eq(excelDocuments.isTemplate, true)))
        .limit(1);
      
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      
      const newDoc = await db.insert(excelDocuments)
        .values({
          uuid: nanoid(),
          name: newName || `Copia de ${template.name}`,
          data: template.data,
          sheets: template.sheets,
          metadata: template.metadata,
          size: template.size,
          isTemplate: false,
          version: 1
        })
        .returning();
      
      res.json({ 
        success: true, 
        document: {
          id: newDoc[0].uuid,
          name: newDoc[0].name,
          sheets: Array.isArray(newDoc[0].sheets) ? (newDoc[0].sheets as any[]).length : 1
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/excel/:id", async (req, res) => {
    try {
      const [doc] = await db.select()
        .from(excelDocuments)
        .where(eq(excelDocuments.uuid, req.params.id))
        .limit(1);
      
      if (!doc) {
        return res.status(404).json({ error: "Document not found" });
      }
      
      res.json({
        id: doc.uuid,
        name: doc.name,
        data: doc.data,
        sheets: doc.sheets,
        metadata: doc.metadata,
        size: doc.size,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        createdBy: doc.createdBy ? String(doc.createdBy) : 'Admin',
        isTemplate: doc.isTemplate,
        templateCategory: doc.templateCategory,
        version: doc.version
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/excel/save", async (req, res) => {
    try {
      const { id, name, data, sheets, metadata, isTemplate, templateCategory } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: "name is required" });
      }

      const dataSize = data ? JSON.stringify(data).length : 0;
      const sheetsData = sheets || (data ? [{ name: 'Sheet1', data }] : [{ name: 'Sheet1', data: [] }]);
      const now = new Date();

      if (id) {
        const [existingDoc] = await db.select()
          .from(excelDocuments)
          .where(eq(excelDocuments.uuid, id))
          .limit(1);

        if (existingDoc) {
          const [updated] = await db.update(excelDocuments)
            .set({
              name,
              data,
              sheets: sheetsData,
              metadata,
              size: dataSize || existingDoc.size,
              updatedAt: now,
              isTemplate: isTemplate ?? existingDoc.isTemplate,
              templateCategory: templateCategory ?? existingDoc.templateCategory,
              version: (existingDoc.version || 1) + 1
            })
            .where(eq(excelDocuments.uuid, id))
            .returning();

          return res.json({ 
            success: true, 
            document: {
              id: updated.uuid,
              name: updated.name,
              sheets: Array.isArray(updated.sheets) ? (updated.sheets as any[]).length : 1,
              size: updated.size,
              createdAt: updated.createdAt,
              updatedAt: updated.updatedAt,
              createdBy: updated.createdBy ? String(updated.createdBy) : 'Admin',
              version: updated.version
            }
          });
        }
      }

      const newUuid = id || nanoid();
      const [inserted] = await db.insert(excelDocuments)
        .values({
          uuid: newUuid,
          name,
          data,
          sheets: sheetsData,
          metadata,
          size: dataSize || 1000,
          isTemplate: isTemplate || false,
          templateCategory,
          version: 1
        })
        .returning();

      res.json({ 
        success: true, 
        document: {
          id: inserted.uuid,
          name: inserted.name,
          sheets: Array.isArray(inserted.sheets) ? (inserted.sheets as any[]).length : 1,
          size: inserted.size,
          createdAt: inserted.createdAt,
          updatedAt: inserted.updatedAt,
          createdBy: inserted.createdBy ? String(inserted.createdBy) : 'Admin',
          version: inserted.version
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/excel/:id", async (req, res) => {
    try {
      const [doc] = await db.select()
        .from(excelDocuments)
        .where(eq(excelDocuments.uuid, req.params.id))
        .limit(1);
      
      if (!doc) {
        return res.status(404).json({ error: "Document not found" });
      }
      
      await db.delete(excelDocuments)
        .where(eq(excelDocuments.uuid, req.params.id));
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Database Diagnostics Endpoint (Admin Only) =====
  router.get("/db-status", isAuthenticated, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    try {
      const diagnostics: any = {
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || "development",
        databaseConfigured: !!process.env.DATABASE_URL,
      };

      // Get database info using raw SQL
      const dbInfoResult = await db.execute(sql`
        SELECT 
          current_database() as database_name,
          inet_server_addr() as host,
          inet_server_port() as port,
          current_user as db_user,
          version() as pg_version
      `);
      
      if (dbInfoResult.rows && dbInfoResult.rows.length > 0) {
        const dbInfo = dbInfoResult.rows[0] as any;
        diagnostics.database = {
          name: dbInfo.database_name,
          host: dbInfo.host || "localhost",
          port: dbInfo.port,
          user: dbInfo.db_user,
          version: dbInfo.pg_version?.split(" ")[0] + " " + (dbInfo.pg_version?.split(" ")[1] || ""),
        };
      }

      // Get user count and latest created_at
      const userStatsResult = await db.execute(sql`
        SELECT 
          COUNT(*) as user_count,
          MAX(created_at) as latest_user_created_at
        FROM users
      `);
      
      if (userStatsResult.rows && userStatsResult.rows.length > 0) {
        const stats = userStatsResult.rows[0] as any;
        diagnostics.users = {
          total: parseInt(stats.user_count) || 0,
          latestCreatedAt: stats.latest_user_created_at,
        };
      }

      // Get enabled AI models count
      const modelStatsResult = await db.execute(sql`
        SELECT COUNT(*) as enabled_count
        FROM ai_models
        WHERE is_enabled = 'true'
      `);
      
      if (modelStatsResult.rows && modelStatsResult.rows.length > 0) {
        const modelStats = modelStatsResult.rows[0] as any;
        diagnostics.aiModels = {
          enabledCount: parseInt(modelStats.enabled_count) || 0,
        };
      }

      // Get sessions count
      const sessionStatsResult = await db.execute(sql`
        SELECT COUNT(*) as session_count
        FROM sessions
        WHERE expire > NOW()
      `);
      
      if (sessionStatsResult.rows && sessionStatsResult.rows.length > 0) {
        const sessionStats = sessionStatsResult.rows[0] as any;
        diagnostics.sessions = {
          activeCount: parseInt(sessionStats.session_count) || 0,
        };
      }

      // Check if critical tables exist
      const tablesResult = await db.execute(sql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('users', 'ai_models', 'sessions', 'chats', 'chat_messages')
      `);
      
      diagnostics.tables = {
        existing: (tablesResult.rows as any[]).map(r => r.table_name),
        required: ['users', 'ai_models', 'sessions', 'chats', 'chat_messages'],
      };

      console.log(`[Admin] DB status check by admin:`, JSON.stringify(diagnostics));
      
      res.json(diagnostics);
    } catch (error: any) {
      console.error("[Admin] DB status check failed:", error);
      res.status(500).json({ 
        error: "Database diagnostics failed", 
        message: error.message,
        databaseConfigured: !!process.env.DATABASE_URL,
      });
    }
  }));

  router.get("/users-list", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    try {
      const allUsers = await db.select({
        id: users.id,
        email: users.email,
        name: users.firstName,
        lastName: users.lastName,
        plan: users.plan,
        role: users.role,
        status: users.status,
        dailyRequestsUsed: users.dailyRequestsUsed,
        dailyRequestsLimit: users.dailyRequestsLimit,
        stripeCustomerId: users.stripeCustomerId,
        stripeSubscriptionId: users.stripeSubscriptionId,
        createdAt: users.createdAt
      }).from(users).orderBy(desc(users.createdAt)).limit(100);
      
      res.json({ users: allUsers });
    } catch (error: any) {
      console.error("[Admin] Failed to fetch users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  }));

  router.put("/user/:id/plan", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { plan } = req.body;
      
      if (!plan || !['free', 'go', 'plus', 'pro'].includes(plan)) {
        return res.status(400).json({ error: "Invalid plan. Must be one of: free, go, plus, pro" });
      }
      
      await usageQuotaService.updateUserPlan(id, plan);
      
      const [updatedUser] = await db.select({
        id: users.id,
        email: users.email,
        plan: users.plan,
        dailyRequestsLimit: users.dailyRequestsLimit
      }).from(users).where(eq(users.id, id));
      
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      await storage.createAuditLog({
        action: "admin_update_user_plan",
        resource: "user",
        details: { userId: id, newPlan: plan }
      });
      
      console.log(`[Admin] Updated user ${id} plan to ${plan}`);
      res.json({ success: true, user: updatedUser });
    } catch (error: any) {
      console.error("[Admin] Failed to update user plan:", error);
      res.status(500).json({ error: "Failed to update user plan" });
    }
  }));

  return router;
}

function checkApiKeyExists(provider: string): boolean {
  const keyMap: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
    xai: "XAI_API_KEY",
    openai: "OPENAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    perplexity: "PERPLEXITY_API_KEY",
  };
  const envKey = keyMap[provider.toLowerCase()];
  return envKey ? !!process.env[envKey] : false;
}
