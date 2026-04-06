import type { Server as HttpServer } from 'http';
import { getOpenClawConfig } from './config';
import { Logger } from '../lib/logger';
import { OPENCLAW_VERSION, initializeV2026_4_2 } from './fusion/v2026_4_2';

export { OPENCLAW_VERSION };

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

  {
    const { initSkills } = await import('./skills/skillLoader');
    await initSkills(config);
    enabledModules.push(`skills(${config.skills.enabled ? 'full' : 'builtins'})`);
  }

  if (config.streaming.enabled) {
    const { initStreaming } = await import('./streaming/adapter');
    initStreaming(config);
    enabledModules.push('streaming');
  }

  const fusionFeatures = await initializeV2026_4_2(config);
  if (fusionFeatures.length > 0) {
    enabledModules.push(`fusion-v${OPENCLAW_VERSION}(${fusionFeatures.length})`);
  }

  if (enabledModules.length > 0) {
    Logger.info(`[OpenClaw] Initialized: [${enabledModules.join(', ')}]`);
  } else {
    Logger.info('[OpenClaw] All modules disabled (set ENABLE_OPENCLAW_* env vars to enable)');
  }
}
