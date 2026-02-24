import cron from 'node-cron';
import chokidar from 'chokidar';
import { EventEmitter } from 'events';
import { createLogger } from '../lib/structuredLogger';

const logger = createLogger('action-trigger-daemon');

export type TriggerType = 'cron' | 'file' | 'webhook';

export interface BaseTriggerConfig {
    id: string;
    type: TriggerType;
    isActive: boolean;
}

export interface CronTriggerConfig extends BaseTriggerConfig {
    type: 'cron';
    cronExpression: string; // e.g. "0 * * * *" for hourly
}

export interface FileTriggerConfig extends BaseTriggerConfig {
    type: 'file';
    watchPath: string;
    events: ('add' | 'change' | 'unlink')[];
}

export interface WebhookTriggerConfig extends BaseTriggerConfig {
    type: 'webhook';
    hookId: string;
}

export type TriggerConfig = CronTriggerConfig | FileTriggerConfig | WebhookTriggerConfig;

export class ActionTriggerDaemon extends EventEmitter {
    private cronTasks: Map<string, cron.ScheduledTask> = new Map();
    private fileWatchers: Map<string, chokidar.FSWatcher> = new Map();
    private triggers: Map<string, TriggerConfig> = new Map();
    private isRunning: boolean = false;

    constructor() {
        super();
    }

    /**
     * Start the daemon and initialize any pre-existing triggers if fetched from a DB
     */
    async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info('ActionTriggerDaemon started.');
    }

    /**
     * Stop the daemon, clear all memory intervals and watchers
     */
    async stop(): Promise<void> {
        this.isRunning = false;

        // Stop all cron tasks
        for (const [id, task] of this.cronTasks.entries()) {
            task.stop();
        }
        this.cronTasks.clear();

        // Stop all file watchers
        for (const [id, watcher] of this.fileWatchers.entries()) {
            await watcher.close();
        }
        this.fileWatchers.clear();

        logger.info('ActionTriggerDaemon stopped and cleaned up.');
    }

    /**
     * Register a new trigger
     */
    addTrigger(config: TriggerConfig): void {
        if (!this.isRunning) {
            logger.warn(`Cannot add trigger ${config.id}, daemon is not running.`);
            return;
        }

        this.triggers.set(config.id, config);

        if (!config.isActive) return;

        if (config.type === 'cron') {
            this.setupCronTrigger(config);
        } else if (config.type === 'file') {
            this.setupFileTrigger(config);
        } else if (config.type === 'webhook') {
            this.setupWebhookTrigger(config);
        }
    }

    /**
     * Remove an existing trigger
     */
    removeTrigger(id: string): void {
        const config = this.triggers.get(id);
        if (!config) return;

        if (config.type === 'cron' && this.cronTasks.has(id)) {
            const task = this.cronTasks.get(id);
            task?.stop();
            this.cronTasks.delete(id);
        } else if (config.type === 'file' && this.fileWatchers.has(id)) {
            const watcher = this.fileWatchers.get(id);
            watcher?.close();
            this.fileWatchers.delete(id);
        }
        // Webhooks don't hold active persistent streams in this class, they just listen via Express

        this.triggers.delete(id);
        logger.info(`Removed trigger: ${id}`);
    }

    private setupCronTrigger(config: CronTriggerConfig): void {
        const isValid = cron.validate(config.cronExpression);
        if (!isValid) {
            logger.error(`Invalid cron expression for trigger ${config.id}: ${config.cronExpression}`);
            return;
        }

        const task = cron.schedule(config.cronExpression, () => {
            logger.info(`Cron trigger executed: ${config.id}`);
            this.emit('trigger:fired', { triggerId: config.id, type: 'cron', timestamp: new Date() });
        });

        this.cronTasks.set(config.id, task);
        logger.info(`Registered cron trigger: ${config.id} (${config.cronExpression})`);
    }

    private setupFileTrigger(config: FileTriggerConfig): void {
        // Use chokidar to watch the specific directory or file
        const watcher = chokidar.watch(config.watchPath, {
            persistent: true,
            ignoreInitial: true
        });

        config.events.forEach(eventName => {
            if (['add', 'change', 'unlink'].includes(eventName)) {
                watcher.on(eventName, (path) => {
                    logger.info(`File trigger executed: ${config.id} - Event: ${eventName} on ${path}`);
                    this.emit('trigger:fired', {
                        triggerId: config.id,
                        type: 'file',
                        event: eventName,
                        path,
                        timestamp: new Date()
                    });
                });
            }
        });

        watcher.on('error', error => logger.error(`File watcher error for trigger ${config.id}:`, { error }));

        this.fileWatchers.set(config.id, watcher);
        logger.info(`Registered file trigger: ${config.id} watching ${config.watchPath}`);
    }

    private setupWebhookTrigger(config: WebhookTriggerConfig): void {
        // Webhooks act as passive receivers. 
        // When a POST reaches /api/webhooks/:hookId, the route handler calls handleWebhook(hookId, payload).
        logger.info(`Registered webhook trigger routing: ${config.id} for hookId ${config.hookId}`);
    }

    /**
     * Externally call this when a webhook is hit via Express
     */
    handleWebhook(hookId: string, payload: any): void {
        // Find triggers matching this hookId
        for (const [id, config] of this.triggers.entries()) {
            if (config.type === 'webhook' && config.hookId === hookId && config.isActive) {
                logger.info(`Webhook trigger executed: ${config.id}`);
                this.emit('trigger:fired', {
                    triggerId: config.id,
                    type: 'webhook',
                    payload,
                    timestamp: new Date()
                });
            }
        }
    }
}

export const actionTriggerDaemon = new ActionTriggerDaemon();
