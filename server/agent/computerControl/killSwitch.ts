import { EventEmitter } from "events";

export interface KillSwitchState {
  armed: boolean;
  armedAt: number | null;
  armedBy: string | null;
  reason: string | null;
  activationsCount: number;
}

export interface KillEvent {
  type: "armed" | "disarmed" | "activated";
  timestamp: number;
  userId: string;
  reason: string;
  abortedRuns: string[];
}

export class KillSwitch extends EventEmitter {
  private armed = false;
  private armedAt: number | null = null;
  private armedBy: string | null = null;
  private reason: string | null = null;
  private activationsCount = 0;
  private activeControllers: Map<string, AbortController> = new Map();

  getState(): KillSwitchState {
    return {
      armed: this.armed,
      armedAt: this.armedAt,
      armedBy: this.armedBy,
      reason: this.reason,
      activationsCount: this.activationsCount,
    };
  }

  isArmed(): boolean {
    return this.armed;
  }

  arm(userId: string, reason: string): KillEvent {
    this.armed = true;
    this.armedAt = Date.now();
    this.armedBy = userId;
    this.reason = reason;

    const abortedRuns = this.abortAllRuns();
    this.activationsCount++;

    const event: KillEvent = {
      type: "armed",
      timestamp: Date.now(),
      userId,
      reason,
      abortedRuns,
    };

    this.emit("armed", event);
    this.emit("kill", event);
    return event;
  }

  disarm(userId: string, reason: string): KillEvent {
    this.armed = false;
    this.armedAt = null;
    this.armedBy = null;
    this.reason = null;

    const event: KillEvent = {
      type: "disarmed",
      timestamp: Date.now(),
      userId,
      reason,
      abortedRuns: [],
    };

    this.emit("disarmed", event);
    return event;
  }

  registerRun(runId: string): AbortController {
    if (this.armed) {
      const controller = new AbortController();
      controller.abort(new Error(`Kill switch is armed: ${this.reason}`));
      return controller;
    }

    const controller = new AbortController();
    this.activeControllers.set(runId, controller);

    return controller;
  }

  unregisterRun(runId: string): void {
    this.activeControllers.delete(runId);
  }

  abortRun(runId: string): boolean {
    const controller = this.activeControllers.get(runId);
    if (!controller) return false;

    controller.abort(new Error("Aborted by kill switch"));
    this.activeControllers.delete(runId);
    return true;
  }

  private abortAllRuns(): string[] {
    const abortedRuns: string[] = [];
    for (const [runId, controller] of this.activeControllers) {
      try {
        controller.abort(new Error(`Kill switch activated: ${this.reason}`));
        abortedRuns.push(runId);
      } catch {}
    }
    this.activeControllers.clear();
    return abortedRuns;
  }

  getActiveRunCount(): number {
    return this.activeControllers.size;
  }

  getActiveRunIds(): string[] {
    return Array.from(this.activeControllers.keys());
  }
}

export const killSwitch = new KillSwitch();
