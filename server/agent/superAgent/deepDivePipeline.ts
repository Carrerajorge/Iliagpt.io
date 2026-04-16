import { EventEmitter } from "events";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { SourceSignal } from "./contracts";

export interface DeepDiveConfig {
  maxSources: number;
  maxConcurrency: number;
  timeoutMs: number;
  minContentLength: number;
}

const DEFAULT_CONFIG: DeepDiveConfig = {
  maxSources: 20,
  maxConcurrency: 5,
  timeoutMs: 10000,
  minContentLength: 200,
};

export interface DeepDiveProgress {
  fetched: number;
  total: number;
  phase: "starting" | "fetching" | "extracting" | "completed" | "error";
}

export interface ExtractedContent {
  sourceId: string;
  url: string;
  title: string;
  content: string;
  claims: string[];
  wordCount: number;
  success: boolean;
  error?: string;
}

export interface DeepDiveResult {
  sources: ExtractedContent[];
  totalFetched: number;
  totalSuccess: number;
  durationMs: number;
  errors: string[];
}

export class DeepDivePipeline extends EventEmitter {
  private config: DeepDiveConfig;
  private errors: string[] = [];
  private startTime: number = 0;

  constructor(config: Partial<DeepDiveConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private extractClaims(content: string): string[] {
    const claims: string[] = [];
    
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
    
    const claimPatterns = [
      /\b\d+(?:\.\d+)?%/,
      /\$\d+(?:,\d{3})*(?:\.\d+)?/,
      /\b\d{4}\b/,
      /\baccording to\b/i,
      /\bstudy\s+(?:found|shows|reveals)\b/i,
      /\bresearch\s+(?:indicates|suggests)\b/i,
      /\b(?:increased|decreased|grew|fell)\s+by\b/i,
      /\b(?:million|billion|trillion)\b/i,
    ];

    for (const sentence of sentences) {
      for (const pattern of claimPatterns) {
        if (pattern.test(sentence)) {
          const claim = sentence.trim().substring(0, 300);
          if (!claims.includes(claim)) {
            claims.push(claim);
          }
          break;
        }
      }
      
      if (claims.length >= 10) break;
    }

    return claims;
  }

  private async fetchAndExtract(signal: SourceSignal): Promise<ExtractedContent> {
    const result: ExtractedContent = {
      sourceId: signal.id,
      url: signal.url,
      title: signal.title,
      content: "",
      claims: [],
      wordCount: 0,
      success: false,
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(signal.url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)",
          "Accept": "text/html,application/xhtml+xml",
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) {
        throw new Error(`Unsupported content type: ${contentType}`);
      }

      const html = await response.text();
      
      const dom = new JSDOM(html, { url: signal.url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (article && article.textContent) {
        result.content = article.textContent.substring(0, 10000);
        result.title = article.title || signal.title;
        result.wordCount = result.content.split(/\s+/).length;
        
        if (result.wordCount >= this.config.minContentLength / 5) {
          result.claims = this.extractClaims(result.content);
          result.success = true;
        } else {
          throw new Error("Content too short");
        }
      } else {
        throw new Error("Could not extract article content");
      }
    } catch (error: any) {
      result.error = error.message;
      this.errors.push(`${signal.url}: ${error.message}`);
    }

    return result;
  }

  async deepDive(signals: SourceSignal[]): Promise<DeepDiveResult> {
    this.startTime = Date.now();
    this.errors = [];

    const sortedSignals = [...signals]
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.maxSources);

    this.emit("progress", {
      fetched: 0,
      total: sortedSignals.length,
      phase: "starting",
    } as DeepDiveProgress);

    const results: ExtractedContent[] = [];
    
    const batches: SourceSignal[][] = [];
    for (let i = 0; i < sortedSignals.length; i += this.config.maxConcurrency) {
      batches.push(sortedSignals.slice(i, i + this.config.maxConcurrency));
    }

    for (const batch of batches) {
      this.emit("progress", {
        fetched: results.length,
        total: sortedSignals.length,
        phase: "fetching",
      } as DeepDiveProgress);

      const batchResults = await Promise.allSettled(
        batch.map(signal => this.fetchAndExtract(signal))
      );

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          results.push(result.value);
          
          if (result.value.success) {
            this.emit("content", result.value);
          }
        }
      }
    }

    this.emit("progress", {
      fetched: results.length,
      total: sortedSignals.length,
      phase: "completed",
    } as DeepDiveProgress);

    return {
      sources: results,
      totalFetched: results.length,
      totalSuccess: results.filter(r => r.success).length,
      durationMs: Date.now() - this.startTime,
      errors: this.errors,
    };
  }
}

export async function deepDiveSources(
  signals: SourceSignal[],
  maxSources: number = 20,
  onProgress?: (progress: DeepDiveProgress) => void,
  onContent?: (content: ExtractedContent) => void
): Promise<DeepDiveResult> {
  const pipeline = new DeepDivePipeline({ maxSources });
  
  if (onProgress) {
    pipeline.on("progress", onProgress);
  }
  
  if (onContent) {
    pipeline.on("content", onContent);
  }
  
  return pipeline.deepDive(signals);
}
