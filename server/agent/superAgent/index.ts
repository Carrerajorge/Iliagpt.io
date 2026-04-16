export * from "./contracts";
export * from "./researchPolicy";
export * from "./contractRouter";
export * from "./signalsPipeline";
export * from "./deepDivePipeline";
export * from "./artifactTools";
export * from "./qualityGate";
export * from "./orchestrator";

import { SuperAgentOrchestrator, createSuperAgent } from "./orchestrator";
import { parsePromptToContract, validateContract, repairContract } from "./contractRouter";
import { shouldResearch, extractSourceRequirement } from "./researchPolicy";
import { evaluateQualityGate, shouldRetry, formatGateReport } from "./qualityGate";
import { createXlsx, createDocx, packCitations, getArtifact, getArtifactMeta } from "./artifactTools";

export const superAgent = {
  createOrchestrator: createSuperAgent,
  
  parseContract: parsePromptToContract,
  validateContract,
  repairContract,
  
  shouldResearch,
  extractSourceRequirement,
  
  evaluateQualityGate,
  shouldRetry,
  formatGateReport,
  
  createXlsx,
  createDocx,
  packCitations,
  getArtifact,
  getArtifactMeta,
};

export default superAgent;
