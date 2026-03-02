export const FEATURES = {
  AGENTIC_CHAT_ENABLED: process.env.AGENTIC_CHAT_ENABLED === 'true',
  AGENTIC_AUTONOMOUS_MODE: process.env.AGENTIC_AUTONOMOUS_MODE === 'true',
  AGENTIC_SUGGESTIONS_ENABLED: process.env.AGENTIC_SUGGESTIONS_ENABLED === 'true',
};

console.log(`[Features] AGENTIC_CHAT_ENABLED=${FEATURES.AGENTIC_CHAT_ENABLED}, AUTONOMOUS=${FEATURES.AGENTIC_AUTONOMOUS_MODE}, SUGGESTIONS=${FEATURES.AGENTIC_SUGGESTIONS_ENABLED}`);

export function isAgenticEnabled(): boolean {
  return FEATURES.AGENTIC_CHAT_ENABLED;
}

export function setFeatureFlag(flag: keyof typeof FEATURES, value: boolean): void {
  (FEATURES as any)[flag] = value;
}
