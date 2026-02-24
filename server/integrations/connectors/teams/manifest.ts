import type { ConnectorManifest } from "../../kernel/types";

export const teamsManifest: ConnectorManifest = {
  connectorId: "teams",
  version: "1.0.0",
  displayName: "Teams",
  category: "general" as any,
  description: "Advanced AI integration for Teams",
  iconUrl: "/assets/icons/teams.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.teams.com/oauth/authorize",
    tokenUrl: "https://api.teams.com/oauth/token",
    scopes: ["teams.read","teams.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["TEAMS_CLIENT_ID", "TEAMS_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "teams_search",
      name: "Search items in Teams",
      description: "Search items in Teams",
      requiredScopes: ["teams.read","teams.write"],
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
      operationId: "teams_create",
      name: "Create a new item in Teams",
      description: "Create a new item in Teams",
      requiredScopes: ["teams.read","teams.write"],
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
