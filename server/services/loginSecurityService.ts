import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import type { RateLimiterAbstract } from "rate-limiter-flexible";
import { cache } from "../lib/cache";
import { getSettingValue } from "./settingsConfigService";

type LimiterConfig = { points: number; duration: number; blockDuration: number };

let limiter: RateLimiterAbstract | null = null;
let limiterConfig: LimiterConfig | null = null;

function buildKey(email: string, ip: string): string {
  const normalizedEmail = email.toLowerCase().trim();
  const normalizedIp = (ip || "unknown").trim();
  return `${normalizedEmail}:${normalizedIp}`;
}

async function getLimiter(): Promise<RateLimiterAbstract> {
  const maxAttemptsRaw = await getSettingValue<number>("max_login_attempts", 5);
  const lockoutMinutesRaw = await getSettingValue<number>("lockout_duration_minutes", 30);

  const points = Number.isFinite(maxAttemptsRaw) ? Math.max(1, Math.floor(Number(maxAttemptsRaw))) : 5;
  const lockoutMinutes = Number.isFinite(lockoutMinutesRaw) ? Math.max(1, Math.floor(Number(lockoutMinutesRaw))) : 30;

  // Use the same window for counting + blocking to keep semantics simple and predictable.
  const duration = lockoutMinutes * 60;
  const blockDuration = lockoutMinutes * 60;

  const nextConfig: LimiterConfig = { points, duration, blockDuration };
  const needsRebuild =
    !limiter ||
    !limiterConfig ||
    limiterConfig.points !== nextConfig.points ||
    limiterConfig.duration !== nextConfig.duration ||
    limiterConfig.blockDuration !== nextConfig.blockDuration;

  if (!needsRebuild) return limiter!;

  const redisClient = cache.getConnectedRedisClient();
  limiter = redisClient
    ? new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: "rl_login",
        points,
        duration,
        blockDuration,
      })
    : new RateLimiterMemory({
        keyPrefix: "rl_login",
        points,
        duration,
        blockDuration,
      });

  limiterConfig = nextConfig;
  return limiter;
}

export async function checkLoginAllowed(email: string, ip: string): Promise<{
  allowed: boolean;
  remaining?: number;
  retryAfterSeconds?: number;
}> {
  const rl = await getLimiter();
  const key = buildKey(email, ip);

  try {
    const result = await rl.consume(key, 1);
    return { allowed: true, remaining: result.remainingPoints };
  } catch (err: any) {
    if (err instanceof RateLimiterRes) {
      const retryAfterSeconds = Math.ceil(err.msBeforeNext / 1000);
      return { allowed: false, retryAfterSeconds };
    }
    // Unknown limiter error: fail open.
    return { allowed: true };
  }
}

export async function resetLoginAttempts(email: string, ip: string): Promise<void> {
  const rl = await getLimiter();
  const key = buildKey(email, ip);
  try {
    await rl.delete(key);
  } catch {
    // ignore
  }
}
