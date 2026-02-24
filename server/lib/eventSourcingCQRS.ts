/**
 * Event Sourcing and CQRS Infrastructure
 * Tasks 46-60: Event sourcing, CQRS, distributed transactions
 */

import { EventEmitter } from 'events';
import { Logger } from './logger';
import crypto from 'crypto';

// ============================================================================
// Task 56: Event Sourcing for Audit Trail
// ============================================================================

interface DomainEvent {
    id: string;
    aggregateId: string;
    aggregateType: string;
    eventType: string;
    payload: Record<string, any>;
    metadata: {
        userId?: string;
        timestamp: Date;
        version: number;
        correlationId?: string;
        causationId?: string;
    };
}

interface EventStore {
    append(event: DomainEvent): Promise<void>;
    getEvents(aggregateId: string, fromVersion?: number): Promise<DomainEvent[]>;
    getAllEvents(eventTypes?: string[], fromTimestamp?: Date): Promise<DomainEvent[]>;
}

class InMemoryEventStore implements EventStore {
    private events: DomainEvent[] = [];
    private eventsByAggregate: Map<string, DomainEvent[]> = new Map();

    async append(event: DomainEvent): Promise<void> {
        this.events.push(event);

        if (!this.eventsByAggregate.has(event.aggregateId)) {
            this.eventsByAggregate.set(event.aggregateId, []);
        }
        this.eventsByAggregate.get(event.aggregateId)!.push(event);
    }

    async getEvents(aggregateId: string, fromVersion: number = 0): Promise<DomainEvent[]> {
        const events = this.eventsByAggregate.get(aggregateId) ?? [];
        return events.filter(e => e.metadata.version >= fromVersion);
    }

    async getAllEvents(eventTypes?: string[], fromTimestamp?: Date): Promise<DomainEvent[]> {
        let filtered = this.events;

        if (eventTypes?.length) {
            filtered = filtered.filter(e => eventTypes.includes(e.eventType));
        }

        if (fromTimestamp) {
            filtered = filtered.filter(e => e.metadata.timestamp >= fromTimestamp);
        }

        return filtered;
    }
}

class EventSourcing extends EventEmitter {
    private store: EventStore;
    private handlers: Map<string, Array<(event: DomainEvent) => Promise<void>>> = new Map();

    constructor(store?: EventStore) {
        super();
        this.store = store ?? new InMemoryEventStore();
    }

    /**
     * Publish a domain event
     */
    async publish(params: {
        aggregateId: string;
        aggregateType: string;
        eventType: string;
        payload: Record<string, any>;
        userId?: string;
        correlationId?: string;
        causationId?: string;
    }): Promise<DomainEvent> {
        // Get current version
        const existingEvents = await this.store.getEvents(params.aggregateId);
        const version = existingEvents.length + 1;

        const event: DomainEvent = {
            id: crypto.randomUUID(),
            aggregateId: params.aggregateId,
            aggregateType: params.aggregateType,
            eventType: params.eventType,
            payload: params.payload,
            metadata: {
                userId: params.userId,
                timestamp: new Date(),
                version,
                correlationId: params.correlationId ?? crypto.randomUUID(),
                causationId: params.causationId,
            },
        };

        await this.store.append(event);

        // Dispatch to handlers
        await this.dispatch(event);

        this.emit('eventPublished', event);
        Logger.debug(`[EventSourcing] Published ${event.eventType} for ${event.aggregateId}`);

        return event;
    }

    /**
     * Subscribe to event types
     */
    subscribe(eventType: string, handler: (event: DomainEvent) => Promise<void>): void {
        if (!this.handlers.has(eventType)) {
            this.handlers.set(eventType, []);
        }
        this.handlers.get(eventType)!.push(handler);
    }

    private async dispatch(event: DomainEvent): Promise<void> {
        const handlers = this.handlers.get(event.eventType) ?? [];
        const wildcardHandlers = this.handlers.get('*') ?? [];

        const allHandlers = [...handlers, ...wildcardHandlers];

        await Promise.all(
            allHandlers.map(handler =>
                handler(event).catch(err => {
                    Logger.error(`[EventSourcing] Handler error for ${event.eventType}: ${err.message}`);
                })
            )
        );
    }

    /**
     * Replay events for an aggregate
     */
    async replay<T>(
        aggregateId: string,
        reducer: (state: T, event: DomainEvent) => T,
        initialState: T
    ): Promise<T> {
        const events = await this.store.getEvents(aggregateId);
        return events.reduce((state, event) => reducer(state, event), initialState);
    }

    /**
     * Get event history for an aggregate
     */
    async getHistory(aggregateId: string): Promise<DomainEvent[]> {
        return this.store.getEvents(aggregateId);
    }

    getStore(): EventStore {
        return this.store;
    }
}

export const eventSourcing = new EventSourcing();

// ============================================================================
// Task 57: CQRS Separation
// ============================================================================

interface Command {
    type: string;
    payload: Record<string, any>;
    metadata?: { userId?: string; correlationId?: string };
}

interface Query {
    type: string;
    params: Record<string, any>;
}

type CommandHandler<T = any> = (command: Command) => Promise<T>;
type QueryHandler<T = any> = (query: Query) => Promise<T>;

class CQRSBus extends EventEmitter {
    private commandHandlers: Map<string, CommandHandler> = new Map();
    private queryHandlers: Map<string, QueryHandler> = new Map();

    /**
     * Register a command handler
     */
    registerCommand<T>(commandType: string, handler: CommandHandler<T>): void {
        if (this.commandHandlers.has(commandType)) {
            throw new Error(`Command handler for ${commandType} already registered`);
        }
        this.commandHandlers.set(commandType, handler);
        Logger.debug(`[CQRS] Registered command handler: ${commandType}`);
    }

    /**
     * Register a query handler
     */
    registerQuery<T>(queryType: string, handler: QueryHandler<T>): void {
        if (this.queryHandlers.has(queryType)) {
            throw new Error(`Query handler for ${queryType} already registered`);
        }
        this.queryHandlers.set(queryType, handler);
        Logger.debug(`[CQRS] Registered query handler: ${queryType}`);
    }

    /**
     * Execute a command (write operation)
     */
    async executeCommand<T>(command: Command): Promise<T> {
        const handler = this.commandHandlers.get(command.type);
        if (!handler) {
            throw new Error(`No handler for command: ${command.type}`);
        }

        const startTime = Date.now();
        try {
            const result = await handler(command);
            this.emit('commandExecuted', { command, result, durationMs: Date.now() - startTime });
            return result as T;
        } catch (error) {
            this.emit('commandFailed', { command, error, durationMs: Date.now() - startTime });
            throw error;
        }
    }

    /**
     * Execute a query (read operation)
     */
    async executeQuery<T>(query: Query): Promise<T> {
        const handler = this.queryHandlers.get(query.type);
        if (!handler) {
            throw new Error(`No handler for query: ${query.type}`);
        }

        const startTime = Date.now();
        try {
            const result = await handler(query);
            this.emit('queryExecuted', { query, durationMs: Date.now() - startTime });
            return result as T;
        } catch (error) {
            this.emit('queryFailed', { query, error, durationMs: Date.now() - startTime });
            throw error;
        }
    }

    getRegisteredCommands(): string[] {
        return Array.from(this.commandHandlers.keys());
    }

    getRegisteredQueries(): string[] {
        return Array.from(this.queryHandlers.keys());
    }
}

export const cqrsBus = new CQRSBus();

// ============================================================================
// Task 58: Projection Rebuilding
// ============================================================================

interface Projection {
    name: string;
    version: number;
    build: (events: DomainEvent[]) => Promise<void>;
    eventTypes: string[];
}

class ProjectionManager {
    private projections: Map<string, Projection> = new Map();
    private projectionVersions: Map<string, number> = new Map();

    register(projection: Projection): void {
        this.projections.set(projection.name, projection);
        Logger.info(`[Projections] Registered projection: ${projection.name} v${projection.version}`);
    }

    async rebuild(projectionName: string): Promise<{ eventsProcessed: number; durationMs: number }> {
        const projection = this.projections.get(projectionName);
        if (!projection) {
            throw new Error(`Projection ${projectionName} not found`);
        }

        const startTime = Date.now();
        Logger.info(`[Projections] Rebuilding ${projectionName}...`);

        const events = await eventSourcing.getStore().getAllEvents(projection.eventTypes);
        await projection.build(events);

        this.projectionVersions.set(projectionName, projection.version);

        const durationMs = Date.now() - startTime;
        Logger.info(`[Projections] Rebuilt ${projectionName} (${events.length} events in ${durationMs}ms)`);

        return { eventsProcessed: events.length, durationMs };
    }

    async rebuildAll(): Promise<Record<string, { eventsProcessed: number; durationMs: number }>> {
        const results: Record<string, { eventsProcessed: number; durationMs: number }> = {};

        for (const name of this.projections.keys()) {
            results[name] = await this.rebuild(name);
        }

        return results;
    }

    needsRebuild(projectionName: string): boolean {
        const projection = this.projections.get(projectionName);
        if (!projection) return false;

        const storedVersion = this.projectionVersions.get(projectionName) ?? 0;
        return storedVersion < projection.version;
    }
}

export const projectionManager = new ProjectionManager();

// ============================================================================
// Task 54: Distributed Transactions (Saga Pattern)
// ============================================================================

interface SagaStep {
    name: string;
    execute: () => Promise<any>;
    compensate: () => Promise<void>;
}

interface SagaResult {
    success: boolean;
    completedSteps: string[];
    failedStep?: string;
    error?: string;
}

class SagaOrchestrator {
    private sagas: Map<string, SagaStep[]> = new Map();

    /**
     * Define a saga with its steps
     */
    define(sagaName: string, steps: SagaStep[]): void {
        this.sagas.set(sagaName, steps);
        Logger.debug(`[Saga] Defined saga: ${sagaName} (${steps.length} steps)`);
    }

    /**
     * Execute a saga with automatic compensation on failure
     */
    async execute(sagaName: string, context?: Record<string, any>): Promise<SagaResult> {
        const steps = this.sagas.get(sagaName);
        if (!steps) {
            throw new Error(`Saga ${sagaName} not found`);
        }

        const completedSteps: SagaStep[] = [];
        const startTime = Date.now();

        Logger.info(`[Saga] Starting ${sagaName}`);

        for (const step of steps) {
            try {
                Logger.debug(`[Saga] Executing step: ${step.name}`);
                await step.execute();
                completedSteps.push(step);
            } catch (error: any) {
                Logger.error(`[Saga] Step ${step.name} failed: ${error.message}`);

                // Compensate in reverse order
                await this.compensate(completedSteps.reverse());

                return {
                    success: false,
                    completedSteps: completedSteps.map(s => s.name),
                    failedStep: step.name,
                    error: error.message,
                };
            }
        }

        Logger.info(`[Saga] ${sagaName} completed in ${Date.now() - startTime}ms`);

        return {
            success: true,
            completedSteps: completedSteps.map(s => s.name),
        };
    }

    private async compensate(steps: SagaStep[]): Promise<void> {
        Logger.info(`[Saga] Compensating ${steps.length} steps`);

        for (const step of steps) {
            try {
                Logger.debug(`[Saga] Compensating step: ${step.name}`);
                await step.compensate();
            } catch (error: any) {
                Logger.error(`[Saga] Compensation failed for ${step.name}: ${error.message}`);
                // Continue compensating other steps
            }
        }
    }
}

export const sagaOrchestrator = new SagaOrchestrator();

// ============================================================================
// Task 55: Outbox Pattern for Events
// ============================================================================

interface OutboxMessage {
    id: string;
    aggregateId: string;
    aggregateType: string;
    eventType: string;
    payload: string; // JSON string
    createdAt: Date;
    processedAt: Date | null;
    retries: number;
}

class OutboxProcessor {
    private messages: OutboxMessage[] = [];
    private processingInterval: NodeJS.Timeout | null = null;
    private handlers: Map<string, (msg: OutboxMessage) => Promise<void>> = new Map();

    /**
     * Add a message to the outbox (called within the same transaction as the write)
     */
    add(params: {
        aggregateId: string;
        aggregateType: string;
        eventType: string;
        payload: Record<string, any>;
    }): string {
        const message: OutboxMessage = {
            id: crypto.randomUUID(),
            aggregateId: params.aggregateId,
            aggregateType: params.aggregateType,
            eventType: params.eventType,
            payload: JSON.stringify(params.payload),
            createdAt: new Date(),
            processedAt: null,
            retries: 0,
        };

        this.messages.push(message);
        return message.id;
    }

    /**
     * Register a handler for outbox messages
     */
    registerHandler(eventType: string, handler: (msg: OutboxMessage) => Promise<void>): void {
        this.handlers.set(eventType, handler);
    }

    /**
     * Start processing outbox messages
     */
    startProcessing(intervalMs: number = 1000): void {
        if (this.processingInterval) return;

        this.processingInterval = setInterval(() => this.processMessages(), intervalMs);
        this.processingInterval.unref();
        Logger.info('[Outbox] Started processing');
    }

    stopProcessing(): void {
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }
    }

    private async processMessages(): Promise<void> {
        const unprocessed = this.messages.filter(m => !m.processedAt && m.retries < 5);

        for (const message of unprocessed) {
            const handler = this.handlers.get(message.eventType);
            if (!handler) continue;

            try {
                await handler(message);
                message.processedAt = new Date();
                Logger.debug(`[Outbox] Processed message ${message.id}`);
            } catch (error: any) {
                message.retries++;
                Logger.warn(`[Outbox] Failed to process ${message.id} (retry ${message.retries}): ${error.message}`);
            }
        }
    }

    getStats(): { pending: number; processed: number; failed: number } {
        return {
            pending: this.messages.filter(m => !m.processedAt && m.retries < 5).length,
            processed: this.messages.filter(m => m.processedAt).length,
            failed: this.messages.filter(m => m.retries >= 5).length,
        };
    }
}

export const outboxProcessor = new OutboxProcessor();

// ============================================================================
// Task 59: Snapshot Strategy for Event Stores
// ============================================================================

interface Snapshot<T> {
    aggregateId: string;
    version: number;
    state: T;
    createdAt: Date;
}

class SnapshotStore<T> {
    private snapshots: Map<string, Snapshot<T>> = new Map();
    private snapshotInterval: number;

    constructor(snapshotInterval: number = 100) {
        this.snapshotInterval = snapshotInterval;
    }

    /**
     * Save a snapshot
     */
    save(aggregateId: string, version: number, state: T): void {
        this.snapshots.set(aggregateId, {
            aggregateId,
            version,
            state,
            createdAt: new Date(),
        });
        Logger.debug(`[Snapshot] Saved snapshot for ${aggregateId} at version ${version}`);
    }

    /**
     * Get the latest snapshot for an aggregate
     */
    get(aggregateId: string): Snapshot<T> | null {
        return this.snapshots.get(aggregateId) ?? null;
    }

    /**
     * Check if a snapshot should be taken
     */
    shouldSnapshot(currentVersion: number, lastSnapshotVersion: number = 0): boolean {
        return currentVersion - lastSnapshotVersion >= this.snapshotInterval;
    }

    /**
     * Rebuild state using snapshot + events
     */
    async rebuildState(
        aggregateId: string,
        reducer: (state: T, event: DomainEvent) => T,
        initialState: T
    ): Promise<{ state: T; version: number }> {
        const snapshot = this.get(aggregateId);
        let state = snapshot?.state ?? initialState;
        let fromVersion = snapshot?.version ?? 0;

        const events = await eventSourcing.getStore().getEvents(aggregateId, fromVersion + 1);

        for (const event of events) {
            state = reducer(state, event);
        }

        const finalVersion = events.length > 0
            ? events[events.length - 1].metadata.version
            : fromVersion;

        // Take a new snapshot if needed
        if (this.shouldSnapshot(finalVersion, fromVersion)) {
            this.save(aggregateId, finalVersion, state);
        }

        return { state, version: finalVersion };
    }
}

export function createSnapshotStore<T>(interval?: number): SnapshotStore<T> {
    return new SnapshotStore<T>(interval);
}

// ============================================================================
// Exports
// ============================================================================

export {
    InMemoryEventStore,
    EventSourcing,
    CQRSBus,
    ProjectionManager,
    SagaOrchestrator,
    OutboxProcessor,
    SnapshotStore,
};

export type {
    DomainEvent,
    EventStore,
    Command,
    Query,
    CommandHandler,
    QueryHandler,
    Projection,
    SagaStep,
    SagaResult,
    OutboxMessage,
    Snapshot,
};
