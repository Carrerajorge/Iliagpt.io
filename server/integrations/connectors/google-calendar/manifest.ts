import type { ConnectorManifest } from "../../kernel/types";

export const googlecalendarManifest: ConnectorManifest = {
  connectorId: "google-calendar",
  version: "1.0.0",
  displayName: "Google Calendar",
  category: "general" as any,
  description: "Advanced AI integration for Google Calendar",
  iconUrl: "/assets/icons/google-calendar.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.googlecalendar.com/oauth/authorize",
    tokenUrl: "https://api.googlecalendar.com/oauth/token",
    scopes: ["google_calendar.read","google_calendar.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "google_calendar_search",
      name: "Search items in Google Calendar",
      description: "Search items in Google Calendar",
      requiredScopes: ["google_calendar.read","google_calendar.write"],
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
      operationId: "google_calendar_create",
      name: "Create a new item in Google Calendar",
      description: "Create a new item in Google Calendar",
      requiredScopes: ["google_calendar.read","google_calendar.write"],
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
