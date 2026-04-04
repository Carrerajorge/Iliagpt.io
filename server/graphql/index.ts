/**
 * GraphQL Gateway — IliaGPT
 *
 * Sets up graphql-http handler on /graphql, GraphiQL on /graphiql (dev only),
 * and registers complexity + depth validation rules.
 *
 * Subscription WebSocket setup is noted in comments — requires a separate ws server.
 */

import type { Express, Request, Response } from "express";
import { createHandler } from "graphql-http/lib/use/express";
import { buildSchema, addResolversToSchema, validateSchema, GraphQLError } from "graphql";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { Logger } from "../lib/logger.js";
import { typeDefs } from "./schema.js";
import { resolvers } from "./resolvers/index.js";
import { buildContext, authDirectiveTransformer } from "./middleware/auth.js";
import { createComplexityPlugin } from "./middleware/complexity.js";

// ─── Configuration ────────────────────────────────────────────────────────────
const GRAPHQL_PATH = "/graphql";
const GRAPHIQL_PATH = "/graphiql";
const MAX_COMPLEXITY = 1000;
const MAX_DEPTH = 12;
const isDev = process.env.NODE_ENV !== "production";

// ─── Schema construction ──────────────────────────────────────────────────────
function buildExecutableSchema() {
  // 1. Build schema from SDL + resolvers
  let schema = makeExecutableSchema({
    typeDefs,
    resolvers: resolvers as any,
    // Allow field resolvers to return their own types (lenient resolution)
    inheritResolversFromInterfaces: false,
  });

  // 2. Apply @auth directive transformer
  schema = authDirectiveTransformer(schema);

  // 3. Validate schema
  const errors = validateSchema(schema);
  if (errors.length > 0) {
    for (const err of errors) {
      Logger.error("[GraphQL] Schema validation error", err);
    }
    throw new Error(`GraphQL schema has ${errors.length} validation error(s)`);
  }

  Logger.info("[GraphQL] Schema built and validated successfully");
  return schema;
}

// ─── setupGraphQL ─────────────────────────────────────────────────────────────
/**
 * Registers the GraphQL HTTP handler and (in dev) GraphiQL UI on the Express app.
 * Call this after all other middleware is registered in server/index.ts.
 */
export function setupGraphQL(app: Express): void {
  Logger.info("[GraphQL] Initializing gateway", { path: GRAPHQL_PATH, dev: isDev });

  // Build schema once at startup
  const schema = buildExecutableSchema();

  // Complexity + depth validation rules
  const { rules: complexityRules } = createComplexityPlugin({
    maxComplexity: MAX_COMPLEXITY,
    maxDepth: MAX_DEPTH,
    onComplexity(score, depth) {
      Logger.debug("[GraphQL] Query metrics", { complexity: score, depth });
    },
  });

  // ── graphql-http handler ──────────────────────────────────────────────────
  const graphqlHandler = createHandler({
    schema,
    context: (req) => {
      // req.raw is the underlying Express Request on graphql-http
      const expressReq = (req.raw as unknown as Request) ?? (req as unknown as Request);
      return buildContext(expressReq);
    },
    validationRules: complexityRules,
    onSubscribe(_req, params) {
      Logger.debug("[GraphQL] Operation", {
        operationName: params.operationName,
        variables: params.variables ? "[present]" : undefined,
      });
    },
  });

  // Mount handler — support GET and POST
  app.all(GRAPHQL_PATH, (req: Request, res: Response) => {
    graphqlHandler(req, res);
  });

  Logger.info("[GraphQL] Handler mounted", { path: GRAPHQL_PATH });

  // ── GraphiQL (development only) ───────────────────────────────────────────
  if (isDev) {
    app.get(GRAPHIQL_PATH, (_req: Request, res: Response) => {
      res.setHeader("Content-Type", "text/html");
      res.send(buildGraphiQLHTML());
    });
    Logger.info("[GraphQL] GraphiQL mounted (dev)", { path: GRAPHIQL_PATH });
  }

  // ── Subscription WebSocket (setup hint) ──────────────────────────────────
  // To enable subscriptions over WebSocket, add the following in server/index.ts
  // after `const httpServer = createServer(app)`:
  //
  //   import { WebSocketServer } from "ws";
  //   import { useServer } from "graphql-ws/lib/use/ws";
  //   import { pubsub } from "./graphql/resolvers/index.js";
  //
  //   const wsServer = new WebSocketServer({ server: httpServer, path: "/graphql" });
  //   useServer(
  //     {
  //       schema,
  //       context: (ctx) => buildContext(ctx.extra.request),
  //       onConnect: (ctx) => Logger.info("[GraphQL WS] Client connected"),
  //       onDisconnect: (ctx) => Logger.info("[GraphQL WS] Client disconnected"),
  //     },
  //     wsServer
  //   );
  //
  // Packages needed: graphql-ws, ws
  // See: https://the-guild.dev/graphql/ws

  Logger.info("[GraphQL] Gateway ready", {
    graphql: GRAPHQL_PATH,
    graphiql: isDev ? GRAPHIQL_PATH : "disabled",
    maxComplexity: MAX_COMPLEXITY,
    maxDepth: MAX_DEPTH,
  });
}

// ─── GraphiQL HTML ────────────────────────────────────────────────────────────
function buildGraphiQLHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>IliaGPT — GraphiQL</title>
  <link rel="stylesheet" href="https://unpkg.com/graphiql/graphiql.min.css" />
  <style>
    body { margin: 0; height: 100vh; display: flex; flex-direction: column; }
    #graphiql { flex: 1; }
    .header {
      background: #1a1a2e;
      color: #e0e0e0;
      padding: 8px 20px;
      font-family: system-ui, sans-serif;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .header strong { color: #7c6ef7; }
    .badge {
      background: #7c6ef7;
      color: white;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="header">
    <strong>IliaGPT</strong>
    GraphQL Gateway
    <span class="badge">DEV</span>
    <span style="margin-left:auto;opacity:.6">Max complexity: ${MAX_COMPLEXITY} &nbsp;|&nbsp; Max depth: ${MAX_DEPTH}</span>
  </div>
  <div id="graphiql"></div>

  <script crossorigin src="https://unpkg.com/react/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom/umd/react-dom.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/graphiql/graphiql.min.js"></script>

  <script>
    const fetcher = GraphiQL.createFetcher({
      url: '${GRAPHQL_PATH}',
      // Subscriptions (uncomment once ws server is running):
      // subscriptionUrl: 'ws://' + location.host + '${GRAPHQL_PATH}',
    });

    ReactDOM.render(
      React.createElement(GraphiQL, {
        fetcher,
        defaultEditorToolsVisibility: true,
        defaultTabs: [
          {
            query: \`# Welcome to IliaGPT GraphQL Gateway
# Try a query:

query Me {
  me {
    id
    email
    role
    plan
    tokensConsumed
  }
}

query Chats {
  chats(limit: 10) {
    edges {
      node {
        id
        title
        status
        messageCount
        updatedAt
      }
    }
    pageInfo {
      hasNextPage
      totalCount
    }
  }
}

query Models {
  models {
    id
    displayName
    provider
    contextWindow
    isDefault
    enabled
  }
}
\`,
          },
        ],
      }),
      document.getElementById('graphiql')
    );
  </script>
</body>
</html>`;
}

// Re-export for convenience
export { buildContext } from "./middleware/auth.js";
export { resolvers } from "./resolvers/index.js";
export { typeDefs } from "./schema.js";
