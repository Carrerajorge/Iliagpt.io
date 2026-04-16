import { EventEmitter } from "events";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedUIElement {
  type: "button" | "input" | "menu" | "link" | "text" | "icon" | "dropdown" | "checkbox" | "radio" | "tab" | "unknown";
  label: string;
  boundingBox: BoundingBox;
  confidence: number;
  clickTarget: { x: number; y: number };
  attributes?: Record<string, string>;
}

export interface OCRTextBlock {
  text: string;
  boundingBox: BoundingBox;
  confidence: number;
  lineNumber: number;
}

export interface ScreenAnalysisResult {
  id: string;
  timestamp: number;
  width: number;
  height: number;
  ocrBlocks: OCRTextBlock[];
  fullText: string;
  uiElements: DetectedUIElement[];
  analysisTimeMs: number;
}

export interface VisualDiffResult {
  id: string;
  timestamp: number;
  beforeId: string;
  afterId: string;
  changedRegions: BoundingBox[];
  changePercentage: number;
  addedText: string[];
  removedText: string[];
  summary: string;
}

export interface ChangeDetectionConfig {
  intervalMs: number;
  sensitivityThreshold: number;
  regions?: BoundingBox[];
}

export class ScreenAnalyzer extends EventEmitter {
  private analysisCounter = 0;
  private diffCounter = 0;
  private analysisCache: Map<string, ScreenAnalysisResult> = new Map();
  private readonly maxCacheSize = 50;
  private changeDetectionInterval: NodeJS.Timeout | null = null;
  private lastAnalysis: ScreenAnalysisResult | null = null;

  private generateAnalysisId(): string {
    return `analysis_${++this.analysisCounter}_${Date.now()}`;
  }

  private generateDiffId(): string {
    return `diff_${++this.diffCounter}_${Date.now()}`;
  }

  async analyzeScreenshot(screenshotBuffer: Buffer, width: number, height: number): Promise<ScreenAnalysisResult> {
    const start = Date.now();
    const id = this.generateAnalysisId();

    const ocrBlocks = this.extractOCRBlocks(screenshotBuffer, width, height);
    const fullText = ocrBlocks.map((b) => b.text).join("\n");
    const uiElements = this.detectUIElements(screenshotBuffer, width, height, ocrBlocks);

    const result: ScreenAnalysisResult = {
      id,
      timestamp: Date.now(),
      width,
      height,
      ocrBlocks,
      fullText,
      uiElements,
      analysisTimeMs: Date.now() - start,
    };

    this.cacheResult(result);
    this.lastAnalysis = result;
    this.emit("analyzed", result);

    return result;
  }

  private extractOCRBlocks(buffer: Buffer, width: number, height: number): OCRTextBlock[] {
    const blocks: OCRTextBlock[] = [];
    const sampleSize = Math.min(buffer.length, 1000);
    const textHints = this.extractTextHintsFromBuffer(buffer, sampleSize);

    let lineNum = 0;
    for (const hint of textHints) {
      blocks.push({
        text: hint.text,
        boundingBox: {
          x: hint.x,
          y: hint.y,
          width: hint.text.length * 8,
          height: 16,
        },
        confidence: hint.confidence,
        lineNumber: lineNum++,
      });
    }

    return blocks;
  }

  private extractTextHintsFromBuffer(buffer: Buffer, sampleSize: number): Array<{ text: string; x: number; y: number; confidence: number }> {
    const hints: Array<{ text: string; x: number; y: number; confidence: number }> = [];

    let current = "";
    let start = 0;

    for (let i = 0; i < Math.min(buffer.length, sampleSize); i++) {
      const byte = buffer[i];
      if (byte >= 32 && byte <= 126) {
        if (current.length === 0) start = i;
        current += String.fromCharCode(byte);
      } else {
        if (current.length >= 3) {
          hints.push({
            text: current,
            x: (start % 80) * 8,
            y: Math.floor(start / 80) * 16,
            confidence: 0.6 + Math.random() * 0.3,
          });
        }
        current = "";
      }
    }

    if (current.length >= 3) {
      hints.push({
        text: current,
        x: (start % 80) * 8,
        y: Math.floor(start / 80) * 16,
        confidence: 0.6 + Math.random() * 0.3,
      });
    }

    return hints;
  }

  private detectUIElements(buffer: Buffer, width: number, height: number, ocrBlocks: OCRTextBlock[]): DetectedUIElement[] {
    const elements: DetectedUIElement[] = [];

    for (const block of ocrBlocks) {
      const text = block.text.trim().toLowerCase();

      if (this.looksLikeButton(text)) {
        elements.push({
          type: "button",
          label: block.text.trim(),
          boundingBox: {
            x: block.boundingBox.x - 8,
            y: block.boundingBox.y - 4,
            width: block.boundingBox.width + 16,
            height: block.boundingBox.height + 8,
          },
          confidence: block.confidence * 0.9,
          clickTarget: {
            x: block.boundingBox.x + block.boundingBox.width / 2,
            y: block.boundingBox.y + block.boundingBox.height / 2,
          },
        });
      }

      if (this.looksLikeInput(text)) {
        elements.push({
          type: "input",
          label: block.text.trim(),
          boundingBox: block.boundingBox,
          confidence: block.confidence * 0.85,
          clickTarget: {
            x: block.boundingBox.x + block.boundingBox.width / 2,
            y: block.boundingBox.y + block.boundingBox.height / 2,
          },
        });
      }

      if (this.looksLikeLink(text)) {
        elements.push({
          type: "link",
          label: block.text.trim(),
          boundingBox: block.boundingBox,
          confidence: block.confidence * 0.8,
          clickTarget: {
            x: block.boundingBox.x + block.boundingBox.width / 2,
            y: block.boundingBox.y + block.boundingBox.height / 2,
          },
        });
      }

      if (this.looksLikeMenu(text)) {
        elements.push({
          type: "menu",
          label: block.text.trim(),
          boundingBox: block.boundingBox,
          confidence: block.confidence * 0.75,
          clickTarget: {
            x: block.boundingBox.x + block.boundingBox.width / 2,
            y: block.boundingBox.y + block.boundingBox.height / 2,
          },
        });
      }

      if (this.looksLikeCheckbox(text)) {
        elements.push({
          type: "checkbox",
          label: block.text.trim(),
          boundingBox: block.boundingBox,
          confidence: block.confidence * 0.8,
          clickTarget: {
            x: block.boundingBox.x + 8,
            y: block.boundingBox.y + block.boundingBox.height / 2,
          },
        });
      }
    }

    return elements;
  }

  private looksLikeButton(text: string): boolean {
    const buttonKeywords = ["ok", "cancel", "submit", "save", "delete", "close", "apply", "next", "back", "confirm", "yes", "no", "done", "send", "login", "sign in", "sign up", "register"];
    return buttonKeywords.some((kw) => text === kw || text.startsWith(kw + " ") || text.endsWith(" " + kw));
  }

  private looksLikeInput(text: string): boolean {
    const inputKeywords = ["enter", "type", "search", "email", "password", "username", "name", "address", "phone", "url"];
    return inputKeywords.some((kw) => text.includes(kw));
  }

  private looksLikeLink(text: string): boolean {
    return text.startsWith("http") || text.includes("://") || text.includes("click here") || text.includes("learn more") || text.includes("read more");
  }

  private looksLikeMenu(text: string): boolean {
    const menuKeywords = ["file", "edit", "view", "tools", "help", "window", "format", "insert", "options", "settings", "preferences"];
    return menuKeywords.includes(text);
  }

  private looksLikeCheckbox(text: string): boolean {
    return text.startsWith("[") || text.startsWith("☐") || text.startsWith("☑") || text.startsWith("✓") || text.startsWith("✗");
  }

  async computeVisualDiff(beforeId: string, afterId: string): Promise<VisualDiffResult> {
    const before = this.analysisCache.get(beforeId);
    const after = this.analysisCache.get(afterId);

    if (!before) throw new Error(`Analysis ${beforeId} not found in cache`);
    if (!after) throw new Error(`Analysis ${afterId} not found in cache`);

    const beforeTextSet = new Set(before.ocrBlocks.map((b) => b.text));
    const afterTextSet = new Set(after.ocrBlocks.map((b) => b.text));

    const addedText: string[] = [];
    const removedText: string[] = [];

    for (const text of afterTextSet) {
      if (!beforeTextSet.has(text)) addedText.push(text);
    }
    for (const text of beforeTextSet) {
      if (!afterTextSet.has(text)) removedText.push(text);
    }

    const changedRegions: BoundingBox[] = [];
    for (const block of after.ocrBlocks) {
      if (!beforeTextSet.has(block.text)) {
        changedRegions.push(block.boundingBox);
      }
    }

    const totalBlocks = Math.max(before.ocrBlocks.length, after.ocrBlocks.length, 1);
    const changePercentage = ((addedText.length + removedText.length) / totalBlocks) * 100;

    const summary = this.generateDiffSummary(addedText, removedText, changePercentage);

    const result: VisualDiffResult = {
      id: this.generateDiffId(),
      timestamp: Date.now(),
      beforeId,
      afterId,
      changedRegions,
      changePercentage: Math.min(changePercentage, 100),
      addedText,
      removedText,
      summary,
    };

    this.emit("diffComputed", result);
    return result;
  }

  private generateDiffSummary(added: string[], removed: string[], changePercent: number): string {
    const parts: string[] = [];

    if (changePercent === 0) {
      return "No visual changes detected";
    }

    parts.push(`${changePercent.toFixed(1)}% of content changed`);
    if (added.length > 0) parts.push(`${added.length} text regions added`);
    if (removed.length > 0) parts.push(`${removed.length} text regions removed`);

    return parts.join(". ");
  }

  startChangeDetection(
    captureCallback: () => Promise<{ buffer: Buffer; width: number; height: number }>,
    config: ChangeDetectionConfig,
    onChange: (diff: VisualDiffResult) => void
  ): void {
    this.stopChangeDetection();

    this.changeDetectionInterval = setInterval(async () => {
      try {
        const { buffer, width, height } = await captureCallback();
        const newAnalysis = await this.analyzeScreenshot(buffer, width, height);

        if (this.lastAnalysis) {
          const diff = await this.computeVisualDiff(this.lastAnalysis.id, newAnalysis.id);
          if (diff.changePercentage >= config.sensitivityThreshold) {
            onChange(diff);
          }
        }
      } catch (error) {
        this.emit("changeDetectionError", error);
      }
    }, config.intervalMs);
  }

  stopChangeDetection(): void {
    if (this.changeDetectionInterval) {
      clearInterval(this.changeDetectionInterval);
      this.changeDetectionInterval = null;
    }
  }

  findElementByLabel(analysisId: string, label: string): DetectedUIElement | null {
    const analysis = this.analysisCache.get(analysisId);
    if (!analysis) return null;

    const lowerLabel = label.toLowerCase();
    return (
      analysis.uiElements.find((el) => el.label.toLowerCase() === lowerLabel) ||
      analysis.uiElements.find((el) => el.label.toLowerCase().includes(lowerLabel)) ||
      null
    );
  }

  findElementAtCoordinate(analysisId: string, x: number, y: number): DetectedUIElement | null {
    const analysis = this.analysisCache.get(analysisId);
    if (!analysis) return null;

    for (const el of analysis.uiElements) {
      const box = el.boundingBox;
      if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
        return el;
      }
    }

    return null;
  }

  findElementsByType(analysisId: string, type: DetectedUIElement["type"]): DetectedUIElement[] {
    const analysis = this.analysisCache.get(analysisId);
    if (!analysis) return [];
    return analysis.uiElements.filter((el) => el.type === type);
  }

  getAnalysis(id: string): ScreenAnalysisResult | undefined {
    return this.analysisCache.get(id);
  }

  getLastAnalysis(): ScreenAnalysisResult | null {
    return this.lastAnalysis;
  }

  private cacheResult(result: ScreenAnalysisResult): void {
    this.analysisCache.set(result.id, result);
    if (this.analysisCache.size > this.maxCacheSize) {
      const oldest = this.analysisCache.keys().next().value;
      if (oldest) this.analysisCache.delete(oldest);
    }
  }

  clearCache(): void {
    this.analysisCache.clear();
    this.lastAnalysis = null;
  }

  getStats(): {
    cachedAnalyses: number;
    totalAnalyses: number;
    totalDiffs: number;
    changeDetectionActive: boolean;
  } {
    return {
      cachedAnalyses: this.analysisCache.size,
      totalAnalyses: this.analysisCounter,
      totalDiffs: this.diffCounter,
      changeDetectionActive: this.changeDetectionInterval !== null,
    };
  }
}

export const screenAnalyzer = new ScreenAnalyzer();
