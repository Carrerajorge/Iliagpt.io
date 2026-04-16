export type SkillCategory = "documents" | "data" | "integrations" | "custom";

export interface SkillLike {
  name: string;
  instructions: string;
  enabled: boolean;
  category?: SkillCategory;
}

export interface SkillInvocation {
  raw: string;
  name: string;
}

/**
 * Parse a "/skill ..." command. Returns the prompt portion or null if not a skill command.
 */
export function parseSkillCreateCommand(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (!/^\/skill\b/i.test(trimmed)) return null;

  const rest = trimmed.replace(/^\/skill\b/i, "").trim();
  if (!rest) return "";

  // Support "/skill:create ..." and "/skill create ..."
  const normalized = rest.replace(/^[:\s]+/, "");
  const strippedVerb = normalized.replace(/^(create|new|crear|nuevo)\b[:\s]*/i, "");
  return strippedVerb.trim();
}

/**
 * Parse a skill invocation at the start of the message.
 * Supported:
 * - "@SkillName ..."
 * - "@{Skill Name} ..."
 */
export function parseSkillInvocation(input: string): SkillInvocation | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("@")) return null;

  // "@{Skill Name}"
  const braceMatch = trimmed.match(/^@\{([^}]{1,64})\}/);
  if (braceMatch) {
    return { raw: braceMatch[0], name: braceMatch[1].trim() };
  }

  // "@SkillName" (no spaces)
  const tokenMatch = trimmed.match(/^@([^\s]{1,64})/);
  if (tokenMatch) {
    return { raw: tokenMatch[0], name: tokenMatch[1].trim() };
  }

  return null;
}

export function findEnabledSkillByName<T extends SkillLike>(invocationName: string, skills: T[]): T | null {
  const needle = invocationName.trim().toLowerCase();
  if (!needle) return null;

  for (const s of skills) {
    if (!s?.enabled) continue;
    if (s.name.trim().toLowerCase() === needle) return s;
  }
  return null;
}
