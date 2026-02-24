import type { ConnectorManifest } from "../../kernel/types";

export const gmailManifest: ConnectorManifest = {
  connectorId: "gmail",
  version: "1.0.0",
  displayName: "Gmail",
  category: "email" as any,
  description: "Advanced AI integration for Gmail",
  iconUrl: "/assets/icons/gmail.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly","https://www.googleapis.com/auth/gmail.send"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "gmail_search",
      name: "Search emails",
      description: "Search emails",
      requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly","https://www.googleapis.com/auth/gmail.send"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          "q": {
                    "type": "string"
          }
},
        required: ["q"]
      },
      outputSchema: { type: "object", properties: {} }
    }
  ]
};
