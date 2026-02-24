import {
  OPENCLAW_1000,
  type CapabilityStatus,
  type OpenClaw1000Capability,
  type OpenClaw1000Category,
} from "../capabilities/generated/openClaw1000Capabilities.generated";
import { getOpenClaw1000RuntimeStatus } from "./openClaw1000RuntimeStatus";

export interface OpenClaw1000CapabilityMatch {
  capability: OpenClaw1000Capability;
  score: number;
  matchedTokens: string[];
}

export interface OpenClaw1000CapabilityProfile {
  query: string;
  total: number;
  eligible: number;
  matches: OpenClaw1000CapabilityMatch[];
  categories: Array<{ category: OpenClaw1000Category; count: number }>;
  recommendedTools: string[];
}

export interface OpenClaw1000ProfileOptions {
  limit?: number;
  minScore?: number;
  includeStatuses?: CapabilityStatus[];
}

interface IndexedCapability {
  capability: OpenClaw1000Capability;
  runtimeStatus: CapabilityStatus;
  tokens: Set<string>;
  normalizedCapability: string;
  normalizedToolName: string;
  normalizedCategory: string;
}

const STOPWORDS = new Set([
  "de", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "o", "en", "por", "para", "con", "sin", "del", "al",
  "the", "and", "or", "for", "with", "without", "into", "from", "that", "this", "these", "those",
  "a", "an", "to", "on", "at", "by", "is", "are", "be",
  "capacidad", "capabilities", "capability", "sistema", "system", "iliagpt", "agent", "agente",
  "integrar", "integration", "integrate", "implementar", "implement", "implementacion", "implementacion",
  "debe", "must", "puede", "can", "usar", "use", "using", "funcionar", "working", "funcione",
  "usuario", "users", "user", "workspace", "workspaces",
]);

const STATUS_WEIGHT: Record<CapabilityStatus, number> = {
  implemented: 1,
  partial: 0.92,
  stub: 0.86,
  missing: 0.8,
};

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenize(value: string): string[] {
  if (!value) return [];
  const normalized = normalizeText(value);
  const parts = normalized
    .replace(/[^a-z0-9_]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const token of parts) {
    if (STOPWORDS.has(token)) continue;
    if (token.length < 3 && !["api", "sql", "ocr", "rag", "sso", "mfa", "otp"].includes(token)) continue;
    out.push(token);
  }

  return Array.from(new Set(out));
}

function overlap(promptTokens: Set<string>, capabilityTokens: Set<string>): { count: number; matchedTokens: string[] } {
  const matched: string[] = [];
  for (const token of promptTokens) {
    if (capabilityTokens.has(token)) {
      matched.push(token);
    }
  }
  return { count: matched.length, matchedTokens: matched };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const INDEXED_CAPABILITIES: IndexedCapability[] = OPENCLAW_1000.map((capability) => {
  const runtimeStatus = getOpenClaw1000RuntimeStatus(capability);
  const indexedText = [
    capability.capability,
    capability.category.replace(/_/g, " "),
    capability.nucleus,
    capability.toolName.replace(/_/g, " "),
    capability.techTags.join(" "),
    capability.tasks.slice(0, 1).join(" "),
    capability.acceptanceCriteria.slice(0, 1).join(" "),
    capability.requiredOutputs.slice(0, 1).join(" "),
  ].join(" ");

  return {
    capability:
      capability.status === runtimeStatus
        ? capability
        : { ...capability, status: runtimeStatus },
    runtimeStatus,
    tokens: new Set(tokenize(indexedText)),
    normalizedCapability: normalizeText(capability.capability),
    normalizedToolName: normalizeText(capability.toolName.replace(/_/g, " ")),
    normalizedCategory: normalizeText(capability.category.replace(/_/g, " ")),
  };
});

function computeScore(
  prompt: string,
  promptTokens: Set<string>,
  indexed: IndexedCapability
): { score: number; matchedTokens: string[] } {
  const { count, matchedTokens } = overlap(promptTokens, indexed.tokens);
  if (count === 0) {
    return { score: 0, matchedTokens: [] };
  }

  const lexicalCoverage = count / Math.max(2, Math.min(indexed.tokens.size, 8));
  const queryCoverage = count / Math.max(1, promptTokens.size);
  let score = lexicalCoverage * 0.72 + queryCoverage * 0.23;

  if (prompt.includes(indexed.normalizedCapability)) score += 0.24;
  if (prompt.includes(indexed.normalizedToolName)) score += 0.16;
  if (prompt.includes(indexed.normalizedCategory)) score += 0.1;

  score *= STATUS_WEIGHT[indexed.runtimeStatus];
  score = clamp(score, 0, 1);

  return { score, matchedTokens };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function buildOpenClaw1000CapabilityProfile(
  query: string,
  options: OpenClaw1000ProfileOptions = {}
): OpenClaw1000CapabilityProfile {
  const {
    limit = 24,
    minScore = 0.12,
    includeStatuses = ["implemented", "partial", "stub", "missing"],
  } = options;

  const normalizedPrompt = normalizeText(query);
  const promptTokens = new Set(tokenize(query));

  const eligible = INDEXED_CAPABILITIES.filter((entry) => includeStatuses.includes(entry.runtimeStatus));
  const matches: OpenClaw1000CapabilityMatch[] = [];

  for (const entry of eligible) {
    const { score, matchedTokens } = computeScore(normalizedPrompt, promptTokens, entry);
    if (score < minScore) continue;
    matches.push({
      capability: entry.capability,
      score: Math.round(score * 1000) / 1000,
      matchedTokens: unique(matchedTokens).slice(0, 8),
    });
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.capability.id - b.capability.id;
  });

  const limited = matches.slice(0, limit);

  const categoryCounts = new Map<OpenClaw1000Category, number>();
  for (const match of limited) {
    categoryCounts.set(
      match.capability.category,
      (categoryCounts.get(match.capability.category) || 0) + 1
    );
  }

  const categories = Array.from(categoryCounts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  const recommendedTools = unique(limited.map((m) => m.capability.toolName)).slice(0, 12);

  return {
    query,
    total: OPENCLAW_1000.length,
    eligible: eligible.length,
    matches: limited,
    categories,
    recommendedTools,
  };
}

export function suggestOpenClaw1000ToolForStep(
  stepText: string,
  profile: OpenClaw1000CapabilityProfile,
  alreadyUsedTools?: Set<string>
): string | null {
  const used = alreadyUsedTools || new Set<string>();
  const stepTokens = new Set(tokenize(stepText));
  if (stepTokens.size === 0) {
    const fallback = profile.recommendedTools.find((tool) => !used.has(tool));
    return fallback || null;
  }

  let bestTool: string | null = null;
  let bestScore = 0;

  for (const match of profile.matches) {
    const toolName = match.capability.toolName;
    if (!toolName || used.has(toolName)) continue;

    const seed = `${match.capability.capability} ${toolName.replace(/_/g, " ")} ${match.capability.techTags.join(" ")}`;
    const capabilityTokens = new Set(tokenize(seed));
    const { count } = overlap(stepTokens, capabilityTokens);
    if (count <= 0) continue;

    const overlapScore = count / Math.max(1, stepTokens.size);
    const combined = overlapScore * 0.55 + match.score * 0.45;
    if (combined > bestScore) {
      bestScore = combined;
      bestTool = toolName;
    }
  }

  if (bestTool) return bestTool;
  return profile.recommendedTools.find((tool) => !used.has(tool)) || null;
}
