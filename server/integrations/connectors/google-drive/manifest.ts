import type { ConnectorManifest } from "../../kernel/types";

export const googledriveManifest: ConnectorManifest = {
  connectorId: "google-drive",
  providerId: "google",
  version: "1.0.0",
  displayName: "Google Drive",
  category: "general" as any,
  description: "Search, read, and create files in Google Drive",
  iconUrl: "/assets/icons/google-drive.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "google_drive_search",
      name: "Search files in Google Drive",
      description: "Search for files and folders in Google Drive by name, content, or type. Use Drive search query syntax for the 'q' parameter (e.g. \"name contains 'report'\" or \"mimeType='application/pdf'\").",
      requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description: "Drive search query (e.g. \"name contains 'budget'\" or \"fullText contains 'quarterly report'\")",
          },
          pageSize: {
            type: "number",
            description: "Max results to return (1-100, default 20)",
          },
          orderBy: {
            type: "string",
            description: "Sort order (e.g. 'modifiedTime desc', 'name')",
          },
        },
        required: ["q"],
      },
      outputSchema: { type: "object", properties: {} },
    },
    {
      operationId: "google_drive_get",
      name: "Get file metadata from Google Drive",
      description: "Get metadata for a specific file by its ID, including name, size, mime type, and sharing info.",
      requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          fileId: {
            type: "string",
            description: "The ID of the file to retrieve",
          },
          fields: {
            type: "string",
            description: "Comma-separated fields to include (e.g. 'name,mimeType,size,webViewLink')",
          },
        },
        required: ["fileId"],
      },
      outputSchema: { type: "object", properties: {} },
    },
    {
      operationId: "google_drive_download",
      name: "Download/export file content from Google Drive",
      description: "Export a Google Doc/Sheet/Slide to a specific format, or download a binary file's content as text.",
      requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          fileId: {
            type: "string",
            description: "The ID of the file to export/download",
          },
          mimeType: {
            type: "string",
            description: "Export MIME type (e.g. 'text/plain', 'application/pdf', 'text/csv'). Required for Google Docs/Sheets/Slides.",
          },
        },
        required: ["fileId"],
      },
      outputSchema: { type: "object", properties: {} },
    },
    {
      operationId: "google_drive_create",
      name: "Create a new file in Google Drive",
      description: "Create a new file or folder in Google Drive.",
      requiredScopes: ["https://www.googleapis.com/auth/drive.file"],
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "File or folder name",
          },
          mimeType: {
            type: "string",
            description: "MIME type (e.g. 'application/vnd.google-apps.folder' for folders, 'application/vnd.google-apps.document' for Google Docs)",
          },
          parents: {
            type: "string",
            description: "Parent folder ID (comma-separated if multiple)",
          },
          description: {
            type: "string",
            description: "File description",
          },
        },
        required: ["name"],
      },
      outputSchema: { type: "object", properties: {} },
    },
  ],
};
