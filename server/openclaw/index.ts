import type { Server as HttpServer } from 'http';
import { getOpenClawConfig } from './config';
import { Logger } from '../lib/logger';
import { OPENCLAW_VERSION, initializeV2026_4_3 } from './fusion/v2026_4_3';

export { OPENCLAW_VERSION };

let gatewayInitialized = false;
let streamingInitialized = false;

export async function initializeOpenClaw(httpServer: HttpServer): Promise<void> {
  const config = getOpenClawConfig();

  const enabledModules: string[] = [];

  if (config.gateway.enabled) {
    const { initGateway } = await import('./gateway/wsServer');
    await initGateway(httpServer, config);
    gatewayInitialized = true;
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
    streamingInitialized = true;
    enabledModules.push('streaming');
  }

  const fusionFeatures = await initializeV2026_4_3(config);
  if (fusionFeatures.length > 0) {
    enabledModules.push(`fusion-v${OPENCLAW_VERSION}(${fusionFeatures.length})`);
  }

  if (enabledModules.length > 0) {
    Logger.info(`[OpenClaw] Initialized: [${enabledModules.join(', ')}]`);
  } else {
    Logger.info('[OpenClaw] All modules disabled (set ENABLE_OPENCLAW_* env vars to enable)');
  }
}

export async function shutdownOpenClaw(): Promise<void> {
  Logger.info('[OpenClaw] Shutting down...');

  if (gatewayInitialized) {
    try {
      const { shutdownGateway } = await import('./gateway/wsServer');
      shutdownGateway();
      Logger.info('[OpenClaw] Gateway shut down');
    } catch (err: any) {
      Logger.error(`[OpenClaw] Gateway shutdown error: ${err?.message}`);
    }
  }

  Logger.info('[OpenClaw] Shutdown complete');
}
