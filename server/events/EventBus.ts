/**
 * EventBus: Central event bus using Redis Streams (XADD / XREADGROUP)
 * Improvement 10 – Event-Driven Architecture with CQRS
 */

import Redis from "ioredis";
import crypto from "crypto";
import { z } from "zod";
import { Logger } from "../lib/logger";
import {
  AppEvent,
  EventHandler,
  EventType,
  StreamInfo,
  BaseEventSchema,
} from "./types";

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const STREAM_PREFIX = "events:";
const DEAD_LETTER_STREAM = "events:dead-letter";
const DEFAULT_BLOCK_MS = 2000;
const MAX_RETRY_COUNT = 3;
const MAX_STREAM_LEN = 100_000; // MAXLEN cap per stream
const XADD_APPROX = "~"; // approximate trimming

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConsumerState {
  running: boolean;
  promise?: Promise<void>;
}

interface PendingMessageInfo {
  id: string;
  consumer: string;
  elapsedMs: number;
  deliveryCount: number;
}

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

export class EventBus {
  private readonly publish_redis: Redis;
  private readonly subscriber_redis: Redis; // separate connection for blocking reads
  private readonly handlers: Map<string, Set<EventHandler>> = new Map();
  private readonly consumerGroups: Map<string, string> = new Map(); // streamKey -> groupName
  private readonly consumers: Map<string, ConsumerState> = new Map();

  constructor(redisUrl?: string) {
    const opts: ConstructorParameters<typeof Redis>[1] = {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      enableReadyCheck: false,
      retryStrategy: (times: number) =>
        times > 10 ? null : Math.min(times * 500, 5000),
    };

    const url = redisUrl ?? process.env.REDIS_URL;
    if (url) {
      this.publish_redis = new Redis(url, opts);
      this.subscriber_redis = new Redis(url, opts);
    } else {
      this.publish_redis = new Redis({ ...opts, lazyConnect: true });
      this.subscriber_redis = new Redis({ ...opts, lazyConnect: true });
    }

    this.publish_redis.on("error", (err) =>
      Logger.error("EventBus publish redis error", err)
    );
    this.subscriber_redis.on("error", (err) =>
      Logger.error("EventBus subscriber redis error", err)
    );
  }

  // -------------------------------------------------------------------------
  // Publish
  // -------------------------------------------------------------------------

  async publish(event: AppEvent): Promise<void> {
    // Validate base shape
    try {
      BaseEventSchema.parse({ ...event, payload: (event as any).payload ?? {} });
    } catch (err) {
      Logger.warn("EventBus: invalid event skipped", { event, err });
      return;
    }

    const streamKey = `${STREAM_PREFIX}${event.type}`;
    const allStreamKey = `${STREAM_PREFIX}all`;
    const serialised = JSON.stringify(event);

    try {
      // Publish to type-specific stream with approximate trimming
      await this.publish_redis.xadd(
        streamKey,
        "MAXLEN",
        XADD_APPROX as any,
        MAX_STREAM_LEN,
        "*",
        "event",
        serialised
      );

      // Also publish to global stream for audit / replay
      await this.publish_redis.xadd(
        allStreamKey,
        "MAXLEN",
        XADD_APPROX as any,
        MAX_STREAM_LEN * 5,
        "*",
        "event",
        serialised
      );

      Logger.debug("EventBus.publish", { type: event.type, id: event.id });

      // Invoke in-process handlers (fire-and-forget, non-blocking)
      const handlers = this.handlers.get(event.type);
      if (handlers && handlers.size > 0) {
        for (const handler of handlers) {
          this.invokeHandler(handler, event).catch((err) =>
            Logger.error("EventBus: in-process handler error", err)
          );
        }
      }
    } catch (err) {
      Logger.error("EventBus.publish failed", { err, eventId: event.id });
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Subscribe (in-process handlers – also called for stream consumer delivery)
  // -------------------------------------------------------------------------

  async subscribe(
    eventType: string,
    handler: EventHandler,
    _groupName?: string
  ): Promise<void> {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
    Logger.debug("EventBus.subscribe", { eventType });
  }

  async unsubscribe(eventType: string, handler: EventHandler): Promise<void> {
    const set = this.handlers.get(eventType);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(eventType);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Consumer group streaming (XREADGROUP loop)
  // -------------------------------------------------------------------------

  async startConsuming(
    streamKey: string,
    groupName: string,
    consumerName: string
  ): Promise<void> {
    await this.ensureConsumerGroup(streamKey, groupName);
    this.consumerGroups.set(streamKey, groupName);

    const consumerKey = `${streamKey}:${groupName}:${consumerName}`;
    if (this.consumers.get(consumerKey)?.running) {
      Logger.warn("EventBus.startConsuming: already running", { consumerKey });
      return;
    }

    const state: ConsumerState = { running: true };
    this.consumers.set(consumerKey, state);

    state.promise = this.consumeLoop(
      streamKey,
      groupName,
      consumerName,
      state
    );

    Logger.info("EventBus.startConsuming", { streamKey, groupName, consumerName });
  }

  private async consumeLoop(
    streamKey: string,
    groupName: string,
    consumerName: string,
    state: ConsumerState
  ): Promise<void> {
    // First, process any pending (unacknowledged) messages
    await this.processPending(streamKey, groupName, consumerName);

    while (state.running) {
      try {
        const results = await this.subscriber_redis.xreadgroup(
          "GROUP",
          groupName,
          consumerName,
          "COUNT",
          "10",
          "BLOCK",
          DEFAULT_BLOCK_MS,
          "STREAMS",
          streamKey,
          ">" // only new messages
        );

        if (!results) continue;

        for (const [, messages] of results as Array<[string, Array<[string, string[]]>]>) {
          for (const [msgId, fields] of messages) {
            await this.handleStreamMessage(
              streamKey,
              groupName,
              consumerName,
              msgId,
              fields
            );
          }
        }
      } catch (err: any) {
        if (!state.running) break;
        Logger.error("EventBus.consumeLoop error", { err, streamKey });
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async processPending(
    streamKey: string,
    groupName: string,
    consumerName: string
  ): Promise<void> {
    try {
      const pending = await this.publish_redis.xreadgroup(
        "GROUP",
        groupName,
        consumerName,
        "COUNT",
        "50",
        "STREAMS",
        streamKey,
        "0" // read pending messages
      );

      if (!pending) return;

      for (const [, messages] of pending as Array<[string, Array<[string, string[]]>]>) {
        for (const [msgId, fields] of messages) {
          await this.handleStreamMessage(
            streamKey,
            groupName,
            consumerName,
            msgId,
            fields
          );
        }
      }
    } catch (err) {
      Logger.error("EventBus.processPending error", { err, streamKey });
    }
  }

  private async handleStreamMessage(
    streamKey: string,
    groupName: string,
    consumerName: string,
    msgId: string,
    fields: string[]
  ): Promise<void> {
    // fields is a flat alternating key/value array: ["event", "{...json...}"]
    const eventJson = this.extractField(fields, "event");
    if (!eventJson) {
      await this.ack(streamKey, groupName, msgId);
      return;
    }

    let event: AppEvent;
    try {
      const parsed = JSON.parse(eventJson);
      // Re-hydrate dates
      parsed.timestamp = new Date(parsed.timestamp);
      event = parsed as AppEvent;
    } catch (err) {
      Logger.error("EventBus: failed to parse event", { err, msgId });
      await this.ack(streamKey, groupName, msgId);
      return;
    }

    // Check delivery count for dead-letter routing
    const deliveryCount = await this.getDeliveryCount(
      streamKey,
      groupName,
      msgId
    );
    if (deliveryCount > MAX_RETRY_COUNT) {
      Logger.warn("EventBus: sending to dead-letter", { msgId, eventType: event.type });
      await this.publishToDeadLetter(event, new Error(`Exceeded ${MAX_RETRY_COUNT} retries`));
      await this.ack(streamKey, groupName, msgId);
      return;
    }

    const handlers = this.handlers.get(event.type) ?? new Set();
    if (handlers.size === 0) {
      await this.ack(streamKey, groupName, msgId);
      return;
    }

    let success = true;
    for (const handler of handlers) {
      try {
        await this.invokeHandler(handler, event);
      } catch (err) {
        success = false;
        Logger.error("EventBus: handler error", { err, eventType: event.type, consumerName });
      }
    }

    if (success) {
      await this.ack(streamKey, groupName, msgId);
    }
    // If not successful, leave message in PEL for retry
  }

  // -------------------------------------------------------------------------
  // Replay events from a stream
  // -------------------------------------------------------------------------

  async replayEvents(
    streamKey: string,
    fromId: string,
    handler: EventHandler
  ): Promise<void> {
    let lastId = fromId;
    const batchSize = 100;

    Logger.info("EventBus.replayEvents started", { streamKey, fromId });

    while (true) {
      const results = await this.publish_redis.xrange(
        streamKey,
        lastId === "0" ? "-" : lastId,
        "+",
        "COUNT",
        batchSize
      ) as Array<[string, string[]]>;

      if (!results || results.length === 0) break;

      let count = 0;
      for (const [id, fields] of results) {
        if (id === lastId && lastId !== "0") continue; // skip starting boundary
        const eventJson = this.extractField(fields, "event");
        if (!eventJson) continue;

        try {
          const parsed = JSON.parse(eventJson);
          parsed.timestamp = new Date(parsed.timestamp);
          await handler(parsed as AppEvent);
          count++;
        } catch (err) {
          Logger.error("EventBus.replayEvents handler error", { err, id });
        }
        lastId = id;
      }

      if (results.length < batchSize) break;
      if (count === 0) break; // only the boundary entry
    }

    Logger.info("EventBus.replayEvents completed", { streamKey, lastId });
  }

  // -------------------------------------------------------------------------
  // Dead-letter queue
  // -------------------------------------------------------------------------

  async publishToDeadLetter(event: AppEvent, error: Error): Promise<void> {
    try {
      const entry = JSON.stringify({
        originalEvent: event,
        error: { message: error.message, stack: error.stack },
        failedAt: new Date().toISOString(),
      });
      await this.publish_redis.xadd(
        DEAD_LETTER_STREAM,
        "MAXLEN",
        XADD_APPROX as any,
        10_000,
        "*",
        "entry",
        entry
      );
    } catch (err) {
      Logger.error("EventBus.publishToDeadLetter failed", err);
    }
  }

  // -------------------------------------------------------------------------
  // Stream info
  // -------------------------------------------------------------------------

  async getStreamInfo(streamKey: string): Promise<StreamInfo> {
    try {
      const info = await this.publish_redis.xinfo("STREAM", streamKey) as any[];
      const infoMap = this.arrayToMap(info);
      const groups = await this.publish_redis.xinfo("GROUPS", streamKey) as any[];

      return {
        streamKey,
        length: infoMap.get("length") ?? 0,
        groups: Array.isArray(groups) ? groups.length / 2 : 0,
        firstEntryId: infoMap.get("first-entry")?.[0],
        lastEntryId: infoMap.get("last-entry")?.[0],
      };
    } catch {
      return { streamKey, length: 0, groups: 0 };
    }
  }

  // -------------------------------------------------------------------------
  // Graceful stop
  // -------------------------------------------------------------------------

  async stop(): Promise<void> {
    Logger.info("EventBus.stop: stopping all consumers");
    for (const [key, state] of this.consumers) {
      state.running = false;
      Logger.debug("EventBus.stop: stopped consumer", { key });
    }
    // Wait for all consumer loops to exit (up to 5s each)
    const stops = Array.from(this.consumers.values()).map((s) =>
      s.promise
        ? Promise.race([
            s.promise,
            new Promise<void>((r) => setTimeout(r, 5000)),
          ])
        : Promise.resolve()
    );
    await Promise.all(stops);

    await this.publish_redis.quit().catch(() => {});
    await this.subscriber_redis.quit().catch(() => {});
    Logger.info("EventBus.stop: done");
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async ensureConsumerGroup(
    streamKey: string,
    groupName: string
  ): Promise<void> {
    try {
      await this.publish_redis.xgroup(
        "CREATE",
        streamKey,
        groupName,
        "0",
        "MKSTREAM"
      );
      Logger.info("EventBus: consumer group created", { streamKey, groupName });
    } catch (err: any) {
      if (err?.message?.includes("BUSYGROUP")) {
        // Group already exists – that's fine
      } else {
        Logger.error("EventBus.ensureConsumerGroup error", err);
        throw err;
      }
    }
  }

  private async ack(
    streamKey: string,
    groupName: string,
    msgId: string
  ): Promise<void> {
    try {
      await this.publish_redis.xack(streamKey, groupName, msgId);
    } catch (err) {
      Logger.error("EventBus.ack failed", { err, msgId });
    }
  }

  private async getDeliveryCount(
    streamKey: string,
    groupName: string,
    msgId: string
  ): Promise<number> {
    try {
      const pending = await this.publish_redis.xpending(
        streamKey,
        groupName,
        "-",
        "+",
        "1",
        msgId
      ) as Array<[string, string, number, number]>;
      if (!pending || pending.length === 0) return 0;
      return pending[0][3] ?? 0;
    } catch {
      return 0;
    }
  }

  private async invokeHandler(
    handler: EventHandler,
    event: AppEvent
  ): Promise<void> {
    await handler(event);
  }

  private extractField(fields: string[], key: string): string | undefined {
    const idx = fields.indexOf(key);
    return idx !== -1 ? fields[idx + 1] : undefined;
  }

  private arrayToMap(arr: any[]): Map<string, any> {
    const m = new Map<string, any>();
    for (let i = 0; i < arr.length - 1; i += 2) {
      m.set(arr[i], arr[i + 1]);
    }
    return m;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const eventBus = new EventBus();
