import type { ConnectorManifest } from "../../kernel/types";

export const googlecontactsManifest: ConnectorManifest = {
  connectorId: "google-contacts",
  version: "1.0.0",
  displayName: "Google Contacts",
  category: "general" as any,
  description: "Advanced AI integration for Google Contacts",
  iconUrl: "/assets/icons/google-contacts.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.googlecontacts.com/oauth/authorize",
    tokenUrl: "https://api.googlecontacts.com/oauth/token",
    scopes: ["google_contacts.read","google_contacts.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["GOOGLE_CONTACTS_CLIENT_ID", "GOOGLE_CONTACTS_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "google_contacts_search",
      name: "Search items in Google Contacts",
      description: "Search items in Google Contacts",
      requiredScopes: ["google_contacts.read","google_contacts.write"],
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
      operationId: "google_contacts_create",
      name: "Create a new item in Google Contacts",
      description: "Create a new item in Google Contacts",
      requiredScopes: ["google_contacts.read","google_contacts.write"],
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
