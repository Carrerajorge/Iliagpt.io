import { Router } from "express";
import { AuthenticatedRequest } from "../../types/express";
import { storage } from "../../storage";
import { checkApiKeyExists } from "./utils";
import { syncModelsForProvider, getAvailableProviders, getModelStats } from "../../services/aiModelSyncService";
import { auditLog, AuditActions } from "../../services/auditLogger";
import {
    getIntegratedModelProviderIds,
    getSupportedModelProviderIds,
    isModelChatCapable,
    isModelProviderIntegrated,
    isModelProviderSupported,
    normalizeModelProviderToRuntime,
} from "../../services/modelIntegration";

export const modelsRouter = Router();

modelsRouter.get("/", async (req, res) => {
    try {
        const models = await storage.getAiModels();
        res.json(models);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

modelsRouter.post("/", async (req, res) => {
    try {
        const { name, provider, modelId, costPer1k, description, status } = req.body;
        if (!name || !provider || !modelId) {
            return res.status(400).json({ error: "name, provider, and modelId are required" });
        }
        const model = await storage.createAiModel({
            name, provider, modelId, costPer1k, description, status
        });

        await auditLog(req, {
            action: AuditActions.MODEL_CREATED,
            resource: "ai_models",
            resourceId: model.id,
            details: { name, provider, modelId, status, createdBy: (req as any).user?.email },
            category: "admin",
            severity: "info"
        });

        res.json(model);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

modelsRouter.get("/filtered", async (req, res) => {
    try {
        const {
            page = "1",
            limit = "20",
            provider,
            type,
            status,
            search,
            sortBy = "name",
            sortOrder = "asc",
            scope = "all",
        } = req.query;

        const scopeProviders =
            scope === "supported" ? getSupportedModelProviderIds() :
                scope === "integrated" ? getIntegratedModelProviderIds() :
                    undefined;

        const result = await storage.getAiModelsFiltered({
            provider: provider as string,
            providers: scopeProviders,
            type: type as string,
            status: status as string,
            search: search as string,
            sortBy: sortBy as string,
            sortOrder: sortOrder as string,
            page: parseInt(page as string),
            limit: parseInt(limit as string),
        });

        res.json({
            models: result.models.map((m: any) => ({
                ...m,
                hasApiKey: checkApiKeyExists(m.provider),
                isSupported: isModelProviderSupported(m.provider),
                isIntegrated: isModelProviderIntegrated(m.provider),
                isChatCapable: isModelChatCapable(m),
            })),
            total: result.total,
            page: parseInt(page as string),
            limit: parseInt(limit as string),
            totalPages: Math.ceil(result.total / parseInt(limit as string)),
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

modelsRouter.get("/stats", async (req, res) => {
    try {
        const { scope = "all" } = req.query as any;
        const allModelsRaw = await storage.getAiModels();
        const allModels =
            scope === "supported" ? allModelsRaw.filter((m) => isModelProviderSupported(m.provider)) :
                scope === "integrated" ? allModelsRaw.filter((m) => isModelProviderIntegrated(m.provider)) :
                    allModelsRaw;
        const knownStats = getModelStats();

        const byProvider: Record<string, number> = {};
        const byType: Record<string, number> = {};
        let active = 0;
        let inactive = 0;
        let deprecated = 0;
        let enabled = 0;
        let disabled = 0;

        for (const model of allModels) {
            byProvider[model.provider] = (byProvider[model.provider] || 0) + 1;
            byType[model.modelType || "TEXT"] = (byType[model.modelType || "TEXT"] || 0) + 1;
            if (model.status === "active") active++;
            else inactive++;
            if (model.isDeprecated === "true") deprecated++;
            if (model.isEnabled === "true") enabled++;
            else disabled++;
        }

        res.json({
            total: allModels.length,
            active,
            inactive,
            deprecated,
            enabled,
            disabled,
            providers: Object.keys(byProvider).length,
            byProvider,
            byType,
            knownModels: knownStats,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

modelsRouter.patch("/:id", async (req, res) => {
    try {
        // Get model before update for audit
        const previousModel = await storage.getAiModelById(req.params.id);

        const incoming = req.body || {};
        const updates = { ...incoming } as any;
        let forcedDisable = false;

        // Data integrity: an Inactive model must not remain enabled.
        if (typeof incoming.status === "string" && incoming.status !== "active") {
            if (previousModel?.isEnabled === "true") forcedDisable = true;
            updates.isEnabled = "false";
            updates.enabledAt = null;
            updates.enabledByAdminId = null;
        }

        const model = await storage.updateAiModel(req.params.id, updates);
        if (!model) {
            return res.status(404).json({ error: "Model not found" });
        }
        await auditLog(req, {
            action: AuditActions.MODEL_UPDATED,
            resource: "ai_models",
            resourceId: req.params.id,
            details: {
                changes: incoming,
                applied: updates,
                forcedDisable,
                previousStatus: previousModel?.status,
                newStatus: incoming.status,
                updatedBy: (req as any).user?.email
            },
            category: "admin",
            severity: "info"
        });
        res.json(model);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

modelsRouter.delete("/:id", async (req, res) => {
    try {
        const existing = await storage.getAiModelById(req.params.id);
        await storage.deleteAiModel(req.params.id);
        await auditLog(req, {
            action: AuditActions.MODEL_DELETED,
            resource: "ai_models",
            resourceId: req.params.id,
            details: {
                modelName: existing?.name,
                provider: existing?.provider,
                deletedBy: (req as any).user?.email
            },
            category: "admin",
            severity: "warning"
        });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

modelsRouter.patch("/:id/toggle", async (req, res) => {
    try {
        const requestedEnabled = req.body?.isEnabled === true || req.body?.isEnabled === "true";
        const userId = (req as AuthenticatedRequest).user?.id || null;

        const existing = await storage.getAiModelById(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: "Model not found" });
        }

        if (requestedEnabled) {
            if (existing.status !== "active") {
                return res.status(409).json({ error: "Model must be Active (Status) before enabling" });
            }
            if (!isModelProviderIntegrated(existing.provider)) {
                return res.status(409).json({ error: "Provider not integrated (missing API key or unsupported)" });
            }
            if (!isModelChatCapable(existing)) {
                return res.status(409).json({ error: "Model is not chat-capable (only TEXT/MULTIMODAL gemini*/grok* are supported)" });
            }
        }

        const updateData: any = {
            isEnabled: requestedEnabled ? "true" : "false",
        };

        if (requestedEnabled) {
            updateData.enabledAt = new Date();
            updateData.enabledByAdminId = userId;
        } else {
            updateData.enabledAt = null;
            updateData.enabledByAdminId = null;
        }

        const model = await storage.updateAiModel(req.params.id, updateData);
        if (!model) return res.status(404).json({ error: "Model not found" });

        await auditLog(req, {
            action: requestedEnabled ? AuditActions.MODEL_ENABLED : AuditActions.MODEL_DISABLED,
            resource: "ai_models",
            resourceId: req.params.id,
            details: {
                isEnabled: requestedEnabled,
                modelName: model.name,
                provider: model.provider,
                modelId: model.modelId,
            },
            category: "admin",
            severity: "info",
        });

        res.json(model);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// sync routes
modelsRouter.post("/sync/:provider", async (req, res) => {
    try {
        const { provider } = req.params;
        const result = await syncModelsForProvider(provider);

        await auditLog(req, {
            action: AuditActions.MODELS_SYNC,
            resource: "ai_models",
            details: { provider, ...result },
            category: "admin",
            severity: "info",
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

modelsRouter.post("/sync", async (req, res) => {
    try {
        const { scope = "all" } = (req.query || {}) as any;

        const allProviders = getAvailableProviders();
        const providersToSync =
            scope === "supported" ? allProviders.filter((p) => isModelProviderSupported(p)) :
                scope === "integrated" ? allProviders.filter((p) => isModelProviderIntegrated(p)) :
                    allProviders;

        const results: Record<string, { added: number; updated: number; errors: string[] }> = {};
        for (const provider of providersToSync) {
            results[provider] = await syncModelsForProvider(provider);
        }

        let totalAdded = 0;
        let totalUpdated = 0;
        for (const r of Object.values(results)) {
            totalAdded += r.added;
            totalUpdated += r.updated;
        }

        await auditLog(req, {
            action: AuditActions.MODELS_SYNC_ALL,
            resource: "ai_models",
            details: { scope, providers: providersToSync, results, totalAdded, totalUpdated },
            category: "admin",
            severity: "info",
        });

        res.json({
            success: true,
            scope,
            results,
            summary: { totalAdded, totalUpdated },
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// providers route
modelsRouter.get("/providers/list", async (req, res) => { // Renamed from /providers to avoid conflict if mounted on /models
    try {
        const { scope = "all" } = req.query as any;
        const allProviders = getAvailableProviders();
        const providersToList =
            scope === "supported" ? allProviders.filter((p) => isModelProviderSupported(p)) :
                scope === "integrated" ? allProviders.filter((p) => isModelProviderIntegrated(p)) :
                    allProviders;

        const allModels = await storage.getAiModels();

        const providerNames: Record<string, string> = {
            google: "Google (Gemini)",
            xai: "xAI (Grok)",
            openai: "OpenAI",
            anthropic: "Anthropic",
            openrouter: "OpenRouter",
            perplexity: "Perplexity",
        };

        const providerStats = providersToList.map(provider => {
            const models = allModels.filter(m => m.provider.toLowerCase() === provider.toLowerCase());
            const activeCount = models.filter(m => m.status === "active").length;
            return {
                id: provider,
                name: providerNames[provider.toLowerCase()] || (provider.charAt(0).toUpperCase() + provider.slice(1)),
                modelCount: models.length,
                activeCount,
                hasApiKey: checkApiKeyExists(provider),
                isSupported: isModelProviderSupported(provider),
                isIntegrated: isModelProviderIntegrated(provider),
                runtimeProvider: normalizeModelProviderToRuntime(provider),
            };
        });

        res.json(providerStats);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/models/health - Real-time health check for all LLM providers
modelsRouter.get("/health", async (req, res) => {
    try {
        const { llmGateway } = await import("../../lib/llmGateway");
        const healthStatus = await llmGateway.healthCheck();

        const providers = {
            xai: {
                name: "xAI (Grok)",
                available: healthStatus?.xai?.available ?? false,
                latencyMs: healthStatus?.xai?.latencyMs ?? null,
                error: healthStatus?.xai?.error ?? null,
                hasApiKey: checkApiKeyExists("xai"),
                isSupported: isModelProviderSupported("xai"),
                isIntegrated: isModelProviderIntegrated("xai"),
                runtimeProvider: "xai",
            },
            google: {
                name: "Google (Gemini)",
                available: healthStatus?.gemini?.available ?? false,
                latencyMs: healthStatus?.gemini?.latencyMs ?? null,
                error: healthStatus?.gemini?.error ?? null,
                hasApiKey: checkApiKeyExists("google"),
                isSupported: isModelProviderSupported("google"),
                isIntegrated: isModelProviderIntegrated("google"),
                runtimeProvider: "gemini",
            },
            openai: {
                name: "OpenAI",
                available: healthStatus?.openai?.available ?? false,
                latencyMs: healthStatus?.openai?.latencyMs ?? null,
                error: healthStatus?.openai?.error ?? null,
                hasApiKey: checkApiKeyExists("openai"),
                isSupported: isModelProviderSupported("openai"),
                isIntegrated: isModelProviderIntegrated("openai"),
                runtimeProvider: "openai",
            },
            anthropic: {
                name: "Anthropic (Claude)",
                available: healthStatus?.anthropic?.available ?? false,
                latencyMs: healthStatus?.anthropic?.latencyMs ?? null,
                error: healthStatus?.anthropic?.error ?? null,
                hasApiKey: checkApiKeyExists("anthropic"),
                isSupported: isModelProviderSupported("anthropic"),
                isIntegrated: isModelProviderIntegrated("anthropic"),
                runtimeProvider: "anthropic",
            },
            deepseek: {
                name: "DeepSeek",
                available: healthStatus?.deepseek?.available ?? false,
                latencyMs: healthStatus?.deepseek?.latencyMs ?? null,
                error: healthStatus?.deepseek?.error ?? null,
                hasApiKey: checkApiKeyExists("deepseek"),
                isSupported: isModelProviderSupported("deepseek"),
                isIntegrated: isModelProviderIntegrated("deepseek"),
                runtimeProvider: "deepseek",
            }
        };

        const tracked = Object.values(providers).filter((p) => p.hasApiKey);
        const anyAvailable = tracked.some(p => p.available);
        const allAvailable = tracked.length > 0 && tracked.every(p => p.available);

        res.json({
            status: tracked.length === 0 ? "unconfigured" : allAvailable ? "healthy" : anyAvailable ? "degraded" : "down",
            allProvidersHealthy: allAvailable,
            providers,
            checkedAt: new Date().toISOString()
        });
    } catch (error: any) {
        res.status(500).json({
            status: "error",
            error: error.message,
            checkedAt: new Date().toISOString()
        });
    }
});

// POST /api/admin/models/:id/test - Test a specific model
modelsRouter.post("/:id/test", async (req, res) => {
    try {
        const model = await storage.getAiModelById(req.params.id);
        if (!model) {
            return res.status(404).json({ error: "Model not found" });
        }

        const runtimeProvider = normalizeModelProviderToRuntime(model.provider);
        if (!runtimeProvider) {
            return res.status(409).json({ error: "Provider not supported by runtime" });
        }
        if (!isModelProviderIntegrated(model.provider)) {
            return res.status(409).json({ error: "Provider not integrated (missing API key)" });
        }
        if (!isModelChatCapable(model)) {
            return res.status(409).json({ error: "Model is not chat-capable (only TEXT/MULTIMODAL gemini*/grok*)" });
        }

        const { llmGateway } = await import("../../lib/llmGateway");
        const testPrompt = "Say 'OK' if you can read this.";

        const startTime = Date.now();
        try {
            const response = await llmGateway.chat(
                [{ role: "user", content: testPrompt }],
                {
                    model: model.modelId,
                    provider: runtimeProvider,
                    enableFallback: false,
                    skipCache: true,
                    maxTokens: 10,
                    timeout: 10000
                }
            );
            const latency = Date.now() - startTime;

            await auditLog(req, {
                action: AuditActions.MODEL_TESTED,
                resource: "ai_models",
                resourceId: req.params.id,
                details: { success: true, latencyMs: latency, modelId: model.modelId, provider: model.provider, runtimeProvider },
                category: "admin",
                severity: "info",
            });

            res.json({
                success: true,
                model: model.name,
                provider: model.provider,
                latency,
                response: response.content?.slice(0, 100)
            });
        } catch (testError: any) {
            const latency = Date.now() - startTime;

            await auditLog(req, {
                action: AuditActions.MODEL_TESTED,
                resource: "ai_models",
                resourceId: req.params.id,
                details: { success: false, error: testError.message, latencyMs: latency, modelId: model.modelId, provider: model.provider, runtimeProvider },
                category: "admin",
                severity: "warning",
            });

            res.json({
                success: false,
                model: model.name,
                provider: model.provider,
                latency,
                error: testError.message
            });
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/models/usage - Get usage stats by model
modelsRouter.get("/usage", async (req, res) => {
    try {
        const { period = "7d" } = req.query;
        const periodMs = {
            "1d": 24 * 60 * 60 * 1000,
            "7d": 7 * 24 * 60 * 60 * 1000,
            "30d": 30 * 24 * 60 * 60 * 1000
        }[period as string] || 7 * 24 * 60 * 60 * 1000;

        const startDate = new Date(Date.now() - periodMs);
        const metrics = await storage.getProviderMetrics(undefined, startDate, new Date());

        // Aggregate by model
        const byModel: Record<string, { requests: number; tokens: number; errors: number; avgLatency: number }> = {};

        metrics.forEach(m => {
            const key = m.provider;
            if (!byModel[key]) {
                byModel[key] = { requests: 0, tokens: 0, errors: 0, avgLatency: 0 };
            }
            byModel[key].requests += m.totalRequests || 0;
            byModel[key].tokens += m.totalTokens || 0;
            byModel[key].errors += m.errorCount || 0;
            byModel[key].avgLatency = m.avgLatency || byModel[key].avgLatency;
        });

        res.json({
            period,
            startDate,
            usage: Object.entries(byModel).map(([model, stats]) => ({
                model,
                ...stats,
                errorRate: stats.requests > 0 ? ((stats.errors / stats.requests) * 100).toFixed(2) : "0"
            }))
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// NOTE: keep this AFTER fixed routes like /health, /usage to avoid capturing them as :id.
modelsRouter.get("/:id", async (req, res) => {
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
