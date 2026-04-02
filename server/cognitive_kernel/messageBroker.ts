import * as zmq from 'zeromq';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';

export class MessageBroker {
    private router: zmq.Router;
    private dealer: zmq.Dealer;
    private redis: Redis;

    constructor(redisUrl: string = 'redis://127.0.0.1:6379') {
        this.router = new zmq.Router();
        this.dealer = new zmq.Dealer();
        this.redis = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => Math.min(times * 50, 2000)
        });

        this.redis.on('error', (err) => {
            console.warn('[MessageBroker] Redis connection error (is Redis running?):', err.message);
        });
    }

    public async initialize(routerPort: number = 5555, dealerPort: number = 5556): Promise<void> {
        try {
            await this.router.bind(`tcp://127.0.0.1:${routerPort}`);
            console.log(`[MessageBroker] ZeroMQ ROUTER bound to port ${routerPort}`);

            await this.dealer.bind(`tcp://127.0.0.1:${dealerPort}`);
            console.log(`[MessageBroker] ZeroMQ DEALER bound to port ${dealerPort}`);

            this.startRouterLoop();
            this.startConsumerGroupSetup();
        } catch (e) {
            console.error('[MessageBroker] Initialization failed:', e);
        }
    }

    private async startRouterLoop() {
        console.log('[MessageBroker] Starting ROUTER event loop...');
        try {
            for await (const [sender, empty, msg] of this.router) {
                // Echo back for now or route to DEALER
                console.log(`[MessageBroker ZMQ] Received from ${sender.toString('hex')}: ${msg.toString()}`);
                await this.router.send([sender, '', Buffer.from(`ACK: ${msg.toString()}`)]);
            }
        } catch (e) {
            console.error('[MessageBroker] Router loop error:', e);
        }
    }

    private async startConsumerGroupSetup() {
        const streamKey = 'tenaga:events';
        const groupName = 'tenaga_cg';
        try {
            await this.redis.xgroup('CREATE', streamKey, groupName, '$', 'MKSTREAM');
            console.log(`[MessageBroker Redis] Consumer group ${groupName} ready on stream ${streamKey}`);
        } catch (e: any) {
            if (!e.message.includes('BUSYGROUP')) {
                console.warn('[MessageBroker Redis] Consumer group setup error:', e.message);
            }
        }
    }

    public async publishRedisEvent(payload: Record<string, any>) {
        const streamKey = 'tenaga:events';
        try {
            const flattenedBase = Object.entries(payload).flat();
            const stringified = flattenedBase.map(item => typeof item === 'object' ? JSON.stringify(item) : String(item));

            const id = await this.redis.xadd(streamKey, '*', 'timestamp', Date.now().toString(), 'payload', JSON.stringify(payload));
            return id;
        } catch (e: any) {
            console.warn('[MessageBroker Redis] Failed to publish event:', e.message);
            return null;
        }
    }

    public async close() {
        this.router.close();
        this.dealer.close();
        this.redis.disconnect();
        console.log('[MessageBroker] Connections closed.');
    }
}

export const globalBroker = new MessageBroker();
