export { 
  MichatBridge, 
  getMichatBridge, 
  resetMichatBridge,
  adaptLegacyTool,
  adaptLegacyAgent,
  adaptLegacyUser,
  type LegacyToolConfig
} from "./adapter";

export {
  initializeMichatBridge,
  executeToolEnterprise,
  getEnterpriseMetrics,
  getEnterpriseAuditLog,
  resetEnterprise,
} from "./example";

export {
  bootstrapMichatV3,
  isMichatEnabled,
  michatExecuteTool,
  michatRunWorkflow,
  michatRegisterTool,
  michatGetMetrics,
  michatGetAuditLog,
  michatGetCircuitState,
} from "./bootstrap";
