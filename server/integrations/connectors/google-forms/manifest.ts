import type { ConnectorManifest } from "../../kernel/types";

export const googleformsManifest: ConnectorManifest = {
  connectorId: "google-forms",
  version: "1.0.0",
  displayName: "Google Forms",
  category: "general" as any,
  description: "Advanced AI integration for Google Forms",
  iconUrl: "/assets/icons/google-forms.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.googleforms.com/oauth/authorize",
    tokenUrl: "https://api.googleforms.com/oauth/token",
    scopes: ["google_forms.read","google_forms.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["GOOGLE_FORMS_CLIENT_ID", "GOOGLE_FORMS_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "google_forms_search",
      name: "Search items in Google Forms",
      description: "Search items in Google Forms",
      requiredScopes: ["google_forms.read","google_forms.write"],
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
      operationId: "google_forms_create",
      name: "Create a new item in Google Forms",
      description: "Create a new item in Google Forms",
      requiredScopes: ["google_forms.read","google_forms.write"],
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
