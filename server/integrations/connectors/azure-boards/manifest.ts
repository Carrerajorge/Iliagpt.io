import type { ConnectorManifest } from "../../kernel/types";

export const azureboardsManifest: ConnectorManifest = {
  connectorId: "azure-boards",
  version: "1.0.0",
  displayName: "Azure Boards",
  category: "general" as any,
  description: "Advanced AI integration for Azure Boards",
  iconUrl: "/assets/icons/azure-boards.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.azureboards.com/oauth/authorize",
    tokenUrl: "https://api.azureboards.com/oauth/token",
    scopes: ["azure_boards.read","azure_boards.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["AZURE_BOARDS_CLIENT_ID", "AZURE_BOARDS_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "azure_boards_search",
      name: "Search items in Azure Boards",
      description: "Search items in Azure Boards",
      requiredScopes: ["azure_boards.read","azure_boards.write"],
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
      operationId: "azure_boards_create",
      name: "Create a new item in Azure Boards",
      description: "Create a new item in Azure Boards",
      requiredScopes: ["azure_boards.read","azure_boards.write"],
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
