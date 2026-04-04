import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import {
  parseManifest,
  isCompatibleWithPlatform,
  type AgentManifest,
} from "./AgentManifest.js";
import {
  AgentLoader,
  getAgentLoader,
  type LoadOptions,
} from "./AgentLoader.js";
import {
  AgentStore,
  getAgentStore,
  type CreateListingInput,
  type SearchFilters,
  type SearchResult,
} from "./AgentStore.js";
import type {
  MarketplaceAgent,
  ResourceAPI,
  CommunicationAPI,
  AgentContext,
  ExecutionResult,
} from "./AgentSDK.js";

const logger = pino({ name: "AgentMarketplace" });

export const PLATFORM_VERSION = process.env.PLATFORM_VERSION ?? "1.0.0";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InstallOptions {
  userId: string;
  /** Force reinstall even if already installed */
  force?: boolean;
  /** Override load options */
  loadOptions?: Partial<LoadOptions>;
}

export interface InstalledAgent {
  installId: string;
  agentId: string;
  listingId: string;
  userId: string;
  installedAt: number;
  lastUsedAt?: number;
  totalInvocations: number;
  totalTokensUsed: number;
  enabled: boolean;
}

export interface InvocationOptions {
  userId: string;
  sessionId?: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}

export interface PublishOptions {
  publisherId: string;
  bundleUrl: string;
  /** Raw manifest object — will be validated */
  rawManifest: unknown;
}

export interface DependencyResolution {
  resolved: AgentManifest[];
  missing: string[];
  conflicts: Array<{ dep: string; reason: string }>;
}

// ─── AgentMarketplace ─────────────────────────────────────────────────────────

export class AgentMarketplace extends EventEmitter {
  private readonly loader: AgentLoader;
  private readonly store: AgentStore;

  /** userId → Set<agentId> */
  private userInstalls = new Map<string, Map<string, InstalledAgent>>();
  /** agentId → Set<userId> */
  private agentUsers = new Map<string, Set<string>>();

  private resourceAPIs = new Map<string, ResourceAPI>();
  private communicationAPIs = new Map<string, CommunicationAPI>();

  constructor(
    loader?: AgentLoader,
    store?: AgentStore,
    private readonly platformVersion: string = PLATFORM_VERSION
  ) {
    super();
    this.loader = loader ?? getAgentLoader(platformVersion);
    this.store = store ?? getAgentStore();

    logger.info(
      { platformVersion: this.platformVersion },
      "[AgentMarketplace] Initialized"
    );
  }

  // ── Publishing ──────────────────────────────────────────────────────────────

  async publish(opts: PublishOptions): Promise<{ listingId: string; manifest: AgentManifest }> {
    logger.info({ publisherId: opts.publisherId }, "[AgentMarketplace] Publishing agent");

    // 1. Validate and parse the manifest
    const manifest = parseManifest(opts.rawManifest);

    // 2. Check platform compatibility
    if (!isCompatibleWithPlatform(manifest, this.platformVersion)) {
      throw new Error(
        `Agent '${manifest.id}' requires platform version '${manifest.platformVersionRange}', ` +
          `but current platform is '${this.platformVersion}'`
      );
    }

    // 3. Resolve and check agent dependencies
    const depResolution = await this.resolveDependencies(manifest);
    if (depResolution.missing.length > 0) {
      throw new Error(
        `Agent '${manifest.id}' has unresolved dependencies: ${depResolution.missing.join(", ")}`
      );
    }
    if (depResolution.conflicts.length > 0) {
      const details = depResolution.conflicts
        .map((c) => `${c.dep}: ${c.reason}`)
        .join("; ");
      throw new Error(
        `Agent '${manifest.id}' has dependency conflicts: ${details}`
      );
    }

    // 4. Create store listing (starts as 'pending' — requires admin approval)
    const listing = await this.store.createListing({
      manifest,
      publisherId: opts.publisherId,
      bundleUrl: opts.bundleUrl,
    });

    this.emit("agent:published", {
      listingId: listing.listingId,
      agentId: manifest.id,
      publisherId: opts.publisherId,
    });

    logger.info(
      { listingId: listing.listingId, agentId: manifest.id },
      "[AgentMarketplace] Agent published (pending review)"
    );

    return { listingId: listing.listingId, manifest };
  }

  // ── Installation ────────────────────────────────────────────────────────────

  async install(
    listingId: string,
    opts: InstallOptions,
    packagePath: string
  ): Promise<InstalledAgent> {
    const { userId, force = false } = opts;

    const listing = await this.store.getListing(listingId);
    if (!listing) throw new Error(`Listing '${listingId}' not found`);
    if (listing.status !== "active") {
      throw new Error(
        `Cannot install agent with listing status '${listing.status}'`
      );
    }

    const { manifest } = listing;

    // Check if already installed
    const userMap = this.userInstalls.get(userId);
    if (userMap?.has(manifest.id) && !force) {
      logger.info(
        { userId, agentId: manifest.id },
        "[AgentMarketplace] Agent already installed"
      );
      return userMap.get(manifest.id)!;
    }

    logger.info(
      { userId, agentId: manifest.id, listingId },
      "[AgentMarketplace] Installing agent"
    );

    // Load the agent module
    const loadOpts: LoadOptions = {
      packagePath,
      verifyChecksum: true,
      sandbox: manifest.permissions.level !== "admin",
      ...opts.loadOptions,
    };

    await this.loader.load(manifest, loadOpts);

    // Create install record
    const installed: InstalledAgent = {
      installId: randomUUID(),
      agentId: manifest.id,
      listingId,
      userId,
      installedAt: Date.now(),
      totalInvocations: 0,
      totalTokensUsed: 0,
      enabled: true,
    };

    if (!this.userInstalls.has(userId)) {
      this.userInstalls.set(userId, new Map());
    }
    this.userInstalls.get(userId)!.set(manifest.id, installed);

    if (!this.agentUsers.has(manifest.id)) {
      this.agentUsers.set(manifest.id, new Set());
    }
    this.agentUsers.get(manifest.id)!.add(userId);

    // Record install in store
    await this.store.recordInstall(listingId);

    this.emit("agent:installed", { installId: installed.installId, userId, agentId: manifest.id });
    logger.info(
      { installId: installed.installId, agentId: manifest.id },
      "[AgentMarketplace] Agent installed"
    );

    return installed;
  }

  async initializeAgent(
    agentId: string,
    userId: string,
    ctx: Partial<AgentContext>
  ): Promise<void> {
    const resources = this.getResourceAPI(agentId, userId);
    const comms = this.getCommunicationAPI(agentId);

    const fullCtx: AgentContext = {
      agentId,
      userId,
      sessionId: randomUUID(),
      locale: "en",
      permissions: this.getInstalledManifest(agentId, userId)!.permissions,
      metadata: {},
      ...ctx,
    };

    await this.loader.initialize(agentId, resources, comms, fullCtx);
    logger.info({ agentId, userId }, "[AgentMarketplace] Agent initialized");
  }

  async uninstall(agentId: string, userId: string): Promise<void> {
    const userMap = this.userInstalls.get(userId);
    if (!userMap?.has(agentId)) {
      logger.warn(
        { agentId, userId },
        "[AgentMarketplace] Uninstall called for non-installed agent"
      );
      return;
    }

    const installed = userMap.get(agentId)!;

    // Remove from user index
    userMap.delete(agentId);
    const userSet = this.agentUsers.get(agentId);
    userSet?.delete(userId);

    // Unload if no more users
    if (!userSet?.size) {
      await this.loader.unload(agentId);
    }

    // Record in store
    await this.store.recordUninstall(installed.listingId);

    this.emit("agent:uninstalled", { agentId, userId });
    logger.info({ agentId, userId }, "[AgentMarketplace] Agent uninstalled");
  }

  // ── Invocation ──────────────────────────────────────────────────────────────

  async invoke(
    agentId: string,
    input: unknown,
    opts: InvocationOptions
  ): Promise<ExecutionResult> {
    const { userId } = opts;

    const installed = this.getUserInstalled(userId, agentId);
    if (!installed) {
      throw new Error(`User '${userId}' has not installed agent '${agentId}'`);
    }
    if (!installed.enabled) {
      throw new Error(`Agent '${agentId}' is disabled for user '${userId}'`);
    }

    const loadedAgent = this.loader.getLoaded(agentId);
    if (!loadedAgent) {
      throw new Error(`Agent '${agentId}' is not loaded`);
    }

    const startMs = Date.now();

    const result = await loadedAgent.instance.run(input, {
      userId,
      sessionId: opts.sessionId ?? randomUUID(),
      conversationId: opts.conversationId,
      metadata: opts.metadata ?? {},
    });

    // Update usage stats
    const updated: InstalledAgent = {
      ...installed,
      lastUsedAt: Date.now(),
      totalInvocations: installed.totalInvocations + 1,
      totalTokensUsed: installed.totalTokensUsed + (result.tokensUsed ?? 0),
    };
    this.userInstalls.get(userId)?.set(agentId, updated);

    this.emit("agent:invoked", {
      agentId,
      userId,
      durationMs: Date.now() - startMs,
      success: result.success,
    });

    return result;
  }

  // ── Dependency resolution ────────────────────────────────────────────────────

  async resolveDependencies(manifest: AgentManifest): Promise<DependencyResolution> {
    const deps = manifest.agentDependencies;
    const resolved: AgentManifest[] = [];
    const missing: string[] = [];
    const conflicts: Array<{ dep: string; reason: string }> = [];

    for (const [depId] of Object.entries(deps)) {
      const listing = await this.store.getListingByAgentId(depId);
      if (!listing) {
        missing.push(depId);
        continue;
      }
      if (listing.status !== "active") {
        conflicts.push({
          dep: depId,
          reason: `Dependency '${depId}' exists but is not active (status: ${listing.status})`,
        });
        continue;
      }
      if (!isCompatibleWithPlatform(listing.manifest, this.platformVersion)) {
        conflicts.push({
          dep: depId,
          reason: `Dependency '${depId}' is incompatible with platform ${this.platformVersion}`,
        });
        continue;
      }
      resolved.push(listing.manifest);
    }

    return { resolved, missing, conflicts };
  }

  // ── Search & discovery ──────────────────────────────────────────────────────

  async search(filters: SearchFilters, page = 1, pageSize = 20): Promise<SearchResult> {
    return this.store.search(filters, page, pageSize);
  }

  async getFeatured() {
    return this.store.getFeatured();
  }

  async getTrending() {
    return this.store.getTrending();
  }

  getCategories() {
    return this.store.getCategories();
  }

  // ── Version management ──────────────────────────────────────────────────────

  async publishUpdate(
    listingId: string,
    opts: PublishOptions
  ): Promise<{ manifest: AgentManifest }> {
    const existing = await this.store.getListing(listingId);
    if (!existing) throw new Error(`Listing '${listingId}' not found`);

    const newManifest = parseManifest(opts.rawManifest);

    if (newManifest.id !== existing.manifest.id) {
      throw new Error(
        `Cannot change agent ID during update. ` +
          `Expected '${existing.manifest.id}', got '${newManifest.id}'`
      );
    }

    await this.store.updateListing(listingId, {
      bundleUrl: opts.bundleUrl,
      status: "pending",
    });

    // Reload active instances
    if (this.loader.isLoaded(newManifest.id)) {
      logger.info(
        { agentId: newManifest.id },
        "[AgentMarketplace] Reloading agent after update"
      );
      await this.loader.unload(newManifest.id);
    }

    this.emit("agent:updated", { listingId, agentId: newManifest.id });
    return { manifest: newManifest };
  }

  // ── User queries ─────────────────────────────────────────────────────────────

  getUserInstalled(userId: string, agentId: string): InstalledAgent | null {
    return this.userInstalls.get(userId)?.get(agentId) ?? null;
  }

  listUserAgents(userId: string): InstalledAgent[] {
    return Array.from(this.userInstalls.get(userId)?.values() ?? []);
  }

  // ── Resource / communication API hooks ────────────────────────────────────────

  registerResourceAPI(agentId: string, api: ResourceAPI): void {
    this.resourceAPIs.set(agentId, api);
  }

  registerCommunicationAPI(agentId: string, api: CommunicationAPI): void {
    this.communicationAPIs.set(agentId, api);
  }

  private getResourceAPI(agentId: string, _userId: string): ResourceAPI {
    const api = this.resourceAPIs.get(agentId);
    if (!api) throw new Error(`No ResourceAPI registered for agent '${agentId}'`);
    return api;
  }

  private getCommunicationAPI(agentId: string): CommunicationAPI {
    const api = this.communicationAPIs.get(agentId);
    if (!api)
      throw new Error(`No CommunicationAPI registered for agent '${agentId}'`);
    return api;
  }

  private getInstalledManifest(
    agentId: string,
    userId: string
  ): AgentManifest | null {
    const installed = this.getUserInstalled(userId, agentId);
    if (!installed) return null;
    return (
      this.loader.getLoaded(agentId)?.manifest ?? null
    );
  }

  // ── Health ────────────────────────────────────────────────────────────────────

  async healthCheck() {
    const loadedAgents = this.loader.listLoaded();
    const storeStats = this.store.getStats();

    return {
      healthy: true,
      loadedAgents: loadedAgents.length,
      storeStats,
      platformVersion: this.platformVersion,
    };
  }

  getLoadedAgent(agentId: string): MarketplaceAgent | undefined {
    return this.loader.getLoaded(agentId)?.instance;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────
let _marketplace: AgentMarketplace | null = null;
export function getAgentMarketplace(): AgentMarketplace {
  if (!_marketplace) _marketplace = new AgentMarketplace();
  return _marketplace;
}
