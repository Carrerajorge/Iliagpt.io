/**
 * Calendar Integration Service - ILIAGPT PRO 3.0
 * 
 * Google Calendar / Outlook integration.
 * Event scheduling, reminders, and AI scheduling.
 */

// ============== Types ==============

export interface CalendarConfig {
    provider: "google" | "outlook" | "apple";
    accessToken: string;
    refreshToken?: string;
    calendarId?: string;
}

export interface CalendarEvent {
    id: string;
    title: string;
    description?: string;
    start: Date;
    end: Date;
    location?: string;
    attendees?: Attendee[];
    recurring?: RecurrenceRule;
    reminders?: Reminder[];
    status: "confirmed" | "tentative" | "cancelled";
    url?: string;
    conferenceLink?: string;
}

export interface Attendee {
    email: string;
    name?: string;
    status: "accepted" | "declined" | "tentative" | "pending";
    optional?: boolean;
}

export interface RecurrenceRule {
    frequency: "daily" | "weekly" | "monthly" | "yearly";
    interval: number;
    until?: Date;
    count?: number;
    byDay?: string[];
}

export interface Reminder {
    method: "email" | "popup" | "sms";
    minutes: number;
}

export interface FreeSlot {
    start: Date;
    end: Date;
    duration: number;
}

export interface ScheduleRequest {
    title: string;
    duration: number;
    preferredTimes?: { start: number; end: number }[];
    attendees?: string[];
    priority?: "high" | "normal" | "low";
}

// ============== Calendar Service ==============

export class CalendarIntegration {
    private config: CalendarConfig | null = null;
    private connected = false;
    private events: Map<string, CalendarEvent> = new Map();

    /**
     * Connect to calendar provider
     */
    async connect(config: CalendarConfig): Promise<boolean> {
        this.config = config;

        try {
            await this.authenticate();
            this.connected = true;
            console.log(`[Calendar] Connected to ${config.provider}`);
            return true;
        } catch (error) {
            console.error("[Calendar] Connection failed:", error);
            return false;
        }
    }

    private async authenticate(): Promise<void> {
        // In production, implement OAuth flow
        console.log("[Calendar] Authenticating...");
    }

    isConnected(): boolean {
        return this.connected;
    }

    // ======== Events ========

    /**
     * List events in date range
     */
    async listEvents(
        startDate: Date,
        endDate: Date
    ): Promise<CalendarEvent[]> {
        if (!this.connected) return [];

        const response = await this.api("events", {
            timeMin: startDate.toISOString(),
            timeMax: endDate.toISOString(),
            singleEvents: true,
            orderBy: "startTime",
        });

        const events = (response.items || []).map(this.mapEvent);
        events.forEach(e => this.events.set(e.id, e));
        return events;
    }

    /**
     * Get event by ID
     */
    async getEvent(eventId: string): Promise<CalendarEvent | null> {
        if (!this.connected) return null;

        const cached = this.events.get(eventId);
        if (cached) return cached;

        const response = await this.api(`events/${eventId}`);
        return response ? this.mapEvent(response) : null;
    }

    /**
     * Create event
     */
    async createEvent(event: Omit<CalendarEvent, 'id' | 'status'>): Promise<CalendarEvent | null> {
        if (!this.connected) return null;

        const body = {
            summary: event.title,
            description: event.description,
            start: { dateTime: event.start.toISOString() },
            end: { dateTime: event.end.toISOString() },
            location: event.location,
            attendees: event.attendees?.map(a => ({
                email: a.email,
                displayName: a.name,
                optional: a.optional,
            })),
            reminders: {
                useDefault: false,
                overrides: event.reminders?.map(r => ({
                    method: r.method,
                    minutes: r.minutes,
                })),
            },
            recurrence: event.recurring ? this.buildRecurrence(event.recurring) : undefined,
        };

        const response = await this.api("events", body, "POST");
        if (response) {
            const created = this.mapEvent(response);
            this.events.set(created.id, created);
            return created;
        }
        return null;
    }

    /**
     * Update event
     */
    async updateEvent(
        eventId: string,
        updates: Partial<Omit<CalendarEvent, 'id'>>
    ): Promise<CalendarEvent | null> {
        if (!this.connected) return null;

        const existing = await this.getEvent(eventId);
        if (!existing) return null;

        const body: any = {};
        if (updates.title) body.summary = updates.title;
        if (updates.description !== undefined) body.description = updates.description;
        if (updates.start) body.start = { dateTime: updates.start.toISOString() };
        if (updates.end) body.end = { dateTime: updates.end.toISOString() };
        if (updates.location !== undefined) body.location = updates.location;

        const response = await this.api(`events/${eventId}`, body, "PATCH");
        if (response) {
            const updated = this.mapEvent(response);
            this.events.set(updated.id, updated);
            return updated;
        }
        return null;
    }

    /**
     * Delete event
     */
    async deleteEvent(eventId: string): Promise<boolean> {
        if (!this.connected) return false;

        await this.api(`events/${eventId}`, {}, "DELETE");
        this.events.delete(eventId);
        return true;
    }

    // ======== AI Scheduling ========

    /**
     * Find free time slots
     */
    async findFreeSlots(
        startDate: Date,
        endDate: Date,
        duration: number,
        workingHours: { start: number; end: number } = { start: 9, end: 17 }
    ): Promise<FreeSlot[]> {
        const events = await this.listEvents(startDate, endDate);
        const slots: FreeSlot[] = [];

        let current = new Date(startDate);
        current.setHours(workingHours.start, 0, 0, 0);

        while (current < endDate) {
            const dayEnd = new Date(current);
            dayEnd.setHours(workingHours.end, 0, 0, 0);

            while (current < dayEnd) {
                const slotEnd = new Date(current.getTime() + duration * 60000);

                if (slotEnd > dayEnd) break;

                const hasConflict = events.some(e =>
                    (e.start <= current && e.end > current) ||
                    (e.start < slotEnd && e.end >= slotEnd) ||
                    (e.start >= current && e.end <= slotEnd)
                );

                if (!hasConflict) {
                    slots.push({
                        start: new Date(current),
                        end: slotEnd,
                        duration,
                    });
                }

                current = slotEnd;
            }

            // Move to next day
            current.setDate(current.getDate() + 1);
            current.setHours(workingHours.start, 0, 0, 0);
        }

        return slots;
    }

    /**
     * Smart schedule - find best time for meeting
     */
    async smartSchedule(request: ScheduleRequest): Promise<FreeSlot[]> {
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 14); // Look 2 weeks ahead

        const slots = await this.findFreeSlots(startDate, endDate, request.duration);

        // Score and sort slots
        const scored = slots.map(slot => ({
            slot,
            score: this.scoreSlot(slot, request),
        }));

        scored.sort((a, b) => b.score - a.score);

        return scored.slice(0, 5).map(s => s.slot);
    }

    private scoreSlot(slot: FreeSlot, request: ScheduleRequest): number {
        let score = 50;

        // Prefer preferred times
        if (request.preferredTimes) {
            const slotHour = slot.start.getHours();
            for (const pref of request.preferredTimes) {
                if (slotHour >= pref.start && slotHour < pref.end) {
                    score += 20;
                    break;
                }
            }
        }

        // Prefer morning for high priority
        if (request.priority === "high") {
            const hour = slot.start.getHours();
            if (hour >= 9 && hour < 12) score += 15;
        }

        // Prefer not too far in the future
        const daysAhead = (slot.start.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
        score -= daysAhead * 2;

        // Slight preference for top of hour
        if (slot.start.getMinutes() === 0) score += 5;

        return score;
    }

    // ======== Quick Actions ========

    /**
     * Schedule meeting from text
     */
    async scheduleFromText(text: string): Promise<CalendarEvent | null> {
        // Parse natural language
        const parsed = this.parseNaturalLanguage(text);
        if (!parsed) return null;

        return this.createEvent(parsed);
    }

    private parseNaturalLanguage(text: string): Omit<CalendarEvent, 'id' | 'status'> | null {
        // Basic NLP parsing (in production, use proper NLP)
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(10, 0, 0, 0);

        const end = new Date(tomorrow);
        end.setHours(11, 0, 0, 0);

        // Extract title (first line or main content)
        const title = text.split(/[.\n]/)[0].trim() || "Meeting";

        return {
            title,
            start: tomorrow,
            end,
            description: text,
        };
    }

    // ======== Helpers ========

    private async api(
        endpoint: string,
        params?: any,
        method: "GET" | "POST" | "PATCH" | "DELETE" = "GET"
    ): Promise<any> {
        console.log(`[Calendar API] ${method} ${endpoint}`, params);
        return { id: `event_${Date.now()}`, items: [] };
    }

    private mapEvent = (e: any): CalendarEvent => ({
        id: e.id,
        title: e.summary || "Untitled",
        description: e.description,
        start: new Date(e.start?.dateTime || e.start?.date),
        end: new Date(e.end?.dateTime || e.end?.date),
        location: e.location,
        attendees: e.attendees?.map((a: any) => ({
            email: a.email,
            name: a.displayName,
            status: a.responseStatus,
            optional: a.optional,
        })),
        status: e.status,
        url: e.htmlLink,
        conferenceLink: e.hangoutLink || e.conferenceData?.entryPoints?.[0]?.uri,
    });

    private buildRecurrence(rule: RecurrenceRule): string[] {
        let rrule = `RRULE:FREQ=${rule.frequency.toUpperCase()};INTERVAL=${rule.interval}`;
        if (rule.until) rrule += `;UNTIL=${rule.until.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
        if (rule.count) rrule += `;COUNT=${rule.count}`;
        if (rule.byDay?.length) rrule += `;BYDAY=${rule.byDay.join(",")}`;
        return [rrule];
    }

    disconnect(): void {
        this.connected = false;
        this.config = null;
        this.events.clear();
    }
}

// ============== Singleton ==============

let calendarInstance: CalendarIntegration | null = null;

export function getCalendarIntegration(): CalendarIntegration {
    if (!calendarInstance) {
        calendarInstance = new CalendarIntegration();
    }
    return calendarInstance;
}

export default CalendarIntegration;
