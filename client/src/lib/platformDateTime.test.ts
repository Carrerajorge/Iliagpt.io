import { describe, it, expect } from "vitest";
import {
  isSupportedTimeZone,
  normalizeTimeZone,
  toValidDate,
  getZonedDateParts,
  getZonedDayNumber,
  diffZonedDays,
  formatZonedDate,
  formatZonedTime,
  formatZonedDateTime,
  formatZonedIntl,
} from "./platformDateTime";

describe("isSupportedTimeZone", () => {
  it("accepts valid timezones", () => {
    expect(isSupportedTimeZone("UTC")).toBe(true);
    expect(isSupportedTimeZone("America/New_York")).toBe(true);
    expect(isSupportedTimeZone("Europe/London")).toBe(true);
    expect(isSupportedTimeZone("Asia/Tokyo")).toBe(true);
  });
  it("rejects invalid timezones", () => {
    expect(isSupportedTimeZone("Invalid/Zone")).toBe(false);
    expect(isSupportedTimeZone("")).toBe(false);
    expect(isSupportedTimeZone(null as any)).toBe(false);
  });
});

describe("normalizeTimeZone", () => {
  it("returns valid timezone as-is", () => {
    expect(normalizeTimeZone("America/New_York")).toBe("America/New_York");
  });
  it("falls back to UTC for invalid", () => {
    expect(normalizeTimeZone("Invalid")).toBe("UTC");
    expect(normalizeTimeZone(null)).toBe("UTC");
    expect(normalizeTimeZone(undefined)).toBe("UTC");
    expect(normalizeTimeZone("")).toBe("UTC");
  });
});

describe("toValidDate", () => {
  it("accepts Date objects", () => {
    const d = new Date("2024-01-15T12:00:00Z");
    expect(toValidDate(d)).toEqual(d);
  });
  it("accepts timestamps", () => {
    const ts = Date.now();
    const result = toValidDate(ts);
    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBe(ts);
  });
  it("accepts date strings", () => {
    const result = toValidDate("2024-01-15T12:00:00Z");
    expect(result).toBeInstanceOf(Date);
  });
  it("returns null for invalid inputs", () => {
    expect(toValidDate(null)).toBeNull();
    expect(toValidDate(undefined)).toBeNull();
    expect(toValidDate("not a date")).toBeNull();
    expect(toValidDate(new Date("invalid"))).toBeNull();
    expect(toValidDate(NaN)).toBeNull();
  });
});

describe("getZonedDateParts", () => {
  it("returns parts for a valid date in UTC", () => {
    const parts = getZonedDateParts("2024-06-15T14:30:45Z", "UTC");
    expect(parts).not.toBeNull();
    expect(parts!.year).toBe(2024);
    expect(parts!.month).toBe(6);
    expect(parts!.day).toBe(15);
    expect(parts!.hour).toBe(14);
    expect(parts!.minute).toBe(30);
    expect(parts!.second).toBe(45);
  });
  it("adjusts for timezone", () => {
    // 14:00 UTC -> 10:00 ET (EDT, -4)
    const parts = getZonedDateParts("2024-06-15T14:00:00Z", "America/New_York");
    expect(parts).not.toBeNull();
    expect(parts!.hour).toBe(10);
  });
  it("returns null for invalid input", () => {
    expect(getZonedDateParts(null, "UTC")).toBeNull();
    expect(getZonedDateParts("invalid", "UTC")).toBeNull();
  });
});

describe("getZonedDayNumber", () => {
  it("returns a numeric day number", () => {
    const dn = getZonedDayNumber("2024-01-01T00:00:00Z", "UTC");
    expect(typeof dn).toBe("number");
    expect(dn).toBeGreaterThan(0);
  });
  it("returns null for invalid input", () => {
    expect(getZonedDayNumber(null, "UTC")).toBeNull();
  });
});

describe("diffZonedDays", () => {
  it("calculates day difference", () => {
    const d1 = "2024-01-10T12:00:00Z";
    const d2 = "2024-01-15T12:00:00Z";
    expect(diffZonedDays(d1, d2, "UTC")).toBe(5);
  });
  it("returns 0 for same day", () => {
    const d = "2024-01-15T12:00:00Z";
    expect(diffZonedDays(d, d, "UTC")).toBe(0);
  });
  it("returns null for invalid input", () => {
    expect(diffZonedDays(null, "2024-01-15", "UTC")).toBeNull();
    expect(diffZonedDays("2024-01-15", null, "UTC")).toBeNull();
  });
});

describe("formatZonedDate", () => {
  const date = "2024-06-15T14:30:00Z";

  it("formats YYYY-MM-DD", () => {
    const result = formatZonedDate(date, { timeZone: "UTC", dateFormat: "YYYY-MM-DD" });
    expect(result).toBe("2024-06-15");
  });
  it("formats DD/MM/YYYY", () => {
    const result = formatZonedDate(date, { timeZone: "UTC", dateFormat: "DD/MM/YYYY" });
    expect(result).toBe("15/06/2024");
  });
  it("formats MM/DD/YYYY", () => {
    const result = formatZonedDate(date, { timeZone: "UTC", dateFormat: "MM/DD/YYYY" });
    expect(result).toBe("06/15/2024");
  });
  it("excludes year when includeYear is false", () => {
    const result = formatZonedDate(date, { timeZone: "UTC", dateFormat: "YYYY-MM-DD", includeYear: false });
    expect(result).toBe("06-15");
  });
  it("returns empty for invalid date", () => {
    expect(formatZonedDate(null, { timeZone: "UTC", dateFormat: "YYYY-MM-DD" })).toBe("");
  });
});

describe("formatZonedTime", () => {
  const date = "2024-06-15T14:30:45Z";

  it("formats HH:MM", () => {
    const result = formatZonedTime(date, { timeZone: "UTC" });
    expect(result).toBe("14:30");
  });
  it("formats HH:MM:SS with seconds", () => {
    const result = formatZonedTime(date, { timeZone: "UTC", includeSeconds: true });
    expect(result).toBe("14:30:45");
  });
  it("returns empty for invalid date", () => {
    expect(formatZonedTime(null, { timeZone: "UTC" })).toBe("");
  });
});

describe("formatZonedDateTime", () => {
  it("combines date and time", () => {
    const result = formatZonedDateTime("2024-06-15T14:30:00Z", {
      timeZone: "UTC",
      dateFormat: "YYYY-MM-DD",
    });
    expect(result).toBe("2024-06-15 14:30");
  });
});

describe("formatZonedIntl", () => {
  it("formats using Intl", () => {
    const result = formatZonedIntl("2024-06-15T14:30:00Z", {
      timeZone: "UTC",
      locale: "en-US",
      options: { year: "numeric", month: "short", day: "numeric" },
    });
    expect(result).toContain("Jun");
    expect(result).toContain("2024");
  });
  it("returns empty for invalid date", () => {
    const result = formatZonedIntl(null, {
      timeZone: "UTC",
      options: { year: "numeric" },
    });
    expect(result).toBe("");
  });
});
