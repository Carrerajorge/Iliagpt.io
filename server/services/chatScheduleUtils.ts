type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function isSupportedTimeZone(timeZone: string): boolean {
  const tz = String(timeZone || "").trim();
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(timeZone: string | null | undefined): string {
  const tz = String(timeZone || "").trim();
  if (tz && isSupportedTimeZone(tz)) return tz;
  return "UTC";
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();
function getPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  const tz = normalizeTimeZone(timeZone);
  const cached = partsFormatterCache.get(tz);
  if (cached) return cached;

  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });
  partsFormatterCache.set(tz, dtf);
  return dtf;
}

export function getZonedDateParts(dateInput: unknown, timeZone: string): ZonedParts | null {
  const date = dateInput instanceof Date ? dateInput : new Date(String(dateInput));
  if (!Number.isFinite(date.getTime())) return null;

  const dtf = getPartsFormatter(timeZone);
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }

  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  let hour = Number(map.hour);
  const minute = Number(map.minute);
  const second = Number(map.second);

  // Defensive: some environments can emit "24" at midnight.
  if (hour === 24) hour = 0;

  if (![year, month, day, hour, minute, second].every((n) => Number.isFinite(n))) return null;
  return { year, month, day, hour, minute, second };
}

const weekdayFormatterCache = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getZonedWeekday(dateInput: unknown, timeZone: string): number | null {
  const date = dateInput instanceof Date ? dateInput : new Date(String(dateInput));
  if (!Number.isFinite(date.getTime())) return null;

  const tz = normalizeTimeZone(timeZone);
  const cached = weekdayFormatterCache.get(tz);
  const dtf =
    cached ||
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
    });
  if (!cached) weekdayFormatterCache.set(tz, dtf);

  const short = dtf.format(date);
  const val = WEEKDAY_MAP[short];
  return typeof val === "number" ? val : null;
}

export function parseTimeOfDay(timeOfDay: string | null | undefined): { hour: number; minute: number; normalized: string } | null {
  const raw = String(timeOfDay || "").trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  return { hour, minute, normalized: `${pad2(hour)}:${pad2(minute)}` };
}

function addDaysToYmd(ymd: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const base = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  const d = new Date(base.getTime() + days * 86_400_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Convert a local date-time in a given IANA timezone into an actual UTC Date.
 * Uses a two-pass adjustment to handle DST offsets.
 */
export function zonedDateTimeToUtc(
  local: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
  timeZone: string,
): Date {
  const tz = normalizeTimeZone(timeZone);
  const second = local.second ?? 0;

  // Initial guess: interpret the local components as if they were UTC.
  let utc = new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, second));
  for (let i = 0; i < 2; i++) {
    const actual = getZonedDateParts(utc, tz);
    if (!actual) break;

    const desiredUtcMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, second);
    const actualUtcMs = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const diff = desiredUtcMs - actualUtcMs;
    if (diff === 0) break;
    utc = new Date(utc.getTime() + diff);
  }
  return utc;
}

export type ChatScheduleType = "once" | "daily" | "weekly";

export function computeNextRunAt(
  schedule: {
    scheduleType: ChatScheduleType;
    timeZone?: string | null;
    runAt?: Date | string | null;
    timeOfDay?: string | null;
    daysOfWeek?: number[] | null;
  },
  fromDate: Date = new Date(),
): Date | null {
  const tz = normalizeTimeZone(schedule.timeZone);
  const now = fromDate;

  if (schedule.scheduleType === "once") {
    if (!schedule.runAt) return null;
    const runAt = schedule.runAt instanceof Date ? schedule.runAt : new Date(String(schedule.runAt));
    if (!Number.isFinite(runAt.getTime())) return null;
    return runAt.getTime() > now.getTime() ? runAt : null;
  }

  const tod = parseTimeOfDay(schedule.timeOfDay);
  if (!tod) return null;

  const nowParts = getZonedDateParts(now, tz);
  if (!nowParts) return null;

  if (schedule.scheduleType === "daily") {
    const todayLocal = { year: nowParts.year, month: nowParts.month, day: nowParts.day };
    let candidate = zonedDateTimeToUtc(
      { ...todayLocal, hour: tod.hour, minute: tod.minute, second: 0 },
      tz,
    );
    if (candidate.getTime() <= now.getTime()) {
      const tomorrowLocal = addDaysToYmd(todayLocal, 1);
      candidate = zonedDateTimeToUtc({ ...tomorrowLocal, hour: tod.hour, minute: tod.minute, second: 0 }, tz);
    }
    return candidate;
  }

  // weekly
  const days = (schedule.daysOfWeek || []).filter((d) => Number.isFinite(d) && d >= 0 && d <= 6);
  if (days.length === 0) return null;
  const daySet = new Set(days);

  const baseLocal = { year: nowParts.year, month: nowParts.month, day: nowParts.day };
  for (let offset = 0; offset <= 7; offset++) {
    const candidateLocalDate = addDaysToYmd(baseLocal, offset);
    const candidate = zonedDateTimeToUtc({ ...candidateLocalDate, hour: tod.hour, minute: tod.minute, second: 0 }, tz);
    const weekday = getZonedWeekday(candidate, tz);
    if (weekday === null) continue;
    if (!daySet.has(weekday)) continue;
    if (candidate.getTime() <= now.getTime()) continue;
    return candidate;
  }

  return null;
}

