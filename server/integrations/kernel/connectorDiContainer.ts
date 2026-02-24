/**
 * connectorDiContainer.ts
 *
 * Dependency injection container for the connector kernel.
 * Provides service lifecycle management, dependency graph resolution,
 * interceptor chains, scoped containers, and diagnostic tooling.
 */

const { EventEmitter: DiEventEmitter } = require("events");

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ServiceLifecycle = "singleton" | "transient" | "scoped";

export type ServiceState = "pending" | "initializing" | "ready" | "error" | "disposed";

export interface ServiceDescriptor<T = unknown> {
  name: string;
  factory: (...args: unknown[]) => T | Promise<T>;
  lifecycle: ServiceLifecycle;
  dependencies: string[];
  tags: string[];
  priority: number;
  lazy: boolean;
  description?: string;
  healthCheck?: HealthCheckFn;
  onDispose?: (instance: T) => void | Promise<void>;
}

export interface ServiceInstance<T = unknown> {
  descriptor: ServiceDescriptor<T>;
  instance: T | null;
  state: ServiceState;
  initializedAt: number | null;
  disposedAt: number | null;
  initDurationMs: number;
  error: string | null;
  accessCount: number;
  lastAccessedAt: number | null;
  scopeId: string | null;
}

export interface ContainerScope {
  id: string;
  parentScopeId: string | null;
  instances: Map<string, ServiceInstance>;
  createdAt: number;
  disposedAt: number | null;
  metadata: Record<string, unknown>;
}

export interface ServiceHealthReport {
  name: string;
  state: ServiceState;
  healthy: boolean;
  message: string;
  latencyMs: number;
  checkedAt: number;
}

export interface ContainerDiagnostics {
  totalRegistered: number;
  totalInitialized: number;
  totalDisposed: number;
  totalErrors: number;
  serviceStates: Record<string, ServiceState>;
  scopeCount: number;
  initOrder: string[];
  avgInitTimeMs: number;
  uptime: number;
}

export interface InitializationTraceEntry {
  serviceName: string;
  phase: "start" | "end" | "error";
  timestamp: number;
  durationMs?: number;
  error?: string;
  dependencies: string[];
  level: number;
}

export interface ServiceInterceptor {
  name: string;
  pattern: string | RegExp;
  priority: number;
  before?: (serviceName: string, args: unknown[]) => unknown[] | void;
  after?: (serviceName: string, result: unknown) => unknown | void;
  onError?: (serviceName: string, error: Error) => void;
}

export type HealthCheckFn = () => Promise<{ healthy: boolean; message: string }> | { healthy: boolean; message: string };

export interface ServiceRegistrationOptions {
  name: string;
  factory: (...args: unknown[]) => unknown | Promise<unknown>;
  lifecycle?: ServiceLifecycle;
  dependencies?: string[];
  tags?: string[];
  priority?: number;
  lazy?: boolean;
  description?: string;
  healthCheck?: HealthCheckFn;
  onDispose?: (instance: unknown) => void | Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  ServiceGraph                                                       */
/* ------------------------------------------------------------------ */

export class ServiceGraph {
  private adjacencyList: Map<string, Set<string>>;
  private reverseAdjacencyList: Map<string, Set<string>>;
  private nodeMetadata: Map<string, { priority: number; tags: string[] }>;

  constructor() {
    this.adjacencyList = new Map();
    this.reverseAdjacencyList = new Map();
    this.nodeMetadata = new Map();
  }

  /**
   * Add a node (service) with its dependencies.
   */
  addNode(name: string, dependencies: string[], priority = 0, tags: string[] = []): void {
    if (!this.adjacencyList.has(name)) {
      this.adjacencyList.set(name, new Set());
    }
    if (!this.reverseAdjacencyList.has(name)) {
      this.reverseAdjacencyList.set(name, new Set());
    }

    this.nodeMetadata.set(name, { priority, tags });

    for (const dep of dependencies) {
      if (!this.adjacencyList.has(dep)) {
        this.adjacencyList.set(dep, new Set());
      }
      if (!this.reverseAdjacencyList.has(dep)) {
        this.reverseAdjacencyList.set(dep, new Set());
      }

      // name depends on dep: edge from dep -> name
      this.adjacencyList.get(name)!.add(dep);
      this.reverseAdjacencyList.get(dep)!.add(name);
    }
  }

  /**
   * Remove a node from the graph.
   */
  removeNode(name: string): void {
    // Remove all edges to this node
    const deps = this.adjacencyList.get(name);
    if (deps) {
      for (const dep of Array.from(deps)) {
        const rev = this.reverseAdjacencyList.get(dep);
        if (rev) rev.delete(name);
      }
    }

    // Remove all edges from this node
    const dependents = this.reverseAdjacencyList.get(name);
    if (dependents) {
      for (const dependent of Array.from(dependents)) {
        const adj = this.adjacencyList.get(dependent);
        if (adj) adj.delete(name);
      }
    }

    this.adjacencyList.delete(name);
    this.reverseAdjacencyList.delete(name);
    this.nodeMetadata.delete(name);
  }

  /**
   * Topological sort using Kahn's algorithm.
   * Returns services in initialization order (dependencies first).
   */
  topologicalSort(): string[] {
    const inDegree = new Map<string, number>();
    for (const node of Array.from(this.adjacencyList.keys())) {
      inDegree.set(node, 0);
    }

    // Calculate in-degrees (number of dependencies each node has)
    for (const [node, deps] of Array.from(this.adjacencyList.entries())) {
      inDegree.set(node, deps.size);
    }

    // Start with nodes that have no dependencies
    const queue: string[] = [];
    for (const [node, degree] of Array.from(inDegree.entries())) {
      if (degree === 0) {
        queue.push(node);
      }
    }

    // Sort queue by priority (higher priority first among same-level nodes)
    queue.sort((a, b) => {
      const pA = this.nodeMetadata.get(a)?.priority ?? 0;
      const pB = this.nodeMetadata.get(b)?.priority ?? 0;
      return pB - pA;
    });

    const result: string[] = [];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node)) continue;
      visited.add(node);
      result.push(node);

      // For each node that depends on the current node
      const dependents = this.reverseAdjacencyList.get(node);
      if (dependents) {
        const nextBatch: string[] = [];
        for (const dependent of Array.from(dependents)) {
          const newDegree = (inDegree.get(dependent) ?? 1) - 1;
          inDegree.set(dependent, newDegree);
          if (newDegree === 0 && !visited.has(dependent)) {
            nextBatch.push(dependent);
          }
        }

        // Sort next batch by priority
        nextBatch.sort((a, b) => {
          const pA = this.nodeMetadata.get(a)?.priority ?? 0;
          const pB = this.nodeMetadata.get(b)?.priority ?? 0;
          return pB - pA;
        });

        for (const n of nextBatch) {
          queue.push(n);
        }
      }
    }

    // Check for cycles (not all nodes visited)
    if (result.length !== this.adjacencyList.size) {
      const unvisited = Array.from(this.adjacencyList.keys()).filter((n) => !visited.has(n));
      throw new Error(
        `Circular dependency detected. Unresolvable services: ${unvisited.join(", ")}`
      );
    }

    return result;
  }

  /**
   * Detect cycles in the dependency graph using DFS.
   * Returns an array of cycles (each cycle is an array of service names).
   */
  detectCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const pathStack: string[] = [];

    const dfs = (node: string): void => {
      visited.add(node);
      recursionStack.add(node);
      pathStack.push(node);

      const deps = this.adjacencyList.get(node);
      if (deps) {
        for (const dep of Array.from(deps)) {
          if (!visited.has(dep)) {
            dfs(dep);
          } else if (recursionStack.has(dep)) {
            // Found a cycle
            const cycleStart = pathStack.indexOf(dep);
            if (cycleStart >= 0) {
              const cycle = pathStack.slice(cycleStart);
              cycle.push(dep); // Close the cycle
              cycles.push(cycle);
            }
          }
        }
      }

      pathStack.pop();
      recursionStack.delete(node);
    };

    for (const node of Array.from(this.adjacencyList.keys())) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return cycles;
  }

  /**
   * Get initialization levels (groups of services that can be initialized in parallel).
   */
  getInitializationLevels(): string[][] {
    const inDegree = new Map<string, number>();
    for (const [node, deps] of Array.from(this.adjacencyList.entries())) {
      inDegree.set(node, deps.size);
    }

    const levels: string[][] = [];
    const remaining = new Set(Array.from(this.adjacencyList.keys()));

    while (remaining.size > 0) {
      const level: string[] = [];
      for (const node of Array.from(remaining)) {
        if ((inDegree.get(node) ?? 0) === 0) {
          level.push(node);
        }
      }

      if (level.length === 0) {
        // All remaining nodes have dependencies — circular
        break;
      }

      // Sort by priority within level
      level.sort((a, b) => {
        const pA = this.nodeMetadata.get(a)?.priority ?? 0;
        const pB = this.nodeMetadata.get(b)?.priority ?? 0;
        return pB - pA;
      });

      for (const node of level) {
        remaining.delete(node);
        const dependents = this.reverseAdjacencyList.get(node);
        if (dependents) {
          for (const dependent of Array.from(dependents)) {
            const cur = inDegree.get(dependent) ?? 1;
            inDegree.set(dependent, cur - 1);
          }
        }
      }

      levels.push(level);
    }

    return levels;
  }

  /**
   * Get the direct dependents of a service (services that depend on it).
   */
  getDependents(name: string): string[] {
    const rev = this.reverseAdjacencyList.get(name);
    if (!rev) return [];
    return Array.from(rev);
  }

  /**
   * Get the direct dependencies of a service.
   */
  getDependencies(name: string): string[] {
    const deps = this.adjacencyList.get(name);
    if (!deps) return [];
    return Array.from(deps);
  }

  /**
   * Get all transitive dependencies of a service.
   */
  getTransitiveDeps(name: string): string[] {
    const result = new Set<string>();
    const queue = [name];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const deps = this.adjacencyList.get(current);
      if (deps) {
        for (const dep of Array.from(deps)) {
          if (!visited.has(dep)) {
            result.add(dep);
            queue.push(dep);
          }
        }
      }
    }

    return Array.from(result);
  }

  /**
   * Get all transitive dependents of a service.
   */
  getTransitiveDependents(name: string): string[] {
    const result = new Set<string>();
    const queue = [name];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const dependents = this.reverseAdjacencyList.get(current);
      if (dependents) {
        for (const dep of Array.from(dependents)) {
          if (!visited.has(dep)) {
            result.add(dep);
            queue.push(dep);
          }
        }
      }
    }

    return Array.from(result);
  }

  /**
   * Visualize the graph as ASCII art.
   */
  visualize(): string {
    const lines: string[] = [];
    lines.push("=== Service Dependency Graph ===");
    lines.push("");

    const sorted = this.safeTopologicalSort();
    if (!sorted) {
      lines.push("ERROR: Circular dependencies detected!");
      const cycles = this.detectCycles();
      for (const cycle of cycles) {
        lines.push(`  Cycle: ${cycle.join(" -> ")}`);
      }
      return lines.join("\n");
    }

    for (const node of sorted) {
      const deps = this.getDependencies(node);
      const dependents = this.getDependents(node);
      const meta = this.nodeMetadata.get(node);
      const priority = meta?.priority ?? 0;
      const tags = meta?.tags ?? [];

      let line = `[${node}]`;
      if (priority !== 0) line += ` (priority: ${priority})`;
      if (tags.length > 0) line += ` #${tags.join(" #")}`;

      if (deps.length > 0) {
        line += ` <- ${deps.join(", ")}`;
      }
      if (dependents.length > 0) {
        line += ` -> ${dependents.join(", ")}`;
      }

      lines.push(line);
    }

    lines.push("");
    lines.push(`Total nodes: ${this.adjacencyList.size}`);

    const levels = this.getInitializationLevels();
    lines.push(`Initialization levels: ${levels.length}`);
    for (let i = 0; i < levels.length; i++) {
      lines.push(`  Level ${i}: ${levels[i].join(", ")}`);
    }

    return lines.join("\n");
  }

  /**
   * Safe topological sort that returns null instead of throwing.
   */
  private safeTopologicalSort(): string[] | null {
    try {
      return this.topologicalSort();
    } catch {
      return null;
    }
  }

  /**
   * Check if a node exists.
   */
  hasNode(name: string): boolean {
    return this.adjacencyList.has(name);
  }

  /**
   * Get all node names.
   */
  getNodes(): string[] {
    return Array.from(this.adjacencyList.keys());
  }

  /**
   * Get the total edge count.
   */
  getEdgeCount(): number {
    let count = 0;
    for (const deps of Array.from(this.adjacencyList.values())) {
      count += deps.size;
    }
    return count;
  }

  /**
   * Clear the graph.
   */
  clear(): void {
    this.adjacencyList.clear();
    this.reverseAdjacencyList.clear();
    this.nodeMetadata.clear();
  }
}

/* ------------------------------------------------------------------ */
/*  InterceptorChain                                                   */
/* ------------------------------------------------------------------ */

export class InterceptorChain {
  private interceptors: ServiceInterceptor[];

  constructor() {
    this.interceptors = [];
  }

  /**
   * Add an interceptor.
   */
  add(interceptor: ServiceInterceptor): void {
    this.interceptors.push(interceptor);
    // Sort by priority (lower number = higher priority)
    this.interceptors.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Remove an interceptor by name.
   */
  remove(name: string): boolean {
    const idx = this.interceptors.findIndex((i) => i.name === name);
    if (idx < 0) return false;
    this.interceptors.splice(idx, 1);
    return true;
  }

  /**
   * Get all interceptors matching a service name.
   */
  getMatching(serviceName: string): ServiceInterceptor[] {
    return this.interceptors.filter((interceptor) => {
      if (typeof interceptor.pattern === "string") {
        if (interceptor.pattern === "*") return true;
        return interceptor.pattern === serviceName;
      }
      return interceptor.pattern.test(serviceName);
    });
  }

  /**
   * Execute before interceptors.
   */
  executeBefore(serviceName: string, args: unknown[]): unknown[] {
    let currentArgs = args;
    const matching = this.getMatching(serviceName);
    for (const interceptor of matching) {
      if (interceptor.before) {
        const result = interceptor.before(serviceName, currentArgs);
        if (result !== undefined) {
          currentArgs = result;
        }
      }
    }
    return currentArgs;
  }

  /**
   * Execute after interceptors.
   */
  executeAfter(serviceName: string, result: unknown): unknown {
    let currentResult = result;
    const matching = this.getMatching(serviceName);
    for (const interceptor of matching) {
      if (interceptor.after) {
        const transformed = interceptor.after(serviceName, currentResult);
        if (transformed !== undefined) {
          currentResult = transformed;
        }
      }
    }
    return currentResult;
  }

  /**
   * Execute error interceptors.
   */
  executeOnError(serviceName: string, error: Error): void {
    const matching = this.getMatching(serviceName);
    for (const interceptor of matching) {
      if (interceptor.onError) {
        try {
          interceptor.onError(serviceName, error);
        } catch {
          // Interceptor error handlers should not throw
        }
      }
    }
  }

  /**
   * Get all interceptor names.
   */
  getNames(): string[] {
    return this.interceptors.map((i) => i.name);
  }

  /**
   * Get interceptor count.
   */
  get count(): number {
    return this.interceptors.length;
  }

  /**
   * Clear all interceptors.
   */
  clear(): void {
    this.interceptors = [];
  }
}

/* ------------------------------------------------------------------ */
/*  ServiceLocator (static global)                                     */
/* ------------------------------------------------------------------ */

export class ServiceLocator {
  private static globalContainer: KernelContainer | null = null;
  private static usageLog: Array<{ service: string; timestamp: number; caller?: string }> = [];
  private static readonly MAX_USAGE_LOG = 500;
  private static deprecationWarnings: Map<string, string> = new Map();
  private static warningEmitted: Set<string> = new Set();

  /**
   * Set the global container.
   */
  static setContainer(container: KernelContainer): void {
    ServiceLocator.globalContainer = container;
  }

  /**
   * Get the global container.
   */
  static getContainer(): KernelContainer | null {
    return ServiceLocator.globalContainer;
  }

  /**
   * Resolve a service from the global container.
   */
  static resolve<T = unknown>(name: string, caller?: string): T {
    if (!ServiceLocator.globalContainer) {
      throw new Error("ServiceLocator: No global container set. Call setContainer() first.");
    }

    // Check deprecation
    const deprecationMsg = ServiceLocator.deprecationWarnings.get(name);
    if (deprecationMsg && !ServiceLocator.warningEmitted.has(name)) {
      console.warn(`[ServiceLocator] DEPRECATED: ${name} - ${deprecationMsg}`);
      ServiceLocator.warningEmitted.add(name);
    }

    ServiceLocator.usageLog.push({ service: name, timestamp: Date.now(), caller });
    if (ServiceLocator.usageLog.length > ServiceLocator.MAX_USAGE_LOG) {
      ServiceLocator.usageLog = ServiceLocator.usageLog.slice(-ServiceLocator.MAX_USAGE_LOG);
    }

    return ServiceLocator.globalContainer.resolve<T>(name);
  }

  /**
   * Mark a service as deprecated in the locator.
   */
  static deprecate(name: string, message: string): void {
    ServiceLocator.deprecationWarnings.set(name, message);
  }

  /**
   * Get usage statistics.
   */
  static getUsageStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const entry of ServiceLocator.usageLog) {
      stats[entry.service] = (stats[entry.service] ?? 0) + 1;
    }
    return stats;
  }

  /**
   * Get the usage log.
   */
  static getUsageLog(limit = 50): typeof ServiceLocator.usageLog {
    return ServiceLocator.usageLog.slice(-limit);
  }

  /**
   * Reset the locator.
   */
  static reset(): void {
    ServiceLocator.globalContainer = null;
    ServiceLocator.usageLog = [];
    ServiceLocator.deprecationWarnings.clear();
    ServiceLocator.warningEmitted.clear();
  }
}

/* ------------------------------------------------------------------ */
/*  KernelContainer                                                    */
/* ------------------------------------------------------------------ */

export class KernelContainer extends DiEventEmitter {
  private descriptors: Map<string, ServiceDescriptor>;
  private instances: Map<string, ServiceInstance>;
  private scopes: Map<string, ContainerScope>;
  private graph: ServiceGraph;
  private interceptors: InterceptorChain;
  private initTrace: InitializationTraceEntry[];
  private readonly MAX_INIT_TRACE = 1000;
  private disposed: boolean;
  private initializationOrder: string[];
  private startedAt: number;
  private healthChecks: Map<string, HealthCheckFn>;
  private resolvingSet: Set<string>;
  private initializingSet: Set<string>;
  private tagIndex: Map<string, Set<string>>;

  constructor() {
    super();
    this.descriptors = new Map();
    this.instances = new Map();
    this.scopes = new Map();
    this.graph = new ServiceGraph();
    this.interceptors = new InterceptorChain();
    this.initTrace = [];
    this.disposed = false;
    this.initializationOrder = [];
    this.startedAt = Date.now();
    this.healthChecks = new Map();
    this.resolvingSet = new Set();
    this.initializingSet = new Set();
    this.tagIndex = new Map();
  }

  /**
   * Register a service with full options.
   */
  register<T = unknown>(options: ServiceRegistrationOptions): void {
    if (this.disposed) {
      throw new Error("Container is disposed");
    }

    const descriptor: ServiceDescriptor<T> = {
      name: options.name,
      factory: options.factory as (...args: unknown[]) => T | Promise<T>,
      lifecycle: options.lifecycle ?? "singleton",
      dependencies: options.dependencies ?? [],
      tags: options.tags ?? [],
      priority: options.priority ?? 0,
      lazy: options.lazy ?? true,
      description: options.description,
      healthCheck: options.healthCheck,
      onDispose: options.onDispose as ((instance: T) => void | Promise<void>) | undefined,
    };

    this.descriptors.set(options.name, descriptor as ServiceDescriptor);

    const instance: ServiceInstance<T> = {
      descriptor,
      instance: null,
      state: "pending",
      initializedAt: null,
      disposedAt: null,
      initDurationMs: 0,
      error: null,
      accessCount: 0,
      lastAccessedAt: null,
      scopeId: null,
    };
    this.instances.set(options.name, instance as ServiceInstance);

    // Update dependency graph
    this.graph.addNode(options.name, descriptor.dependencies, descriptor.priority, descriptor.tags);

    // Update tag index
    for (const tag of descriptor.tags) {
      let tagSet = this.tagIndex.get(tag);
      if (!tagSet) {
        tagSet = new Set();
        this.tagIndex.set(tag, tagSet);
      }
      tagSet.add(options.name);
    }

    // Register health check
    if (options.healthCheck) {
      this.healthChecks.set(options.name, options.healthCheck);
    }

    this.emit("service:registered", { name: options.name, lifecycle: descriptor.lifecycle });
  }

  /**
   * Register a pre-created value as a singleton.
   */
  registerValue<T = unknown>(name: string, value: T, tags: string[] = []): void {
    if (this.disposed) {
      throw new Error("Container is disposed");
    }

    const descriptor: ServiceDescriptor<T> = {
      name,
      factory: () => value,
      lifecycle: "singleton",
      dependencies: [],
      tags,
      priority: 0,
      lazy: false,
    };

    this.descriptors.set(name, descriptor as ServiceDescriptor);

    const instance: ServiceInstance<T> = {
      descriptor,
      instance: value,
      state: "ready",
      initializedAt: Date.now(),
      disposedAt: null,
      initDurationMs: 0,
      error: null,
      accessCount: 0,
      lastAccessedAt: null,
      scopeId: null,
    };
    this.instances.set(name, instance as ServiceInstance);

    this.graph.addNode(name, [], 0, tags);

    for (const tag of tags) {
      let tagSet = this.tagIndex.get(tag);
      if (!tagSet) {
        tagSet = new Set();
        this.tagIndex.set(tag, tagSet);
      }
      tagSet.add(name);
    }

    this.emit("service:registered", { name, lifecycle: "singleton", preCreated: true });
  }

  /**
   * Resolve a service by name.
   */
  resolve<T = unknown>(name: string, scopeId?: string): T {
    if (this.disposed) {
      throw new Error("Container is disposed");
    }

    // Check for circular resolution
    if (this.resolvingSet.has(name)) {
      throw new Error(
        `Circular dependency detected during resolution of '${name}'. Resolution chain: ${Array.from(this.resolvingSet).join(" -> ")} -> ${name}`
      );
    }

    const descriptor = this.descriptors.get(name);
    if (!descriptor) {
      throw new Error(`Service '${name}' is not registered`);
    }

    // For scoped services, check the scope
    if (scopeId && descriptor.lifecycle === "scoped") {
      const scope = this.scopes.get(scopeId);
      if (scope) {
        const scopedInstance = scope.instances.get(name);
        if (scopedInstance && scopedInstance.state === "ready" && scopedInstance.instance !== null) {
          scopedInstance.accessCount++;
          scopedInstance.lastAccessedAt = Date.now();
          return scopedInstance.instance as T;
        }
      }
    }

    // For transient services, always create new
    if (descriptor.lifecycle === "transient") {
      return this.createInstance<T>(name, scopeId) as T;
    }

    // For singleton (and scoped first-access), check existing
    const instance = this.instances.get(name);
    if (instance && instance.state === "ready" && instance.instance !== null) {
      instance.accessCount++;
      instance.lastAccessedAt = Date.now();
      return instance.instance as T;
    }

    // Lazy initialization
    return this.createInstance<T>(name, scopeId) as T;
  }

  /**
   * Resolve a service, returning undefined if not found.
   */
  resolveOptional<T = unknown>(name: string, scopeId?: string): T | undefined {
    if (!this.descriptors.has(name)) return undefined;
    try {
      return this.resolve<T>(name, scopeId);
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve all services with a given tag.
   */
  resolveAll<T = unknown>(tag: string, scopeId?: string): T[] {
    const tagSet = this.tagIndex.get(tag);
    if (!tagSet) return [];

    const results: T[] = [];
    for (const name of Array.from(tagSet)) {
      try {
        results.push(this.resolve<T>(name, scopeId));
      } catch {
        // Skip failed resolutions
      }
    }
    return results;
  }

  /**
   * Check if a service is registered.
   */
  has(name: string): boolean {
    return this.descriptors.has(name);
  }

  /**
   * Get the state of a service.
   */
  getState(name: string): ServiceState | undefined {
    const instance = this.instances.get(name);
    return instance?.state;
  }

  /**
   * Create a new service instance.
   */
  private createInstance<T>(name: string, scopeId?: string): T {
    const descriptor = this.descriptors.get(name) as ServiceDescriptor<T>;
    if (!descriptor) {
      throw new Error(`Service '${name}' not registered`);
    }

    this.resolvingSet.add(name);
    const startTime = Date.now();

    this.addInitTrace(name, "start", descriptor.dependencies, 0);

    try {
      // Resolve dependencies first
      const depArgs: unknown[] = [];
      for (const dep of descriptor.dependencies) {
        depArgs.push(this.resolve(dep, scopeId));
      }

      // Run before interceptors
      const finalArgs = this.interceptors.executeBefore(name, depArgs);

      // Create instance
      let rawResult = descriptor.factory(...finalArgs);

      // Handle promises synchronously by wrapping
      if (rawResult && typeof (rawResult as Promise<T>).then === "function") {
        // For async factories, we need to handle differently
        // In sync resolve, we throw an error suggesting initialize() be called first
        throw new Error(
          `Service '${name}' has an async factory. Call container.initialize() before resolving, or use resolveAsync().`
        );
      }

      // Run after interceptors
      const finalResult = this.interceptors.executeAfter(name, rawResult) as T;

      const durationMs = Date.now() - startTime;

      // Store the instance
      const instance: ServiceInstance<T> = {
        descriptor,
        instance: finalResult,
        state: "ready",
        initializedAt: Date.now(),
        disposedAt: null,
        initDurationMs: durationMs,
        error: null,
        accessCount: 1,
        lastAccessedAt: Date.now(),
        scopeId: scopeId ?? null,
      };

      if (descriptor.lifecycle === "scoped" && scopeId) {
        const scope = this.scopes.get(scopeId);
        if (scope) {
          scope.instances.set(name, instance as ServiceInstance);
        }
      } else {
        this.instances.set(name, instance as ServiceInstance);
      }

      this.addInitTrace(name, "end", descriptor.dependencies, durationMs);
      this.emit("service:initialized", { name, durationMs });

      return finalResult;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startTime;

      this.addInitTrace(name, "error", descriptor.dependencies, durationMs, msg);

      const instance = this.instances.get(name);
      if (instance) {
        instance.state = "error";
        instance.error = msg;
      }

      this.interceptors.executeOnError(name, err instanceof Error ? err : new Error(msg));
      this.emit("service:error", { name, error: msg });

      throw err;
    } finally {
      this.resolvingSet.delete(name);
    }
  }

  /**
   * Create a new scope.
   */
  createScope(id?: string, metadata: Record<string, unknown> = {}): string {
    const scopeId = id ?? `scope_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const scope: ContainerScope = {
      id: scopeId,
      parentScopeId: null,
      instances: new Map(),
      createdAt: Date.now(),
      disposedAt: null,
      metadata,
    };
    this.scopes.set(scopeId, scope);
    this.emit("scope:created", { scopeId });
    return scopeId;
  }

  /**
   * Dispose a scope and all its scoped instances.
   */
  async disposeScope(scopeId: string): Promise<void> {
    const scope = this.scopes.get(scopeId);
    if (!scope) return;

    for (const [name, instance] of Array.from(scope.instances.entries())) {
      if (instance.instance !== null && instance.descriptor.onDispose) {
        try {
          await instance.descriptor.onDispose(instance.instance);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.emit("service:dispose_error", { name, scopeId, error: msg });
        }
      }
      instance.state = "disposed";
      instance.disposedAt = Date.now();
      instance.instance = null;
    }

    scope.disposedAt = Date.now();
    this.scopes.delete(scopeId);
    this.emit("scope:disposed", { scopeId });
  }

  /**
   * Initialize all non-lazy singleton services in topological order.
   */
  async initialize(): Promise<void> {
    if (this.disposed) {
      throw new Error("Container is disposed");
    }

    const order = this.graph.topologicalSort();
    this.initializationOrder = order;

    for (const name of order) {
      const descriptor = this.descriptors.get(name);
      if (!descriptor) continue;
      if (descriptor.lazy) continue;
      if (descriptor.lifecycle !== "singleton") continue;

      const existing = this.instances.get(name);
      if (existing && existing.state === "ready") continue;

      this.initializingSet.add(name);
      const startTime = Date.now();
      this.addInitTrace(name, "start", descriptor.dependencies, 0);

      try {
        // Resolve dependencies
        const depArgs: unknown[] = [];
        for (const dep of descriptor.dependencies) {
          depArgs.push(this.resolve(dep));
        }

        const finalArgs = this.interceptors.executeBefore(name, depArgs);
        let result = descriptor.factory(...finalArgs);

        if (result && typeof (result as Promise<unknown>).then === "function") {
          result = await (result as Promise<unknown>);
        }

        const finalResult = this.interceptors.executeAfter(name, result);
        const durationMs = Date.now() - startTime;

        const instance: ServiceInstance = {
          descriptor,
          instance: finalResult,
          state: "ready",
          initializedAt: Date.now(),
          disposedAt: null,
          initDurationMs: durationMs,
          error: null,
          accessCount: 0,
          lastAccessedAt: null,
          scopeId: null,
        };
        this.instances.set(name, instance);

        this.addInitTrace(name, "end", descriptor.dependencies, durationMs);
        this.emit("service:initialized", { name, durationMs });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - startTime;

        this.addInitTrace(name, "error", descriptor.dependencies, durationMs, msg);

        const instance = this.instances.get(name);
        if (instance) {
          instance.state = "error";
          instance.error = msg;
        }

        this.emit("service:error", { name, error: msg });
      } finally {
        this.initializingSet.delete(name);
      }
    }

    this.emit("container:initialized", { serviceCount: order.length });
  }

  /**
   * Dispose all services in reverse initialization order.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;

    // Dispose scopes first
    for (const scopeId of Array.from(this.scopes.keys())) {
      await this.disposeScope(scopeId);
    }

    // Dispose in reverse order
    const order = [...this.initializationOrder].reverse();
    for (const name of order) {
      const instance = this.instances.get(name);
      if (!instance || instance.state === "disposed") continue;

      if (instance.instance !== null && instance.descriptor.onDispose) {
        try {
          await instance.descriptor.onDispose(instance.instance);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.emit("service:dispose_error", { name, error: msg });
        }
      }

      instance.state = "disposed";
      instance.disposedAt = Date.now();
      instance.instance = null;
    }

    this.disposed = true;
    this.emit("container:disposed", { timestamp: Date.now() });
  }

  /**
   * Restart a service (dispose and re-initialize).
   */
  async restart(name: string): Promise<void> {
    const instance = this.instances.get(name);
    if (!instance) {
      throw new Error(`Service '${name}' not registered`);
    }

    // Dispose current instance
    if (instance.instance !== null && instance.descriptor.onDispose) {
      try {
        await instance.descriptor.onDispose(instance.instance);
      } catch {
        // Ignore dispose errors during restart
      }
    }

    instance.state = "pending";
    instance.instance = null;
    instance.error = null;

    // Re-resolve (lazy init)
    this.resolve(name);

    this.emit("service:restarted", { name, timestamp: Date.now() });
  }

  /**
   * Get health reports for all services with health checks.
   */
  async getHealthReports(): Promise<ServiceHealthReport[]> {
    const reports: ServiceHealthReport[] = [];

    for (const [name, healthCheck] of Array.from(this.healthChecks.entries())) {
      const startTime = Date.now();
      try {
        const result = await healthCheck();
        reports.push({
          name,
          state: this.getState(name) ?? "pending",
          healthy: result.healthy,
          message: result.message,
          latencyMs: Date.now() - startTime,
          checkedAt: Date.now(),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        reports.push({
          name,
          state: this.getState(name) ?? "error",
          healthy: false,
          message: msg,
          latencyMs: Date.now() - startTime,
          checkedAt: Date.now(),
        });
      }
    }

    return reports;
  }

  /**
   * Get container diagnostics.
   */
  getDiagnostics(): ContainerDiagnostics {
    const states: Record<string, ServiceState> = {};
    let initialized = 0;
    let disposedCount = 0;
    let errors = 0;
    let totalInitTime = 0;
    let initCount = 0;

    for (const [name, instance] of Array.from(this.instances.entries())) {
      states[name] = instance.state;
      if (instance.state === "ready") initialized++;
      if (instance.state === "disposed") disposedCount++;
      if (instance.state === "error") errors++;
      if (instance.initDurationMs > 0) {
        totalInitTime += instance.initDurationMs;
        initCount++;
      }
    }

    return {
      totalRegistered: this.descriptors.size,
      totalInitialized: initialized,
      totalDisposed: disposedCount,
      totalErrors: errors,
      serviceStates: states,
      scopeCount: this.scopes.size,
      initOrder: this.initializationOrder,
      avgInitTimeMs: initCount > 0 ? totalInitTime / initCount : 0,
      uptime: Date.now() - this.startedAt,
    };
  }

  /**
   * Get the service graph.
   */
  getGraph(): ServiceGraph {
    return this.graph;
  }

  /**
   * Get the interceptor chain.
   */
  getInterceptors(): InterceptorChain {
    return this.interceptors;
  }

  /**
   * Add an interceptor.
   */
  addInterceptor(interceptor: ServiceInterceptor): void {
    this.interceptors.add(interceptor);
  }

  /**
   * Get the initialization trace.
   */
  getInitTrace(limit = 100): InitializationTraceEntry[] {
    return this.initTrace.slice(-limit);
  }

  /**
   * Add an entry to the init trace.
   */
  private addInitTrace(
    serviceName: string,
    phase: InitializationTraceEntry["phase"],
    dependencies: string[],
    durationMs?: number,
    error?: string
  ): void {
    this.initTrace.push({
      serviceName,
      phase,
      timestamp: Date.now(),
      durationMs,
      error,
      dependencies,
      level: 0,
    });
    if (this.initTrace.length > this.MAX_INIT_TRACE) {
      this.initTrace = this.initTrace.slice(-this.MAX_INIT_TRACE);
    }
  }

  /**
   * Get all registered service names.
   */
  getServiceNames(): string[] {
    return Array.from(this.descriptors.keys());
  }

  /**
   * Get services by tag.
   */
  getServicesByTag(tag: string): string[] {
    const tagSet = this.tagIndex.get(tag);
    if (!tagSet) return [];
    return Array.from(tagSet);
  }

  /**
   * Check if the container is disposed.
   */
  isDisposed(): boolean {
    return this.disposed;
  }
}

/* ------------------------------------------------------------------ */
/*  ContainerBuilder                                                   */
/* ------------------------------------------------------------------ */

export class ContainerBuilder {
  private registrations: ServiceRegistrationOptions[];
  private values: Array<{ name: string; value: unknown; tags: string[] }>;
  private interceptorDefs: ServiceInterceptor[];
  private healthCheckDefs: Map<string, HealthCheckFn>;
  private metadata: Record<string, unknown>;

  constructor() {
    this.registrations = [];
    this.values = [];
    this.interceptorDefs = [];
    this.healthCheckDefs = new Map();
    this.metadata = {};
  }

  /**
   * Register a service.
   */
  withService(options: ServiceRegistrationOptions): ContainerBuilder {
    this.registrations.push(options);
    return this;
  }

  /**
   * Register a singleton service.
   */
  withSingleton(
    name: string,
    factory: (...args: unknown[]) => unknown | Promise<unknown>,
    options?: Partial<Omit<ServiceRegistrationOptions, "name" | "factory" | "lifecycle">>
  ): ContainerBuilder {
    this.registrations.push({
      name,
      factory,
      lifecycle: "singleton",
      ...options,
    });
    return this;
  }

  /**
   * Register a transient service.
   */
  withTransient(
    name: string,
    factory: (...args: unknown[]) => unknown,
    options?: Partial<Omit<ServiceRegistrationOptions, "name" | "factory" | "lifecycle">>
  ): ContainerBuilder {
    this.registrations.push({
      name,
      factory,
      lifecycle: "transient",
      ...options,
    });
    return this;
  }

  /**
   * Register a scoped service.
   */
  withScoped(
    name: string,
    factory: (...args: unknown[]) => unknown,
    options?: Partial<Omit<ServiceRegistrationOptions, "name" | "factory" | "lifecycle">>
  ): ContainerBuilder {
    this.registrations.push({
      name,
      factory,
      lifecycle: "scoped",
      ...options,
    });
    return this;
  }

  /**
   * Register a pre-created value.
   */
  withValue(name: string, value: unknown, tags: string[] = []): ContainerBuilder {
    this.values.push({ name, value, tags });
    return this;
  }

  /**
   * Add an interceptor.
   */
  withInterceptor(interceptor: ServiceInterceptor): ContainerBuilder {
    this.interceptorDefs.push(interceptor);
    return this;
  }

  /**
   * Add a health check.
   */
  withHealthCheck(serviceName: string, check: HealthCheckFn): ContainerBuilder {
    this.healthCheckDefs.set(serviceName, check);
    return this;
  }

  /**
   * Add metadata.
   */
  withMetadata(key: string, value: unknown): ContainerBuilder {
    this.metadata[key] = value;
    return this;
  }

  /**
   * Build the container.
   */
  build(): KernelContainer {
    const container = new KernelContainer();

    // Register values first (they have no dependencies)
    for (const { name, value, tags } of this.values) {
      container.registerValue(name, value, tags);
    }

    // Register services
    for (const reg of this.registrations) {
      // Merge health checks
      if (this.healthCheckDefs.has(reg.name)) {
        reg.healthCheck = this.healthCheckDefs.get(reg.name);
      }
      container.register(reg);
    }

    // Add interceptors
    for (const interceptor of this.interceptorDefs) {
      container.addInterceptor(interceptor);
    }

    return container;
  }
}

/* ------------------------------------------------------------------ */
/*  createKernelContainer                                              */
/* ------------------------------------------------------------------ */

/**
 * Create a pre-configured KernelContainer with placeholder kernel services.
 */
export function createKernelContainer(): KernelContainer {
  const builder = new ContainerBuilder();

  // Core infrastructure services
  builder.withSingleton("kernel.logger", () => ({
    info: (...args: unknown[]) => console.log("[kernel]", ...args),
    warn: (...args: unknown[]) => console.warn("[kernel]", ...args),
    error: (...args: unknown[]) => console.error("[kernel]", ...args),
    debug: (...args: unknown[]) => {},
  }), {
    tags: ["core", "infrastructure"],
    priority: 100,
    lazy: false,
    description: "Kernel logger service",
  });

  builder.withSingleton("kernel.config", () => ({
    get: (key: string) => process.env[key],
    getOrDefault: (key: string, def: unknown) => process.env[key] ?? def,
    has: (key: string) => key in process.env,
  }), {
    tags: ["core", "infrastructure"],
    priority: 99,
    lazy: false,
    description: "Kernel configuration provider",
  });

  builder.withSingleton("kernel.eventBus", () => {
    const emitter = new DiEventEmitter();
    emitter.setMaxListeners(100);
    return {
      emit: (event: string, data: unknown) => emitter.emit(event, data),
      on: (event: string, handler: (...args: unknown[]) => void) => emitter.on(event, handler),
      off: (event: string, handler: (...args: unknown[]) => void) => emitter.off(event, handler),
      once: (event: string, handler: (...args: unknown[]) => void) => emitter.once(event, handler),
    };
  }, {
    tags: ["core", "infrastructure"],
    priority: 98,
    lazy: false,
    description: "Kernel event bus",
  });

  // Connector management services
  builder.withSingleton("kernel.registry", () => ({
    connectors: new Map(),
    register: function (id: string, descriptor: unknown) {
      (this as any).connectors.set(id, descriptor);
    },
    get: function (id: string) {
      return (this as any).connectors.get(id);
    },
    list: function () {
      return Array.from((this as any).connectors.keys());
    },
  }), {
    tags: ["core", "connector"],
    priority: 90,
    dependencies: ["kernel.logger"],
    description: "Connector registry",
  });

  builder.withSingleton("kernel.healthMonitor", () => ({
    checks: new Map(),
    registerCheck: function (name: string, fn: () => Promise<boolean>) {
      (this as any).checks.set(name, fn);
    },
    runAll: async function () {
      const results: Record<string, boolean> = {};
      for (const [name, fn] of Array.from((this as any).checks.entries())) {
        try {
          results[name] = await (fn as () => Promise<boolean>)();
        } catch {
          results[name] = false;
        }
      }
      return results;
    },
  }), {
    tags: ["core", "monitoring"],
    priority: 85,
    dependencies: ["kernel.logger"],
    description: "Health monitor service",
  });

  builder.withSingleton("kernel.rateLimiter", () => {
    const windows = new Map<string, { count: number; resetAt: number }>();
    return {
      check: (key: string, limit: number, windowMs: number): boolean => {
        const now = Date.now();
        const entry = windows.get(key);
        if (!entry || now > entry.resetAt) {
          windows.set(key, { count: 1, resetAt: now + windowMs });
          return true;
        }
        if (entry.count >= limit) return false;
        entry.count++;
        return true;
      },
      reset: (key: string) => windows.delete(key),
    };
  }, {
    tags: ["core", "security"],
    priority: 80,
    description: "Rate limiter service",
  });

  builder.withSingleton("kernel.circuitBreaker", () => {
    const circuits = new Map<string, {
      state: "closed" | "open" | "half_open";
      failures: number;
      lastFailure: number;
      threshold: number;
      resetTimeout: number;
    }>();
    return {
      getOrCreate: (name: string, threshold = 5, resetTimeout = 30000) => {
        if (!circuits.has(name)) {
          circuits.set(name, {
            state: "closed",
            failures: 0,
            lastFailure: 0,
            threshold,
            resetTimeout,
          });
        }
        return circuits.get(name)!;
      },
      canExecute: (name: string) => {
        const circuit = circuits.get(name);
        if (!circuit) return true;
        if (circuit.state === "closed") return true;
        if (circuit.state === "open") {
          if (Date.now() - circuit.lastFailure > circuit.resetTimeout) {
            circuit.state = "half_open";
            return true;
          }
          return false;
        }
        return true; // half_open
      },
      recordSuccess: (name: string) => {
        const circuit = circuits.get(name);
        if (circuit) {
          circuit.failures = 0;
          circuit.state = "closed";
        }
      },
      recordFailure: (name: string) => {
        const circuit = circuits.get(name);
        if (circuit) {
          circuit.failures++;
          circuit.lastFailure = Date.now();
          if (circuit.failures >= circuit.threshold) {
            circuit.state = "open";
          }
        }
      },
    };
  }, {
    tags: ["core", "resilience"],
    priority: 75,
    description: "Circuit breaker service",
  });

  builder.withSingleton("kernel.metrics", () => {
    const counters = new Map<string, number>();
    const histograms = new Map<string, number[]>();
    return {
      increment: (name: string, value = 1) => {
        counters.set(name, (counters.get(name) ?? 0) + value);
      },
      record: (name: string, value: number) => {
        const hist = histograms.get(name) ?? [];
        hist.push(value);
        if (hist.length > 1000) hist.splice(0, hist.length - 1000);
        histograms.set(name, hist);
      },
      getCounter: (name: string) => counters.get(name) ?? 0,
      getHistogram: (name: string) => histograms.get(name) ?? [],
      reset: () => {
        counters.clear();
        histograms.clear();
      },
    };
  }, {
    tags: ["core", "monitoring"],
    priority: 70,
    description: "Metrics collector service",
  });

  const container = builder.build();
  ServiceLocator.setContainer(container);
  return container;
}
