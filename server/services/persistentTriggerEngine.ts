/**
 * Persistent Automation Trigger System
 *
 * DB-backed triggers that survive server restarts.
 * Supports: cron, file watcher, webhook, email, calendar, system events.
 *
 * Architecture:
 *   - Triggers stored in DB (automationTriggers table)
 *   - On boot: load active triggers and start watchers/cron
 *   - Actions: invoke agent chat, run AppleScript, call webhook, send notification
 *   - Execution log stored in DB for audit
 */

import cron from "node-cron";
import chokidar from "chokidar";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Types ──────────────────────────────────────────────────────────────

export type TriggerKind =
  | "cron"
  | "file_watch"
  | "webhook"
  | "email"
  | "calendar"
  | "system_event"
  | "one_shot";

export type ActionKind =
  | "agent_chat"       // Send a message to agent for processing
  | "webhook_call"     // POST to external URL
  | "notification"     // macOS native notification
  | "applescript"      // Run AppleScript
  | "shell_command"    // Run shell command
  | "api_call";        // Internal API call

export interface TriggerDefinition {
  id: string;
  userId: string;
  name: string;
  description?: string;
  kind: TriggerKind;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  // Trigger config (varies by kind)
  config: TriggerConfig;

  // Action to execute when triggered
  action: ActionDefinition;

  // Execution stats
  lastRunAt?: Date;
  lastRunStatus?: "success" | "error";
  lastRunError?: string;
  runCount: number;
  errorCount: number;
  maxRuns?: number; // null = unlimited
}

export type TriggerConfig =
  | CronConfig
  | FileWatchConfig
  | WebhookConfig
  | EmailConfig
  | CalendarConfig
  | SystemEventConfig
  | OneShotConfig;

export interface CronConfig {
  kind: "cron";
  expression: string;     // cron expression (e.g. "0 9 * * 1-5")
  timezone?: string;       // IANA timezone
}

export interface FileWatchConfig {
  kind: "file_watch";
  paths: string[];
  events: ("add" | "change" | "unlink")[];
  debounceMs?: number;
  ignorePatterns?: string[];
}

export interface WebhookConfig {
  kind: "webhook";
  hookId: string;          // unique webhook path: /api/triggers/webhook/:hookId
  secret?: string;         // optional HMAC secret for verification
  allowedIps?: string[];
}

export interface EmailConfig {
  kind: "email";
  filters: {
    from?: string;         // regex pattern
    subject?: string;      // regex pattern
    hasAttachment?: boolean;
  };
  checkIntervalMs: number;
}

export interface CalendarConfig {
  kind: "calendar";
  calendarName?: string;
  minutesBefore: number;  // trigger N minutes before event
}

export interface SystemEventConfig {
  kind: "system_event";
  event: "battery_low" | "battery_critical" | "disk_full" | "wifi_changed" | "app_crash" | "wake_from_sleep";
  threshold?: number;     // percentage for battery/disk
}

export interface OneShotConfig {
  kind: "one_shot";
  runAt: Date;             // specific date/time
}

export interface ActionDefinition {
  kind: ActionKind;
  // agent_chat
  chatId?: string;
  prompt?: string;

  // webhook_call
  url?: string;
  method?: "GET" | "POST" | "PUT";
  headers?: Record<string, string>;
  body?: string;

  // notification
  notificationTitle?: string;
  notificationMessage?: string;
  notificationSound?: string;

  // applescript / shell_command
  script?: string;

  // api_call
  apiEndpoint?: string;
  apiPayload?: Record<string, unknown>;
}

export interface TriggerExecution {
  id: string;
  triggerId: string;
  firedAt: Date;
  status: "success" | "error" | "running";
  actionKind: ActionKind;
  result?: string;
  error?: string;
  durationMs: number;
}

// ── Persistent Trigger Engine ──────────────────────────────────────────

export class PersistentTriggerEngine extends EventEmitter {
  private triggers = new Map<string, TriggerDefinition>();
  private cronTasks = new Map<string, cron.ScheduledTask>();
  private fileWatchers = new Map<string, chokidar.FSWatcher>();
  private systemPollInterval?: NodeJS.Timeout;
  private oneShotTimers = new Map<string, NodeJS.Timeout>();
  private isRunning = false;

  // Action executor callback — set by the app to connect triggers to the agent
  private actionExecutor?: (trigger: TriggerDefinition, context: Record<string, unknown>) => Promise<string>;

  setActionExecutor(fn: (trigger: TriggerDefinition, context: Record<string, unknown>) => Promise<string>) {
    this.actionExecutor = fn;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Load triggers from DB
    await this.loadFromDB();

    // Start system event polling
    this.startSystemEventPolling();

    console.log(`[TriggerEngine] Started with ${this.triggers.size} triggers`);
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    // Stop all cron tasks
    for (const [, task] of this.cronTasks) task.stop();
    this.cronTasks.clear();

    // Stop all file watchers
    for (const [, watcher] of this.fileWatchers) await watcher.close();
    this.fileWatchers.clear();

    // Clear one-shot timers
    for (const [, timer] of this.oneShotTimers) clearTimeout(timer);
    this.oneShotTimers.clear();

    // Stop system polling
    if (this.systemPollInterval) {
      clearInterval(this.systemPollInterval);
      this.systemPollInterval = undefined;
    }

    console.log("[TriggerEngine] Stopped");
  }

  // ── CRUD ───────────────────────────────────────────────────────────

  async createTrigger(def: Omit<TriggerDefinition, "id" | "createdAt" | "updatedAt" | "runCount" | "errorCount">): Promise<TriggerDefinition> {
    const trigger: TriggerDefinition = {
      ...def,
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      runCount: 0,
      errorCount: 0,
    };

    // Save to DB
    await this.saveTriggerToDB(trigger);

    // Activate if active
    this.triggers.set(trigger.id, trigger);
    if (trigger.isActive) {
      this.activateTrigger(trigger);
    }

    this.emit("trigger:created", trigger);
    return trigger;
  }

  async updateTrigger(id: string, updates: Partial<TriggerDefinition>): Promise<TriggerDefinition | null> {
    const existing = this.triggers.get(id);
    if (!existing) return null;

    // Deactivate current
    this.deactivateTrigger(id);

    // Apply updates
    const updated = { ...existing, ...updates, id, updatedAt: new Date() };
    this.triggers.set(id, updated);

    // Save to DB
    await this.saveTriggerToDB(updated);

    // Reactivate if active
    if (updated.isActive) {
      this.activateTrigger(updated);
    }

    this.emit("trigger:updated", updated);
    return updated;
  }

  async deleteTrigger(id: string): Promise<boolean> {
    this.deactivateTrigger(id);
    this.triggers.delete(id);

    // Delete from DB
    await this.deleteTriggerFromDB(id);

    this.emit("trigger:deleted", { id });
    return true;
  }

  async toggleTrigger(id: string, active: boolean): Promise<boolean> {
    const trigger = this.triggers.get(id);
    if (!trigger) return false;

    if (active && !trigger.isActive) {
      trigger.isActive = true;
      this.activateTrigger(trigger);
    } else if (!active && trigger.isActive) {
      trigger.isActive = false;
      this.deactivateTrigger(id);
    }

    trigger.updatedAt = new Date();
    await this.saveTriggerToDB(trigger);
    return true;
  }

  listTriggers(userId?: string): TriggerDefinition[] {
    const all = Array.from(this.triggers.values());
    return userId ? all.filter(t => t.userId === userId) : all;
  }

  getTrigger(id: string): TriggerDefinition | undefined {
    return this.triggers.get(id);
  }

  // ── Activation ─────────────────────────────────────────────────────

  private activateTrigger(trigger: TriggerDefinition): void {
    const { config } = trigger;

    switch (config.kind) {
      case "cron":
        this.setupCron(trigger, config);
        break;
      case "file_watch":
        this.setupFileWatch(trigger, config);
        break;
      case "one_shot":
        this.setupOneShot(trigger, config);
        break;
      // webhook, email, calendar, system_event handled by polling/routes
    }
  }

  private deactivateTrigger(id: string): void {
    const cronTask = this.cronTasks.get(id);
    if (cronTask) { cronTask.stop(); this.cronTasks.delete(id); }

    const watcher = this.fileWatchers.get(id);
    if (watcher) { watcher.close(); this.fileWatchers.delete(id); }

    const timer = this.oneShotTimers.get(id);
    if (timer) { clearTimeout(timer); this.oneShotTimers.delete(id); }
  }

  // ── Cron ───────────────────────────────────────────────────────────

  private setupCron(trigger: TriggerDefinition, config: CronConfig): void {
    if (!cron.validate(config.expression)) {
      console.error(`[TriggerEngine] Invalid cron: ${config.expression} for ${trigger.id}`);
      return;
    }

    const task = cron.schedule(config.expression, () => {
      this.executeTrigger(trigger, { cronExpression: config.expression });
    }, {
      timezone: config.timezone,
    });

    this.cronTasks.set(trigger.id, task);
    console.log(`[TriggerEngine] Cron active: ${trigger.name} (${config.expression})`);
  }

  // ── File Watch ─────────────────────────────────────────────────────

  private setupFileWatch(trigger: TriggerDefinition, config: FileWatchConfig): void {
    const watcher = chokidar.watch(config.paths, {
      persistent: true,
      ignoreInitial: true,
      ignored: config.ignorePatterns,
      awaitWriteFinish: config.debounceMs ? { stabilityThreshold: config.debounceMs } : undefined,
    });

    for (const event of config.events) {
      watcher.on(event, (filePath: string) => {
        this.executeTrigger(trigger, { event, filePath });
      });
    }

    watcher.on("error", (err) => {
      console.error(`[TriggerEngine] File watcher error for ${trigger.id}:`, err);
    });

    this.fileWatchers.set(trigger.id, watcher);
    console.log(`[TriggerEngine] File watcher active: ${trigger.name} on ${config.paths.join(", ")}`);
  }

  // ── One-Shot ───────────────────────────────────────────────────────

  private setupOneShot(trigger: TriggerDefinition, config: OneShotConfig): void {
    const delayMs = new Date(config.runAt).getTime() - Date.now();
    if (delayMs <= 0) {
      // Already past — execute immediately
      this.executeTrigger(trigger, { scheduledFor: config.runAt });
      return;
    }

    const timer = setTimeout(() => {
      this.executeTrigger(trigger, { scheduledFor: config.runAt });
      // Deactivate after execution
      this.toggleTrigger(trigger.id, false);
    }, delayMs);

    this.oneShotTimers.set(trigger.id, timer);
    console.log(`[TriggerEngine] One-shot scheduled: ${trigger.name} at ${config.runAt}`);
  }

  // ── Webhook Handler (called from Express route) ────────────────────

  async handleWebhook(hookId: string, payload: unknown, headers: Record<string, string>): Promise<{ triggered: boolean; triggerId?: string }> {
    for (const trigger of this.triggers.values()) {
      if (trigger.config.kind === "webhook" && (trigger.config as WebhookConfig).hookId === hookId && trigger.isActive) {
        await this.executeTrigger(trigger, { webhookPayload: payload, headers });
        return { triggered: true, triggerId: trigger.id };
      }
    }
    return { triggered: false };
  }

  // ── System Event Polling ───────────────────────────────────────────

  private lastBatteryPercent = -1;
  private lastWifiSsid: string | null = null;

  private startSystemEventPolling(): void {
    // Poll every 60 seconds for system events
    this.systemPollInterval = setInterval(async () => {
      const systemTriggers = Array.from(this.triggers.values())
        .filter(t => t.config.kind === "system_event" && t.isActive);

      if (systemTriggers.length === 0) return;

      try {
        // Only import macos if needed (avoid errors on non-macOS)
        const { getBatteryInfo, getWiFiStatus } = await import("../lib/macos");

        const battery = await getBatteryInfo();
        const wifi = await getWiFiStatus();

        for (const trigger of systemTriggers) {
          const cfg = trigger.config as SystemEventConfig;

          switch (cfg.event) {
            case "battery_low":
              if (battery.percent <= (cfg.threshold ?? 20) && battery.percent !== this.lastBatteryPercent && !battery.charging) {
                await this.executeTrigger(trigger, { batteryPercent: battery.percent });
              }
              break;
            case "battery_critical":
              if (battery.percent <= (cfg.threshold ?? 10) && battery.percent !== this.lastBatteryPercent && !battery.charging) {
                await this.executeTrigger(trigger, { batteryPercent: battery.percent });
              }
              break;
            case "wifi_changed":
              if (wifi.ssid !== this.lastWifiSsid && this.lastWifiSsid !== null) {
                await this.executeTrigger(trigger, { previousSsid: this.lastWifiSsid, currentSsid: wifi.ssid });
              }
              break;
          }
        }

        this.lastBatteryPercent = battery.percent;
        this.lastWifiSsid = wifi.ssid;
      } catch {
        // Non-macOS or API error — silently skip
      }
    }, 60_000);
  }

  // ── Execution ──────────────────────────────────────────────────────

  private async executeTrigger(trigger: TriggerDefinition, context: Record<string, unknown>): Promise<void> {
    // Check max runs
    if (trigger.maxRuns && trigger.runCount >= trigger.maxRuns) {
      await this.toggleTrigger(trigger.id, false);
      return;
    }

    const execution: TriggerExecution = {
      id: randomUUID(),
      triggerId: trigger.id,
      firedAt: new Date(),
      status: "running",
      actionKind: trigger.action.kind,
      durationMs: 0,
    };

    const startMs = Date.now();

    try {
      let result: string;

      if (this.actionExecutor) {
        result = await this.actionExecutor(trigger, context);
      } else {
        result = await this.executeActionDirectly(trigger.action, context);
      }

      execution.status = "success";
      execution.result = result.slice(0, 2000);
      execution.durationMs = Date.now() - startMs;

      trigger.runCount++;
      trigger.lastRunAt = new Date();
      trigger.lastRunStatus = "success";
      trigger.lastRunError = undefined;

    } catch (err: any) {
      execution.status = "error";
      execution.error = err.message?.slice(0, 500);
      execution.durationMs = Date.now() - startMs;

      trigger.runCount++;
      trigger.errorCount++;
      trigger.lastRunAt = new Date();
      trigger.lastRunStatus = "error";
      trigger.lastRunError = err.message;
    }

    // Save execution log
    await this.saveExecutionToDB(execution);
    await this.saveTriggerToDB(trigger);

    this.emit("trigger:fired", { trigger, execution, context });
  }

  private async executeActionDirectly(action: ActionDefinition, context: Record<string, unknown>): Promise<string> {
    switch (action.kind) {
      case "notification": {
        const { showNotification } = await import("../lib/macos");
        const r = await showNotification(
          action.notificationMessage || "Trigger fired",
          { title: action.notificationTitle || "ILIAGPT Automation" }
        );
        return r.success ? "Notification sent" : `Notification failed: ${r.error}`;
      }

      case "applescript": {
        if (!action.script) throw new Error("No script provided");
        const { runOsascript } = await import("../lib/macos");
        const r = await runOsascript(action.script);
        return r.success ? r.output : `AppleScript error: ${r.error}`;
      }

      case "shell_command": {
        if (!action.script) throw new Error("No command provided");
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(execFile);
        const { stdout } = await execAsync("/bin/zsh", ["-c", action.script], { timeout: 30000 });
        return stdout.trim();
      }

      case "webhook_call": {
        if (!action.url) throw new Error("No URL provided");
        const res = await fetch(action.url, {
          method: action.method || "POST",
          headers: {
            "Content-Type": "application/json",
            ...(action.headers || {}),
          },
          body: action.body || JSON.stringify(context),
        });
        return `${res.status} ${res.statusText}`;
      }

      case "agent_chat": {
        // Placeholder — connected via setActionExecutor
        return `Agent chat requested: ${action.prompt || "No prompt"}`;
      }

      case "api_call": {
        if (!action.apiEndpoint) throw new Error("No endpoint provided");
        const res = await fetch(action.apiEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action.apiPayload || context),
        });
        return `API ${res.status}: ${await res.text().then(t => t.slice(0, 500))}`;
      }

      default:
        throw new Error(`Unknown action kind: ${action.kind}`);
    }
  }

  // ── Database Persistence ───────────────────────────────────────────

  private async loadFromDB(): Promise<void> {
    try {
      const rows = await db.execute(sql`
        SELECT * FROM automation_triggers WHERE is_active = true
      `);

      if (!rows?.rows) return;

      for (const row of rows.rows as any[]) {
        const trigger = this.rowToTrigger(row);
        this.triggers.set(trigger.id, trigger);
        if (trigger.isActive) {
          this.activateTrigger(trigger);
        }
      }
    } catch {
      // Table might not exist yet — will be created by migration
      console.log("[TriggerEngine] No automation_triggers table yet, starting empty");
    }
  }

  private async saveTriggerToDB(trigger: TriggerDefinition): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO automation_triggers (
          id, user_id, name, description, kind, is_active,
          config, action, created_at, updated_at,
          last_run_at, last_run_status, last_run_error,
          run_count, error_count, max_runs
        ) VALUES (
          ${trigger.id}, ${trigger.userId}, ${trigger.name},
          ${trigger.description || null}, ${trigger.kind}, ${trigger.isActive},
          ${JSON.stringify(trigger.config)}::jsonb, ${JSON.stringify(trigger.action)}::jsonb,
          ${trigger.createdAt.toISOString()}, ${trigger.updatedAt.toISOString()},
          ${trigger.lastRunAt?.toISOString() || null}, ${trigger.lastRunStatus || null},
          ${trigger.lastRunError || null},
          ${trigger.runCount}, ${trigger.errorCount}, ${trigger.maxRuns || null}
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          is_active = EXCLUDED.is_active,
          config = EXCLUDED.config,
          action = EXCLUDED.action,
          updated_at = EXCLUDED.updated_at,
          last_run_at = EXCLUDED.last_run_at,
          last_run_status = EXCLUDED.last_run_status,
          last_run_error = EXCLUDED.last_run_error,
          run_count = EXCLUDED.run_count,
          error_count = EXCLUDED.error_count,
          max_runs = EXCLUDED.max_runs
      `);
    } catch (err: any) {
      console.error(`[TriggerEngine] DB save error:`, err.message);
    }
  }

  private async deleteTriggerFromDB(id: string): Promise<void> {
    try {
      await db.execute(sql`DELETE FROM automation_triggers WHERE id = ${id}`);
    } catch (err: any) {
      console.error(`[TriggerEngine] DB delete error:`, err.message);
    }
  }

  private async saveExecutionToDB(execution: TriggerExecution): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO trigger_executions (id, trigger_id, fired_at, status, action_kind, result, error, duration_ms)
        VALUES (${execution.id}, ${execution.triggerId}, ${execution.firedAt.toISOString()},
                ${execution.status}, ${execution.actionKind}, ${execution.result || null},
                ${execution.error || null}, ${execution.durationMs})
      `);
    } catch {
      // Silently skip if table doesn't exist yet
    }
  }

  private rowToTrigger(row: any): TriggerDefinition {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      kind: row.kind,
      isActive: row.is_active,
      config: typeof row.config === "string" ? JSON.parse(row.config) : row.config,
      action: typeof row.action === "string" ? JSON.parse(row.action) : row.action,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastRunAt: row.last_run_at ? new Date(row.last_run_at) : undefined,
      lastRunStatus: row.last_run_status,
      lastRunError: row.last_run_error,
      runCount: row.run_count || 0,
      errorCount: row.error_count || 0,
      maxRuns: row.max_runs,
    };
  }
}

// Singleton
export const triggerEngine = new PersistentTriggerEngine();
