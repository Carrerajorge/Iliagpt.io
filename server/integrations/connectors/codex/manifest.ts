import type { ConnectorManifest } from "../../kernel/types";

export const codexManifest: ConnectorManifest = {
  connectorId: "codex",
  version: "1.0.0",
  displayName: "Codex",
  category: "general" as any,
  description: "Advanced AI integration for Codex",
  iconUrl: "/assets/icons/codex.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.codex.com/oauth/authorize",
    tokenUrl: "https://api.codex.com/oauth/token",
    scopes: ["codex.read","codex.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["CODEX_CLIENT_ID", "CODEX_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "codex_search",
      name: "Search items in Codex",
      description: "Search items in Codex",
      requiredScopes: ["codex.read","codex.write"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          "query": {
                    "type": "string",
                    "description": "Search query"
          }
},
        required: ["query"]
      },
      outputSchema: { type: "object", properties: {} }
    },
    {
      operationId: "codex_create",
      name: "Create a new item in Codex",
      description: "Create a new item in Codex",
      requiredScopes: ["codex.read","codex.write"],
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          "name": {
                    "type": "string",
                    "description": "Item name"
          },
          "description": {
                    "type": "string"
          }
},
        required: ["name"]
      },
      outputSchema: { type: "object", properties: {} }
    }
  ]
};
