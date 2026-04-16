import { llmGateway } from "../../lib/llmGateway";

export interface JudgeVerdict {
  approved: boolean;
  confidence: number;
  reasoning: string;
  completedObjectives: string[];
  missingObjectives: string[];
  qualityScore: number;
  groundingScore: number;
  coherenceScore: number;
}

const JUDGE_SYSTEM_PROMPT = `You are a final judge evaluating the complete output of an agent pipeline.

Check:
1. All subtasks satisfied: Were all planned subtasks completed successfully?
2. Evidence grounded: Are factual claims supported by tool results or sources?
3. No hallucination: Does the output avoid fabricating facts, URLs, or data?
4. Meets definition of done: Does the output fulfill the original user request?
5. Coherence: Is the final output consistent across all subtask results?

Output valid JSON with this exact schema:
{
  "approved": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "completedObjectives": ["obj1", "obj2"],
  "missingObjectives": ["obj3"],
  "qualityScore": 0.0-1.0,
  "groundingScore": 0.0-1.0,
  "coherenceScore": 0.0-1.0
}

Rules:
- approved=true if confidence >= 0.6 and all critical objectives met
- Be practical: partial completion is better than no completion
- Output ONLY the JSON`;

export async function judgeOutput(
  objective: string,
  subtaskResults: Array<{ label: string; result: string; criticScore: number }>,
  worldSnapshot: string,
): Promise<JudgeVerdict> {
  try {
    const subtaskSummary = subtaskResults
      .map((sr, i) => `[${i + 1}] ${sr.label} (critic: ${sr.criticScore.toFixed(2)}): ${sr.result.substring(0, 500)}`)
      .join('\n\n');

    const response = await llmGateway.chat(
      [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Original objective: ${objective}\n\nWorld state:\n${worldSnapshot}\n\nSubtask results:\n${subtaskSummary}`,
        },
      ],
      {
        temperature: 0.2,
        maxTokens: 1000,
        timeout: 12000,
      },
    );

    const raw = response.content.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return buildFallbackJudgment(subtaskResults);
    }

    const parsed = JSON.parse(jsonMatch[0]) as JudgeVerdict;

    if (typeof parsed.approved !== 'boolean') {
      parsed.approved = (parsed.confidence || 0) >= 0.6;
    }
    if (typeof parsed.confidence !== 'number') parsed.confidence = 0.5;
    if (!parsed.reasoning) parsed.reasoning = 'No reasoning provided';
    if (!Array.isArray(parsed.completedObjectives)) parsed.completedObjectives = [];
    if (!Array.isArray(parsed.missingObjectives)) parsed.missingObjectives = [];
    if (typeof parsed.qualityScore !== 'number') parsed.qualityScore = parsed.confidence;
    if (typeof parsed.groundingScore !== 'number') parsed.groundingScore = parsed.confidence;
    if (typeof parsed.coherenceScore !== 'number') parsed.coherenceScore = parsed.confidence;

    return parsed;
  } catch (err: any) {
    console.warn(`[CerebroJudgeAgent] Judgment failed, approving by default:`, err?.message);
    return buildFallbackJudgment(subtaskResults);
  }
}

function buildFallbackJudgment(
  subtaskResults: Array<{ label: string; result: string; criticScore: number }>,
): JudgeVerdict {
  const avgScore = subtaskResults.length > 0
    ? subtaskResults.reduce((sum, r) => sum + r.criticScore, 0) / subtaskResults.length
    : 0.5;

  const allCompleted = subtaskResults.every(r => r.criticScore >= 0.5);

  return {
    approved: allCompleted && avgScore >= 0.5,
    confidence: avgScore,
    reasoning: 'Judge unavailable, using critic scores as proxy',
    completedObjectives: subtaskResults.filter(r => r.criticScore >= 0.5).map(r => r.label),
    missingObjectives: subtaskResults.filter(r => r.criticScore < 0.5).map(r => r.label),
    qualityScore: avgScore,
    groundingScore: avgScore,
    coherenceScore: avgScore,
  };
}
