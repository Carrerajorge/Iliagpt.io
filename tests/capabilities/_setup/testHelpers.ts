/**
 * Test Helpers - Shared utilities for capability test suites.
 * Provides temp-dir management, file fixtures, mock HTTP, mock DB,
 * mock agents, async wait helpers, stream utilities, and assertion helpers.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Temp directory management
// ---------------------------------------------------------------------------

/**
 * Creates a unique temporary directory under the OS temp folder and returns its path.
 * Call `cleanupTempDir(dir)` when done, or use `withTempDir` for automatic cleanup.
 */
export async function createTempDir(prefix = "iliagpt-test-"): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * Recursively removes a temp directory created by `createTempDir`.
 * Silently ignores errors (e.g. directory already removed).
 */
export async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors in tests
  }
}

/**
 * Convenience wrapper: creates a temp dir, runs `fn(dir)`, then cleans up.
 * Cleanup runs even if `fn` throws.
 */
export async function withTempDir(
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await createTempDir();
  try {
    await fn(dir);
  } finally {
    await cleanupTempDir(dir);
  }
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

/**
 * Writes `content` to `filePath`, creating intermediate directories as needed.
 * Returns the absolute path to the created file.
 */
export async function createTestFile(
  filePath: string,
  content: string | Buffer,
): Promise<string> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  if (typeof content === "string") {
    await fs.promises.writeFile(filePath, content, "utf-8");
  } else {
    await fs.promises.writeFile(filePath, content);
  }
  return filePath;
}

/**
 * Creates multiple files under `dir` from a `{ relativePath: content }` map.
 * Returns a `{ relativePath: absolutePath }` map.
 *
 * @example
 * const paths = await createTestFiles(dir, {
 *   "report.txt": "Hello world",
 *   "data/sales.csv": "name,amount\nAlice,100",
 * });
 */
export async function createTestFiles(
  dir: string,
  files: Record<string, string>,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  await Promise.all(
    Object.entries(files).map(async ([rel, content]) => {
      const abs = path.join(dir, rel);
      await createTestFile(abs, content);
      result[rel] = abs;
    }),
  );
  return result;
}

/**
 * Reads a file's entire contents as a UTF-8 string.
 */
export async function readTestFile(filePath: string): Promise<string> {
  return fs.promises.readFile(filePath, "utf-8");
}

// ---------------------------------------------------------------------------
// Mock HTTP / fetch
// ---------------------------------------------------------------------------

export interface MockHttpResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

type FetchSpy = ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>;

let _fetchSpy: FetchSpy | null = null;
const _fetchHandlers: Array<{
  matcher: string | RegExp;
  response?: MockHttpResponse;
  error?: Error;
}> = [];

function ensureFetchSpy(): FetchSpy {
  if (!_fetchSpy) {
    _fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
            ? input.toString()
            : (input as Request).url;

        for (const handler of _fetchHandlers) {
          const matched =
            typeof handler.matcher === "string"
              ? url.includes(handler.matcher)
              : handler.matcher.test(url);

          if (matched) {
            if (handler.error) throw handler.error;
            const { status = 200, body = {}, headers = {} } =
              handler.response ?? {};
            const bodyText =
              typeof body === "string" ? body : JSON.stringify(body);
            return new Response(bodyText, {
              status,
              headers: {
                "content-type": "application/json",
                ...headers,
              },
            });
          }
        }

        // No handler matched — return a generic 200
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
  }
  return _fetchSpy;
}

/**
 * Intercepts fetch calls whose URL matches `url` (string substring or RegExp)
 * and responds with the given `MockHttpResponse`.
 *
 * Returns a cleanup function that removes this handler. Call it in `afterEach`.
 */
export function mockFetchResponse(
  url: string | RegExp,
  response: MockHttpResponse,
): () => void {
  ensureFetchSpy();
  const handler = { matcher: url, response };
  _fetchHandlers.push(handler);
  return () => {
    const idx = _fetchHandlers.indexOf(handler);
    if (idx !== -1) _fetchHandlers.splice(idx, 1);
    if (_fetchHandlers.length === 0) {
      _fetchSpy?.mockRestore();
      _fetchSpy = null;
    }
  };
}

/**
 * Intercepts fetch calls whose URL matches `url` and rejects with `error`.
 *
 * Returns a cleanup function that removes this handler.
 */
export function mockFetchError(
  url: string | RegExp,
  error: Error,
): () => void {
  ensureFetchSpy();
  const handler = { matcher: url, error };
  _fetchHandlers.push(handler);
  return () => {
    const idx = _fetchHandlers.indexOf(handler);
    if (idx !== -1) _fetchHandlers.splice(idx, 1);
    if (_fetchHandlers.length === 0) {
      _fetchSpy?.mockRestore();
      _fetchSpy = null;
    }
  };
}

/**
 * Resets all active fetch mocks and restores the original `fetch`.
 * Call this in `afterEach` / `afterAll` if you prefer bulk cleanup.
 */
export function resetFetchMocks(): void {
  _fetchHandlers.length = 0;
  _fetchSpy?.mockRestore();
  _fetchSpy = null;
}

// ---------------------------------------------------------------------------
// MockDatabase
// ---------------------------------------------------------------------------

export interface MockDbRecord {
  id: string;
  [key: string]: unknown;
}

/**
 * A minimal in-memory database stub for tests that need storage-layer simulation.
 * Supports insert, findById, findAll, update, delete, and SQL-like querying.
 */
export class MockDatabase {
  readonly data: Map<string, unknown[]> = new Map();

  private table<T>(name: string): T[] {
    if (!this.data.has(name)) this.data.set(name, []);
    return this.data.get(name) as T[];
  }

  /**
   * Simulate a SQL query against a named table.
   * Extracts table name from "FROM tableName" and optionally filters by the
   * first positional parameter if it is an object.
   */
  async query(sql: string, params?: unknown[]): Promise<unknown[]> {
    const fromMatch = /FROM\s+["'`]?(\w+)["'`]?/i.exec(sql);
    if (!fromMatch) return [];
    const tableName = fromMatch[1];
    const rows = this.table<Record<string, unknown>>(tableName);

    if (!params || params.length === 0) return [...rows];

    const filter = params[0];
    if (filter && typeof filter === "object" && !Array.isArray(filter)) {
      const f = filter as Record<string, unknown>;
      return rows.filter((row) =>
        Object.entries(f).every(([k, v]) => row[k] === v),
      );
    }

    return [...rows];
  }

  /**
   * Insert a row into the given table.
   */
  async insert(table: string, row: unknown): Promise<void> {
    this.table(table).push(row);
  }

  /**
   * Find a single row by its `id` field.
   */
  findById<T = MockDbRecord>(table: string, id: string): T | undefined {
    return this.table<MockDbRecord>(table).find((r) => r.id === id) as
      | T
      | undefined;
  }

  /**
   * Return all rows from a table, optionally filtered by a predicate.
   */
  findAll<T = MockDbRecord>(
    table: string,
    predicate?: (row: T) => boolean,
  ): T[] {
    const rows = this.table<T>(table);
    return predicate ? rows.filter(predicate) : [...rows];
  }

  /**
   * Update an existing row (identified by `id`) with the given patch.
   */
  update<T extends MockDbRecord>(
    table: string,
    id: string,
    patch: Partial<T>,
  ): T | undefined {
    const rows = this.table<T>(table);
    const idx = rows.findIndex((r) => (r as MockDbRecord).id === id);
    if (idx === -1) return undefined;
    rows[idx] = { ...rows[idx], ...patch } as T;
    return rows[idx];
  }

  /**
   * Delete a row by `id`. Returns true if a row was removed.
   */
  delete(table: string, id: string): boolean {
    const rows = this.table<MockDbRecord>(table);
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    rows.splice(idx, 1);
    return true;
  }

  /** Remove all records from all tables. */
  clear(): void {
    this.data.clear();
  }

  /** Row count for a given table. */
  count(table: string): number {
    return this.table(table).length;
  }
}

// ---------------------------------------------------------------------------
// Mock agent / capability registry
// ---------------------------------------------------------------------------

export interface MockAgentConfig {
  defaultResult: Record<string, unknown>;
  streamChunks: Array<{ type: string; content?: string; result?: unknown }>;
}

export interface MockAgentCallRecord {
  capability: string;
  input: Record<string, unknown>;
  timestamp: number;
}

export interface MockAgent {
  invoke: ReturnType<typeof vi.fn>;
  stream: ReturnType<typeof vi.fn>;
  calls: MockAgentCallRecord[];
  reset: () => void;
}

/**
 * Creates a fully mocked agent with `invoke` and `stream` spies.
 */
export function createMockAgent(
  overrides?: Partial<MockAgentConfig>,
): MockAgent {
  const config: MockAgentConfig = {
    defaultResult: { success: true, result: null },
    streamChunks: [
      { type: "chunk", content: "mock stream chunk" },
      { type: "done", result: null },
    ],
    ...overrides,
  };

  const calls: MockAgentCallRecord[] = [];

  const invokeFn = vi.fn(
    async (capability: string, input: Record<string, unknown>) => {
      calls.push({ capability, input, timestamp: Date.now() });
      return { ...config.defaultResult };
    },
  );

  const streamFn = vi.fn(async function* (
    capability: string,
    input: Record<string, unknown>,
  ) {
    calls.push({ capability, input, timestamp: Date.now() });
    for (const chunk of config.streamChunks) {
      yield chunk;
    }
  });

  return {
    invoke: invokeFn,
    stream: streamFn,
    calls,
    reset: () => {
      calls.length = 0;
      invokeFn.mockClear();
      streamFn.mockClear();
    },
  };
}

export interface MockCapabilityRegistry {
  capabilities: Map<
    string,
    { available: boolean; handler: ReturnType<typeof vi.fn> }
  >;
  register(name: string, handler?: () => unknown): void;
  get(name: string): ReturnType<typeof vi.fn> | undefined;
  isAvailable(name: string): boolean;
  reset(): void;
}

/**
 * Creates an in-memory capability registry stub.
 */
export function createMockCapabilityRegistry(): MockCapabilityRegistry {
  const capabilities: MockCapabilityRegistry["capabilities"] = new Map();

  return {
    capabilities,

    register(name: string, handler?: () => unknown): void {
      capabilities.set(name, {
        available: true,
        handler: vi.fn(handler ?? (() => ({ success: true }))),
      });
    },

    get(name: string) {
      return capabilities.get(name)?.handler;
    },

    isAvailable(name: string): boolean {
      return capabilities.get(name)?.available ?? false;
    },

    reset(): void {
      capabilities.forEach((cap) => cap.handler.mockClear());
    },
  };
}

// ---------------------------------------------------------------------------
// Async utilities
// ---------------------------------------------------------------------------

/**
 * Polls `condition` every `interval` ms until it returns true or `timeout` elapses.
 * Throws with a descriptive message if the timeout is reached.
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5_000,
  interval = 50,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(
    `waitFor: condition was not met within ${timeout}ms (checked every ${interval}ms)`,
  );
}

/**
 * Retries `fn` up to `retries` times with a `delay` ms pause between attempts.
 * Succeeds on the first attempt that does not throw. Throws the last error if all fail.
 */
export async function eventually(
  fn: () => Promise<void>,
  options: { retries?: number; delay?: number } = {},
): Promise<void> {
  const { retries = 3, delay = 100 } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Stream helpers
// ---------------------------------------------------------------------------

/**
 * Creates a ReadableStream that emits each string in `messages` as a UTF-8
 * SSE-formatted chunk, then closes.
 */
export function createMockSSEStream(
  messages: string[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let idx = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (idx >= messages.length) {
        controller.close();
        return;
      }
      const msg = messages[idx++];
      controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
    },
  });
}

/**
 * Collects all text chunks from a ReadableStream into a string array.
 */
export async function collectStream(
  stream: ReadableStream<Uint8Array>,
): Promise<string[]> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  const chunks: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }

  return chunks;
}

/**
 * Creates a Node.js EventEmitter that emits `"data"` events for each SSE message
 * and `"end"` when done. Useful for testing SSE consumers.
 */
export function createMockEventStream(
  messages: string[],
  delayMs = 0,
): EventEmitter {
  const emitter = new EventEmitter();

  async function emit() {
    for (const msg of messages) {
      if (delayMs > 0) {
        await new Promise<void>((r) => setTimeout(r, delayMs));
      }
      emitter.emit("data", `data: ${msg}\n\n`);
    }
    emitter.emit("end");
  }

  process.nextTick(() => void emit());
  return emitter;
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Asserts that `obj` has every key present in `shape` with matching values (partial).
 * Pass `undefined` as a value to skip value equality check for that key.
 */
export function assertHasShape<T extends object>(
  obj: unknown,
  shape: Partial<T>,
): asserts obj is T {
  if (obj === null || obj === undefined) {
    throw new Error(`assertHasShape: expected object, got ${obj}`);
  }
  if (typeof obj !== "object") {
    throw new Error(`assertHasShape: expected object, got ${typeof obj}`);
  }

  const record = obj as Record<string, unknown>;
  for (const [key, expected] of Object.entries(
    shape as Record<string, unknown>,
  )) {
    if (!(key in record)) {
      throw new Error(
        `assertHasShape: missing key "${key}". Object keys: [${Object.keys(record).join(", ")}]`,
      );
    }
    if (expected !== undefined) {
      // If the expected value is a JS type name string (e.g. "string", "number",
      // "boolean", "array", "object", "function"), do a type check instead of
      // value equality so callers can write: assertHasShape(obj, { id: "string" })
      const TYPE_SENTINELS = new Set([
        "string",
        "number",
        "boolean",
        "object",
        "function",
        "bigint",
        "symbol",
        "array",
      ]);
      if (typeof expected === "string" && TYPE_SENTINELS.has(expected)) {
        const actualType =
          Array.isArray(record[key]) ? "array" : typeof record[key];
        if (actualType !== expected) {
          throw new Error(
            `assertHasShape: key "${key}" expected type "${expected}", got "${actualType}" (value: ${JSON.stringify(record[key])})`,
          );
        }
      } else if (record[key] !== expected) {
        throw new Error(
          `assertHasShape: key "${key}" expected ${JSON.stringify(expected)}, got ${JSON.stringify(record[key])}`,
        );
      }
    }
  }
}

/**
 * Asserts that `arr` is an array with at least `min` and optionally at most
 * `max` elements.
 */
export function assertArrayHasLength(
  arr: unknown[],
  min: number,
  max?: number,
): void {
  if (!Array.isArray(arr)) {
    throw new Error(
      `assertArrayHasLength: expected array, got ${typeof arr}`,
    );
  }
  if (arr.length < min) {
    throw new Error(
      `assertArrayHasLength: expected at least ${min} element(s), got ${arr.length}`,
    );
  }
  if (max !== undefined && arr.length > max) {
    throw new Error(
      `assertArrayHasLength: expected at most ${max} element(s), got ${arr.length}`,
    );
  }
}

/**
 * Asserts that a promise rejects. Optionally checks the error message against
 * a string substring or RegExp.
 */
export async function assertRejects(
  fn: () => Promise<unknown>,
  msgPattern?: string | RegExp,
): Promise<Error> {
  let thrown: Error | undefined;
  try {
    await fn();
  } catch (err) {
    thrown = err instanceof Error ? err : new Error(String(err));
  }

  if (!thrown) {
    throw new Error("assertRejects: expected function to throw, but it resolved");
  }

  if (msgPattern) {
    const matches =
      typeof msgPattern === "string"
        ? thrown.message.includes(msgPattern)
        : msgPattern.test(thrown.message);

    if (!matches) {
      throw new Error(
        `assertRejects: error message "${thrown.message}" did not match ${msgPattern.toString()}`,
      );
    }
  }

  return thrown;
}

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

/**
 * Temporarily sets environment variables for the duration of `fn`,
 * then restores the originals. Pass `undefined` to unset a variable.
 */
export async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const originals: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(vars)) {
    originals[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await fn();
  } finally {
    for (const [key, original] of Object.entries(originals)) {
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Timer helpers
// ---------------------------------------------------------------------------

/** Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Measures how long `fn` takes to execute.
 * Returns both the result and the elapsed time in milliseconds.
 */
export async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; ms: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Random data factories
// ---------------------------------------------------------------------------

/** Generates a random alphanumeric string of the given length. */
export function randomString(length = 12): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Returns a deterministic test-user object for seeding test data.
 */
export function createTestUser(
  overrides: Partial<{
    id: string;
    email: string;
    name: string;
    tier: "free" | "pro" | "enterprise";
  }> = {},
): { id: string; email: string; name: string; tier: "free" | "pro" | "enterprise" } {
  const suffix = randomString(6).toLowerCase();
  return {
    id: `user_${suffix}`,
    email: `test_${suffix}@example.com`,
    name: `Test User ${suffix}`,
    tier: "free",
    ...overrides,
  };
}
