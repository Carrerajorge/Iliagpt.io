/**
 * macOS Calendar, Contacts, and Reminders access via AppleScript/JXA
 */

import { runJxa, runOsascript, type OsascriptResult } from "./osascriptBridge";

// ── Types ──────────────────────────────────────────────────────────────

export interface CalendarEvent {
  title: string;
  startDate: string;
  endDate: string;
  location: string;
  notes: string;
  calendar: string;
  allDay: boolean;
  url: string;
}

export interface Contact {
  name: string;
  email: string[];
  phone: string[];
  organization: string;
}

export interface Reminder {
  name: string;
  completed: boolean;
  dueDate: string | null;
  priority: number;
  list: string;
  notes: string;
}

// ── Calendar ───────────────────────────────────────────────────────────

export async function getCalendarEvents(
  daysAhead = 7,
  calendarName?: string
): Promise<CalendarEvent[]> {
  const calFilter = calendarName
    ? `whose name is "${calendarName.replace(/"/g, '\\"')}"`
    : "";

  const r = await runJxa(`
    const cal = Application("Calendar");
    const now = new Date();
    const end = new Date(now.getTime() + ${daysAhead} * 86400000);

    let calendars = cal.calendars${calFilter ? `.whose({ name: "${calendarName}" })` : ""}();
    const events = [];

    for (const c of calendars) {
      try {
        const calEvents = c.events.whose({
          _and: [
            { startDate: { _greaterThan: now } },
            { startDate: { _lessThan: end } }
          ]
        })();

        for (const e of calEvents) {
          try {
            events.push({
              title: e.summary(),
              startDate: e.startDate().toISOString(),
              endDate: e.endDate().toISOString(),
              location: e.location() || "",
              notes: (e.description && e.description()) || "",
              calendar: c.name(),
              allDay: e.alldayEvent(),
              url: e.url() || "",
            });
          } catch(err) {}
        }
      } catch(err) {}
    }

    events.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    JSON.stringify(events);
  `, 15000);

  if (!r.success) return [];
  try { return JSON.parse(r.output); } catch { return []; }
}

export async function createCalendarEvent(
  title: string,
  startDate: Date,
  endDate: Date,
  options: { calendar?: string; location?: string; notes?: string; allDay?: boolean } = {}
): Promise<OsascriptResult> {
  const calName = options.calendar || "Calendar";
  const safe = (s: string) => s.replace(/"/g, '\\"');

  return runJxa(`
    const cal = Application("Calendar");
    const targetCal = cal.calendars.whose({ name: "${safe(calName)}" })()[0] || cal.calendars[0];

    const event = cal.Event({
      summary: "${safe(title)}",
      startDate: new Date("${startDate.toISOString()}"),
      endDate: new Date("${endDate.toISOString()}"),
      ${options.location ? `location: "${safe(options.location)}",` : ""}
      ${options.notes ? `description: "${safe(options.notes)}",` : ""}
      ${options.allDay ? "alldayEvent: true," : ""}
    });

    targetCal.events.push(event);
    "Event created: ${safe(title)}";
  `);
}

export async function listCalendars(): Promise<string[]> {
  const r = await runJxa(`
    const cal = Application("Calendar");
    JSON.stringify(cal.calendars().map(c => c.name()));
  `);
  if (!r.success) return [];
  try { return JSON.parse(r.output); } catch { return []; }
}

// ── Contacts ───────────────────────────────────────────────────────────

export async function searchContacts(query: string): Promise<Contact[]> {
  const safe = query.replace(/"/g, '\\"');
  const r = await runJxa(`
    const contacts = Application("Contacts");
    const people = contacts.people.whose({
      _or: [
        { name: { _contains: "${safe}" } },
        { organization: { _contains: "${safe}" } },
      ]
    })();

    const result = people.slice(0, 20).map(p => {
      let emails = [];
      let phones = [];
      try { emails = p.emails().map(e => e.value()); } catch {}
      try { phones = p.phones().map(ph => ph.value()); } catch {}
      return {
        name: p.name() || "",
        email: emails,
        phone: phones,
        organization: p.organization() || "",
      };
    });

    JSON.stringify(result);
  `, 10000);

  if (!r.success) return [];
  try { return JSON.parse(r.output); } catch { return []; }
}

// ── Reminders ──────────────────────────────────────────────────────────

export async function getReminders(
  listName?: string,
  includeCompleted = false
): Promise<Reminder[]> {
  const r = await runJxa(`
    const rem = Application("Reminders");
    let lists = ${listName ? `rem.lists.whose({ name: "${listName.replace(/"/g, '\\"')}" })()` : "rem.lists()"};

    const result = [];
    for (const list of lists) {
      try {
        const items = list.reminders${includeCompleted ? "" : '.whose({ completed: false })'}();
        for (const item of items) {
          try {
            result.push({
              name: item.name(),
              completed: item.completed(),
              dueDate: item.dueDate() ? item.dueDate().toISOString() : null,
              priority: item.priority(),
              list: list.name(),
              notes: item.body() || "",
            });
          } catch(e) {}
        }
      } catch(e) {}
    }
    JSON.stringify(result);
  `, 10000);

  if (!r.success) return [];
  try { return JSON.parse(r.output); } catch { return []; }
}

export async function createReminder(
  name: string,
  options: { list?: string; dueDate?: Date; notes?: string; priority?: number } = {}
): Promise<OsascriptResult> {
  const safe = (s: string) => s.replace(/"/g, '\\"');
  const listName = options.list || "Reminders";

  return runJxa(`
    const rem = Application("Reminders");
    const list = rem.lists.whose({ name: "${safe(listName)}" })()[0] || rem.defaultList();
    const newRem = rem.Reminder({
      name: "${safe(name)}",
      ${options.dueDate ? `dueDate: new Date("${options.dueDate.toISOString()}"),` : ""}
      ${options.notes ? `body: "${safe(options.notes)}",` : ""}
      ${options.priority ? `priority: ${options.priority},` : ""}
    });
    list.reminders.push(newRem);
    "Reminder created: ${safe(name)}";
  `);
}

export async function completeReminder(name: string, listName?: string): Promise<OsascriptResult> {
  const safe = name.replace(/"/g, '\\"');
  const listFilter = listName
    ? `rem.lists.whose({ name: "${listName.replace(/"/g, '\\"')}" })()[0]`
    : `rem.defaultList()`;

  return runJxa(`
    const rem = Application("Reminders");
    const list = ${listFilter};
    const items = list.reminders.whose({ name: "${safe}" })();
    if (items.length > 0) {
      items[0].completed = true;
      "Completed: ${safe}";
    } else {
      "Not found: ${safe}";
    }
  `);
}
