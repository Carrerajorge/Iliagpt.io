import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { SourceSignal, SourceSignalSchema } from "./contracts";
import { searchWeb } from "../../services/webSearch";

export interface SignalsConfig {
  targetCount: number;
  maxConcurrency: number;
  timeoutMs: number;
  resultsPerQuery: number;
}

const DEFAULT_CONFIG: SignalsConfig = {
  targetCount: 100,
  maxConcurrency: 10,
  timeoutMs: 30000,
  resultsPerQuery: 20,
};

export interface SignalsProgress {
  collected: number;
  target: number;
  queriesCompleted: number;
  totalQueries: number;
  phase: "starting" | "collecting" | "completed" | "error";
}

export interface SignalsResult {
  signals: SourceSignal[];
  totalCollected: number;
  queriesExecuted: number;
  durationMs: number;
  errors: string[];
}

export class SignalsPipeline extends EventEmitter {
  private config: SignalsConfig;
  private signals: Map<string, SourceSignal> = new Map();
  private errors: string[] = [];
  private startTime: number = 0;

  constructor(config: Partial<SignalsConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString().toLowerCase().replace(/\/$/, "");
    } catch {
      return url.toLowerCase();
    }
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "unknown";
    }
  }

  private calculateScore(result: any, queryIndex: number): number {
    let score = 1.0 - (queryIndex * 0.05);
    
    const domain = this.extractDomain(result.url || "");
    const trustedDomains = ["gov", "edu", "org", "reuters.com", "bbc.com", "nytimes.com"];
    if (trustedDomains.some(d => domain.includes(d))) {
      score += 0.1;
    }
    
    if (result.snippet && result.snippet.length > 100) {
      score += 0.05;
    }
    
    return Math.min(1.0, Math.max(0.1, score));
  }

  async collectSignals(queries: string[]): Promise<SignalsResult> {
    this.startTime = Date.now();
    this.signals.clear();
    this.errors = [];

    this.emit("progress", {
      collected: 0,
      target: this.config.targetCount,
      queriesCompleted: 0,
      totalQueries: queries.length,
      phase: "starting",
    } as SignalsProgress);

    const expandedQueries = this.expandQueries(queries);
    
    const batches: string[][] = [];
    for (let i = 0; i < expandedQueries.length; i += this.config.maxConcurrency) {
      batches.push(expandedQueries.slice(i, i + this.config.maxConcurrency));
    }

    let queriesCompleted = 0;

    for (const batch of batches) {
      if (this.signals.size >= this.config.targetCount) {
        break;
      }

      const results = await Promise.allSettled(
        batch.map(async (query, idx) => {
          try {
            const searchResponse = await searchWeb(query, this.config.resultsPerQuery);
            return { query, results: searchResponse.results || [], queryIndex: queriesCompleted + idx };
          } catch (error: any) {
            this.errors.push(`Query "${query}": ${error.message}`);
            return { query, results: [], queryIndex: queriesCompleted + idx };
          }
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled" && Array.isArray(result.value.results)) {
          for (const item of result.value.results) {
            if (this.signals.size >= this.config.targetCount) break;

            const itemUrl = item.url || "";
            const normalizedUrl = this.normalizeUrl(itemUrl);
            
            if (!this.signals.has(normalizedUrl) && normalizedUrl.startsWith("http")) {
              const signal: SourceSignal = {
                id: randomUUID(),
                url: itemUrl,
                title: item.title || "Untitled",
                snippet: item.snippet || "",
                domain: this.extractDomain(itemUrl),
                score: this.calculateScore(item, result.value.queryIndex),
                fetched: false,
              };
              
              this.signals.set(normalizedUrl, SourceSignalSchema.parse(signal));
              
              this.emit("signal", signal);
            }
          }
        }
      }

      queriesCompleted += batch.length;

      this.emit("progress", {
        collected: this.signals.size,
        target: this.config.targetCount,
        queriesCompleted,
        totalQueries: expandedQueries.length,
        phase: "collecting",
      } as SignalsProgress);
    }

    this.emit("progress", {
      collected: this.signals.size,
      target: this.config.targetCount,
      queriesCompleted,
      totalQueries: expandedQueries.length,
      phase: "completed",
    } as SignalsProgress);

    return {
      signals: Array.from(this.signals.values()),
      totalCollected: this.signals.size,
      queriesExecuted: queriesCompleted,
      durationMs: Date.now() - this.startTime,
      errors: this.errors,
    };
  }

  private expandQueries(baseQueries: string[]): string[] {
    const expanded: string[] = [...baseQueries];
    
    const suffixes = [
      "",
      " statistics",
      " data",
      " research",
      " report",
      " analysis",
      " 2024",
      " 2025",
      " latest",
      " trends",
    ];

    const needed = Math.ceil(this.config.targetCount / this.config.resultsPerQuery);
    
    for (const query of baseQueries) {
      for (const suffix of suffixes) {
        if (expanded.length >= needed) break;
        const expandedQuery = `${query}${suffix}`.trim();
        if (!expanded.includes(expandedQuery)) {
          expanded.push(expandedQuery);
        }
      }
    }

    return expanded.slice(0, needed);
  }
}

export async function collectSignals(
  queries: string[],
  targetCount: number = 100,
  onProgress?: (progress: SignalsProgress) => void,
  onSignal?: (signal: SourceSignal) => void
): Promise<SignalsResult> {
  const pipeline = new SignalsPipeline({ targetCount });
  
  if (onProgress) {
    pipeline.on("progress", onProgress);
  }
  
  if (onSignal) {
    pipeline.on("signal", onSignal);
  }
  
  return pipeline.collectSignals(queries);
}
