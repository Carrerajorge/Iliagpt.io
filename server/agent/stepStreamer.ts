/**
 * Step Streamer — emits AgentStep events over an SSE response.
 * Used by skill handlers and the chat pipeline to show real-time progress.
 */

import type { Response } from "express";
import { EventEmitter } from "events";
import { createStep, completeStep, failStep, type AgentStep, type AgentStepType, type StepArtifact } from "./stepTypes";

export class StepStreamer extends EventEmitter {
  private steps: AgentStep[] = [];
  private res: Response | null;

  constructor(res?: Response) {
    super();
    this.res = res ?? null;
  }

  /** Bind to an SSE response (if not set at construction). */
  setResponse(res: Response): void {
    this.res = res;
  }

  /** Start a new step and stream it to the client. Returns the step for later completion. */
  start(type: AgentStepType, title: string, opts?: Partial<Pick<AgentStep, "description" | "fileName" | "diff" | "script" | "expandable">>): AgentStep {
    const step = createStep(type, title, opts);
    this.steps.push(step);
    this.emitStep(step);
    return step;
  }

  /** Complete a previously started step and stream the update. */
  complete(step: AgentStep, updates?: Partial<Pick<AgentStep, "output" | "artifact" | "title">>): AgentStep {
    const completed = completeStep(step, updates);
    this.updateStep(completed);
    this.emitStep(completed);
    return completed;
  }

  /** Fail a step and stream the update. */
  fail(step: AgentStep, error?: string): AgentStep {
    const failed = failStep(step, error);
    this.updateStep(failed);
    this.emitStep(failed);
    return failed;
  }

  /** Convenience: start and immediately complete a step. */
  add(type: AgentStepType, title: string, opts?: Partial<Pick<AgentStep, "description" | "fileName" | "diff" | "script" | "output" | "artifact" | "expandable">>): AgentStep {
    const step = createStep(type, title, { ...opts, ...{ status: "completed" as const } });
    (step as any).status = "completed";
    step.duration = 0;
    this.steps.push(step);
    this.emitStep(step);
    return step;
  }

  /** Get all steps collected so far. */
  getSteps(): AgentStep[] {
    return [...this.steps];
  }

  /** Emit a step as an SSE event. */
  private emitStep(step: AgentStep): void {
    this.emit("step", step);

    if (!this.res || this.res.writableEnded) return;
    try {
      const payload = JSON.stringify({
        type: "step",
        step: {
          id: step.id,
          type: step.type,
          title: step.title,
          description: step.description,
          fileName: step.fileName,
          diff: step.diff,
          script: step.script ? (step.script.length > 500 ? step.script.slice(0, 500) + "..." : step.script) : undefined,
          output: step.output ? (step.output.length > 1000 ? step.output.slice(0, 1000) + "..." : step.output) : undefined,
          status: step.status,
          timestamp: step.timestamp.toISOString(),
          duration: step.duration,
          expandable: step.expandable,
          artifact: step.artifact,
        },
      });
      this.res.write(`data: ${payload}\n\n`);
    } catch {
      // Connection may be closed; ignore write errors
    }
  }

  /** Update an existing step in the internal array. */
  private updateStep(step: AgentStep): void {
    const idx = this.steps.findIndex((s) => s.id === step.id);
    if (idx >= 0) this.steps[idx] = step;
  }
}

/**
 * Helper: create document generation steps sequence.
 * Returns the streamer with steps already added — call complete() on the last one when done.
 */
export function createDocumentSteps(
  streamer: StepStreamer,
  docType: string,
  hasAttachment: boolean,
): { analyzeStep?: AgentStep; planStep: AgentStep; generateStep: AgentStep } {
  let analyzeStep: AgentStep | undefined;
  if (hasAttachment) {
    analyzeStep = streamer.add("reading", "Analizando documento adjunto", { expandable: false });
  }
  const planStep = streamer.start("thinking", `Planificando estructura del ${docType}`);
  return { analyzeStep, planStep, generateStep: planStep }; // generateStep will be started after plan completes
}

/**
 * Helper: create code execution steps sequence.
 */
export function createCodeSteps(
  streamer: StepStreamer,
  language: string,
  code: string,
): { analyzeStep: AgentStep; executeStep: AgentStep } {
  const analyzeStep = streamer.add("reading", `Analizando código ${language}`, { expandable: false });
  const executeStep = streamer.start("executing", `Ejecutando código ${language}`, {
    script: code,
    expandable: true,
  });
  return { analyzeStep, executeStep };
}

/**
 * Helper: create web search steps sequence.
 */
export function createSearchSteps(
  streamer: StepStreamer,
  query: string,
): { searchStep: AgentStep } {
  const searchStep = streamer.start("searching", `Buscando: "${query}"`, {
    description: query,
    expandable: false,
  });
  return { searchStep };
}
