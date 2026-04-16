import { nativeDesktop } from '../native';
import { frameDiffer } from './frameDiffer';
import { unifiedEventBus } from '../agent/unifiedEventBus';
import { LRUCache } from 'lru-cache';
import { createHash } from 'crypto';

const CHANGE_THRESHOLD = 0.05; // 5% pixel difference to trigger VLM

export class CaptureLoop {
    private fps: number = 1;
    private running: boolean = false;
    private lastFrame: Buffer | null = null;
    private loopPromise: Promise<void> | null = null;
    private frameCache = new LRUCache<string, boolean>({ max: 50 });

    async start(): Promise<void> {
        if (this.running) return;
        this.running = true;

        // Escuchar el event bus para adaptar los FPS
        unifiedEventBus.subscribe('system.state.*', (e) => {
            if (e.payload.state === 'AGENT_EXECUTING') this.fps = 15;
            else if (e.payload.state === 'USER_ACTIVE') this.fps = 5;
            else this.fps = 1;
        });

        this.loopPromise = this.loop();
    }

    private async loop(): Promise<void> {
        while (this.running) {
            try {
                const frame = await nativeDesktop.screenshot();

                const hash = createHash('sha256').update(frame).digest('hex');
                if (this.frameCache.has(hash)) {
                    // Frame identical to one seen recently, skip diff & VLM
                    await new Promise(resolve => setTimeout(resolve, 1000 / this.fps));
                    continue;
                }
                this.frameCache.set(hash, true);

                const diff = await frameDiffer.calculateDiff(frame, this.lastFrame);

                if (diff > CHANGE_THRESHOLD) {
                    await unifiedEventBus.publish('vision.frame.new', {
                        frame: frame.toString('base64'), // VLM usually expects Base64 encoding for images
                        timestamp: Date.now(),
                        changePercent: diff,
                    });
                    this.lastFrame = frame;
                }
            } catch (e) {
                console.error("CaptureLoop error:", e);
            }
            await new Promise(resolve => setTimeout(resolve, 1000 / this.fps));
        }
    }

    stop(): void {
        this.running = false;
    }
}

export const captureLoop = new CaptureLoop();
