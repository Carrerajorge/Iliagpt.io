import type { ClientErrorLog } from "../domain/clientErrorLog";
import type { ClientErrorLogStore } from "../application/clientErrorLogStore";

export class InMemoryClientErrorLogStore implements ClientErrorLogStore {
  private logs: ClientErrorLog[] = [];
  private maxLogs: number;

  constructor(options?: { maxLogs?: number }) {
    this.maxLogs = Math.max(1, Math.min(options?.maxLogs ?? 1000, 10_000));
  }

  async append(log: ClientErrorLog): Promise<void> {
    this.logs.unshift(log);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
  }

  async all(): Promise<readonly ClientErrorLog[]> {
    return this.logs;
  }

  async recent(options: { limit: number; componentName?: string }): Promise<readonly ClientErrorLog[]> {
    const rawLimit = Math.max(1, Math.min(options.limit, 200));
    const componentName = options.componentName;
    const source = componentName ? this.logs.filter((e) => e.componentName === componentName) : this.logs;
    return source.slice(0, rawLimit);
  }
}

