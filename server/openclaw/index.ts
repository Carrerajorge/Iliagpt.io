import type { Server as HttpServer } from 'http';
import { getOpenClawConfig } from './config';
import { Logger } from '../lib/logger';

export async function initializeOpenClaw(httpServer: HttpServer): Promise<void> {
  const config = getOpenClawConfig();

  const enabledModules: string[] = [];

  if (config.gateway.enabled) {
    const { initGateway } = await import('./gateway/wsServer');
    await initGateway(httpServer, config);
    enabledModules.push('gateway');
  }

  if (config.tools.enabled) {
    const { registerOpenClawTools } = await import('./tools/adapter');
    registerOpenClawTools(config);
    enabledModules.push('tools');
  }

  if (config.plugins.enabled) {
    const { initPlugins } = await import('./plugins/pluginLoader');
    await initPlugins(config);
    enabledModules.push('plugins');
  }

  if (config.skills.enabled) {
    const { initSkills } = await import('./skills/skillLoader');
    await initSkills(config);
    enabledModules.push('skills');
  }

  if (config.streaming.enabled) {
    const { initStreaming } = await import('./streaming/adapter');
    initStreaming(config);
    enabledModules.push('streaming');
  }

  if (enabledModules.length > 0) {
    Logger.info(`[OpenClaw] Initialized: [${enabledModules.join(', ')}]`);
  } else {
    Logger.info('[OpenClaw] All modules disabled (set ENABLE_OPENCLAW_* env vars to enable)');
  }
}
