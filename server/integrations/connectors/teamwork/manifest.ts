import type { ConnectorManifest } from "../../kernel/types";

export const teamworkManifest: ConnectorManifest = {
  connectorId: "teamwork",
  version: "1.0.0",
  displayName: "Teamwork",
  category: "general" as any,
  description: "Advanced AI integration for Teamwork",
  iconUrl: "/assets/icons/teamwork.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.teamwork.com/oauth/authorize",
    tokenUrl: "https://api.teamwork.com/oauth/token",
    scopes: ["teamwork.read","teamwork.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["TEAMWORK_CLIENT_ID", "TEAMWORK_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "teamwork_search",
      name: "Search items in Teamwork",
      description: "Search items in Teamwork",
      requiredScopes: ["teamwork.read","teamwork.write"],
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
      operationId: "teamwork_create",
      name: "Create a new item in Teamwork",
      description: "Create a new item in Teamwork",
      requiredScopes: ["teamwork.read","teamwork.write"],
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
