import { createRestHandler } from "../../kernel/baseConnectorHandler";
import { googlecalendarManifest } from "./manifest";

const API_BASE = "https://www.googleapis.com/calendar/v3";

export const handler = createRestHandler(googlecalendarManifest, API_BASE, {
  google_calendar_list_events: {
    path: "/calendars/primary/events",
    method: "GET",
  },
  google_calendar_get_event: {
    path: "/calendars/primary/events/{eventId}",
    method: "GET",
  },
  google_calendar_create_event: {
    path: "/calendars/primary/events",
    method: "POST",
  },
  google_calendar_delete_event: {
    path: "/calendars/primary/events/{eventId}",
    method: "DELETE",
  },
}, {
  onBeforeRequest: async (req, operationId, input) => {
    if (operationId === "google_calendar_list_events") {
      // Default to singleEvents=true and orderBy=startTime for useful results
      if (!req.query.has("singleEvents")) {
        req.query.set("singleEvents", "true");
      }
      if (!req.query.has("orderBy")) {
        req.query.set("orderBy", "startTime");
      }
      if (!req.query.has("maxResults")) {
        req.query.set("maxResults", "10");
      }
      // Default timeMin to now if not specified
      if (!req.query.has("timeMin")) {
        req.query.set("timeMin", new Date().toISOString());
      }
    }

    if (operationId === "google_calendar_create_event") {
      // Transform flat input into Calendar API event resource
      const body: Record<string, any> = {};

      body.summary = input.summary;
      if (input.description) body.description = input.description as string;
      if (input.location) body.location = input.location as string;

      // Handle date/time
      if (input.startDateTime) {
        body.start = { dateTime: input.startDateTime as string };
        if (input.timeZone) body.start.timeZone = input.timeZone as string;
      } else if (input.startDate) {
        body.start = { date: input.startDate as string };
      } else {
        // Default: 1-hour event starting now
        const now = new Date();
        body.start = { dateTime: now.toISOString() };
        const end = new Date(now.getTime() + 60 * 60 * 1000);
        body.end = { dateTime: end.toISOString() };
      }

      if (input.endDateTime) {
        body.end = { dateTime: input.endDateTime as string };
        if (input.timeZone) body.end.timeZone = input.timeZone as string;
      } else if (input.endDate) {
        body.end = { date: input.endDate as string };
      } else if (!body.end) {
        // Default: 1 hour after start
        const startStr = (input.startDateTime as string) || new Date().toISOString();
        const startDate = new Date(startStr);
        body.end = { dateTime: new Date(startDate.getTime() + 60 * 60 * 1000).toISOString() };
        if (input.timeZone) body.end.timeZone = input.timeZone as string;
      }

      // Attendees
      if (input.attendees && typeof input.attendees === "string") {
        body.attendees = (input.attendees as string)
          .split(",")
          .map((email: string) => ({ email: email.trim() }));
      }

      // Replace the flat body with the structured one
      req.body = body;
    }
  },
});
