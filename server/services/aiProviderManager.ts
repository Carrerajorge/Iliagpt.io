/**
 * Enhanced AI Provider Management
 * Retry logic, fallback, circuit breaker
 */

import { EventEmitter } from "events";

interface ProviderConfig {
  name: string;
  priority: number;
  maxRetries: number;
  retryDelayMs: number;
  timeoutMs: number;
  enabled: boolean;
}

interface CircuitState {
  failures: number;
  lastFailure: number;
  state: "closed" | "open" | "half-open";
  successCount: number;
}

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { name: "xai", priority: 1, maxRetries: 2, retryDelayMs: 1000, timeoutMs: 60000, enabled: true },
  { name: "gemini", priority: 2, maxRetries: 2, retryDelayMs: 1000, timeoutMs: 60000, enabled: true },
  { name: "openai", priority: 3, maxRetries: 2, retryDelayMs: 1000, timeoutMs: 60000, enabled: true },
  { name: "anthropic", priority: 4, maxRetries: 2, retryDelayMs: 1000, timeoutMs: 60000, enabled: true }
];

class AIProviderManager extends EventEmitter {
  private providers: Map<string, ProviderConfig> = new Map();
  private circuits: Map<string, CircuitState> = new Map();
  private readonly FAILURE_THRESHOLD = 5;
  private readonly RECOVERY_TIME_MS = 30000;
  private readonly HALF_OPEN_SUCCESS_THRESHOLD = 2;

  constructor() {
    super();
    this.setMaxListeners(50);
    
    // Initialize providers
    DEFAULT_PROVIDERS.forEach(p => {
      this.providers.set(p.name, p);
      this.circuits.set(p.name, {
        failures: 0,
        lastFailure: 0,
        state: "closed",
        successCount: 0
      });
    });
  }

  /**
   * Get available providers in priority order
   */
  getAvailableProviders(): string[] {
    const available: Array<{ name: string; priority: number }> = [];
    
    for (const [name, config] of this.providers) {
      if (!config.enabled) continue;
      
      const circuit = this.circuits.get(name)!;
      
      // Check circuit state
      if (circuit.state === "open") {
        // Check if recovery time has passed
        if (Date.now() - circuit.lastFailure > this.RECOVERY_TIME_MS) {
          circuit.state = "half-open";
          circuit.successCount = 0;
        } else {
          continue; // Skip open circuits
        }
      }
      
      available.push({ name, priority: config.priority });
    }
    
    return available.sort((a, b) => a.priority - b.priority).map(p => p.name);
  }

  /**
   * Record success for a provider
   */
  recordSuccess(provider: string): void {
    const circuit = this.circuits.get(provider);
    if (!circuit) return;
    
    if (circuit.state === "half-open") {
      circuit.successCount++;
      if (circuit.successCount >= this.HALF_OPEN_SUCCESS_THRESHOLD) {
        circuit.state = "closed";
        circuit.failures = 0;
        this.emit("circuit_closed", provider);
      }
    } else if (circuit.state === "closed") {
      // Decay failures over time
      circuit.failures = Math.max(0, circuit.failures - 1);
    }
  }

  /**
   * Record failure for a provider
   */
  recordFailure(provider: string, error: Error): void {
    const circuit = this.circuits.get(provider);
    if (!circuit) return;
    
    circuit.failures++;
    circuit.lastFailure = Date.now();
    
    if (circuit.state === "half-open") {
      // Any failure in half-open reopens the circuit
      circuit.state = "open";
      this.emit("circuit_opened", provider, error);
    } else if (circuit.failures >= this.FAILURE_THRESHOLD) {
      circuit.state = "open";
      this.emit("circuit_opened", provider, error);
    }
  }

  /**
   * Get circuit status for all providers
   */
  getCircuitStatus(): Array<{ provider: string; state: CircuitState["state"]; failures: number; lastFailure: number; successCount: number }> {
    const status: Array<{ provider: string; state: CircuitState["state"]; failures: number; lastFailure: number; successCount: number }> = [];
    
    for (const [name, circuit] of this.circuits) {
      status.push({
        provider: name,
        state: circuit.state,
        failures: circuit.failures,
        lastFailure: circuit.lastFailure,
        successCount: circuit.successCount,
      });
    }
    
    return status;
  }

  /**
   * Force reset a circuit
   */
  resetCircuit(provider: string): boolean {
    const circuit = this.circuits.get(provider);
    if (!circuit) return false;
    
    circuit.state = "closed";
    circuit.failures = 0;
    circuit.successCount = 0;
    return true;
  }

  /**
   * Execute with retry and fallback
   */
  async executeWithFallback<T>(
    operation: (provider: string) => Promise<T>,
    options: {
      preferredProvider?: string;
      maxAttempts?: number;
    } = {}
  ): Promise<{ result: T; provider: string; attempts: number }> {
    const { preferredProvider, maxAttempts = 3 } = options;
    const providers = this.getAvailableProviders();
    
    // Put preferred provider first if specified
    if (preferredProvider && providers.includes(preferredProvider)) {
      const idx = providers.indexOf(preferredProvider);
      providers.splice(idx, 1);
      providers.unshift(preferredProvider);
    }
    
    let lastError: Error = new Error("No providers available");
    let attempts = 0;
    
    for (const provider of providers) {
      const config = this.providers.get(provider)!;
      
      for (let retry = 0; retry < config.maxRetries && attempts < maxAttempts; retry++) {
        attempts++;
        
        try {
          // Execute with timeout
          const result = await Promise.race([
            operation(provider),
            new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error("Timeout")), config.timeoutMs)
            )
          ]);
          
          this.recordSuccess(provider);
          return { result, provider, attempts };
        } catch (error: any) {
          lastError = error;
          this.recordFailure(provider, error);
          
          // Wait before retry
          if (retry < config.maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, config.retryDelayMs));
          }
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Update provider config
   */
  updateProvider(name: string, config: Partial<ProviderConfig>): boolean {
    const existing = this.providers.get(name);
    if (!existing) return false;
    
    this.providers.set(name, { ...existing, ...config });
    return true;
  }
}

export const aiProviderManager = new AIProviderManager();

/**
 * Streaming response handler with buffering
 */
export class StreamBuffer {
  private buffer: string = "";
  private chunks: string[] = [];
  private onChunk: (chunk: string) => void;
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly FLUSH_INTERVAL_MS = 50;

  constructor(onChunk: (chunk: string) => void) {
    this.onChunk = onChunk;
    this.startFlushing();
  }

  push(text: string): void {
    this.buffer += text;
  }

  private startFlushing(): void {
    this.flushInterval = setInterval(() => {
      if (this.buffer.length > 0) {
        this.onChunk(this.buffer);
        this.chunks.push(this.buffer);
        this.buffer = "";
      }
    }, this.FLUSH_INTERVAL_MS);
  }

  flush(): void {
    if (this.buffer.length > 0) {
      this.onChunk(this.buffer);
      this.chunks.push(this.buffer);
      this.buffer = "";
    }
  }

  getFullText(): string {
    return this.chunks.join("") + this.buffer;
  }

  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush();
  }
}

/**
 * Response quality analyzer
 */
export class ResponseQualityAnalyzer {
  analyze(response: string): {
    quality: "low" | "medium" | "high";
    score: number;
    issues: string[];
  } {
    const issues: string[] = [];
    let score = 100;

    // Check length
    if (response.length < 50) {
      issues.push("Response too short");
      score -= 20;
    }

    // Check for error patterns
    if (/error|failed|unable to/i.test(response)) {
      issues.push("Contains error indicators");
      score -= 15;
    }

    // Check for incomplete sentences
    if (!/[.!?]$/.test(response.trim())) {
      issues.push("May be incomplete");
      score -= 10;
    }

    // Check for repetition
    const words = response.toLowerCase().split(/\s+/);
    const uniqueRatio = new Set(words).size / words.length;
    if (uniqueRatio < 0.5) {
      issues.push("High word repetition");
      score -= 15;
    }

    // Check for hallucination patterns
    if (/I don't have access|I cannot browse|as of my knowledge cutoff/i.test(response)) {
      issues.push("Model limitation mentioned");
      score -= 5;
    }

    return {
      quality: score >= 80 ? "high" : score >= 60 ? "medium" : "low",
      score: Math.max(0, score),
      issues
    };
  }
}

export const responseAnalyzer = new ResponseQualityAnalyzer();

/**
 * Context window manager
 */
export class ContextManager {
  private readonly MAX_TOKENS = 128000;
  private readonly RESERVE_TOKENS = 4000; // For response

  estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  truncateContext(messages: Array<{ role: string; content: string }>): Array<{ role: string; content: string }> {
    const availableTokens = this.MAX_TOKENS - this.RESERVE_TOKENS;
    let totalTokens = 0;
    const result: Array<{ role: string; content: string }> = [];

    // Always keep system message if present
    const systemMessage = messages.find(m => m.role === "system");
    if (systemMessage) {
      totalTokens += this.estimateTokens(systemMessage.content);
      result.push(systemMessage);
    }

    // Add messages from newest to oldest
    const nonSystemMessages = messages.filter(m => m.role !== "system").reverse();
    
    for (const msg of nonSystemMessages) {
      const msgTokens = this.estimateTokens(msg.content);
      if (totalTokens + msgTokens <= availableTokens) {
        result.unshift(msg);
        totalTokens += msgTokens;
      } else {
        break;
      }
    }

    return result;
  }

  summarizeOldMessages(messages: Array<{ role: string; content: string }>): string {
    // Create a brief summary of truncated messages
    const truncatedCount = messages.length;
    return `[${truncatedCount} earlier messages summarized: User and assistant discussed various topics. Key context preserved in recent messages.]`;
  }
}

export const contextManager = new ContextManager();
