/**
 * connectorStateManager.ts
 *
 * Distributed state machine with persistence for the Integration Kernel.
 * Provides finite state machines with guards, effects, timeouts, aggregation,
 * persistence, and pre-defined connector lifecycle definitions.
 *
 * Standalone module — no imports from other kernel files.
 */

const crypto = require("crypto");

/* ================================================================== */
/*  1. Core Types                                                      */
/* ================================================================== */

export interface TransitionDefinition {
  from: string | string[];
  to: string;
  event: string;
  guard?: string;
  effect?: string;
}

export interface GuardDefinition {
  name: string;
  evaluate: (context: StateContext) => boolean;
}

export interface EffectDefinition {
  name: string;
  execute: (context: StateContext, transition: TransitionRecord) => Promise<void>;
}

export interface StateDefinition {
  id: string;
  states: string[];
  initialState: string;
  transitions: TransitionDefinition[];
  guards?: GuardDefinition[];
  effects?: EffectDefinition[];
}

export interface StateContextMetadata {
  createdAt: number;
  updatedAt: number;
  transitionCount: number;
  version: number;
}

export interface StateContext {
  machineId: string;
  currentState: string;
  previousState: string | null;
  data: Record<string, unknown>;
  metadata: StateContextMetadata;
}

export interface TransitionRecord {
  from: string;
  to: string;
  event: string;
  timestamp: number;
  guardResult?: boolean;
  effectResult?: { success: boolean; error?: string };
}

export interface StateMachineConfig {
  definition: StateDefinition;
  persistenceEnabled: boolean;
  historySize: number;
  timeouts?: Map<string, number>;
}

export interface SerializedStateMachine {
  definitionId: string;
  context: StateContext;
  history: TransitionRecord[];
  config: {
    persistenceEnabled: boolean;
    historySize: number;
    timeouts: Array<[string, number]>;
  };
}

export interface StateDistributionEntry {
  state: string;
  count: number;
  percentage: number;
}

export interface TransitionFrequencyEntry {
  from: string;
  to: string;
  event: string;
  count: number;
}

export interface AverageTimeInStateEntry {
  state: string;
  averageMs: number;
  sampleCount: number;
}

export interface StuckMachineEntry {
  machineId: string;
  state: string;
  stuckSinceMs: number;
  lastTransitionAt: number;
}

export interface TransitionGraphEdge {
  to: string;
  event: string;
  count: number;
}

export interface TransitionGraph {
  [fromState: string]: TransitionGraphEdge[];
}

export interface StateReport {
  totalMachines: number;
  distribution: StateDistributionEntry[];
  stuckMachines: StuckMachineEntry[];
  transitionFrequency: TransitionFrequencyEntry[];
  timestamp: number;
}

export interface StorageStats {
  count: number;
  totalSizeEstimate: number;
}

export interface TimeoutEntry {
  machineId: string;
  state: string;
  remainingMs: number;
  totalMs: number;
}

/* ================================================================== */
/*  2. Errors                                                          */
/* ================================================================== */

export class InvalidTransitionError extends Error {
  public readonly machineId: string;
  public readonly currentState: string;
  public readonly event: string;

  constructor(machineId: string, currentState: string, event: string) {
    super(
      `Invalid transition: machine "${machineId}" in state "${currentState}" cannot handle event "${event}"`
    );
    this.name = "InvalidTransitionError";
    this.machineId = machineId;
    this.currentState = currentState;
    this.event = event;
  }
}

export class StateMachineValidationError extends Error {
  public readonly definitionId: string;
  public readonly issues: string[];

  constructor(definitionId: string, issues: string[]) {
    super(
      `State machine definition "${definitionId}" is invalid: ${issues.join("; ")}`
    );
    this.name = "StateMachineValidationError";
    this.definitionId = definitionId;
    this.issues = issues;
  }
}

/* ================================================================== */
/*  3. StateMachine                                                    */
/* ================================================================== */

type StateChangeCallback = (
  context: StateContext,
  transition: TransitionRecord
) => void;

export class StateMachine {
  private context: StateContext;
  private readonly definition: StateDefinition;
  private readonly guards: Map<string, GuardDefinition>;
  private readonly effects: Map<string, EffectDefinition>;
  private readonly historyBuffer: TransitionRecord[];
  private readonly historySize: number;
  private readonly persistenceEnabled: boolean;
  private readonly timeouts: Map<string, number>;
  private subscribers: Map<string, StateChangeCallback>;
  private nextSubscriberId: number;

  constructor(machineId: string, config: StateMachineConfig) {
    StateMachine.validateDefinition(config.definition);

    this.definition = config.definition;
    this.persistenceEnabled = config.persistenceEnabled;
    this.historySize = config.historySize > 0 ? config.historySize : 100;
    this.timeouts = config.timeouts ?? new Map<string, number>();
    this.historyBuffer = [];
    this.subscribers = new Map<string, StateChangeCallback>();
    this.nextSubscriberId = 0;

    this.guards = new Map<string, GuardDefinition>();
    if (config.definition.guards) {
      for (const g of config.definition.guards) {
        this.guards.set(g.name, g);
      }
    }

    this.effects = new Map<string, EffectDefinition>();
    if (config.definition.effects) {
      for (const e of config.definition.effects) {
        this.effects.set(e.name, e);
      }
    }

    const now = Date.now();
    this.context = {
      machineId,
      currentState: config.definition.initialState,
      previousState: null,
      data: {},
      metadata: {
        createdAt: now,
        updatedAt: now,
        transitionCount: 0,
        version: 1,
      },
    };
  }

  /* ---- Static validation ---- */

  private static validateDefinition(def: StateDefinition): void {
    const issues: string[] = [];

    if (!def.id || def.id.trim().length === 0) {
      issues.push("definition id is empty");
    }
    if (!def.states || def.states.length === 0) {
      issues.push("states array is empty");
    }

    const stateSet = new Set(def.states);

    if (!stateSet.has(def.initialState)) {
      issues.push(
        `initial state "${def.initialState}" is not in the states array`
      );
    }

    /* Check that all transition targets/sources exist */
    for (const t of def.transitions) {
      const froms = Array.isArray(t.from) ? t.from : [t.from];
      for (const f of froms) {
        if (!stateSet.has(f)) {
          issues.push(
            `transition "${t.event}": source state "${f}" not in states array`
          );
        }
      }
      if (!stateSet.has(t.to)) {
        issues.push(
          `transition "${t.event}": target state "${t.to}" not in states array`
        );
      }
    }

    /* Check for orphan states (no inbound or outbound transitions, excluding initial) */
    const reachable = new Set<string>();
    reachable.add(def.initialState);
    for (const t of def.transitions) {
      const froms = Array.isArray(t.from) ? t.from : [t.from];
      for (const f of froms) {
        reachable.add(f);
      }
      reachable.add(t.to);
    }
    for (const s of def.states) {
      if (!reachable.has(s)) {
        issues.push(`state "${s}" is an orphan — no transitions reference it`);
      }
    }

    /* Validate guard references */
    const guardNames = new Set<string>();
    if (def.guards) {
      for (const g of def.guards) {
        guardNames.add(g.name);
      }
    }
    for (const t of def.transitions) {
      if (t.guard && !guardNames.has(t.guard)) {
        issues.push(
          `transition "${t.event}": guard "${t.guard}" is not defined`
        );
      }
    }

    /* Validate effect references */
    const effectNames = new Set<string>();
    if (def.effects) {
      for (const e of def.effects) {
        effectNames.add(e.name);
      }
    }
    for (const t of def.transitions) {
      if (t.effect && !effectNames.has(t.effect)) {
        issues.push(
          `transition "${t.event}": effect "${t.effect}" is not defined`
        );
      }
    }

    if (issues.length > 0) {
      throw new StateMachineValidationError(def.id, issues);
    }
  }

  /* ---- Public API ---- */

  getState(): string {
    return this.context.currentState;
  }

  getContext(): StateContext {
    return {
      ...this.context,
      data: { ...this.context.data },
      metadata: { ...this.context.metadata },
    };
  }

  getDefinitionId(): string {
    return this.definition.id;
  }

  getMachineId(): string {
    return this.context.machineId;
  }

  getTimeouts(): Map<string, number> {
    return new Map(Array.from(this.timeouts.entries()));
  }

  isPersistenceEnabled(): boolean {
    return this.persistenceEnabled;
  }

  canTransition(event: string): boolean {
    const matching = this.findMatchingTransitions(event);
    if (matching.length === 0) return false;

    for (const t of matching) {
      if (!t.guard) return true;
      const guard = this.guards.get(t.guard);
      if (!guard) return true;
      if (guard.evaluate(this.getContext())) return true;
    }
    return false;
  }

  async send(
    event: string,
    payload?: Record<string, unknown>
  ): Promise<TransitionRecord> {
    const matching = this.findMatchingTransitions(event);
    if (matching.length === 0) {
      throw new InvalidTransitionError(
        this.context.machineId,
        this.context.currentState,
        event
      );
    }

    /* Evaluate guards — first passing guard wins */
    let selectedTransition: TransitionDefinition | null = null;
    let guardResult: boolean | undefined;

    for (const t of matching) {
      if (!t.guard) {
        selectedTransition = t;
        guardResult = undefined;
        break;
      }
      const guard = this.guards.get(t.guard);
      if (!guard) {
        selectedTransition = t;
        guardResult = undefined;
        break;
      }
      const passes = guard.evaluate(this.getContext());
      if (passes) {
        selectedTransition = t;
        guardResult = true;
        break;
      } else {
        guardResult = false;
      }
    }

    if (!selectedTransition) {
      throw new InvalidTransitionError(
        this.context.machineId,
        this.context.currentState,
        event
      );
    }

    /* Merge payload into data */
    if (payload) {
      const keys = Object.keys(payload);
      for (const k of keys) {
        this.context.data[k] = payload[k];
      }
    }

    const now = Date.now();
    const previousState = this.context.currentState;

    /* Build partial record */
    const record: TransitionRecord = {
      from: previousState,
      to: selectedTransition.to,
      event,
      timestamp: now,
      guardResult,
    };

    /* Execute effect */
    let effectResult: { success: boolean; error?: string } | undefined;
    if (selectedTransition.effect) {
      const effect = this.effects.get(selectedTransition.effect);
      if (effect) {
        try {
          await effect.execute(this.getContext(), record);
          effectResult = { success: true };
        } catch (err: unknown) {
          const errMsg =
            err instanceof Error ? err.message : String(err);
          effectResult = { success: false, error: errMsg };
        }
      }
    }
    record.effectResult = effectResult;

    /* Update state */
    this.context.previousState = previousState;
    this.context.currentState = selectedTransition.to;
    this.context.metadata.updatedAt = now;
    this.context.metadata.transitionCount += 1;
    this.context.metadata.version += 1;

    /* Record in history (ring buffer) */
    this.historyBuffer.push(record);
    while (this.historyBuffer.length > this.historySize) {
      this.historyBuffer.shift();
    }

    /* Notify subscribers */
    const ctx = this.getContext();
    const entries = Array.from(this.subscribers.entries());
    for (const [, cb] of entries) {
      try {
        cb(ctx, record);
      } catch {
        /* subscriber errors do not propagate */
      }
    }

    return record;
  }

  subscribe(callback: StateChangeCallback): () => void {
    const id = String(this.nextSubscriberId++);
    this.subscribers.set(id, callback);
    return () => {
      this.subscribers.delete(id);
    };
  }

  getHistory(limit?: number): TransitionRecord[] {
    if (limit === undefined || limit >= this.historyBuffer.length) {
      return [...this.historyBuffer];
    }
    return this.historyBuffer.slice(
      this.historyBuffer.length - limit
    );
  }

  reset(): void {
    const now = Date.now();
    this.context.previousState = this.context.currentState;
    this.context.currentState = this.definition.initialState;
    this.context.data = {};
    this.context.metadata.updatedAt = now;
    this.context.metadata.version += 1;
    this.historyBuffer.length = 0;
  }

  setData(key: string, value: unknown): void {
    this.context.data[key] = value;
    this.context.metadata.updatedAt = Date.now();
  }

  getData(key: string): unknown {
    return this.context.data[key];
  }

  /* ---- Serialization ---- */

  serialize(): SerializedStateMachine {
    return {
      definitionId: this.definition.id,
      context: {
        machineId: this.context.machineId,
        currentState: this.context.currentState,
        previousState: this.context.previousState,
        data: { ...this.context.data },
        metadata: { ...this.context.metadata },
      },
      history: [...this.historyBuffer],
      config: {
        persistenceEnabled: this.persistenceEnabled,
        historySize: this.historySize,
        timeouts: Array.from(this.timeouts.entries()),
      },
    };
  }

  static deserialize(
    data: SerializedStateMachine,
    definition: StateDefinition
  ): StateMachine {
    const timeouts = new Map<string, number>();
    if (data.config.timeouts) {
      for (const [k, v] of data.config.timeouts) {
        timeouts.set(k, v);
      }
    }

    const config: StateMachineConfig = {
      definition,
      persistenceEnabled: data.config.persistenceEnabled,
      historySize: data.config.historySize,
      timeouts,
    };

    const machine = new StateMachine(data.context.machineId, config);

    /* Restore context */
    machine.context.currentState = data.context.currentState;
    machine.context.previousState = data.context.previousState;
    machine.context.data = { ...data.context.data };
    machine.context.metadata = { ...data.context.metadata };

    /* Restore history */
    machine.historyBuffer.length = 0;
    for (const rec of data.history) {
      machine.historyBuffer.push(rec);
    }

    return machine;
  }

  /* ---- Internals ---- */

  private findMatchingTransitions(event: string): TransitionDefinition[] {
    const result: TransitionDefinition[] = [];
    for (const t of this.definition.transitions) {
      if (t.event !== event) continue;
      const froms = Array.isArray(t.from) ? t.from : [t.from];
      if (froms.indexOf(this.context.currentState) !== -1) {
        result.push(t);
      }
    }
    return result;
  }
}

/* ================================================================== */
/*  4. StatePersistence                                                */
/* ================================================================== */

export class StatePersistence {
  private store: Map<string, string>;

  constructor() {
    this.store = new Map<string, string>();
  }

  save(machineId: string, context: SerializedStateMachine): void {
    const json = JSON.stringify(context);
    this.store.set(machineId, json);
  }

  load(machineId: string): SerializedStateMachine | null {
    const json = this.store.get(machineId);
    if (!json) return null;
    try {
      return JSON.parse(json) as SerializedStateMachine;
    } catch {
      return null;
    }
  }

  delete(machineId: string): boolean {
    return this.store.delete(machineId);
  }

  saveAll(machines: Map<string, SerializedStateMachine>): void {
    const entries = Array.from(machines.entries());
    for (const [id, data] of entries) {
      this.save(id, data);
    }
  }

  loadAll(): Map<string, SerializedStateMachine> {
    const result = new Map<string, SerializedStateMachine>();
    const entries = Array.from(this.store.entries());
    for (const [id, json] of entries) {
      try {
        const parsed = JSON.parse(json) as SerializedStateMachine;
        result.set(id, parsed);
      } catch {
        /* skip corrupt entries */
      }
    }
    return result;
  }

  has(machineId: string): boolean {
    return this.store.has(machineId);
  }

  clear(): void {
    this.store.clear();
  }

  getStorageStats(): StorageStats {
    let totalSize = 0;
    const values = Array.from(this.store.values());
    for (const v of values) {
      totalSize += v.length * 2; /* approximate byte size for UTF-16 */
    }
    return {
      count: this.store.size,
      totalSizeEstimate: totalSize,
    };
  }

  /**
   * Attempt DB persistence (lazy import, silent catch).
   * Returns true if successful, false if DB is not available.
   */
  async persistToDb(
    machineId: string,
    serialized: SerializedStateMachine
  ): Promise<boolean> {
    try {
      const dbModule: Record<string, unknown> = await import(
        "../../db"
      ).catch(() => ({}));
      if (!dbModule || typeof dbModule.default !== "function") return false;
      const db = dbModule.default as (
        table: string
      ) => {
        insert: (row: Record<string, unknown>) => { onConflict: (col: string) => { merge: (cols: string[]) => Promise<unknown> } };
      };
      const json = JSON.stringify(serialized);
      await db("connector_state_machines")
        .insert({
          machine_id: machineId,
          definition_id: serialized.definitionId,
          state_json: json,
          updated_at: new Date(),
        })
        .onConflict("machine_id")
        .merge(["state_json", "definition_id", "updated_at"]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Attempt to load from DB (lazy import, silent catch).
   */
  async loadFromDb(
    machineId: string
  ): Promise<SerializedStateMachine | null> {
    try {
      const dbModule: Record<string, unknown> = await import(
        "../../db"
      ).catch(() => ({}));
      if (!dbModule || typeof dbModule.default !== "function") return null;
      const db = dbModule.default as (
        table: string
      ) => {
        where: (col: string, val: string) => { first: () => Promise<Record<string, unknown> | undefined> };
      };
      const row = await db("connector_state_machines")
        .where("machine_id", machineId)
        .first();
      if (!row || typeof row.state_json !== "string") return null;
      return JSON.parse(row.state_json) as SerializedStateMachine;
    } catch {
      return null;
    }
  }
}

/* ================================================================== */
/*  5. StateTimeoutManager                                             */
/* ================================================================== */

interface ActiveTimeout {
  machineId: string;
  state: string;
  timer: ReturnType<typeof setTimeout>;
  startedAt: number;
  totalMs: number;
}

export class StateTimeoutManager {
  private activeTimeouts: Map<string, ActiveTimeout>;
  private onTimeout: ((machineId: string, state: string) => void) | null;

  constructor() {
    this.activeTimeouts = new Map<string, ActiveTimeout>();
    this.onTimeout = null;
  }

  setTimeoutHandler(
    handler: (machineId: string, state: string) => void
  ): void {
    this.onTimeout = handler;
  }

  startTimeout(machineId: string, state: string, timeoutMs: number): void {
    this.cancelTimeout(machineId);

    const timer = setTimeout(() => {
      this.activeTimeouts.delete(machineId);
      if (this.onTimeout) {
        this.onTimeout(machineId, state);
      }
    }, timeoutMs);

    timer.unref();

    this.activeTimeouts.set(machineId, {
      machineId,
      state,
      timer,
      startedAt: Date.now(),
      totalMs: timeoutMs,
    });
  }

  cancelTimeout(machineId: string): void {
    const existing = this.activeTimeouts.get(machineId);
    if (existing) {
      clearTimeout(existing.timer);
      this.activeTimeouts.delete(machineId);
    }
  }

  getActiveTimeouts(): TimeoutEntry[] {
    const result: TimeoutEntry[] = [];
    const now = Date.now();
    const entries = Array.from(this.activeTimeouts.entries());
    for (const [, entry] of entries) {
      const elapsed = now - entry.startedAt;
      const remaining = Math.max(0, entry.totalMs - elapsed);
      result.push({
        machineId: entry.machineId,
        state: entry.state,
        remainingMs: remaining,
        totalMs: entry.totalMs,
      });
    }
    return result;
  }

  hasTimeout(machineId: string): boolean {
    return this.activeTimeouts.has(machineId);
  }

  clearAll(): void {
    const entries = Array.from(this.activeTimeouts.values());
    for (const entry of entries) {
      clearTimeout(entry.timer);
    }
    this.activeTimeouts.clear();
  }

  getCount(): number {
    return this.activeTimeouts.size;
  }
}

/* ================================================================== */
/*  6. StateMachineRegistry                                            */
/* ================================================================== */

export class StateMachineRegistry {
  private machines: Map<string, StateMachine>;
  private definitions: Map<string, StateDefinition>;
  private persistence: StatePersistence;
  private timeoutManager: StateTimeoutManager;

  constructor(
    persistence: StatePersistence,
    timeoutManager: StateTimeoutManager
  ) {
    this.machines = new Map<string, StateMachine>();
    this.definitions = new Map<string, StateDefinition>();
    this.persistence = persistence;
    this.timeoutManager = timeoutManager;
  }

  /* ---- Definition management ---- */

  registerDefinition(definition: StateDefinition): void {
    this.definitions.set(definition.id, definition);
  }

  getDefinition(definitionId: string): StateDefinition | undefined {
    return this.definitions.get(definitionId);
  }

  getDefinitions(): StateDefinition[] {
    return Array.from(this.definitions.values());
  }

  /* ---- Machine management ---- */

  register(machineId: string, config: StateMachineConfig): StateMachine {
    if (this.machines.has(machineId)) {
      throw new Error(`State machine "${machineId}" is already registered`);
    }

    const machine = new StateMachine(machineId, config);

    /* Subscribe to transitions for auto-persistence and timeout management */
    machine.subscribe((_ctx, _transition) => {
      this.onMachineTransition(machineId, machine);
    });

    this.machines.set(machineId, machine);

    /* Start timeout if applicable */
    this.startTimeoutIfNeeded(machineId, machine);

    /* Best-effort persist on creation */
    if (config.persistenceEnabled) {
      try {
        this.persistence.save(machineId, machine.serialize());
      } catch {
        /* best effort */
      }
    }

    return machine;
  }

  unregister(machineId: string): boolean {
    const machine = this.machines.get(machineId);
    if (!machine) return false;

    this.timeoutManager.cancelTimeout(machineId);
    this.persistence.delete(machineId);
    this.machines.delete(machineId);
    return true;
  }

  get(machineId: string): StateMachine | undefined {
    return this.machines.get(machineId);
  }

  getAll(): Map<string, StateMachine> {
    return new Map(Array.from(this.machines.entries()));
  }

  has(machineId: string): boolean {
    return this.machines.has(machineId);
  }

  getByState(state: string): StateMachine[] {
    const result: StateMachine[] = [];
    const machines = Array.from(this.machines.values());
    for (const m of machines) {
      if (m.getState() === state) {
        result.push(m);
      }
    }
    return result;
  }

  getByDefinition(definitionId: string): StateMachine[] {
    const result: StateMachine[] = [];
    const machines = Array.from(this.machines.values());
    for (const m of machines) {
      if (m.getDefinitionId() === definitionId) {
        result.push(m);
      }
    }
    return result;
  }

  getMachineCount(): number {
    return this.machines.size;
  }

  /* ---- Persistence bulk operations ---- */

  saveToStorage(): void {
    const entries = Array.from(this.machines.entries());
    for (const [id, machine] of entries) {
      if (machine.isPersistenceEnabled()) {
        try {
          this.persistence.save(id, machine.serialize());
        } catch {
          /* best effort */
        }
      }
    }
  }

  loadFromStorage(): number {
    const stored = this.persistence.loadAll();
    let loaded = 0;
    const entries = Array.from(stored.entries());
    for (const [id, serialized] of entries) {
      if (this.machines.has(id)) continue;
      const def = this.definitions.get(serialized.definitionId);
      if (!def) continue;
      try {
        const machine = StateMachine.deserialize(serialized, def);
        machine.subscribe(() => {
          this.onMachineTransition(id, machine);
        });
        this.machines.set(id, machine);
        this.startTimeoutIfNeeded(id, machine);
        loaded++;
      } catch {
        /* skip corrupt entries */
      }
    }
    return loaded;
  }

  /* ---- Internal ---- */

  private onMachineTransition(
    machineId: string,
    machine: StateMachine
  ): void {
    /* Re-arm timeout */
    this.timeoutManager.cancelTimeout(machineId);
    this.startTimeoutIfNeeded(machineId, machine);

    /* Best-effort persist */
    if (machine.isPersistenceEnabled()) {
      try {
        this.persistence.save(machineId, machine.serialize());
      } catch {
        /* best effort */
      }
    }
  }

  private startTimeoutIfNeeded(
    machineId: string,
    machine: StateMachine
  ): void {
    const timeouts = machine.getTimeouts();
    const currentState = machine.getState();
    const timeoutMs = timeouts.get(currentState);
    if (timeoutMs !== undefined && timeoutMs > 0) {
      this.timeoutManager.startTimeout(machineId, currentState, timeoutMs);
    }
  }
}

/* ================================================================== */
/*  7. StateAggregator                                                 */
/* ================================================================== */

export class StateAggregator {
  private registry: StateMachineRegistry;

  constructor(registry: StateMachineRegistry) {
    this.registry = registry;
  }

  getStateDistribution(
    definitionId?: string
  ): StateDistributionEntry[] {
    const machines = definitionId
      ? this.registry.getByDefinition(definitionId)
      : Array.from(this.registry.getAll().values());

    const total = machines.length;
    if (total === 0) return [];

    const counts = new Map<string, number>();
    for (const m of machines) {
      const state = m.getState();
      const current = counts.get(state) || 0;
      counts.set(state, current + 1);
    }

    const result: StateDistributionEntry[] = [];
    const entries = Array.from(counts.entries());
    for (const [state, count] of entries) {
      result.push({
        state,
        count,
        percentage: Math.round((count / total) * 10000) / 100,
      });
    }

    result.sort((a, b) => b.count - a.count);
    return result;
  }

  getTransitionFrequency(
    definitionId?: string,
    windowMs?: number
  ): TransitionFrequencyEntry[] {
    const machines = definitionId
      ? this.registry.getByDefinition(definitionId)
      : Array.from(this.registry.getAll().values());

    const cutoff = windowMs ? Date.now() - windowMs : 0;
    const freqMap = new Map<string, TransitionFrequencyEntry>();

    for (const m of machines) {
      const history = m.getHistory();
      for (const rec of history) {
        if (rec.timestamp < cutoff) continue;
        const key = `${rec.from}→${rec.to}→${rec.event}`;
        const existing = freqMap.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          freqMap.set(key, {
            from: rec.from,
            to: rec.to,
            event: rec.event,
            count: 1,
          });
        }
      }
    }

    const result = Array.from(freqMap.values());
    result.sort((a, b) => b.count - a.count);
    return result;
  }

  getAverageTimeInState(
    definitionId?: string,
    state?: string
  ): AverageTimeInStateEntry[] {
    const machines = definitionId
      ? this.registry.getByDefinition(definitionId)
      : Array.from(this.registry.getAll().values());

    /* Accumulate durations: state -> [durations in ms] */
    const durationsMap = new Map<string, number[]>();

    for (const m of machines) {
      const history = m.getHistory();
      for (let i = 0; i < history.length; i++) {
        const rec = history[i];
        const nextRec = i + 1 < history.length ? history[i + 1] : null;
        const duration = nextRec
          ? nextRec.timestamp - rec.timestamp
          : Date.now() - rec.timestamp;

        if (state && rec.to !== state) continue;

        const arr = durationsMap.get(rec.to) || [];
        arr.push(duration);
        durationsMap.set(rec.to, arr);
      }
    }

    const result: AverageTimeInStateEntry[] = [];
    const entries = Array.from(durationsMap.entries());
    for (const [s, durations] of entries) {
      if (durations.length === 0) continue;
      let sum = 0;
      for (const d of durations) sum += d;
      result.push({
        state: s,
        averageMs: Math.round(sum / durations.length),
        sampleCount: durations.length,
      });
    }

    result.sort((a, b) => b.averageMs - a.averageMs);
    return result;
  }

  getStuckMachines(thresholdMs: number): StuckMachineEntry[] {
    const now = Date.now();
    const result: StuckMachineEntry[] = [];
    const machines = Array.from(this.registry.getAll().values());

    for (const m of machines) {
      const ctx = m.getContext();
      const lastTransition = ctx.metadata.updatedAt;
      const elapsed = now - lastTransition;

      if (elapsed > thresholdMs) {
        result.push({
          machineId: ctx.machineId,
          state: ctx.currentState,
          stuckSinceMs: elapsed,
          lastTransitionAt: lastTransition,
        });
      }
    }

    result.sort((a, b) => b.stuckSinceMs - a.stuckSinceMs);
    return result;
  }

  getTransitionGraph(definitionId?: string): TransitionGraph {
    const machines = definitionId
      ? this.registry.getByDefinition(definitionId)
      : Array.from(this.registry.getAll().values());

    const graph: TransitionGraph = {};

    for (const m of machines) {
      const history = m.getHistory();
      for (const rec of history) {
        if (!graph[rec.from]) {
          graph[rec.from] = [];
        }
        const edges = graph[rec.from];
        let found = false;
        for (const edge of edges) {
          if (edge.to === rec.to && edge.event === rec.event) {
            edge.count += 1;
            found = true;
            break;
          }
        }
        if (!found) {
          edges.push({ to: rec.to, event: rec.event, count: 1 });
        }
      }
    }

    return graph;
  }
}

/* ================================================================== */
/*  8. ConnectorStateMachines — Pre-defined Definitions                */
/* ================================================================== */

/* ---- Connector Connection Machine ---- */

const connectorConnectionGuards: GuardDefinition[] = [
  {
    name: "canConnect",
    evaluate: (ctx: StateContext): boolean => {
      const maxRetries = (ctx.data.maxRetries as number) || 5;
      const retryCount = (ctx.data.retryCount as number) || 0;
      return retryCount < maxRetries;
    },
  },
  {
    name: "hasCredentials",
    evaluate: (ctx: StateContext): boolean => {
      return ctx.data.hasCredentials === true;
    },
  },
];

const connectorConnectionEffects: EffectDefinition[] = [
  {
    name: "logTransition",
    execute: async (
      ctx: StateContext,
      transition: TransitionRecord
    ): Promise<void> => {
      const entry = {
        event: "connector_state_transition",
        machineId: ctx.machineId,
        from: transition.from,
        to: transition.to,
        triggerEvent: transition.event,
        timestamp: transition.timestamp,
      };
      /* Log to console in structured format (best-effort) */
      try {
        if (typeof console !== "undefined" && console.log) {
          console.log(JSON.stringify(entry));
        }
      } catch {
        /* silent */
      }
    },
  },
  {
    name: "resetRetryCount",
    execute: async (ctx: StateContext): Promise<void> => {
      ctx.data.retryCount = 0;
    },
  },
  {
    name: "incrementRetryCount",
    execute: async (ctx: StateContext): Promise<void> => {
      const current = (ctx.data.retryCount as number) || 0;
      ctx.data.retryCount = current + 1;
    },
  },
];

export const CONNECTOR_CONNECTION_DEFINITION: StateDefinition = {
  id: "connector_connection",
  states: [
    "disconnected",
    "connecting",
    "connected",
    "disconnecting",
    "error",
    "reconnecting",
  ],
  initialState: "disconnected",
  transitions: [
    {
      from: "disconnected",
      to: "connecting",
      event: "connect",
      guard: "hasCredentials",
    },
    {
      from: "connecting",
      to: "connected",
      event: "connected",
      effect: "resetRetryCount",
    },
    {
      from: "connecting",
      to: "error",
      event: "error",
      effect: "logTransition",
    },
    {
      from: "connected",
      to: "disconnecting",
      event: "disconnect",
    },
    {
      from: "disconnecting",
      to: "disconnected",
      event: "disconnected",
      effect: "logTransition",
    },
    {
      from: "disconnecting",
      to: "error",
      event: "error",
    },
    {
      from: "error",
      to: "reconnecting",
      event: "retry",
      guard: "canConnect",
      effect: "incrementRetryCount",
    },
    {
      from: "error",
      to: "disconnected",
      event: "disconnect",
    },
    {
      from: "reconnecting",
      to: "connected",
      event: "connected",
      effect: "resetRetryCount",
    },
    {
      from: "reconnecting",
      to: "error",
      event: "error",
      effect: "logTransition",
    },
    {
      from: "connected",
      to: "error",
      event: "error",
      effect: "logTransition",
    },
    {
      from: "connected",
      to: "reconnecting",
      event: "retry",
      effect: "incrementRetryCount",
    },
  ],
  guards: connectorConnectionGuards,
  effects: connectorConnectionEffects,
};

/* ---- Operation Execution Machine ---- */

const operationExecutionGuards: GuardDefinition[] = [
  {
    name: "canRetry",
    evaluate: (ctx: StateContext): boolean => {
      const maxRetries = (ctx.data.maxRetries as number) || 3;
      const retryCount = (ctx.data.retryCount as number) || 0;
      return retryCount < maxRetries;
    },
  },
  {
    name: "isRetryable",
    evaluate: (ctx: StateContext): boolean => {
      const errorType = ctx.data.errorType as string | undefined;
      const nonRetryable = new Set([
        "authentication_error",
        "authorization_error",
        "validation_error",
        "not_found",
        "conflict",
      ]);
      if (!errorType) return true;
      return !nonRetryable.has(errorType);
    },
  },
];

const operationExecutionEffects: EffectDefinition[] = [
  {
    name: "logTransition",
    execute: async (
      ctx: StateContext,
      transition: TransitionRecord
    ): Promise<void> => {
      const entry = {
        event: "operation_state_transition",
        machineId: ctx.machineId,
        from: transition.from,
        to: transition.to,
        triggerEvent: transition.event,
        timestamp: transition.timestamp,
      };
      try {
        if (typeof console !== "undefined" && console.log) {
          console.log(JSON.stringify(entry));
        }
      } catch {
        /* silent */
      }
    },
  },
  {
    name: "incrementRetryCount",
    execute: async (ctx: StateContext): Promise<void> => {
      const current = (ctx.data.retryCount as number) || 0;
      ctx.data.retryCount = current + 1;
    },
  },
  {
    name: "recordCompletionTime",
    execute: async (ctx: StateContext): Promise<void> => {
      ctx.data.completedAt = Date.now();
      const startedAt = ctx.data.startedAt as number | undefined;
      if (startedAt) {
        ctx.data.durationMs = Date.now() - startedAt;
      }
    },
  },
];

export const OPERATION_EXECUTION_DEFINITION: StateDefinition = {
  id: "operation_execution",
  states: [
    "idle",
    "validating",
    "executing",
    "retrying",
    "completed",
    "failed",
    "cancelled",
  ],
  initialState: "idle",
  transitions: [
    {
      from: "idle",
      to: "validating",
      event: "start",
      effect: "logTransition",
    },
    {
      from: "validating",
      to: "executing",
      event: "validated",
    },
    {
      from: "validating",
      to: "failed",
      event: "fail",
      effect: "logTransition",
    },
    {
      from: "executing",
      to: "completed",
      event: "complete",
      effect: "recordCompletionTime",
    },
    {
      from: "executing",
      to: "retrying",
      event: "retry",
      guard: "canRetry",
      effect: "incrementRetryCount",
    },
    {
      from: "executing",
      to: "failed",
      event: "fail",
      effect: "logTransition",
    },
    {
      from: "executing",
      to: "cancelled",
      event: "cancel",
    },
    {
      from: "retrying",
      to: "executing",
      event: "execute",
    },
    {
      from: "retrying",
      to: "failed",
      event: "fail",
      effect: "logTransition",
    },
    {
      from: "retrying",
      to: "cancelled",
      event: "cancel",
    },
    {
      from: ["idle", "validating"],
      to: "cancelled",
      event: "cancel",
    },
  ],
  guards: operationExecutionGuards,
  effects: operationExecutionEffects,
};

/* ---- Credential Lifecycle Machine ---- */

const credentialLifecycleGuards: GuardDefinition[] = [
  {
    name: "hasRefreshToken",
    evaluate: (ctx: StateContext): boolean => {
      return (
        typeof ctx.data.refreshToken === "string" &&
        ctx.data.refreshToken.length > 0
      );
    },
  },
  {
    name: "withinRefreshWindow",
    evaluate: (ctx: StateContext): boolean => {
      const expiresAt = ctx.data.expiresAt as number | undefined;
      if (!expiresAt) return false;
      const now = Date.now();
      /* Must refresh at least 30s before expiry */
      return now < expiresAt - 30_000;
    },
  },
];

const credentialLifecycleEffects: EffectDefinition[] = [
  {
    name: "logTransition",
    execute: async (
      ctx: StateContext,
      transition: TransitionRecord
    ): Promise<void> => {
      const entry = {
        event: "credential_state_transition",
        machineId: ctx.machineId,
        from: transition.from,
        to: transition.to,
        triggerEvent: transition.event,
        timestamp: transition.timestamp,
      };
      try {
        if (typeof console !== "undefined" && console.log) {
          console.log(JSON.stringify(entry));
        }
      } catch {
        /* silent */
      }
    },
  },
  {
    name: "recordRefreshTime",
    execute: async (ctx: StateContext): Promise<void> => {
      ctx.data.lastRefreshedAt = Date.now();
      const count = (ctx.data.refreshCount as number) || 0;
      ctx.data.refreshCount = count + 1;
    },
  },
  {
    name: "clearTokens",
    execute: async (ctx: StateContext): Promise<void> => {
      ctx.data.accessToken = undefined;
      ctx.data.refreshToken = undefined;
      ctx.data.expiresAt = undefined;
      ctx.data.revokedAt = Date.now();
    },
  },
];

export const CREDENTIAL_LIFECYCLE_DEFINITION: StateDefinition = {
  id: "credential_lifecycle",
  states: [
    "pending",
    "active",
    "expiring",
    "expired",
    "refreshing",
    "revoked",
  ],
  initialState: "pending",
  transitions: [
    {
      from: "pending",
      to: "active",
      event: "activate",
      effect: "logTransition",
    },
    {
      from: "active",
      to: "expiring",
      event: "expiring_soon",
    },
    {
      from: "active",
      to: "revoked",
      event: "revoke",
      effect: "clearTokens",
    },
    {
      from: "expiring",
      to: "refreshing",
      event: "refresh",
      guard: "hasRefreshToken",
    },
    {
      from: "expiring",
      to: "expired",
      event: "expire",
    },
    {
      from: "expiring",
      to: "revoked",
      event: "revoke",
      effect: "clearTokens",
    },
    {
      from: "refreshing",
      to: "active",
      event: "refreshed",
      effect: "recordRefreshTime",
    },
    {
      from: "refreshing",
      to: "expired",
      event: "expire",
      effect: "logTransition",
    },
    {
      from: "refreshing",
      to: "revoked",
      event: "revoke",
      effect: "clearTokens",
    },
    {
      from: "expired",
      to: "refreshing",
      event: "refresh",
      guard: "hasRefreshToken",
    },
    {
      from: "expired",
      to: "revoked",
      event: "revoke",
      effect: "clearTokens",
    },
    {
      from: "expired",
      to: "pending",
      event: "activate",
    },
  ],
  guards: credentialLifecycleGuards,
  effects: credentialLifecycleEffects,
};

/* Convenience array of all built-in definitions */
export const BUILT_IN_STATE_DEFINITIONS: StateDefinition[] = [
  CONNECTOR_CONNECTION_DEFINITION,
  OPERATION_EXECUTION_DEFINITION,
  CREDENTIAL_LIFECYCLE_DEFINITION,
];

/* ================================================================== */
/*  9. ConnectorStateManager — Facade Singleton                        */
/* ================================================================== */

export class ConnectorStateManager {
  private readonly persistence: StatePersistence;
  private readonly timeoutManager: StateTimeoutManager;
  private readonly registry: StateMachineRegistry;
  private readonly aggregator: StateAggregator;
  private disposed: boolean;
  private flushTimer: ReturnType<typeof setInterval> | null;

  constructor() {
    this.persistence = new StatePersistence();
    this.timeoutManager = new StateTimeoutManager();
    this.registry = new StateMachineRegistry(
      this.persistence,
      this.timeoutManager
    );
    this.aggregator = new StateAggregator(this.registry);
    this.disposed = false;
    this.flushTimer = null;

    /* Register built-in definitions */
    for (const def of BUILT_IN_STATE_DEFINITIONS) {
      this.registry.registerDefinition(def);
    }

    /* Wire timeout handler: auto-fire "timeout" event */
    this.timeoutManager.setTimeoutHandler(
      (machineId: string, _state: string) => {
        const machine = this.registry.get(machineId);
        if (machine && machine.canTransition("timeout")) {
          machine.send("timeout").catch(() => {
            /* best effort — timeout events are advisory */
          });
        }
      }
    );

    /* Periodic flush to persistence every 60s */
    this.flushTimer = setInterval(() => {
      if (!this.disposed) {
        this.registry.saveToStorage();
      }
    }, 60_000);
    this.flushTimer.unref();
  }

  /* ---- Machine lifecycle ---- */

  createMachine(
    machineId: string,
    definitionId: string,
    initialData?: Record<string, unknown>
  ): StateMachine {
    if (this.disposed) {
      throw new Error("ConnectorStateManager has been disposed");
    }

    const definition = this.registry.getDefinition(definitionId);
    if (!definition) {
      throw new Error(
        `Unknown state machine definition: "${definitionId}". ` +
          `Available: ${this.registry
            .getDefinitions()
            .map((d) => d.id)
            .join(", ")}`
      );
    }

    const config: StateMachineConfig = {
      definition,
      persistenceEnabled: true,
      historySize: 100,
      timeouts: new Map<string, number>(),
    };

    const machine = this.registry.register(machineId, config);

    if (initialData) {
      const keys = Object.keys(initialData);
      for (const k of keys) {
        machine.setData(k, initialData[k]);
      }
    }

    return machine;
  }

  /**
   * Create a machine with a custom definition (not pre-registered).
   */
  createMachineWithDefinition(
    machineId: string,
    definition: StateDefinition,
    options?: {
      persistenceEnabled?: boolean;
      historySize?: number;
      timeouts?: Map<string, number>;
      initialData?: Record<string, unknown>;
    }
  ): StateMachine {
    if (this.disposed) {
      throw new Error("ConnectorStateManager has been disposed");
    }

    /* Ensure definition is registered */
    if (!this.registry.getDefinition(definition.id)) {
      this.registry.registerDefinition(definition);
    }

    const config: StateMachineConfig = {
      definition,
      persistenceEnabled: options?.persistenceEnabled ?? true,
      historySize: options?.historySize ?? 100,
      timeouts: options?.timeouts ?? new Map<string, number>(),
    };

    const machine = this.registry.register(machineId, config);

    if (options?.initialData) {
      const keys = Object.keys(options.initialData);
      for (const k of keys) {
        machine.setData(k, options.initialData[k]);
      }
    }

    return machine;
  }

  getMachine(machineId: string): StateMachine | undefined {
    return this.registry.get(machineId);
  }

  hasMachine(machineId: string): boolean {
    return this.registry.has(machineId);
  }

  removeMachine(machineId: string): boolean {
    return this.registry.unregister(machineId);
  }

  /* ---- Delegate operations ---- */

  async send(
    machineId: string,
    event: string,
    payload?: Record<string, unknown>
  ): Promise<TransitionRecord> {
    const machine = this.registry.get(machineId);
    if (!machine) {
      throw new Error(`State machine "${machineId}" not found`);
    }
    return machine.send(event, payload);
  }

  getState(machineId: string): string {
    const machine = this.registry.get(machineId);
    if (!machine) {
      throw new Error(`State machine "${machineId}" not found`);
    }
    return machine.getState();
  }

  getContext(machineId: string): StateContext {
    const machine = this.registry.get(machineId);
    if (!machine) {
      throw new Error(`State machine "${machineId}" not found`);
    }
    return machine.getContext();
  }

  canTransition(machineId: string, event: string): boolean {
    const machine = this.registry.get(machineId);
    if (!machine) return false;
    return machine.canTransition(event);
  }

  getHistory(machineId: string, limit?: number): TransitionRecord[] {
    const machine = this.registry.get(machineId);
    if (!machine) return [];
    return machine.getHistory(limit);
  }

  /* ---- Query operations ---- */

  getMachinesByState(state: string): StateMachine[] {
    return this.registry.getByState(state);
  }

  getMachinesByDefinition(definitionId: string): StateMachine[] {
    return this.registry.getByDefinition(definitionId);
  }

  getMachineCount(): number {
    return this.registry.getMachineCount();
  }

  /* ---- Aggregation / reporting ---- */

  getStateDistribution(
    definitionId?: string
  ): StateDistributionEntry[] {
    return this.aggregator.getStateDistribution(definitionId);
  }

  getTransitionFrequency(
    definitionId?: string,
    windowMs?: number
  ): TransitionFrequencyEntry[] {
    return this.aggregator.getTransitionFrequency(definitionId, windowMs);
  }

  getAverageTimeInState(
    definitionId?: string,
    state?: string
  ): AverageTimeInStateEntry[] {
    return this.aggregator.getAverageTimeInState(definitionId, state);
  }

  getStuckMachines(thresholdMs: number): StuckMachineEntry[] {
    return this.aggregator.getStuckMachines(thresholdMs);
  }

  getTransitionGraph(definitionId?: string): TransitionGraph {
    return this.aggregator.getTransitionGraph(definitionId);
  }

  getStateReport(): StateReport {
    return {
      totalMachines: this.registry.getMachineCount(),
      distribution: this.aggregator.getStateDistribution(),
      stuckMachines: this.aggregator.getStuckMachines(300_000), /* 5 min */
      transitionFrequency: this.aggregator.getTransitionFrequency(
        undefined,
        3_600_000 /* 1 hour */
      ),
      timestamp: Date.now(),
    };
  }

  /* ---- Timeout queries ---- */

  getActiveTimeouts(): TimeoutEntry[] {
    return this.timeoutManager.getActiveTimeouts();
  }

  /* ---- Persistence ---- */

  getStorageStats(): StorageStats {
    return this.persistence.getStorageStats();
  }

  saveAll(): void {
    this.registry.saveToStorage();
  }

  loadAll(): number {
    return this.registry.loadFromStorage();
  }

  /* ---- Definitions ---- */

  registerDefinition(definition: StateDefinition): void {
    this.registry.registerDefinition(definition);
  }

  getDefinition(
    definitionId: string
  ): StateDefinition | undefined {
    return this.registry.getDefinition(definitionId);
  }

  getDefinitions(): StateDefinition[] {
    return this.registry.getDefinitions();
  }

  /* ---- Internals exposed for testing ---- */

  getPersistence(): StatePersistence {
    return this.persistence;
  }

  getTimeoutManager(): StateTimeoutManager {
    return this.timeoutManager;
  }

  getRegistry(): StateMachineRegistry {
    return this.registry;
  }

  getAggregator(): StateAggregator {
    return this.aggregator;
  }

  /* ---- Lifecycle ---- */

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    /* Persist all state */
    try {
      this.registry.saveToStorage();
    } catch {
      /* best effort */
    }

    /* Clear flush timer */
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    /* Clear all timeouts */
    this.timeoutManager.clearAll();
  }

  isDisposed(): boolean {
    return this.disposed;
  }
}

/* ================================================================== */
/*  10. Utility Helpers                                                */
/* ================================================================== */

/**
 * Generate a unique machine ID using crypto.
 */
export function generateMachineId(prefix?: string): string {
  const id = crypto.randomBytes(12).toString("hex");
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Create a fingerprint hash for a state context (useful for change detection).
 */
export function hashStateContext(context: StateContext): string {
  const payload = JSON.stringify({
    machineId: context.machineId,
    currentState: context.currentState,
    data: context.data,
    version: context.metadata.version,
  });
  return crypto
    .createHash("sha256")
    .update(payload)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Validate that a state definition is structurally correct.
 * Returns a list of issues (empty = valid).
 */
export function validateStateDefinition(
  definition: StateDefinition
): string[] {
  const issues: string[] = [];

  if (!definition.id || definition.id.trim().length === 0) {
    issues.push("definition id is empty");
  }
  if (!definition.states || definition.states.length === 0) {
    issues.push("states array is empty");
  }

  const stateSet = new Set(definition.states);

  if (!stateSet.has(definition.initialState)) {
    issues.push(
      `initial state "${definition.initialState}" not in states array`
    );
  }

  for (const t of definition.transitions) {
    const froms = Array.isArray(t.from) ? t.from : [t.from];
    for (const f of froms) {
      if (!stateSet.has(f)) {
        issues.push(
          `transition "${t.event}": source "${f}" not in states`
        );
      }
    }
    if (!stateSet.has(t.to)) {
      issues.push(
        `transition "${t.event}": target "${t.to}" not in states`
      );
    }
  }

  const guardNames = new Set<string>();
  if (definition.guards) {
    for (const g of definition.guards) {
      guardNames.add(g.name);
    }
  }
  for (const t of definition.transitions) {
    if (t.guard && !guardNames.has(t.guard)) {
      issues.push(
        `transition "${t.event}": guard "${t.guard}" not defined`
      );
    }
  }

  const effectNames = new Set<string>();
  if (definition.effects) {
    for (const e of definition.effects) {
      effectNames.add(e.name);
    }
  }
  for (const t of definition.transitions) {
    if (t.effect && !effectNames.has(t.effect)) {
      issues.push(
        `transition "${t.event}": effect "${t.effect}" not defined`
      );
    }
  }

  /* Check for duplicate state names */
  const seen = new Set<string>();
  for (const s of definition.states) {
    if (seen.has(s)) {
      issues.push(`duplicate state name: "${s}"`);
    }
    seen.add(s);
  }

  return issues;
}

/**
 * Create a simple state machine config with sensible defaults.
 */
export function createSimpleConfig(
  definition: StateDefinition,
  options?: {
    persistenceEnabled?: boolean;
    historySize?: number;
    timeouts?: Map<string, number>;
  }
): StateMachineConfig {
  return {
    definition,
    persistenceEnabled: options?.persistenceEnabled ?? true,
    historySize: options?.historySize ?? 100,
    timeouts: options?.timeouts ?? new Map<string, number>(),
  };
}

/**
 * Build a DOT-format graph string from a state definition.
 * Useful for visualization (Graphviz).
 */
export function stateDefinitionToDot(
  definition: StateDefinition
): string {
  const lines: string[] = [];
  lines.push(`digraph "${definition.id}" {`);
  lines.push("  rankdir=LR;");
  lines.push(`  node [shape=circle];`);
  lines.push(`  __start [shape=point, width=0.2];`);
  lines.push(`  __start -> "${definition.initialState}";`);

  for (const t of definition.transitions) {
    const froms = Array.isArray(t.from) ? t.from : [t.from];
    for (const f of froms) {
      let label = t.event;
      if (t.guard) label += ` [${t.guard}]`;
      if (t.effect) label += ` / ${t.effect}`;
      lines.push(`  "${f}" -> "${t.to}" [label="${label}"];`);
    }
  }

  lines.push("}");
  return lines.join("\n");
}

/* ================================================================== */
/*  11. Singleton Export                                                */
/* ================================================================== */

export const connectorStateManager = new ConnectorStateManager();
