import { z } from "zod";
import { llmGateway } from "../../lib/llmGateway";
import type { SubAgentResult } from "./subAgentSpawner";
import type { MicroTask } from "./taskDecomposer";

export const AggregatedResultSchema = z.object({
  objective: z.string(),
  summary: z.string(),
  mergedContent: z.string(),
  qualityScore: z.number().min(0).max(1),
  completionRate: z.number().min(0).max(1),
  totalDurationMs: z.number(),
  totalTokenUsage: z.number(),
  taskResults: z.array(
    z.object({
      taskId: z.string(),
      label: z.string(),
      status: z.string(),
      output: z.any().optional(),
      qualityScore: z.number().optional(),
      durationMs: z.number().optional(),
    }),
  ),
  conflicts: z.array(
    z.object({
      taskIds: z.array(z.string()),
      description: z.string(),
      resolution: z.string().optional(),
    }),
  ).default([]),
  warnings: z.array(z.string()).default([]),
  metadata: z.record(z.any()).default({}),
});
export type AggregatedResult = z.infer<typeof AggregatedResultSchema>;

export const AggregationOptionsSchema = z.object({
  useLLMSynthesis: z.boolean().default(true),
  deduplicateOutputs: z.boolean().default(true),
  resolveConflicts: z.boolean().default(true),
  minQualityThreshold: z.number().default(0.3),
  includeFailedTasks: z.boolean().default(false),
});
export type AggregationOptions = z.infer<typeof AggregationOptionsSchema>;

export class ResultAggregator {
  async aggregate(
    objective: string,
    tasks: MicroTask[],
    results: SubAgentResult[],
    options: Partial<AggregationOptions> = {},
  ): Promise<AggregatedResult> {
    const opts = AggregationOptionsSchema.parse(options);
    const resultByTaskId = new Map<string, SubAgentResult>();
    const resultByAgentId = new Map<string, SubAgentResult>();
    for (const r of results) {
      if (r.taskId) resultByTaskId.set(r.taskId, r);
      resultByAgentId.set(r.agentId, r);
    }

    const taskResults = tasks.map((task, index) => {
      const result = resultByTaskId.get(task.id)
        || resultByAgentId.get(task.id)
        || results[index];

      return {
        taskId: task.id,
        label: task.label,
        status: result?.status || "missing",
        output: result?.output,
        qualityScore: result?.qualityScore,
        durationMs: result?.durationMs,
      };
    });

    const successfulResults = taskResults.filter(r => r.status === "completed");
    const failedResults = taskResults.filter(r => r.status === "failed");
    const completionRate = tasks.length > 0 ? successfulResults.length / tasks.length : 0;

    const filteredForMerge = opts.includeFailedTasks
      ? taskResults
      : taskResults.filter(r => r.status === "completed");

    let outputs = filteredForMerge
      .filter(r => r.output !== undefined && r.output !== null)
      .map(r => ({ taskId: r.taskId, label: r.label, output: r.output }));

    if (opts.deduplicateOutputs) {
      outputs = this.deduplicateOutputs(outputs);
    }

    const conflicts = opts.resolveConflicts ? this.detectConflicts(outputs) : [];

    const warnings: string[] = [];
    if (failedResults.length > 0) {
      warnings.push(`${failedResults.length}/${tasks.length} tasks failed: ${failedResults.map(r => r.label).join(", ")}`);
    }

    const lowQuality = taskResults.filter(
      r => r.qualityScore !== undefined && r.qualityScore < opts.minQualityThreshold,
    );
    if (lowQuality.length > 0) {
      warnings.push(`${lowQuality.length} tasks below quality threshold: ${lowQuality.map(r => r.label).join(", ")}`);
    }

    let mergedContent: string;
    let summary: string;

    if (opts.useLLMSynthesis && outputs.length > 1) {
      const synthesis = await this.llmSynthesize(objective, outputs, conflicts);
      mergedContent = synthesis.content;
      summary = synthesis.summary;
    } else {
      mergedContent = this.simplemerge(outputs);
      summary = this.generateSimpleSummary(objective, taskResults);
    }

    const qualityScores = taskResults
      .filter(r => r.qualityScore !== undefined)
      .map(r => r.qualityScore!);
    const avgQuality =
      qualityScores.length > 0
        ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
        : completionRate;

    const totalDuration = results.reduce((max, r) => Math.max(max, r.durationMs || 0), 0);
    const totalTokens = results.reduce((sum, r) => sum + (r.tokenUsage || 0), 0);

    return AggregatedResultSchema.parse({
      objective,
      summary,
      mergedContent,
      qualityScore: avgQuality,
      completionRate,
      totalDurationMs: totalDuration,
      totalTokenUsage: totalTokens,
      taskResults,
      conflicts,
      warnings,
      metadata: {
        tasksTotal: tasks.length,
        tasksCompleted: successfulResults.length,
        tasksFailed: failedResults.length,
        synthesisMethod: opts.useLLMSynthesis && outputs.length > 1 ? "llm" : "simple",
      },
    });
  }

  scoreResult(result: SubAgentResult): number {
    let score = 0;

    if (result.status === "completed") score += 0.5;
    else if (result.status === "failed") score -= 0.3;

    if (result.qualityScore !== undefined) {
      score += result.qualityScore * 0.3;
    }

    if (result.retries === 0) score += 0.1;
    else if (result.retries <= 1) score += 0.05;

    if (result.output !== undefined && result.output !== null) {
      const outputStr = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
      if (outputStr.length > 10) score += 0.1;
    }

    return Math.max(0, Math.min(1, score));
  }

  private deduplicateOutputs(
    outputs: Array<{ taskId: string; label: string; output: any }>,
  ): Array<{ taskId: string; label: string; output: any }> {
    const seen = new Set<string>();
    return outputs.filter(o => {
      const key = typeof o.output === "string" ? o.output : JSON.stringify(o.output);
      const hash = key.slice(0, 500);
      if (seen.has(hash)) return false;
      seen.add(hash);
      return true;
    });
  }

  private detectConflicts(
    outputs: Array<{ taskId: string; label: string; output: any }>,
  ): Array<{ taskIds: string[]; description: string; resolution?: string }> {
    const conflicts: Array<{ taskIds: string[]; description: string; resolution?: string }> = [];

    for (let i = 0; i < outputs.length; i++) {
      for (let j = i + 1; j < outputs.length; j++) {
        const a = typeof outputs[i].output === "string" ? outputs[i].output : JSON.stringify(outputs[i].output);
        const b = typeof outputs[j].output === "string" ? outputs[j].output : JSON.stringify(outputs[j].output);

        if (a.length > 50 && b.length > 50) {
          const similarity = this.jaccardSimilarity(a, b);
          if (similarity > 0.8 && similarity < 1.0) {
            conflicts.push({
              taskIds: [outputs[i].taskId, outputs[j].taskId],
              description: `Tasks "${outputs[i].label}" and "${outputs[j].label}" produced highly similar but not identical outputs (similarity: ${(similarity * 100).toFixed(1)}%)`,
              resolution: "Outputs merged with deduplication",
            });
          }
        }
      }
    }

    return conflicts;
  }

  private jaccardSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));

    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }

    const union = wordsA.size + wordsB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  private simplemerge(
    outputs: Array<{ taskId: string; label: string; output: any }>,
  ): string {
    return outputs
      .map(o => {
        const content = typeof o.output === "string" ? o.output : JSON.stringify(o.output, null, 2);
        return `## ${o.label}\n\n${content}`;
      })
      .join("\n\n---\n\n");
  }

  private generateSimpleSummary(
    objective: string,
    taskResults: Array<{ taskId: string; label: string; status: string }>,
  ): string {
    const completed = taskResults.filter(r => r.status === "completed").length;
    const total = taskResults.length;
    return `Completed ${completed}/${total} tasks for objective: ${objective}`;
  }

  private async llmSynthesize(
    objective: string,
    outputs: Array<{ taskId: string; label: string; output: any }>,
    conflicts: Array<{ taskIds: string[]; description: string }>,
  ): Promise<{ content: string; summary: string }> {
    const outputSummaries = outputs
      .map(o => {
        const content = typeof o.output === "string" ? o.output : JSON.stringify(o.output);
        return `[${o.label}]: ${content.slice(0, 1000)}`;
      })
      .join("\n\n");

    const conflictNote =
      conflicts.length > 0
        ? `\n\nConflicts detected:\n${conflicts.map(c => `- ${c.description}`).join("\n")}`
        : "";

    const messages = [
      {
        role: "system" as const,
        content: `You synthesize results from parallel sub-agents into a coherent, unified response. Merge outputs, resolve contradictions, and produce a clean final answer. Output JSON: {"content": "full merged content", "summary": "1-2 sentence summary"}`,
      },
      {
        role: "user" as const,
        content: `Objective: ${objective}\n\nSub-agent outputs:\n${outputSummaries}${conflictNote}\n\nSynthesize into a single coherent response.`,
      },
    ];

    try {
      const response = await llmGateway.chat(messages, {
        provider: "xai",
        model: "grok-3-mini",
        temperature: 0.3,
        maxTokens: 4096,
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          content: parsed.content || response.content,
          summary: parsed.summary || objective,
        };
      }

      return { content: response.content, summary: objective };
    } catch (error: any) {
      console.error("[ResultAggregator] LLM synthesis failed:", error.message);
      return {
        content: this.simplemerge(outputs),
        summary: this.generateSimpleSummary(
          objective,
          outputs.map(o => ({ taskId: o.taskId, label: o.label, status: "completed" })),
        ),
      };
    }
  }
}

export const resultAggregator = new ResultAggregator();
