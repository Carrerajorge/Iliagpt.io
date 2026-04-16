import { llmGateway } from "./llmGateway";

interface WarmupConnection {
  model: string;
  lastUsed: number;
  isWarming: boolean;
  ready: boolean;
}

class ModelWarmupManager {
  private connections: Map<string, WarmupConnection> = new Map();
  private warmupInterval: NodeJS.Timeout | null = null;
  private readonly WARMUP_THRESHOLD = 60000;
  private readonly CLEANUP_INTERVAL = 300000;

  constructor() {
    this.startPeriodicWarmup();
  }

  async warmupModel(model: string): Promise<void> {
    const existing = this.connections.get(model);
    
    if (existing?.isWarming) {
      return;
    }

    if (existing?.ready && Date.now() - existing.lastUsed < this.WARMUP_THRESHOLD) {
      return;
    }

    this.connections.set(model, {
      model,
      lastUsed: Date.now(),
      isWarming: true,
      ready: false,
    });

    try {
      await llmGateway.sendMessage({
        messages: [{ role: "user", content: "ping" }],
        model,
        maxTokens: 1,
        stream: false,
      });

      this.connections.set(model, {
        model,
        lastUsed: Date.now(),
        isWarming: false,
        ready: true,
      });

      console.log(`[ModelWarmup] Model ${model} warmed up successfully`);
    } catch (error) {
      this.connections.set(model, {
        model,
        lastUsed: Date.now(),
        isWarming: false,
        ready: false,
      });
      console.error(`[ModelWarmup] Failed to warm up ${model}:`, error);
    }
  }

  async warmupForUser(userId: string, preferredModels?: string[]): Promise<void> {
    const modelsToWarmup = preferredModels || [
      "gemini-2.0-flash",
      "grok-3-fast",
    ];

    await Promise.allSettled(
      modelsToWarmup.map(model => this.warmupModel(model))
    );
  }

  markModelUsed(model: string): void {
    const existing = this.connections.get(model);
    if (existing) {
      existing.lastUsed = Date.now();
    } else {
      this.connections.set(model, {
        model,
        lastUsed: Date.now(),
        isWarming: false,
        ready: true,
      });
    }
  }

  isModelReady(model: string): boolean {
    const connection = this.connections.get(model);
    if (!connection) return false;
    
    return connection.ready && Date.now() - connection.lastUsed < this.WARMUP_THRESHOLD;
  }

  getReadyModels(): string[] {
    return Array.from(this.connections.entries())
      .filter(([_, conn]) => conn.ready)
      .map(([model]) => model);
  }

  private startPeriodicWarmup(): void {
    this.warmupInterval = setInterval(() => {
      this.cleanupStaleConnections();
    }, this.CLEANUP_INTERVAL);
  }

  private cleanupStaleConnections(): void {
    const now = Date.now();
    const staleThreshold = 600000;

    for (const [model, connection] of this.connections) {
      if (now - connection.lastUsed > staleThreshold) {
        this.connections.delete(model);
        console.log(`[ModelWarmup] Cleaned up stale connection for ${model}`);
      }
    }
  }

  shutdown(): void {
    if (this.warmupInterval) {
      clearInterval(this.warmupInterval);
      this.warmupInterval = null;
    }
    this.connections.clear();
  }
}

export const modelWarmupManager = new ModelWarmupManager();

export async function warmupOnUserActivity(userId: string): Promise<void> {
  await modelWarmupManager.warmupForUser(userId);
}

export function warmupOnTyping(userId: string, text: string): void {
  if (text.length > 10) {
    modelWarmupManager.warmupModel("gemini-2.0-flash");
  }
  
  if (text.length > 50) {
    modelWarmupManager.warmupModel("gemini-2.5-pro");
  }
}

export default modelWarmupManager;
