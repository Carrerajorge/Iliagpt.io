import { afterEach, describe, expect, it, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

async function loadDbModule(options?: {
  databaseReadUrl?: string;
  queryImpl?: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;
}) {
  vi.resetModules();

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:5432/iliagpt_test";
  process.env.SESSION_SECRET =
    "test-session-secret-1234567890abcdefghijklmnopqrstuvwxyz";

  if (options?.databaseReadUrl) {
    process.env.DATABASE_READ_URL = options.databaseReadUrl;
  } else {
    delete process.env.DATABASE_READ_URL;
  }

  const queryMock = vi.fn(
    options?.queryImpl ??
      (async (sql: string) => ({
        rows: sql.includes("current_database")
          ? [{ current_database: "iliagpt_test" }]
          : [],
      })),
  );
  const endMock = vi.fn().mockResolvedValue(undefined);
  const instances: unknown[] = [];

  class MockPool {
    totalCount = 1;
    idleCount = 1;
    waitingCount = 0;
    options = { max: 20 };
    query = queryMock;
    end = endMock;
    on = vi.fn();

    constructor(_config: unknown) {
      instances.push(this);
    }
  }

  vi.doMock("pg", () => ({ Pool: MockPool }));
  vi.doMock("drizzle-orm/node-postgres", () => ({
    drizzle: vi.fn(() => ({})),
  }));
  vi.doMock("drizzle-orm/node-postgres/migrator", () => ({
    migrate: vi.fn(),
  }));

  const mod = await import("../db");
  return { ...mod, queryMock, endMock, instances };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.DATABASE_READ_URL;
});

describe("server/db health", () => {
  it("reuses the in-flight health check instead of opening a second query", async () => {
    const pending = deferred<{ rows: Array<Record<string, unknown>> }>();

    const { performHealthCheck, queryMock } = await loadDbModule({
      queryImpl: vi.fn().mockReturnValue(pending.promise),
    });

    const first = performHealthCheck();
    const second = performHealthCheck();

    expect(queryMock).toHaveBeenCalledTimes(1);

    pending.resolve({ rows: [] });

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it("drains both write and read pools when a read replica is configured", async () => {
    const { drainConnections, endMock, instances } = await loadDbModule({
      databaseReadUrl: "postgres://test:test@127.0.0.1:5432/iliagpt_read",
    });

    await drainConnections();

    expect(instances).toHaveLength(2);
    expect(endMock).toHaveBeenCalledTimes(2);
  });
});
