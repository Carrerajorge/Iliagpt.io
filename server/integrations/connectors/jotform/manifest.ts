import type { ConnectorManifest } from "../../kernel/types";

export const jotformManifest: ConnectorManifest = {
  connectorId: "jotform",
  version: "1.0.0",
  displayName: "Jotform",
  category: "general" as any,
  description: "Advanced AI integration for Jotform",
  iconUrl: "/assets/icons/jotform.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.jotform.com/oauth/authorize",
    tokenUrl: "https://api.jotform.com/oauth/token",
    scopes: ["jotform.read","jotform.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["JOTFORM_CLIENT_ID", "JOTFORM_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "jotform_search",
      name: "Search items in Jotform",
      description: "Search items in Jotform",
      requiredScopes: ["jotform.read","jotform.write"],
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
      operationId: "jotform_create",
      name: "Create a new item in Jotform",
      description: "Create a new item in Jotform",
      requiredScopes: ["jotform.read","jotform.write"],
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
