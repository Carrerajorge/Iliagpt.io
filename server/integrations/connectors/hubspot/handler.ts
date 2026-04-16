import { createRestHandler } from "../../kernel/baseConnectorHandler";
import { hubspotManifest } from "./manifest";

const API_BASE = "https://api.hubapi.com/crm/v3";

export const handler = createRestHandler(hubspotManifest, API_BASE, {
  "hubspot_search": { path: "/objects/contacts/search", method: "POST" },
  "hubspot_create": { path: "/objects/contacts", method: "POST" },
});
