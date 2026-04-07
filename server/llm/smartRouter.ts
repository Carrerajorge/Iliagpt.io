/**
 * Smart Model Router
 *
 * Analyzes message complexity and selects the most cost-effective model,
 * tracks per-user costs, and monitors provider health/latency.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Complexity = "simple" | "medium" | "complex";

export interface ModelSelection {
  model: string;
  provider: string;
  reason: string;
}

export interface SelectModelOptions {
  userMessage: string;
  conversationLength: number;
  userModel?: string;
  userId: string;
  userTier: string;
}

export interface ProviderStats {
  provider: string;
  requestCount: number;
  successCount: number;
  successRate: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  healthScore: number;
}

interface LatencySample {
  ms: number;
  success: boolean;
  timestamp: number;
}

interface DailyCostEntry {
  date: string; // YYYY-MM-DD
  totalCost: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLLING_WINDOW_SIZE = 100;

/** Cost per 1M tokens (USD). Input / Output. */
const TOKEN_PRICING: Record<string, { input: number; output: number }> = {
  "google/gemini-2.0-flash":       { input: 0.10,  output: 0.40 },
  "cerebras/llama-4-scout":        { input: 0.00,  output: 0.00 },   // free tier
  "google/gemini-2.5-flash":       { input: 0.15,  output: 0.60 },
  "xai/grok-3-mini":               { input: 0.30,  output: 0.50 },
  "anthropic/claude-sonnet-4-5":   { input: 3.00,  output: 15.00 },
  "openai/gpt-4.1":               { input: 2.50,  output: 10.00 },
};

const DAILY_BUDGET: Record<string, number> = {
  free: 0.50,
  pro: 5.0,
  admin: Infinity,
};

/** Model candidates per complexity tier, ordered by preference. */
const MODEL_MAP: Record<Complexity, Array<{ model: string; provider: string }>> = {
  simple: [
    { model: "google/gemini-2.0-flash", provider: "gemini" },
    { model: "cerebras/llama-4-scout",  provider: "cerebras" },
  ],
  medium: [
    { model: "google/gemini-2.5-flash", provider: "gemini" },
    { model: "xai/grok-3-mini",         provider: "xai" },
  ],
  complex: [
    { model: "anthropic/claude-sonnet-4-5", provider: "anthropic" },
    { model: "openai/gpt-4.1",             provider: "openai" },
  ],
};

// ---------------------------------------------------------------------------
// Complexity keyword / pattern sets
// ---------------------------------------------------------------------------

const SIMPLE_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|ok|bye|good morning|good night)\b/i,
  /^translate\s/i,
  /^what\s+(is|are)\s+/i,
  /^define\s+/i,
];

const COMPLEX_INDICATORS: RegExp[] = [
  /step[- ]?by[- ]?step/i,
  /multi[- ]?step/i,
  /research|analyze in depth|deep dive/i,
  /compar(e|ison)\s+.+\s+(and|vs|versus)\s+/i,
  /```[\s\S]{200,}/,                       // large code blocks
  /\b(proof|theorem|induction|recurrence)\b/i,
  /\bwrite\s+(a|an)\s+(essay|report|paper|article)\b/i,
];

const MEDIUM_INDICATORS: RegExp[] = [
  /\b(code|function|class|implement|refactor|debug|fix)\b/i,
  /\b(summarize|summary|explain|analyze|review)\b/i,
  /\b(algorithm|data structure|regex|sql|query)\b/i,
  /```/,                                   // any code block
  /\b(json|xml|yaml|csv|html|css)\b/i,
];

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

/** provider -> rolling latency samples */
const latencyStore = new Map<string, LatencySample[]>();

/** userId -> { date, totalCost } */
const costStore = new Map<string, DailyCostEntry>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function extractProvider(model: string): string {
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : "unknown";
}

// ---------------------------------------------------------------------------
// Complexity Detection
// ---------------------------------------------------------------------------

export function analyzeComplexity(
  message: string,
  conversationLength: number,
): Complexity {
  // Very short messages or greetings -> simple
  if (message.length < 20 && SIMPLE_PATTERNS.some((p) => p.test(message))) {
    return "simple";
  }

  // Score-based approach
  let score = 0;

  // Message length contribution
  if (message.length > 2000) score += 3;
  else if (message.length > 800) score += 2;
  else if (message.length > 300) score += 1;

  // Conversation length contribution
  if (conversationLength > 20) score += 2;
  else if (conversationLength > 8) score += 1;

  // Pattern matching
  for (const pat of COMPLEX_INDICATORS) {
    if (pat.test(message)) {
      score += 3;
      break; // one hit is enough to push toward complex
    }
  }

  for (const pat of MEDIUM_INDICATORS) {
    if (pat.test(message)) {
      score += 1;
    }
  }

  // Presence of math-like content
  if (/[=+\-*/^]{2,}|\\frac|\\sum|\\int|\$\$[\s\S]+\$\$/.test(message)) {
    score += 2;
  }

  // Multiple questions (question marks)
  const questionMarks = (message.match(/\?/g) || []).length;
  if (questionMarks >= 3) score += 2;
  else if (questionMarks >= 2) score += 1;

  if (score >= 5) return "complex";
  if (score >= 2) return "medium";
  return "simple";
}

// ---------------------------------------------------------------------------
// Provider Health Scoring
// ---------------------------------------------------------------------------

function computeProviderHealth(provider: string): number {
  const samples = latencyStore.get(provider);
  if (!samples || samples.length === 0) return 0.5; // no data, neutral

  const successCount = samples.filter((s) => s.success).length;
  const successRate = successCount / samples.length;

  const latencies = samples.filter((s) => s.success).map((s) => s.ms).sort((a, b) => a - b);
  const avgLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 5000;

  // Normalize latency: 200ms = 1.0, 10000ms = ~0.02
  const normalizedLatency = Math.max(0.01, 1 / (avgLatency / 200));

  // Availability: fraction of samples from the last 5 minutes
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const recentSamples = samples.filter((s) => s.timestamp >= fiveMinAgo);
  const availability = recentSamples.length > 0
    ? recentSamples.filter((s) => s.success).length / recentSamples.length
    : successRate; // fall back to overall rate

  return successRate * 0.4 + normalizedLatency * 0.3 + availability * 0.3;
}

// ---------------------------------------------------------------------------
// Model Selection
// ---------------------------------------------------------------------------

export async function selectModel(options: SelectModelOptions): Promise<ModelSelection> {
  const { userMessage, conversationLength, userModel, userId, userTier } = options;

  // 1. User override always wins
  if (userModel) {
    return {
      model: userModel,
      provider: extractProvider(userModel),
      reason: "user-selected model override",
    };
  }

  // 2. Budget check
  const dailyCost = await getUserDailyCost(userId);
  const budget = DAILY_BUDGET[userTier] ?? DAILY_BUDGET.free;
  const budgetExhausted = dailyCost >= budget;

  if (budgetExhausted) {
    // Force cheapest model
    const fallback = MODEL_MAP.simple[0];
    return {
      model: fallback.model,
      provider: fallback.provider,
      reason: `daily budget exhausted ($${dailyCost.toFixed(2)} / $${budget.toFixed(2)})`,
    };
  }

  // 3. Determine complexity
  const complexity = analyzeComplexity(userMessage, conversationLength);

  // 4. Pick best candidate from the tier using health scores
  const candidates = MODEL_MAP[complexity];
  let best = candidates[0];
  let bestHealth = -1;

  for (const candidate of candidates) {
    const health = computeProviderHealth(candidate.provider);
    if (health > bestHealth) {
      bestHealth = health;
      best = candidate;
    }
  }

  return {
    model: best.model,
    provider: best.provider,
    reason: `complexity=${complexity}, health=${bestHealth.toFixed(2)}`,
  };
}

// ---------------------------------------------------------------------------
// Cost Tracking
// ---------------------------------------------------------------------------

export function trackRequestCost(
  userId: string,
  provider: string,
  inputTokens: number,
  outputTokens: number,
): void {
  // Find pricing - try provider/model keys; fall back to provider prefix match
  let pricing = TOKEN_PRICING[provider];
  if (!pricing) {
    const match = Object.keys(TOKEN_PRICING).find((k) => k.startsWith(provider + "/"));
    pricing = match ? TOKEN_PRICING[match] : { input: 1.0, output: 3.0 }; // conservative fallback
  }

  const cost =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;

  const today = todayKey();
  const entry = costStore.get(userId);

  if (entry && entry.date === today) {
    entry.totalCost += cost;
  } else {
    costStore.set(userId, { date: today, totalCost: cost });
  }
}

export async function getUserDailyCost(userId: string): Promise<number> {
  const entry = costStore.get(userId);
  if (!entry || entry.date !== todayKey()) return 0;
  return entry.totalCost;
}

// ---------------------------------------------------------------------------
// Latency Tracking
// ---------------------------------------------------------------------------

export function trackLatency(
  provider: string,
  latencyMs: number,
  success: boolean,
): void {
  let samples = latencyStore.get(provider);
  if (!samples) {
    samples = [];
    latencyStore.set(provider, samples);
  }

  samples.push({ ms: latencyMs, success, timestamp: Date.now() });

  // Keep rolling window
  if (samples.length > ROLLING_WINDOW_SIZE) {
    samples.splice(0, samples.length - ROLLING_WINDOW_SIZE);
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function getProviderStats(): ProviderStats[] {
  const stats: ProviderStats[] = [];

  for (const [provider, samples] of Array.from(latencyStore.entries())) {
    const successSamples = samples.filter((s: LatencySample) => s.success);
    const latencies = successSamples.map((s: LatencySample) => s.ms).sort((a: number, b: number) => a - b);

    stats.push({
      provider,
      requestCount: samples.length,
      successCount: successSamples.length,
      successRate: samples.length > 0 ? successSamples.length / samples.length : 0,
      latencyP50: percentile(latencies, 50),
      latencyP95: percentile(latencies, 95),
      latencyP99: percentile(latencies, 99),
      healthScore: computeProviderHealth(provider),
    });
  }

  return stats;
}
