import { llmGateway } from "./llmGateway";

interface FallbackConfig {
  primaryModel: string;
  fallbackChain: string[];
  maxRetries: number;
  retryDelayMs: number;
}

interface FallbackResult<T> {
  success: boolean;
  data?: T;
  modelUsed: string;
  attempts: number;
  errors: string[];
  fallbackUsed: boolean;
}

const DEFAULT_FALLBACK_CHAINS: Record<string, string[]> = {
  "gemini-2.5-pro": ["gemini-2.0-flash", "grok-3-fast"],
  "gemini-2.0-flash": ["grok-3-fast", "gemini-2.5-pro"],
  "grok-3-fast": ["gemini-2.0-flash", "grok-4-1-fast-non-reasoning"],
  "grok-4-1-fast-non-reasoning": ["grok-3-fast", "gemini-2.0-flash"],
};

export async function executeWithFallback<T>(
  operation: (model: string) => Promise<T>,
  config: Partial<FallbackConfig> = {}
): Promise<FallbackResult<T>> {
  const {
    primaryModel = "gemini-2.0-flash",
    fallbackChain = DEFAULT_FALLBACK_CHAINS[primaryModel] || [],
    maxRetries = 2,
    retryDelayMs = 500,
  } = config;

  const modelsToTry = [primaryModel, ...fallbackChain];
  const errors: string[] = [];
  let attempts = 0;

  for (const model of modelsToTry) {
    for (let retry = 0; retry <= maxRetries; retry++) {
      attempts++;
      
      try {
        const data = await operation(model);
        
        return {
          success: true,
          data,
          modelUsed: model,
          attempts,
          errors,
          fallbackUsed: model !== primaryModel,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`${model} (attempt ${retry + 1}): ${errorMessage}`);
        
        const isRetryable = isRetryableError(error);
        
        if (!isRetryable || retry === maxRetries) {
          console.warn(`[GracefulFallback] ${model} failed:`, errorMessage);
          break;
        }
        
        await delay(retryDelayMs * Math.pow(2, retry));
      }
    }
  }

  return {
    success: false,
    modelUsed: primaryModel,
    attempts,
    errors,
    fallbackUsed: false,
  };
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    
    if (message.includes("rate limit") || message.includes("429")) {
      return true;
    }
    if (message.includes("timeout") || message.includes("timed out")) {
      return true;
    }
    if (message.includes("503") || message.includes("502") || message.includes("500")) {
      return true;
    }
    if (message.includes("network") || message.includes("connection")) {
      return true;
    }
  }
  
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function sendMessageWithFallback(
  messages: Array<{ role: string; content: string }>,
  options: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    stream?: boolean;
  } = {}
): Promise<FallbackResult<string>> {
  const { model = "gemini-2.0-flash", ...restOptions } = options;

  return executeWithFallback(
    async (currentModel) => {
      const response = await llmGateway.sendMessage({
        messages,
        model: currentModel,
        ...restOptions,
      });
      
      if (typeof response === "string") {
        return response;
      }
      
      return response.content || "";
    },
    { primaryModel: model }
  );
}

export function getFallbackChain(model: string): string[] {
  return DEFAULT_FALLBACK_CHAINS[model] || ["gemini-2.0-flash"];
}

export function addFallbackModel(primaryModel: string, fallbackModel: string): void {
  if (!DEFAULT_FALLBACK_CHAINS[primaryModel]) {
    DEFAULT_FALLBACK_CHAINS[primaryModel] = [];
  }
  if (!DEFAULT_FALLBACK_CHAINS[primaryModel].includes(fallbackModel)) {
    DEFAULT_FALLBACK_CHAINS[primaryModel].push(fallbackModel);
  }
}

export default {
  executeWithFallback,
  sendMessageWithFallback,
  getFallbackChain,
  addFallbackModel,
};
