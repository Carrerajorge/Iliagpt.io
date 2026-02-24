/* ------------------------------------------------------------------ *
 *  connectorCapabilityNegotiator.ts — Capability discovery, version
 *  negotiation, plan-based feature gating, and routing.
 *  Standalone module — no imports from other kernel files.
 * ------------------------------------------------------------------ */

// ─── Types ──────────────────────────────────────────────────────────

export type CapabilityStatus =
  | 'available'
  | 'unavailable'
  | 'deprecated'
  | 'beta'
  | 'degraded'
  | 'maintenance';

export interface CapabilityInfo {
  id: string;
  name: string;
  description: string;
  status: CapabilityStatus;
  version: string;
  connectorId: string;
  deprecated: boolean;
  deprecatedBy: string | null;
  betaOptIn: boolean;
  requiredPlan: PlanTier;
  tags: string[];
  metadata: Record<string, string>;
  addedAt: number;
  updatedAt: number;
}

export interface CapabilityProbe {
  capabilityId: string;
  connectorId: string;
  success: boolean;
  latencyMs: number;
  timestamp: number;
  errorMessage: string | null;
}

export interface NegotiationResult {
  requested: string;
  resolved: string | null;
  version: string | null;
  status: CapabilityStatus | null;
  strategy:
    | 'direct'
    | 'deprecated_replacement'
    | 'version_mapping'
    | 'beta_fallback'
    | 'degraded'
    | 'not_found';
  confidence: number;
  warnings: string[];
}

export interface CompatibilityMatrix {
  connectorId: string;
  capabilities: Map<string, CapabilityInfo>;
  versionMappings: Map<string, Map<string, string>>; // capId → oldVersion → newCapId
  deprecationMap: Map<string, string>; // oldCapId → newCapId
}

export interface CapabilityDiff {
  added: CapabilityInfo[];
  removed: CapabilityInfo[];
  changed: Array<{
    capability: string;
    field: string;
    oldValue: string;
    newValue: string;
  }>;
  deprecated: CapabilityInfo[];
}

export type PlanTier = 'free' | 'starter' | 'professional' | 'enterprise';

export interface FeatureGate {
  capabilityId: string;
  minimumPlan: PlanTier;
  usageLimitPerHour: number;
  usageLimitPerDay: number;
  requiresBetaOptIn: boolean;
  metadata: Record<string, string>;
}

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  rank: number; // higher = more access
  capabilityOverrides: Map<string, Partial<FeatureGate>>;
  globalHourlyLimit: number;
  globalDailyLimit: number;
}

// ─── Helpers ────────────────────────────────────────────────────────

const PLAN_RANK: Record<PlanTier, number> = {
  free: 0,
  starter: 1,
  professional: 2,
  enterprise: 3,
};

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

// ─── CapabilityRegistry ─────────────────────────────────────────────

export class CapabilityRegistry {
  private matrices: Map<string, CompatibilityMatrix> = new Map();
  private probeHistory: Map<string, CapabilityProbe[]> = new Map();
  private readonly maxProbeHistory: number = 100;

  /* ── registerMatrix ───────────────────────────────────────────── */

  registerMatrix(
    connectorId: string,
    capabilities: CapabilityInfo[],
    versionMappings?: Map<string, Map<string, string>>,
    deprecationMap?: Map<string, string>,
  ): CompatibilityMatrix {
    const capMap = new Map<string, CapabilityInfo>();
    for (const cap of capabilities) {
      capMap.set(cap.id, { ...cap, connectorId });
    }
    const matrix: CompatibilityMatrix = {
      connectorId,
      capabilities: capMap,
      versionMappings: versionMappings ?? new Map(),
      deprecationMap: deprecationMap ?? new Map(),
    };
    this.matrices.set(connectorId, matrix);
    return matrix;
  }

  /* ── getCapability ────────────────────────────────────────────── */

  getCapability(
    connectorId: string,
    capabilityId: string,
  ): CapabilityInfo | null {
    const matrix = this.matrices.get(connectorId);
    if (!matrix) return null;
    return matrix.capabilities.get(capabilityId) ?? null;
  }

  /* ── isAvailable ──────────────────────────────────────────────── */

  isAvailable(connectorId: string, capabilityId: string): boolean {
    const cap = this.getCapability(connectorId, capabilityId);
    if (!cap) return false;
    return cap.status === 'available' || cap.status === 'beta' || cap.status === 'degraded';
  }

  /* ── recordProbe ──────────────────────────────────────────────── */

  recordProbe(probe: CapabilityProbe): void {
    const key = `${probe.connectorId}::${probe.capabilityId}`;
    let history = this.probeHistory.get(key);
    if (!history) {
      history = [];
      this.probeHistory.set(key, history);
    }
    history.push(probe);
    if (history.length > this.maxProbeHistory) {
      history.shift();
    }

    // Auto-update capability status based on probe results
    const cap = this.getCapability(probe.connectorId, probe.capabilityId);
    if (cap) {
      const recent = history.slice(-10);
      const failRate = recent.filter((p) => !p.success).length / recent.length;
      if (failRate >= 0.8 && cap.status === 'available') {
        cap.status = 'degraded';
        cap.updatedAt = Date.now();
      } else if (failRate < 0.2 && cap.status === 'degraded') {
        cap.status = 'available';
        cap.updatedAt = Date.now();
      }
    }
  }

  /* ── getAvailabilityRate ──────────────────────────────────────── */

  getAvailabilityRate(
    connectorId: string,
    capabilityId: string,
    windowMs: number = 3600000,
  ): number {
    const key = `${connectorId}::${capabilityId}`;
    const history = this.probeHistory.get(key);
    if (!history || history.length === 0) return 1;

    const cutoff = Date.now() - windowMs;
    const recent = history.filter((p) => p.timestamp >= cutoff);
    if (recent.length === 0) return 1;

    return recent.filter((p) => p.success).length / recent.length;
  }

  /* ── diffCapabilities ─────────────────────────────────────────── */

  diffCapabilities(
    connectorId: string,
    newCapabilities: CapabilityInfo[],
  ): CapabilityDiff {
    const matrix = this.matrices.get(connectorId);
    const oldCaps = matrix ? matrix.capabilities : new Map<string, CapabilityInfo>();
    const newCapsMap = new Map<string, CapabilityInfo>();
    for (const cap of newCapabilities) {
      newCapsMap.set(cap.id, cap);
    }

    const added: CapabilityInfo[] = [];
    const removed: CapabilityInfo[] = [];
    const changed: Array<{ capability: string; field: string; oldValue: string; newValue: string }> = [];
    const deprecated: CapabilityInfo[] = [];

    // Find added & changed
    for (const [id, newCap] of Array.from(newCapsMap.entries())) {
      const oldCap = oldCaps.get(id);
      if (!oldCap) {
        added.push(newCap);
        continue;
      }
      if (oldCap.status !== newCap.status) {
        changed.push({ capability: id, field: 'status', oldValue: oldCap.status, newValue: newCap.status });
      }
      if (oldCap.version !== newCap.version) {
        changed.push({ capability: id, field: 'version', oldValue: oldCap.version, newValue: newCap.version });
      }
      if (oldCap.description !== newCap.description) {
        changed.push({ capability: id, field: 'description', oldValue: oldCap.description, newValue: newCap.description });
      }
      if (!oldCap.deprecated && newCap.deprecated) {
        deprecated.push(newCap);
      }
    }

    // Find removed
    for (const [id, oldCap] of Array.from(oldCaps.entries())) {
      if (!newCapsMap.has(id)) {
        removed.push(oldCap);
      }
    }

    return { added, removed, changed, deprecated };
  }

  /* ── getMatrix ────────────────────────────────────────────────── */

  getMatrix(connectorId: string): CompatibilityMatrix | null {
    return this.matrices.get(connectorId) ?? null;
  }

  /* ── getAllConnectors ──────────────────────────────────────────── */

  getAllConnectors(): string[] {
    return Array.from(this.matrices.keys());
  }

  /* ── getCapabilitiesForConnector ──────────────────────────────── */

  getCapabilitiesForConnector(connectorId: string): CapabilityInfo[] {
    const matrix = this.matrices.get(connectorId);
    if (!matrix) return [];
    return Array.from(matrix.capabilities.values());
  }

  /* ── clear ────────────────────────────────────────────────────── */

  clear(): void {
    this.matrices.clear();
    this.probeHistory.clear();
  }
}

// ─── VersionNegotiator ──────────────────────────────────────────────

export class VersionNegotiator {
  private versionMappings: Map<string, Map<string, string>> = new Map();
  private registry: CapabilityRegistry;

  constructor(registry: CapabilityRegistry) {
    this.registry = registry;
  }

  /* ── registerMapping ──────────────────────────────────────────── */

  registerMapping(
    connectorId: string,
    oldCapabilityId: string,
    newCapabilityId: string,
    fromVersion: string = '*',
  ): void {
    const key = `${connectorId}::${oldCapabilityId}`;
    let map = this.versionMappings.get(key);
    if (!map) {
      map = new Map();
      this.versionMappings.set(key, map);
    }
    map.set(fromVersion, newCapabilityId);
  }

  /* ── negotiate ────────────────────────────────────────────────── */

  negotiate(
    connectorId: string,
    capabilityId: string,
    preferredVersion?: string,
  ): NegotiationResult {
    const result: NegotiationResult = {
      requested: capabilityId,
      resolved: null,
      version: null,
      status: null,
      strategy: 'not_found',
      confidence: 0,
      warnings: [],
    };

    // 1. Direct match
    const directCap = this.registry.getCapability(connectorId, capabilityId);
    if (directCap && directCap.status === 'available') {
      if (!preferredVersion || compareSemver(directCap.version, preferredVersion) >= 0) {
        result.resolved = directCap.id;
        result.version = directCap.version;
        result.status = directCap.status;
        result.strategy = 'direct';
        result.confidence = 1.0;
        return result;
      }
    }

    // 2. Deprecated replacement
    const matrix = this.registry.getMatrix(connectorId);
    if (matrix) {
      const replacement = matrix.deprecationMap.get(capabilityId);
      if (replacement) {
        const replacementCap = this.registry.getCapability(connectorId, replacement);
        if (replacementCap && (replacementCap.status === 'available' || replacementCap.status === 'beta')) {
          result.resolved = replacementCap.id;
          result.version = replacementCap.version;
          result.status = replacementCap.status;
          result.strategy = 'deprecated_replacement';
          result.confidence = 0.85;
          result.warnings.push(
            `Capability "${capabilityId}" is deprecated; using replacement "${replacement}"`,
          );
          return result;
        }
      }
    }

    // 3. Version mapping
    const mappingKey = `${connectorId}::${capabilityId}`;
    const mappings = this.versionMappings.get(mappingKey);
    if (mappings) {
      const targetVersion = preferredVersion ?? '*';
      let mapped = mappings.get(targetVersion);
      if (!mapped) {
        mapped = mappings.get('*');
      }
      if (mapped) {
        const mappedCap = this.registry.getCapability(connectorId, mapped);
        if (mappedCap) {
          result.resolved = mappedCap.id;
          result.version = mappedCap.version;
          result.status = mappedCap.status;
          result.strategy = 'version_mapping';
          result.confidence = 0.75;
          result.warnings.push(
            `Resolved via version mapping: "${capabilityId}" → "${mapped}"`,
          );
          return result;
        }
      }
    }

    // 4. Beta fallback
    if (directCap && directCap.status === 'beta') {
      result.resolved = directCap.id;
      result.version = directCap.version;
      result.status = directCap.status;
      result.strategy = 'beta_fallback';
      result.confidence = 0.6;
      result.warnings.push(
        `Capability "${capabilityId}" is in beta — behavior may change`,
      );
      return result;
    }

    // 5. Degraded fallback
    if (directCap && directCap.status === 'degraded') {
      result.resolved = directCap.id;
      result.version = directCap.version;
      result.status = directCap.status;
      result.strategy = 'degraded';
      result.confidence = 0.4;
      result.warnings.push(
        `Capability "${capabilityId}" is degraded — performance may be affected`,
      );
      return result;
    }

    // 6. Not found
    result.strategy = 'not_found';
    result.confidence = 0;
    result.warnings.push(
      `Capability "${capabilityId}" not found for connector "${connectorId}"`,
    );
    return result;
  }

  /* ── negotiateBulk ────────────────────────────────────────────── */

  negotiateBulk(
    connectorId: string,
    capabilityIds: string[],
  ): NegotiationResult[] {
    return capabilityIds.map((id) => this.negotiate(connectorId, id));
  }

  /* ── clear ────────────────────────────────────────────────────── */

  clear(): void {
    this.versionMappings.clear();
  }
}

// ─── PlanGatekeeper ─────────────────────────────────────────────────

export class PlanGatekeeper {
  private plans: Map<PlanTier, PlanDefinition> = new Map();
  private featureGates: Map<string, FeatureGate> = new Map();
  private userPlans: Map<string, PlanTier> = new Map();
  private usageCounters: Map<string, { hourly: number; daily: number; hourReset: number; dayReset: number }> = new Map();

  /* ── registerPlan ─────────────────────────────────────────────── */

  registerPlan(plan: PlanDefinition): void {
    this.plans.set(plan.tier, plan);
  }

  /* ── registerGate ─────────────────────────────────────────────── */

  registerGate(gate: FeatureGate): void {
    this.featureGates.set(gate.capabilityId, gate);
  }

  /* ── setUserPlan ──────────────────────────────────────────────── */

  setUserPlan(userId: string, plan: PlanTier): void {
    this.userPlans.set(userId, plan);
  }

  /* ── getUserPlan ──────────────────────────────────────────────── */

  getUserPlan(userId: string): PlanTier {
    return this.userPlans.get(userId) ?? 'free';
  }

  /* ── canAccess ────────────────────────────────────────────────── */

  canAccess(
    userId: string,
    capabilityId: string,
  ): {
    allowed: boolean;
    reason: string;
    remainingHourly: number;
    remainingDaily: number;
  } {
    const userPlan = this.getUserPlan(userId);
    const userRank = PLAN_RANK[userPlan];
    const gate = this.featureGates.get(capabilityId);

    if (!gate) {
      // No gate = available to all
      return { allowed: true, reason: 'No gate defined', remainingHourly: -1, remainingDaily: -1 };
    }

    // Plan check
    const requiredRank = PLAN_RANK[gate.minimumPlan];
    if (userRank < requiredRank) {
      return {
        allowed: false,
        reason: `Requires "${gate.minimumPlan}" plan (current: "${userPlan}")`,
        remainingHourly: 0,
        remainingDaily: 0,
      };
    }

    // Beta opt-in check
    if (gate.requiresBetaOptIn) {
      // For simplicity, enterprise plan auto-opts-in
      if (userPlan !== 'enterprise') {
        return {
          allowed: false,
          reason: 'Requires beta opt-in (enterprise plan auto-opts-in)',
          remainingHourly: 0,
          remainingDaily: 0,
        };
      }
    }

    // Usage limits
    const plan = this.plans.get(userPlan);
    const hourlyLimit = plan?.capabilityOverrides.get(capabilityId)?.usageLimitPerHour ?? gate.usageLimitPerHour;
    const dailyLimit = plan?.capabilityOverrides.get(capabilityId)?.usageLimitPerDay ?? gate.usageLimitPerDay;

    const counterKey = `${userId}::${capabilityId}`;
    const counter = this.getOrCreateCounter(counterKey);

    const now = Date.now();
    // Reset hourly counter
    if (now - counter.hourReset >= 3600000) {
      counter.hourly = 0;
      counter.hourReset = now;
    }
    // Reset daily counter
    if (now - counter.dayReset >= 86400000) {
      counter.daily = 0;
      counter.dayReset = now;
    }

    if (hourlyLimit > 0 && counter.hourly >= hourlyLimit) {
      return {
        allowed: false,
        reason: `Hourly limit reached (${hourlyLimit}/hr)`,
        remainingHourly: 0,
        remainingDaily: Math.max(0, dailyLimit - counter.daily),
      };
    }

    if (dailyLimit > 0 && counter.daily >= dailyLimit) {
      return {
        allowed: false,
        reason: `Daily limit reached (${dailyLimit}/day)`,
        remainingHourly: Math.max(0, hourlyLimit - counter.hourly),
        remainingDaily: 0,
      };
    }

    // Increment counters
    counter.hourly++;
    counter.daily++;

    return {
      allowed: true,
      reason: 'Access granted',
      remainingHourly: hourlyLimit > 0 ? Math.max(0, hourlyLimit - counter.hourly) : -1,
      remainingDaily: dailyLimit > 0 ? Math.max(0, dailyLimit - counter.daily) : -1,
    };
  }

  /* ── getAvailableCapabilities ─────────────────────────────────── */

  getAvailableCapabilities(userId: string): string[] {
    const userPlan = this.getUserPlan(userId);
    const userRank = PLAN_RANK[userPlan];
    const available: string[] = [];

    for (const [capId, gate] of Array.from(this.featureGates.entries())) {
      const requiredRank = PLAN_RANK[gate.minimumPlan];
      if (userRank >= requiredRank) {
        if (!gate.requiresBetaOptIn || userPlan === 'enterprise') {
          available.push(capId);
        }
      }
    }

    return available;
  }

  /* ── getAllGates ───────────────────────────────────────────────── */

  getAllGates(): FeatureGate[] {
    return Array.from(this.featureGates.values());
  }

  /* ── getAllPlans ───────────────────────────────────────────────── */

  getAllPlans(): PlanDefinition[] {
    return Array.from(this.plans.values()).sort((a, b) => a.rank - b.rank);
  }

  /* ── clear ────────────────────────────────────────────────────── */

  clear(): void {
    this.plans.clear();
    this.featureGates.clear();
    this.userPlans.clear();
    this.usageCounters.clear();
  }

  /* ── internal ─────────────────────────────────────────────────── */

  private getOrCreateCounter(key: string) {
    let counter = this.usageCounters.get(key);
    if (!counter) {
      counter = { hourly: 0, daily: 0, hourReset: Date.now(), dayReset: Date.now() };
      this.usageCounters.set(key, counter);
    }
    return counter;
  }
}

// ─── CapabilityRouter ───────────────────────────────────────────────

export class CapabilityRouter {
  private registry: CapabilityRegistry;
  private negotiator: VersionNegotiator;
  private gatekeeper: PlanGatekeeper;

  constructor(
    registry: CapabilityRegistry,
    negotiator: VersionNegotiator,
    gatekeeper: PlanGatekeeper,
  ) {
    this.registry = registry;
    this.negotiator = negotiator;
    this.gatekeeper = gatekeeper;
  }

  /* ── route ────────────────────────────────────────────────────── */

  route(
    connectorId: string,
    capabilityId: string,
    userId: string,
    preferredVersion?: string,
  ): {
    allowed: boolean;
    resolved: NegotiationResult;
    gateResult: { allowed: boolean; reason: string; remainingHourly: number; remainingDaily: number };
    warnings: string[];
  } {
    const warnings: string[] = [];

    // Step 1: Negotiate capability
    const negotiation = this.negotiator.negotiate(
      connectorId,
      capabilityId,
      preferredVersion,
    );
    warnings.push(...negotiation.warnings);

    if (negotiation.strategy === 'not_found') {
      return {
        allowed: false,
        resolved: negotiation,
        gateResult: {
          allowed: false,
          reason: 'Capability not found',
          remainingHourly: 0,
          remainingDaily: 0,
        },
        warnings,
      };
    }

    // Step 2: Gate check on the resolved capability
    const resolvedId = negotiation.resolved ?? capabilityId;
    const gateResult = this.gatekeeper.canAccess(userId, resolvedId);

    if (!gateResult.allowed) {
      warnings.push(`Gate denied: ${gateResult.reason}`);
    }

    return {
      allowed: gateResult.allowed,
      resolved: negotiation,
      gateResult,
      warnings,
    };
  }

  /* ── routeBulk ────────────────────────────────────────────────── */

  routeBulk(
    connectorId: string,
    capabilityIds: string[],
    userId: string,
  ): Array<{
    capabilityId: string;
    allowed: boolean;
    resolved: NegotiationResult;
    warnings: string[];
  }> {
    return capabilityIds.map((id) => {
      const r = this.route(connectorId, id, userId);
      return { capabilityId: id, allowed: r.allowed, resolved: r.resolved, warnings: r.warnings };
    });
  }

  /* ── findBestConnector ────────────────────────────────────────── */

  findBestConnector(
    capabilityId: string,
    userId: string,
  ): {
    connectorId: string;
    negotiation: NegotiationResult;
  } | null {
    const connectors = this.registry.getAllConnectors();
    let bestConnector: string | null = null;
    let bestNegotiation: NegotiationResult | null = null;
    let bestConfidence = -1;

    for (const cid of connectors) {
      const negotiation = this.negotiator.negotiate(cid, capabilityId);
      if (negotiation.strategy === 'not_found') continue;

      const gate = this.gatekeeper.canAccess(userId, negotiation.resolved ?? capabilityId);
      if (!gate.allowed) continue;

      if (negotiation.confidence > bestConfidence) {
        bestConfidence = negotiation.confidence;
        bestConnector = cid;
        bestNegotiation = negotiation;
      }
    }

    if (bestConnector && bestNegotiation) {
      return { connectorId: bestConnector, negotiation: bestNegotiation };
    }
    return null;
  }
}

// ─── DEFAULT_PLANS ──────────────────────────────────────────────────

export const DEFAULT_PLANS: PlanDefinition[] = [
  {
    tier: 'free',
    name: 'Free',
    rank: 0,
    capabilityOverrides: new Map(),
    globalHourlyLimit: 100,
    globalDailyLimit: 500,
  },
  {
    tier: 'starter',
    name: 'Starter',
    rank: 1,
    capabilityOverrides: new Map(),
    globalHourlyLimit: 500,
    globalDailyLimit: 5000,
  },
  {
    tier: 'professional',
    name: 'Professional',
    rank: 2,
    capabilityOverrides: new Map(),
    globalHourlyLimit: 2000,
    globalDailyLimit: 20000,
  },
  {
    tier: 'enterprise',
    name: 'Enterprise',
    rank: 3,
    capabilityOverrides: new Map(),
    globalHourlyLimit: 0, // unlimited
    globalDailyLimit: 0,  // unlimited
  },
];

// ─── Singletons ─────────────────────────────────────────────────────

export const capabilityRegistry = new CapabilityRegistry();
export const versionNegotiator = new VersionNegotiator(capabilityRegistry);
export const planGatekeeper = new PlanGatekeeper();

// Register default plans
for (const plan of DEFAULT_PLANS) {
  planGatekeeper.registerPlan(plan);
}

export const capabilityRouter = new CapabilityRouter(
  capabilityRegistry,
  versionNegotiator,
  planGatekeeper,
);
