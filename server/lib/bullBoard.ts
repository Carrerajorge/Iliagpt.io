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
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/api/admin/queues');

    if (!queues.has(QUEUE_NAMES.PROCESSING)) {
        createQueue(QUEUE_NAMES.PROCESSING);
    }

    const boardQueues = Array.from(queues.values())
        .filter(Boolean)
        .map(q => new BullMQAdapter(q));

    createBullBoard({
        queues: boardQueues,
        serverAdapter,
    });

    return serverAdapter;
}
