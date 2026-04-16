export type PlatformDateFormat = "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY";

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

export function toValidDate(input: unknown): Date | null {
  if (input instanceof Date) {
    return Number.isFinite(input.getTime()) ? input : null;
  }
  if (typeof input === "number") {
    const d = new Date(input);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof input === "string") {
    const d = new Date(input);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  const tz = normalizeTimeZone(timeZone);
  const cached = partsFormatterCache.get(tz);
  if (cached) return cached;

  // Use a stable locale so parts are predictable.
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
  const date = toValidDate(dateInput);
  if (!date) return null;

  const dtf = getPartsFormatter(timeZone);
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") {
      map[p.type] = p.value;
    }
  }

  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  let hour = Number(map.hour);
  const minute = Number(map.minute);
  const second = Number(map.second);

  // Defensive: some environments can emit "24" at midnight.
  if (hour === 24) hour = 0;

  if (![year, month, day, hour, minute, second].every((n) => Number.isFinite(n))) {
    return null;
  }

  return { year, month, day, hour, minute, second };
}

export function getZonedDayNumber(dateInput: unknown, timeZone: string): number | null {
  const parts = getZonedDateParts(dateInput, timeZone);
  if (!parts) return null;
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

export function diffZonedDays(dateInput: unknown, nowInput: unknown, timeZone: string): number | null {
  const nowDay = getZonedDayNumber(nowInput, timeZone);
  const dateDay = getZonedDayNumber(dateInput, timeZone);
  if (nowDay === null || dateDay === null) return null;
  return nowDay - dateDay;
}

export function formatZonedDate(
  dateInput: unknown,
  opts: { timeZone: string; dateFormat: PlatformDateFormat; includeYear?: boolean }
): string {
  const parts = getZonedDateParts(dateInput, opts.timeZone);
  if (!parts) return "";

  const includeYear = opts.includeYear !== false;
  const y = String(parts.year);
  const m = pad2(parts.month);
  const d = pad2(parts.day);

  switch (opts.dateFormat) {
    case "YYYY-MM-DD": {
      return includeYear ? `${y}-${m}-${d}` : `${m}-${d}`;
    }
    case "DD/MM/YYYY": {
      return includeYear ? `${d}/${m}/${y}` : `${d}/${m}`;
    }
    case "MM/DD/YYYY": {
      return includeYear ? `${m}/${d}/${y}` : `${m}/${d}`;
    }
    default: {
      return includeYear ? `${y}-${m}-${d}` : `${m}-${d}`;
    }
  }
}

export function formatZonedTime(
  dateInput: unknown,
  opts: { timeZone: string; includeSeconds?: boolean }
): string {
  const parts = getZonedDateParts(dateInput, opts.timeZone);
  if (!parts) return "";

  const hh = pad2(parts.hour);
  const mm = pad2(parts.minute);
  if (opts.includeSeconds) {
    const ss = pad2(parts.second);
    return `${hh}:${mm}:${ss}`;
  }
  return `${hh}:${mm}`;
}

export function formatZonedDateTime(
  dateInput: unknown,
  opts: { timeZone: string; dateFormat: PlatformDateFormat; includeSeconds?: boolean; includeYear?: boolean }
): string {
  const date = formatZonedDate(dateInput, {
    timeZone: opts.timeZone,
    dateFormat: opts.dateFormat,
    includeYear: opts.includeYear,
  });
  const time = formatZonedTime(dateInput, { timeZone: opts.timeZone, includeSeconds: opts.includeSeconds });
  if (!date) return time;
  if (!time) return date;
  return `${date} ${time}`;
}

export function formatZonedIntl(
  dateInput: unknown,
  opts: { timeZone: string; locale?: string | string[]; options: Intl.DateTimeFormatOptions }
): string {
  const date = toValidDate(dateInput);
  if (!date) return "";

  const tz = normalizeTimeZone(opts.timeZone);
  try {
    return new Intl.DateTimeFormat(opts.locale, { ...opts.options, timeZone: tz }).format(date);
  } catch {
    return "";
  }
}

