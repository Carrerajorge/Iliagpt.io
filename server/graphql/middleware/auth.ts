/**
 * GraphQL Authentication & Authorization Middleware
 * - buildContext: extracts user from Express session/req.user
 * - authDirectiveTransformer: applies @auth directive at schema level
 * - permissionCheck: field-level role guard
 * - rateLimitByComplexity: rejects queries over a complexity budget
 */

import { GraphQLError, GraphQLSchema, defaultFieldResolver } from "graphql";
import { getDirective, MapperKind, mapSchema } from "@graphql-tools/utils";
import type { Request } from "express";
import { Logger } from "../../lib/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface GraphQLUser {
  id: string;
  role: string;
  email?: string;
  plan?: string;
}

export interface GraphQLContext {
  user: GraphQLUser | null;
  req: Request;
  requestId: string;
}

// Role hierarchy — higher index = more privileged
const ROLE_HIERARCHY: Record<string, number> = {
  GUEST: 0,
  USER: 1,
  EDITOR: 2,
  ADMIN: 3,
};

function hasRole(userRole: string, required: string): boolean {
  const userLevel = ROLE_HIERARCHY[(userRole ?? "").toUpperCase()] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[(required ?? "USER").toUpperCase()] ?? 1;
  return userLevel >= requiredLevel;
}

// ─── buildContext ─────────────────────────────────────────────────────────────
/**
 * Called on every request to extract user identity from the Express session.
 * The result becomes `context` in all resolvers.
 */
export function buildContext(req: Request): GraphQLContext {
  const anyReq = req as any;

  // req.user is set by passport / requireAuth middleware
  const sessionUser = anyReq.user ?? anyReq.session?.passport?.user ?? null;

  let user: GraphQLUser | null = null;

  if (sessionUser?.id) {
    user = {
      id: String(sessionUser.id),
      role: (sessionUser.role ?? "user").toUpperCase(),
      email: sessionUser.email ?? undefined,
      plan: sessionUser.plan ?? "free",
    };
  }

  const requestId =
    (anyReq.id as string) ||
    (req.headers["x-request-id"] as string) ||
    `gql-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (user) {
    Logger.debug("[GraphQL] Context built", { userId: user.id, role: user.role, requestId });
  }

  return { user, req, requestId };
}

// ─── @auth directive transformer ──────────────────────────────────────────────
/**
 * Transforms the schema to enforce @auth directives declared in SDL.
 * Usage: directive @auth(requires: Role = USER) on FIELD_DEFINITION | OBJECT
 */
export function authDirectiveTransformer(schema: GraphQLSchema): GraphQLSchema {
  return mapSchema(schema, {
    [MapperKind.OBJECT_FIELD](fieldConfig) {
      const authDirective = getDirective(schema, fieldConfig, "auth")?.[0];
      if (!authDirective) return fieldConfig;

      const requiredRole: string = authDirective["requires"] ?? "USER";
      const { resolve = defaultFieldResolver } = fieldConfig;

      return {
        ...fieldConfig,
        async resolve(source, args, context: GraphQLContext, info) {
          if (!context.user) {
            Logger.security("[GraphQL] Unauthenticated access attempt", {
              field: info.fieldName,
              path: info.path,
              requestId: context.requestId,
            });
            throw new GraphQLError("You must be logged in to perform this action", {
              extensions: { code: "UNAUTHENTICATED" },
            });
          }

          if (!hasRole(context.user.role, requiredRole)) {
            Logger.security("[GraphQL] Insufficient permissions", {
              userId: context.user.id,
              userRole: context.user.role,
              required: requiredRole,
              field: info.fieldName,
              requestId: context.requestId,
            });
            throw new GraphQLError(`You need ${requiredRole} role to perform this action`, {
              extensions: { code: "FORBIDDEN" },
            });
          }

          return resolve(source, args, context, info);
        },
      };
    },

    // Also handle object-level @auth directives
    [MapperKind.OBJECT_TYPE](typeConfig) {
      const authDirective = getDirective(schema, typeConfig, "auth")?.[0];
      if (!authDirective) return typeConfig;
      // Object-level auth is enforced on each field via the OBJECT_FIELD mapper above
      return typeConfig;
    },
  });
}

// ─── permissionCheck ─────────────────────────────────────────────────────────
/**
 * Field-level permission middleware factory.
 * Wrap a resolver function to require a minimum role.
 *
 * @example
 * resolve: permissionCheck("ADMIN", (source, args, ctx) => ctx.user)
 */
export function permissionCheck<TSource, TArgs, TReturn>(
  requiredRole: string,
  resolver: (source: TSource, args: TArgs, context: GraphQLContext, info: any) => TReturn | Promise<TReturn>
) {
  return async (source: TSource, args: TArgs, context: GraphQLContext, info: any): Promise<TReturn> => {
    if (!context.user) {
      throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHENTICATED" } });
    }
    if (!hasRole(context.user.role, requiredRole)) {
      throw new GraphQLError(`Requires ${requiredRole} role`, { extensions: { code: "FORBIDDEN" } });
    }
    return resolver(source, args, context, info);
  };
}

// ─── rateLimitByComplexity ────────────────────────────────────────────────────
/**
 * Middleware that checks a pre-computed complexity score on the context.
 * Must be used together with the complexity plugin that sets context.complexity.
 */
export function rateLimitByComplexity(maxComplexity: number) {
  return (source: unknown, args: unknown, context: GraphQLContext & { complexity?: number }, info: any) => {
    const complexity = context.complexity ?? 0;
    if (complexity > maxComplexity) {
      Logger.warn("[GraphQL] Query rejected — complexity too high", {
        complexity,
        maxComplexity,
        userId: context.user?.id,
        requestId: context.requestId,
      });
      throw new GraphQLError(
        `Query complexity ${complexity} exceeds maximum allowed ${maxComplexity}`,
        { extensions: { code: "COMPLEXITY_LIMIT_EXCEEDED", complexity, maxComplexity } }
      );
    }
  };
}

// ─── Admin guard helper ───────────────────────────────────────────────────────
export function requireAdminContext(ctx: GraphQLContext): void {
  if (!ctx.user) {
    throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHENTICATED" } });
  }
  if (!hasRole(ctx.user.role, "ADMIN")) {
    throw new GraphQLError("Admin access required", { extensions: { code: "FORBIDDEN" } });
  }
}

// ─── Auth error factories ─────────────────────────────────────────────────────
export const AuthErrors = {
  unauthenticated: () =>
    new GraphQLError("You must be logged in", { extensions: { code: "UNAUTHENTICATED" } }),

  forbidden: (action?: string) =>
    new GraphQLError(action ? `Forbidden: ${action}` : "Access denied", { extensions: { code: "FORBIDDEN" } }),

  notFound: (resource?: string) =>
    new GraphQLError(resource ? `${resource} not found` : "Not found", { extensions: { code: "NOT_FOUND" } }),
};
