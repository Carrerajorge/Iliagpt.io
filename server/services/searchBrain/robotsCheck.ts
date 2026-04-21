/**
 * robotsCheck — minimal robots.txt evaluator for SearchBrain's
 * opt-in scraping path.
 *
 * We only implement the pieces that actually matter for a
 * single-page fetch: User-agent, Disallow, Allow. No crawl-delay
 * (single request per user query), no request-rate, no sitemaps.
 *
 * The result is deliberately conservative: when the robots.txt fails
 * to fetch, or is malformed, we treat the target as DISALLOWED. That
 * is the opposite of the letter of the robots spec (when unreachable,
 * crawlers may proceed) but it's the right default for an opt-in
 * academic scraper: "be polite by default".
 */

const DEFAULT_USER_AGENT = "IliaGPT-SearchBrain/1.0";

export interface RobotsDecision {
  allowed: boolean;
  reason: string;
  userAgent: string;
}

export interface RobotsCheckOptions {
  targetUrl: string;
  userAgent?: string;
  timeoutMs?: number;
  /** Injectable fetcher for tests. */
  fetcher?: (url: string, init: { timeoutMs: number; userAgent: string }) => Promise<string | null>;
}

/**
 * Decide whether a single GET to `targetUrl` under our scraping
 * User-Agent is allowed. Fetches the site's robots.txt once per call.
 */
export async function checkRobots(options: RobotsCheckOptions): Promise<RobotsDecision> {
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  let target: URL;
  try {
    target = new URL(options.targetUrl);
  } catch {
    return { allowed: false, reason: "invalid target URL", userAgent };
  }
  const robotsUrl = `${target.protocol}//${target.host}/robots.txt`;
  const fetcher = options.fetcher ?? defaultFetcher;
  const body = await fetcher(robotsUrl, {
    timeoutMs: options.timeoutMs ?? 4000,
    userAgent,
  });
  if (body === null) {
    return { allowed: false, reason: "robots.txt unreachable — defaulting to disallowed", userAgent };
  }
  const rules = parseRobots(body, userAgent);
  const path = target.pathname + (target.search || "");
  const verdict = isPathAllowed(rules, path);
  return {
    allowed: verdict.allowed,
    reason: verdict.reason,
    userAgent,
  };
}

async function defaultFetcher(url: string, init: { timeoutMs: number; userAgent: string }): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": init.userAgent },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────

interface Group {
  userAgents: string[];
  rules: Array<{ type: "allow" | "disallow"; path: string }>;
}

interface Ruleset {
  matched: Group | null;
  wildcardFallback: Group | null;
}

export function parseRobots(body: string, userAgent: string): Ruleset {
  const groups: Group[] = [];
  let current: Group | null = null;
  const lines = body.split(/\r?\n/);
  const uaLower = userAgent.toLowerCase();

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (!value && field !== "user-agent") continue;
    if (field === "user-agent") {
      // New group when the previous line was NOT a user-agent.
      if (!current || current.rules.length > 0) {
        current = { userAgents: [], rules: [] };
        groups.push(current);
      }
      current.userAgents.push(value.toLowerCase());
    } else if (field === "disallow" || field === "allow") {
      if (!current) continue;
      current.rules.push({ type: field, path: value });
    }
    // Ignore crawl-delay, sitemap, request-rate etc.
  }

  let matched: Group | null = null;
  let wildcardFallback: Group | null = null;
  for (const g of groups) {
    if (g.userAgents.some((ua) => ua === "*")) wildcardFallback = g;
    if (g.userAgents.some((ua) => uaLower.includes(ua) && ua !== "*")) {
      matched = g;
    }
  }
  return { matched, wildcardFallback };
}

export function isPathAllowed(rules: Ruleset, path: string): { allowed: boolean; reason: string } {
  const group = rules.matched ?? rules.wildcardFallback;
  if (!group) return { allowed: true, reason: "no matching group" };
  // Longest-match wins between Allow and Disallow; ties go to Allow.
  let best: { type: "allow" | "disallow"; path: string } | null = null;
  for (const r of group.rules) {
    if (r.path === "") continue;
    if (pathMatches(path, r.path)) {
      if (!best || r.path.length > best.path.length) best = r;
      else if (r.path.length === best.path.length && r.type === "allow") best = r;
    }
  }
  if (!best) return { allowed: true, reason: "no matching rule" };
  if (best.type === "allow") {
    return { allowed: true, reason: `allowed by Allow: ${best.path}` };
  }
  return { allowed: false, reason: `disallowed by Disallow: ${best.path}` };
}

/**
 * robots.txt path matching: literal prefix with `*` wildcards and
 * `$` end-anchor. Keep it simple — matches the common subset that
 * Scopus / WoS / other academic sites use.
 */
export function pathMatches(path: string, rule: string): boolean {
  if (rule === "") return false;
  const hasEndAnchor = rule.endsWith("$");
  const core = hasEndAnchor ? rule.slice(0, -1) : rule;
  const segments = core.split("*");
  let cursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    if (i === 0) {
      if (!path.startsWith(segment)) return false;
      cursor = segment.length;
      continue;
    }
    const idx = path.indexOf(segment, cursor);
    if (idx < 0) return false;
    cursor = idx + segment.length;
  }
  if (hasEndAnchor) return cursor === path.length;
  return true;
}

export const ROBOTS_INTERNAL = { parseRobots, isPathAllowed, pathMatches };
