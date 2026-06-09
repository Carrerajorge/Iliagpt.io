/**
 * modelCapabilities — single source of truth for what each LLM can do.
 *
 * The gateway and routers branch on CAPABILITIES (tool calling, extended
 * thinking, vision, context/output limits, prompt caching) instead of
 * scattering model-name regexes. Pattern-based with env overrides so new
 * models can be tuned per deployment without a deploy:
 *
 *   MODEL_CAPABILITIES_OVERRIDES — JSON map of model-substring → partial caps,
 *     e.g. {"my-org/custom-r1":{"reasoning":"openrouter","contextWindow":131072}}
 *
 * Pure and dependency-free; everything exported for unit tests.
 */

export type ToolCallingMode = "native" | "prompted" | "none";

/** How the model exposes extended thinking, when it does. */
export type ReasoningProtocol =
  | "openrouter" // OpenRouter-normalized `reasoning` param + delta.reasoning
  | "anthropic" // Anthropic direct `thinking: {type:"enabled"}` + thinking_delta
  | "deepseek" // DeepSeek direct API `delta.reasoning_content`
  | "think-tag" // emits <think>…</think> tags in content (self-hosted R1/QwQ)
  | null;

export interface ModelCapabilities {
  toolCalling: ToolCallingMode;
  reasoning: ReasoningProtocol;
  vision: boolean;
  contextWindow: number;
  maxOutput: number;
  promptCaching: boolean;
}

const DEFAULTS: ModelCapabilities = {
  toolCalling: "native",
  reasoning: null,
  vision: false,
  contextWindow: 128_000,
  maxOutput: 8_192,
  promptCaching: false,
};

interface CapabilityRule {
  pattern: RegExp;
  caps: Partial<ModelCapabilities>;
}

/**
 * Ordered rules — FIRST match wins per field group (later rules only fill
 * fields the earlier match left undefined). Keep flagship families first.
 */
const RULES: CapabilityRule[] = [
  // ── Anthropic ──────────────────────────────────────────────────────────
  {
    pattern: /^anthropic\/claude/i, // via OpenRouter
    caps: { reasoning: "openrouter", vision: true, contextWindow: 200_000, maxOutput: 32_000, promptCaching: true },
  },
  {
    pattern: /^claude/i, // direct Anthropic API
    caps: { reasoning: "anthropic", vision: true, contextWindow: 200_000, maxOutput: 32_000, promptCaching: true },
  },
  // ── OpenAI reasoning families ──────────────────────────────────────────
  {
    pattern: /^(openai\/)?(o[134](-|$)|gpt-5)/i,
    caps: { reasoning: "openrouter", vision: true, contextWindow: 200_000, maxOutput: 65_536, promptCaching: true },
  },
  {
    pattern: /^(openai\/)?gpt-4o/i,
    caps: { vision: true, contextWindow: 128_000, maxOutput: 16_384, promptCaching: true },
  },
  {
    pattern: /^(openai\/)?gpt-4\.1/i,
    caps: { vision: true, contextWindow: 1_000_000, maxOutput: 32_768, promptCaching: true },
  },
  // ── DeepSeek ───────────────────────────────────────────────────────────
  {
    pattern: /^deepseek\/deepseek-r1/i, // via OpenRouter
    caps: { reasoning: "openrouter", contextWindow: 131_072, maxOutput: 32_768 },
  },
  {
    pattern: /^deepseek-reasoner/i, // direct DeepSeek API
    caps: { reasoning: "deepseek", contextWindow: 131_072, maxOutput: 32_768 },
  },
  {
    pattern: /^deepseek/i,
    caps: { contextWindow: 131_072, maxOutput: 8_192 },
  },
  // ── Google ─────────────────────────────────────────────────────────────
  {
    pattern: /^(google\/)?gemini-.*(thinking|2\.5|3)/i,
    caps: { reasoning: "openrouter", vision: true, contextWindow: 1_048_576, maxOutput: 65_536, promptCaching: true },
  },
  {
    pattern: /^(google\/)?gemini/i,
    caps: { vision: true, contextWindow: 1_048_576, maxOutput: 8_192 },
  },
  {
    pattern: /^google\/gemma/i,
    caps: { toolCalling: "prompted", contextWindow: 262_144, maxOutput: 8_192 },
  },
  // ── xAI ────────────────────────────────────────────────────────────────
  {
    pattern: /^(x-ai\/)?grok-[34]/i,
    caps: { reasoning: "openrouter", vision: true, contextWindow: 131_072, maxOutput: 32_768 },
  },
  {
    pattern: /grok/i,
    caps: { contextWindow: 131_072, maxOutput: 16_384 },
  },
  // ── Open-weight reasoning families (often self-hosted → think tags) ────
  {
    pattern: /^(qwen\/)?(qwq|qwen3)/i,
    caps: { reasoning: "openrouter", contextWindow: 131_072, maxOutput: 32_768 },
  },
  {
    pattern: /^moonshotai\/kimi-k2/i,
    caps: { reasoning: "openrouter", contextWindow: 131_072, maxOutput: 16_384 },
  },
  {
    pattern: /(-r1|r1-distill|deepseek-r1)/i, // bare/self-hosted R1 variants
    caps: { reasoning: "think-tag", contextWindow: 131_072, maxOutput: 32_768 },
  },
  // ── Known non-tool models ──────────────────────────────────────────────
  {
    pattern: /^(davinci|babbage|text-)/i,
    caps: { toolCalling: "none", contextWindow: 16_384, maxOutput: 4_096 },
  },
  {
    pattern: /llama-?2/i,
    caps: { toolCalling: "prompted", contextWindow: 8_192, maxOutput: 4_096 },
  },
];

let cachedOverrides: { raw: string | undefined; rules: CapabilityRule[] } | null = null;

function envOverrideRules(): CapabilityRule[] {
  const raw = process.env.MODEL_CAPABILITIES_OVERRIDES;
  if (cachedOverrides && cachedOverrides.raw === raw) return cachedOverrides.rules;
  const rules: CapabilityRule[] = [];
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as Record<string, Partial<ModelCapabilities>>;
      for (const [needle, caps] of Object.entries(parsed)) {
        if (!needle || !caps || typeof caps !== "object") continue;
        rules.push({
          pattern: new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
          caps,
        });
      }
    } catch (error) {
      console.warn("[modelCapabilities] Invalid MODEL_CAPABILITIES_OVERRIDES JSON:", (error as Error).message);
    }
  }
  cachedOverrides = { raw, rules };
  return rules;
}

/**
 * Resolve the capabilities of a model id. Env overrides win over built-in
 * rules; built-in rules merge first-match-wins per field; defaults fill the
 * rest. Unknown models get conservative defaults (native tools, no reasoning).
 */
export function getModelCapabilities(model: string | undefined | null): ModelCapabilities {
  const id = String(model || "").trim();
  const merged: Partial<ModelCapabilities> = {};
  const apply = (caps: Partial<ModelCapabilities>) => {
    for (const [key, value] of Object.entries(caps)) {
      if (value !== undefined && (merged as Record<string, unknown>)[key] === undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  };
  if (id) {
    for (const rule of envOverrideRules()) {
      if (rule.pattern.test(id)) apply(rule.caps);
    }
    for (const rule of RULES) {
      if (rule.pattern.test(id)) apply(rule.caps);
    }
  }
  return { ...DEFAULTS, ...merged };
}

/** Clamp a requested max_tokens to what the model can actually emit. */
export function clampMaxOutput(model: string | undefined | null, requested: number | undefined): number | undefined {
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) return requested;
  const { maxOutput } = getModelCapabilities(model);
  return Math.min(requested, maxOutput);
}

/** Whether the model supports extended thinking at all. */
export function supportsReasoning(model: string | undefined | null): boolean {
  return getModelCapabilities(model).reasoning !== null;
}

export const __testing = { RULES, DEFAULTS };
