/**
 * ConnectorDependencyResolver — DAG-based dependency resolution for multi-connector workflows.
 *
 * When an agent needs to orchestrate operations across multiple connectors
 * (e.g., "read email from Gmail → create task in Notion → post to Slack"),
 * this resolver:
 *  1. Builds a DAG of operations with data dependencies
 *  2. Validates the DAG is acyclic
 *  3. Computes optimal parallel execution order (topological sort)
 *  4. Resolves data dependencies between operation outputs and inputs
 *  5. Handles partial failures with configurable strategies
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface OperationNode {
  /** Unique ID for this node in the DAG */
  id: string;
  connectorId: string;
  operationId: string;
  /** Static input values */
  staticInput: Record<string, unknown>;
  /**
   * Dynamic input mappings: fieldName → source expression.
   * Format: "nodeId.outputPath" (e.g., "gmail_read.body", "slack_channels.channels[0].id")
   */
  dynamicInput: Record<string, string>;
  /** Node IDs that must complete before this node runs */
  dependsOn: string[];
  /** If true, failure of this node doesn't fail the workflow */
  optional?: boolean;
  /** Timeout for this specific operation (ms) */
  timeoutMs?: number;
}

export interface WorkflowPlan {
  id: string;
  name: string;
  description?: string;
  nodes: OperationNode[];
  /** Strategy when a node fails: 'abort' | 'skip_dependents' | 'continue' */
  failureStrategy: "abort" | "skip_dependents" | "continue";
  /** Overall timeout (ms) */
  timeoutMs: number;
  createdAt: Date;
}

export interface ExecutionLevel {
  /** Nodes at this level can execute in parallel */
  nodes: OperationNode[];
  /** Level index (0 = first to execute) */
  level: number;
}

export interface NodeResult {
  nodeId: string;
  connectorId: string;
  operationId: string;
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
  durationMs: number;
  skipped?: boolean;
  skipReason?: string;
}

export interface WorkflowResult {
  planId: string;
  success: boolean;
  nodeResults: Map<string, NodeResult>;
  totalDurationMs: number;
  levelsExecuted: number;
  nodesExecuted: number;
  nodesSkipped: number;
  nodesFailed: number;
}

// ─── Dependency Resolver ─────────────────────────────────────────────

export class ConnectorDependencyResolver {
  /**
   * Validate a workflow plan:
   *  - All dependsOn references exist
   *  - No circular dependencies
   *  - All dynamic input sources reference existing nodes
   */
  validate(plan: WorkflowPlan): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const nodeIds = new Set(plan.nodes.map((n) => n.id));

    // Check for duplicate IDs
    if (nodeIds.size !== plan.nodes.length) {
      errors.push("Duplicate node IDs detected");
    }

    // Check dependency references
    for (const node of plan.nodes) {
      for (const dep of node.dependsOn) {
        if (!nodeIds.has(dep)) {
          errors.push(`Node "${node.id}" depends on unknown node "${dep}"`);
        }
        if (dep === node.id) {
          errors.push(`Node "${node.id}" depends on itself`);
        }
      }

      // Check dynamic input references
      for (const [field, source] of Object.entries(node.dynamicInput)) {
        const sourceNodeId = source.split(".")[0];
        if (!nodeIds.has(sourceNodeId)) {
          errors.push(
            `Node "${node.id}" field "${field}" references unknown source node "${sourceNodeId}"`
          );
        }
        // Ensure source is in dependsOn
        if (!node.dependsOn.includes(sourceNodeId)) {
          errors.push(
            `Node "${node.id}" uses output from "${sourceNodeId}" but doesn't depend on it`
          );
        }
      }
    }

    // Check for cycles (Kahn's algorithm)
    if (errors.length === 0) {
      const cycleCheck = this.detectCycles(plan.nodes);
      if (cycleCheck) {
        errors.push(`Circular dependency detected: ${cycleCheck}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Compute parallel execution levels via topological sort.
   * Nodes at the same level have no dependencies on each other and can run in parallel.
   */
  computeExecutionLevels(plan: WorkflowPlan): ExecutionLevel[] {
    const nodeMap = new Map(plan.nodes.map((n) => [n.id, n]));
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, Set<string>>();

    // Initialize
    for (const node of plan.nodes) {
      inDegree.set(node.id, node.dependsOn.length);
      if (!adjacency.has(node.id)) {
        adjacency.set(node.id, new Set());
      }
      for (const dep of node.dependsOn) {
        if (!adjacency.has(dep)) {
          adjacency.set(dep, new Set());
        }
        adjacency.get(dep)!.add(node.id);
      }
    }

    const levels: ExecutionLevel[] = [];
    const remaining = new Set(plan.nodes.map((n) => n.id));

    while (remaining.size > 0) {
      // Find all nodes with in-degree 0
      const level: OperationNode[] = [];
      for (const nodeId of Array.from(remaining)) {
        if ((inDegree.get(nodeId) || 0) === 0) {
          level.push(nodeMap.get(nodeId)!);
        }
      }

      if (level.length === 0) {
        // This shouldn't happen if cycle detection passed
        console.error("[DependencyResolver] Deadlock: remaining nodes with no zero in-degree");
        break;
      }

      levels.push({ nodes: level, level: levels.length });

      // Remove these nodes and update in-degrees
      for (const node of level) {
        remaining.delete(node.id);
        for (const dependent of Array.from(adjacency.get(node.id) || [])) {
          inDegree.set(dependent, (inDegree.get(dependent) || 1) - 1);
        }
      }
    }

    return levels;
  }

  /**
   * Resolve dynamic inputs for a node using outputs from completed nodes.
   */
  resolveInputs(
    node: OperationNode,
    completedResults: Map<string, NodeResult>
  ): Record<string, unknown> {
    const resolved = { ...node.staticInput };

    for (const [field, source] of Object.entries(node.dynamicInput)) {
      const [sourceNodeId, ...pathParts] = source.split(".");
      const sourceResult = completedResults.get(sourceNodeId);

      if (!sourceResult || !sourceResult.success || sourceResult.data === undefined) {
        console.warn(
          `[DependencyResolver] Cannot resolve "${source}" for node "${node.id}": source not available`
        );
        continue;
      }

      // Navigate the output path
      const value = navigatePath(sourceResult.data, pathParts.join("."));
      if (value !== undefined) {
        resolved[field] = value;
      } else {
        console.warn(
          `[DependencyResolver] Path "${pathParts.join(".")}" not found in output of "${sourceNodeId}"`
        );
      }
    }

    return resolved;
  }

  /**
   * Determine which nodes should be skipped due to failed dependencies.
   */
  getSkippedNodes(
    plan: WorkflowPlan,
    failedNodeIds: Set<string>
  ): Map<string, string> {
    if (plan.failureStrategy === "continue") {
      return new Map(); // Never skip
    }

    const skipped = new Map<string, string>(); // nodeId → reason

    if (plan.failureStrategy === "abort") {
      // Skip ALL remaining nodes
      for (const node of plan.nodes) {
        if (!failedNodeIds.has(node.id)) {
          skipped.set(node.id, "Workflow aborted due to node failure");
        }
      }
      return skipped;
    }

    // "skip_dependents" strategy: skip nodes that transitively depend on failed nodes
    const affectedNodes = new Set<string>();

    function markAffected(nodeId: string): void {
      if (affectedNodes.has(nodeId)) return;
      affectedNodes.add(nodeId);
      // Find all nodes that depend on this one
      for (const node of plan.nodes) {
        if (node.dependsOn.includes(nodeId) && !node.optional) {
          markAffected(node.id);
        }
      }
    }

    for (const failedId of Array.from(failedNodeIds)) {
      markAffected(failedId);
    }

    for (const nodeId of Array.from(affectedNodes)) {
      if (!failedNodeIds.has(nodeId)) {
        skipped.set(nodeId, `Dependency failed: ${Array.from(failedNodeIds).join(", ")}`);
      }
    }

    return skipped;
  }

  /**
   * Generate a human-readable execution plan description.
   */
  describePlan(plan: WorkflowPlan): string {
    const levels = this.computeExecutionLevels(plan);
    const lines: string[] = [`Workflow: ${plan.name} (${plan.nodes.length} operations)`];

    for (const level of levels) {
      const parallel = level.nodes.length > 1 ? " (parallel)" : "";
      lines.push(`\n  Level ${level.level}${parallel}:`);
      for (const node of level.nodes) {
        const deps = node.dependsOn.length > 0
          ? ` ← depends on [${node.dependsOn.join(", ")}]`
          : "";
        const optional = node.optional ? " (optional)" : "";
        lines.push(`    ${node.id}: ${node.connectorId}/${node.operationId}${deps}${optional}`);
      }
    }

    return lines.join("\n");
  }

  // ─── Private helpers ─────────────────────────────────────────────

  /** Detect cycles using DFS. Returns cycle description or null. */
  private detectCycles(nodes: OperationNode[]): string | null {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    for (const node of nodes) {
      color.set(node.id, WHITE);
    }

    const path: string[] = [];

    function dfs(nodeId: string): string | null {
      color.set(nodeId, GRAY);
      path.push(nodeId);

      const node = nodeMap.get(nodeId);
      if (node) {
        for (const dep of node.dependsOn) {
          const depColor = color.get(dep);
          if (depColor === GRAY) {
            // Found cycle
            const cycleStart = path.indexOf(dep);
            return path.slice(cycleStart).join(" → ") + ` → ${dep}`;
          }
          if (depColor === WHITE) {
            const result = dfs(dep);
            if (result) return result;
          }
        }
      }

      color.set(nodeId, BLACK);
      path.pop();
      return null;
    }

    for (const node of nodes) {
      if (color.get(node.id) === WHITE) {
        const result = dfs(node.id);
        if (result) return result;
      }
    }

    return null;
  }
}

// ─── Path navigation helper ──────────────────────────────────────────

/**
 * Navigate a nested object using dot-notation paths with array index support.
 * Examples: "body", "channels[0].id", "results.items[2].name"
 */
function navigatePath(obj: unknown, path: string): unknown {
  if (!path) return obj;

  const segments = path.split(/\.|\[|\]/).filter(Boolean);
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;

    if (typeof current === "object") {
      // Try array index
      const idx = parseInt(segment, 10);
      if (!Number.isNaN(idx) && Array.isArray(current)) {
        current = current[idx];
      } else {
        current = (current as Record<string, unknown>)[segment];
      }
    } else {
      return undefined;
    }
  }

  return current;
}

// ─── Singleton ───────────────────────────────────────────────────────

export const connectorDependencyResolver = new ConnectorDependencyResolver();
