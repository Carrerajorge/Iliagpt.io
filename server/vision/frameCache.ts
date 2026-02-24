// server/vision/frameCache.ts
interface CachedFrame { id: string; timestamp: number; buffer: Buffer; }

export class FrameCache {
    private cache = new Map<string, CachedFrame>();

    set(id: string, frame: CachedFrame) {
        if (this.cache.size > 100) { // Keep last 100 frames
            const oldest = Array.from(this.cache.keys())[0];
            this.cache.delete(oldest);
        }
        this.cache.set(id, frame);
    }
}
export const globalFrameCache = new FrameCache();
