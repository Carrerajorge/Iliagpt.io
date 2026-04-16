export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

interface Window {
  count: number;
  resetAt: number;
}

class ToolRateLimiter {
  private windows = new Map<string, Window>();
  private limits: Record<string, { maxPerMinute: number }> = {
    openclaw_exec: { maxPerMinute: 30 },
    openclaw_write: { maxPerMinute: 60 },
    default: { maxPerMinute: 120 },
  };

  private getLimit(toolId: string): number {
    return (this.limits[toolId] || this.limits.default).maxPerMinute;
  }

  private getKey(toolId: string, userId: string): string {
    return `${toolId}:${userId}`;
  }

  private getOrCreateWindow(key: string): Window {
    const now = Date.now();
    let window = this.windows.get(key);
    if (!window || now >= window.resetAt) {
      window = { count: 0, resetAt: now + 60_000 };
      this.windows.set(key, window);
    }
    return window;
  }

  check(toolId: string, userId: string): RateLimitResult {
    const key = this.getKey(toolId, userId);
    const window = this.getOrCreateWindow(key);
    const max = this.getLimit(toolId);
    const remaining = Math.max(0, max - window.count);
    const resetIn = Math.max(0, window.resetAt - Date.now());
    return { allowed: remaining > 0, remaining, resetIn };
  }

  consume(toolId: string, userId: string): boolean {
    const key = this.getKey(toolId, userId);
    const window = this.getOrCreateWindow(key);
    const max = this.getLimit(toolId);
    if (window.count >= max) {
      return false;
    }
    window.count++;
    return true;
  }
}

export const toolRateLimiter = new ToolRateLimiter();
