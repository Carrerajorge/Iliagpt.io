import { createRestHandler } from "../../kernel/baseConnectorHandler";
import { googlecalendarManifest } from "./manifest";

const API_BASE = "https://www.googleapis.com/calendar/v3";

export const handler = createRestHandler(googlecalendarManifest, API_BASE, {
  "google_calendar_search": { path: "/events", method: "GET" },
  "google_calendar_create": { path: "/calendars/primary/events", method: "POST" },
});
