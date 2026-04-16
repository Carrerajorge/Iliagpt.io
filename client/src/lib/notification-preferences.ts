export type NotificationChannel = "push" | "email" | "push_email" | "none";

export function channelIncludesPush(channel: NotificationChannel): boolean {
  return channel === "push" || channel === "push_email";
}

export function channelIncludesEmail(channel: NotificationChannel): boolean {
  return channel === "email" || channel === "push_email";
}

function parseTimeToMinutes(hhmm: string): number | null {
  const raw = String(hhmm || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * Returns true if "now" is inside the quiet-hours interval.
 * Supports overnight ranges (e.g. 22:00 -> 08:00).
 */
export function isWithinQuietHours(params: {
  enabled: boolean;
  start: string;
  end: string;
  now?: Date;
}): boolean {
  const { enabled, start, end, now = new Date() } = params;
  if (!enabled) return false;

  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  if (startMin === null || endMin === null) return false;
  if (startMin === endMin) return false;

  const nowMin = now.getHours() * 60 + now.getMinutes();

  // Normal range (e.g. 09:00 -> 17:00)
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }

  // Overnight range (e.g. 22:00 -> 08:00)
  return nowMin >= startMin || nowMin < endMin;
}

