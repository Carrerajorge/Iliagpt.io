/**
 * VisionPipeline — image analysis using Claude Vision API.
 * Capabilities: describe, OCR, chart understanding, diagram-to-text, multi-image comparison.
 * Falls back to Tesseract OCR when API unavailable.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "../utils/logger";
import { AppError } from "../utils/errors";

const logger = createLogger("VisionPipeline");

// ─── Types ────────────────────────────────────────────────────────────────────

export type VisionTask =
  | "describe"
  | "ocr"
  | "chart_analysis"
  | "diagram_to_text"
  | "compare"
  | "moderate"
  | "structured_extract";

export interface ImageInput {
  data: Buffer | string; // Buffer for raw bytes, string for URL or base64
  mediaType?: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  label?: string;
}

export interface VisionResult {
  task: VisionTask;
  description?: string;
  extractedText?: string;
  structuredData?: Record<string, unknown>;
  objects?: Array<{ label: string; confidence: number; boundingBox?: BoundingBox }>;
  colors?: Array<{ hex: string; name: string; percentage: number }>;
  chartData?: ChartAnalysis;
  moderationFlags?: ModerationResult;
  comparison?: ComparisonResult;
  model: string;
  tokensUsed: number;
}

export interface BoundingBox {
  x: number; y: number; width: number; height: number;
}

export interface ChartAnalysis {
  chartType: string;
  title?: string;
  xAxis?: string;
  yAxis?: string;
  dataPoints: Array<{ label: string; value: string | number }>;
  trend?: string;
  insights: string[];
}

export interface ModerationResult {
  safe: boolean;
  flags: Array<{ category: string; severity: "low" | "medium" | "high" }>;
}

export interface ComparisonResult {
  similarities: string[];
  differences: string[];
  preferredImage?: number;
  analysisNotes: string;
}

// ─── Task Prompts ─────────────────────────────────────────────────────────────

const TASK_PROMPTS: Record<VisionTask, string> = {
  describe: "Describe this image in detail. Include: what's shown, key elements, context, mood/tone, and any text visible.",

  ocr: "Extract ALL text from this image exactly as it appears. Preserve formatting where possible. Return only the extracted text, nothing else.",

  chart_analysis: `Analyze this chart/graph. Return a JSON object with:
{
  "chartType": "bar|line|pie|scatter|etc",
  "title": "chart title or null",
  "xAxis": "x axis label",
  "yAxis": "y axis label",
  "dataPoints": [{"label": "...", "value": "..."}],
  "trend": "description of trend",
  "insights": ["insight 1", "insight 2"]
}`,

  diagram_to_text: "Convert this diagram/flowchart/architecture diagram into a clear textual description. Describe all nodes, connections, and flow. Use → for directed connections.",

  compare: "Compare these images. Describe: similarities, differences, and which better achieves its apparent purpose. Be specific and objective.",

  moderate: `Analyze this image for content moderation. Return JSON:
{
  "safe": true|false,
  "flags": [{"category": "violence|nudity|hate|spam|...", "severity": "low|medium|high"}]
}
Return {"safe": true, "flags": []} if the image is appropriate.`,

  structured_extract: `Extract structured information from this image. Return JSON with all key information found:
{
  "title": "...",
  "main_content": "...",
  "metadata": {},
  "data_tables": [],
  "key_points": []
}`,
};

// ─── Image Preprocessing ──────────────────────────────────────────────────────

async function prepareImageContent(
  image: ImageInput
): Promise<Anthropic.ImageBlockParam> {
  if (typeof image.data === "string") {
    if (image.data.startsWith("http://") || image.data.startsWith("https://")) {
      // Fetch and convert to base64
      const resp = await fetch(image.data, { signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) throw new AppError(`Failed to fetch image: ${resp.status}`, 502, "IMAGE_FETCH_ERROR");

      const buf = Buffer.from(await resp.arrayBuffer());
      const contentType = resp.headers.get("content-type") ?? "image/jpeg";
      const mediaType = contentType.split(";")[0]?.trim() as Anthropic.Base64ImageSource["media_type"];

      return {
        type: "image",
        source: { type: "base64", media_type: mediaType ?? "image/jpeg", data: buf.toString("base64") },
      };
    }

    // Already base64
    return {
      type: "image",
      source: { type: "base64", media_type: image.mediaType ?? "image/jpeg", data: image.data },
    };
  }

  // Buffer
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: image.mediaType ?? "image/jpeg",
      data: image.data.toString("base64"),
    },
  };
}

// ─── Tesseract OCR Fallback ───────────────────────────────────────────────────

async function ocrWithTesseract(image: ImageInput): Promise<string> {
  try {
    // Dynamic import to avoid loading Tesseract unless needed
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");

    let imageData: string | Buffer;
    if (typeof image.data === "string" && !image.data.startsWith("http")) {
      imageData = Buffer.from(image.data, "base64");
    } else if (typeof image.data === "string") {
      imageData = image.data;
    } else {
      imageData = image.data;
    }

    const { data: { text } } = await worker.recognize(imageData);
    await worker.terminate();
    return text;
  } catch (err) {
    throw new AppError(`Tesseract OCR failed: ${(err as Error).message}`, 500, "OCR_ERROR");
  }
}

// ─── VisionPipeline ───────────────────────────────────────────────────────────

export class VisionPipeline {
  private client: Anthropic;
  private model: string;

  constructor(opts: { model?: string } = {}) {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.model = opts.model ?? "claude-sonnet-4-6";
  }

  async analyze(image: ImageInput, task: VisionTask = "describe"): Promise<VisionResult> {
    logger.debug(`Running vision task: ${task}`);

    // OCR fallback path if Claude unavailable
    if (task === "ocr" && !process.env.ANTHROPIC_API_KEY) {
      const text = await ocrWithTesseract(image);
      return { task, extractedText: text, model: "tesseract", tokensUsed: 0 };
    }

    const imageContent = await prepareImageContent(image);
    const prompt = TASK_PROMPTS[task];

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2_048,
      messages: [
        {
          role: "user",
          content: [imageContent, { type: "text", text: prompt }],
        },
      ],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

    return this.parseResponse(text, task, tokensUsed);
  }

  async compareImages(images: ImageInput[], comparisonPrompt?: string): Promise<VisionResult> {
    if (images.length < 2) throw new AppError("Need at least 2 images to compare", 400, "INVALID_INPUT");

    const imageContents = await Promise.all(images.map(prepareImageContent));
    const prompt = comparisonPrompt ?? TASK_PROMPTS.compare;

    const content: Anthropic.ContentBlockParam[] = [
      ...imageContents.map((img, i) => ({
        ...img,
        source: { ...(img as Anthropic.ImageBlockParam).source },
      } as Anthropic.ContentBlockParam)),
      { type: "text" as const, text: prompt },
    ];

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2_048,
      messages: [{ role: "user", content }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

    // Parse comparison result
    const similarities = [...text.matchAll(/similar(?:ities)?[:\s]+([^\n]+)/gi)].map((m) => m[1].trim());
    const differences = [...text.matchAll(/differ(?:ences?)?[:\s]+([^\n]+)/gi)].map((m) => m[1].trim());

    return {
      task: "compare",
      description: text,
      comparison: { similarities, differences, analysisNotes: text },
      model: this.model,
      tokensUsed,
    };
  }

  async moderate(image: ImageInput): Promise<ModerationResult> {
    const result = await this.analyze(image, "moderate");
    return result.moderationFlags ?? { safe: true, flags: [] };
  }

  async ocr(image: ImageInput): Promise<string> {
    const result = await this.analyze(image, "ocr");
    return result.extractedText ?? "";
  }

  async describeImage(image: ImageInput): Promise<string> {
    const result = await this.analyze(image, "describe");
    return result.description ?? "";
  }

  async analyzeChart(image: ImageInput): Promise<ChartAnalysis> {
    const result = await this.analyze(image, "chart_analysis");
    return result.chartData ?? { chartType: "unknown", dataPoints: [], insights: [] };
  }

  private parseResponse(text: string, task: VisionTask, tokensUsed: number): VisionResult {
    const base: VisionResult = { task, model: this.model, tokensUsed };

    if (task === "ocr") {
      return { ...base, extractedText: text };
    }

    if (task === "describe" || task === "diagram_to_text") {
      return { ...base, description: text };
    }

    if (task === "chart_analysis") {
      try {
        const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) ?? text.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch?.[1] ?? jsonMatch?.[0] ?? "{}") as ChartAnalysis;
        return { ...base, chartData: parsed, description: text };
      } catch {
        return { ...base, description: text, chartData: { chartType: "unknown", dataPoints: [], insights: [text] } };
      }
    }

    if (task === "moderate") {
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch?.[0] ?? "{}") as ModerationResult;
        return { ...base, moderationFlags: parsed };
      } catch {
        return { ...base, moderationFlags: { safe: true, flags: [] } };
      }
    }

    if (task === "structured_extract") {
      try {
        const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) ?? text.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch?.[1] ?? jsonMatch?.[0] ?? "{}") as Record<string, unknown>;
        return { ...base, structuredData: parsed, description: text };
      } catch {
        return { ...base, description: text, structuredData: {} };
      }
    }

    return { ...base, description: text };
  }
}

export const visionPipeline = new VisionPipeline();
