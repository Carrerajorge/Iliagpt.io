/**
 * Computer Vision Pipeline - Screen Reading and OCR
 *
 * Visual intelligence for understanding screen content:
 * - Screenshot analysis with LLM vision
 * - Element detection and bounding boxes
 * - Text extraction (OCR) from images
 * - UI component recognition
 * - Color and layout analysis
 * - Change detection between screenshots
 * - Visual search (find element by description)
 * - Accessibility analysis
 * - Screen recording frame analysis
 * - Multi-screen support
 */

import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import OpenAI from "openai";
import path from "path";
import fs from "fs/promises";

// ============================================
// Types
// ============================================

export interface VisionQuery {
  image: string;        // base64 encoded image
  query: string;        // what to analyze
  mode: "analyze" | "ocr" | "detect_elements" | "find_element" | "compare" | "accessibility";
  previousImage?: string; // for comparison mode
  targetDescription?: string; // for find_element
  options?: {
    detail?: "low" | "high" | "auto";
    maxTokens?: number;
    includeCoordinates?: boolean;
  };
}

export interface VisionResult {
  id: string;
  mode: string;
  analysis: string;
  elements?: UIElement[];
  text?: string;       // extracted text (OCR)
  changes?: ScreenChange[];
  targetFound?: { found: boolean; coordinates?: { x: number; y: number }; confidence: number };
  accessibility?: AccessibilityReport;
  confidence: number;
  processingTime: number;
}

export interface UIElement {
  id: string;
  type: "button" | "input" | "text" | "image" | "icon" | "menu" | "dropdown" | "checkbox"
    | "radio" | "slider" | "toggle" | "tab" | "link" | "heading" | "paragraph" | "list"
    | "table" | "form" | "modal" | "tooltip" | "card" | "navigation" | "footer" | "header" | "unknown";
  label: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  confidence: number;
  interactable: boolean;
  state?: "enabled" | "disabled" | "focused" | "selected" | "checked" | "unchecked";
  value?: string;
  children?: UIElement[];
}

export interface ScreenChange {
  type: "added" | "removed" | "modified" | "moved";
  description: string;
  region: { x: number; y: number; width: number; height: number };
  significance: "low" | "medium" | "high";
}

export interface AccessibilityReport {
  score: number;        // 0-100
  issues: AccessibilityIssue[];
  suggestions: string[];
  colorContrast: { passed: number; failed: number };
  altTextCoverage: number;
  keyboardNavigation: "full" | "partial" | "none";
  screenReaderFriendly: boolean;
}

export interface AccessibilityIssue {
  type: "contrast" | "alt_text" | "label" | "focus" | "structure" | "aria" | "color";
  severity: "error" | "warning" | "info";
  element: string;
  description: string;
  recommendation: string;
  wcagCriteria?: string;
}

export interface OCRResult {
  fullText: string;
  blocks: TextBlock[];
  language: string;
  confidence: number;
}

export interface TextBlock {
  text: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  confidence: number;
  type: "heading" | "paragraph" | "code" | "label" | "number" | "other";
}

// ============================================
// Vision Pipeline
// ============================================

export class VisionPipeline extends EventEmitter {
  private llmClient: OpenAI;
  private model: string;
  private cache: Map<string, VisionResult> = new Map();
  private cacheMaxAge = 60000; // 1 minute

  constructor(options?: {
    apiKey?: string;
    baseURL?: string;
    model?: string;
  }) {
    super();
    this.llmClient = new OpenAI({
      baseURL: options?.baseURL || (process.env.XAI_API_KEY ? "https://api.x.ai/v1" : "https://api.openai.com/v1"),
      apiKey: options?.apiKey || process.env.XAI_API_KEY || process.env.OPENAI_API_KEY || "missing",
    });
    this.model = options?.model || "grok-2-vision-1212";
  }

  // ============================================
  // Main Analysis Methods
  // ============================================

  async analyze(query: VisionQuery): Promise<VisionResult> {
    const startTime = Date.now();

    switch (query.mode) {
      case "analyze":
        return this.analyzeScreen(query, startTime);
      case "ocr":
        return this.extractText(query, startTime);
      case "detect_elements":
        return this.detectElements(query, startTime);
      case "find_element":
        return this.findElement(query, startTime);
      case "compare":
        return this.compareScreens(query, startTime);
      case "accessibility":
        return this.analyzeAccessibility(query, startTime);
      default:
        return this.analyzeScreen(query, startTime);
    }
  }

  // ============================================
  // Screen Analysis
  // ============================================

  private async analyzeScreen(query: VisionQuery, startTime: number): Promise<VisionResult> {
    const systemPrompt = `You are an expert computer vision AI that analyzes screenshots with extreme precision.

Analyze the screenshot and provide:
1. A detailed description of what's on screen
2. Current application/page state
3. All interactive elements with approximate positions
4. Any notable visual elements (notifications, errors, loading states)
5. The overall layout structure

RESPOND IN JSON:
{
  "analysis": "detailed description",
  "currentState": "what app/page/state",
  "elements": [
    {
      "type": "button|input|text|image|icon|menu|dropdown|checkbox|link|heading|table|form|modal|card|navigation|unknown",
      "label": "element label/text",
      "boundingBox": {"x": num, "y": num, "width": num, "height": num},
      "center": {"x": num, "y": num},
      "confidence": 0-1,
      "interactable": true/false,
      "state": "enabled|disabled|focused|selected",
      "value": "current value if applicable"
    }
  ],
  "layout": "description of layout structure",
  "notifications": ["any alerts or messages"],
  "confidence": 0-1
}`;

    const result = await this.callVisionLLM(systemPrompt, query.query, query.image, query.options);

    return {
      id: randomUUID(),
      mode: "analyze",
      analysis: result.analysis || "Screen analyzed",
      elements: (result.elements || []).map((el: any, i: number) => ({
        id: `elem-${i}`,
        type: el.type || "unknown",
        label: el.label || "",
        boundingBox: el.boundingBox || { x: 0, y: 0, width: 0, height: 0 },
        center: el.center || { x: 0, y: 0 },
        confidence: el.confidence || 0.5,
        interactable: el.interactable ?? false,
        state: el.state,
        value: el.value,
      })),
      confidence: result.confidence || 0.7,
      processingTime: Date.now() - startTime,
    };
  }

  // ============================================
  // OCR - Text Extraction
  // ============================================

  private async extractText(query: VisionQuery, startTime: number): Promise<VisionResult> {
    const systemPrompt = `You are an OCR (Optical Character Recognition) AI. Extract ALL visible text from the screenshot with high accuracy.

For each text block, identify its position and type.

RESPOND IN JSON:
{
  "fullText": "all text concatenated with line breaks",
  "blocks": [
    {
      "text": "exact text content",
      "boundingBox": {"x": num, "y": num, "width": num, "height": num},
      "confidence": 0-1,
      "type": "heading|paragraph|code|label|number|other"
    }
  ],
  "language": "detected language code",
  "confidence": 0-1
}`;

    const result = await this.callVisionLLM(systemPrompt, query.query || "Extract all text from this screenshot", query.image, query.options);

    return {
      id: randomUUID(),
      mode: "ocr",
      analysis: `Extracted ${(result.blocks || []).length} text blocks`,
      text: result.fullText || "",
      confidence: result.confidence || 0.8,
      processingTime: Date.now() - startTime,
    };
  }

  // ============================================
  // Element Detection
  // ============================================

  private async detectElements(query: VisionQuery, startTime: number): Promise<VisionResult> {
    const systemPrompt = `You are a UI element detector. Identify ALL interactive and visual elements in the screenshot.

Categorize each element precisely and provide accurate bounding boxes.

RESPOND IN JSON:
{
  "elements": [
    {
      "type": "button|input|text|image|icon|menu|dropdown|checkbox|radio|slider|toggle|tab|link|heading|paragraph|list|table|form|modal|tooltip|card|navigation|footer|header|unknown",
      "label": "human-readable label",
      "boundingBox": {"x": num, "y": num, "width": num, "height": num},
      "center": {"x": num, "y": num},
      "confidence": 0-1,
      "interactable": true/false,
      "state": "enabled|disabled|focused|selected|checked|unchecked"
    }
  ],
  "totalElements": number,
  "interactableCount": number,
  "confidence": 0-1
}`;

    const result = await this.callVisionLLM(systemPrompt, query.query || "Detect all UI elements", query.image, query.options);

    const elements = (result.elements || []).map((el: any, i: number) => ({
      id: `elem-${i}`,
      type: el.type || "unknown",
      label: el.label || "",
      boundingBox: el.boundingBox || { x: 0, y: 0, width: 0, height: 0 },
      center: el.center || { x: 0, y: 0 },
      confidence: el.confidence || 0.5,
      interactable: el.interactable ?? false,
      state: el.state,
    }));

    return {
      id: randomUUID(),
      mode: "detect_elements",
      analysis: `Detected ${elements.length} elements (${elements.filter((e: UIElement) => e.interactable).length} interactable)`,
      elements,
      confidence: result.confidence || 0.7,
      processingTime: Date.now() - startTime,
    };
  }

  // ============================================
  // Visual Search (Find Element)
  // ============================================

  private async findElement(query: VisionQuery, startTime: number): Promise<VisionResult> {
    const target = query.targetDescription || query.query;

    const systemPrompt = `You are searching for a specific element in a screenshot.

TARGET: "${target}"

Find the element and provide its exact position. If not found, say so.

RESPOND IN JSON:
{
  "found": true/false,
  "coordinates": {"x": num, "y": num},
  "boundingBox": {"x": num, "y": num, "width": num, "height": num},
  "elementType": "type of element found",
  "label": "text/label of the element",
  "confidence": 0-1,
  "alternatives": [
    {"description": "similar element", "coordinates": {"x": num, "y": num}, "confidence": 0-1}
  ],
  "reasoning": "why this is/isn't the target"
}`;

    const result = await this.callVisionLLM(systemPrompt, `Find: ${target}`, query.image, { ...query.options, detail: "high" });

    return {
      id: randomUUID(),
      mode: "find_element",
      analysis: result.found ? `Found "${target}" at (${result.coordinates?.x}, ${result.coordinates?.y})` : `"${target}" not found`,
      targetFound: {
        found: result.found || false,
        coordinates: result.coordinates,
        confidence: result.confidence || 0,
      },
      confidence: result.confidence || 0,
      processingTime: Date.now() - startTime,
    };
  }

  // ============================================
  // Screen Comparison
  // ============================================

  private async compareScreens(query: VisionQuery, startTime: number): Promise<VisionResult> {
    if (!query.previousImage) {
      return {
        id: randomUUID(),
        mode: "compare",
        analysis: "No previous image provided for comparison",
        changes: [],
        confidence: 0,
        processingTime: Date.now() - startTime,
      };
    }

    const systemPrompt = `You are comparing two screenshots to detect changes. The first image is BEFORE and the second is AFTER.

Identify all differences:
- New elements added
- Elements removed
- Elements that changed (text, color, position, size)
- Layout changes
- Status/state changes

RESPOND IN JSON:
{
  "changes": [
    {
      "type": "added|removed|modified|moved",
      "description": "what changed",
      "region": {"x": num, "y": num, "width": num, "height": num},
      "significance": "low|medium|high"
    }
  ],
  "summary": "overall change summary",
  "significantChange": true/false,
  "confidence": 0-1
}`;

    try {
      const response = await this.llmClient.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: query.query || "Compare these two screenshots and identify all changes" },
              { type: "image_url", image_url: { url: `data:image/png;base64,${query.previousImage}`, detail: "high" } },
              { type: "image_url", image_url: { url: `data:image/png;base64,${query.image}`, detail: "high" } },
            ],
          },
        ],
        max_tokens: query.options?.maxTokens || 4096,
        temperature: 0.1,
      });

      const text = response.choices[0]?.message?.content || "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const result = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

      return {
        id: randomUUID(),
        mode: "compare",
        analysis: result.summary || "Comparison complete",
        changes: (result.changes || []).map((c: any) => ({
          type: c.type || "modified",
          description: c.description || "",
          region: c.region || { x: 0, y: 0, width: 0, height: 0 },
          significance: c.significance || "medium",
        })),
        confidence: result.confidence || 0.7,
        processingTime: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        id: randomUUID(),
        mode: "compare",
        analysis: `Comparison error: ${error.message}`,
        changes: [],
        confidence: 0,
        processingTime: Date.now() - startTime,
      };
    }
  }

  // ============================================
  // Accessibility Analysis
  // ============================================

  private async analyzeAccessibility(query: VisionQuery, startTime: number): Promise<VisionResult> {
    const systemPrompt = `You are a web accessibility expert analyzing a screenshot for WCAG 2.1 compliance.

Evaluate:
1. Color contrast ratios (WCAG AA: 4.5:1 for normal text, 3:1 for large text)
2. Text readability (size, spacing, font)
3. Interactive element visibility and size (minimum 44x44px touch targets)
4. Visual hierarchy and structure
5. Missing labels or alt text indicators
6. Focus indicators
7. Form element labeling
8. Error message visibility

RESPOND IN JSON:
{
  "score": 0-100,
  "issues": [
    {
      "type": "contrast|alt_text|label|focus|structure|aria|color",
      "severity": "error|warning|info",
      "element": "description of element",
      "description": "what's wrong",
      "recommendation": "how to fix",
      "wcagCriteria": "WCAG criterion (e.g. 1.4.3)"
    }
  ],
  "suggestions": ["improvement suggestions"],
  "colorContrast": {"passed": num, "failed": num},
  "altTextCoverage": 0-100,
  "keyboardNavigation": "full|partial|none",
  "screenReaderFriendly": true/false,
  "overallAssessment": "summary"
}`;

    const result = await this.callVisionLLM(systemPrompt, query.query || "Analyze accessibility of this page", query.image, { ...query.options, detail: "high" });

    return {
      id: randomUUID(),
      mode: "accessibility",
      analysis: result.overallAssessment || "Accessibility analyzed",
      accessibility: {
        score: result.score || 50,
        issues: (result.issues || []).map((i: any) => ({
          type: i.type || "structure",
          severity: i.severity || "warning",
          element: i.element || "",
          description: i.description || "",
          recommendation: i.recommendation || "",
          wcagCriteria: i.wcagCriteria,
        })),
        suggestions: result.suggestions || [],
        colorContrast: result.colorContrast || { passed: 0, failed: 0 },
        altTextCoverage: result.altTextCoverage || 0,
        keyboardNavigation: result.keyboardNavigation || "partial",
        screenReaderFriendly: result.screenReaderFriendly || false,
      },
      confidence: 0.7,
      processingTime: Date.now() - startTime,
    };
  }

  // ============================================
  // LLM Communication
  // ============================================

  private async callVisionLLM(systemPrompt: string, userPrompt: string, image: string, options?: VisionQuery["options"]): Promise<any> {
    try {
      const response = await this.llmClient.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${image}`,
                  detail: options?.detail || "high",
                },
              },
            ],
          },
        ],
        max_tokens: options?.maxTokens || 4096,
        temperature: 0.1,
      });

      const text = response.choices[0]?.message?.content || "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch (error: any) {
      return { error: error.message, confidence: 0 };
    }
  }

  // ============================================
  // Utility Methods
  // ============================================

  async describeImage(imageBase64: string): Promise<string> {
    try {
      const response = await this.llmClient.chat.completions.create({
        model: this.model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Describe this image in detail." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
          ],
        }],
        max_tokens: 1024,
        temperature: 0.2,
      });

      return response.choices[0]?.message?.content || "Unable to describe image";
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }

  async findAndClick(image: string, description: string): Promise<{ x: number; y: number } | null> {
    const result = await this.analyze({
      image,
      query: description,
      mode: "find_element",
      targetDescription: description,
    });

    if (result.targetFound?.found && result.targetFound.coordinates) {
      return result.targetFound.coordinates;
    }
    return null;
  }
}

// Singleton
export const visionPipeline = new VisionPipeline();
