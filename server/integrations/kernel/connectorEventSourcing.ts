/**
 * connectorEventSourcing.ts
 *
 * Sophisticated event sourcing and replay engine for the Integration Kernel.
 * Provides full audit trail, time-travel debugging, projections, compaction,
 * and an event bus with dead-letter queue.
 *
 * Standalone module — no imports from other kernel files.
 */

/* ------------------------------------------------------------------ */
/*  Core Types                                                        */
/* ------------------------------------------------------------------ */

export interface ConnectorDomainEvent {
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  version: number;
  timestamp: number;
  userId: string;
  connectorId: string;
  operationId: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  causationId?: string;
  correlationId?: string;
}

export interface EventStream {
  streamId: string;
  events: ConnectorDomainEvent[];
  version: number;
  createdAt: number;
  lastEventAt: number;
}

export interface Snapshot<T> {
  aggregateId: string;
  aggregateType: string;
  version: number;
  state: T;
  timestamp: number;
}

export interface EventFilter {
  connectorId?: string;
  operationId?: string;
  userId?: string;
  eventType?: string;
  since?: number;
  until?: number;
  limit?: number;
}

export interface ReplayResult {
  eventsReplayed: number;
  finalState: unknown;
  errors: Array<{ eventId: string; error: string }>;
  durationMs: number;
}

export interface ProjectionDefinition<T> {
  id: string;
  name: string;
  initialState: T;
  reducer: (state: T, event: ConnectorDomainEvent) => T;
}

export interface ProjectionState<T> {
  projectionId: string;
  currentState: T;
  lastEventVersion: number;
  lastUpdated: number;
}

export interface EventSubscription {
  id: string;
  filter: EventFilter;
  handler: (event: ConnectorDomainEvent) => void | Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Built-in Event Type Constants                                     */
/* ------------------------------------------------------------------ */

export const CONNECTOR_OPERATION_STARTED   = 'CONNECTOR_OPERATION_STARTED';
export const CONNECTOR_OPERATION_COMPLETED = 'CONNECTOR_OPERATION_COMPLETED';
export const CONNECTOR_OPERATION_FAILED    = 'CONNECTOR_OPERATION_FAILED';
export const CONNECTOR_CREDENTIAL_REFRESHED = 'CONNECTOR_CREDENTIAL_REFRESHED';
export const CONNECTOR_CREDENTIAL_REVOKED  = 'CONNECTOR_CREDENTIAL_REVOKED';
export const CONNECTOR_CIRCUIT_OPENED      = 'CONNECTOR_CIRCUIT_OPENED';
export const CONNECTOR_CIRCUIT_CLOSED      = 'CONNECTOR_CIRCUIT_CLOSED';
export const CONNECTOR_CONFIG_CHANGED      = 'CONNECTOR_CONFIG_CHANGED';
export const CONNECTOR_RATE_LIMITED        = 'CONNECTOR_RATE_LIMITED';
export const CONNECTOR_SLA_VIOLATED        = 'CONNECTOR_SLA_VIOLATED';
export const CONNECTOR_HEALTH_CHANGED      = 'CONNECTOR_HEALTH_CHANGED';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

let _idCounter = 0;

function generateEventId(): string {
  _idCounter += 1;
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${_idCounter}-${rand}`;
}

function generateSubscriptionId(): string {
  return `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function matchesFilter(event: ConnectorDomainEvent, filter: EventFilter): boolean {
  if (filter.connectorId !== undefined && event.connectorId !== filter.connectorId) {
    return false;
  }
  if (filter.operationId !== undefined && event.operationId !== filter.operationId) {
    return false;
  }
  if (filter.userId !== undefined && event.userId !== filter.userId) {
    return false;
  }
  if (filter.eventType !== undefined && event.eventType !== filter.eventType) {
    return false;
  }
  if (filter.since !== undefined && event.timestamp < filter.since) {
    return false;
  }
  if (filter.until !== undefined && event.timestamp > filter.until) {
    return false;
  }
  return true;
}

function deepClone<T>(value: T): T {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/* ------------------------------------------------------------------ */
/*  EventStore                                                        */
/* ------------------------------------------------------------------ */

export class EventStore {
  private readonly maxEvents: number;
  private readonly streams: Map<string, EventStream>;
  private readonly globalLog: ConnectorDomainEvent[];
  private readonly streamAccessOrder: string[];

  constructor(maxEvents: number = 50_000) {
    this.maxEvents = maxEvents;
    this.streams = new Map();
    this.globalLog = [];
    this.streamAccessOrder = [];
  }

  /** Append a single event, assigning eventId and version via optimistic concurrency. */
  append(
    partial: Omit<ConnectorDomainEvent, 'eventId' | 'version'>
  ): ConnectorDomainEvent {
    const aggregateId = partial.aggregateId;
    const stream = this.streams.get(aggregateId);
    const expectedVersion = stream ? stream.version : 0;

    const event: ConnectorDomainEvent = {
      ...partial,
      eventId: generateEventId(),
      version: expectedVersion + 1,
    };

    this.storeEvent(event);
    return deepClone(event);
  }

  /** Append a batch of events atomically for the same or different aggregates. */
  appendBatch(
    partials: Array<Omit<ConnectorDomainEvent, 'eventId' | 'version'>>
  ): ConnectorDomainEvent[] {
    if (partials.length === 0) return [];

    const versionTracker = new Map<string, number>();
    const events: ConnectorDomainEvent[] = [];

    for (const partial of partials) {
      const aggId = partial.aggregateId;
      let currentVersion = versionTracker.get(aggId);
      if (currentVersion === undefined) {
        const stream = this.streams.get(aggId);
        currentVersion = stream ? stream.version : 0;
      }
      const nextVersion = currentVersion + 1;
      versionTracker.set(aggId, nextVersion);

      const event: ConnectorDomainEvent = {
        ...partial,
        eventId: generateEventId(),
        version: nextVersion,
      };
      events.push(event);
    }

    for (const event of events) {
      this.storeEvent(event);
    }

    return events.map((e) => deepClone(e));
  }

  /** Retrieve the full event stream for an aggregate. */
  getStream(aggregateId: string): EventStream {
    const stream = this.streams.get(aggregateId);
    if (!stream) {
      return {
        streamId: aggregateId,
        events: [],
        version: 0,
        createdAt: 0,
        lastEventAt: 0,
      };
    }
    this.touchStreamAccess(aggregateId);
    return deepClone(stream);
  }

  /** Query events matching the given filter. */
  getEvents(filter: EventFilter): ConnectorDomainEvent[] {
    const results: ConnectorDomainEvent[] = [];
    const limit = filter.limit ?? Number.MAX_SAFE_INTEGER;

    for (const event of this.globalLog) {
      if (results.length >= limit) break;
      if (matchesFilter(event, filter)) {
        results.push(deepClone(event));
      }
    }

    return results;
  }

  /** Get all events of a specific type across all streams. */
  getEventsByType(eventType: string): ConnectorDomainEvent[] {
    const results: ConnectorDomainEvent[] = [];
    for (const event of this.globalLog) {
      if (event.eventType === eventType) {
        results.push(deepClone(event));
      }
    }
    return results;
  }

  /** Total number of events in the store. */
  getEventCount(): number {
    return this.globalLog.length;
  }

  /** Latest version number for an aggregate (0 if no stream exists). */
  getLatestVersion(aggregateId: string): number {
    const stream = this.streams.get(aggregateId);
    return stream ? stream.version : 0;
  }

  /** Return all known aggregate IDs. */
  getAggregateIds(): string[] {
    return Array.from(this.streams.keys());
  }

  /** Return raw events for an aggregate (no deep clone — internal use). */
  getRawStreamEvents(aggregateId: string): ConnectorDomainEvent[] {
    const stream = this.streams.get(aggregateId);
    return stream ? stream.events : [];
  }

  /** Remove events from a stream up to a given version (used by compaction). */
  removeEventsUpTo(aggregateId: string, upToVersion: number): number {
    const stream = this.streams.get(aggregateId);
    if (!stream) return 0;

    const before = stream.events.length;
    const kept: ConnectorDomainEvent[] = [];
    const removedIds = new Set<string>();

    for (const event of stream.events) {
      if (event.version <= upToVersion) {
        removedIds.add(event.eventId);
      } else {
        kept.push(event);
      }
    }

    stream.events = kept;
    stream.version = kept.length > 0 ? kept[kept.length - 1].version : 0;
    if (kept.length > 0) {
      stream.lastEventAt = kept[kept.length - 1].timestamp;
    }

    // Also remove from global log
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.globalLog.length; readIndex++) {
      if (!removedIds.has(this.globalLog[readIndex].eventId)) {
        this.globalLog[writeIndex] = this.globalLog[readIndex];
        writeIndex++;
      }
    }
    this.globalLog.length = writeIndex;

    if (stream.events.length === 0) {
      this.streams.delete(aggregateId);
      const accessIdx = this.streamAccessOrder.indexOf(aggregateId);
      if (accessIdx !== -1) {
        this.streamAccessOrder.splice(accessIdx, 1);
      }
    }

    return before - kept.length;
  }

  /* ---- Private helpers ---- */

  private storeEvent(event: ConnectorDomainEvent): void {
    const aggId = event.aggregateId;
    let stream = this.streams.get(aggId);

    if (!stream) {
      stream = {
        streamId: aggId,
        events: [],
        version: 0,
        createdAt: event.timestamp,
        lastEventAt: event.timestamp,
      };
      this.streams.set(aggId, stream);
    }

    // Optimistic concurrency: version must be exactly previous + 1
    if (event.version !== stream.version + 1) {
      throw new Error(
        `Concurrency conflict on aggregate ${aggId}: expected version ${stream.version + 1}, got ${event.version}`
      );
    }

    stream.events.push(event);
    stream.version = event.version;
    stream.lastEventAt = event.timestamp;

    this.globalLog.push(event);
    this.touchStreamAccess(aggId);

    // Ring-buffer eviction
    this.enforceMaxEvents();
  }

  private touchStreamAccess(aggregateId: string): void {
    const idx = this.streamAccessOrder.indexOf(aggregateId);
    if (idx !== -1) {
      this.streamAccessOrder.splice(idx, 1);
    }
    this.streamAccessOrder.push(aggregateId);
  }

  private enforceMaxEvents(): void {
    while (this.globalLog.length > this.maxEvents && this.streamAccessOrder.length > 1) {
      // Evict the least-recently-used stream
      const oldestStreamId = this.streamAccessOrder[0];
      if (!oldestStreamId) break;

      const stream = this.streams.get(oldestStreamId);
      if (!stream) {
        this.streamAccessOrder.shift();
        continue;
      }

      const evictedIds = new Set<string>();
      for (const evt of stream.events) {
        evictedIds.add(evt.eventId);
      }

      // Remove from global log
      let writeIdx = 0;
      for (let readIdx = 0; readIdx < this.globalLog.length; readIdx++) {
        if (!evictedIds.has(this.globalLog[readIdx].eventId)) {
          this.globalLog[writeIdx] = this.globalLog[readIdx];
          writeIdx++;
        }
      }
      this.globalLog.length = writeIdx;

      this.streams.delete(oldestStreamId);
      this.streamAccessOrder.shift();

      if (this.globalLog.length <= this.maxEvents) break;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  SnapshotStore                                                     */
/* ------------------------------------------------------------------ */

export class SnapshotStore {
  private readonly maxSnapshotsPerAggregate: number;
  private readonly autoSnapshotInterval: number;
  private readonly snapshots: Map<string, Array<Snapshot<unknown>>>;
  private readonly aggregateEventCounters: Map<string, number>;

  constructor(
    autoSnapshotInterval: number = 100,
    maxSnapshotsPerAggregate: number = 10
  ) {
    this.autoSnapshotInterval = autoSnapshotInterval;
    this.maxSnapshotsPerAggregate = maxSnapshotsPerAggregate;
    this.snapshots = new Map();
    this.aggregateEventCounters = new Map();
  }

  /** Persist a state snapshot. */
  saveSnapshot<T>(snapshot: Snapshot<T>): void {
    const aggId = snapshot.aggregateId;
    let list = this.snapshots.get(aggId);
    if (!list) {
      list = [];
      this.snapshots.set(aggId, list);
    }

    // Check if a snapshot at this version already exists
    const existingIdx = list.findIndex((s) => s.version === snapshot.version);
    if (existingIdx !== -1) {
      list[existingIdx] = deepClone(snapshot) as Snapshot<unknown>;
    } else {
      list.push(deepClone(snapshot) as Snapshot<unknown>);
      // Sort by version ascending
      list.sort((a, b) => a.version - b.version);
    }

    // LRU eviction: keep only the most recent N snapshots
    while (list.length > this.maxSnapshotsPerAggregate) {
      list.shift();
    }
  }

  /** Retrieve the most recent snapshot for an aggregate. */
  getLatestSnapshot<T>(aggregateId: string): Snapshot<T> | undefined {
    const list = this.snapshots.get(aggregateId);
    if (!list || list.length === 0) return undefined;
    return deepClone(list[list.length - 1]) as Snapshot<T>;
  }

  /** Retrieve the snapshot at or before the given version. */
  getSnapshotAtVersion<T>(
    aggregateId: string,
    version: number
  ): Snapshot<T> | undefined {
    const list = this.snapshots.get(aggregateId);
    if (!list || list.length === 0) return undefined;

    let best: Snapshot<unknown> | undefined;
    for (const snap of list) {
      if (snap.version <= version) {
        best = snap;
      } else {
        break; // sorted ascending, no need to continue
      }
    }

    return best ? (deepClone(best) as Snapshot<T>) : undefined;
  }

  /** Retrieve all snapshots for an aggregate (sorted by version ascending). */
  getSnapshotsForAggregate<T>(aggregateId: string): Array<Snapshot<T>> {
    const list = this.snapshots.get(aggregateId);
    if (!list) return [];
    return list.map((s) => deepClone(s) as Snapshot<T>);
  }

  /** Delete all snapshots for an aggregate. */
  clearSnapshots(aggregateId: string): void {
    this.snapshots.delete(aggregateId);
  }

  /** Check if an auto-snapshot should be taken based on the event count. */
  shouldAutoSnapshot(aggregateId: string): boolean {
    const count = this.aggregateEventCounters.get(aggregateId) ?? 0;
    return count > 0 && count % this.autoSnapshotInterval === 0;
  }

  /** Increment the event counter for an aggregate (used by the replay engine). */
  incrementEventCounter(aggregateId: string): void {
    const current = this.aggregateEventCounters.get(aggregateId) ?? 0;
    this.aggregateEventCounters.set(aggregateId, current + 1);
  }

  /** Reset the event counter for an aggregate. */
  resetEventCounter(aggregateId: string): void {
    this.aggregateEventCounters.set(aggregateId, 0);
  }

  /** Get the auto-snapshot interval. */
  getAutoSnapshotInterval(): number {
    return this.autoSnapshotInterval;
  }

  /** Total number of snapshots across all aggregates. */
  getTotalSnapshotCount(): number {
    let total = 0;
    const entries = Array.from(this.snapshots.values());
    for (const list of entries) {
      total += list.length;
    }
    return total;
  }

  /** Get all aggregate IDs that have snapshots. */
  getAggregateIdsWithSnapshots(): string[] {
    return Array.from(this.snapshots.keys());
  }
}

/* ------------------------------------------------------------------ */
/*  EventReplayEngine                                                 */
/* ------------------------------------------------------------------ */

export interface ReplayOptions {
  upToVersion?: number;
  upToTimestamp?: number;
}

export interface ReplayResultWithState<T> extends ReplayResult {
  state: T;
}

export interface StateDiff<T> {
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  changed: Record<string, { from: unknown; to: unknown }>;
}

export class EventReplayEngine {
  private readonly store: EventStore;
  private readonly snapshotStore: SnapshotStore;

  constructor(store: EventStore, snapshotStore: SnapshotStore) {
    this.store = store;
    this.snapshotStore = snapshotStore;
  }

  /** Replay all events for an aggregate through a projection. */
  replay<T>(
    aggregateId: string,
    projection: ProjectionDefinition<T>,
    options?: ReplayOptions
  ): ReplayResultWithState<T> {
    const startMs = Date.now();
    const stream = this.store.getStream(aggregateId);
    let state = deepClone(projection.initialState);
    let eventsReplayed = 0;
    const errors: Array<{ eventId: string; error: string }> = [];

    for (const event of stream.events) {
      if (options?.upToVersion !== undefined && event.version > options.upToVersion) {
        break;
      }
      if (options?.upToTimestamp !== undefined && event.timestamp > options.upToTimestamp) {
        break;
      }

      try {
        state = projection.reducer(state, event);
        eventsReplayed++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ eventId: event.eventId, error: message });
        // Log warning but continue replay — corrupted events are skipped
        console.warn(
          `[EventReplayEngine] Error replaying event ${event.eventId} (type=${event.eventType}): ${message}`
        );
      }
    }

    const durationMs = Date.now() - startMs;
    return {
      eventsReplayed,
      finalState: state,
      errors,
      durationMs,
      state,
    };
  }

  /** Replay from the latest snapshot for faster reconstruction. */
  replayFromSnapshot<T>(
    aggregateId: string,
    projection: ProjectionDefinition<T>
  ): ReplayResultWithState<T> {
    const startMs = Date.now();
    const snapshot = this.snapshotStore.getLatestSnapshot<T>(aggregateId);
    const stream = this.store.getStream(aggregateId);
    const errors: Array<{ eventId: string; error: string }> = [];

    let state: T;
    let startVersion: number;

    if (snapshot) {
      state = deepClone(snapshot.state);
      startVersion = snapshot.version;
    } else {
      state = deepClone(projection.initialState);
      startVersion = 0;
    }

    let eventsReplayed = 0;
    for (const event of stream.events) {
      if (event.version <= startVersion) continue;

      try {
        state = projection.reducer(state, event);
        eventsReplayed++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ eventId: event.eventId, error: message });
        console.warn(
          `[EventReplayEngine] Error replaying event ${event.eventId} from snapshot: ${message}`
        );
      }
    }

    const durationMs = Date.now() - startMs;
    return {
      eventsReplayed,
      finalState: state,
      errors,
      durationMs,
      state,
    };
  }

  /** Replay all events across every stream through a projection. */
  replayAll<T>(projection: ProjectionDefinition<T>): ReplayResultWithState<T> {
    const startMs = Date.now();
    let state = deepClone(projection.initialState);
    let eventsReplayed = 0;
    const errors: Array<{ eventId: string; error: string }> = [];

    // Gather all events from all streams and sort by timestamp then version
    const allEvents: ConnectorDomainEvent[] = [];
    const aggregateIds = this.store.getAggregateIds();
    for (const aggId of aggregateIds) {
      const stream = this.store.getStream(aggId);
      for (const event of stream.events) {
        allEvents.push(event);
      }
    }
    allEvents.sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return a.version - b.version;
    });

    for (const event of allEvents) {
      try {
        state = projection.reducer(state, event);
        eventsReplayed++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ eventId: event.eventId, error: message });
        console.warn(
          `[EventReplayEngine] Error in replayAll for event ${event.eventId}: ${message}`
        );
      }
    }

    const durationMs = Date.now() - startMs;
    return {
      eventsReplayed,
      finalState: state,
      errors,
      durationMs,
      state,
    };
  }

  /** Time-travel: reconstruct state at a specific point in time. */
  timeTravelTo<T>(
    aggregateId: string,
    projection: ProjectionDefinition<T>,
    timestamp: number
  ): ReplayResultWithState<T> {
    // Try to find a snapshot at or before the target timestamp
    const stream = this.store.getStream(aggregateId);
    let bestSnapshotVersion = 0;
    let state = deepClone(projection.initialState);

    // Find the best snapshot that's before the target timestamp
    const snapshots = this.snapshotStore.getSnapshotsForAggregate<T>(aggregateId);
    for (const snap of snapshots) {
      if (snap.timestamp <= timestamp) {
        state = deepClone(snap.state);
        bestSnapshotVersion = snap.version;
      } else {
        break;
      }
    }

    const startMs = Date.now();
    let eventsReplayed = 0;
    const errors: Array<{ eventId: string; error: string }> = [];

    for (const event of stream.events) {
      if (event.version <= bestSnapshotVersion) continue;
      if (event.timestamp > timestamp) break;

      try {
        state = projection.reducer(state, event);
        eventsReplayed++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ eventId: event.eventId, error: message });
        console.warn(
          `[EventReplayEngine] Error in timeTravelTo for event ${event.eventId}: ${message}`
        );
      }
    }

    const durationMs = Date.now() - startMs;
    return {
      eventsReplayed,
      finalState: state,
      errors,
      durationMs,
      state,
    };
  }

  /** Compute a diff between two versions of aggregate state. */
  diffStates<T>(
    aggregateId: string,
    projection: ProjectionDefinition<T>,
    versionA: number,
    versionB: number
  ): StateDiff<T> {
    const stateA = this.replay(aggregateId, projection, { upToVersion: versionA }).state;
    const stateB = this.replay(aggregateId, projection, { upToVersion: versionB }).state;

    const objA = (typeof stateA === 'object' && stateA !== null ? stateA : {}) as Record<string, unknown>;
    const objB = (typeof stateB === 'object' && stateB !== null ? stateB : {}) as Record<string, unknown>;

    const keysA = new Set(Object.keys(objA));
    const keysB = new Set(Object.keys(objB));
    const allKeys = new Set([...Array.from(keysA), ...Array.from(keysB)]);

    const added: Record<string, unknown> = {};
    const removed: Record<string, unknown> = {};
    const changed: Record<string, { from: unknown; to: unknown }> = {};

    const allKeysArray = Array.from(allKeys);
    for (const key of allKeysArray) {
      const inA = keysA.has(key);
      const inB = keysB.has(key);

      if (!inA && inB) {
        added[key] = objB[key];
      } else if (inA && !inB) {
        removed[key] = objA[key];
      } else if (inA && inB) {
        const valA = JSON.stringify(objA[key]);
        const valB = JSON.stringify(objB[key]);
        if (valA !== valB) {
          changed[key] = { from: objA[key], to: objB[key] };
        }
      }
    }

    return { added, removed, changed };
  }

  /** Auto-snapshot if the interval threshold is reached. */
  maybeAutoSnapshot<T>(
    aggregateId: string,
    projection: ProjectionDefinition<T>
  ): boolean {
    this.snapshotStore.incrementEventCounter(aggregateId);
    if (this.snapshotStore.shouldAutoSnapshot(aggregateId)) {
      const result = this.replay(aggregateId, projection);
      const latestVersion = this.store.getLatestVersion(aggregateId);
      this.snapshotStore.saveSnapshot<T>({
        aggregateId,
        aggregateType: 'connector',
        version: latestVersion,
        state: result.state,
        timestamp: Date.now(),
      });
      this.snapshotStore.resetEventCounter(aggregateId);
      return true;
    }
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  ProjectionManager                                                 */
/* ------------------------------------------------------------------ */

interface ConnectorUsageCounts {
  totalOperations: Record<string, number>;
  operationsByType: Record<string, Record<string, number>>;
}

interface ConnectorErrorRates {
  errorCountsByHour: Record<string, Record<string, number>>; // connectorId -> hourKey -> count
  totalErrors: Record<string, number>;
}

interface UserActivity {
  operationsPerUser: Record<string, number>;
  lastActiveAt: Record<string, number>;
  userConnectors: Record<string, string[]>;
}

interface OperationLatency {
  samples: Record<string, number[]>; // operationId -> latencies
  aggregated: Record<string, { avg: number; p95: number; p99: number; count: number }>;
}

export class ProjectionManager {
  private readonly projections: Map<string, ProjectionDefinition<unknown>>;
  private readonly states: Map<string, ProjectionState<unknown>>;
  private readonly store: EventStore;
  private readonly globalEventVersionTracker: number;

  constructor(store: EventStore) {
    this.store = store;
    this.projections = new Map();
    this.states = new Map();
    this.globalEventVersionTracker = 0;

    this.registerBuiltInProjections();
  }

  /** Register a custom projection. */
  registerProjection<T>(definition: ProjectionDefinition<T>): void {
    if (this.projections.has(definition.id)) {
      console.warn(
        `[ProjectionManager] Overwriting existing projection: ${definition.id}`
      );
    }
    this.projections.set(definition.id, definition as ProjectionDefinition<unknown>);
    if (!this.states.has(definition.id)) {
      this.states.set(definition.id, {
        projectionId: definition.id,
        currentState: deepClone(definition.initialState),
        lastEventVersion: 0,
        lastUpdated: Date.now(),
      });
    }
  }

  /** Process a single event through all registered projections. */
  processEvent(event: ConnectorDomainEvent): void {
    const projectionEntries = Array.from(this.projections.entries());
    for (const [projectionId, definition] of projectionEntries) {
      const stateContainer = this.states.get(projectionId);
      if (!stateContainer) continue;

      try {
        const newState = definition.reducer(stateContainer.currentState, event);
        stateContainer.currentState = newState;
        stateContainer.lastEventVersion = event.version;
        stateContainer.lastUpdated = Date.now();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[ProjectionManager] Error processing event ${event.eventId} ` +
          `in projection ${projectionId}: ${message}`
        );
      }
    }
  }

  /** Get the current state of a projection. */
  getProjectionState<T>(projectionId: string): ProjectionState<T> | undefined {
    const state = this.states.get(projectionId);
    if (!state) return undefined;
    return deepClone(state) as ProjectionState<T>;
  }

  /** Rebuild a single projection from scratch by replaying all events. */
  rebuildProjection(projectionId: string): void {
    const definition = this.projections.get(projectionId);
    if (!definition) {
      throw new Error(`Projection not found: ${projectionId}`);
    }

    let state = deepClone(definition.initialState);
    let lastVersion = 0;

    // Collect all events across all streams, sorted globally
    const allEvents = this.collectAllEventsSorted();

    for (const event of allEvents) {
      try {
        state = definition.reducer(state, event);
        lastVersion = event.version;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[ProjectionManager] Error rebuilding projection ${projectionId} ` +
          `at event ${event.eventId}: ${message}`
        );
      }
    }

    this.states.set(projectionId, {
      projectionId,
      currentState: state,
      lastEventVersion: lastVersion,
      lastUpdated: Date.now(),
    });
  }

  /** Rebuild all registered projections from scratch. */
  rebuildAll(): void {
    const projectionIds = Array.from(this.projections.keys());
    for (const id of projectionIds) {
      this.rebuildProjection(id);
    }
  }

  /** List all registered projection IDs. */
  getRegisteredProjectionIds(): string[] {
    return Array.from(this.projections.keys());
  }

  /** Check if a projection is registered. */
  hasProjection(projectionId: string): boolean {
    return this.projections.has(projectionId);
  }

  /* ---- Private helpers ---- */

  private collectAllEventsSorted(): ConnectorDomainEvent[] {
    const allEvents: ConnectorDomainEvent[] = [];
    const aggregateIds = this.store.getAggregateIds();

    for (const aggId of aggregateIds) {
      const stream = this.store.getStream(aggId);
      for (const event of stream.events) {
        allEvents.push(event);
      }
    }

    allEvents.sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return a.version - b.version;
    });

    return allEvents;
  }

  private registerBuiltInProjections(): void {
    // 1) Connector Usage Counts
    this.registerProjection<ConnectorUsageCounts>({
      id: 'connector_usage_counts',
      name: 'Connector Usage Counts',
      initialState: { totalOperations: {}, operationsByType: {} },
      reducer: (state, event) => {
        const cid = event.connectorId;
        if (
          event.eventType === CONNECTOR_OPERATION_STARTED ||
          event.eventType === CONNECTOR_OPERATION_COMPLETED
        ) {
          state.totalOperations[cid] = (state.totalOperations[cid] ?? 0) + 1;

          if (!state.operationsByType[cid]) {
            state.operationsByType[cid] = {};
          }
          const opType = (event.payload['operationType'] as string) ?? 'unknown';
          state.operationsByType[cid][opType] =
            (state.operationsByType[cid][opType] ?? 0) + 1;
        }
        return state;
      },
    });

    // 2) Connector Error Rates
    this.registerProjection<ConnectorErrorRates>({
      id: 'connector_error_rates',
      name: 'Connector Error Rates',
      initialState: { errorCountsByHour: {}, totalErrors: {} },
      reducer: (state, event) => {
        if (event.eventType === CONNECTOR_OPERATION_FAILED) {
          const cid = event.connectorId;
          state.totalErrors[cid] = (state.totalErrors[cid] ?? 0) + 1;

          const hourKey = new Date(event.timestamp).toISOString().slice(0, 13);
          if (!state.errorCountsByHour[cid]) {
            state.errorCountsByHour[cid] = {};
          }
          state.errorCountsByHour[cid][hourKey] =
            (state.errorCountsByHour[cid][hourKey] ?? 0) + 1;
        }
        return state;
      },
    });

    // 3) User Activity
    this.registerProjection<UserActivity>({
      id: 'user_activity',
      name: 'User Activity',
      initialState: { operationsPerUser: {}, lastActiveAt: {}, userConnectors: {} },
      reducer: (state, event) => {
        const uid = event.userId;
        if (!uid) return state;

        if (
          event.eventType === CONNECTOR_OPERATION_STARTED ||
          event.eventType === CONNECTOR_OPERATION_COMPLETED
        ) {
          state.operationsPerUser[uid] = (state.operationsPerUser[uid] ?? 0) + 1;
          state.lastActiveAt[uid] = Math.max(
            state.lastActiveAt[uid] ?? 0,
            event.timestamp
          );

          if (!state.userConnectors[uid]) {
            state.userConnectors[uid] = [];
          }
          if (!state.userConnectors[uid].includes(event.connectorId)) {
            state.userConnectors[uid].push(event.connectorId);
          }
        }
        return state;
      },
    });

    // 4) Operation Latency
    this.registerProjection<OperationLatency>({
      id: 'operation_latency',
      name: 'Operation Latency',
      initialState: { samples: {}, aggregated: {} },
      reducer: (state, event) => {
        if (event.eventType === CONNECTOR_OPERATION_COMPLETED) {
          const opId = event.operationId;
          const latency = event.payload['durationMs'] as number | undefined;

          if (latency !== undefined && typeof latency === 'number' && latency >= 0) {
            if (!state.samples[opId]) {
              state.samples[opId] = [];
            }
            state.samples[opId].push(latency);

            // Keep only last 1000 samples per operation for memory efficiency
            if (state.samples[opId].length > 1000) {
              state.samples[opId] = state.samples[opId].slice(-1000);
            }

            // Recompute aggregations
            const sorted = [...state.samples[opId]].sort((a, b) => a - b);
            const count = sorted.length;
            const sum = sorted.reduce((acc, v) => acc + v, 0);
            const avg = count > 0 ? sum / count : 0;
            const p95Idx = Math.min(Math.floor(count * 0.95), count - 1);
            const p99Idx = Math.min(Math.floor(count * 0.99), count - 1);

            state.aggregated[opId] = {
              avg: Math.round(avg * 100) / 100,
              p95: sorted[p95Idx] ?? 0,
              p99: sorted[p99Idx] ?? 0,
              count,
            };
          }
        }
        return state;
      },
    });
  }
}

/* ------------------------------------------------------------------ */
/*  EventBusIntegration                                               */
/* ------------------------------------------------------------------ */

interface DeadLetterEntry {
  event: ConnectorDomainEvent;
  subscriptionId: string;
  error: string;
  failedAt: number;
  attempts: number;
}

export class EventBusIntegration {
  private readonly subscriptions: Map<string, EventSubscription>;
  private readonly deadLetterQueue: DeadLetterEntry[];
  private readonly maxDeadLetterSize: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(
    maxDeadLetterSize: number = 1000,
    maxRetries: number = 3,
    retryDelayMs: number = 100
  ) {
    this.subscriptions = new Map();
    this.deadLetterQueue = [];
    this.maxDeadLetterSize = maxDeadLetterSize;
    this.maxRetries = maxRetries;
    this.retryDelayMs = retryDelayMs;
  }

  /** Subscribe to events matching a filter. */
  subscribe(
    filter: EventFilter,
    handler: (event: ConnectorDomainEvent) => void | Promise<void>
  ): string {
    const id = generateSubscriptionId();
    this.subscriptions.set(id, { id, filter, handler });
    return id;
  }

  /** Remove a subscription. */
  unsubscribe(subscriptionId: string): void {
    const existed = this.subscriptions.delete(subscriptionId);
    if (!existed) {
      console.warn(
        `[EventBusIntegration] Attempted to unsubscribe unknown id: ${subscriptionId}`
      );
    }
  }

  /** Return all active subscriptions. */
  getSubscriptions(): EventSubscription[] {
    return Array.from(this.subscriptions.values()).map((sub) => ({
      id: sub.id,
      filter: deepClone(sub.filter),
      handler: sub.handler,
    }));
  }

  /** Publish an event to all matching subscribers with retry logic. */
  async publish(event: ConnectorDomainEvent): Promise<void> {
    const subs = Array.from(this.subscriptions.values());

    const deliveryPromises: Promise<void>[] = [];
    for (const sub of subs) {
      if (matchesFilter(event, sub.filter)) {
        deliveryPromises.push(this.deliverWithRetry(event, sub));
      }
    }

    await Promise.allSettled(deliveryPromises);
  }

  /** Publish an event synchronously (fire-and-forget). */
  publishSync(event: ConnectorDomainEvent): void {
    const subs = Array.from(this.subscriptions.values());

    for (const sub of subs) {
      if (matchesFilter(event, sub.filter)) {
        this.deliverWithRetry(event, sub).catch(() => {
          // Already handled by dead letter queue
        });
      }
    }
  }

  /** Get the dead letter queue contents. */
  getDeadLetterQueue(): DeadLetterEntry[] {
    return deepClone(this.deadLetterQueue);
  }

  /** Get the count of dead letters. */
  getDeadLetterCount(): number {
    return this.deadLetterQueue.length;
  }

  /** Clear the dead letter queue. */
  clearDeadLetterQueue(): void {
    this.deadLetterQueue.length = 0;
  }

  /** Retry all entries in the dead letter queue. */
  async retryDeadLetters(): Promise<{ retried: number; failed: number }> {
    const entries = [...this.deadLetterQueue];
    this.deadLetterQueue.length = 0;

    let retried = 0;
    let failed = 0;

    for (const entry of entries) {
      const sub = this.subscriptions.get(entry.subscriptionId);
      if (!sub) {
        // Subscription no longer exists — discard
        continue;
      }

      try {
        const result = sub.handler(entry.event);
        if (result instanceof Promise) {
          await result;
        }
        retried++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        failed++;
        this.addToDeadLetterQueue({
          event: entry.event,
          subscriptionId: entry.subscriptionId,
          error: message,
          failedAt: Date.now(),
          attempts: entry.attempts + 1,
        });
      }
    }

    return { retried, failed };
  }

  /** Get the number of active subscriptions. */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /* ---- Private helpers ---- */

  private async deliverWithRetry(
    event: ConnectorDomainEvent,
    sub: EventSubscription
  ): Promise<void> {
    let lastError: string = '';

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = sub.handler(event);
        if (result instanceof Promise) {
          await result;
        }
        return; // Success
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn(
          `[EventBusIntegration] Delivery failed for subscription ${sub.id} ` +
          `(attempt ${attempt}/${this.maxRetries}): ${lastError}`
        );

        if (attempt < this.maxRetries) {
          await this.delay(this.retryDelayMs * attempt);
        }
      }
    }

    // All retries exhausted — add to dead letter queue
    this.addToDeadLetterQueue({
      event: deepClone(event),
      subscriptionId: sub.id,
      error: lastError,
      failedAt: Date.now(),
      attempts: this.maxRetries,
    });
  }

  private addToDeadLetterQueue(entry: DeadLetterEntry): void {
    this.deadLetterQueue.push(entry);

    // Evict oldest entries if over capacity
    while (this.deadLetterQueue.length > this.maxDeadLetterSize) {
      this.deadLetterQueue.shift();
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/* ------------------------------------------------------------------ */
/*  EventCompaction                                                    */
/* ------------------------------------------------------------------ */

export interface CompactionResult {
  removedEvents: number;
  savedSnapshot: boolean;
}

export interface CompactAllResult {
  totalRemoved: number;
  totalCompacted: number;
  details: Array<{ aggregateId: string; removedEvents: number; savedSnapshot: boolean }>;
}

export class EventCompaction {
  private readonly store: EventStore;
  private readonly snapshotStore: SnapshotStore;
  private readonly minEventsForCompaction: number;

  constructor(
    store: EventStore,
    snapshotStore: SnapshotStore,
    minEventsForCompaction: number = 200
  ) {
    this.store = store;
    this.snapshotStore = snapshotStore;
    this.minEventsForCompaction = minEventsForCompaction;
  }

  /** Compact a specific aggregate stream, optionally keeping the last N events. */
  compact(aggregateId: string, keepLastN?: number): CompactionResult {
    const stream = this.store.getStream(aggregateId);
    const eventCount = stream.events.length;

    if (eventCount < this.minEventsForCompaction) {
      return { removedEvents: 0, savedSnapshot: false };
    }

    const keep = keepLastN ?? Math.floor(eventCount * 0.2); // keep 20% by default
    const effectiveKeep = Math.max(keep, 1); // always keep at least 1
    const removeUpToIndex = eventCount - effectiveKeep;

    if (removeUpToIndex <= 0) {
      return { removedEvents: 0, savedSnapshot: false };
    }

    // Take a snapshot at the compaction boundary before removing events
    const boundaryEvent = stream.events[removeUpToIndex - 1];
    const boundaryVersion = boundaryEvent.version;

    // Build state at boundary by replaying events up to that point
    let snapshotSaved = false;
    try {
      const stateAtBoundary = this.buildStateAtVersion(stream.events, removeUpToIndex);
      this.snapshotStore.saveSnapshot({
        aggregateId,
        aggregateType: stream.events[0]?.aggregateType ?? 'unknown',
        version: boundaryVersion,
        state: stateAtBoundary,
        timestamp: boundaryEvent.timestamp,
      });
      snapshotSaved = true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[EventCompaction] Failed to save snapshot for ${aggregateId}: ${message}`
      );
    }

    // Remove events from the store
    const removedCount = this.store.removeEventsUpTo(aggregateId, boundaryVersion);

    return { removedEvents: removedCount, savedSnapshot: snapshotSaved };
  }

  /** Compact all streams that are older than a given duration. */
  compactAll(olderThanMs?: number): CompactAllResult {
    const aggregateIds = this.store.getAggregateIds();
    let totalRemoved = 0;
    let totalCompacted = 0;
    const details: Array<{ aggregateId: string; removedEvents: number; savedSnapshot: boolean }> = [];

    const cutoffTime = olderThanMs !== undefined ? Date.now() - olderThanMs : 0;

    for (const aggId of aggregateIds) {
      const stream = this.store.getStream(aggId);

      // Skip if too few events
      if (stream.events.length < this.minEventsForCompaction) {
        continue;
      }

      // If olderThanMs specified, only compact streams with old events
      if (cutoffTime > 0 && stream.lastEventAt > cutoffTime) {
        continue;
      }

      const result = this.compact(aggId);
      if (result.removedEvents > 0) {
        totalRemoved += result.removedEvents;
        totalCompacted++;
        details.push({
          aggregateId: aggId,
          removedEvents: result.removedEvents,
          savedSnapshot: result.savedSnapshot,
        });
      }
    }

    return { totalRemoved, totalCompacted, details };
  }

  /** Get compaction statistics. */
  getCompactionStats(): {
    totalStreams: number;
    compactableStreams: number;
    totalEvents: number;
    estimatedRemovable: number;
  } {
    const aggregateIds = this.store.getAggregateIds();
    let compactableStreams = 0;
    let estimatedRemovable = 0;

    for (const aggId of aggregateIds) {
      const stream = this.store.getStream(aggId);
      if (stream.events.length >= this.minEventsForCompaction) {
        compactableStreams++;
        const keep = Math.max(Math.floor(stream.events.length * 0.2), 1);
        estimatedRemovable += stream.events.length - keep;
      }
    }

    return {
      totalStreams: aggregateIds.length,
      compactableStreams,
      totalEvents: this.store.getEventCount(),
      estimatedRemovable,
    };
  }

  /** Get the minimum events threshold for compaction. */
  getMinEventsForCompaction(): number {
    return this.minEventsForCompaction;
  }

  /* ---- Private helpers ---- */

  private buildStateAtVersion(
    events: ConnectorDomainEvent[],
    upToIndex: number
  ): Record<string, unknown> {
    const state: Record<string, unknown> = {
      eventCount: upToIndex,
      lastEventType: '',
      lastTimestamp: 0,
      connectorId: '',
      operationTypes: [] as string[],
      errorCount: 0,
      completedCount: 0,
    };

    const operationTypes = new Set<string>();

    for (let i = 0; i < upToIndex; i++) {
      const event = events[i];
      state['lastEventType'] = event.eventType;
      state['lastTimestamp'] = event.timestamp;
      state['connectorId'] = event.connectorId;

      if (event.payload['operationType']) {
        operationTypes.add(event.payload['operationType'] as string);
      }

      if (event.eventType === CONNECTOR_OPERATION_FAILED) {
        state['errorCount'] = (state['errorCount'] as number) + 1;
      }
      if (event.eventType === CONNECTOR_OPERATION_COMPLETED) {
        state['completedCount'] = (state['completedCount'] as number) + 1;
      }
    }

    state['operationTypes'] = Array.from(operationTypes);
    return state;
  }
}

/* ------------------------------------------------------------------ */
/*  Integrated Facade: ConnectorEventSourcingFacade                   */
/* ------------------------------------------------------------------ */

export class ConnectorEventSourcingFacade {
  readonly eventStore: EventStore;
  readonly snapshotStore: SnapshotStore;
  readonly replayEngine: EventReplayEngine;
  readonly projectionManager: ProjectionManager;
  readonly eventBus: EventBusIntegration;
  readonly compaction: EventCompaction;

  constructor(options?: {
    maxEvents?: number;
    autoSnapshotInterval?: number;
    maxSnapshotsPerAggregate?: number;
    maxDeadLetterSize?: number;
    maxRetries?: number;
    retryDelayMs?: number;
    minEventsForCompaction?: number;
  }) {
    this.eventStore = new EventStore(options?.maxEvents ?? 50_000);
    this.snapshotStore = new SnapshotStore(
      options?.autoSnapshotInterval ?? 100,
      options?.maxSnapshotsPerAggregate ?? 10
    );
    this.replayEngine = new EventReplayEngine(this.eventStore, this.snapshotStore);
    this.projectionManager = new ProjectionManager(this.eventStore);
    this.eventBus = new EventBusIntegration(
      options?.maxDeadLetterSize ?? 1000,
      options?.maxRetries ?? 3,
      options?.retryDelayMs ?? 100
    );
    this.compaction = new EventCompaction(
      this.eventStore,
      this.snapshotStore,
      options?.minEventsForCompaction ?? 200
    );
  }

  /**
   * High-level method: append an event and process it through all subsystems.
   * - Appends to event store (optimistic concurrency)
   * - Processes through all registered projections
   * - Publishes to event bus subscribers
   * - Optionally triggers auto-snapshot
   */
  async recordEvent(
    partial: Omit<ConnectorDomainEvent, 'eventId' | 'version'>,
    projection?: ProjectionDefinition<unknown>
  ): Promise<ConnectorDomainEvent> {
    // 1. Append to store
    const event = this.eventStore.append(partial);

    // 2. Process projections
    this.projectionManager.processEvent(event);

    // 3. Publish to bus
    await this.eventBus.publish(event);

    // 4. Auto-snapshot
    if (projection) {
      this.replayEngine.maybeAutoSnapshot(event.aggregateId, projection);
    }

    return event;
  }

  /**
   * High-level method: record a batch of events.
   */
  async recordBatch(
    partials: Array<Omit<ConnectorDomainEvent, 'eventId' | 'version'>>
  ): Promise<ConnectorDomainEvent[]> {
    const events = this.eventStore.appendBatch(partials);

    for (const event of events) {
      this.projectionManager.processEvent(event);
      await this.eventBus.publish(event);
    }

    return events;
  }

  /**
   * Get a summary of the event sourcing system state.
   */
  getSystemSummary(): {
    totalEvents: number;
    totalStreams: number;
    totalSnapshots: number;
    totalSubscriptions: number;
    deadLetterCount: number;
    projections: string[];
    compactionStats: ReturnType<EventCompaction['getCompactionStats']>;
  } {
    return {
      totalEvents: this.eventStore.getEventCount(),
      totalStreams: this.eventStore.getAggregateIds().length,
      totalSnapshots: this.snapshotStore.getTotalSnapshotCount(),
      totalSubscriptions: this.eventBus.getSubscriptionCount(),
      deadLetterCount: this.eventBus.getDeadLetterCount(),
      projections: this.projectionManager.getRegisteredProjectionIds(),
      compactionStats: this.compaction.getCompactionStats(),
    };
  }

  /**
   * Full diagnostic dump for debugging.
   */
  getDiagnostics(): Record<string, unknown> {
    const aggregateIds = this.eventStore.getAggregateIds();
    const streamSizes: Record<string, number> = {};
    for (const id of aggregateIds) {
      streamSizes[id] = this.eventStore.getLatestVersion(id);
    }

    const projectionIds = this.projectionManager.getRegisteredProjectionIds();
    const projectionStates: Record<string, unknown> = {};
    for (const pid of projectionIds) {
      projectionStates[pid] = this.projectionManager.getProjectionState(pid);
    }

    return {
      timestamp: Date.now(),
      eventStore: {
        totalEvents: this.eventStore.getEventCount(),
        streamCount: aggregateIds.length,
        streamSizes,
      },
      snapshots: {
        totalCount: this.snapshotStore.getTotalSnapshotCount(),
        aggregatesWithSnapshots: this.snapshotStore.getAggregateIdsWithSnapshots(),
      },
      projections: projectionStates,
      eventBus: {
        subscriptionCount: this.eventBus.getSubscriptionCount(),
        deadLetterCount: this.eventBus.getDeadLetterCount(),
      },
      compaction: this.compaction.getCompactionStats(),
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Singleton Exports                                                 */
/* ------------------------------------------------------------------ */

export const eventStore = new EventStore(50_000);
export const snapshotStore = new SnapshotStore(100, 10);
export const eventReplayEngine = new EventReplayEngine(eventStore, snapshotStore);
export const projectionManager = new ProjectionManager(eventStore);
export const eventBusIntegration = new EventBusIntegration(1000, 3, 100);
export const eventCompaction = new EventCompaction(eventStore, snapshotStore, 200);

/** Pre-wired facade using the singletons above. */
export const connectorEventSourcingFacade = new ConnectorEventSourcingFacade();
