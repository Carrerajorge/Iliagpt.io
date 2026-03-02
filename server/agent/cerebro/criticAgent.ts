import { llmGateway } from "../../lib/llmGateway";

export interface CriticVerdict {
  decision: 'accept' | 'retry' | 'backtrack';
  score: number;
  reasoning: string;
  issues: string[];
  suggestions: string[];
}

const CRITIC_SYSTEM_PROMPT = `You are a quality critic evaluating the output of a subtask execution.

Evaluate the result on these dimensions:
1. Completeness: Does it fully address the subtask objective?
2. Correctness: Is the output factually accurate and well-grounded?
3. Coherence: Is it logically consistent and well-structured?
4. Safety: Does it avoid harmful content, hallucinations, or sensitive data leaks?

Output valid JSON with this exact schema:
{
  "decision": "accept" | "retry" | "backtrack",
  "score": 0.0-1.0,
  "reasoning": "brief explanation",
  "issues": ["issue1", "issue2"],
  "suggestions": ["suggestion1"]
}

Rules:
- score >= 0.7 → "accept"
- score >= 0.4 and < 0.7 → "retry" (with suggestions for improvement)
- score < 0.4 → "backtrack" (subtask needs fundamental rethinking)
- If the result contains an error message from a tool, that's often a "retry"
- Be pragmatic: don't reject good-enough results
- Output ONLY the JSON`;

export async function criticizeSubtask(
  subtaskLabel: string,
  subtaskDescription: string,
  result: string,
  worldSnapshot: string,
): Promise<CriticVerdict> {
  try {
    const response = await llmGateway.chat(
      [
        { role: "system", content: CRITIC_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Subtask: ${subtaskLabel}\nDescription: ${subtaskDescription}\n\nWorld state:\n${worldSnapshot}\n\nResult to evaluate:\n${result.substring(0, 3000)}`,
        },
      ],
      {
        temperature: 0.2,
        maxTokens: 800,
        timeout: 10000,
      },
    );

    const raw = response.content.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return buildFallbackVerdict(result);
    }

    const parsed = JSON.parse(jsonMatch[0]) as CriticVerdict;

    if (!parsed.decision || !['accept', 'retry', 'backtrack'].includes(parsed.decision)) {
      parsed.decision = parsed.score >= 0.7 ? 'accept' : parsed.score >= 0.4 ? 'retry' : 'backtrack';
    }
    if (typeof parsed.score !== 'number') parsed.score = 0.5;
    if (!parsed.reasoning) parsed.reasoning = 'No reasoning provided';
    if (!Array.isArray(parsed.issues)) parsed.issues = [];
    if (!Array.isArray(parsed.suggestions)) parsed.suggestions = [];

    return parsed;
  } catch (err: any) {
    console.warn(`[CerebroCriticAgent] Criticism failed, accepting by default:`, err?.message);
    return buildFallbackVerdict(result);
  }
}

function buildFallbackVerdict(result: string): CriticVerdict {
  const hasError = /error|failed|exception/i.test(result);
  return {
    decision: hasError ? 'retry' : 'accept',
    score: hasError ? 0.4 : 0.75,
    reasoning: hasError ? 'Result contains error indicators' : 'Critic unavailable, accepting result',
    issues: hasError ? ['Result may contain errors'] : [],
    suggestions: hasError ? ['Review and retry the operation'] : [],
  };
}
