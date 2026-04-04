/**
 * GraphQL Query Complexity & Depth Limiting
 * - calculateComplexity: AST walker that scores each field
 * - depthLimit: validation rule — rejects queries deeper than max
 * - complexityLimit: validation rule — rejects queries above max complexity
 * - createComplexityPlugin: wrapper for graphql-http / Apollo integration
 */

import {
  DocumentNode,
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLField,
  ValidationContext,
  GraphQLError,
  ASTVisitor,
  FieldNode,
  FragmentDefinitionNode,
  InlineFragmentNode,
  SelectionSetNode,
  Kind,
  visit,
} from "graphql";
import { Logger } from "../../lib/logger.js";

// ─── Default field cost table ─────────────────────────────────────────────────
interface FieldCost {
  base: number;
  multiplier?: number; // applied when list arg (limit/first) is present
}

const DEFAULT_COSTS: Record<string, FieldCost> = {
  // Simple scalar lookups
  id: { base: 0 },
  __typename: { base: 0 },

  // Single-entity queries
  me: { base: 1 },
  chat: { base: 1 },
  agent: { base: 1 },
  document: { base: 1 },
  model: { base: 1 },
  modelHealth: { base: 2 },

  // List queries (10 per item)
  chats: { base: 10, multiplier: 1 },
  messages: { base: 10, multiplier: 1 },
  agents: { base: 10 },
  models: { base: 5 },
  documents: { base: 10, multiplier: 1 },
  users: { base: 15, multiplier: 1 },
  agentTasks: { base: 10, multiplier: 1 },

  // Search (heavy)
  searchMessages: { base: 20 },
  searchDocuments: { base: 20 },

  // Connections (cursor-based pagination)
  messageAdded: { base: 5 },
  chatUpdated: { base: 5 },
  taskProgress: { base: 5 },
  agentLog: { base: 5 },

  // Analytics (expensive DB aggregations)
  dashboardMetrics: { base: 50 },
  usageStats: { base: 20 },
  costBreakdown: { base: 30 },
  modelPerformance: { base: 30 },
  providerStatus: { base: 15 },
  modelUsage: { base: 15 },

  // Mutations (moderate cost)
  sendMessage: { base: 5 },
  createChat: { base: 3 },
  createDocument: { base: 10 },
  analyzeDocument: { base: 40 },
  executeTask: { base: 20 },
};

const LIST_FIELD_DEFAULT = 10;
const SIMPLE_FIELD_DEFAULT = 1;

// ─── Complexity calculation ───────────────────────────────────────────────────
export interface ComplexityOptions {
  /** Maximum allowed complexity (default: 1000) */
  maxComplexity?: number;
  /** Custom field costs (merged with defaults) */
  fieldCosts?: Record<string, FieldCost>;
  /** Variables passed with the query */
  variables?: Record<string, unknown>;
}

interface WalkState {
  score: number;
  depth: number;
  maxDepth: number;
  fragments: Record<string, FragmentDefinitionNode>;
  variables: Record<string, unknown>;
  fieldCosts: Record<string, FieldCost>;
}

function getFieldCost(fieldName: string, costs: Record<string, FieldCost>): number {
  const entry = costs[fieldName];
  if (!entry) return SIMPLE_FIELD_DEFAULT;
  return entry.base;
}

function extractLimitArg(
  field: FieldNode,
  variables: Record<string, unknown>
): number | null {
  if (!field.arguments?.length) return null;
  for (const arg of field.arguments) {
    const name = arg.name.value;
    if (name === "limit" || name === "first" || name === "last") {
      if (arg.value.kind === Kind.INT_VALUE) return parseInt(arg.value.value, 10);
      if (arg.value.kind === Kind.VARIABLE) {
        const varVal = variables[arg.value.name.value];
        if (typeof varVal === "number") return varVal;
      }
    }
  }
  return null;
}

function walkSelectionSet(
  set: SelectionSetNode,
  state: WalkState,
  depth: number
): void {
  state.maxDepth = Math.max(state.maxDepth, depth);

  for (const selection of set.selections) {
    if (selection.kind === Kind.FIELD) {
      const fieldName = selection.name.value;
      if (fieldName.startsWith("__")) continue;

      const baseCost = getFieldCost(fieldName, state.fieldCosts);
      const limit = extractLimitArg(selection, state.variables);
      const multiplier = limit !== null ? limit : 1;
      const cost = baseCost * multiplier;

      state.score += cost;

      if (selection.selectionSet) {
        walkSelectionSet(selection.selectionSet, state, depth + 1);
      }
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      if (selection.selectionSet) {
        walkSelectionSet(selection.selectionSet, state, depth + 1);
      }
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const fragment = state.fragments[selection.name.value];
      if (fragment?.selectionSet) {
        walkSelectionSet(fragment.selectionSet, state, depth + 1);
      }
    }
  }
}

/**
 * Walks the GraphQL AST and returns a complexity score and max depth.
 */
export function calculateComplexity(
  document: DocumentNode,
  _schema: GraphQLSchema,
  options: ComplexityOptions = {}
): { score: number; depth: number } {
  const fieldCosts = { ...DEFAULT_COSTS, ...(options.fieldCosts ?? {}) };
  const variables = options.variables ?? {};

  // Collect fragments
  const fragments: Record<string, FragmentDefinitionNode> = {};
  for (const def of document.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) {
      fragments[def.name.value] = def;
    }
  }

  const state: WalkState = {
    score: 0,
    depth: 0,
    maxDepth: 0,
    fragments,
    variables,
    fieldCosts,
  };

  for (const def of document.definitions) {
    if (def.kind === Kind.OPERATION_DEFINITION && def.selectionSet) {
      walkSelectionSet(def.selectionSet, state, 1);
    }
  }

  return { score: state.score, depth: state.maxDepth };
}

// ─── depthLimit validation rule ───────────────────────────────────────────────
/**
 * Validation rule that rejects queries exceeding `maxDepth` nesting levels.
 * Pass this array to graphql-http's validationRules option.
 */
export function depthLimit(maxDepth: number) {
  return function depthLimitRule(context: ValidationContext): ASTVisitor {
    let currentDepth = 0;
    let maxReached = 0;

    return {
      Field: {
        enter() {
          currentDepth++;
          maxReached = Math.max(maxReached, currentDepth);
        },
        leave() {
          currentDepth--;
        },
      },
      OperationDefinition: {
        leave() {
          if (maxReached > maxDepth) {
            context.reportError(
              new GraphQLError(
                `Query depth ${maxReached} exceeds maximum allowed depth ${maxDepth}`,
                { extensions: { code: "DEPTH_LIMIT_EXCEEDED", depth: maxReached, maxDepth } }
              )
            );
          }
          // Reset for the next operation in the same document
          maxReached = 0;
          currentDepth = 0;
        },
      },
    };
  };
}

// ─── complexityLimit validation rule ─────────────────────────────────────────
/**
 * Validation rule that rejects queries whose complexity score exceeds `maxComplexity`.
 * Must be created with the document + schema in scope to compute the score.
 */
export function complexityLimit(
  maxComplexity: number,
  options: { fieldCosts?: Record<string, FieldCost>; variables?: Record<string, unknown> } = {}
) {
  return function complexityLimitRule(context: ValidationContext): ASTVisitor {
    return {
      Document(node) {
        const schema = context.getSchema();
        const { score, depth } = calculateComplexity(node, schema, {
          maxComplexity,
          fieldCosts: options.fieldCosts,
          variables: options.variables,
        });

        Logger.debug("[GraphQL] Query complexity", { score, depth, maxComplexity });

        if (score > maxComplexity) {
          context.reportError(
            new GraphQLError(
              `Query complexity ${score} exceeds maximum allowed complexity ${maxComplexity}`,
              { extensions: { code: "COMPLEXITY_LIMIT_EXCEEDED", complexity: score, maxComplexity } }
            )
          );
        }
      },
    };
  };
}

// ─── createComplexityPlugin ───────────────────────────────────────────────────
export interface ComplexityPluginOptions {
  maxComplexity: number;
  maxDepth: number;
  fieldCosts?: Record<string, FieldCost>;
  /** Called after complexity is computed — useful for observability */
  onComplexity?: (score: number, depth: number) => void;
}

/**
 * Returns a pair of validation rules ready to be spread into graphql-http's
 * `validationRules` array or Apollo's `validationRules` option.
 *
 * @example
 * const { rules } = createComplexityPlugin({ maxComplexity: 1000, maxDepth: 10 });
 * const handler = createHandler({ schema, validationRules: rules });
 */
export function createComplexityPlugin(opts: ComplexityPluginOptions): {
  rules: Array<(ctx: ValidationContext) => ASTVisitor>;
} {
  const { maxComplexity, maxDepth, fieldCosts, onComplexity } = opts;

  const complexityRule = (context: ValidationContext): ASTVisitor => ({
    Document(node) {
      const schema = context.getSchema();
      const { score, depth } = calculateComplexity(node, schema, { fieldCosts });

      if (onComplexity) onComplexity(score, depth);

      Logger.debug("[GraphQL] Complexity check", { score, depth, maxComplexity, maxDepth });

      if (score > maxComplexity) {
        context.reportError(
          new GraphQLError(
            `Query complexity ${score} exceeds maximum allowed ${maxComplexity}`,
            { extensions: { code: "COMPLEXITY_LIMIT_EXCEEDED", complexity: score, maxComplexity } }
          )
        );
      }
    },
  });

  return {
    rules: [depthLimit(maxDepth), complexityRule],
  };
}

// ─── Middleware: attach complexity to context ─────────────────────────────────
/**
 * Express middleware that pre-computes complexity and attaches it to req.
 * Useful if resolvers need to enforce per-operation rate limits.
 */
export function complexityContextMiddleware(
  schema: GraphQLSchema,
  opts: { fieldCosts?: Record<string, FieldCost> } = {}
) {
  return (req: any, _res: any, next: () => void) => {
    try {
      if (req.body?.query) {
        const { parse } = require("graphql");
        const doc: DocumentNode = parse(req.body.query);
        const { score, depth } = calculateComplexity(doc, schema, {
          fieldCosts: opts.fieldCosts,
          variables: req.body.variables,
        });
        req.graphqlComplexity = score;
        req.graphqlDepth = depth;
      }
    } catch {
      // Parse errors will be caught by graphql-http — ignore here
    }
    next();
  };
}
