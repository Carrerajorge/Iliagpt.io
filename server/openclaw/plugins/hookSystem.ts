import type { HookPoint, HookHandler, HookContext } from '../types';
import { Logger } from '../../lib/logger';

export class HookSystem {
  private hooks = new Map<HookPoint, HookHandler[]>();

  register(point: HookPoint, handler: HookHandler): void {
    if (!this.hooks.has(point)) {
      this.hooks.set(point, []);
    }
    this.hooks.get(point)!.push(handler);
  }

  unregister(point: HookPoint, handler: HookHandler): void {
    const handlers = this.hooks.get(point);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  }

  async dispatch(point: HookPoint, ctx: Partial<HookContext>): Promise<void> {
    const handlers = this.hooks.get(point);
    if (!handlers || handlers.length === 0) return;

    for (const handler of handlers) {
      try {
        await handler(ctx as HookContext);
      } catch (err: any) {
        Logger.error(`[OpenClaw:Hooks] Hook ${point} handler error: ${err.message}`);
      }
    }
  }

  getRegisteredPoints(): HookPoint[] {
    return Array.from(this.hooks.keys());
  }

  getHandlerCount(point: HookPoint): number {
    return this.hooks.get(point)?.length ?? 0;
  }

  clear(): void {
    this.hooks.clear();
  }
}

// Singleton instance for global use
export const hookSystem = new HookSystem();
