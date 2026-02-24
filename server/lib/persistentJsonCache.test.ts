import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs/promises before importing the module
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockRename = vi.fn();
const mockUnlink = vi.fn();
const mockMkdir = vi.fn();

vi.mock("fs/promises", () => ({
  readFile: (...args: any[]) => mockReadFile(...args),
  writeFile: (...args: any[]) => mockWriteFile(...args),
  rename: (...args: any[]) => mockRename(...args),
  unlink: (...args: any[]) => mockUnlink(...args),
  mkdir: (...args: any[]) => mockMkdir(...args),
}));

import {
  persistentJsonCacheGet,
  persistentJsonCacheSet,
} from "./persistentJsonCache";

describe("persistentJsonCacheGet", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.ACADEMIC_CACHE_DISABLED;
    delete process.env.ACADEMIC_CACHE_DIR;
    delete process.env.ACADEMIC_CACHE_TTL_MS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return null when cache is disabled", async () => {
    process.env.ACADEMIC_CACHE_DISABLED = "true";
    const result = await persistentJsonCacheGet("test-ns", "key1");
    expect(result).toBeNull();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("should return null when cache is disabled via '1'", async () => {
    process.env.ACADEMIC_CACHE_DISABLED = "1";
    const result = await persistentJsonCacheGet("ns", "key");
    expect(result).toBeNull();
  });

  it("should return null when cache is disabled via 'YES' (case insensitive)", async () => {
    process.env.ACADEMIC_CACHE_DISABLED = "YES";
    const result = await persistentJsonCacheGet("ns", "key");
    expect(result).toBeNull();
  });

  it("should return cached value when entry is valid and not expired", async () => {
    const envelope = {
      key: "my-key",
      createdAt: Date.now() - 1000,
      expiresAt: Date.now() + 60_000,
      value: { data: "hello" },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(envelope));

    const result = await persistentJsonCacheGet<{ data: string }>("ns", "my-key");
    expect(result).toEqual({ data: "hello" });
  });

  it("should return null and unlink when entry is expired", async () => {
    const envelope = {
      key: "expired-key",
      createdAt: Date.now() - 100_000,
      expiresAt: Date.now() - 1000, // expired
      value: "stale",
    };
    mockReadFile.mockResolvedValue(JSON.stringify(envelope));
    mockUnlink.mockResolvedValue(undefined);

    const result = await persistentJsonCacheGet("ns", "expired-key");
    expect(result).toBeNull();
    expect(mockUnlink).toHaveBeenCalled();
  });

  it("should return null when file does not exist (read throws)", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    const result = await persistentJsonCacheGet("ns", "missing");
    expect(result).toBeNull();
  });

  it("should return null when JSON is malformed", async () => {
    mockReadFile.mockResolvedValue("not valid json {{{");

    const result = await persistentJsonCacheGet("ns", "bad-json");
    expect(result).toBeNull();
  });

  it("should return null when envelope has no expiresAt field", async () => {
    const badEnvelope = { key: "k", createdAt: 0, value: "data" };
    mockReadFile.mockResolvedValue(JSON.stringify(badEnvelope));

    const result = await persistentJsonCacheGet("ns", "k");
    expect(result).toBeNull();
  });

  it("should return null when value is undefined (envelope.value is missing)", async () => {
    const envelope = {
      key: "k",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      // value is missing
    };
    mockReadFile.mockResolvedValue(JSON.stringify(envelope));

    const result = await persistentJsonCacheGet("ns", "k");
    expect(result).toBeNull();
  });

  it("should handle string values correctly", async () => {
    const envelope = {
      key: "str",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      value: "just-a-string",
    };
    mockReadFile.mockResolvedValue(JSON.stringify(envelope));

    const result = await persistentJsonCacheGet<string>("ns", "str");
    expect(result).toBe("just-a-string");
  });

  it("should handle numeric values correctly", async () => {
    const envelope = {
      key: "num",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      value: 42,
    };
    mockReadFile.mockResolvedValue(JSON.stringify(envelope));

    const result = await persistentJsonCacheGet<number>("ns", "num");
    expect(result).toBe(42);
  });
});

describe("persistentJsonCacheSet", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.ACADEMIC_CACHE_DISABLED;
    delete process.env.ACADEMIC_CACHE_DIR;
    delete process.env.ACADEMIC_CACHE_TTL_MS;
    delete process.env.ACADEMIC_CACHE_DEBUG;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should not write when cache is disabled", async () => {
    process.env.ACADEMIC_CACHE_DISABLED = "true";
    await persistentJsonCacheSet("ns", "key", { data: 1 });
    expect(mockMkdir).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("should create directory and write file atomically", async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);

    await persistentJsonCacheSet("ns", "my-key", { value: "test" });

    expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockRename).toHaveBeenCalledTimes(1);
  });

  it("should fall back to direct write when rename fails", async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockRejectedValue(new Error("EXDEV"));
    mockUnlink.mockResolvedValue(undefined);

    await persistentJsonCacheSet("ns", "key", "value");

    // First writeFile for tmp, then fallback writeFile for direct
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
  });

  it("should silently swallow errors during write", async () => {
    mockMkdir.mockRejectedValue(new Error("ENOSPC"));

    // Should not throw
    await expect(
      persistentJsonCacheSet("ns", "key", "data")
    ).resolves.toBeUndefined();
  });

  it("should log warning when ACADEMIC_CACHE_DEBUG is enabled and write fails", async () => {
    process.env.ACADEMIC_CACHE_DEBUG = "true";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
    mockMkdir.mockRejectedValue(new Error("disk full"));

    await persistentJsonCacheSet("ns", "key", "data");

    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain("[persistentJsonCache]");
    warnSpy.mockRestore();
  });

  it("should not log when ACADEMIC_CACHE_DEBUG is not enabled and write fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
    mockMkdir.mockRejectedValue(new Error("disk full"));

    await persistentJsonCacheSet("ns", "key", "data");

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("should enforce minimum TTL of 1000ms", async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);

    await persistentJsonCacheSet("ns", "key", "value", 50); // very small TTL

    const writeCall = mockWriteFile.mock.calls[0];
    const payload = JSON.parse(writeCall[1] as string);
    // expiresAt should be at least createdAt + 1000
    expect(payload.expiresAt - payload.createdAt).toBeGreaterThanOrEqual(1000);
  });

  it("should use custom TTL from environment variable", async () => {
    process.env.ACADEMIC_CACHE_TTL_MS = "5000";
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);

    await persistentJsonCacheSet("ns", "key", "value");

    const writeCall = mockWriteFile.mock.calls[0];
    const payload = JSON.parse(writeCall[1] as string);
    // TTL should be ~5000 (env var), within a reasonable margin
    const ttl = payload.expiresAt - payload.createdAt;
    expect(ttl).toBeGreaterThanOrEqual(5000);
    expect(ttl).toBeLessThan(10_000);
  });

  it("should use custom cache directory from environment variable", async () => {
    process.env.ACADEMIC_CACHE_DIR = "/tmp/test-cache-dir";
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);

    await persistentJsonCacheSet("ns", "key", "value");

    const mkdirCall = mockMkdir.mock.calls[0][0] as string;
    expect(mkdirCall).toContain("/tmp/test-cache-dir");
  });

  it("should sanitize namespace with special characters", async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);

    await persistentJsonCacheSet("ns/with spaces!@#", "key", "value");

    const mkdirCall = mockMkdir.mock.calls[0][0] as string;
    const finalDir = mkdirCall.split(/[/\\]/).pop() || "";
    // Special characters should be replaced with underscores
    expect(finalDir).not.toContain(" ");
    expect(finalDir).not.toContain("!");
    expect(finalDir).not.toContain("@");
    expect(finalDir).not.toContain("#");
  });
});
