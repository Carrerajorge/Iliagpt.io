import { describe, expect, it } from "vitest";
import { computeNextRunAt, normalizeTimeZone, parseTimeOfDay } from "./chatScheduleUtils";

describe("chatScheduleUtils", () => {
  it("normalizeTimeZone falls back to UTC for invalid time zones", () => {
    expect(normalizeTimeZone("Not/A_TimeZone")).toBe("UTC");
    expect(normalizeTimeZone("")).toBe("UTC");
    expect(normalizeTimeZone(null)).toBe("UTC");
  });

  it("parseTimeOfDay parses and normalizes HH:MM", () => {
    expect(parseTimeOfDay("9:05")).toEqual({ hour: 9, minute: 5, normalized: "09:05" });
    expect(parseTimeOfDay("09:05")).toEqual({ hour: 9, minute: 5, normalized: "09:05" });
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("09:60")).toBeNull();
    expect(parseTimeOfDay("")).toBeNull();
  });

  it("computeNextRunAt (once) returns runAt when in the future", () => {
    const now = new Date("2026-02-07T00:00:00.000Z");
    const runAt = new Date("2026-02-07T01:00:00.000Z");
    const next = computeNextRunAt({ scheduleType: "once", timeZone: "UTC", runAt }, now);
    expect(next?.toISOString()).toBe("2026-02-07T01:00:00.000Z");
  });

  it("computeNextRunAt (once) returns null when runAt is in the past", () => {
    const now = new Date("2026-02-07T00:00:00.000Z");
    const runAt = new Date("2026-02-06T23:59:59.000Z");
    const next = computeNextRunAt({ scheduleType: "once", timeZone: "UTC", runAt }, now);
    expect(next).toBeNull();
  });

  it("computeNextRunAt (daily) schedules today when time is ahead", () => {
    const now = new Date("2026-02-07T08:00:00.000Z");
    const next = computeNextRunAt({ scheduleType: "daily", timeZone: "UTC", timeOfDay: "09:00" }, now);
    expect(next?.toISOString()).toBe("2026-02-07T09:00:00.000Z");
  });

  it("computeNextRunAt (daily) schedules tomorrow when time already passed", () => {
    const now = new Date("2026-02-07T09:00:00.000Z");
    const next = computeNextRunAt({ scheduleType: "daily", timeZone: "UTC", timeOfDay: "09:00" }, now);
    expect(next?.toISOString()).toBe("2026-02-08T09:00:00.000Z");
  });

  it("computeNextRunAt (weekly) picks the next eligible weekday", () => {
    // 2026-02-07 is a Saturday.
    const now = new Date("2026-02-07T00:00:00.000Z");
    const next = computeNextRunAt(
      { scheduleType: "weekly", timeZone: "UTC", timeOfDay: "10:00", daysOfWeek: [1] },
      now,
    );
    expect(next?.toISOString()).toBe("2026-02-09T10:00:00.000Z");
  });

  it("computeNextRunAt (weekly) can schedule later today if today is selected", () => {
    // 2026-02-07 is a Saturday (6).
    const now = new Date("2026-02-07T09:00:00.000Z");
    const next = computeNextRunAt(
      { scheduleType: "weekly", timeZone: "UTC", timeOfDay: "10:00", daysOfWeek: [6] },
      now,
    );
    expect(next?.toISOString()).toBe("2026-02-07T10:00:00.000Z");
  });
});

