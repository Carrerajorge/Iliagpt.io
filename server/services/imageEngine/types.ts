/**
 * Universal Image Engine — provider-agnostic image generation.
 *
 * Any image-capable model (Gemini, OpenAI, xAI, OpenRouter, or any
 * OpenAI-compatible endpoint) is exposed through the same adapter
 * interface and resolved through a single registry with fallback.
 */

export type ImageAspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3";

export type ImageQuality = "standard" | "hd";

export interface ImageEngineOptions {
  /** Model id ("auto" or omitted → registry picks the best available). */
  model?: string;
  aspectRatio?: ImageAspectRatio;
  quality?: ImageQuality;
  /** Negative prompt — appended as guidance for providers without native support. */
  negativePrompt?: string;
  /** Abort the whole generation chain. */
  signal?: AbortSignal;
}

export interface ImageEngineAttempt {
  provider: string;
  model: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface ImageEngineResult {
  imageBase64: string;
  mimeType: string;
  prompt: string;
  model: string;
  provider: string;
  latencyMs: number;
  attempts: ImageEngineAttempt[];
}

export type ImageProgressStage =
  | "selecting"
  | "generating"
  | "fallback"
  | "processing"
  | "done";

export interface ImageProgressEvent {
  stage: ImageProgressStage;
  provider?: string;
  model?: string;
  modelLabel?: string;
  /** 1-based attempt number across the fallback chain. */
  attempt?: number;
  message?: string;
}

export type ImageProgressListener = (event: ImageProgressEvent) => void;

export interface ImageModelDescriptor {
  /** Stable id used by clients, e.g. "gemini-3.1-flash-image-preview" or "openai/gpt-image-1". */
  id: string;
  provider: string;
  label: string;
  /** Lower = tried earlier in "auto" mode. */
  priority: number;
  supportsAspectRatio: boolean;
  supportsEdit: boolean;
}

export interface GenerateParams {
  prompt: string;
  modelId: string;
  aspectRatio?: ImageAspectRatio;
  quality?: ImageQuality;
  negativePrompt?: string;
  signal?: AbortSignal;
}

export interface RawImageOutput {
  imageBase64: string;
  mimeType: string;
}

export interface ImageProviderAdapter {
  readonly name: string;
  /** True when the required API key/env is present. */
  isConfigured(): boolean;
  /** Models this adapter offers, in its own preference order. */
  listModels(): ImageModelDescriptor[];
  generate(params: GenerateParams): Promise<RawImageOutput>;
  edit?(
    baseImageBase64: string,
    baseMimeType: string,
    params: GenerateParams,
  ): Promise<RawImageOutput>;
}
