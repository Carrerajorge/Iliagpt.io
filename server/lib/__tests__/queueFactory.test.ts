import { describe, expect, it } from "vitest";

import { shouldEnableRedisQueues } from "../queueFactory";

describe("queueFactory", () => {
  it("disables BullMQ when Redis is not configured", () => {
    expect(
      shouldEnableRedisQueues({
        nodeEnv: "production",
        baseUrl: "https://ilia.example.com",
      }),
    ).toBe(false);
  });

  it("disables BullMQ for loopback production runtimes backed by Upstash", () => {
    expect(
      shouldEnableRedisQueues({
        nodeEnv: "production",
        redisUrl: "rediss://default:secret@friendly-fly-12345.upstash.io:6379",
        baseUrl: "http://127.0.0.1:41734",
      }),
    ).toBe(false);
  });

  it("keeps BullMQ enabled for public production runtimes with Redis configured", () => {
    expect(
      shouldEnableRedisQueues({
        nodeEnv: "production",
        redisUrl: "redis://cache.internal:6379",
        baseUrl: "https://ilia.example.com",
      }),
    ).toBe(true);
  });

  it("allows explicit force-enable overrides", () => {
    expect(
      shouldEnableRedisQueues({
        nodeEnv: "production",
        redisUrl: "rediss://default:secret@friendly-fly-12345.upstash.io:6379",
        baseUrl: "http://127.0.0.1:41734",
        bullmqForceEnable: "true",
      }),
    ).toBe(true);
  });
});
