import type { ConnectorManifest } from "../../kernel/types";

export const asanaManifest: ConnectorManifest = {
  connectorId: "asana",
  version: "1.0.0",
  displayName: "Asana",
  category: "productivity" as any,
  description: "Advanced AI integration for Asana",
  iconUrl: "/assets/icons/asana.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://app.asana.com/-/oauth_authorize",
    tokenUrl: "https://app.asana.com/-/oauth_token",
    scopes: ["default"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["ASANA_CLIENT_ID", "ASANA_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "asana_search_tasks",
      name: "Search tasks in Asana workspaces",
      description: "Search tasks in Asana workspaces",
      requiredScopes: ["default"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          "workspaceId": {
                    "type": "string"
          },
          "text": {
                    "type": "string"
          }
},
        required: ["workspaceId","text"]
      },
      outputSchema: { type: "object", properties: {} }
    },
    {
      operationId: "asana_create_task",
      name: "Create a new task in Asana",
      description: "Create a new task in Asana",
      requiredScopes: ["default"],
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          "workspace": {
                    "type": "string"
          },
          "name": {
                    "type": "string"
          },
          "notes": {
                    "type": "string"
          }
},
        required: ["workspace","name"]
      },
      outputSchema: { type: "object", properties: {} }
    }
  ]
};
