import { llmGateway } from "./llmGateway";

interface VerificationResult {
  isVerified: boolean;
  confidence: number;
  agreements: string[];
  disagreements: string[];
  consensusResponse?: string;
  modelResponses: Array<{
    model: string;
    response: string;
    latency: number;
  }>;
}

interface VerificationOptions {
  models?: string[];
  threshold?: number;
  timeout?: number;
  requireConsensus?: boolean;
}

const DEFAULT_MODELS = [
  "gemini-2.0-flash",
  "grok-3-fast",
];

export async function verifyResponseWithMultipleModels(
  prompt: string,
  primaryResponse: string,
  options: VerificationOptions = {}
): Promise<VerificationResult> {
  const {
    models = DEFAULT_MODELS,
    threshold = 0.7,
    timeout = 10000,
    requireConsensus = false,
  } = options;

  const verificationPrompt = `Analiza la siguiente respuesta a la pregunta del usuario y verifica si es correcta y completa.

Pregunta del usuario: ${prompt}

Respuesta a verificar: ${primaryResponse}

Responde SOLO con un JSON en este formato:
{
  "isCorrect": true/false,
  "confidence": 0.0-1.0,
  "issues": ["problema1", "problema2"] o [],
  "improvements": ["mejora1"] o []
}`;

  const verificationPromises = models.map(async (model) => {
    const startTime = Date.now();
    try {
      const response = await Promise.race([
        llmGateway.sendMessage({
          messages: [{ role: "user", content: verificationPrompt }],
          model,
          maxTokens: 500,
          temperature: 0.2,
        }),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error("Timeout")), timeout)
        ),
      ]);

      const responseText = typeof response === "string" ? response : response.content;
      
      return {
        model,
        response: responseText,
        latency: Date.now() - startTime,
        success: true,
      };
    } catch (error) {
      return {
        model,
        response: "",
        latency: Date.now() - startTime,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  const results = await Promise.allSettled(verificationPromises);
  const successfulResults = results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
    .map(r => r.value)
    .filter(r => r.success);

  if (successfulResults.length === 0) {
    return {
      isVerified: true,
      confidence: 0.5,
      agreements: [],
      disagreements: [],
      modelResponses: [],
    };
  }

  const parsedResults = successfulResults.map(result => {
    try {
      const jsonMatch = result.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          ...result,
          parsed: {
            isCorrect: parsed.isCorrect ?? true,
            confidence: parsed.confidence ?? 0.8,
            issues: parsed.issues || [],
            improvements: parsed.improvements || [],
          },
        };
      }
    } catch {
      // Fallback parsing
    }
    
    return {
      ...result,
      parsed: {
        isCorrect: !result.response.toLowerCase().includes("incorrect"),
        confidence: 0.7,
        issues: [],
        improvements: [],
      },
    };
  });

  const correctVotes = parsedResults.filter(r => r.parsed.isCorrect).length;
  const totalVotes = parsedResults.length;
  const consensusRatio = correctVotes / totalVotes;
  
  const avgConfidence = parsedResults.reduce((acc, r) => acc + r.parsed.confidence, 0) / totalVotes;

  const allIssues = parsedResults.flatMap(r => r.parsed.issues);
  const issueFrequency: Record<string, number> = {};
  for (const issue of allIssues) {
    issueFrequency[issue] = (issueFrequency[issue] || 0) + 1;
  }
  
  const commonIssues = Object.entries(issueFrequency)
    .filter(([_, count]) => count >= Math.ceil(totalVotes / 2))
    .map(([issue]) => issue);

  const isVerified = requireConsensus
    ? consensusRatio >= threshold && avgConfidence >= 0.6
    : consensusRatio >= 0.5 || avgConfidence >= threshold;

  return {
    isVerified,
    confidence: avgConfidence,
    agreements: parsedResults
      .filter(r => r.parsed.isCorrect)
      .map(r => r.model),
    disagreements: parsedResults
      .filter(r => !r.parsed.isCorrect)
      .map(r => r.model),
    modelResponses: parsedResults.map(r => ({
      model: r.model,
      response: r.response,
      latency: r.latency,
    })),
  };
}

export async function getConsensusResponse(
  prompt: string,
  options: VerificationOptions = {}
): Promise<{
  response: string;
  confidence: number;
  model: string;
}> {
  const { models = DEFAULT_MODELS, timeout = 15000 } = options;

  const responsePromises = models.map(async (model) => {
    const startTime = Date.now();
    try {
      const response = await Promise.race([
        llmGateway.sendMessage({
          messages: [{ role: "user", content: prompt }],
          model,
          maxTokens: 2000,
        }),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error("Timeout")), timeout)
        ),
      ]);

      const responseText = typeof response === "string" ? response : response.content;
      
      return {
        model,
        response: responseText,
        latency: Date.now() - startTime,
        success: true,
      };
    } catch (error) {
      return {
        model,
        response: "",
        latency: Date.now() - startTime,
        success: false,
      };
    }
  });

  const results = await Promise.allSettled(responsePromises);
  const successfulResults = results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
    .map(r => r.value)
    .filter(r => r.success && r.response.length > 50);

  if (successfulResults.length === 0) {
    throw new Error("All models failed to respond");
  }

  if (successfulResults.length === 1) {
    return {
      response: successfulResults[0].response,
      confidence: 0.7,
      model: successfulResults[0].model,
    };
  }

  const bestResult = successfulResults.reduce((best, current) => {
    if (current.response.length > best.response.length * 0.8 && 
        current.latency < best.latency) {
      return current;
    }
    return best;
  });

  const verification = await verifyResponseWithMultipleModels(
    prompt,
    bestResult.response,
    { models: models.filter(m => m !== bestResult.model), timeout: 5000 }
  );

  return {
    response: bestResult.response,
    confidence: verification.confidence,
    model: bestResult.model,
  };
}

export default {
  verifyResponseWithMultipleModels,
  getConsensusResponse,
};
