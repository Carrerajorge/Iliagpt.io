/**
 * Checkpoint Manager
 * Provides pause/resume/checkpoint functionality for agent runs.
 * Serializes execution state to memory (could be persisted to DB).
 */

export interface CheckpointState {
  runId: string;
  status: "running" | "paused" | "completed" | "failed" | "cancelled";
  currentStep: number;
  totalSteps: number;
  createdAt: number;
  updatedAt: number;
  pausedAt?: number;
  resumedAt?: number;
  completedAt?: number;
  data: Record<string, any>;
  steps: StepCheckpoint[];
}

export interface StepCheckpoint {
  index: number;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: number;
  completedAt?: number;
  result?: any;
  error?: string;
}

const checkpoints = new Map<string, CheckpointState>();

/**
 * Create a new checkpoint for a run.
 */
export function createCheckpoint(
  runId: string,
  totalSteps: number,
  stepNames: string[]
): CheckpointState {
  const state: CheckpointState = {
    runId,
    status: "running",
    currentStep: 0,
    totalSteps,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    data: {},
    steps: stepNames.map((name, index) => ({
      index,
      name,
      status: index === 0 ? "running" : "pending",
    })),
  };

  checkpoints.set(runId, state);
  return state;
}

/**
 * Update step status.
 */
export function updateStep(
  runId: string,
  stepIndex: number,
  update: Partial<StepCheckpoint>
): CheckpointState | null {
  const state = checkpoints.get(runId);
  if (!state || !state.steps[stepIndex]) return null;

  Object.assign(state.steps[stepIndex], update);
  state.updatedAt = Date.now();

  if (update.status === "completed") {
    state.steps[stepIndex].completedAt = Date.now();
    // Auto-advance current step
    if (stepIndex === state.currentStep && stepIndex + 1 < state.totalSteps) {
      state.currentStep = stepIndex + 1;
      state.steps[stepIndex + 1].status = "running";
      state.steps[stepIndex + 1].startedAt = Date.now();
    }
  }

  return state;
}

/**
 * Pause a running checkpoint.
 */
export function pauseCheckpoint(runId: string): CheckpointState | null {
  const state = checkpoints.get(runId);
  if (!state || state.status !== "running") return null;

  state.status = "paused";
  state.pausedAt = Date.now();
  state.updatedAt = Date.now();

  // Mark current running step as paused
  const runningStep = state.steps.find((s) => s.status === "running");
  if (runningStep) {
    runningStep.status = "pending"; // Will resume
  }

  console.log(`[Checkpoint] Run ${runId} paused at step ${state.currentStep}`);
  return state;
}

/**
 * Resume a paused checkpoint.
 */
export function resumeCheckpoint(runId: string): CheckpointState | null {
  const state = checkpoints.get(runId);
  if (!state || state.status !== "paused") return null;

  state.status = "running";
  state.resumedAt = Date.now();
  state.updatedAt = Date.now();

  // Resume current step
  if (state.steps[state.currentStep]) {
    state.steps[state.currentStep].status = "running";
    state.steps[state.currentStep].startedAt = Date.now();
  }

  console.log(`[Checkpoint] Run ${runId} resumed at step ${state.currentStep}`);
  return state;
}

/**
 * Complete a checkpoint.
 */
export function completeCheckpoint(runId: string, finalData?: Record<string, any>): CheckpointState | null {
  const state = checkpoints.get(runId);
  if (!state) return null;

  state.status = "completed";
  state.completedAt = Date.now();
  state.updatedAt = Date.now();
  if (finalData) state.data = { ...state.data, ...finalData };

  return state;
}

/**
 * Fail a checkpoint.
 */
export function failCheckpoint(runId: string, error: string): CheckpointState | null {
  const state = checkpoints.get(runId);
  if (!state) return null;

  state.status = "failed";
  state.updatedAt = Date.now();
  state.data.error = error;

  const runningStep = state.steps.find((s) => s.status === "running");
  if (runningStep) {
    runningStep.status = "failed";
    runningStep.error = error;
  }

  return state;
}

/**
 * Cancel a checkpoint.
 */
export function cancelCheckpoint(runId: string): CheckpointState | null {
  const state = checkpoints.get(runId);
  if (!state) return null;

  state.status = "cancelled";
  state.updatedAt = Date.now();

  // Mark remaining steps as skipped
  for (const step of state.steps) {
    if (step.status === "pending" || step.status === "running") {
      step.status = "skipped";
    }
  }

  return state;
}

/**
 * Get checkpoint state.
 */
export function getCheckpoint(runId: string): CheckpointState | null {
  return checkpoints.get(runId) || null;
}

/**
 * Store arbitrary data in the checkpoint.
 */
export function storeData(runId: string, key: string, value: any): void {
  const state = checkpoints.get(runId);
  if (state) {
    state.data[key] = value;
    state.updatedAt = Date.now();
  }
}

/**
 * List all checkpoints, optionally filtered by status.
 */
export function listCheckpoints(
  status?: CheckpointState["status"]
): CheckpointState[] {
  const all = Array.from(checkpoints.values());
  if (status) return all.filter((c) => c.status === status);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Clean up old checkpoints (completed/failed/cancelled older than maxAge).
 */
export function cleanupCheckpoints(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAgeMs;
  let cleaned = 0;

  for (const [runId, state] of checkpoints.entries()) {
    if (
      (state.status === "completed" || state.status === "failed" || state.status === "cancelled") &&
      state.updatedAt < cutoff
    ) {
      checkpoints.delete(runId);
      cleaned++;
    }
  }

  return cleaned;
}
