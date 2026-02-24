import type { ConnectorManifest } from "../../kernel/types";

export const outlookcalendarManifest: ConnectorManifest = {
  connectorId: "outlook-calendar",
  version: "1.0.0",
  displayName: "Outlook Calendar",
  category: "general" as any,
  description: "Advanced AI integration for Outlook Calendar",
  iconUrl: "/assets/icons/outlook-calendar.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.outlookcalendar.com/oauth/authorize",
    tokenUrl: "https://api.outlookcalendar.com/oauth/token",
    scopes: ["outlook_calendar.read","outlook_calendar.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["OUTLOOK_CALENDAR_CLIENT_ID", "OUTLOOK_CALENDAR_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "outlook_calendar_search",
      name: "Search items in Outlook Calendar",
      description: "Search items in Outlook Calendar",
      requiredScopes: ["outlook_calendar.read","outlook_calendar.write"],
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
      operationId: "outlook_calendar_create",
      name: "Create a new item in Outlook Calendar",
      description: "Create a new item in Outlook Calendar",
      requiredScopes: ["outlook_calendar.read","outlook_calendar.write"],
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
