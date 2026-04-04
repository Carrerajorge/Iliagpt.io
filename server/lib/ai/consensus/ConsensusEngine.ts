/**
 * Consensus Engine
 * Queries multiple providers in parallel and combines their responses
 * using one of three strategies:
 *
 *   majority  — pick the response that is most semantically similar to others
 *   best_of_n — pick the highest quality score response
 *   fusion    — synthesize all responses via a dedicated fusion model
 */

import {
  IConsensusRequest,
  IConsensusResponse,
  IChatRequest,
  IChatResponse,
  IChatMessage,
  MessageRole,
} from '../providers/core/types';
import { ProviderRegistry } from '../providers/core/ProviderRegistry';

// ─── Text similarity (Jaccard on word trigrams) ───────────────────────────────

function tokenize(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const trigrams = new Set<string>();
  for (let i = 0; i < words.length - 2; i++) {
    trigrams.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  // Also add unigrams for short texts
  words.forEach((w) => trigrams.add(w));
  return trigrams;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

function avgPairwiseSimilarity(responses: IChatResponse[]): number {
  if (responses.length <= 1) return 0;
  const tokenSets = responses.map((r) => tokenize(r.content));
  let totalSim = 0;
  let pairs = 0;
  for (let i = 0; i < tokenSets.length; i++) {
    for (let j = i + 1; j < tokenSets.length; j++) {
      totalSim += jaccardSimilarity(tokenSets[i], tokenSets[j]);
      pairs++;
    }
  }
  return pairs > 0 ? totalSim / pairs : 0;
}

// ─── Fusion prompt builder ────────────────────────────────────────────────────

function buildFusionMessages(
  original: IChatMessage[],
  responses: IChatResponse[],
): IChatMessage[] {
  const originalQuestion = original
    .filter((m) => m.role === MessageRole.User)
    .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((c) => c.text ?? '').join(' ')))
    .join('\n');

  const responseList = responses
    .map((r, i) => `### Response ${i + 1} (${r.provider}/${r.model})\n${r.content}`)
    .join('\n\n');

  return [
    {
      role: MessageRole.System,
      content: `You are a synthesis assistant. You will be given multiple AI responses to the same question. Your task is to synthesize the best, most accurate, and complete answer by:
1. Identifying points of agreement and using them as the foundation
2. Resolving contradictions by selecting the most well-reasoned position
3. Combining complementary information
4. Being transparent about genuine uncertainty where responses disagree

Output only the synthesized answer, not meta-commentary about the synthesis process.`,
    },
    {
      role: MessageRole.User,
      content: `Original question:\n${originalQuestion}\n\n---\n\nMultiple AI responses to synthesize:\n\n${responseList}\n\n---\n\nProvide a single synthesized answer.`,
    },
  ];
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class ConsensusEngine {
  private _registry: ProviderRegistry;

  constructor(registry?: ProviderRegistry) {
    this._registry = registry ?? ProviderRegistry.getInstance();
  }

  async query(consensusRequest: IConsensusRequest): Promise<IConsensusResponse> {
    const { request, providers, votingStrategy, fusionModel, timeoutMs = 30_000 } = consensusRequest;

    // Query all providers in parallel with per-provider timeout
    const settled = await Promise.allSettled(
      providers.map((providerName) =>
        this._queryProvider(providerName, request, timeoutMs),
      ),
    );

    const successful: IChatResponse[] = settled
      .filter((r): r is PromiseFulfilledResult<IChatResponse> => r.status === 'fulfilled')
      .map((r) => r.value);

    if (successful.length === 0) {
      throw new Error('All providers failed in consensus query');
    }

    if (successful.length === 1) {
      return {
        finalResponse: successful[0],
        responses: successful,
        agreement: 0,
        strategy: votingStrategy,
        totalCostUsd: successful[0].cost ?? 0,
      };
    }

    const totalCostUsd = successful.reduce((s, r) => s + (r.cost ?? 0), 0);
    const agreement = avgPairwiseSimilarity(successful);

    let finalResponse: IChatResponse;

    switch (votingStrategy) {
      case 'majority':
        finalResponse = this._majorityVote(successful);
        break;

      case 'best_of_n':
        finalResponse = this._bestOfN(successful);
        break;

      case 'fusion':
        finalResponse = await this._fusion(successful, request.messages, fusionModel);
        break;

      default:
        finalResponse = this._majorityVote(successful);
    }

    return {
      finalResponse,
      responses: successful,
      agreement,
      strategy: votingStrategy,
      totalCostUsd,
    };
  }

  // ── Voting strategies ────────────────────────────────────────────────────────

  /** Pick the response with the highest average similarity to all others. */
  private _majorityVote(responses: IChatResponse[]): IChatResponse {
    const tokenSets = responses.map((r) => tokenize(r.content));

    const scores = responses.map((_, i) => {
      let totalSim = 0;
      for (let j = 0; j < responses.length; j++) {
        if (i !== j) totalSim += jaccardSimilarity(tokenSets[i], tokenSets[j]);
      }
      return totalSim / (responses.length - 1);
    });

    const bestIdx = scores.indexOf(Math.max(...scores));
    return responses[bestIdx];
  }

  /** Pick the response from the highest-quality model (by qualityScore). */
  private _bestOfN(responses: IChatResponse[]): IChatResponse {
    // We don't have qualityScore here, so use the one with the most tokens (proxy for detail)
    return responses.reduce((best, curr) =>
      (curr.usage.completionTokens > best.usage.completionTokens ? curr : best),
    );
  }

  /** Synthesize all responses using a dedicated fusion model. */
  private async _fusion(
    responses: IChatResponse[],
    originalMessages: IChatMessage[],
    fusionModelSpec?: string,
  ): Promise<IChatResponse> {
    const [providerName, ...modelParts] = (fusionModelSpec ?? 'openai:gpt-4o-mini').split(':');
    const modelId = modelParts.join(':');

    const provider = this._registry.tryGetProvider(providerName);
    if (!provider) {
      // Fall back to majority vote if fusion provider not available
      return this._majorityVote(responses);
    }

    const fusionMessages = buildFusionMessages(originalMessages, responses);
    return provider.chat({ messages: fusionMessages, model: modelId });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private async _queryProvider(
    providerName: string,
    request: IChatRequest,
    timeoutMs: number,
  ): Promise<IChatResponse> {
    const provider = this._registry.getProvider(providerName);
    return Promise.race([
      provider.chat(request),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Provider ${providerName} timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  }

  // ── Convenience ──────────────────────────────────────────────────────────────

  /** Quick helper: query N providers with majority vote, returns the winner. */
  async majority(request: IChatRequest, providers: string[]): Promise<IChatResponse> {
    const result = await this.query({ request, providers, votingStrategy: 'majority' });
    return result.finalResponse;
  }

  /** Quick helper: query N providers, fuse results. */
  async fuse(request: IChatRequest, providers: string[], fusionModel?: string): Promise<IConsensusResponse> {
    return this.query({ request, providers, votingStrategy: 'fusion', fusionModel });
  }
}

export const consensusEngine = new ConsensusEngine();
