import OpenAI from "openai";
import { DEFAULT_XAI_TEXT_MODEL, DEFAULT_XAI_VISION_MODEL, DEFAULT_XAI_REASONING_MODEL } from "./modelRegistry";

export const openai = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing"
});

export const MODELS = {
  TEXT: DEFAULT_XAI_TEXT_MODEL,
  VISION: DEFAULT_XAI_VISION_MODEL,
  GROK_REASONING: DEFAULT_XAI_REASONING_MODEL,
} as const;

export type ModelType = typeof MODELS[keyof typeof MODELS];
