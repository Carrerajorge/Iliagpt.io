const LETTER_OR_NUMBER_PATTERN = /[\p{L}\p{N}]/u;
const PLACEHOLDER_ONLY_PATTERN = /^[\p{P}\p{S}\s]+$/u;

export function hasMeaningfulAssistantContent(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const trimmed = value.trim();
  if (!trimmed) return false;

  if (LETTER_OR_NUMBER_PATTERN.test(trimmed)) {
    return true;
  }

  return !PLACEHOLDER_ONLY_PATTERN.test(trimmed) && trimmed.length >= 4;
}
