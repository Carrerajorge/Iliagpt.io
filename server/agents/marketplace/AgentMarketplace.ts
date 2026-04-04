import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { Logger } from '../../lib/logger';
import {
  AgentManifest,
  AgentCapability,
  Permission,
  CURRENT_SDK_VERSION,
  validateManifest,
  isCompatible,
  semverCompare,
  formatPermission,
  permissionKey,
} from './AgentManifest';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentStatus = 'active' | 'disabled' | 'error' | 'loading';

export interface AgentStats {
  calls: number;
  errors: number;
  avgLatency: number;
}

export interface InstalledAgent {
  manifest: AgentManifest;
  installedAt: Date;
  updatedAt: Date;
  status: AgentStatus;
  errorMessage?: string;
  sandboxId?: string;
  source: string;
  stats: AgentStats;
}

export interface AgentFilter {
  status?: AgentStatus;
  capability?: AgentCapability;
  category?: string;
}

export interface MarketplaceStats {
  total: number;
  active: number;
  disabled: number;
  totalCalls: number;
  totalErrors: number;
}

// ─── Allowed Permissions Whitelist ────────────────────────────────────────────

const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set<string>([
  'filesystem:read',
  'filesystem:write',
  'network:read',
  'network:write',
  'database:read',
  'database:write',
  'clipboard:read',
  'clipboard:write',
]);

const HIGH_RISK_PERMISSIONS: ReadonlySet<string> = new Set<string>([
  'process:execute',
  'screen:read',
  'microphone:read',
  'camera:read',
]);

// ─── AgentMarketplace ─────────────────────────────────────────────────────────

export class AgentMarketplace extends EventEmitter {
  private readonly registry: Map<string, InstalledAgent> = new Map();

  constructor() {
    super();
    Logger.info('[AgentMarketplace] Initialized');
  }

  // ─── Install ──────────────────────────────────────────────────────────────

  async install(manifestRaw: unknown, source: string): Promise<InstalledAgent> {
    Logger.info('[AgentMarketplace] Installing agent from source:', source);

    const manifest = validateManifest(manifestRaw);

    if (!isCompatible(manifest, CURRENT_SDK_VERSION)) {
      throw new Error(
        `Agent "${manifest.name}" requires SDK >= ${manifest.minSdkVersion}, ` +
          `but current SDK is ${CURRENT_SDK_VERSION}`
      );
    }

    if (this.registry.has(manifest.name)) {
      const existing = this.registry.get(manifest.name)!;
      throw new Error(
        `Agent "${manifest.name}" is already installed at version ${existing.manifest.version}. ` +
          `Use upgrade() to update to a newer version.`
      );
    }

    this._validatePermissions(manifest);

    const now = new Date();
    const agent: InstalledAgent = {
      manifest,
      installedAt: now,
      updatedAt: now,
      status: 'loading',
      source,
      sandboxId: this._assignSandboxId(manifest.name),
      stats: { calls: 0, errors: 0, avgLatency: 0 },
    };

    this.registry.set(manifest.name, agent);

    try {
      agent.status = 'active';
      this.registry.set(manifest.name, { ...agent });

      Logger.info(
        `[AgentMarketplace] Agent "${manifest.name}" v${manifest.version} installed successfully`
      );

      this.emit('agent:installed', { agent: this.registry.get(manifest.name)!, source });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      agent.status = 'error';
      agent.errorMessage = errorMessage;
      this.registry.set(manifest.name, { ...agent });

      Logger.error(`[AgentMarketplace] Failed to activate agent "${manifest.name}":`, errorMessage);
      this.emit('agent:error', { agentName: manifest.name, error: err });

      throw new Error(`Failed to install agent "${manifest.name}": ${errorMessage}`);
    }

    return this.registry.get(manifest.name)!;
  }

  // ─── Uninstall ────────────────────────────────────────────────────────────

  async uninstall(agentName: string): Promise<void> {
    const agent = this._requireAgent(agentName);

    Logger.info(`[AgentMarketplace] Uninstalling agent "${agentName}"`);

    this.registry.delete(agentName);

    Logger.info(`[AgentMarketplace] Agent "${agentName}" uninstalled`);
    this.emit('agent:uninstalled', { agentName, sandboxId: agent.sandboxId });
  }

  // ─── Upgrade ──────────────────────────────────────────────────────────────

  async upgrade(agentName: string, newManifestRaw: unknown): Promise<InstalledAgent> {
    const existing = this._requireAgent(agentName);
    const newManifest = validateManifest(newManifestRaw);

    if (newManifest.name !== agentName) {
      throw new Error(
        `Upgrade manifest name "${newManifest.name}" does not match installed agent "${agentName}"`
      );
    }

    if (semverCompare(newManifest.version, existing.manifest.version) <= 0) {
      throw new Error(
        `Upgrade version ${newManifest.version} must be higher than ` +
          `installed version ${existing.manifest.version}`
      );
    }

    if (!isCompatible(newManifest, CURRENT_SDK_VERSION)) {
      throw new Error(
        `New version requires SDK >= ${newManifest.minSdkVersion}, ` +
          `but current SDK is ${CURRENT_SDK_VERSION}`
      );
    }

    this._validatePermissions(newManifest);

    Logger.info(
      `[AgentMarketplace] Upgrading "${agentName}" ` +
        `from v${existing.manifest.version} to v${newManifest.version}`
    );

    const upgraded: InstalledAgent = {
      manifest: newManifest,
      installedAt: existing.installedAt,
      updatedAt: new Date(),
      status: 'active',
      source: existing.source,
      sandboxId: this._assignSandboxId(agentName),
      stats: { ...existing.stats },
    };

    this.registry.set(agentName, upgraded);

    Logger.info(
      `[AgentMarketplace] Agent "${agentName}" upgraded to v${newManifest.version}`
    );

    this.emit('agent:upgraded', {
      agentName,
      previousVersion: existing.manifest.version,
      newVersion: newManifest.version,
      agent: this.registry.get(agentName)!,
    });

    return this.registry.get(agentName)!;
  }

  // ─── Enable / Disable ─────────────────────────────────────────────────────

  enable(agentName: string): void {
    const agent = this._requireAgent(agentName);

    if (agent.status === 'active') {
      Logger.warn(`[AgentMarketplace] Agent "${agentName}" is already active`);
      return;
    }

    const updated: InstalledAgent = {
      ...agent,
      status: 'active',
      errorMessage: undefined,
      updatedAt: new Date(),
    };

    this.registry.set(agentName, updated);

    Logger.info(`[AgentMarketplace] Agent "${agentName}" enabled`);
    this.emit('agent:enabled', { agentName, agent: this.registry.get(agentName)! });
  }

  disable(agentName: string): void {
    const agent = this._requireAgent(agentName);

    if (agent.status === 'disabled') {
      Logger.warn(`[AgentMarketplace] Agent "${agentName}" is already disabled`);
      return;
    }

    const updated: InstalledAgent = {
      ...agent,
      status: 'disabled',
      updatedAt: new Date(),
    };

    this.registry.set(agentName, updated);

    Logger.info(`[AgentMarketplace] Agent "${agentName}" disabled`);
    this.emit('agent:disabled', { agentName, agent: this.registry.get(agentName)! });
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  getAgent(agentName: string): InstalledAgent | undefined {
    return this.registry.get(agentName);
  }

  listAgents(filter?: AgentFilter): InstalledAgent[] {
    let agents = Array.from(this.registry.values());

    if (!filter) {
      return agents;
    }

    if (filter.status !== undefined) {
      agents = agents.filter((a) => a.status === filter.status);
    }

    if (filter.capability !== undefined) {
      const cap = filter.capability;
      agents = agents.filter((a) => a.manifest.capabilities.includes(cap));
    }

    if (filter.category !== undefined) {
      const cat = filter.category.toLowerCase();
      agents = agents.filter(
        (a) => a.manifest.metadata.category.toLowerCase() === cat
      );
    }

    return agents;
  }

  getStats(): MarketplaceStats {
    const all = Array.from(this.registry.values());
    return {
      total: all.length,
      active: all.filter((a) => a.status === 'active').length,
      disabled: all.filter((a) => a.status === 'disabled').length,
      totalCalls: all.reduce((sum, a) => sum + a.stats.calls, 0),
      totalErrors: all.reduce((sum, a) => sum + a.stats.errors, 0),
    };
  }

  // ─── Stats Recording ──────────────────────────────────────────────────────

  recordCall(agentName: string, latencyMs: number, isError: boolean): void {
    const agent = this.registry.get(agentName);
    if (!agent) return;

    const prev = agent.stats;
    const newCalls = prev.calls + 1;
    const newErrors = prev.errors + (isError ? 1 : 0);
    const newAvgLatency =
      prev.calls === 0
        ? latencyMs
        : (prev.avgLatency * prev.calls + latencyMs) / newCalls;

    this.registry.set(agentName, {
      ...agent,
      stats: {
        calls: newCalls,
        errors: newErrors,
        avgLatency: Math.round(newAvgLatency * 100) / 100,
      },
    });
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private _requireAgent(agentName: string): InstalledAgent {
    const agent = this.registry.get(agentName);
    if (!agent) {
      throw new Error(`Agent "${agentName}" is not installed`);
    }
    return agent;
  }

  private _validatePermissions(manifest: AgentManifest): void {
    const denied: Permission[] = [];
    const warnings: Permission[] = [];

    for (const permission of manifest.permissions) {
      const key = permissionKey(permission);
      const baseKey = `${permission.resource}:${permission.access}`;

      if (HIGH_RISK_PERMISSIONS.has(baseKey)) {
        warnings.push(permission);
        Logger.warn(
          `[AgentMarketplace] Agent "${manifest.name}" requests high-risk permission: ` +
            formatPermission(permission)
        );
      } else if (!ALLOWED_PERMISSIONS.has(baseKey)) {
        denied.push(permission);
      }

      Logger.debug(
        `[AgentMarketplace] Permission check "${manifest.name}": ${key} => allowed`
      );
    }

    if (denied.length > 0) {
      const list = denied.map(formatPermission).join(', ');
      throw new Error(
        `Agent "${manifest.name}" requests disallowed permissions: ${list}`
      );
    }

    if (warnings.length > 0) {
      Logger.warn(
        `[AgentMarketplace] Agent "${manifest.name}" has ${warnings.length} high-risk permission(s). ` +
          `Manual review recommended before enabling.`
      );
    }
  }

  private _assignSandboxId(name: string): string {
    const uuid = randomUUID();
    return `sandbox-${name}-${uuid}`;
  }
}
