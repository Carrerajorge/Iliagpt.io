import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { SessionState, OperationLog } from "./types";

interface InstalledPackage {
  version: string;
  packageManager: string;
  installedAt: string;
}

interface StateManagerConfig {
  stateDirectory: string;
  autoSave: boolean;
  saveInterval: number;
  maxHistoryEntries: number;
}

export class StateManager {
  private stateDir: string;
  private autoSave: boolean;
  private saveInterval: number;
  private maxHistoryEntries: number;

  private currentSession: SessionState | null = null;
  private operationHistory: OperationLog[] = [];
  private config: Record<string, unknown> = {};
  private installedPackages: Record<string, InstalledPackage> = {};
  private autoSaveTimer: NodeJS.Timeout | null = null;

  private static readonly STATE_FILE = "sandbox_state.json";
  private static readonly HISTORY_FILE = "operation_history.json";
  private static readonly CONFIG_FILE = "sandbox_config.json";
  private static readonly PACKAGES_FILE = "installed_packages.json";

  constructor(options: Partial<StateManagerConfig> = {}) {
    this.stateDir = options.stateDirectory || path.join(process.cwd(), "sandbox_workspace", ".state");
    this.autoSave = options.autoSave ?? true;
    this.saveInterval = options.saveInterval ?? 60000;
    this.maxHistoryEntries = options.maxHistoryEntries ?? 10000;
  }

  async initialize(): Promise<boolean> {
    try {
      await fsp.mkdir(this.stateDir, { recursive: true });
      await this.loadConfig();
      await this.loadHistory();
      await this.loadPackages();
      this.currentSession = await this.createSession();

      if (this.autoSave) {
        this.startAutoSave();
      }

      return true;
    } catch (error) {
      console.error("[StateManager] Error inicializando:", error);
      return false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    await this.saveAll();
  }

  private async createSession(): Promise<SessionState> {
    const sessionId = crypto
      .createHash("sha256")
      .update(`${new Date().toISOString()}_${process.pid}`)
      .digest("hex")
      .substring(0, 16);

    return {
      sessionId,
      createdAt: new Date(),
      lastActive: new Date(),
      workingDirectory: path.dirname(this.stateDir),
      environmentVars: { ...process.env } as Record<string, string>,
      installedPackages: Object.keys(this.installedPackages),
      customData: {},
    };
  }

  async getSessionInfo(): Promise<SessionState | null> {
    return this.currentSession;
  }

  async getConfig<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
    return (this.config[key] as T) ?? defaultValue;
  }

  async setConfig(key: string, value: unknown): Promise<void> {
    this.config[key] = value;
    await this.saveConfig();
  }

  async getAllConfig(): Promise<Record<string, unknown>> {
    return { ...this.config };
  }

  private async loadConfig(): Promise<void> {
    const configFile = path.join(this.stateDir, StateManager.CONFIG_FILE);
    try {
      if (fs.existsSync(configFile)) {
        const content = await fsp.readFile(configFile, "utf-8");
        this.config = JSON.parse(content);
      } else {
        this.config = {
          defaultShell: "/bin/bash",
          defaultTimeout: 30000,
          maxFileSize: 100 * 1024 * 1024,
          enableHistory: true,
          enableSecurity: true,
        };
        await this.saveConfig();
      }
    } catch {
      this.config = {};
    }
  }

  private async saveConfig(): Promise<void> {
    const configFile = path.join(this.stateDir, StateManager.CONFIG_FILE);
    try {
      await fsp.writeFile(configFile, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error("[StateManager] Error guardando configuración:", error);
    }
  }

  async logOperation(
    operationType: string,
    operationName: string,
    parameters: Record<string, unknown>,
    result: string,
    durationMs: number,
    success: boolean
  ): Promise<void> {
    if (!this.config.enableHistory) return;

    const log: OperationLog = {
      timestamp: new Date(),
      operationType,
      operationName,
      parameters,
      result: result.substring(0, 500),
      durationMs,
      success,
    };

    this.operationHistory.push(log);
    if (this.operationHistory.length > this.maxHistoryEntries) {
      this.operationHistory = this.operationHistory.slice(-this.maxHistoryEntries);
    }
  }

  async getHistory(
    limit: number = 100,
    operationType?: string,
    successOnly: boolean = false
  ): Promise<OperationLog[]> {
    let history = this.operationHistory;
    if (operationType) {
      history = history.filter((h) => h.operationType === operationType);
    }
    if (successOnly) {
      history = history.filter((h) => h.success);
    }
    return history.slice(-limit);
  }

  async clearHistory(): Promise<void> {
    this.operationHistory = [];
    await this.saveHistory();
  }

  private async loadHistory(): Promise<void> {
    const historyFile = path.join(this.stateDir, StateManager.HISTORY_FILE);
    try {
      if (fs.existsSync(historyFile)) {
        const content = await fsp.readFile(historyFile, "utf-8");
        const data = JSON.parse(content) as Array<{
          timestamp: string;
          operationType: string;
          operationName: string;
          parameters: Record<string, unknown>;
          result: string;
          durationMs: number;
          success: boolean;
        }>;
        this.operationHistory = data.map((h) => ({
          ...h,
          timestamp: new Date(h.timestamp),
        }));
      }
    } catch {
      this.operationHistory = [];
    }
  }

  private async saveHistory(): Promise<void> {
    const historyFile = path.join(this.stateDir, StateManager.HISTORY_FILE);
    try {
      const data = this.operationHistory.slice(-this.maxHistoryEntries).map((h) => ({
        ...h,
        timestamp: h.timestamp.toISOString(),
      }));
      await fsp.writeFile(historyFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("[StateManager] Error guardando historial:", error);
    }
  }

  async registerPackage(name: string, version: string, packageManager: string): Promise<void> {
    this.installedPackages[name] = {
      version,
      packageManager,
      installedAt: new Date().toISOString(),
    };
    await this.savePackages();
  }

  async unregisterPackage(name: string): Promise<void> {
    delete this.installedPackages[name];
    await this.savePackages();
  }

  async getInstalledPackages(packageManager?: string): Promise<Record<string, InstalledPackage>> {
    if (packageManager) {
      const filtered: Record<string, InstalledPackage> = {};
      for (const [name, pkg] of Object.entries(this.installedPackages)) {
        if (pkg.packageManager === packageManager) {
          filtered[name] = pkg;
        }
      }
      return filtered;
    }
    return { ...this.installedPackages };
  }

  async isPackageInstalled(name: string): Promise<boolean> {
    return name in this.installedPackages;
  }

  private async loadPackages(): Promise<void> {
    const packagesFile = path.join(this.stateDir, StateManager.PACKAGES_FILE);
    try {
      if (fs.existsSync(packagesFile)) {
        const content = await fsp.readFile(packagesFile, "utf-8");
        this.installedPackages = JSON.parse(content);
      }
    } catch {
      this.installedPackages = {};
    }
  }

  private async savePackages(): Promise<void> {
    const packagesFile = path.join(this.stateDir, StateManager.PACKAGES_FILE);
    try {
      await fsp.writeFile(packagesFile, JSON.stringify(this.installedPackages, null, 2));
    } catch (error) {
      console.error("[StateManager] Error guardando paquetes:", error);
    }
  }

  async setData(key: string, value: unknown): Promise<void> {
    if (this.currentSession) {
      this.currentSession.customData[key] = value;
    }
  }

  async getData<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
    if (this.currentSession) {
      return (this.currentSession.customData[key] as T) ?? defaultValue;
    }
    return defaultValue;
  }

  async deleteData(key: string): Promise<void> {
    if (this.currentSession && key in this.currentSession.customData) {
      delete this.currentSession.customData[key];
    }
  }

  private startAutoSave(): void {
    this.autoSaveTimer = setInterval(() => {
      this.saveAll().catch((err) => console.error("[StateManager] Auto-save error:", err));
    }, this.saveInterval);
  }

  async saveAll(): Promise<void> {
    await this.saveConfig();
    await this.saveHistory();
    await this.savePackages();
    await this.saveSession();
  }

  private async saveSession(): Promise<void> {
    if (!this.currentSession) return;
    const sessionFile = path.join(this.stateDir, `session_${this.currentSession.sessionId}.json`);
    try {
      const data = {
        ...this.currentSession,
        createdAt: this.currentSession.createdAt.toISOString(),
        lastActive: new Date().toISOString(),
      };
      await fsp.writeFile(sessionFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("[StateManager] Error guardando sesión:", error);
    }
  }

  getStats(): Record<string, unknown> {
    return {
      stateDirectory: this.stateDir,
      currentSession: this.currentSession?.sessionId ?? null,
      historyEntries: this.operationHistory.length,
      installedPackages: Object.keys(this.installedPackages).length,
      configKeys: Object.keys(this.config).length,
      autoSaveEnabled: this.autoSave,
    };
  }
}
