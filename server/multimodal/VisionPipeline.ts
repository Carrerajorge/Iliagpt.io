import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import Tesseract from "tesseract.js";
import axios from "axios";
import { Logger } from "../lib/logger";
import { env } from "../config/env";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface VisionAnalysisRequest {
  imageSource:
    | { type: "url"; url: string }
    | { type: "base64"; data: string; mediaType: string }
    | { type: "buffer"; buffer: Buffer; mediaType?: string };
  tasks: VisionTask[];
  language?: string;
}

export type VisionTask =
  | "describe"
  | "ocr"
  | "chart_analysis"
  | "diagram_to_text"
  | "object_detection"
  | "table_extraction"
  | "code_screenshot";

export interface ChartData {
  chartType: "bar" | "line" | "pie" | "scatter" | "table" | "other";
  title?: string;
  xAxis?: { label: string; values: string[] };
  yAxis?: { label: string; values: number[] };
  series?: Array<{ name: string; data: number[] }>;
  summary: string;
}

export interface DetectedObject {
  label: string;
  confidence: number;
  location?: string; // e.g. "top-left", "center"
}

export interface VisionAnalysisResult {
  imageId: string;
  description?: string;
  extractedText?: string;
  chartData?: ChartData;
  diagramDescription?: string;
  detectedObjects?: DetectedObject[];
  tableData?: Array<Record<string, string>>;
  extractedCode?: string;
  language?: string;
  confidence: number;
  processingTimeMs: number;
  source: "claude_vision" | "tesseract_ocr" | "hybrid";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ValidMediaType = (typeof VALID_MEDIA_TYPES)[number];

function isValidMediaType(mt: string): mt is ValidMediaType {
  return (VALID_MEDIA_TYPES as readonly string[]).includes(mt);
}

function guessMimeFromUrl(url: string): ValidMediaType {
  if (/\.png(\?|$)/i.test(url)) return "image/png";
  if (/\.gif(\?|$)/i.test(url)) return "image/gif";
  if (/\.webp(\?|$)/i.test(url)) return "image/webp";
  return "image/jpeg";
}

// ─── Class ────────────────────────────────────────────────────────────────────

class VisionPipeline {
  private anthropic: Anthropic;
  private cache: Map<string, VisionAnalysisResult>;

  constructor() {
    this.anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    this.cache = new Map();
    Logger.info("[VisionPipeline] Initialized");
  }

  // ── Public: main entry ───────────────────────────────────────────────────

  async analyze(request: VisionAnalysisRequest): Promise<VisionAnalysisResult> {
    const startMs = Date.now();
    Logger.info("[VisionPipeline] analyze", { tasks: request.tasks });

    const { data: imageData, mediaType } = await this.prepareImageSource(request.imageSource);
    const imageId = this.buildImageHash(imageData);

    const cached = this.cache.get(imageId);
    if (cached) {
      Logger.debug("[VisionPipeline] cache hit", { imageId });
      return cached;
    }

    const result: VisionAnalysisResult = {
      imageId,
      confidence: 0.9,
      processingTimeMs: 0,
      source: "claude_vision",
    };

    const tasks = request.tasks;

    try {
      const promises: Promise<void>[] = [];

      if (tasks.includes("describe")) {
        promises.push(
          (async () => {
            result.description = await this.analyzeWithClaude(
              imageData,
              mediaType,
              this.buildAnalysisPrompt(["describe"])
            );
          })()
        );
      }

      if (tasks.includes("ocr")) {
        promises.push(
          (async () => {
            const imageBuffer = Buffer.from(imageData, "base64");
            result.extractedText = await this.extractTextOCR(imageBuffer);
            result.source = "hybrid";
          })()
        );
      }

      if (tasks.includes("chart_analysis")) {
        promises.push(
          (async () => {
            result.chartData = await this.analyzeChart(imageData, mediaType);
          })()
        );
      }

      if (tasks.includes("diagram_to_text")) {
        promises.push(
          (async () => {
            result.diagramDescription = await this.describeDiagram(imageData, mediaType);
          })()
        );
      }

      if (tasks.includes("object_detection")) {
        promises.push(
          (async () => {
            const raw = await this.analyzeWithClaude(
              imageData,
              mediaType,
              this.buildAnalysisPrompt(["object_detection"])
            );
            result.detectedObjects = this.parseDetectedObjects(raw);
          })()
        );
      }

      if (tasks.includes("table_extraction")) {
        promises.push(
          (async () => {
            result.tableData = await this.extractTableData(imageData, mediaType);
          })()
        );
      }

      if (tasks.includes("code_screenshot")) {
        promises.push(
          (async () => {
            result.extractedCode = await this.extractCodeFromScreenshot(imageData, mediaType);
          })()
        );
      }

      await Promise.all(promises);
    } catch (err) {
      Logger.error("[VisionPipeline] analyze error", err);
      throw err;
    }

    result.processingTimeMs = Date.now() - startMs;
    this.cache.set(imageId, result);
    Logger.info("[VisionPipeline] analysis complete", {
      imageId,
      processingTimeMs: result.processingTimeMs,
    });
    return result;
  }

  // ── Claude Vision call ───────────────────────────────────────────────────

  async analyzeWithClaude(
    imageData: string | Buffer,
    mediaType: string,
    prompt: string
  ): Promise<string> {
    const base64 =
      Buffer.isBuffer(imageData) ? imageData.toString("base64") : imageData;

    const validMediaType: ValidMediaType = isValidMediaType(mediaType)
      ? mediaType
      : "image/jpeg";

    Logger.debug("[VisionPipeline] calling Claude Vision API");

    const response = await this.anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: validMediaType,
                data: base64,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock && textBlock.type === "text" ? textBlock.text : "";
  }

  // ── OCR via Tesseract ────────────────────────────────────────────────────

  async extractTextOCR(imageBuffer: Buffer): Promise<string> {
    Logger.debug("[VisionPipeline] running Tesseract OCR");
    try {
      const result = await Tesseract.recognize(imageBuffer, "eng");
      return result.data.text.trim();
    } catch (err) {
      Logger.error("[VisionPipeline] Tesseract OCR failed", err);
      return "";
    }
  }

  // ── Chart analysis ───────────────────────────────────────────────────────

  async analyzeChart(imageData: string | Buffer, mediaType: string): Promise<ChartData> {
    Logger.debug("[VisionPipeline] analyzeChart");
    const prompt = `Analyze this chart or graph in detail.
Return a JSON object with these fields:
{
  "chartType": "bar"|"line"|"pie"|"scatter"|"table"|"other",
  "title": string or null,
  "xAxis": { "label": string, "values": string[] } or null,
  "yAxis": { "label": string, "values": number[] } or null,
  "series": [ { "name": string, "data": number[] } ],
  "summary": "one-sentence description"
}
Return ONLY valid JSON, no markdown fences.`;

    const raw = await this.analyzeWithClaude(imageData, mediaType, prompt);
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      return JSON.parse(cleaned) as ChartData;
    } catch {
      Logger.warn("[VisionPipeline] failed to parse chart JSON, returning fallback");
      return { chartType: "other", summary: raw };
    }
  }

  // ── Table extraction ─────────────────────────────────────────────────────

  async extractTableData(
    imageData: string | Buffer,
    mediaType: string
  ): Promise<Array<Record<string, string>>> {
    Logger.debug("[VisionPipeline] extractTableData");
    const prompt = `Extract the table from this image as a markdown table (pipe-separated).
If there is no table, return an empty markdown table with just a header row.
Return ONLY the markdown table, nothing else.`;

    const raw = await this.analyzeWithClaude(imageData, mediaType, prompt);
    return this.parseTableFromMarkdown(raw);
  }

  // ── Diagram description ──────────────────────────────────────────────────

  async describeDiagram(imageData: string | Buffer, mediaType: string): Promise<string> {
    Logger.debug("[VisionPipeline] describeDiagram");
    const prompt = `This image shows a diagram, flowchart, architecture diagram, or similar visual.
Provide a clear textual description that captures:
1. The type of diagram
2. All components/nodes
3. The relationships and flow between components
4. Any labels or annotations
Be structured and thorough.`;
    return this.analyzeWithClaude(imageData, mediaType, prompt);
  }

  // ── Code screenshot extraction ───────────────────────────────────────────

  async extractCodeFromScreenshot(imageData: string | Buffer, mediaType: string): Promise<string> {
    Logger.debug("[VisionPipeline] extractCodeFromScreenshot");
    const prompt = `Extract all code visible in this screenshot.
Return ONLY the code itself, preserving indentation and formatting.
Do not include any explanation or markdown fences.`;
    return this.analyzeWithClaude(imageData, mediaType, prompt);
  }

  // ── Batch analysis ───────────────────────────────────────────────────────

  async batchAnalyze(requests: VisionAnalysisRequest[]): Promise<VisionAnalysisResult[]> {
    Logger.info("[VisionPipeline] batchAnalyze", { count: requests.length });
    const concurrencyLimit = 3;
    const results: VisionAnalysisResult[] = [];

    for (let i = 0; i < requests.length; i += concurrencyLimit) {
      const batch = requests.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.all(batch.map((r) => this.analyze(r)));
      results.push(...batchResults);
    }

    return results;
  }

  // ── Private: prepare image source ────────────────────────────────────────

  private async prepareImageSource(
    source: VisionAnalysisRequest["imageSource"]
  ): Promise<{ data: string; mediaType: string }> {
    if (source.type === "base64") {
      const mt = isValidMediaType(source.mediaType) ? source.mediaType : "image/jpeg";
      return { data: source.data, mediaType: mt };
    }

    if (source.type === "buffer") {
      const mt =
        source.mediaType && isValidMediaType(source.mediaType)
          ? source.mediaType
          : "image/jpeg";
      return { data: source.buffer.toString("base64"), mediaType: mt };
    }

    // URL: download and convert
    Logger.debug("[VisionPipeline] downloading image from URL", { url: source.url });
    const response = await axios.get<ArrayBuffer>(source.url, {
      responseType: "arraybuffer",
      timeout: 30_000,
    });

    const contentType = (response.headers["content-type"] as string | undefined) ?? "";
    const detectedMt = isValidMediaType(contentType) ? contentType : guessMimeFromUrl(source.url);
    const base64 = Buffer.from(response.data).toString("base64");

    return { data: base64, mediaType: detectedMt };
  }

  // ── Private: image hash ──────────────────────────────────────────────────

  private buildImageHash(imageData: string): string {
    return crypto.createHash("sha256").update(imageData.slice(0, 1000)).digest("hex");
  }

  // ── Private: analysis prompt builder ────────────────────────────────────

  private buildAnalysisPrompt(tasks: VisionTask[]): string {
    const parts: string[] = [];

    if (tasks.includes("describe")) {
      parts.push("Provide a detailed general description of this image.");
    }
    if (tasks.includes("object_detection")) {
      parts.push(
        `List all distinct objects you can see in the image. For each object, provide:
- label: the object name
- location: approximate position (top-left, top-center, top-right, center-left, center, center-right, bottom-left, bottom-center, bottom-right)
- confidence: your confidence level as a number 0.0-1.0
Format as a JSON array: [{"label":"...","location":"...","confidence":0.9}]`
      );
    }
    if (tasks.includes("ocr")) {
      parts.push("Extract all visible text from the image, preserving line breaks where appropriate.");
    }

    return parts.join("\n\n");
  }

  // ── Private: parse detected objects ─────────────────────────────────────

  private parseDetectedObjects(raw: string): DetectedObject[] {
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) return [];
      return JSON.parse(match[0]) as DetectedObject[];
    } catch {
      Logger.warn("[VisionPipeline] could not parse detected objects JSON");
      return [];
    }
  }

  // ── Private: parse markdown table ────────────────────────────────────────

  private parseTableFromMarkdown(markdown: string): Array<Record<string, string>> {
    const lines = markdown
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("|") && l.endsWith("|"));

    if (lines.length < 2) return [];

    // First line is headers, second line is separator, rest are data rows
    const headers = lines[0]
      .split("|")
      .map((h) => h.trim())
      .filter(Boolean);

    const dataLines = lines.slice(2); // skip separator row

    return dataLines.map((line) => {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);

      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = cells[i] ?? "";
      });
      return row;
    });
  }
}

export const visionPipeline = new VisionPipeline();
