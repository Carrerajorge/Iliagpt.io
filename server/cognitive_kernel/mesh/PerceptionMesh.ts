import pino from 'pino';

const logger = pino({ name: 'PerceptionMesh', level: process.env.LOG_LEVEL ?? 'info' });

export enum PerceptionType {
  VISUAL = 'VISUAL',
  CODE_ANALYSIS = 'CODE_ANALYSIS',
  DOCUMENT_PARSING = 'DOCUMENT_PARSING',
  WEB_MONITORING = 'WEB_MONITORING',
  AUDIO = 'AUDIO',
  SENSOR = 'SENSOR',
}

export interface PerceptionEvent {
  id: string;
  type: PerceptionType;
  source: string;
  data: unknown;
  confidence: number; // 0-1
  timestamp: number;
  nodeId: string;
}

export interface PerceptionDaemon {
  id: string;
  type: PerceptionType;
  nodeId: string;
  active: boolean;
  processedCount: number;
}

type PerceptionCallback = (event: PerceptionEvent) => void;

interface Subscription {
  id: string;
  type: PerceptionType | null; // null = subscribe to all
  callback: PerceptionCallback;
}

interface FusionGroup {
  source: string;
  type: PerceptionType;
  events: PerceptionEvent[];
  windowStart: number;
}

const EVENT_BUFFER_SIZE = 1000;
const FUSION_WINDOW_MS = 500;
const BROADCAST_TIMEOUT_MS = 3_000;

export class PerceptionMesh {
  public daemons: Map<string, PerceptionDaemon> = new Map();
  public eventBuffer: PerceptionEvent[] = [];

  private subscriptions: Map<string, Subscription> = new Map();
  private meshNodeUrls: Map<string, string> = new Map(); // nodeId -> base URL
  private readonly localNodeId: string;

  constructor(localNodeId: string) {
    this.localNodeId = localNodeId;
    logger.info({ localNodeId }, 'PerceptionMesh initialized');
  }

  registerMeshNode(nodeId: string, nodeUrl: string): void {
    this.meshNodeUrls.set(nodeId, nodeUrl);
    logger.debug({ nodeId, nodeUrl }, 'Mesh node registered for perception broadcast');
  }

  unregisterMeshNode(nodeId: string): void {
    this.meshNodeUrls.delete(nodeId);
    logger.debug({ nodeId }, 'Mesh node unregistered from perception broadcast');
  }

  registerDaemon(daemon: PerceptionDaemon): void {
    this.daemons.set(daemon.id, { ...daemon, processedCount: daemon.processedCount ?? 0 });
    logger.info(
      { daemonId: daemon.id, type: daemon.type, nodeId: daemon.nodeId },
      'Perception daemon registered',
    );
  }

  unregisterDaemon(daemonId: string): void {
    const existed = this.daemons.delete(daemonId);
    if (existed) {
      logger.info({ daemonId }, 'Perception daemon unregistered');
    } else {
      logger.warn({ daemonId }, 'Attempted to unregister unknown daemon');
    }
  }

  emit(event: PerceptionEvent): void {
    if (event.confidence < 0 || event.confidence > 1) {
      logger.warn({ eventId: event.id, confidence: event.confidence }, 'Invalid confidence value, clamping to [0,1]');
      event = { ...event, confidence: Math.max(0, Math.min(1, event.confidence)) };
    }

    // Store in ring buffer
    this.pushToBuffer(event);

    // Update daemon count if it's from a known daemon
    for (const daemon of this.daemons.values()) {
      if (daemon.nodeId === event.nodeId && daemon.type === event.type) {
        daemon.processedCount++;
        break;
      }
    }

    logger.debug(
      { eventId: event.id, type: event.type, source: event.source, confidence: event.confidence, nodeId: event.nodeId },
      'Perception event emitted',
    );

    // Deliver to local subscribers
    this.deliverToSubscribers(event);

    // Broadcast to other mesh nodes (fire-and-forget)
    if (this.meshNodeUrls.size > 0) {
      this.broadcastToMesh(event).catch((err) => {
        logger.warn({ eventId: event.id, err }, 'Mesh broadcast failed');
      });
    }
  }

  private pushToBuffer(event: PerceptionEvent): void {
    this.eventBuffer.push(event);
    if (this.eventBuffer.length > EVENT_BUFFER_SIZE) {
      this.eventBuffer.splice(0, this.eventBuffer.length - EVENT_BUFFER_SIZE);
    }
  }

  private deliverToSubscribers(event: PerceptionEvent): void {
    for (const sub of this.subscriptions.values()) {
      if (sub.type === null || sub.type === event.type) {
        try {
          sub.callback(event);
        } catch (err) {
          logger.error({ err, subscriptionId: sub.id, eventId: event.id }, 'Subscription callback threw error');
        }
      }
    }
  }

  private async broadcastToMesh(event: PerceptionEvent): Promise<void> {
    const broadcastPromises = Array.from(this.meshNodeUrls.entries())
      .filter(([nodeId]) => nodeId !== this.localNodeId)
      .map(async ([nodeId, nodeUrl]) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), BROADCAST_TIMEOUT_MS);

        try {
          const response = await fetch(`${nodeUrl}/perception/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            logger.warn({ nodeId, eventId: event.id, status: response.status }, 'Perception broadcast returned non-OK');
          }
        } catch (err) {
          clearTimeout(timeoutId);
          logger.warn({ nodeId, eventId: event.id, err }, 'Perception broadcast to node failed');
        }
      });

    await Promise.allSettled(broadcastPromises);
  }

  subscribe(type: PerceptionType, callback: PerceptionCallback): () => void {
    const subscriptionId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.subscriptions.set(subscriptionId, { id: subscriptionId, type, callback });
    logger.debug({ subscriptionId, type }, 'Perception subscription created');

    // Return unsubscribe function
    return () => {
      this.subscriptions.delete(subscriptionId);
      logger.debug({ subscriptionId, type }, 'Perception subscription removed');
    };
  }

  subscribeAll(callback: PerceptionCallback): () => void {
    const subscriptionId = `sub-all-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.subscriptions.set(subscriptionId, { id: subscriptionId, type: null, callback });
    logger.debug({ subscriptionId }, 'Global perception subscription created');

    return () => {
      this.subscriptions.delete(subscriptionId);
      logger.debug({ subscriptionId }, 'Global perception subscription removed');
    };
  }

  fuse(events: PerceptionEvent[]): PerceptionEvent {
    if (events.length === 0) {
      throw new Error('Cannot fuse empty event list');
    }
    if (events.length === 1) return events[0];

    // Group events by source within FUSION_WINDOW_MS
    const groups = new Map<string, FusionGroup>();

    for (const event of events) {
      const groupKey = `${event.source}:${event.type}`;
      const existing = groups.get(groupKey);

      if (!existing) {
        groups.set(groupKey, {
          source: event.source,
          type: event.type,
          events: [event],
          windowStart: event.timestamp,
        });
      } else {
        if (event.timestamp - existing.windowStart <= FUSION_WINDOW_MS) {
          existing.events.push(event);
        } else {
          // Outside fusion window, start a new group
          const newKey = `${groupKey}:${event.timestamp}`;
          groups.set(newKey, {
            source: event.source,
            type: event.type,
            events: [event],
            windowStart: event.timestamp,
          });
        }
      }
    }

    // Pick the group with the most events (best signal aggregation)
    let bestGroup: FusionGroup | null = null;
    for (const group of groups.values()) {
      if (!bestGroup || group.events.length > bestGroup.events.length) {
        bestGroup = group;
      }
    }

    const groupEvents = bestGroup!.events;

    // Highest confidence wins for the fused data
    groupEvents.sort((a, b) => b.confidence - a.confidence);
    const champion = groupEvents[0];

    // Average confidence across the group (wisdom of the crowd)
    const avgConfidence = groupEvents.reduce((sum, e) => sum + e.confidence, 0) / groupEvents.length;

    // Merge data: champion data wins, but metadata from all events is aggregated
    const fusedData: { primary: unknown; supporting: unknown[]; sources: string[] } = {
      primary: champion.data,
      supporting: groupEvents.slice(1).map((e) => e.data),
      sources: [...new Set(groupEvents.map((e) => e.nodeId))],
    };

    const fused: PerceptionEvent = {
      id: `fused-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: champion.type,
      source: champion.source,
      data: fusedData,
      confidence: Math.min(1, avgConfidence * (1 + Math.log(groupEvents.length) * 0.1)), // Confidence bonus for multi-source
      timestamp: Date.now(),
      nodeId: this.localNodeId,
    };

    logger.info(
      {
        fusedId: fused.id,
        type: fused.type,
        inputCount: events.length,
        groupCount: groups.size,
        confidence: fused.confidence,
      },
      'Perception events fused',
    );

    return fused;
  }

  getDaemonStatus(): PerceptionDaemon[] {
    return Array.from(this.daemons.values());
  }

  getRecentEvents(type?: PerceptionType, limit = 50): PerceptionEvent[] {
    let events = [...this.eventBuffer].reverse(); // Most recent first

    if (type !== undefined) {
      events = events.filter((e) => e.type === type);
    }

    return events.slice(0, limit);
  }

  getEventsBySource(source: string, limit = 50): PerceptionEvent[] {
    return [...this.eventBuffer]
      .reverse()
      .filter((e) => e.source === source)
      .slice(0, limit);
  }

  getStats(): {
    bufferedEvents: number;
    activeDaemons: number;
    totalProcessed: number;
    subscriptions: number;
    typeBreakdown: Record<string, number>;
    nodeBreakdown: Record<string, number>;
  } {
    const typeBreakdown: Record<string, number> = {};
    const nodeBreakdown: Record<string, number> = {};

    for (const event of this.eventBuffer) {
      typeBreakdown[event.type] = (typeBreakdown[event.type] ?? 0) + 1;
      nodeBreakdown[event.nodeId] = (nodeBreakdown[event.nodeId] ?? 0) + 1;
    }

    const totalProcessed = Array.from(this.daemons.values()).reduce((sum, d) => sum + d.processedCount, 0);
    const activeDaemons = Array.from(this.daemons.values()).filter((d) => d.active).length;

    return {
      bufferedEvents: this.eventBuffer.length,
      activeDaemons,
      totalProcessed,
      subscriptions: this.subscriptions.size,
      typeBreakdown,
      nodeBreakdown,
    };
  }

  setDaemonActive(daemonId: string, active: boolean): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) {
      logger.warn({ daemonId }, 'Cannot set active state: daemon not found');
      return;
    }
    daemon.active = active;
    logger.info({ daemonId, active }, 'Daemon active state updated');
  }

  clearBuffer(): void {
    const cleared = this.eventBuffer.length;
    this.eventBuffer.length = 0;
    logger.info({ cleared }, 'Event buffer cleared');
  }
}

export const globalPerceptionMesh = new PerceptionMesh('local');
