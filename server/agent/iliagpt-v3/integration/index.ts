export { 
  IliagptBridge, 
  getIliagptBridge, 
  resetIliagptBridge,
  adaptLegacyTool,
  adaptLegacyAgent,
  adaptLegacyUser,
  type LegacyToolConfig
} from "./adapter";

export {
  initializeIliagptBridge,
  executeToolEnterprise,
  getEnterpriseMetrics,
  getEnterpriseAuditLog,
  resetEnterprise,
} from "./example";

export {
  bootstrapIliagptV3,
  isIliagptEnabled,
  iliagptExecuteTool,
  iliagptRunWorkflow,
  iliagptRegisterTool,
  iliagptGetMetrics,
  iliagptGetAuditLog,
  iliagptGetCircuitState,
} from "./bootstrap";
