import { tool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export const calendarCreateTool = tool(
  async (input) => {
    const { title, start, end, description, location, attendees = [], reminders = [], recurrence } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a calendar and scheduling expert. Create calendar event specifications.

Return JSON:
{
  "event": {
    "title": "event title",
    "start": "ISO datetime",
    "end": "ISO datetime",
    "allDay": boolean,
    "description": "event description",
    "location": "location",
    "organizer": "organizer info",
    "attendees": [
      { "email": "", "name": "", "status": "pending|accepted|declined" }
    ],
    "reminders": [
      { "type": "email|popup|sms", "minutesBefore": number }
    ],
    "recurrence": {
      "pattern": "daily|weekly|monthly|yearly",
      "interval": number,
      "until": "end date",
      "count": number,
      "daysOfWeek": []
    }
  },
  "icalendar": "ICS format string",
  "googleCalendar": { Google Calendar API format },
  "outlook": { Microsoft Graph API format },
  "conflicts": ["potential scheduling conflicts"],
  "suggestions": ["scheduling suggestions"]
}`,
          },
          {
            role: "user",
            content: `Create calendar event:
Title: ${title}
Start: ${start}
End: ${end}
Description: ${description || "None"}
Location: ${location || "None"}
Attendees: ${attendees.join(", ") || "None"}
Reminders: ${JSON.stringify(reminders)}
Recurrence: ${recurrence || "None"}`,
          },
        ],
        temperature: 0.2,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          title,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        event: { title, start, end },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "calendar_create",
    description: "Creates calendar events with attendees, reminders, recurrence rules, and multi-platform export.",
    schema: z.object({
      title: z.string().describe("Event title"),
      start: z.string().describe("Start date/time (ISO format)"),
      end: z.string().describe("End date/time (ISO format)"),
      description: z.string().optional().describe("Event description"),
      location: z.string().optional().describe("Event location"),
      attendees: z.array(z.string().email()).optional().default([]).describe("Attendee emails"),
      reminders: z.array(z.object({
        type: z.enum(["email", "popup", "sms"]),
        minutesBefore: z.number(),
      })).optional().default([]).describe("Reminder settings"),
      recurrence: z.string().optional().describe("Recurrence pattern (e.g., 'FREQ=WEEKLY;BYDAY=MO,WE,FR')"),
    }),
  }
);

export const taskCreateTool = tool(
  async (input) => {
    const { title, description, priority = "medium", dueDate, assignee, labels = [], subtasks = [] } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a task management expert. Create structured task specifications.

Return JSON:
{
  "task": {
    "id": "generated-uuid",
    "title": "task title",
    "description": "detailed description",
    "priority": "low|medium|high|urgent",
    "status": "todo|in_progress|done",
    "dueDate": "ISO datetime",
    "assignee": "assignee info",
    "labels": ["tags"],
    "subtasks": [
      { "title": "", "completed": boolean }
    ],
    "estimatedTime": "time estimate",
    "dependencies": ["dependent task ids"]
  },
  "integrations": {
    "trello": { Trello API format },
    "asana": { Asana API format },
    "jira": { Jira API format },
    "todoist": { Todoist API format }
  },
  "suggestions": {
    "breakdownSuggestions": ["ways to break down this task"],
    "priorityRecommendation": "recommended priority",
    "timeEstimate": "AI-estimated completion time"
  }
}`,
          },
          {
            role: "user",
            content: `Create task:
Title: ${title}
Description: ${description || "None"}
Priority: ${priority}
Due date: ${dueDate || "None"}
Assignee: ${assignee || "None"}
Labels: ${labels.join(", ") || "None"}
Subtasks: ${subtasks.join(", ") || "None"}`,
          },
        ],
        temperature: 0.3,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        task: { title, priority, dueDate },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "task_create",
    description: "Creates tasks with subtasks, priorities, and exports to Trello, Asana, Jira, and Todoist formats.",
    schema: z.object({
      title: z.string().describe("Task title"),
      description: z.string().optional().describe("Task description"),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional().default("medium").describe("Task priority"),
      dueDate: z.string().optional().describe("Due date (ISO format)"),
      assignee: z.string().optional().describe("Assignee email or name"),
      labels: z.array(z.string()).optional().default([]).describe("Task labels/tags"),
      subtasks: z.array(z.string()).optional().default([]).describe("Subtask titles"),
    }),
  }
);

export const noteCreateTool = tool(
  async (input) => {
    const { title, content, tags = [], format = "markdown", notebook } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a note-taking expert. Create well-structured notes.

Return JSON:
{
  "note": {
    "id": "generated-uuid",
    "title": "note title",
    "content": "formatted content",
    "format": "markdown|html|plain",
    "tags": ["tags"],
    "notebook": "notebook name",
    "createdAt": "ISO datetime",
    "wordCount": number,
    "readingTime": "estimated reading time"
  },
  "structuredContent": {
    "headings": ["extracted headings"],
    "links": ["extracted links"],
    "codeBlocks": ["extracted code"],
    "images": ["image references"],
    "todos": ["extracted todo items"]
  },
  "integrations": {
    "notion": { Notion API format },
    "evernote": { Evernote format },
    "obsidian": { Obsidian markdown format }
  },
  "suggestions": {
    "relatedTopics": ["related topics to explore"],
    "formatting": ["formatting improvements"],
    "structure": ["structure suggestions"]
  }
}`,
          },
          {
            role: "user",
            content: `Create note:
Title: ${title}
Content: ${content}
Tags: ${tags.join(", ") || "None"}
Format: ${format}
Notebook: ${notebook || "Default"}`,
          },
        ],
        temperature: 0.3,
      });

      const responseContent = response.choices[0].message.content || "";
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        note: { title, content, tags },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "note_create",
    description: "Creates structured notes with tags, formatting, and exports to Notion, Evernote, and Obsidian formats.",
    schema: z.object({
      title: z.string().describe("Note title"),
      content: z.string().describe("Note content"),
      tags: z.array(z.string()).optional().default([]).describe("Note tags"),
      format: z.enum(["markdown", "html", "plain"]).optional().default("markdown").describe("Content format"),
      notebook: z.string().optional().describe("Notebook/folder name"),
    }),
  }
);

export const reminderSetTool = tool(
  async (input) => {
    const { message, triggerTime, recurring, channels = ["push"] } = input;
    const startTime = Date.now();

    try {
      const triggerDate = new Date(triggerTime);
      const now = new Date();

      if (triggerDate <= now) {
        return JSON.stringify({
          success: false,
          error: "Trigger time must be in the future",
          latencyMs: Date.now() - startTime,
        });
      }

      const msUntilTrigger = triggerDate.getTime() - now.getTime();
      const timeUntil = {
        days: Math.floor(msUntilTrigger / (1000 * 60 * 60 * 24)),
        hours: Math.floor((msUntilTrigger % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((msUntilTrigger % (1000 * 60 * 60)) / (1000 * 60)),
      };

      return JSON.stringify({
        success: true,
        reminder: {
          id: `reminder-${Date.now()}`,
          message,
          triggerTime: triggerDate.toISOString(),
          recurring,
          channels,
          status: "scheduled",
        },
        timeUntil,
        cronExpression: recurring ? generateCronExpression(recurring) : null,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "reminder_set",
    description: "Sets reminders with flexible trigger times, recurring schedules, and multi-channel delivery.",
    schema: z.object({
      message: z.string().describe("Reminder message"),
      triggerTime: z.string().describe("When to trigger (ISO datetime)"),
      recurring: z.enum(["daily", "weekly", "monthly", "yearly"]).optional().describe("Recurrence pattern"),
      channels: z.array(z.enum(["push", "email", "sms"])).optional().default(["push"]).describe("Delivery channels"),
    }),
  }
);

function generateCronExpression(pattern: string): string {
  switch (pattern) {
    case "daily": return "0 9 * * *";
    case "weekly": return "0 9 * * 1";
    case "monthly": return "0 9 1 * *";
    case "yearly": return "0 9 1 1 *";
    default: return "0 9 * * *";
  }
}

export const timerStartTool = tool(
  async (input) => {
    const { name, duration, type = "countdown", onComplete } = input;
    const startTime = Date.now();

    try {
      const durationMs = parseDuration(duration);
      const endTime = new Date(Date.now() + durationMs);

      return JSON.stringify({
        success: true,
        timer: {
          id: `timer-${Date.now()}`,
          name,
          type,
          startedAt: new Date().toISOString(),
          duration,
          durationMs,
          endsAt: endTime.toISOString(),
          status: "running",
          onComplete: onComplete || "notification",
        },
        display: formatDuration(durationMs),
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "timer_start",
    description: "Starts countdown timers, Pomodoro sessions, or stopwatches with completion actions.",
    schema: z.object({
      name: z.string().describe("Timer name"),
      duration: z.string().describe("Duration (e.g., '25m', '1h30m', '90s')"),
      type: z.enum(["countdown", "pomodoro", "stopwatch"]).optional().default("countdown").describe("Timer type"),
      onComplete: z.string().optional().describe("Action on completion"),
    }),
  }
);

function parseDuration(duration: string): number {
  const regex = /(\d+)(h|m|s)/g;
  let ms = 0;
  let match;
  while ((match = regex.exec(duration)) !== null) {
    const value = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
      case "h": ms += value * 60 * 60 * 1000; break;
      case "m": ms += value * 60 * 1000; break;
      case "s": ms += value * 1000; break;
    }
  }
  return ms || 25 * 60 * 1000;
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds) parts.push(`${seconds}s`);
  return parts.join(" ") || "0s";
}

export const PRODUCTIVITY_TOOLS = [
  calendarCreateTool,
  taskCreateTool,
  noteCreateTool,
  reminderSetTool,
  timerStartTool,
];
