import { z } from "zod";

export const ThreatLevelSchema = z.enum(["safe", "low", "medium", "high", "critical"]);
export type ThreatLevel = z.infer<typeof ThreatLevelSchema>;

export const SecurityActionSchema = z.enum(["allow", "warn", "require_confirmation", "block", "log_and_block"]);
export type SecurityAction = z.infer<typeof SecurityActionSchema>;

export const ExecutionStatusSchema = z.enum(["pending", "running", "completed", "failed", "timeout", "blocked", "cancelled"]);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const SecurityAnalysisSchema = z.object({
  command: z.string(),
  isSafe: z.boolean(),
  threatLevel: ThreatLevelSchema,
  action: SecurityActionSchema,
  matchedRules: z.array(z.string()),
  warnings: z.array(z.string()),
  sanitizedCommand: z.string().optional(),
});
export type SecurityAnalysis = z.infer<typeof SecurityAnalysisSchema>;

export const PathSecurityResultSchema = z.object({
  path: z.string(),
  isAllowed: z.boolean(),
  isWithinSandbox: z.boolean(),
  resolvedPath: z.string().optional(),
  reason: z.string().default(""),
});
export type PathSecurityResult = z.infer<typeof PathSecurityResultSchema>;

export const ExecutionResultSchema = z.object({
  command: z.string(),
  status: ExecutionStatusSchema,
  returnCode: z.number().nullable(),
  stdout: z.string().default(""),
  stderr: z.string().default(""),
  executionTime: z.number().default(0),
  errorMessage: z.string().default(""),
  securityAnalysis: SecurityAnalysisSchema.optional(),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

export const ExecutorConfigSchema = z.object({
  defaultTimeout: z.number().int().positive().default(30000),
  maxTimeout: z.number().int().positive().default(300000),
  maxOutputSize: z.number().int().positive().default(10 * 1024 * 1024),
  shell: z.string().default("/bin/bash"),
  workingDirectory: z.string().optional(),
  environment: z.record(z.string()).default({}),
  captureOutput: z.boolean().default(true),
  enableSecurity: z.boolean().default(true),
});
export type ExecutorConfig = z.infer<typeof ExecutorConfigSchema>;

export const FileInfoSchema = z.object({
  path: z.string(),
  name: z.string(),
  extension: z.string(),
  size: z.number(),
  isFile: z.boolean(),
  isDir: z.boolean(),
  created: z.date().nullable(),
  modified: z.date().nullable(),
  permissions: z.string(),
  mimeType: z.string().nullable(),
});
export type FileInfo = z.infer<typeof FileInfoSchema>;

export const FileOperationResultSchema = z.object({
  success: z.boolean(),
  operation: z.string(),
  path: z.string(),
  message: z.string().default(""),
  data: z.any().optional(),
  error: z.string().optional(),
});
export type FileOperationResult = z.infer<typeof FileOperationResultSchema>;

export const SessionStateSchema = z.object({
  sessionId: z.string(),
  createdAt: z.date(),
  lastActive: z.date(),
  workingDirectory: z.string(),
  environmentVars: z.record(z.string()),
  installedPackages: z.array(z.string()),
  customData: z.record(z.any()).default({}),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

export const OperationLogSchema = z.object({
  timestamp: z.date(),
  operationType: z.string(),
  operationName: z.string(),
  parameters: z.record(z.any()),
  result: z.string(),
  durationMs: z.number(),
  success: z.boolean(),
});
export type OperationLog = z.infer<typeof OperationLogSchema>;

export const ToolInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  path: z.string(),
  available: z.boolean(),
});
export type ToolInfo = z.infer<typeof ToolInfoSchema>;

export const EnvironmentStatusSchema = z.object({
  isInitialized: z.boolean(),
  isHealthy: z.boolean(),
  workspacePath: z.string(),
  sessionId: z.string().nullable(),
  uptimeSeconds: z.number(),
  toolsAvailable: z.record(ToolInfoSchema),
  diskUsage: z.record(z.any()),
  activeProcesses: z.number(),
});
export type EnvironmentStatus = z.infer<typeof EnvironmentStatusSchema>;

export const EnvironmentConfigSchema = z.object({
  workspaceRoot: z.string().optional(),
  stateDirectory: z.string().default(".state"),
  tempDirectory: z.string().default(".tmp"),
  enableSecurity: z.boolean().default(true),
  defaultTimeout: z.number().int().positive().default(30000),
  maxTimeout: z.number().int().positive().default(300000),
  maxFileSize: z.number().int().positive().default(100 * 1024 * 1024),
  autoSave: z.boolean().default(true),
  saveInterval: z.number().int().positive().default(60000),
  maxHistory: z.number().int().positive().default(10000),
  requiredTools: z.array(z.string()).default(["python3", "pip3", "node", "npm", "git", "curl", "wget"]),
});
export type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>;

export const SecurityStatsSchema = z.object({
  totalChecks: z.number().default(0),
  blocked: z.number().default(0),
  warned: z.number().default(0),
  allowed: z.number().default(0),
  blockedHistoryCount: z.number().default(0),
  sandboxRoot: z.string(),
});
export type SecurityStats = z.infer<typeof SecurityStatsSchema>;

export const ExecutorStatsSchema = z.object({
  totalExecutions: z.number().default(0),
  successful: z.number().default(0),
  successRate: z.number().default(0),
  avgExecutionTime: z.number().default(0),
  activeProcesses: z.number().default(0),
});
export type ExecutorStats = z.infer<typeof ExecutorStatsSchema>;

export const FileManagerStatsSchema = z.object({
  filesRead: z.number().default(0),
  filesWritten: z.number().default(0),
  filesDeleted: z.number().default(0),
  bytesRead: z.number().default(0),
  bytesWritten: z.number().default(0),
  sandboxRoot: z.string(),
  maxFileSize: z.number(),
});
export type FileManagerStats = z.infer<typeof FileManagerStatsSchema>;

export interface ISandboxService {
  initialize(): Promise<boolean>;
  shutdown(): Promise<void>;
  execute(command: string, options?: { timeout?: number; workingDir?: string; env?: Record<string, string> }): Promise<ExecutionResult>;
  executeScript(scriptContent: string, interpreter?: string, timeout?: number): Promise<ExecutionResult>;
  executePython(code: string, timeout?: number): Promise<ExecutionResult>;
  executeNode(code: string, timeout?: number): Promise<ExecutionResult>;
  readFile(path: string, encoding?: string): Promise<FileOperationResult>;
  writeFile(path: string, content: string, options?: { createDirs?: boolean }): Promise<FileOperationResult>;
  deleteFile(path: string, options?: { recursive?: boolean }): Promise<FileOperationResult>;
  listFiles(path?: string, pattern?: string): Promise<FileOperationResult>;
  fileExists(path: string): Promise<boolean>;
  getStatus(): Promise<EnvironmentStatus>;
  getHistory(limit?: number): Promise<OperationLog[]>;
}
