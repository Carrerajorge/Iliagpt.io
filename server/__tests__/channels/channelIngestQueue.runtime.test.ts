import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  queueAddMock,
  getWaitingCountMock,
  getActiveCountMock,
  getDelayedCountMock,
} = vi.hoisted(() => ({
  queueAddMock: vi.fn(),
  getWaitingCountMock: vi.fn(),
  getActiveCountMock: vi.fn(),
  getDelayedCountMock: vi.fn(),
}));

vi.mock("../../config/env", () => ({
  env: {
    CHANNEL_INGEST_MODE: "queue",
    CHANNEL_INGEST_IDEMPOTENCY_MAX_ENTRIES: "128",
    CHANNEL_INGEST_IDEMPOTENCY_TTL_MS: "300",
    CHANNEL_INGEST_ATTEMPTS: "4",
    CHANNEL_INGEST_BACKOFF_MS: "750",
    CHANNEL_INGEST_QUEUE_BACKPRESSURE_LIMIT: "1200",
    CHANNEL_INGEST_QUEUE_FAILURE_THRESHOLD: "4",
    CHANNEL_INGEST_QUEUE_CIRCUIT_OPEN_MS: "45000",
    CHANNEL_INGEST_QUEUE_OPERATION_TIMEOUT_MS: "4000",
    MAX_CHANNEL_INGEST_JOB_BYTES: "32768",
    CHANNEL_INGEST_INPROCESS_DEDUPE_TTL_MS: "600000",
    CHANNEL_INGEST_INPROCESS_CONCURRENCY: "4",
    CHANNEL_INGEST_INPROCESS_TIMEOUT_MS: "120000",
    CHANNEL_INGEST_INPROCESS_QUEUE_MAX: "400",
    CHANNEL_INGEST_INPROCESS_RESERVATION_TTL_MS: "480000",
    NODE_ENV: "test",
  },
}));

vi.mock("../../lib/queueFactory", () => ({
  createQueue: vi.fn(() => ({
    add: queueAddMock,
    getWaitingCount: getWaitingCountMock,
    getActiveCount: getActiveCountMock,
    getDelayedCount: getDelayedCountMock,
  })),
  QUEUE_NAMES: { CHANNEL_INGEST: "channel_ingest" },
}));

vi.mock("../../lib/logger", () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../channels/channelIngestService", () => ({
  processChannelIngestJob: vi.fn(),
}));

import {
  getChannelIngestQueueStats,
  resetChannelIngestQueueRuntimeForTests,
  submitChannelIngest,
} from "../../channels/channelIngestQueue";

const FIXED_TIMESTAMP = "1700000000";

const makeWhatsappPayload = (
  messageId: string,
  timestamp = FIXED_TIMESTAMP,
  accountPhoneNumberId = "phone-1",
) => ({
  channel: "whatsapp_cloud",
  whatsappMeta: {
    accountPhoneNumberId,
  },
  payload: {
    entry: [{
      changes: [{
        value: {
          messages: [{
            id: messageId,
            from: "contact-1",
            timestamp,
          }],
          metadata: { phone_number_id: "phone-1" },
        },
      }],
    }],
  },
});

describe("channelIngestQueue runtime idempotency hardening", () => {
  beforeEach(() => {
    resetChannelIngestQueueRuntimeForTests();
    vi.clearAllMocks();
    queueAddMock.mockResolvedValue({ id: "job-1" });
    getWaitingCountMock.mockResolvedValue(0);
    getActiveCountMock.mockResolvedValue(0);
    getDelayedCountMock.mockResolvedValue(0);
  });

  it("ignores repeated payload with same runScopeKey and allows distinct payloads", async () => {
    const payload = makeWhatsappPayload("wamid-1");

    await submitChannelIngest(payload);
    await submitChannelIngest(payload);
    await submitChannelIngest(makeWhatsappPayload("wamid-a", "1700000010", "phone-2"));

    const stats = getChannelIngestQueueStats();
    expect(queueAddMock).toHaveBeenCalledTimes(2);
    expect(stats.idempotencyDuplicate).toBe(1);
    expect(stats.ingestIdempotencyWindowSize).toBe(2);
  });
});
