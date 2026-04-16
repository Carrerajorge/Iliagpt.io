import { complexityAnalyzer } from './complexityAnalyzer';
import { IntentToolMapper } from './intentMapper';
import { toolRegistry } from './toolRegistry';
import { chatAgenticCircuit } from './chatAgenticCircuit';
import { FEATURES } from '../config/features';

export interface SafeAnalysis {
  complexity: {
    score: number;
    category: string;
    recommended_path: string;
  };
  intent: {
    intent: string;
    language: string | undefined;
    hasGap: boolean;
  };
  analysisTimeMs: number;
}

const analysisCache = new Map<string, { result: SafeAnalysis; timestamp: number }>();
const CACHE_TTL = 300000;

const intentMapper = new IntentToolMapper(toolRegistry);

function hashMessage(message: string): string {
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    hash = ((hash << 5) - hash) + message.charCodeAt(i);
    hash = hash & hash;
  }
  return `msg_${hash}`;
}

export async function analyzePromptSafely(message: string): Promise<SafeAnalysis | null> {
  if (!FEATURES.AGENTIC_CHAT_ENABLED) return null;
  if (!chatAgenticCircuit.isAvailable()) return null;
  if (!message || typeof message !== 'string') return null;
  if (message.length > 10000) return null;
  if (message.length < 2) return null;

  const cacheKey = hashMessage(message);
  const cached = analysisCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }

  const startTime = Date.now();

  try {
    const complexity = complexityAnalyzer.analyze(message);
    const intent = intentMapper.map(message);

    const result: SafeAnalysis = {
      complexity: {
        score: complexity.score,
        category: complexity.category,
        recommended_path: complexity.recommended_path
      },
      intent: {
        intent: intent.intent,
        language: intent.language,
        hasGap: intent.hasGap
      },
      analysisTimeMs: Date.now() - startTime
    };

    analysisCache.set(cacheKey, { result, timestamp: Date.now() });
    
    if (analysisCache.size > 1000) {
      const firstKey = analysisCache.keys().next().value;
      if (firstKey) analysisCache.delete(firstKey);
    }

    chatAgenticCircuit.recordSuccess();
    return result;
  } catch (error) {
    chatAgenticCircuit.recordFailure();
    console.error('[Agentic] Safe analysis failed:', error);
    return null;
  }
}
