/**
 * ILIAGPT Power Mode
 * 
 * Sistema avanzado que hace que el usuario sienta el poder al usar la aplicación.
 * Inspirado en OpenClaw v2026.1.30
 */

import { EventEmitter } from 'events';

// Power Mode Configuration
export interface PowerConfig {
  // Streaming
  streamingEnabled: boolean;
  blockStreaming: boolean;
  streamingBreak: 'text_end' | 'message_end';
  humanDelay: { enabled: boolean; minMs: number; maxMs: number };
  
  // Agent
  agentMode: 'standard' | 'research' | 'creative' | 'code' | 'analyst';
  maxTools: number;
  parallelTools: boolean;
  
  // Memory
  contextWindow: number;
  memoryEnabled: boolean;
  longTermMemory: boolean;
  
  // Performance
  cacheEnabled: boolean;
  prefetch: boolean;
  
  // UI Feedback
  showProgress: boolean;
  showToolCalls: boolean;
  showTokens: boolean;
}

export const DEFAULT_POWER_CONFIG: PowerConfig = {
  streamingEnabled: true,
  blockStreaming: true,
  streamingBreak: 'text_end',
  humanDelay: { enabled: false, minMs: 100, maxMs: 500 },
  
  agentMode: 'standard',
  maxTools: 10,
  parallelTools: true,
  
  contextWindow: 128000,
  memoryEnabled: true,
  longTermMemory: true,
  
  cacheEnabled: true,
  prefetch: true,
  
  showProgress: true,
  showToolCalls: true,
  showTokens: true
};

// Power Mode Presets
export const POWER_PRESETS: Record<string, Partial<PowerConfig>> = {
  turbo: {
    streamingEnabled: true,
    blockStreaming: true,
    parallelTools: true,
    cacheEnabled: true,
    prefetch: true,
    maxTools: 15,
    showProgress: true
  },
  research: {
    agentMode: 'research',
    maxTools: 20,
    parallelTools: true,
    longTermMemory: true,
    contextWindow: 200000
  },
  creative: {
    agentMode: 'creative',
    humanDelay: { enabled: true, minMs: 200, maxMs: 800 },
    streamingBreak: 'message_end'
  },
  code: {
    agentMode: 'code',
    maxTools: 25,
    parallelTools: true,
    showToolCalls: true,
    contextWindow: 128000
  },
  analyst: {
    agentMode: 'analyst',
    maxTools: 15,
    longTermMemory: true,
    showTokens: true
  },
  stealth: {
    showProgress: false,
    showToolCalls: false,
    showTokens: false,
    humanDelay: { enabled: true, minMs: 500, maxMs: 1500 }
  }
};

// Power Mode Manager
export class PowerModeManager extends EventEmitter {
  private configs: Map<string, PowerConfig> = new Map();
  private globalConfig: PowerConfig = { ...DEFAULT_POWER_CONFIG };
  
  constructor() {
    super();
  }
  
  getConfig(userId?: string): PowerConfig {
    if (userId && this.configs.has(userId)) {
      return this.configs.get(userId)!;
    }
    return this.globalConfig;
  }
  
  setConfig(userId: string, config: Partial<PowerConfig>): PowerConfig {
    const current = this.getConfig(userId);
    const updated = { ...current, ...config };
    this.configs.set(userId, updated);
    this.emit('config:updated', { userId, config: updated });
    return updated;
  }
  
  applyPreset(userId: string, presetName: string): PowerConfig | null {
    const preset = POWER_PRESETS[presetName];
    if (!preset) return null;
    return this.setConfig(userId, preset);
  }
  
  getPresets(): string[] {
    return Object.keys(POWER_PRESETS);
  }
  
  // Power metrics for display
  getPowerMetrics(userId?: string): PowerMetrics {
    const config = this.getConfig(userId);
    return {
      powerLevel: this.calculatePowerLevel(config),
      capabilities: this.getCapabilities(config),
      limits: {
        tools: config.maxTools,
        context: config.contextWindow,
        memory: config.longTermMemory ? 'unlimited' : 'session'
      }
    };
  }
  
  private calculatePowerLevel(config: PowerConfig): number {
    let level = 50; // Base
    
    if (config.streamingEnabled) level += 10;
    if (config.blockStreaming) level += 5;
    if (config.parallelTools) level += 10;
    if (config.longTermMemory) level += 10;
    if (config.cacheEnabled) level += 5;
    if (config.prefetch) level += 5;
    
    level += Math.min(config.maxTools, 25);
    level += Math.floor(config.contextWindow / 20000);
    
    return Math.min(level, 100);
  }
  
  private getCapabilities(config: PowerConfig): string[] {
    const caps: string[] = ['chat', 'completion'];
    
    if (config.streamingEnabled) caps.push('streaming');
    if (config.parallelTools) caps.push('parallel-tools');
    if (config.longTermMemory) caps.push('long-term-memory');
    
    if (config.agentMode === 'research') caps.push('web-search', 'deep-research');
    if (config.agentMode === 'code') caps.push('code-execution', 'file-operations', 'shell');
    if (config.agentMode === 'analyst') caps.push('data-analysis', 'excel', 'visualization');
    if (config.agentMode === 'creative') caps.push('image-generation', 'creative-writing');
    
    return caps;
  }
}

export interface PowerMetrics {
  powerLevel: number;
  capabilities: string[];
  limits: {
    tools: number;
    context: number;
    memory: string;
  };
}

// Singleton instance
export const powerMode = new PowerModeManager();

// Power Mode Middleware
export function powerModeMiddleware() {
  return (req: any, res: any, next: any) => {
    const userId = req.user?.claims?.sub || req.session?.authUserId;
    req.powerConfig = powerMode.getConfig(userId);
    req.powerMetrics = powerMode.getPowerMetrics(userId);
    next();
  };
}

// Power Status endpoint helper
export function getPowerStatus(userId?: string) {
  const config = powerMode.getConfig(userId);
  const metrics = powerMode.getPowerMetrics(userId);
  
  return {
    status: 'active',
    powerLevel: metrics.powerLevel,
    mode: config.agentMode,
    capabilities: metrics.capabilities,
    config: {
      streaming: config.streamingEnabled,
      parallelTools: config.parallelTools,
      memory: config.longTermMemory ? 'persistent' : 'session',
      maxTools: config.maxTools,
      contextWindow: config.contextWindow
    },
    presets: powerMode.getPresets()
  };
}
