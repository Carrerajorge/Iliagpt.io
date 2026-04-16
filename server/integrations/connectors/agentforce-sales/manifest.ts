import type { ConnectorManifest } from "../../kernel/types";

export const agentforcesalesManifest: ConnectorManifest = {
  connectorId: "agentforce-sales",
  version: "1.0.0",
  displayName: "Agentforce Sales",
  category: "general" as any,
  description: "Advanced AI integration for Agentforce Sales",
  iconUrl: "/assets/icons/agentforce-sales.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.agentforcesales.com/oauth/authorize",
    tokenUrl: "https://api.agentforcesales.com/oauth/token",
    scopes: ["agentforce_sales.read","agentforce_sales.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["AGENTFORCE_SALES_CLIENT_ID", "AGENTFORCE_SALES_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "agentforce_sales_search",
      name: "Search items in Agentforce Sales",
      description: "Search items in Agentforce Sales",
      requiredScopes: ["agentforce_sales.read","agentforce_sales.write"],
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
      operationId: "agentforce_sales_create",
      name: "Create a new item in Agentforce Sales",
      description: "Create a new item in Agentforce Sales",
      requiredScopes: ["agentforce_sales.read","agentforce_sales.write"],
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
