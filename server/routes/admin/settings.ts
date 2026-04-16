import { Router } from "express";
import { storage } from "../../storage";
import { auditLog, AuditActions } from "../../services/auditLogger";
import { getActorEmailFromRequest, getActorIdFromRequest, invalidateSettingsCache } from "../../services/settingsConfigService";
import { is2FAEnabled } from "../../services/twoFactorAuth";

export const settingsRouter = Router();

settingsRouter.get("/", async (req, res) => {
    try {
        await storage.seedDefaultSettings();
        const settings = await storage.getSettingsConfig();
        const grouped = settings.reduce((acc: Record<string, any[]>, s) => {
            const cat = s.category || "general";
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push({
                ...s,
                defaultValue: s.defaultValue as any
            });
            return acc;
        }, {});
        res.json({ settings, grouped });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

settingsRouter.get("/category/:category", async (req, res) => {
    try {
        await storage.seedDefaultSettings();
        const settings = await storage.getSettingsConfigByCategory(req.params.category);
        res.json(settings);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

settingsRouter.get("/key/:key", async (req, res) => {
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

settingsRouter.put("/:key", async (req, res) => {
    try {
        const existing = await storage.getSettingsConfigByKey(req.params.key);
        if (!existing) {
            return res.status(404).json({ error: "Setting not found" });
        }
        const actorId = getActorIdFromRequest(req);
        const actorEmail = getActorEmailFromRequest(req);

        // Prevent admins from accidentally locking themselves out by enforcing 2FA
        // without having 2FA set up on their own account first.
        if (req.params.key === "require_2fa_admins" && req.body?.value === true) {
            if (!actorId) {
                return res.status(400).json({ error: "Enable 2FA on your account before enforcing it for admins.", code: "2FA_SETUP_REQUIRED" });
            }
            const enabled = await is2FAEnabled(actorId);
            if (!enabled) {
                return res.status(400).json({ error: "Enable 2FA on your account before enforcing it for admins.", code: "2FA_SETUP_REQUIRED" });
            }
        }

        const previousValue = existing.value;
        const updated = await storage.upsertSettingsConfig({
            ...existing,
            value: req.body.value,
            updatedBy: actorId,
            defaultValue: existing.defaultValue as any
        });

        invalidateSettingsCache();
        
        await auditLog(req, {
            action: AuditActions.ADMIN_SETTINGS_CHANGED,
            resource: "settings_config",
            resourceId: req.params.key,
            details: { 
                key: req.params.key, 
                previousValue,
                newValue: req.body.value,
                category: existing.category,
                changedBy: actorEmail
            },
            category: "config",
            severity: "warning"
        });
        
        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

settingsRouter.post("/bulk", async (req, res) => {
    try {
        const { settings } = req.body;
        if (!Array.isArray(settings)) {
            return res.status(400).json({ error: "settings must be an array" });
        }
        const actorId = getActorIdFromRequest(req);
        const actorEmail = getActorEmailFromRequest(req);

        const enable2FAAdmins = settings.some((s: any) => s?.key === "require_2fa_admins" && s?.value === true);
        if (enable2FAAdmins) {
            if (!actorId) {
                return res.status(400).json({ error: "Enable 2FA on your account before enforcing it for admins.", code: "2FA_SETUP_REQUIRED" });
            }
            const enabled = await is2FAEnabled(actorId);
            if (!enabled) {
                return res.status(400).json({ error: "Enable 2FA on your account before enforcing it for admins.", code: "2FA_SETUP_REQUIRED" });
            }
        }

        const results = [];
        const changes: Array<{ key: string; previousValue: any; newValue: any; category?: string }> = [];

        for (const s of settings) {
            if (!s?.key) continue;

            const existing = await storage.getSettingsConfigByKey(s.key);
            if (!existing) continue;

            const previousValue = existing.value;
            const nextValue = s.value;

            // Only write changes (prevents noisy updatedAt churn).
            if (JSON.stringify(previousValue) === JSON.stringify(nextValue)) continue;

            const updated = await storage.upsertSettingsConfig({
                ...existing,
                value: nextValue,
                updatedBy: actorId,
                defaultValue: existing.defaultValue as any
            });
            results.push(updated);
            changes.push({ key: s.key, previousValue, newValue: nextValue, category: existing.category });
        }

        if (results.length > 0) {
            invalidateSettingsCache();
            await auditLog(req, {
                action: AuditActions.ADMIN_SETTINGS_CHANGED,
                resource: "settings_config",
                resourceId: "bulk",
                details: {
                    count: results.length,
                    keys: changes.map(c => c.key),
                    changes,
                    changedBy: actorEmail,
                },
                category: "config",
                severity: "warning"
            });
        }

        res.json({ updated: results.length, settings: results, skipped: (settings.length - results.length) });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

settingsRouter.post("/reset/:key", async (req, res) => {
    try {
        const existing = await storage.getSettingsConfigByKey(req.params.key);
        if (!existing) {
            return res.status(404).json({ error: "Setting not found" });
        }
        const actorId = getActorIdFromRequest(req);
        const actorEmail = getActorEmailFromRequest(req);
        const previousValue = existing.value;
        const updated = await storage.upsertSettingsConfig({
            ...existing,
            value: existing.defaultValue as any,
            updatedBy: actorId,
            defaultValue: existing.defaultValue as any
        });

        invalidateSettingsCache();

        await auditLog(req, {
            action: AuditActions.ADMIN_SETTINGS_CHANGED,
            resource: "settings_config",
            resourceId: req.params.key,
            details: {
                key: req.params.key,
                previousValue,
                newValue: existing.defaultValue,
                category: existing.category,
                changedBy: actorEmail,
                resetToDefault: true,
            },
            category: "config",
            severity: "warning"
        });
        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

settingsRouter.post("/seed", async (req, res) => {
    try {
        await storage.seedDefaultSettings();
        invalidateSettingsCache();
        const settings = await storage.getSettingsConfig();
        await auditLog(req, {
            action: "settings_seed",
            resource: "settings_config",
            details: { count: settings.length },
            category: "config",
            severity: "info"
        });
        res.json({ seeded: true, count: settings.length });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/settings/diff - Save only changed settings (diff mode)
settingsRouter.post("/diff", async (req, res) => {
    try {
        const { settings } = req.body;
        if (!settings || typeof settings !== "object") {
            return res.status(400).json({ error: "settings object is required" });
        }
        const actorId = getActorIdFromRequest(req);
        const actorEmail = getActorEmailFromRequest(req);

        const updated: any[] = [];
        const unchanged: string[] = [];
        const errors: { key: string; error: string }[] = [];

        for (const [key, newValue] of Object.entries(settings)) {
            try {
                const existing = await storage.getSettingsConfigByKey(key);
                if (!existing) {
                    errors.push({ key, error: "Setting not found" });
                    continue;
                }

                // Compare values - only update if different
                const currentValue = existing.value;
                if (JSON.stringify(currentValue) === JSON.stringify(newValue)) {
                    unchanged.push(key);
                    continue;
                }

                // Update only changed values
                const result = await storage.upsertSettingsConfig({
                    ...existing,
                    value: newValue as any,
                    updatedBy: actorId,
                    defaultValue: existing.defaultValue as any
                });
                updated.push({ key, oldValue: currentValue, newValue, setting: result });
            } catch (err: any) {
                errors.push({ key, error: err.message });
            }
        }

        if (updated.length > 0) {
            invalidateSettingsCache();
            await auditLog(req, {
                action: AuditActions.ADMIN_SETTINGS_CHANGED,
                resource: "settings_config",
                resourceId: "diff",
                details: {
                    updated: updated.map(u => u.key),
                    unchanged: unchanged.length,
                    errors: errors.length,
                    changes: updated.map(u => ({ key: u.key, oldValue: u.oldValue, newValue: u.newValue })),
                    changedBy: actorEmail,
                },
                category: "config",
                severity: "warning"
            });
        }

        res.json({
            success: true,
            updated: updated.length,
            unchanged: unchanged.length,
            errors: errors.length,
            changes: updated,
            unchangedKeys: unchanged,
            errorDetails: errors
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/settings/export - Export all settings
settingsRouter.get("/export", async (req, res) => {
    try {
        const settings = await storage.getSettingsConfig();
        const exportData = settings.reduce((acc: Record<string, any>, s) => {
            acc[s.key] = {
                value: s.value,
                category: s.category,
                description: s.description,
                updatedAt: s.updatedAt
            };
            return acc;
        }, {});

        await auditLog(req, {
            action: "settings_export",
            resource: "settings_config",
            details: { count: settings.length },
            category: "config",
            severity: "info"
        });

        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename=settings_${Date.now()}.json`);
        res.json(exportData);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/settings/import - Import settings from JSON
settingsRouter.post("/import", async (req, res) => {
    try {
        const { settings, overwrite = false } = req.body;
        if (!settings || typeof settings !== "object") {
            return res.status(400).json({ error: "settings object is required" });
        }
        const actorId = getActorIdFromRequest(req);

        const imported: string[] = [];
        const skipped: string[] = [];
        const errors: { key: string; error: string }[] = [];

        for (const [key, data] of Object.entries(settings)) {
            try {
                const existing = await storage.getSettingsConfigByKey(key);
                if (existing && !overwrite) {
                    skipped.push(key);
                    continue;
                }

                const value = typeof data === "object" && (data as any).value !== undefined 
                    ? (data as any).value 
                    : data;

                if (existing) {
                    await storage.upsertSettingsConfig({
                        ...existing,
                        value: value as any,
                        updatedBy: actorId,
                        defaultValue: existing.defaultValue as any
                    });
                    imported.push(key);
                }
            } catch (err: any) {
                errors.push({ key, error: err.message });
            }
        }

        if (imported.length > 0) {
            invalidateSettingsCache();
        }

        await auditLog(req, {
            action: "settings_import",
            resource: "settings_config",
            details: { imported: imported.length, skipped: skipped.length, errors: errors.length },
            category: "config",
            severity: errors.length > 0 ? "warning" : "info"
        });

        res.json({
            success: true,
            imported: imported.length,
            skipped: skipped.length,
            errors: errors.length,
            importedKeys: imported,
            skippedKeys: skipped,
            errorDetails: errors
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
