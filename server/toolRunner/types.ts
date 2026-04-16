export type ToolRunnerLocale = "es" | "en" | string;

export type ToolCommandName =
  | "docgen"
  | "xlsxgen"
  | "pptxgen"
  | "mso-validate"
  | "theme-apply"
  | "render-preview";

export type ToolRunnerDocumentType = "docx" | "xlsx" | "pptx";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ToolAssetRef {
  name: string;
  path: string;
  mediaType?: string;
  sha256?: string;
}

export interface DesignTokens {
  colors?: Record<string, string>;
  fonts?: Record<string, string>;
  spacing?: Record<string, number>;
  metadata?: Record<string, string>;
}

export interface ThemeInput {
  id?: string;
  name?: string;
  tokens?: DesignTokens;
}

export interface ToolRunnerInput {
  protocolVersion: string;
  commandVersion: string;
  locale: ToolRunnerLocale;
  documentType: ToolRunnerDocumentType;
  title: string;
  templateId?: string;
  data: Record<string, unknown>;
  options?: Record<string, unknown>;
  assets?: ToolAssetRef[];
  designTokens?: DesignTokens;
  theme?: ThemeInput;
  determinism: {
    inputHash: string;
    idempotencyKey: string;
  };
}

export interface ToolRunnerIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
  details?: Record<string, unknown>;
}

export interface ToolRunnerPreflightResult {
  ok: boolean;
  issues: ToolRunnerIssue[];
}

export interface ToolRunnerValidationResult {
  valid: boolean;
  checks: {
    relationships: boolean;
    styles: boolean;
    fonts: boolean;
    images: boolean;
    schema: boolean;
  };
  metadata: Record<string, unknown>;
  issues: ToolRunnerIssue[];
}

export interface ToolCommandResult {
  success: boolean;
  tool: ToolCommandName;
  version: string;
  artifactPath?: string;
  reportPath?: string;
  previewPath?: string;
  outputHash?: string;
  validation?: ToolRunnerValidationResult;
  issues: ToolRunnerIssue[];
}

export interface ToolRunnerStructuredLog {
  kind: "log" | "result" | "error";
  level: LogLevel;
  ts: string;
  tool: ToolCommandName;
  event: string;
  data?: Record<string, unknown>;
}

export interface ToolRunnerToolDefinition {
  name: ToolCommandName;
  version: string;
  description: string;
  capabilities: string[];
  stateless: true;
  inputFormat: "json";
  outputFormat: "file+json";
}

export interface ToolExecutionTrace {
  tool: ToolCommandName;
  version: string;
  attempt: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  stdout: ToolRunnerStructuredLog[];
  stderr: ToolRunnerStructuredLog[];
}

export interface ToolRunnerIncident {
  code: string;
  message: string;
  severity: "error" | "warning";
  tool?: ToolCommandName;
  attempt?: number;
  details?: Record<string, unknown>;
}

export interface ToolRunnerReport {
  protocolVersion: string;
  locale: ToolRunnerLocale;
  requestHash: string;
  documentType: ToolRunnerDocumentType;
  toolVersionPin: string;
  sandbox: "subprocess" | "docker";
  usedFallback: boolean;
  cacheHit: boolean;
  artifactPath: string;
  validation: ToolRunnerValidationResult;
  traces: ToolExecutionTrace[];
  incidents: ToolRunnerIncident[];
  metrics: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    retries: number;
  };
}

export interface ToolRunnerExecutionOutput {
  artifactPath: string;
  reportPath: string;
  mimeType: string;
  report: ToolRunnerReport;
}
