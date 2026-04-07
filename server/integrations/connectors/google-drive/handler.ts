import { createRestHandler } from "../../kernel/baseConnectorHandler";
import { googledriveManifest } from "./manifest";

const API_BASE = "https://www.googleapis.com/drive/v3";

export const handler = createRestHandler(googledriveManifest, API_BASE, {
  google_drive_search: {
    path: "/files",
    method: "GET",
  },
  google_drive_get: {
    path: "/files/{fileId}",
    method: "GET",
  },
  google_drive_download: {
    path: "/files/{fileId}/export",
    method: "GET",
  },
  google_drive_create: {
    path: "/files",
    method: "POST",
  },
}, {
  onBeforeRequest: async (req, operationId, input) => {
    if (operationId === "google_drive_search") {
      // Drive search API expects fields param for useful results
      if (!req.query.has("fields")) {
        req.query.set("fields", "files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink,owners),nextPageToken");
      }
      if (!req.query.has("pageSize")) {
        req.query.set("pageSize", "20");
      }
    }
    if (operationId === "google_drive_get") {
      if (!req.query.has("fields")) {
        req.query.set("fields", "id,name,mimeType,modifiedTime,size,webViewLink,iconLink,owners,description,starred");
      }
    }
    if (operationId === "google_drive_create") {
      // Convert comma-separated parents string to array
      if (req.body?.parents && typeof req.body.parents === "string") {
        req.body.parents = req.body.parents.split(",").map((p: string) => p.trim());
      }
    }
  },
});
