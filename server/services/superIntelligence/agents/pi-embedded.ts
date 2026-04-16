import {
  compactEmbeddedPiSession,
  resolveEmbeddedSessionLane,
  type EmbeddedPiAgentMeta,
  type EmbeddedPiCompactResult,
  type EmbeddedPiRunMeta,
  type EmbeddedPiRunResult,
} from "./pi-embedded-runner.js";
import {
  abortEmbeddedPiRun,
  isEmbeddedPiRunActive,
  isEmbeddedPiRunStreaming,
  queueEmbeddedPiMessage,
  waitForEmbeddedPiRunEnd,
} from "../../../openclaw/src/agents/pi-embedded-runner/runs.js";

type OpenClawEmbeddedRun = typeof import("../../../openclaw/src/agents/pi-embedded-runner/run.js").runEmbeddedPiAgent;

let openClawEmbeddedRunLoader: OpenClawEmbeddedRun | null = null;

export type {
  EmbeddedPiAgentMeta,
  EmbeddedPiCompactResult,
  EmbeddedPiRunMeta,
  EmbeddedPiRunResult,
};
export {
  abortEmbeddedPiRun,
  compactEmbeddedPiSession,
  isEmbeddedPiRunActive,
  isEmbeddedPiRunStreaming,
  queueEmbeddedPiMessage,
  resolveEmbeddedSessionLane,
  waitForEmbeddedPiRunEnd,
};

export async function runEmbeddedPiAgent(
  ...args: Parameters<OpenClawEmbeddedRun>
): ReturnType<OpenClawEmbeddedRun> {
  if (!openClawEmbeddedRunLoader) {
    const mod = await import("../../../openclaw/src/agents/pi-embedded-runner/run.js");
    openClawEmbeddedRunLoader = mod.runEmbeddedPiAgent;
  }

  return openClawEmbeddedRunLoader(...args);
}
