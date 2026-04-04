/**
 * Combined resolver map for the IliaGPT GraphQL Gateway
 * Deep-merges Query, Mutation, Subscription from all domain resolver modules
 */

import { chatResolvers } from "./chatResolvers.js";
import { agentResolvers } from "./agentResolvers.js";
import { modelResolvers } from "./modelResolvers.js";
import { userResolvers } from "./userResolvers.js";
import { documentResolvers } from "./documentResolvers.js";
import { analyticsResolvers } from "./analyticsResolvers.js";
import { Logger } from "../../lib/logger.js";

type ResolverMap = Record<string, unknown>;

/**
 * Deep-merges resolver objects.
 * - Handles nested objects (Query, Mutation, Subscription, type resolvers)
 * - Later sources overwrite earlier ones for leaf functions
 */
function deepMergeResolvers(...maps: ResolverMap[]): ResolverMap {
  const result: ResolverMap = {};

  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof result[key] === "object" &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        // Both are plain objects — recurse
        result[key] = deepMergeResolvers(result[key] as ResolverMap, value as ResolverMap);
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}

// Merge all resolver domains
export const resolvers = deepMergeResolvers(
  chatResolvers,
  agentResolvers,
  modelResolvers,
  userResolvers,
  documentResolvers,
  analyticsResolvers
);

Logger.info("[GraphQL] Resolvers loaded", {
  queryFields: Object.keys((resolvers.Query as ResolverMap) ?? {}).length,
  mutationFields: Object.keys((resolvers.Mutation as ResolverMap) ?? {}).length,
  subscriptionFields: Object.keys((resolvers.Subscription as ResolverMap) ?? {}).length,
});

// Re-export individual resolvers for testing
export { chatResolvers } from "./chatResolvers.js";
export { agentResolvers } from "./agentResolvers.js";
export { modelResolvers } from "./modelResolvers.js";
export { userResolvers } from "./userResolvers.js";
export { documentResolvers } from "./documentResolvers.js";
export { analyticsResolvers } from "./analyticsResolvers.js";
export { pubsub } from "./chatResolvers.js";
export { publishTaskProgress, publishAgentLog } from "./agentResolvers.js";
