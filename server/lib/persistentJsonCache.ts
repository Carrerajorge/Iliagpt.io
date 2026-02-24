import { createHash } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";

type CacheEnvelope<T> = {
  key: string;
  createdAt: number;
  expiresAt: number;
  value: T;
};

function isCacheEnabled(): boolean {
  return !/^(1|true|yes)$/i.test(process.env.ACADEMIC_CACHE_DISABLED || "");
}

function getCacheDir(): string {
  return (
    process.env.ACADEMIC_CACHE_DIR ||
    path.join(process.cwd(), ".local", "academic-cache")
  );
}

function defaultTtlMs(): number {
  const raw = process.env.ACADEMIC_CACHE_TTL_MS;
  if (!raw) return 1000 * 60 * 60 * 24 * 14; // 14 days
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1000 * 60 * 60 * 24 * 14;
}

function safeNamespace(namespace: string): string {
  return (namespace || "default").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 40);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function cacheFilePath(namespace: string, key: string): string {
  const ns = safeNamespace(namespace);
  const filename = `${hashKey(key)}.json`;
  return path.join(getCacheDir(), ns, filename);
}

export async function persistentJsonCacheGet<T>(
  namespace: string,
  key: string
): Promise<T | null> {
  if (!isCacheEnabled()) return null;

  const file = cacheFilePath(namespace, key);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed || typeof parsed.expiresAt !== "number") return null;

    if (Date.now() > parsed.expiresAt) {
      // Best-effort cleanup
      await fs.unlink(file).catch(() => undefined);
      return null;
    }

    return parsed.value ?? null;
  } catch {
    return null;
  }
}

export async function persistentJsonCacheSet<T>(
  namespace: string,
  key: string,
  value: T,
  ttlMs: number = defaultTtlMs()
): Promise<void> {
  if (!isCacheEnabled()) return;

  // Cache writes must never break the main flow (academic export must keep working even on ENOSPC).
  // Make this best-effort and swallow any fs errors.
  let tmp: string | null = null;
  try {
    const file = cacheFilePath(namespace, key);
    const dir = path.dirname(file);
    await ensureDir(dir);

    const now = Date.now();
    const envelope: CacheEnvelope<T> = {
      key,
      createdAt: now,
      expiresAt: now + Math.max(1000, ttlMs),
      value,
    };

    // Atomic write via rename.
    tmp = `${file}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
    const payload = JSON.stringify(envelope);

    await fs.writeFile(tmp, payload, "utf8");
    await fs.rename(tmp, file).catch(async () => {
      // If rename fails (e.g. cross-device), fall back to direct write.
      await fs.writeFile(file, payload, "utf8");
      await fs.unlink(tmp!).catch(() => undefined);
    });
  } catch (err: any) {
    // Best-effort cleanup
    if (tmp) await fs.unlink(tmp).catch(() => undefined);
    if (/^(1|true|yes)$/i.test(process.env.ACADEMIC_CACHE_DEBUG || "")) {
      // Avoid noisy logs by default; enable only for debugging.
      // eslint-disable-next-line no-console
      console.warn(
        `[persistentJsonCache] Set failed (ignored): ${err?.code || ""} ${err?.message || String(err)}`.trim()
      );
    }
  }
}
