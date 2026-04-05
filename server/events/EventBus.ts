// server/events/EventBus.ts
// Redis Streams-based event bus with consumer groups, dead-letter queue,
// exponential-backoff retries, and graceful shutdown.

import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import logger from '../../lib/logger';
import type {
  DomainEvent,
  EventHandler,
  EventBusConfig,
  StreamInfo,
} from './types';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface SubscriberEntry {
  eventTypes: string[];
  handler: EventHandler;
  groupName: string;
}

interface PendingMessage {
  streamKey: string;
  messageId: string;
  groupName: string;
  consumerName: string;
  retryCount: number;
  lastError?: string;
}

// Redis XREAD/XREADGROUP return shape (ioredis types are loose)
type RedisStreamMessages = Array<[string, Array<[string, string[]]>]>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_STREAM_PREFIX = 'events';
const DEFAULT_DEAD_LETTER_STREAM = 'events:dead-letter';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 200;
const DEFAULT_MAX_STREAM_LENGTH = 10_000;
const DEFAULT_ACK_TIMEOUT_MS = 30_000;
const CONSUMER_POLL_INTERVAL_MS = 100;
const CONSUMER_BLOCK_MS = 2_000;
const CONSUMER_BATCH_SIZE = 10;
const PENDING_CLAIM_MIN_IDLE_MS = 5_000;

// ---------------------------------------------------------------------------
// EventBus class
// ---------------------------------------------------------------------------

export class EventBus {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly config: Required<EventBusConfig>;

  private readonly subscribers = new Map<string, SubscriberEntry>();
  private consumerInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private activeConsumerName = '';
  private activeGroupName = '';

  constructor(config?: Partial<EventBusConfig>) {
    const redisUrl = config?.redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

    this.config = {
      redisUrl,
      streamPrefix: config?.streamPrefix ?? DEFAULT_STREAM_PREFIX,
      maxRetries: config?.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryBaseDelayMs: config?.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
      maxStreamLength: config?.maxStreamLength ?? DEFAULT_MAX_STREAM_LENGTH,
      deadLetterStream: config?.deadLetterStream ?? DEFAULT_DEAD_LETTER_STREAM,
      ackTimeoutMs: config?.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS,
    };

    this.publisher = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    this.subscriber = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    this.publisher.on('error', (err) =>
      logger.error({ err }, '[EventBus] publisher Redis error'),
    );
    this.subscriber.on('error', (err) =>
      logger.error({ err }, '[EventBus] subscriber Redis error'),
    );

    this.publisher.on('ready', () => logger.info('[EventBus] publisher ready'));
    this.subscriber.on('ready', () => logger.info('[EventBus] subscriber ready'));
  }

  // ---------------------------------------------------------------------------
  // Stream key helpers
  // ---------------------------------------------------------------------------

  private streamKey(eventType: string): string {
    return `${this.config.streamPrefix}:${eventType}`;
  }

  // ---------------------------------------------------------------------------
  // publish
  // ---------------------------------------------------------------------------

  /**
   * Publish a domain event to the appropriate Redis Stream.
   * Returns the Redis stream entry ID (e.g. "1689012345678-0").
   */
  async publish(event: DomainEvent): Promise<string> {
    const key = this.streamKey(event.type);
    const serialized = JSON.stringify(event);

    try {
      // XADD with MAXLEN ~ to trim the stream approximately
      const entryId = await this.publisher.xadd(
        key,
        'MAXLEN',
        '~',
        this.config.maxStreamLength,
        '*', // auto-generated ID
        'event',
        serialized,
        'eventId',
        event.id,
        'eventType',
        event.type,
        'aggregateId',
        event.aggregateId,
        'tenantId',
        event.tenantId,
        'version',
        String(event.version),
        'timestamp',
        event.timestamp,
      );

      if (!entryId) {
        throw new Error('XADD returned null entry ID');
      }

      logger.debug(
        {
          eventId: event.id,
          eventType: event.type,
          streamKey: key,
          entryId,
        },
        '[EventBus] published event',
      );

      return entryId;
    } catch (err) {
      logger.error(
        { err, eventId: event.id, eventType: event.type, streamKey: key },
        '[EventBus] failed to publish event',
      );
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // subscribe / unsubscribe
  // ---------------------------------------------------------------------------

  /**
   * Register a handler for one or more event types.
   * Creates a consumer group on each relevant stream (if not already present).
   */
  async subscribe(
    eventTypes: string[],
    handler: EventHandler,
    groupName: string,
  ): Promise<void> {
    if (eventTypes.length === 0) {
      throw new Error('eventTypes must contain at least one type');
    }

    this.subscribers.set(groupName, { eventTypes, handler, groupName });

    // Ensure consumer groups exist on each stream
    await Promise.all(
      eventTypes.map((type) => this.ensureConsumerGroup(this.streamKey(type), groupName)),
    );

    logger.info(
      { groupName, eventTypes },
      '[EventBus] subscribed handler to event types',
    );
  }

  async unsubscribe(groupName: string): Promise<void> {
    this.subscribers.delete(groupName);
    logger.info({ groupName }, '[EventBus] unsubscribed handler');
  }

  // ---------------------------------------------------------------------------
  // Consumer group management
  // ---------------------------------------------------------------------------

  private async ensureConsumerGroup(streamKey: string, groupName: string): Promise<void> {
    try {
      // XGROUP CREATE stream group $ MKSTREAM
      // '$' means only new messages after group creation
      await this.subscriber.xgroup('CREATE', streamKey, groupName, '$', 'MKSTREAM');
      logger.debug({ streamKey, groupName }, '[EventBus] created consumer group');
    } catch (err: unknown) {
      // BUSYGROUP means the group already exists — that is fine
      if (
        err instanceof Error &&
        err.message.includes('BUSYGROUP')
      ) {
        return;
      }
      logger.warn(
        { err, streamKey, groupName },
        '[EventBus] unexpected error creating consumer group',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Consumer loop
  // ---------------------------------------------------------------------------

  /**
   * Start the polling consumer loop.
   * Each tick reads pending + new messages from all subscribed streams.
   */
  async startConsumer(groupName: string, consumerName: string): Promise<void> {
    if (this.isRunning) {
      logger.warn('[EventBus] consumer is already running');
      return;
    }

    this.isRunning = true;
    this.activeGroupName = groupName;
    this.activeConsumerName = consumerName;

    logger.info({ groupName, consumerName }, '[EventBus] starting consumer');

    // Attempt to claim timed-out pending messages on startup
    await this.reclaimStalePending(groupName, consumerName);

    this.consumerInterval = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        await this.processPendingMessages(groupName, consumerName);
        await this.processNewMessages(groupName, consumerName);
      } catch (err) {
        logger.error({ err }, '[EventBus] consumer tick error');
      }
    }, CONSUMER_POLL_INTERVAL_MS);
  }

  async stopConsumer(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.consumerInterval) {
      clearInterval(this.consumerInterval);
      this.consumerInterval = null;
    }

    logger.info('[EventBus] consumer stopped');
  }

  // ---------------------------------------------------------------------------
  // Message processing: new messages
  // ---------------------------------------------------------------------------

  private async processNewMessages(
    groupName: string,
    consumerName: string,
  ): Promise<void> {
    const entry = this.subscribers.get(groupName);
    if (!entry) return;

    const keys = entry.eventTypes.map((t) => this.streamKey(t));
    if (keys.length === 0) return;

    // XREADGROUP GROUP <group> <consumer> COUNT <n> BLOCK <ms> STREAMS <keys...> > > ...
    const args: (string | number)[] = [
      'GROUP',
      groupName,
      consumerName,
      'COUNT',
      CONSUMER_BATCH_SIZE,
      'BLOCK',
      CONSUMER_BLOCK_MS,
      'STREAMS',
      ...keys,
      // '>' means undelivered messages
      ...keys.map(() => '>'),
    ];

    const results = (await this.subscriber.xreadgroup(
      ...(args as Parameters<Redis['xreadgroup']>),
    )) as RedisStreamMessages | null;

    if (!results) return;

    for (const [streamKey, messages] of results) {
      for (const [messageId, fields] of messages) {
        await this.dispatchMessage(
          streamKey,
          messageId,
          fields,
          entry.handler,
          groupName,
          consumerName,
          0,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Message processing: retry pending (XAUTOCLAIM)
  // ---------------------------------------------------------------------------

  private async processPendingMessages(
    groupName: string,
    consumerName: string,
  ): Promise<void> {
    const entry = this.subscribers.get(groupName);
    if (!entry) return;

    for (const eventType of entry.eventTypes) {
      const key = this.streamKey(eventType);
      try {
        // XAUTOCLAIM: claim messages idle > ackTimeoutMs belonging to this group
        // Returns [nextId, [[id, fields], ...], [deletedIds]]
        const claimed = (await this.subscriber.xautoclaim(
          key,
          groupName,
          consumerName,
          this.config.ackTimeoutMs,
          '0-0',
          'COUNT',
          CONSUMER_BATCH_SIZE,
        )) as [string, Array<[string, string[]]>, string[]];

        if (!claimed || !claimed[1]) continue;

        for (const [messageId, fields] of claimed[1]) {
          // Determine current retry count from pending entry metadata
          const retryCount = await this.getPendingRetryCount(
            key,
            groupName,
            messageId,
          );

          await this.dispatchMessage(
            key,
            messageId,
            fields,
            entry.handler,
            groupName,
            consumerName,
            retryCount,
          );
        }
      } catch (err) {
        logger.warn(
          { err, streamKey: key, groupName },
          '[EventBus] xautoclaim error',
        );
      }
    }
  }

  private async reclaimStalePending(
    groupName: string,
    consumerName: string,
  ): Promise<void> {
    const entry = this.subscribers.get(groupName);
    if (!entry) return;

    for (const eventType of entry.eventTypes) {
      const key = this.streamKey(eventType);
      try {
        await this.subscriber.xautoclaim(
          key,
          groupName,
          consumerName,
          PENDING_CLAIM_MIN_IDLE_MS,
          '0-0',
          'COUNT',
          100,
        );
      } catch {
        // Non-fatal; stream might not exist yet
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Dispatch a single message with retries
  // ---------------------------------------------------------------------------

  private async dispatchMessage(
    streamKey: string,
    messageId: string,
    fields: string[],
    handler: EventHandler,
    groupName: string,
    consumerName: string,
    retryCount: number,
  ): Promise<void> {
    const eventJson = this.extractField(fields, 'event');
    if (!eventJson) {
      logger.warn({ streamKey, messageId }, '[EventBus] missing event field, acking anyway');
      await this.ack(streamKey, groupName, messageId);
      return;
    }

    let event: DomainEvent;
    try {
      event = JSON.parse(eventJson) as DomainEvent;
    } catch (err) {
      logger.error(
        { err, streamKey, messageId },
        '[EventBus] failed to parse event JSON, sending to DLQ',
      );
      await this.sendToDeadLetterQueue(messageId, streamKey, groupName, fields, 'JSON_PARSE_ERROR', String(err));
      await this.ack(streamKey, groupName, messageId);
      return;
    }

    try {
      await handler(event);
      await this.ack(streamKey, groupName, messageId);

      logger.debug(
        { eventId: event.id, eventType: event.type, messageId, retryCount },
        '[EventBus] event processed and acked',
      );
    } catch (err) {
      const nextRetry = retryCount + 1;
      logger.warn(
        {
          err,
          eventId: event.id,
          eventType: event.type,
          messageId,
          retryCount: nextRetry,
          maxRetries: this.config.maxRetries,
        },
        '[EventBus] handler error',
      );

      if (nextRetry >= this.config.maxRetries) {
        logger.error(
          { eventId: event.id, messageId, retryCount: nextRetry },
          '[EventBus] max retries exceeded, sending to DLQ',
        );
        await this.sendToDeadLetterQueue(
          messageId,
          streamKey,
          groupName,
          fields,
          'MAX_RETRIES_EXCEEDED',
          String(err),
        );
        await this.ack(streamKey, groupName, messageId);
      } else {
        // Leave message in PEL; exponential backoff before next claim
        const delayMs =
          this.config.retryBaseDelayMs * Math.pow(2, retryCount);
        logger.debug(
          { messageId, delayMs },
          '[EventBus] will retry after delay',
        );
        await this.sleep(delayMs);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Dead-letter queue
  // ---------------------------------------------------------------------------

  private async sendToDeadLetterQueue(
    originalMessageId: string,
    sourceStream: string,
    groupName: string,
    originalFields: string[],
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      await this.publisher.xadd(
        this.config.deadLetterStream,
        'MAXLEN',
        '~',
        1_000,
        '*',
        'originalMessageId', originalMessageId,
        'sourceStream', sourceStream,
        'groupName', groupName,
        'errorCode', errorCode,
        'errorMessage', errorMessage,
        'deadLetteredAt', new Date().toISOString(),
        'originalEvent', this.extractField(originalFields, 'event') ?? '',
      );
    } catch (err) {
      logger.error(
        { err, originalMessageId, sourceStream },
        '[EventBus] failed to write to dead-letter queue',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // XACK helper
  // ---------------------------------------------------------------------------

  private async ack(
    streamKey: string,
    groupName: string,
    messageId: string,
  ): Promise<void> {
    try {
      await this.subscriber.xack(streamKey, groupName, messageId);
    } catch (err) {
      logger.warn(
        { err, streamKey, groupName, messageId },
        '[EventBus] XACK failed',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Pending entry retry count
  // ---------------------------------------------------------------------------

  private async getPendingRetryCount(
    streamKey: string,
    groupName: string,
    messageId: string,
  ): Promise<number> {
    try {
      // XPENDING <stream> <group> - <+> 1 <id>
      const result = await this.subscriber.xpending(
        streamKey,
        groupName,
        '-',
        '+',
        1,
        // Filter by specific message ID is only supported via XPENDING IDLE syntax
        // We use delivery count from standard XPENDING response
      ) as Array<[string, string, number, number]>;

      if (result && result.length > 0) {
        // result[i] = [id, consumerName, idleMs, deliveryCount]
        const entry = result.find(([id]) => id === messageId);
        if (entry) return Math.max(0, entry[3] - 1);
      }
    } catch {
      // Fallback: treat as first retry
    }
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Stream info
  // ---------------------------------------------------------------------------

  async getStreamInfo(eventType: string): Promise<StreamInfo> {
    const key = this.streamKey(eventType);
    try {
      const info = await this.publisher.xinfo('STREAM', key) as unknown[];

      // XINFO STREAM returns a flat array: [field, value, field, value, ...]
      const infoMap: Record<string, unknown> = {};
      for (let i = 0; i < info.length - 1; i += 2) {
        infoMap[info[i] as string] = info[i + 1];
      }

      const groupsRaw = await this.publisher.xinfo('GROUPS', key) as unknown[];

      return {
        name: key,
        length: Number(infoMap['length'] ?? 0),
        firstEntryId: (infoMap['first-entry'] as [string] | null)?.[0] ?? null,
        lastEntryId: (infoMap['last-entry'] as [string] | null)?.[0] ?? null,
        groups: Array.isArray(groupsRaw) ? groupsRaw.length : 0,
      };
    } catch (err) {
      logger.warn({ err, key }, '[EventBus] getStreamInfo failed');
      return {
        name: key,
        length: 0,
        firstEntryId: null,
        lastEntryId: null,
        groups: 0,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------

  async shutdown(): Promise<void> {
    logger.info('[EventBus] shutting down');
    await this.stopConsumer();
    await Promise.allSettled([
      this.publisher.quit(),
      this.subscriber.quit(),
    ]);
    logger.info('[EventBus] shutdown complete');
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  private extractField(fields: string[], name: string): string | undefined {
    const idx = fields.indexOf(name);
    if (idx === -1) return undefined;
    return fields[idx + 1];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---------------------------------------------------------------------------
  // Health check
  // ---------------------------------------------------------------------------

  async ping(): Promise<boolean> {
    try {
      const res = await this.publisher.ping();
      return res === 'PONG';
    } catch {
      return false;
    }
  }

  // Expose running state for external monitoring
  get running(): boolean {
    return this.isRunning;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const eventBus = new EventBus();
