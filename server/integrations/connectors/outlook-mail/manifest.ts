import type { ConnectorManifest } from "../../kernel/types";

export const outlookmailManifest: ConnectorManifest = {
  connectorId: "outlook-mail",
  version: "1.0.0",
  displayName: "Outlook Mail",
  category: "general" as any,
  description: "Advanced AI integration for Outlook Mail",
  iconUrl: "/assets/icons/outlook-mail.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.outlookmail.com/oauth/authorize",
    tokenUrl: "https://api.outlookmail.com/oauth/token",
    scopes: ["outlook_mail.read","outlook_mail.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["OUTLOOK_MAIL_CLIENT_ID", "OUTLOOK_MAIL_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "outlook_mail_search",
      name: "Search items in Outlook Mail",
      description: "Search items in Outlook Mail",
      requiredScopes: ["outlook_mail.read","outlook_mail.write"],
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
      operationId: "outlook_mail_create",
      name: "Create a new item in Outlook Mail",
      description: "Create a new item in Outlook Mail",
      requiredScopes: ["outlook_mail.read","outlook_mail.write"],
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
