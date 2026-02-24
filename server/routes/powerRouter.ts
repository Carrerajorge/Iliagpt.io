/**
 * ILIAGPT Power Router
 * 
 * Endpoints para el sistema de poder
 */

import { Router, Request, Response } from 'express';
import { powerMode, getPowerStatus, POWER_PRESETS, PowerConfig } from '../services/powerMode';
import { storage } from '../storage';

export const powerRouter = Router();

// Get power status
powerRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const session = req.session as any;
    const userId = (req as any).user?.claims?.sub || session?.authUserId;
    
    const status = getPowerStatus(userId);
    res.json(status);
  } catch (error) {
    console.error('[Power] Status error:', error);
    res.status(500).json({ error: 'Failed to get power status' });
  }
});

// Get available presets
powerRouter.get('/presets', (req: Request, res: Response) => {
  const presets = Object.entries(POWER_PRESETS).map(([name, config]) => ({
    name,
    description: getPresetDescription(name),
    config
  }));
  res.json({ presets });
});

// Apply a preset
powerRouter.post('/preset/:name', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const session = req.session as any;
    const userId = (req as any).user?.claims?.sub || session?.authUserId || 'anonymous';
    
    const result = powerMode.applyPreset(userId, name);
    if (!result) {
      return res.status(404).json({ error: `Preset '${name}' not found` });
    }
    
    res.json({
      success: true,
      preset: name,
      config: result,
      metrics: powerMode.getPowerMetrics(userId)
    });
  } catch (error) {
    console.error('[Power] Preset error:', error);
    res.status(500).json({ error: 'Failed to apply preset' });
  }
});

// Update power config
powerRouter.patch('/config', (req: Request, res: Response) => {
  try {
    const updates = req.body as Partial<PowerConfig>;
    const session = req.session as any;
    const userId = (req as any).user?.claims?.sub || session?.authUserId || 'anonymous';
    
    const result = powerMode.setConfig(userId, updates);
    
    res.json({
      success: true,
      config: result,
      metrics: powerMode.getPowerMetrics(userId)
    });
  } catch (error) {
    console.error('[Power] Config update error:', error);
    res.status(500).json({ error: 'Failed to update config' });
  }
});

// Get capabilities
powerRouter.get('/capabilities', async (req: Request, res: Response) => {
  try {
    const session = req.session as any;
    const userId = (req as any).user?.claims?.sub || session?.authUserId;
    
    const metrics = powerMode.getPowerMetrics(userId);
    
    // Get available tools
    const tools = await getAvailableTools();
    
    // Get available models
    const models = await getAvailableModels();
    
    res.json({
      powerLevel: metrics.powerLevel,
      capabilities: metrics.capabilities,
      limits: metrics.limits,
      tools: tools.length,
      models: models.length,
      features: {
        streaming: true,
        imageGeneration: true,
        codeExecution: true,
        webSearch: true,
        documentGeneration: true,
        dataAnalysis: true,
        multiAgent: true,
        memory: true
      }
    });
  } catch (error) {
    console.error('[Power] Capabilities error:', error);
    res.status(500).json({ error: 'Failed to get capabilities' });
  }
});

// Power boost (temporary power increase)
powerRouter.post('/boost', (req: Request, res: Response) => {
  try {
    const session = req.session as any;
    const userId = (req as any).user?.claims?.sub || session?.authUserId || 'anonymous';
    const { duration = 300000 } = req.body; // 5 minutes default
    
    // Apply turbo preset temporarily
    const originalConfig = powerMode.getConfig(userId);
    powerMode.applyPreset(userId, 'turbo');
    
    // Schedule reset
    setTimeout(() => {
      powerMode.setConfig(userId, originalConfig);
    }, duration);
    
    res.json({
      success: true,
      message: `Power boosted for ${duration / 1000} seconds`,
      metrics: powerMode.getPowerMetrics(userId),
      expiresIn: duration
    });
  } catch (error) {
    console.error('[Power] Boost error:', error);
    res.status(500).json({ error: 'Failed to apply power boost' });
  }
});

// Get system stats
powerRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    // Get system-wide stats
    const [userCount, modelCount, conversationCount] = await Promise.all([
      storage.getUserCount?.() || 0,
      storage.getModelCount?.() || 0,
      storage.getConversationCount?.() || 0
    ]);
    
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    
    res.json({
      system: {
        uptime: formatUptime(uptime),
        uptimeSeconds: uptime,
        memory: {
          used: formatBytes(memory.heapUsed),
          total: formatBytes(memory.heapTotal),
          rss: formatBytes(memory.rss)
        },
        nodeVersion: process.version,
        platform: process.platform
      },
      usage: {
        users: userCount,
        models: modelCount,
        conversations: conversationCount
      },
      version: '2.0.0-power',
      codename: 'ILIAGPT Power Mode'
    });
  } catch (error) {
    console.error('[Power] Stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Helper functions
function getPresetDescription(name: string): string {
  const descriptions: Record<string, string> = {
    turbo: 'Maximum speed with parallel processing and caching',
    research: 'Deep research mode with extended context and web search',
    creative: 'Creative writing with natural pacing and enhanced imagination',
    code: 'Full coding power with shell access and file operations',
    analyst: 'Data analysis with Excel, visualization, and memory',
    stealth: 'Minimal UI feedback for focused work'
  };
  return descriptions[name] || 'Custom preset';
}

async function getAvailableTools(): Promise<string[]> {
  // Return list of available tools
  return [
    'shell', 'file', 'python', 'search', 'browser', 
    'document', 'message', 'plan', 'slides', 'webdev',
    'schedule', 'expose', 'generate', 'research'
  ];
}

async function getAvailableModels(): Promise<any[]> {
  try {
    const models = await storage.getEnabledModels?.();
    return models || [];
  } catch {
    return [];
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

export default powerRouter;
