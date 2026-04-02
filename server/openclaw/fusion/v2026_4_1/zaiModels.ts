import { Logger } from '../../../lib/logger';

export interface ZaiModelEntry {
  id: string;
  name: string;
  contextWindow: number;
  maxOutput: number;
  modalities: string[];
  pricing?: { prompt: number; completion: number };
}

export const ZAI_MODEL_CATALOG: ZaiModelEntry[] = [
  {
    id: 'zhipu/glm-4-32b',
    name: 'Z.ai: GLM 4 32B',
    contextWindow: 128_000,
    maxOutput: 4096,
    modalities: ['text'],
  },
  {
    id: 'zhipu/glm-4.5-air',
    name: 'Z.ai: GLM 4.5 Air',
    contextWindow: 128_000,
    maxOutput: 4096,
    modalities: ['text'],
  },
  {
    id: 'zhipu/glm-4.5-air:free',
    name: 'Z.ai: GLM 4.5 Air (free)',
    contextWindow: 128_000,
    maxOutput: 4096,
    modalities: ['text'],
    pricing: { prompt: 0, completion: 0 },
  },
  {
    id: 'zhipu/glm-4.5',
    name: 'Z.ai: GLM 4.5',
    contextWindow: 128_000,
    maxOutput: 8192,
    modalities: ['text'],
  },
  {
    id: 'zhipu/glm-4.5v',
    name: 'Z.ai: GLM 4.5V',
    contextWindow: 128_000,
    maxOutput: 4096,
    modalities: ['text', 'vision'],
  },
  {
    id: 'zhipu/glm-4.6',
    name: 'Z.ai: GLM 4.6',
    contextWindow: 1_000_000,
    maxOutput: 16384,
    modalities: ['text'],
  },
  {
    id: 'zhipu/glm-4.6v',
    name: 'Z.ai: GLM 4.6V',
    contextWindow: 1_000_000,
    maxOutput: 8192,
    modalities: ['text', 'vision'],
  },
  {
    id: 'zhipu/glm-4.7',
    name: 'Z.ai: GLM 4.7',
    contextWindow: 1_000_000,
    maxOutput: 16384,
    modalities: ['text'],
  },
  {
    id: 'zhipu/glm-4.7-flash',
    name: 'Z.ai: GLM 4.7 Flash',
    contextWindow: 128_000,
    maxOutput: 8192,
    modalities: ['text'],
  },
  {
    id: 'zhipu/glm-5',
    name: 'Z.ai: GLM 5',
    contextWindow: 1_000_000,
    maxOutput: 32768,
    modalities: ['text'],
  },
  {
    id: 'zhipu/glm-5.1',
    name: 'Z.ai: GLM 5.1',
    contextWindow: 1_000_000,
    maxOutput: 32768,
    modalities: ['text'],
  },
  {
    id: 'zhipu/glm-5v-turbo',
    name: 'Z.ai: GLM 5V Turbo',
    contextWindow: 1_000_000,
    maxOutput: 16384,
    modalities: ['text', 'vision'],
  },
];

export function getZaiModels(): ZaiModelEntry[] {
  return ZAI_MODEL_CATALOG;
}

export function getNewV2026_4_1_Models(): ZaiModelEntry[] {
  return ZAI_MODEL_CATALOG.filter(m => m.id === 'zhipu/glm-5.1' || m.id === 'zhipu/glm-5v-turbo');
}

export function registerZaiModels(): void {
  const newModels = getNewV2026_4_1_Models();
  Logger.info(`[OpenClaw:ZAI] Registered ${ZAI_MODEL_CATALOG.length} Z.AI models (${newModels.length} new in v2026.4.1: ${newModels.map(m => m.name).join(', ')})`);
}
