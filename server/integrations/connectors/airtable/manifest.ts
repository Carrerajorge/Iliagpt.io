import type { ConnectorManifest } from "../../kernel/types";

export const airtableManifest: ConnectorManifest = {
  connectorId: "airtable",
  version: "1.0.0",
  displayName: "Airtable",
  category: "productivity" as any,
  description: "Advanced AI integration for Airtable",
  iconUrl: "/assets/icons/airtable.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://airtable.com/oauth2/v1/authorize",
    tokenUrl: "https://airtable.com/oauth2/v1/token",
    scopes: ["data.records:read","data.records:write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["AIRTABLE_CLIENT_ID", "AIRTABLE_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "airtable_list_records",
      name: "List records from an Airtable base/table",
      description: "List records from an Airtable base/table",
      requiredScopes: ["data.records:read","data.records:write"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          "baseId": {
                    "type": "string"
          },
          "tableId": {
                    "type": "string"
          },
          "limit": {
                    "type": "number"
          }
},
        required: ["baseId","tableId"]
      },
      outputSchema: { type: "object", properties: {} }
    },
    {
      operationId: "airtable_create_record",
      name: "Create a record in an Airtable base/table",
      description: "Create a record in an Airtable base/table",
      requiredScopes: ["data.records:read","data.records:write"],
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          "baseId": {
                    "type": "string"
          },
          "tableId": {
                    "type": "string"
          },
          "fields": {
                    "type": "object"
          }
},
        required: ["baseId","tableId","fields"]
      },
      outputSchema: { type: "object", properties: {} }
    }
  ]
};
