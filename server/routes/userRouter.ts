import { Router } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { db } from "../db";
import { getSecureUserId } from "../lib/anonUserHelper";
import { verifyAnonToken } from "../lib/anonToken";
import { ensureUserRowExists } from "../lib/ensureUserRowExists";
import { notificationEventTypes, responsePreferencesSchema, userProfileSchema, featureFlagsSchema, integrationProviders, users, chatSchedules, chats, sessions } from "@shared/schema";
import { and, desc, eq, ne } from "drizzle-orm";
import { usageQuotaService } from "../services/usageQuotaService";
import { invalidateUserPrivacySettingsCache } from "../services/privacyService";
import { AuthenticatedRequest, getUserId } from "../types/express";
import { validateBody } from "../middleware/validateRequest";
import { z } from "zod";
import { requireAdmin } from "./admin/utils";
import { auditLog, AuditActions } from "../services/auditLogger";
import { ensureIntegrationCatalogSeeded, seedIntegrationCatalog } from "../services/integrationCatalog";
import { invalidateIntegrationPolicyCache } from "../services/integrationPolicyCache";
import { invalidateUserSettingsCache } from "../services/userSettingsCache";
import { computeNextRunAt, normalizeTimeZone, parseTimeOfDay, type ChatScheduleType } from "../services/chatScheduleUtils";
import { runChatScheduleNow } from "../services/chatScheduleRunner";

export function createUserRouter() {
  const router = Router();

  const updateNotificationPreferenceSchema = z.object({
    eventTypeId: z.string().min(1),
    enabled: z.boolean().optional(),
    channels: z.enum(["push", "email", "push_email", "none"]).optional(),
  });

  async function hasElevatedRole(userId: string): Promise<boolean> {
    const [row] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const role = String(row?.role || "").toLowerCase().trim();
    return ["admin", "superadmin", "team_admin"].includes(role);
  }

  function requireCatalogSeedingEnabled(_req: any, res: any, next: any) {
    const flag = String(process.env.ALLOW_CATALOG_SEEDING || "").trim().toLowerCase();
    if (flag === "true" || flag === "1") return next();
    // Hide seed endpoints unless explicitly enabled.
    return res.status(404).json({ error: "Not found" });
  }

  router.get("/api/user/usage", async (req, res) => {
    try {
      let userId = getUserId(req);

      if (!userId) {
        const token = req.headers['x-anonymous-token'] as string;
        if (token) {
          const parts = token.split(':');
          if (parts.length >= 1 && parts[0].startsWith('anon_') && verifyAnonToken(parts[0], token)) {
            userId = parts[0];
          }
        }
      }

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const usageStatus = await usageQuotaService.getUsageStatus(userId);
      res.json(usageStatus);
    } catch (error: any) {
      console.error("Error getting usage status:", error);
      res.status(500).json({ error: "Failed to get usage status" });
    }
  });

  router.get("/api/network-access/status", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const { getNetworkAccessPolicyForUser } = await import("../services/networkAccessPolicyService");
      const policy = await getNetworkAccessPolicyForUser(userId);
      res.json(policy);
    } catch (error: any) {
      console.error("Error getting network-access status:", error);
      res.status(500).json({ error: "Failed to get network-access status" });
    }
  });

  router.put("/api/network-access/user", validateBody(z.object({ enabled: z.boolean() })), async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const { setUserNetworkAccessEnabled } = await import("../services/networkAccessPolicyService");
      const policy = await setUserNetworkAccessEnabled(userId, req.body.enabled);
      res.json(policy);
    } catch (error: any) {
      console.error("Error setting user network-access:", error);
      res.status(500).json({ error: "Failed to update network-access" });
    }
  });

  router.put(
    "/api/network-access/org",
    validateBody(z.object({ enabled: z.boolean() })),
    async (req, res) => {
      try {
        const userId = getUserId(req);
        if (!userId) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        const [dbUser] = await db.select().from(users).where(eq(users.id, userId));
        const role = (dbUser as any)?.role || "guest";
        if (!['admin', 'superadmin', 'team_admin'].includes(role)) {
          return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
        }

        const orgId = (dbUser as any)?.orgId || "default";
        const { setOrgNetworkAccessEnabled } = await import("../services/networkAccessPolicyService");
        const row = await setOrgNetworkAccessEnabled(orgId, req.body.enabled);
        res.json({ success: true, orgId, ...row });
      } catch (error: any) {
        console.error("Error setting org network-access:", error);
        res.status(500).json({ error: "Failed to update org network-access" });
      }
    }
  );

  router.get("/api/notification-event-types", async (req, res) => {
    try {
      const eventTypes = await storage.getNotificationEventTypes();
      res.json(eventTypes);
    } catch (error: any) {
      console.error("Error getting notification event types:", error);
      res.status(500).json({ error: "Failed to get notification event types" });
    }
  });

  router.get("/api/users/:id/notification-preferences", async (req, res) => {
    try {
      const { id } = req.params;
      const authUserId = getUserId(req);

      if (authUserId) {
        if (authUserId !== id) {
          const elevated = await hasElevatedRole(authUserId);
          if (!elevated) {
            await auditLog(req, {
              action: AuditActions.SECURITY_ALERT,
              resource: "notification_preferences",
              resourceId: id,
              details: { reason: "forbidden", actorUserId: authUserId, targetUserId: id, path: req.originalUrl || req.path },
              category: "security",
              severity: "warning",
            });
            return res.status(403).json({ error: "Forbidden" });
          }
        }
      } else {
        // Allow anonymous users to access their own preferences if token validates.
        const token = req.headers["x-anonymous-token"] as string;
        if (!id.startsWith("anon_") || !verifyAnonToken(id, token)) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      const eventTypes = await storage.getNotificationEventTypes();
      const preferences = await storage.getNotificationPreferences(id);

      const prefsWithEventTypes = eventTypes.map(eventType => {
        const pref = preferences.find(p => p.eventTypeId === eventType.id);
        return {
          eventType,
          preference: pref || null,
          enabled: pref ? pref.enabled : eventType.defaultChannels !== 'none',
          channels: pref ? pref.channels : eventType.defaultChannels
        };
      });

      res.json(prefsWithEventTypes);
    } catch (error: any) {
      console.error("Error getting notification preferences:", error);
      res.status(500).json({ error: "Failed to get notification preferences" });
    }
  });

  router.put("/api/users/:id/notification-preferences", validateBody(updateNotificationPreferenceSchema), async (req, res) => {
    try {
      const { id } = req.params;
      const { eventTypeId, enabled, channels } = req.body;

      const authUserId = getUserId(req);

      if (authUserId) {
        if (authUserId !== id) {
          const elevated = await hasElevatedRole(authUserId);
          if (!elevated) {
            await auditLog(req, {
              action: AuditActions.SECURITY_ALERT,
              resource: "notification_preferences",
              resourceId: id,
              details: { reason: "forbidden", actorUserId: authUserId, targetUserId: id, path: req.originalUrl || req.path },
              category: "security",
              severity: "warning",
            });
            return res.status(403).json({ error: "Forbidden" });
          }
        }
      } else {
        const token = req.headers["x-anonymous-token"] as string;
        if (!id.startsWith("anon_") || !verifyAnonToken(id, token)) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      const eventTypes = await storage.getNotificationEventTypes();
      if (!eventTypes.some((t) => t.id === eventTypeId)) {
        return res.status(400).json({ error: "Unknown eventTypeId" });
      }

      const preference = await storage.upsertNotificationPreference({
        userId: id,
        eventTypeId,
        enabled: enabled !== undefined ? (enabled ? "true" : "false") : "true",
        channels: channels || "push"
      });

      res.json(preference);
    } catch (error: any) {
      console.error("Error updating notification preference:", error);
      res.status(500).json({ error: "Failed to update notification preference" });
    }
  });

  router.post("/api/notification-event-types/seed", requireCatalogSeedingEnabled, requireAdmin, async (req, res) => {
    try {
      const eventTypesToSeed = [
        { id: 'ai_response_ready', name: 'Respuestas de IA', description: 'Notificaciones cuando una respuesta larga está lista', category: 'ai_updates', severity: 'normal', defaultChannels: 'push', sortOrder: 1 },
        { id: 'task_status_update', name: 'Actualizaciones de tareas', description: 'Cambios en tareas programadas', category: 'tasks', severity: 'normal', defaultChannels: 'push_email', sortOrder: 2 },
        { id: 'project_invitation', name: 'Invitaciones a proyectos', description: 'Invitaciones a chats compartidos', category: 'social', severity: 'high', defaultChannels: 'push_email', sortOrder: 3 },
        { id: 'product_recommendation', name: 'Recomendaciones', description: 'Sugerencias personalizadas', category: 'product', severity: 'low', defaultChannels: 'email', sortOrder: 4 },
        { id: 'feature_announcement', name: 'Novedades', description: 'Nuevas funciones disponibles', category: 'product', severity: 'low', defaultChannels: 'email', sortOrder: 5 }
      ];

      const existing = await storage.getNotificationEventTypes();
      const existingIds = new Set(existing.map(e => e.id));

      const toInsert = eventTypesToSeed.filter(e => !existingIds.has(e.id));

      if (toInsert.length > 0) {
        await db.insert(notificationEventTypes).values(toInsert);
      }

      await auditLog(req, {
        action: "system.notification_event_types_seeded",
        resource: "notification_event_types",
        details: { inserted: toInsert.length, totalAfter: existing.length + toInsert.length },
        category: "config",
        severity: "warning",
      });

      const allEventTypes = await storage.getNotificationEventTypes();
      res.json({
        message: `Seeded ${toInsert.length} new event types`,
        eventTypes: allEventTypes
      });
    } catch (error: any) {
      console.error("Error seeding notification event types:", error);
      res.status(500).json({ error: "Failed to seed notification event types" });
    }
  });

  router.get("/api/users/:id/settings", async (req, res) => {
    try {
      const { id } = req.params;

      // For authenticated users, verify ownership
      const authUserId = getUserId(req);

      if (authUserId) {
        // Authenticated user - must match
        if (authUserId !== id) {
          return res.status(403).json({ error: "Access denied: You can only access your own settings" });
        }
      } else {
        // Anonymous user - verify token for cryptographic authentication
        const token = req.headers['x-anonymous-token'] as string;
        if (!id.startsWith('anon_') || !verifyAnonToken(id, token)) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      const settings = await storage.getUserSettings(id);

      if (!settings) {
        res.json({
          userId: id,
          responsePreferences: {
            responseStyle: 'default',
            responseTone: 'professional',
            customInstructions: ''
          },
          userProfile: {
            nickname: '',
            occupation: '',
            bio: '',
            showName: true,
            linkedInUrl: '',
            githubUrl: '',
            websiteDomain: '',
            receiveEmailComments: false,
          },
          featureFlags: {
            memoryEnabled: false,
            recordingHistoryEnabled: false,
            webSearchAuto: true,
            codeInterpreterEnabled: true,
            canvasEnabled: true,
            voiceEnabled: true,
            voiceAdvanced: false,
            connectorSearchAuto: false
          }
        });
        return;
      }

      res.json(settings);
    } catch (error: any) {
      console.error("Error getting user settings:", error);
      res.status(500).json({ error: "Failed to get user settings" });
    }
  });

  const updateUserSettingsSchema = z.object({
    // Use patch semantics: only provided keys should be updated.
    // Important: avoid Zod defaults overwriting existing settings when a client omits a field.
    responsePreferences: responsePreferencesSchema.partial().optional(),
    userProfile: userProfileSchema.partial().optional(),
    featureFlags: featureFlagsSchema.partial().optional(),
  });

  router.put("/api/users/:id/settings", validateBody(updateUserSettingsSchema), async (req, res) => {
    try {
      const { id } = req.params;

      // For authenticated users, verify ownership
      const authUserId = getUserId(req);

      if (authUserId) {
        // Authenticated user - must match
        if (authUserId !== id) {
          return res.status(403).json({ error: "Access denied: You can only update your own settings" });
        }
      } else {
        // Anonymous user - verify token for cryptographic authentication
        const token = req.headers['x-anonymous-token'] as string;
        if (!id.startsWith('anon_') || !verifyAnonToken(id, token)) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      // Anonymous users can still have settings; ensure FK target exists.
      if (id.startsWith("anon_")) {
        await ensureUserRowExists(id);
      }

      // Validated data is now in req.body (or req.validatedBody)
      const { responsePreferences, userProfile, featureFlags } = req.body;

      const updates: any = {};

      if (responsePreferences) updates.responsePreferences = responsePreferences;
      if (userProfile) updates.userProfile = userProfile;
      if (featureFlags) {
        // Server-side normalization: keep feature flags consistent even if a client
        // sends partial updates.
        const normalized = { ...featureFlags } as any;
        if (normalized.voiceEnabled === false) {
          normalized.voiceAdvanced = false;
        } else if (normalized.voiceAdvanced === true) {
          normalized.voiceEnabled = true;
        }
        updates.featureFlags = normalized;
      }

      const settings = await storage.upsertUserSettings(id, updates);
      invalidateUserSettingsCache(id);
      res.json(settings);
    } catch (error: any) {
      console.error("Error updating user settings:", error);
      res.status(500).json({ error: "Failed to update user settings" });
    }
  });

  // ============================================================================
  // Self Profile (basic account info)
  // ============================================================================

  const updateSelfProfileSchema = z
    .object({
      fullName: z.string().trim().min(1).max(200).optional(),
      company: z.string().trim().max(200).nullable().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field must be provided for update",
    });

  router.patch("/api/users/:id/profile", validateBody(updateSelfProfileSchema), async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId || authUserId.startsWith("anon_")) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const updates: any = { updatedAt: new Date() };

      if (typeof req.body.fullName === "string") {
        updates.fullName = req.body.fullName.trim();
      }

      if (req.body.company === null) {
        updates.company = null;
      } else if (typeof req.body.company === "string") {
        const trimmed = req.body.company.trim();
        updates.company = trimmed.length ? trimmed : null;
      }

      const updated = await storage.updateUser(id, updates);
      if (!updated) return res.status(404).json({ error: "User not found" });

      await auditLog(req, {
        action: AuditActions.USER_UPDATED,
        resource: "users",
        resourceId: id,
        details: { updates: { fullName: updates.fullName, company: updates.company } },
        category: "user",
        severity: "info",
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating self profile:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  // ============================================================================
  // Programaciones (Chat Schedules)
  // ============================================================================

  const nonEmptyTrimmedString = z.string().trim().min(1);

  const createScheduleSchema = z.object({
    chatId: nonEmptyTrimmedString,
    name: z.string().trim().min(1).optional(),
    prompt: nonEmptyTrimmedString,
    scheduleType: z.enum(["once", "daily", "weekly"]),
    timeZone: z.string().trim().optional(),
    isActive: z.boolean().optional(),
    // once
    runAt: z.string().datetime().optional(),
    // daily/weekly (HH:MM)
    timeOfDay: z.string().trim().optional(),
    // weekly (0-6, Sunday=0)
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  });

  const updateScheduleSchema = z.object({
    name: z.string().trim().min(1).optional(),
    prompt: z.string().trim().min(1).optional(),
    scheduleType: z.enum(["once", "daily", "weekly"]).optional(),
    timeZone: z.string().trim().optional(),
    isActive: z.boolean().optional(),
    runAt: z.string().datetime().optional(),
    timeOfDay: z.string().trim().optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  });

  router.get("/api/users/:id/schedules", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const rows = await db
        .select({
          schedule: chatSchedules,
          chatTitle: chats.title,
        })
        .from(chatSchedules)
        .leftJoin(chats, eq(chatSchedules.chatId, chats.id))
        .where(eq(chatSchedules.userId, id))
        .orderBy(desc(chatSchedules.updatedAt));

      res.json(
        rows.map((r) => ({
          ...r.schedule,
          chatTitle: r.chatTitle || null,
        })),
      );
    } catch (error: any) {
      console.error("Error listing schedules:", error);
      res.status(500).json({ error: "Failed to list schedules" });
    }
  });

  router.post("/api/users/:id/schedules", validateBody(createScheduleSchema), async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const { chatId, name, prompt, scheduleType, timeZone, isActive, runAt, timeOfDay, daysOfWeek } = req.body;

      const chat = await storage.getChat(chatId);
      if (!chat) return res.status(404).json({ error: "Chat not found" });
      if (!chat.userId || chat.userId !== id) return res.status(403).json({ error: "Access denied" });

      const tz = normalizeTimeZone(timeZone || "UTC");
      const active = isActive ?? true;

      let runAtDate: Date | null = null;
      let normalizedTimeOfDay: string | null = null;
      let normalizedDaysOfWeek: number[] | null = null;

      if (scheduleType === "once") {
        if (!runAt) return res.status(400).json({ error: "runAt is required for scheduleType=once" });
        runAtDate = new Date(runAt);
        if (!Number.isFinite(runAtDate.getTime())) return res.status(400).json({ error: "Invalid runAt" });
        if (runAtDate.getTime() <= Date.now()) return res.status(400).json({ error: "runAt must be in the future" });
      } else if (scheduleType === "daily") {
        const parsed = parseTimeOfDay(timeOfDay);
        if (!parsed) return res.status(400).json({ error: "timeOfDay must be HH:MM for scheduleType=daily" });
        normalizedTimeOfDay = parsed.normalized;
      } else if (scheduleType === "weekly") {
        const parsed = parseTimeOfDay(timeOfDay);
        if (!parsed) return res.status(400).json({ error: "timeOfDay must be HH:MM for scheduleType=weekly" });
        if (!daysOfWeek || daysOfWeek.length === 0) {
          return res.status(400).json({ error: "daysOfWeek is required for scheduleType=weekly" });
        }
        normalizedTimeOfDay = parsed.normalized;
        normalizedDaysOfWeek = Array.from(new Set(daysOfWeek as number[])).sort((a: number, b: number) => a - b);
      }

      const nextRunAt = active
        ? computeNextRunAt(
            {
              scheduleType: scheduleType as ChatScheduleType,
              timeZone: tz,
              runAt: runAtDate,
              timeOfDay: normalizedTimeOfDay,
              daysOfWeek: normalizedDaysOfWeek,
            },
            new Date(),
          )
        : null;

      if (active && !nextRunAt) {
        return res.status(400).json({ error: "Could not compute nextRunAt for this schedule" });
      }

      const [created] = await db
        .insert(chatSchedules)
        .values({
          userId: id,
          chatId,
          name: name || "Programación",
          prompt,
          scheduleType,
          timeZone: tz,
          runAt: runAtDate,
          timeOfDay: normalizedTimeOfDay,
          daysOfWeek: normalizedDaysOfWeek,
          isActive: active,
          nextRunAt,
        })
        .returning();

      res.json(created);
    } catch (error: any) {
      console.error("Error creating schedule:", error);
      res.status(500).json({ error: "Failed to create schedule" });
    }
  });

  router.put("/api/users/:id/schedules/:scheduleId", validateBody(updateScheduleSchema), async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id, scheduleId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const [existing] = await db
        .select()
        .from(chatSchedules)
        .where(and(eq(chatSchedules.id, scheduleId), eq(chatSchedules.userId, id)))
        .limit(1);

      if (!existing) return res.status(404).json({ error: "Schedule not found" });

      const updates: any = {};
      if (typeof req.body.name === "string") updates.name = req.body.name;
      if (typeof req.body.prompt === "string") updates.prompt = req.body.prompt;
      if (typeof req.body.scheduleType === "string") updates.scheduleType = req.body.scheduleType;
      if (typeof req.body.timeZone === "string") updates.timeZone = normalizeTimeZone(req.body.timeZone);
      if (typeof req.body.isActive === "boolean") updates.isActive = req.body.isActive;

      const scheduleType = (updates.scheduleType || existing.scheduleType) as ChatScheduleType;
      const tz = (updates.timeZone || existing.timeZone) as string;

      let runAtDate: Date | null = existing.runAt;
      let timeOfDayNorm: string | null = existing.timeOfDay;
      let daysNorm: number[] | null = (existing.daysOfWeek as any) || null;

      if (scheduleType === "once") {
        if (req.body.runAt) {
          runAtDate = new Date(req.body.runAt);
          if (!Number.isFinite(runAtDate.getTime())) return res.status(400).json({ error: "Invalid runAt" });
        }
        timeOfDayNorm = null;
        daysNorm = null;
      }

      if (scheduleType === "daily") {
        if (req.body.timeOfDay) {
          const parsed = parseTimeOfDay(req.body.timeOfDay);
          if (!parsed) return res.status(400).json({ error: "timeOfDay must be HH:MM for scheduleType=daily" });
          timeOfDayNorm = parsed.normalized;
        }
        runAtDate = null;
        daysNorm = null;
      }

      if (scheduleType === "weekly") {
        if (req.body.timeOfDay) {
          const parsed = parseTimeOfDay(req.body.timeOfDay);
          if (!parsed) return res.status(400).json({ error: "timeOfDay must be HH:MM for scheduleType=weekly" });
          timeOfDayNorm = parsed.normalized;
        }
        if (req.body.daysOfWeek) {
          if (req.body.daysOfWeek.length === 0) return res.status(400).json({ error: "daysOfWeek cannot be empty" });
          daysNorm = Array.from(new Set(req.body.daysOfWeek as number[])).sort((a: number, b: number) => a - b);
        }
        runAtDate = null;
      }

      updates.runAt = runAtDate;
      updates.timeOfDay = timeOfDayNorm;
      updates.daysOfWeek = daysNorm;

      const active = (typeof updates.isActive === "boolean" ? updates.isActive : existing.isActive) as boolean;
      updates.nextRunAt = active
        ? computeNextRunAt(
            {
              scheduleType,
              timeZone: tz,
              runAt: runAtDate,
              timeOfDay: timeOfDayNorm,
              daysOfWeek: daysNorm,
            },
            new Date(),
          )
        : null;

      if (active && !updates.nextRunAt) {
        return res.status(400).json({ error: "Could not compute nextRunAt for this schedule" });
      }

      // When a user re-enables a schedule, clear previous error state.
      if (updates.isActive === true) {
        updates.failureCount = 0;
        updates.lastError = null;
        updates.lockedAt = null;
        updates.lockedBy = null;
      }

      updates.updatedAt = new Date();

      const [updated] = await db
        .update(chatSchedules)
        .set(updates)
        .where(and(eq(chatSchedules.id, scheduleId), eq(chatSchedules.userId, id)))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating schedule:", error);
      res.status(500).json({ error: "Failed to update schedule" });
    }
  });

  router.delete("/api/users/:id/schedules/:scheduleId", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id, scheduleId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      await db.delete(chatSchedules).where(and(eq(chatSchedules.id, scheduleId), eq(chatSchedules.userId, id)));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting schedule:", error);
      res.status(500).json({ error: "Failed to delete schedule" });
    }
  });

  router.post("/api/users/:id/schedules/:scheduleId/run", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id, scheduleId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const result = await runChatScheduleNow(id, scheduleId);
      res.json(result);
    } catch (error: any) {
      const status = error?.statusCode || 500;
      res.status(status).json({ error: error?.message || "Failed to run schedule" });
    }
  });

  // ============================================================================
  // Sesiones activas (Dispositivos de confianza)
  // ============================================================================

  router.get("/api/users/:id/sessions", async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const currentSid = (req as any).sessionID as string | undefined;

      const rows = await db
        .select({
          sid: sessions.sid,
          expire: sessions.expire,
          createdAt: sessions.createdAt,
          updatedAt: sessions.updatedAt,
          lastSeenAt: sessions.lastSeenAt,
          sess: sessions.sess,
        })
        .from(sessions)
        .where(eq(sessions.userId, id))
        .orderBy(desc(sessions.updatedAt));

      res.json({
        currentSid: currentSid || null,
        sessions: rows.map((r) => {
          const device = (r.sess as any)?.device || null;
          const userAgent = typeof device?.userAgent === "string" ? device.userAgent : "";
          const ipPrefix = typeof device?.ipPrefix === "string" ? device.ipPrefix : "";
          return {
            sid: r.sid,
            isCurrent: !!currentSid && r.sid === currentSid,
            expire: r.expire,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            lastSeenAt: r.lastSeenAt,
            device: device ? { userAgent, ipPrefix } : null,
          };
        }),
      });
    } catch (error: any) {
      console.error("Error listing sessions:", error);
      res.status(500).json({ error: "Failed to list sessions" });
    }
  });

  router.post("/api/users/:id/sessions/revoke-others", async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const currentSid = (req as any).sessionID as string | undefined;
      if (!currentSid) return res.status(400).json({ error: "No current session" });

      const deleted = await db
        .delete(sessions)
        .where(and(eq(sessions.userId, id), ne(sessions.sid, currentSid)))
        .returning({ sid: sessions.sid });

      await auditLog(req, {
        action: "auth.sessions_revoked_others",
        resource: "sessions",
        details: { userId: id, count: deleted.length },
        category: "security",
        severity: "warning",
      });

      res.json({ success: true, count: deleted.length });
    } catch (error: any) {
      console.error("Error revoking other sessions:", error);
      res.status(500).json({ error: "Failed to revoke other sessions" });
    }
  });

  router.post("/api/users/:id/sessions/logout-all", async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const deleted = await db
        .delete(sessions)
        .where(eq(sessions.userId, id))
        .returning({ sid: sessions.sid });

      // Best-effort: destroy current session + clear cookie too.
      (req as any)?.session?.destroy?.(() => {});
      res.clearCookie("siragpt.sid");

      await auditLog(req, {
        action: "auth.logout_all",
        resource: "sessions",
        details: { userId: id, count: deleted.length },
        category: "security",
        severity: "critical",
      });

      res.json({ success: true, count: deleted.length });
    } catch (error: any) {
      console.error("Error logging out all sessions:", error);
      res.status(500).json({ error: "Failed to logout all sessions" });
    }
  });

  router.delete("/api/users/:id/sessions/:sid", async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id, sid } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const deleted = await db
        .delete(sessions)
        .where(and(eq(sessions.userId, id), eq(sessions.sid, sid)))
        .returning({ sid: sessions.sid });

      await auditLog(req, {
        action: "auth.session_revoked",
        resource: "sessions",
        resourceId: sid,
        details: { userId: id, deleted: deleted.length > 0 },
        category: "security",
        severity: "warning",
      });

      res.json({ success: true, deleted: deleted.length > 0 });
    } catch (error: any) {
      console.error("Error revoking session:", error);
      res.status(500).json({ error: "Failed to revoke session" });
    }
  });

  router.get("/api/integrations/providers", async (req, res) => {
    try {
      await ensureIntegrationCatalogSeeded().catch((err) => {
        console.warn("[Integrations] Failed to auto-seed catalog:", err?.message || err);
      });
      const providers = await storage.getIntegrationProviders();
      // Never expose authConfig (can contain secrets) to clients.
      res.json(providers.map(({ authConfig, ...safe }) => safe));
    } catch (error: any) {
      console.error("Error getting providers:", error);
      res.status(500).json({ error: "Failed to get providers" });
    }
  });

  router.get("/api/integrations/tools", async (req, res) => {
    try {
      await ensureIntegrationCatalogSeeded().catch((err) => {
        console.warn("[Integrations] Failed to auto-seed catalog:", err?.message || err);
      });
      const { providerId } = req.query;
      const tools = await storage.getIntegrationTools(providerId as string | undefined);
      res.json(tools);
    } catch (error: any) {
      console.error("Error getting tools:", error);
      res.status(500).json({ error: "Failed to get tools" });
    }
  });

  router.post("/api/integrations/seed", requireCatalogSeedingEnabled, requireAdmin, async (req, res) => {
    try {
      const { insertedProviders, insertedTools, providersTotal, toolsTotal } = await seedIntegrationCatalog();
      await auditLog(req, {
        action: "system.integration_catalog_seeded",
        resource: "integration_catalog",
        details: { insertedProviders, insertedTools, providersTotal, toolsTotal },
        category: "config",
        severity: "warning",
      });
      res.json({ message: "Catalog seeded", insertedProviders, insertedTools, providers: providersTotal, tools: toolsTotal });
    } catch (error: any) {
      console.error("Error seeding catalog:", error);
      res.status(500).json({ error: "Failed to seed catalog" });
    }
  });

  router.get("/api/users/:id/integrations", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const sanitizeAccount = (account: any) => {
        // Never return tokens/metadata to the client (UI only needs display identity).
        return {
          id: account?.id,
          userId: account?.userId,
          providerId: account?.providerId,
          displayName: account?.displayName ?? null,
          email: account?.email ?? null,
          status: account?.status ?? null,
        };
      };

      await ensureIntegrationCatalogSeeded().catch((err) => {
        console.warn("[Integrations] Failed to auto-seed catalog:", err?.message || err);
      });

      const [accounts, policy, providers] = await Promise.all([
        storage.getIntegrationAccounts(id),
        storage.getIntegrationPolicy(id),
        // Use write DB schema for immediate consistency after seeding (read replicas can lag).
        db.select().from(integrationProviders).orderBy(integrationProviders.name)
      ]);

      res.json({
        accounts: accounts.map(sanitizeAccount),
        policy,
        providers: providers.map(({ authConfig, ...safe }) => safe),
      });
    } catch (error: any) {
      console.error("Error getting user integrations:", error);
      res.status(500).json({ error: "Failed to get integrations" });
    }
  });

  const updateIntegrationPolicySchema = z.object({
    enabledApps: z.array(z.string()).optional(),
    enabledTools: z.array(z.string()).optional(),
    disabledTools: z.array(z.string()).optional(),
    resourceScopes: z.any().optional(),
    autoConfirmPolicy: z.enum(["always", "ask", "never"]).optional(),
    sandboxMode: z.preprocess((v) => {
      if (v === true) return "true";
      if (v === false) return "false";
      return v;
    }, z.enum(["true", "false"]).optional()),
    maxParallelCalls: z.preprocess((v) => {
      if (typeof v === "string" && v.trim() !== "") return Number.parseInt(v, 10);
      return v;
    }, z.number().int().min(1).max(10).optional()),
  }).strict();

  router.put("/api/users/:id/integrations/policy", validateBody(updateIntegrationPolicySchema), async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const { enabledApps, enabledTools, disabledTools, resourceScopes, autoConfirmPolicy, sandboxMode, maxParallelCalls } = req.body;

      const before = await storage.getIntegrationPolicy(id);
      const policy = await storage.upsertIntegrationPolicy(id, {
        enabledApps,
        enabledTools,
        disabledTools,
        resourceScopes,
        autoConfirmPolicy,
        sandboxMode,
        maxParallelCalls
      });

      invalidateIntegrationPolicyCache(id);
      void auditLog(req, {
        action: "user.integration_policy_updated",
        resource: "integration_policy",
        details: {
          changedFields: Object.keys(req.body || {}),
          // Log summaries only (avoid large payloads).
          enabledAppsCount: Array.isArray(policy.enabledApps) ? policy.enabledApps.length : 0,
          enabledToolsCount: Array.isArray(policy.enabledTools) ? policy.enabledTools.length : 0,
          disabledToolsCount: Array.isArray(policy.disabledTools) ? policy.disabledTools.length : 0,
          autoConfirmPolicy: policy.autoConfirmPolicy,
          sandboxMode: policy.sandboxMode,
          maxParallelCalls: policy.maxParallelCalls,
          before: before
            ? {
                enabledAppsCount: Array.isArray(before.enabledApps) ? before.enabledApps.length : 0,
                enabledToolsCount: Array.isArray(before.enabledTools) ? before.enabledTools.length : 0,
                disabledToolsCount: Array.isArray(before.disabledTools) ? before.disabledTools.length : 0,
                autoConfirmPolicy: before.autoConfirmPolicy,
                sandboxMode: before.sandboxMode,
                maxParallelCalls: before.maxParallelCalls,
              }
            : null,
        },
        category: "config",
        severity: "info",
      });
      res.json(policy);
    } catch (error: any) {
      console.error("Error updating policy:", error);
      res.status(500).json({ error: "Failed to update policy" });
    }
  });

  router.post("/api/users/:id/integrations/:provider/connect", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id, provider } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      await ensureIntegrationCatalogSeeded().catch((err) => {
        console.warn("[Integrations] Failed to auto-seed catalog:", err?.message || err);
      });

      const providerInfo = await storage.getIntegrationProvider(provider);
      if (!providerInfo) return res.status(404).json({ error: "Provider not found" });
      if (String(providerInfo.isActive || "").toLowerCase().trim() !== "true") {
        return res.status(409).json({ error: "Provider is inactive" });
      }

      // Minimal, robust behavior: mark provider as connected even if OAuth isn't implemented yet.
      // This unblocks the UI wiring (connect/disconnect + enable/disable policy).
      const existing = await storage.getIntegrationAccountByProvider(id, provider);
      const alreadyConnected = !!existing && existing.status === "active";
      const account = existing
        ? (existing.status === "active"
          ? existing
          : await storage.updateIntegrationAccount(existing.id, { status: "active" as any }))
        : await storage.createIntegrationAccount({
          userId: id,
          providerId: provider,
          status: "active",
          isDefault: "true",
          metadata: {
            connectedVia: "manual_stub",
            note: "OAuth flow not yet implemented",
            connectedAt: new Date().toISOString(),
          },
        } as any);

      // Auto-enable the provider on connect (can still be toggled off in policy).
      const policy = await storage.getIntegrationPolicy(id);
      const enabledApps = Array.from(new Set([...(policy?.enabledApps || []), provider]));
      await storage.upsertIntegrationPolicy(id, { enabledApps });
      invalidateIntegrationPolicyCache(id);

      void auditLog(req, {
        action: "user.integration_connected",
        resource: "integration_account",
        details: { providerId: provider, authType: providerInfo.authType, alreadyConnected },
        category: "config",
        severity: "info",
      });
      res.json({
        success: true,
        message: alreadyConnected ? "Already connected" : "Connected",
        provider: providerInfo.name,
        authType: providerInfo.authType,
        account: {
          id: account?.id,
          userId: account?.userId,
          providerId: account?.providerId,
          displayName: account?.displayName ?? null,
          email: account?.email ?? null,
          status: account?.status ?? null,
        },
      });
    } catch (error: any) {
      console.error("Error initiating connect:", error);
      res.status(500).json({ error: "Failed to initiate connection" });
    }
  });

  router.post("/api/users/:id/integrations/:provider/disconnect", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id, provider } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const account = await storage.getIntegrationAccountByProvider(id, provider);
      if (account) {
        await storage.deleteIntegrationAccount(account.id);
      }

      // Best-effort: disable provider on disconnect.
      const policy = await storage.getIntegrationPolicy(id);
      if (policy?.enabledApps?.includes(provider)) {
        await storage.upsertIntegrationPolicy(id, {
          enabledApps: (policy.enabledApps || []).filter((p) => p !== provider),
        });
      }
      invalidateIntegrationPolicyCache(id);

      void auditLog(req, {
        action: "user.integration_disconnected",
        resource: "integration_account",
        details: { providerId: provider, hadAccount: !!account },
        category: "config",
        severity: "info",
      });

      res.json({ success: true, alreadyDisconnected: !account });
    } catch (error: any) {
      console.error("Error disconnecting:", error);
      res.status(500).json({ error: "Failed to disconnect" });
    }
  });

  router.get("/api/users/:id/integrations/logs", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await storage.getToolCallLogs(id, limit);
      // Keep this endpoint minimal: the UI only needs summary fields.
      res.json(
        logs.map((log) => ({
          id: log.id,
          toolId: log.toolId,
          providerId: log.providerId,
          status: log.status,
          latencyMs: log.latencyMs,
          errorCode: log.errorCode,
          errorMessage: log.errorMessage,
          createdAt: log.createdAt,
        }))
      );
    } catch (error: any) {
      console.error("Error getting logs:", error);
      res.status(500).json({ error: "Failed to get logs" });
    }
  });

  router.get("/api/users/:id/privacy", async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId || authUserId.startsWith("anon_")) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const settings = await storage.getUserSettings(id);
      const logs = await storage.getConsentLogs(id, 10);

      // Merge defaults so newly added fields are always present even for older rows.
      const defaultPrivacySettings = {
        trainingOptIn: false,
        remoteBrowserDataAccess: false,
        analyticsTracking: true,
        chatHistoryEnabled: true,
      };
      const mergedPrivacySettings = {
        ...defaultPrivacySettings,
        ...(settings?.privacySettings || {}),
      };
      res.json({
        privacySettings: mergedPrivacySettings,
        consentHistory: logs
      });
    } catch (error: any) {
      console.error("Error getting privacy settings:", error);
      res.status(500).json({ error: "Failed to get privacy settings" });
    }
  });

  const updatePrivacySettingsSchema = z.object({
    trainingOptIn: z.boolean().optional(),
    remoteBrowserDataAccess: z.boolean().optional(),
    analyticsTracking: z.boolean().optional(),
    chatHistoryEnabled: z.boolean().optional(),
  });

  router.put("/api/users/:id/privacy", validateBody(updatePrivacySettingsSchema), async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId || authUserId.startsWith("anon_")) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const { trainingOptIn, remoteBrowserDataAccess, analyticsTracking, chatHistoryEnabled } = req.body;
      if (
        trainingOptIn === undefined &&
        remoteBrowserDataAccess === undefined &&
        analyticsTracking === undefined &&
        chatHistoryEnabled === undefined
      ) {
        return res.status(400).json({ error: "No valid privacy fields provided" });
      }

      const existing = await storage.getUserSettings(id);
      const currentPrivacy = {
        trainingOptIn: false,
        remoteBrowserDataAccess: false,
        analyticsTracking: true,
        chatHistoryEnabled: true,
        ...(existing?.privacySettings || {}),
      };
      const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0] || undefined;
      const userAgent = req.headers['user-agent'] || undefined;

      if (trainingOptIn !== undefined && trainingOptIn !== currentPrivacy.trainingOptIn) {
        await storage.logConsent(id, 'training_opt_in', String(trainingOptIn), ipAddress, userAgent);
      }
      if (remoteBrowserDataAccess !== undefined && remoteBrowserDataAccess !== currentPrivacy.remoteBrowserDataAccess) {
        await storage.logConsent(id, 'remote_browser_access', String(remoteBrowserDataAccess), ipAddress, userAgent);
      }
      if (analyticsTracking !== undefined) {
        await storage.logConsent(id, 'analytics_tracking', String(analyticsTracking), ipAddress, userAgent);
      }
      if (chatHistoryEnabled !== undefined) {
        await storage.logConsent(id, 'chat_history_enabled', String(chatHistoryEnabled), ipAddress, userAgent);
      }

      const privacySettingsUpdates: Record<string, boolean> = {};
      if (trainingOptIn !== undefined) privacySettingsUpdates.trainingOptIn = trainingOptIn;
      if (remoteBrowserDataAccess !== undefined) privacySettingsUpdates.remoteBrowserDataAccess = remoteBrowserDataAccess;
      if (analyticsTracking !== undefined) privacySettingsUpdates.analyticsTracking = analyticsTracking;
      if (chatHistoryEnabled !== undefined) privacySettingsUpdates.chatHistoryEnabled = chatHistoryEnabled;

      const settings = await storage.upsertUserSettings(id, {
        privacySettings: privacySettingsUpdates
      });

      invalidateUserPrivacySettingsCache(id);
      res.json(settings);
    } catch (error: any) {
      console.error("Error updating privacy settings:", error);
      res.status(500).json({ error: "Failed to update privacy settings" });
    }
  });

  router.get("/api/users/:id/shared-links", async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId || authUserId.startsWith("anon_")) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const links = await storage.getSharedLinks(id);
      res.json(links);
    } catch (error: any) {
      console.error("Error getting shared links:", error);
      res.status(500).json({ error: "Failed to get shared links" });
    }
  });

  router.post("/api/users/:id/shared-links", async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId || authUserId.startsWith("anon_")) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const { resourceType, resourceId, scope, permissions, expiresAt } = req.body;

      if (!resourceType || !resourceId) {
        return res.status(400).json({ error: "Missing required fields: resourceType, resourceId" });
      }

      const token = crypto.randomBytes(32).toString('hex');

      const link = await storage.createSharedLink({
        userId: id,
        resourceType,
        resourceId,
        token,
        scope: scope || 'link_only',
        permissions: permissions || 'read',
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        isRevoked: 'false'
      });

      res.json(link);
    } catch (error: any) {
      console.error("Error creating shared link:", error);
      res.status(500).json({ error: "Failed to create shared link" });
    }
  });

  router.delete("/api/users/:id/shared-links/:linkId", async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId || authUserId.startsWith("anon_")) return res.status(401).json({ error: "Unauthorized" });

      const { id, linkId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const links = await storage.getSharedLinks(id);
      const link = links.find(l => l.id === linkId);
      if (!link) return res.status(404).json({ error: "Shared link not found" });

      await storage.revokeSharedLink(linkId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error revoking shared link:", error);
      res.status(500).json({ error: "Failed to revoke shared link" });
    }
  });

  router.post("/api/users/:id/shared-links/:linkId/rotate", async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId || authUserId.startsWith("anon_")) return res.status(401).json({ error: "Unauthorized" });

      const { id, linkId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const links = await storage.getSharedLinks(id);
      const existing = links.find(l => l.id === linkId);
      if (!existing) return res.status(404).json({ error: "Shared link not found" });

      const link = await storage.rotateSharedLinkToken(linkId);
      res.json(link);
    } catch (error: any) {
      console.error("Error rotating shared link token:", error);
      res.status(500).json({ error: "Failed to rotate shared link token" });
    }
  });

  router.patch("/api/users/:id/shared-links/:linkId", async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId || authUserId.startsWith("anon_")) return res.status(401).json({ error: "Unauthorized" });

      const { id, linkId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const { scope, permissions } = req.body;

      const links = await storage.getSharedLinks(id);
      const existing = links.find(l => l.id === linkId);
      if (!existing) return res.status(404).json({ error: "Shared link not found" });

      const link = await storage.updateSharedLink(linkId, { scope, permissions });
      res.json(link);
    } catch (error: any) {
      console.error("Error updating shared link:", error);
      res.status(500).json({ error: "Failed to update shared link" });
    }
  });

  router.get("/api/shared/:token", async (req, res) => {
    try {
      const { token } = req.params;

      const link = await storage.getSharedLinkByToken(token);

      if (!link) {
        return res.status(404).json({ error: "Shared link not found" });
      }

      if (link.isRevoked === 'true') {
        return res.status(410).json({ error: "This shared link has been revoked" });
      }

      if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
        return res.status(410).json({ error: "This shared link has expired" });
      }

      await storage.incrementSharedLinkAccess(link.id);

      res.json({
        resourceType: link.resourceType,
        resourceId: link.resourceId,
        scope: link.scope,
        permissions: link.permissions,
        accessCount: (link.accessCount || 0) + 1
      });
    } catch (error: any) {
      console.error("Error accessing shared link:", error);
      res.status(500).json({ error: "Failed to access shared link" });
    }
  });

  router.get("/api/users/:id/chats/archived", async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId || authUserId.startsWith("anon_")) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const chats = await storage.getArchivedChats(id);
      res.json(chats);
    } catch (error: any) {
      console.error("Error getting archived chats:", error);
      res.status(500).json({ error: "Failed to get archived chats" });
    }
  });

  router.post("/api/users/:id/chats/:chatId/unarchive", async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId || authUserId.startsWith("anon_")) return res.status(401).json({ error: "Unauthorized" });

      const { id, chatId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const chat = await storage.getChat(chatId);
      if (!chat || chat.userId !== id) return res.status(404).json({ error: "Chat not found" });

      await storage.unarchiveChat(chatId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error unarchiving chat:", error);
      res.status(500).json({ error: "Failed to unarchive chat" });
    }
  });

  router.post("/api/users/:id/chats/archive-all", async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId || authUserId.startsWith("anon_")) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const count = await storage.archiveAllChats(id);
      res.json({ count });
    } catch (error: any) {
      console.error("Error archiving all chats:", error);
      res.status(500).json({ error: "Failed to archive all chats" });
    }
  });

  router.get("/api/users/:id/chats/deleted", async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId || authUserId.startsWith("anon_")) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const chats = await storage.getDeletedChats(id);
      res.json(chats);
    } catch (error: any) {
      console.error("Error getting deleted chats:", error);
      res.status(500).json({ error: "Failed to get deleted chats" });
    }
  });

  router.post("/api/users/:id/chats/delete-all", async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId || authUserId.startsWith("anon_")) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const count = await storage.softDeleteAllChats(id);

      const links = await storage.getSharedLinks(id);
      for (const link of links) {
        if (link.resourceType === 'chat') {
          await storage.revokeSharedLink(link.id);
        }
      }

      res.json({ count });
    } catch (error: any) {
      console.error("Error deleting all chats:", error);
      res.status(500).json({ error: "Failed to delete all chats" });
    }
  });

  router.post("/api/users/:id/chats/:chatId/restore", async (req, res) => {
    try {
      const authUserId = getUserId(req);
      if (!authUserId || authUserId.startsWith("anon_")) return res.status(401).json({ error: "Unauthorized" });

      const { id, chatId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const chat = await storage.getChat(chatId);
      if (!chat || chat.userId !== id) return res.status(404).json({ error: "Chat not found" });

      await storage.restoreDeletedChat(chatId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error restoring chat:", error);
      res.status(500).json({ error: "Failed to restore chat" });
    }
  });

  router.get("/api/users/:id/company-knowledge", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const knowledge = await storage.getCompanyKnowledge(id);
      res.json(knowledge);
    } catch (error: any) {
      console.error("Error getting company knowledge:", error);
      res.status(500).json({ error: "Failed to get company knowledge" });
    }
  });

  router.post("/api/users/:id/company-knowledge", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const { title, content, category } = req.body;
      if (!title || !content) {
        return res.status(400).json({ error: "Title and content are required" });
      }

      const knowledge = await storage.createCompanyKnowledge({
        userId: id,
        title,
        content,
        category: category || "general",
        isActive: "true"
      });
      res.json(knowledge);
    } catch (error: any) {
      console.error("Error creating company knowledge:", error);
      res.status(500).json({ error: "Failed to create company knowledge" });
    }
  });

  router.put("/api/users/:id/company-knowledge/:knowledgeId", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id, knowledgeId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const { title, content, category, isActive } = req.body;
      const knowledge = await storage.updateCompanyKnowledge(knowledgeId, {
        ...(title !== undefined && { title }),
        ...(content !== undefined && { content }),
        ...(category !== undefined && { category }),
        ...(isActive !== undefined && { isActive: isActive ? "true" : "false" })
      });

      if (!knowledge) {
        return res.status(404).json({ error: "Knowledge entry not found" });
      }
      res.json(knowledge);
    } catch (error: any) {
      console.error("Error updating company knowledge:", error);
      res.status(500).json({ error: "Failed to update company knowledge" });
    }
  });

  router.delete("/api/users/:id/company-knowledge/:knowledgeId", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id, knowledgeId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      await storage.deleteCompanyKnowledge(knowledgeId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting company knowledge:", error);
      res.status(500).json({ error: "Failed to delete company knowledge" });
    }
  });

  // ============================================================================
  // User Preferences (General)
  // ============================================================================

  /**
   * GET /api/user/preferences - Get current user's preferences
   */
  router.get("/api/user/preferences", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json(user.preferences || {});
    } catch (error: any) {
      console.error("[Preferences] Error getting:", error);
      res.status(500).json({ error: "Failed to get preferences" });
    }
  });

  /**
   * PATCH /api/user/preferences - Update some preferences
   */
  router.patch("/api/user/preferences", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const updates = req.body;
      if (!updates || typeof updates !== "object") {
        return res.status(400).json({ error: "Invalid preferences" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const currentPrefs = (user.preferences as Record<string, unknown>) || {};
      const newPrefs = { ...currentPrefs, ...updates };

      await storage.updateUser(userId, { preferences: newPrefs });
      res.json(newPrefs);
    } catch (error: any) {
      console.error("[Preferences] Error updating:", error);
      res.status(500).json({ error: "Failed to update preferences" });
    }
  });

  /**
   * PUT /api/user/preferences - Replace all preferences
   */
  router.put("/api/user/preferences", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const preferences = req.body;
      if (!preferences || typeof preferences !== "object") {
        return res.status(400).json({ error: "Invalid preferences" });
      }

      await storage.updateUser(userId, { preferences });
      res.json(preferences);
    } catch (error: any) {
      console.error("[Preferences] Error replacing:", error);
      res.status(500).json({ error: "Failed to replace preferences" });
    }
  });

  // ============================================================================
  // GDPR Data Export
  // ============================================================================

  /**
   * GET /api/user/export - Export all user data (GDPR compliance)
   */
  router.get("/api/user/export", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const userSettings = await storage.getUserSettings(userId);

      // Collect all user data
      const chats = await storage.getChats(userId);
      const messages: any[] = [];
      for (const chat of chats.slice(0, 100)) { // Limit to last 100 chats
        const chatMessages = await storage.getChatMessages(chat.id, { orderBy: 'asc' });
        messages.push(...chatMessages);
      }

      // Remove sensitive fields
      const { password, totpSecret, ...safeUser } = user as any;

      const exportData = {
        exportedAt: new Date().toISOString(),
        format: "IliaGPT Data Export v1.0",
        user: safeUser,
        statistics: {
          totalChats: chats.length,
          totalMessages: messages.length,
          tokensConsumed: user.tokensConsumed || 0,
          queryCount: user.queryCount || 0
        },
        chats: chats.map(c => ({
          id: c.id,
          title: c.title,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt
        })),
        messages: messages.map(m => ({
          id: m.id,
          chatId: m.chatId,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt
        })),
        preferences: user.preferences || {},
        userSettings: userSettings || null
      };

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="iliagpt-export-${userId.slice(0,8)}-${Date.now()}.json"`);
      res.json(exportData);

    } catch (error: any) {
      console.error("[Export] Error:", error);
      res.status(500).json({ error: "Failed to export data" });
    }
  });

  /**
   * DELETE /api/user/account - Delete user account (GDPR right to be forgotten)
   */
  router.delete("/api/user/account", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { confirmation } = req.body;
      if (confirmation !== "DELETE_MY_ACCOUNT") {
        return res.status(400).json({ 
          error: "Please confirm deletion by sending: { confirmation: 'DELETE_MY_ACCOUNT' }" 
        });
      }

      // Soft delete - mark as deleted but keep for audit
      await storage.updateUser(userId, { 
        status: "deleted",
        deletedAt: new Date(),
        email: `deleted-${userId}@deleted.local`,
        phone: null,
        fullName: "Deleted User"
      });

      // Log for audit
      await storage.createAuditLog({
        action: "account_deletion",
        resource: "users",
        resourceId: userId,
        details: { 
          deletedAt: new Date().toISOString(),
          method: "user_request"
        }
      });

      res.json({ 
        success: true, 
        message: "Account scheduled for deletion. Data will be removed within 30 days." 
      });

    } catch (error: any) {
      console.error("[Delete Account] Error:", error);
      res.status(500).json({ error: "Failed to delete account" });
    }
  });

  return router;
}
