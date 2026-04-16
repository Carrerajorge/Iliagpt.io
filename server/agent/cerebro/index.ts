import { planTasks, getExecutionOrder, type TaskDAG, type SubtaskNode } from "./plannerAgent";
import { criticizeSubtask, type CriticVerdict } from "./criticAgent";
import { judgeOutput, type JudgeVerdict } from "./judgeAgent";
import { CerebroWorldModel } from "./worldModel";
import { emitTraceEvent } from "../unifiedChatHandler";
import type { Response } from "express";

function writeSseEvent(res: Response | null, event: string, data: any): void {
  if (!res || res.writableEnded) return;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {}
}

export interface CerebroPipelineResult {
  objective: string;
  dag: TaskDAG;
  subtaskResults: Array<{
    subtask: SubtaskNode;
    result: string;
    criticVerdict: CriticVerdict;
    retries: number;
  }>;
  judgeVerdict: JudgeVerdict;
  worldSnapshot: string;
  totalDurationMs: number;
}

export interface CerebroExecutorFn {
  (subtask: SubtaskNode, worldModel: CerebroWorldModel): Promise<string>;
}

const MAX_RETRIES_PER_SUBTASK = 2;

export async function runCerebroPipeline(
  userMessage: string,
  conversationContext: string,
  executorFn: CerebroExecutorFn,
  runId: string,
  res?: Response | null,
): Promise<CerebroPipelineResult> {
  const startTime = Date.now();
  const worldModel = new CerebroWorldModel();
  const sseRes = res || null;

  await emitTraceEvent(runId, "thinking", {
    content: "Cerebro planner decomposing request into subtask DAG",
    phase: "planning",
  });

  const dag = await planTasks(userMessage, conversationContext, worldModel);

  writeSseEvent(sseRes, "plan_update", {
    runId,
    objective: dag.objective,
    subtasks: dag.subtasks.map(st => ({
      id: st.id,
      label: st.label,
      description: st.description,
      toolHint: st.toolHint,
      dependsOn: st.dependsOn,
      priority: st.priority,
      status: 'pending',
    })),
    estimatedTokens: dag.estimatedTotalTokens,
  });

  await emitTraceEvent(runId, "progress_update", {
    progress: {
      current: 0,
      total: dag.subtasks.length,
      message: `Plan: ${dag.objective} (${dag.subtasks.length} subtasks)`,
    },
  });

  for (const st of dag.subtasks) {
    worldModel.registerSubtask(st.id, st.label);
  }

  const executionWaves = getExecutionOrder(dag);
  const allResults: CerebroPipelineResult['subtaskResults'] = [];

  let subtaskIndex = 0;
  for (const wave of executionWaves) {
    const waveResults = await Promise.all(
      wave.map(async (subtask) => {
        worldModel.updateSubtask(subtask.id, { status: 'running', startedAt: Date.now() });

        writeSseEvent(sseRes, "subtask_start", {
          runId,
          subtaskId: subtask.id,
          label: subtask.label,
          toolHint: subtask.toolHint,
          timestamp: Date.now(),
        });

        await emitTraceEvent(runId, "thinking", {
          content: `Executing subtask: ${subtask.label}`,
          phase: "executing",
        });

        let result = '';
        let criticVerdict: CriticVerdict = {
          decision: 'accept',
          score: 0.75,
          reasoning: 'default',
          issues: [],
          suggestions: [],
        };
        let retries = 0;

        for (let attempt = 0; attempt <= MAX_RETRIES_PER_SUBTASK; attempt++) {
          try {
            result = await executorFn(subtask, worldModel);
          } catch (err: any) {
            result = `Error: ${err.message}`;
            worldModel.recordError(`Subtask ${subtask.id}: ${err.message}`);
          }

          criticVerdict = await criticizeSubtask(
            subtask.label,
            subtask.description,
            result,
            worldModel.getSnapshot(),
          );

          writeSseEvent(sseRes, "critic_result", {
            runId,
            subtaskId: subtask.id,
            decision: criticVerdict.decision,
            score: criticVerdict.score,
            reasoning: criticVerdict.reasoning,
            issues: criticVerdict.issues,
            suggestions: criticVerdict.suggestions,
          });

          if (criticVerdict.decision === 'accept') {
            worldModel.updateSubtask(subtask.id, {
              status: 'completed',
              result: result.substring(0, 1000),
              completedAt: Date.now(),
            });

            const subtaskState = worldModel.getSubtask(subtask.id);
            writeSseEvent(sseRes, "subtask_complete", {
              runId,
              subtaskId: subtask.id,
              status: 'completed',
              durationMs: subtaskState?.startedAt ? Date.now() - subtaskState.startedAt : 0,
              criticScore: criticVerdict.score,
            });
            break;
          }

          if (criticVerdict.decision === 'backtrack' || attempt === MAX_RETRIES_PER_SUBTASK) {
            worldModel.updateSubtask(subtask.id, {
              status: 'failed',
              error: criticVerdict.issues.join('; '),
              completedAt: Date.now(),
            });

            writeSseEvent(sseRes, "subtask_complete", {
              runId,
              subtaskId: subtask.id,
              status: 'failed',
              issues: criticVerdict.issues,
            });
            break;
          }

          retries++;
          worldModel.updateSubtask(subtask.id, { status: 'retrying', retries });

          await emitTraceEvent(runId, "thinking", {
            content: `Retrying subtask ${subtask.label} (attempt ${attempt + 2}): ${criticVerdict.suggestions.join(', ')}`,
            phase: "executing",
          });
        }

        subtaskIndex++;
        await emitTraceEvent(runId, "progress_update", {
          progress: {
            current: subtaskIndex,
            total: dag.subtasks.length,
            message: `Subtask "${subtask.label}": ${criticVerdict.decision} (score: ${criticVerdict.score.toFixed(2)})`,
          },
        });

        return { subtask, result, criticVerdict, retries };
      }),
    );

    allResults.push(...waveResults);
  }

  await emitTraceEvent(runId, "thinking", {
    content: "Cerebro judge evaluating final output",
    phase: "judging",
  });

  const judgeVerdict = await judgeOutput(
    dag.objective,
    allResults.map(r => ({
      label: r.subtask.label,
      result: r.result,
      criticScore: r.criticVerdict.score,
    })),
    worldModel.getSnapshot(),
  );

  const totalDurationMs = Date.now() - startTime;

  writeSseEvent(sseRes, "judge_verdict", {
    runId,
    approved: judgeVerdict.approved,
    confidence: judgeVerdict.confidence,
    qualityScore: judgeVerdict.qualityScore,
    groundingScore: judgeVerdict.groundingScore,
    coherenceScore: judgeVerdict.coherenceScore,
    completedObjectives: judgeVerdict.completedObjectives,
    missingObjectives: judgeVerdict.missingObjectives,
    totalDurationMs,
  });

  return {
    objective: dag.objective,
    dag,
    subtaskResults: allResults,
    judgeVerdict,
    worldSnapshot: worldModel.getSnapshot(),
    totalDurationMs,
  };
}

export function shouldUseCerebro(intent: string, rawMessage: string): boolean {
  const complexIntents = [
    'research',
    'document_generation',
    'data_analysis',
    'code_generation',
    'multi_step_task',
    'web_automation',
    'document_analysis',
  ];

  if (complexIntents.includes(intent)) return true;

  const complexSignals = [
    /\b(step by step|multi.?step|first.*then|analyze.*and.*create)\b/i,
    /\b(research|investigate|compare|evaluate)\b.*\b(and|then|also)\b/i,
    /\b(create|generate|build)\b.*\b(with|including|and)\b.*\b(also|then|after)\b/i,
    /\b(profund|deep|exhaustiv|comprehensive|a fondo|thoroughly|detallad|detailed)\b/i,
    /\b(investiga|research)\b.*\b(sobre|about|profund|deep)\b/i,
    /\b(analiza|analyze)\b.*\b(profund|deep|completo|complete|detalle|detail|a fondo)\b/i,
    /\b(piensa|think|razona|reason)\b.*\b(profund|deep|crítico|critical)\b/i,
    /\b(lee|read|lista|list|explora|explore)\b.*\b(archivos?|files?|carpetas?|folders?)\b/i,
    /\b(ejecuta|execute|run|corre)\b.*\b(comando|command|script|terminal|bash)\b/i,
  ];

  return complexSignals.some(pattern => pattern.test(rawMessage));
}

export { CerebroWorldModel } from "./worldModel";
export type { TaskDAG, SubtaskNode } from "./plannerAgent";
export type { CriticVerdict } from "./criticAgent";
export type { JudgeVerdict } from "./judgeAgent";
