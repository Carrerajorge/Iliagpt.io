import { OPENCLAW_VERSION } from '../fusion/v2026_4_2';

export interface OpenClawHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  modules: {
    gateway: { active: boolean; clients: number };
    tools: { registered: number; lastExec?: number };
    skills: { loaded: number };
    plugins: { loaded: number };
    streaming: { active: boolean };
  };
  uptime: number;
  version: string;
}

export function getOpenClawHealth(): OpenClawHealthStatus {
  let gatewayClients = 0;
  let gatewayActive = false;
  try {
    // Dynamic import avoids hard dependency if gateway is disabled
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getConnectedClients } = require('../gateway/wsServer');
    gatewayClients = getConnectedClients();
    gatewayActive = true;
  } catch {
    // Gateway not initialized
  }

  let toolsRegistered = 0;
  try {
    const { toolRegistry } = require('../../agent/toolRegistry');
    toolsRegistered = toolRegistry.list().length;
  } catch {
    // Tool registry not available
  }

  let skillsLoaded = 0;
  try {
    const { skillRegistry } = require('../skills/skillRegistry');
    skillsLoaded = skillRegistry.list().length;
  } catch {
    // Skills not loaded
  }

  let pluginsLoaded = 0;
  try {
    const { pluginRegistry } = require('../plugins/pluginRegistry');
    pluginsLoaded = pluginRegistry.list().length;
  } catch {
    // Plugins not loaded
  }

  const streamingActive = process.env.ENABLE_OPENCLAW_STREAMING === 'true';

  // Determine overall health
  let status: OpenClawHealthStatus['status'] = 'healthy';
  if (toolsRegistered === 0 && skillsLoaded === 0) {
    status = 'unhealthy';
  } else if (
    (process.env.ENABLE_OPENCLAW_GATEWAY === 'true' && !gatewayActive) ||
    toolsRegistered === 0
  ) {
    status = 'degraded';
  }

  return {
    status,
    modules: {
      gateway: { active: gatewayActive, clients: gatewayClients },
      tools: { registered: toolsRegistered },
      skills: { loaded: skillsLoaded },
      plugins: { loaded: pluginsLoaded },
      streaming: { active: streamingActive },
    },
    uptime: process.uptime(),
    version: OPENCLAW_VERSION,
  };
}
