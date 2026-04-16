import { TraceBus } from "./TraceBus";
import { DEFAULT_PROGRESS_WEIGHTS, ProgressWeights } from "./types";

interface ProgressState {
  phase: "planning" | "signals" | "verification" | "enrichment" | "export" | "finalization";
  collected: number;
  verified: number;
  accepted: number;
  rejected: number;
  targetCount: number;
  exportStage: number;
}

export class ProgressModel {
  private state: ProgressState;
  private weights: ProgressWeights;
  private traceBus: TraceBus;
  private lastEmittedProgress: number = 0;
  private checkpointThreshold: number = 5;

  constructor(traceBus: TraceBus, targetCount: number = 50, weights?: ProgressWeights) {
    this.traceBus = traceBus;
    this.weights = weights ?? DEFAULT_PROGRESS_WEIGHTS;
    this.state = {
      phase: "planning",
      collected: 0,
      verified: 0,
      accepted: 0,
      rejected: 0,
      targetCount,
      exportStage: 0,
    };
  }

  setPhase(phase: ProgressState["phase"]): void {
    this.state.phase = phase;
    this.emitProgress();
  }

  addCollected(count: number = 1): void {
    this.state.collected += count;
    this.maybeEmitCheckpoint();
  }

  addVerified(count: number = 1): void {
    this.state.verified += count;
    this.maybeEmitCheckpoint();
  }

  addAccepted(count: number = 1): void {
    this.state.accepted += count;
    this.maybeEmitCheckpoint();
  }

  addRejected(count: number = 1): void {
    this.state.rejected += count;
  }

  setExportStage(stage: number): void {
    this.state.exportStage = Math.min(stage, 100);
    this.emitProgress();
  }

  getProgress(): number {
    const { collected, verified, accepted, targetCount, exportStage, phase } = this.state;
    const { collection, verification, export: exportWeight } = this.weights;

    let phaseMultiplier = 0;
    switch (phase) {
      case "planning":
        phaseMultiplier = 0;
        break;
      case "signals":
        phaseMultiplier = 0.1;
        break;
      case "verification":
        phaseMultiplier = 0.3;
        break;
      case "enrichment":
        phaseMultiplier = 0.6;
        break;
      case "export":
        phaseMultiplier = 0.8;
        break;
      case "finalization":
        phaseMultiplier = 0.95;
        break;
    }

    const collectionProgress = Math.min(collected / (targetCount * 3), 1);
    const verificationProgress = Math.min(verified / targetCount, 1);
    const acceptedProgress = Math.min(accepted / targetCount, 1);
    const exportProgress = exportStage / 100;

    const rawProgress = 
      (collectionProgress * collection * 0.5) +
      (verificationProgress * collection * 0.5) +
      (acceptedProgress * verification) +
      (exportProgress * exportWeight);

    const progress = Math.max(phaseMultiplier * 100, rawProgress * 100);

    return Math.min(Math.round(progress * 10) / 10, 100);
  }

  getMetrics(): {
    articles_collected: number;
    articles_verified: number;
    articles_accepted: number;
  } {
    return {
      articles_collected: this.state.collected,
      articles_verified: this.state.verified,
      articles_accepted: this.state.accepted,
    };
  }

  private emitProgress(): void {
    const progress = this.getProgress();
    const metrics = this.getMetrics();

    this.traceBus.progressUpdate("ProgressModel", progress, metrics);
    this.lastEmittedProgress = progress;
  }

  private maybeEmitCheckpoint(): void {
    const progress = this.getProgress();
    
    if (progress - this.lastEmittedProgress >= this.checkpointThreshold) {
      const metrics = this.getMetrics();
      this.traceBus.checkpoint("ProgressModel", `Checkpoint at ${progress.toFixed(1)}%`, metrics);
      this.lastEmittedProgress = progress;
    }
  }

  getState(): ProgressState {
    return { ...this.state };
  }
}

export function createProgressModel(traceBus: TraceBus, targetCount?: number): ProgressModel {
  return new ProgressModel(traceBus, targetCount);
}
