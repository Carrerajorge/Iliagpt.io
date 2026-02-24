import { createRestHandler } from "../../kernel/baseConnectorHandler";
import { googledriveManifest } from "./manifest";

const API_BASE = "https://www.googleapis.com/drive/v3";

export const handler = createRestHandler(googledriveManifest, API_BASE, {
  "google_drive_search": { path: "/files", method: "GET" },
  "google_drive_create": { path: "/files", method: "POST" },
});
