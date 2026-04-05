import { ApolloServer, BaseContext } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { mergeResolvers } from '@graphql-tools/merge';
import { useServer } from 'graphql-ws/lib/use/ws';
import { WebSocketServer } from 'ws';
import { GraphQLError, GraphQLFormattedError } from 'graphql';
import depthLimit from 'graphql-depth-limit';
import express from 'express';
import type { Application } from 'express';
import type { Server as HttpServer } from 'http';
import { json } from 'body-parser';
import cors from 'cors';

import { typeDefs } from './schema';
import { chatResolvers } from './resolvers/chatResolvers';
import { agentResolvers } from './resolvers/agentResolvers';
import { modelResolvers } from './resolvers/modelResolvers';
import { userResolvers } from './resolvers/userResolvers';
import { Logger } from '../lib/logger';
import { getSecureUserId } from '../lib/anonUserHelper';

// ─── Context ──────────────────────────────────────────────────────────────────

export interface GraphQLContext extends BaseContext {
  userId: string | null;
  role: string | null;
  requestId: string;
  ip: string | null;
}

// ─── Scalar resolvers ─────────────────────────────────────────────────────────

import { GraphQLScalarType, Kind } from 'graphql';

const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  description: 'ISO-8601 date-time string',
  serialize(value: unknown) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return new Date(value).toISOString();
    if (typeof value === 'number') return new Date(value).toISOString();
    throw new Error('DateTime cannot represent non-date value');
  },
  parseValue(value: unknown) {
    if (typeof value === 'string') {
      const d = new Date(value);
      if (isNaN(d.getTime())) throw new Error('Invalid DateTime string');
      return d;
    }
    throw new Error('DateTime must be a string');
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) {
      const d = new Date(ast.value);
      if (isNaN(d.getTime())) throw new Error('Invalid DateTime literal');
      return d;
    }
    throw new Error('DateTime must be a string literal');
  },
});

const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value',
  serialize: (v) => v,
  parseValue: (v) => v,
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) {
      try { return JSON.parse(ast.value); } catch { return ast.value; }
    }
    if (ast.kind === Kind.INT || ast.kind === Kind.FLOAT) return parseFloat(ast.value);
    if (ast.kind === Kind.BOOLEAN) return ast.value;
    if (ast.kind === Kind.NULL) return null;
    // Object or List literals — handled by GraphQL's built-in literal walking
    return ast;
  },
});

const scalarResolvers = {
  DateTime: DateTimeScalar,
  JSON: JSONScalar,
};

// ─── Persisted queries (in-memory store, swap for Redis in prod) ──────────────

const persistedQueryCache = new Map<string, string>();

// ─── Query complexity / depth limits ─────────────────────────────────────────

const MAX_QUERY_DEPTH = 10;
// Simple field-count heuristic; replace with graphql-query-complexity for fine-grained limits
const MAX_QUERY_COMPLEXITY = 500;

function buildComplexityPlugin() {
  return {
    requestDidStart() {
      return {
        didResolveOperation({ document }: { document: import('graphql').DocumentNode }) {
          // Basic node-count complexity heuristic
          let count = 0;
          function walk(node: import('graphql').ASTNode) {
            count++;
            if ('selectionSet' in node && node.selectionSet) {
              for (const sel of node.selectionSet.selections) walk(sel);
            }
          }
          for (const def of document.definitions) walk(def);

          if (count > MAX_QUERY_COMPLEXITY) {
            throw new GraphQLError(
              `Query too complex (${count} > ${MAX_QUERY_COMPLEXITY})`,
              { extensions: { code: 'QUERY_TOO_COMPLEX' } },
            );
          }
        },
      };
    },
  };
}

// ─── Error formatter ──────────────────────────────────────────────────────────

const isProd = process.env.NODE_ENV === 'production';

function formatError(
  formattedError: GraphQLFormattedError,
  error: unknown,
): GraphQLFormattedError {
  const code = (formattedError.extensions?.code as string | undefined) ?? 'INTERNAL_SERVER_ERROR';

  // Always expose client-safe errors
  const safeCode = new Set([
    'BAD_USER_INPUT',
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'NOT_FOUND',
    'QUERY_TOO_COMPLEX',
    'GRAPHQL_PARSE_FAILED',
    'GRAPHQL_VALIDATION_FAILED',
    'PERSISTED_QUERY_NOT_FOUND',
  ]);

  if (safeCode.has(code)) return formattedError;

  // Hide internals in production
  if (isProd) {
    Logger.error('GraphQL internal error', { error, formattedError });
    return {
      message: 'An internal error occurred',
      locations: formattedError.locations,
      path: formattedError.path,
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    };
  }

  return formattedError;
}

// ─── Context builder ──────────────────────────────────────────────────────────

async function buildContext({ req }: { req: express.Request }): Promise<GraphQLContext> {
  let userId: string | null = null;
  let role: string | null = null;

  try {
    // Primary: session-based auth (passport)
    const sessionUser = (req.session as Record<string, unknown> & { passport?: { user?: { id?: string; role?: string } } })?.passport?.user;
    if (sessionUser?.id) {
      userId = sessionUser.id;
      role = sessionUser.role?.toUpperCase() ?? 'USER';
    }

    // Fallback: Bearer JWT
    if (!userId) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        // In production: verify JWT and decode claims
        // const claims = jwt.verify(token, process.env.JWT_SECRET!);
        // userId = claims.sub as string;
        // role = (claims.role as string)?.toUpperCase() ?? 'USER';
        void token; // suppress unused var warning until jwt integration is wired
      }
    }

    // Fallback: helper used by existing routes
    if (!userId) {
      const secureId = getSecureUserId(req);
      if (secureId && !String(secureId).startsWith('anon_')) {
        userId = secureId;
        role = 'USER';
      }
    }
  } catch (err) {
    Logger.warn('Failed to resolve GraphQL context user', { err });
  }

  const requestId =
    (req.headers['x-request-id'] as string | undefined) ??
    `gql_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    userId,
    role,
    requestId,
    ip: req.ip ?? null,
  };
}

async function buildWsContext(ctx: {
  connectionParams?: Record<string, unknown> | null;
}): Promise<Omit<GraphQLContext, keyof BaseContext>> {
  // WebSocket subscriptions auth via connectionParams
  const token = ctx.connectionParams?.authorization as string | undefined;
  let userId: string | null = null;
  let role: string | null = null;

  if (token?.startsWith('Bearer ')) {
    const raw = token.slice(7);
    // In production: verify JWT
    void raw;
  }

  return {
    userId,
    role,
    requestId: `ws_${Date.now()}`,
    ip: null,
  };
}

// ─── Schema assembly ──────────────────────────────────────────────────────────

const mergedResolvers = mergeResolvers([
  scalarResolvers,
  chatResolvers,
  agentResolvers,
  modelResolvers,
  userResolvers,
]);

export const schema = makeExecutableSchema({
  typeDefs,
  resolvers: mergedResolvers,
});

// ─── Apollo Server factory ────────────────────────────────────────────────────

export async function setupGraphQL(
  app: Application,
  httpServer: HttpServer,
): Promise<ApolloServer<GraphQLContext>> {
  // ── WebSocket server for subscriptions ──────────────────────────────────────
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/graphql',
  });

  const wsServerCleanup = useServer(
    {
      schema,
      context: buildWsContext,
      onConnect(ctx) {
        Logger.info('WS client connected', {
          protocol: ctx.extra.socket.protocol,
        });
      },
      onDisconnect() {
        Logger.info('WS client disconnected');
      },
      onError(ctx, _msg, errors) {
        Logger.error('WS error', { errors });
      },
    },
    wsServer,
  );

  // ── Apollo server ────────────────────────────────────────────────────────────
  const server = new ApolloServer<GraphQLContext>({
    schema,
    validationRules: [depthLimit(MAX_QUERY_DEPTH)],
    formatError,
    introspection: !isProd,
    plugins: [
      // Graceful HTTP shutdown
      ApolloServerPluginDrainHttpServer({ httpServer }),

      // Graceful WS shutdown
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await wsServerCleanup.dispose();
            },
          };
        },
      },

      // Request complexity limiter
      buildComplexityPlugin() as Parameters<typeof ApolloServer.prototype.addPlugin>[0],

      // Request logging plugin
      {
        requestDidStart() {
          const start = Date.now();
          return {
            willSendResponse({ request, response }) {
              const elapsed = Date.now() - start;
              const opName = request.operationName ?? 'anonymous';
              const errors = (response.body as Record<string, unknown>)?.errors;

              if (errors) {
                Logger.warn('GraphQL request with errors', {
                  operationName: opName,
                  elapsedMs: elapsed,
                });
              } else {
                Logger.info('GraphQL request completed', {
                  operationName: opName,
                  elapsedMs: elapsed,
                });
              }
            },
          };
        },
      },
    ],
  });

  await server.start();

  // ── Express middleware ───────────────────────────────────────────────────────
  app.use(
    '/graphql',
    cors<cors.CorsRequest>({
      origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
      credentials: true,
    }),
    json({ limit: '10mb' }),
    expressMiddleware(server, {
      context: buildContext,
    }),
  );

  Logger.info('GraphQL endpoint ready', {
    path: '/graphql',
    introspection: !isProd,
    subscriptions: 'ws://[host]/graphql',
    depthLimit: MAX_QUERY_DEPTH,
    complexityLimit: MAX_QUERY_COMPLEXITY,
  });

  return server;
}

// ─── Persisted query helpers (exported for use by route handlers if needed) ───

export function getPersistedQuery(queryId: string): string | undefined {
  return persistedQueryCache.get(queryId);
}

export function setPersistedQuery(queryId: string, query: string): void {
  persistedQueryCache.set(queryId, query);
}

export type { GraphQLContext as GqlContext };
