import type { ConnectorManifest } from "../../kernel/types";

export const pipedriveManifest: ConnectorManifest = {
  connectorId: "pipedrive",
  version: "1.0.0",
  displayName: "Pipedrive",
  category: "general" as any,
  description: "Advanced AI integration for Pipedrive",
  iconUrl: "/assets/icons/pipedrive.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.pipedrive.com/oauth/authorize",
    tokenUrl: "https://api.pipedrive.com/oauth/token",
    scopes: ["pipedrive.read","pipedrive.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["PIPEDRIVE_CLIENT_ID", "PIPEDRIVE_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "pipedrive_search",
      name: "Search items in Pipedrive",
      description: "Search items in Pipedrive",
      requiredScopes: ["pipedrive.read","pipedrive.write"],
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
      operationId: "pipedrive_create",
      name: "Create a new item in Pipedrive",
      description: "Create a new item in Pipedrive",
      requiredScopes: ["pipedrive.read","pipedrive.write"],
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
