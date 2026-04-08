export type DocumentFormat = "pptx" | "docx" | "xlsx" | "pdf";
export type DocumentIntent = "create" | "edit" | "convert" | "redline" | "analyze";
export type DocumentBackend = "local" | "claude-skills";

export interface SkillDefinition {
  name: string;
  description: string;
  format: DocumentFormat;
  triggers: string[]; // keywords that activate this skill
  level1Summary: string; // ~100 tokens for system prompt
  level2Path: string; // path to SKILL.md
  level3Refs: string[]; // paths to additional reference files
}

export interface DesignPalette {
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  muted: string;
  border: string;
  surface: string;
}

export interface TypographyRules {
  titleSize: [number, number]; // [min, max] in pt
  subtitleSize: [number, number];
  bodySize: [number, number];
  captionSize: [number, number];
  titleFont: string;
  bodyFont: string;
}

export interface QAResult {
  passed: boolean;
  issues: string[];
  thumbnails?: { page: number; base64: string }[];
}

export interface IntentRouteResult {
  intent: DocumentIntent;
  skill: string;
  workflow: string;
  backend: DocumentBackend;
}
