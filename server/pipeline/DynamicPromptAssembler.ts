/**
 * DynamicPromptAssembler — Batch 1 Pipeline Stage
 *
 * Assembles the system prompt per-request from composable sections:
 *  - Base personality (loaded from config/env)
 *  - User profile (language, formality, expertise level)
 *  - Task-specific instructions (coding conventions, analytical framework, etc.)
 *  - Tool descriptions (only injected when the model will use them)
 *  - Memory context (summaries of past conversation)
 *  - Conversation style overrides
 *
 * Token budget manager ensures the most important sections survive context limits.
 * A/B variant support: track which prompt variants produce better outcomes.
 */

import { createLogger } from "../utils/logger";

const log = createLogger("DynamicPromptAssembler");

// ─── Types ────────────────────────────────────────────────────────────────────

export type PromptSection =
  | "base_personality"
  | "user_profile"
  | "task_specific"
  | "tool_descriptions"
  | "memory_context"
  | "conversation_style"
  | "safety_guidelines"
  | "output_format";

export type Formality = "casual" | "neutral" | "professional" | "academic";
export type ExpertiseLevel = "beginner" | "intermediate" | "advanced" | "expert";
export type ProviderFamily = "anthropic" | "openai" | "google" | "other";

export interface UserProfile {
  language: string;              // ISO 639-1 code
  formality: Formality;
  expertiseLevel: ExpertiseLevel;
  preferredOutputFormat?: string; // markdown | plain | structured
  timezone?: string;
  customInstructions?: string;
}

export interface MemoryContext {
  recentSummary?: string;        // LLM-generated summary of last N turns
  userFacts?: string[];          // remembered user facts
  projectContext?: string;       // ongoing project description
}

export interface AssemblerInput {
  userProfile?: UserProfile;
  taskType?: string;             // "code" | "analysis" | "creative" | etc.
  memoryContext?: MemoryContext;
  availableTools?: string[];
  modelProvider?: ProviderFamily;
  tokenBudget?: number;          // max tokens for the assembled system prompt
  variantId?: string;            // A/B testing variant identifier
  conversationStyle?: string;    // freeform style override
  extraInstructions?: string;    // one-off additions for this request
}

export interface AssemblyResult {
  systemPrompt: string;
  sections: PromptSection[];     // sections included (in priority order)
  estimatedTokens: number;
  truncated: boolean;
  variantId?: string;
  assemblyMs: number;
}

// ─── Section Priority ─────────────────────────────────────────────────────────

// Sections listed high→low priority for token budget trimming
const SECTION_PRIORITY: PromptSection[] = [
  "safety_guidelines",
  "base_personality",
  "task_specific",
  "user_profile",
  "output_format",
  "conversation_style",
  "tool_descriptions",
  "memory_context",
];

// ─── Section Builders ─────────────────────────────────────────────────────────

function buildBasePersonality(provider: ProviderFamily): string {
  const base =
    "You are Ilia, an advanced AI assistant. You are helpful, honest, and precise. " +
    "You acknowledge uncertainty rather than fabricating answers. " +
    "You adapt your communication style to the user's needs and expertise level.";

  // Provider-specific preamble adjustments
  if (provider === "anthropic") {
    return base + " Think carefully before responding.";
  }
  return base;
}

function buildUserProfile(profile: UserProfile): string {
  const parts: string[] = [];

  const languageLabels: Record<string, string> = {
    es: "Spanish (Español)",
    en: "English",
    fr: "French (Français)",
    de: "German (Deutsch)",
    pt: "Portuguese (Português)",
    zh: "Chinese (中文)",
    ja: "Japanese (日本語)",
    ko: "Korean (한국어)",
  };

  const langLabel = languageLabels[profile.language] ?? profile.language;
  parts.push(`Respond in ${langLabel}.`);

  const formalityInstructions: Record<Formality, string> = {
    casual: "Use a friendly, conversational tone. Contractions are fine.",
    neutral: "Use a balanced tone — clear but not overly formal.",
    professional: "Use a professional, precise tone appropriate for a business context.",
    academic: "Use formal academic language. Cite reasoning explicitly.",
  };
  parts.push(formalityInstructions[profile.formality]);

  const expertiseInstructions: Record<ExpertiseLevel, string> = {
    beginner: "Explain concepts from first principles. Avoid jargon; define technical terms when you must use them.",
    intermediate: "Assume familiarity with core concepts. Brief definitions for advanced terms are helpful.",
    advanced: "Skip basic explanations. Use domain-specific terminology freely.",
    expert: "Communicate at peer level. Prioritize precision and depth over accessibility.",
  };
  parts.push(expertiseInstructions[profile.expertiseLevel]);

  if (profile.customInstructions) {
    parts.push(`Additional user preference: ${profile.customInstructions}`);
  }

  return parts.join(" ");
}

function buildTaskSpecific(taskType: string): string {
  const taskInstructions: Record<string, string> = {
    code:
      "When writing code: use idiomatic patterns for the language, add type annotations, " +
      "wrap all code in fenced blocks with the language tag, keep inline comments minimal " +
      "and only for non-obvious logic.",
    analysis:
      "When analyzing: structure your response with Overview → Key Findings → Implications → Recommendations. " +
      "Distinguish between facts, interpretations, and speculation.",
    creative:
      "When writing creatively: prioritize voice, originality, and engagement. " +
      "Follow the genre conventions implied by the request unless asked to subvert them.",
    tutorial:
      "When writing tutorials: include prerequisites, numbered steps, code examples, " +
      "common pitfalls, and a summary. Assume the reader will follow along.",
    comparison:
      "When comparing options: use a structured format (table where appropriate). " +
      "State trade-offs explicitly and end with a clear recommendation.",
    summary:
      "When summarizing: extract the most important points. Preserve key numbers, " +
      "names, and conclusions. Ruthlessly omit peripheral detail.",
    question:
      "When answering questions: lead with the direct answer, then provide supporting detail. " +
      "Flag uncertainty explicitly.",
    conversational:
      "Keep responses concise and conversational. Match the user's energy.",
  };

  return taskInstructions[taskType] ?? "";
}

function buildToolDescriptions(tools: string[]): string {
  if (tools.length === 0) return "";

  const toolDocs: Record<string, string> = {
    web_search: "web_search(query): searches the internet for current information.",
    file_read: "file_read(path): reads contents of a file on the user's system.",
    file_write: "file_write(path, content): writes content to a file.",
    code_execution: "code_execution(lang, code): runs code and returns stdout/stderr.",
    database: "database(sql): executes a SQL query on the connected database.",
    calendar: "calendar(action, params): reads or creates calendar events.",
    email: "email(action, params): reads, drafts, or sends emails.",
    image_gen: "image_gen(prompt, params): generates an image from a text description.",
  };

  const descriptions = tools
    .map(t => toolDocs[t] ?? `${t}(...)`)
    .join("\n  ");

  return `You have access to the following tools:\n  ${descriptions}\n` +
    "Use them only when they improve the answer. Prefer direct answers when possible.";
}

function buildMemoryContext(memory: MemoryContext): string {
  const parts: string[] = [];

  if (memory.recentSummary) {
    parts.push(`Conversation summary: ${memory.recentSummary}`);
  }
  if (memory.userFacts && memory.userFacts.length > 0) {
    parts.push(`Known user facts:\n- ${memory.userFacts.join("\n- ")}`);
  }
  if (memory.projectContext) {
    parts.push(`Ongoing project context: ${memory.projectContext}`);
  }

  return parts.join("\n\n");
}

function buildSafetyGuidelines(): string {
  return (
    "Do not provide instructions for illegal activities, create harmful content, " +
    "or assist with deception. If a request crosses ethical lines, explain why you " +
    "cannot help and offer an alternative if possible."
  );
}

function buildOutputFormat(format: string): string {
  const formatInstructions: Record<string, string> = {
    markdown: "Format your response in Markdown. Use headers, bold, and code blocks where appropriate.",
    plain: "Use plain text without any Markdown formatting.",
    json: "Respond only with valid JSON. No explanation text outside the JSON object.",
    structured: "Use structured Markdown with clear section headers.",
  };
  return formatInstructions[format] ?? "";
}

// ─── Token Estimation ──────────────────────────────────────────────────────────

/** Rough token estimate: 1 token ≈ 4 chars for English prose */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── DynamicPromptAssembler ───────────────────────────────────────────────────

export class DynamicPromptAssembler {
  private basePersonality: string;

  constructor(basePersonalityOverride?: string) {
    this.basePersonality =
      basePersonalityOverride ??
      process.env.BASE_SYSTEM_PROMPT ??
      buildBasePersonality("other");
  }

  assemble(input: AssemblerInput): AssemblyResult {
    const t0 = Date.now();
    const budget = input.tokenBudget ?? 2000;
    const provider = input.modelProvider ?? "other";

    // ── Build all candidate sections ────────────────────────────────────────

    const candidates: Array<{ section: PromptSection; text: string }> = [
      {
        section: "safety_guidelines",
        text: buildSafetyGuidelines(),
      },
      {
        section: "base_personality",
        text: input.variantId
          ? this.getVariantPersonality(input.variantId, provider)
          : buildBasePersonality(provider),
      },
      {
        section: "task_specific",
        text: input.taskType ? buildTaskSpecific(input.taskType) : "",
      },
      {
        section: "user_profile",
        text: input.userProfile ? buildUserProfile(input.userProfile) : "",
      },
      {
        section: "output_format",
        text: input.userProfile?.preferredOutputFormat
          ? buildOutputFormat(input.userProfile.preferredOutputFormat)
          : "",
      },
      {
        section: "conversation_style",
        text: input.conversationStyle
          ? `Conversation style override: ${input.conversationStyle}`
          : "",
      },
      {
        section: "tool_descriptions",
        text:
          input.availableTools && input.availableTools.length > 0
            ? buildToolDescriptions(input.availableTools)
            : "",
      },
      {
        section: "memory_context",
        text: input.memoryContext ? buildMemoryContext(input.memoryContext) : "",
      },
    ];

    // ── Apply token budget (trim by priority order) ─────────────────────────

    const included: Array<{ section: PromptSection; text: string }> = [];
    let usedTokens = 0;
    let truncated = false;

    // Sort by priority
    const sorted = SECTION_PRIORITY.map(s => candidates.find(c => c.section === s)!).filter(Boolean);

    for (const candidate of sorted) {
      if (!candidate.text) continue;
      const tokens = estimateTokens(candidate.text);
      if (usedTokens + tokens <= budget) {
        included.push(candidate);
        usedTokens += tokens;
      } else if (budget - usedTokens > 40) {
        // Partially include (truncate to remaining budget)
        const charsLeft = (budget - usedTokens) * 4;
        included.push({
          section: candidate.section,
          text: candidate.text.slice(0, charsLeft) + "...",
        });
        usedTokens = budget;
        truncated = true;
        break;
      } else {
        truncated = true;
      }
    }

    // ── Assemble final prompt ───────────────────────────────────────────────

    const parts = included.map(i => i.text).filter(Boolean);

    if (input.extraInstructions) {
      parts.push(input.extraInstructions);
    }

    const systemPrompt = parts.join("\n\n").trim();

    const result: AssemblyResult = {
      systemPrompt,
      sections: included.map(i => i.section),
      estimatedTokens: estimateTokens(systemPrompt),
      truncated,
      variantId: input.variantId,
      assemblyMs: Date.now() - t0,
    };

    log.debug("prompt_assembled", {
      sections: result.sections,
      estimatedTokens: result.estimatedTokens,
      truncated,
      variantId: input.variantId,
      assemblyMs: result.assemblyMs,
    });

    return result;
  }

  /** A/B variant personality — extend with real variant config in production */
  private getVariantPersonality(variantId: string, provider: ProviderFamily): string {
    const variants: Record<string, string> = {
      "v2-concise":
        "You are Ilia, an AI assistant. Be concise and direct. Avoid preamble.",
      "v2-detailed":
        "You are Ilia, a thorough AI assistant. Provide comprehensive, well-structured answers.",
    };
    return variants[variantId] ?? buildBasePersonality(provider);
  }

  /** Return a minimal prompt for ultra-fast direct answers */
  assembleMinimal(language = "en"): string {
    const lang = language !== "en" ? ` Respond in the user's language (${language}).` : "";
    return `You are Ilia, a helpful AI assistant. Be concise and accurate.${lang}`;
  }
}

export const dynamicPromptAssembler = new DynamicPromptAssembler();
