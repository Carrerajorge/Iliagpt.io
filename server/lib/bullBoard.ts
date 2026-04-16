let createBullBoard: any, BullMQAdapter: any, ExpressAdapter: any;
try {
  createBullBoard = require('@bull-board/api').createBullBoard;
  BullMQAdapter = require('@bull-board/api/bullMQAdapter').BullMQAdapter;
  ExpressAdapter = require('@bull-board/express').ExpressAdapter;
} catch {}
import { queues, createQueue, QUEUE_NAMES } from './queueFactory';

export function setupBullBoard() {
    if (!ExpressAdapter) {
        console.warn('[BullBoard] @bull-board not available, skipping setup');
        return null;
    }
    try {
        const serverAdapter = new ExpressAdapter();
        serverAdapter.setBasePath('/api/admin/queues');

        if (!queues.has(QUEUE_NAMES.PROCESSING)) {
            createQueue(QUEUE_NAMES.PROCESSING);
        }
        if (!queues.has(QUEUE_NAMES.WEBHOOK_NOTIFICATION)) {
            createQueue(QUEUE_NAMES.WEBHOOK_NOTIFICATION);
        }

        const boardQueues = Array.from(queues.values())
            .filter(Boolean)
            .map(q => new BullMQAdapter(q));

        createBullBoard({
            queues: boardQueues,
            serverAdapter,
        });

        return serverAdapter;
    } catch (error: any) {
        console.warn('[BullBoard] Failed to initialize, skipping setup', {
            errorMessage: error?.message ?? String(error),
            errorName: error?.name ?? 'UnknownError',
        });
        return null;
    }
}
