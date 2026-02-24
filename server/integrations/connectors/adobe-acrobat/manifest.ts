import type { ConnectorManifest } from "../../kernel/types";

export const adobeacrobatManifest: ConnectorManifest = {
  connectorId: "adobe-acrobat",
  version: "1.0.0",
  displayName: "Adobe Acrobat",
  category: "productivity" as any,
  description: "Advanced AI integration for Adobe Acrobat",
  iconUrl: "/assets/icons/adobe-acrobat.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://ims-na1.adobelogin.com/ims/authorize/v2",
    tokenUrl: "https://ims-na1.adobelogin.com/ims/token/v3",
    scopes: ["document.read","document.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["ADOBE_ACROBAT_CLIENT_ID", "ADOBE_ACROBAT_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "acrobat_extract_pdf",
      name: "Extract content from a PDF",
      description: "Extract content from a PDF",
      requiredScopes: ["document.read","document.write"],
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          "fileId": {
                    "type": "string"
          }
},
        required: ["fileId"]
      },
      outputSchema: { type: "object", properties: {} }
    }
  ]
};
