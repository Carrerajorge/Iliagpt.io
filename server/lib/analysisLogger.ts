export interface AnalysisLogContext {
  uploadId?: string;
  sessionId?: string;
  jobId?: string;
  sheetName?: string;
  correlationId?: string;
}

export interface AnalysisTelemetry {
  event: string;
  durationMs?: number;
  status?: 'started' | 'completed' | 'failed';
  error?: string;
  metadata?: Record<string, any>;
}

function generateCorrelationId(uploadId?: string, sessionId?: string): string {
  const prefix = uploadId?.slice(0, 8) || sessionId?.slice(0, 8) || 'unknown';
  const timestamp = Date.now().toString(36);
  return `${prefix}-${timestamp}`;
}

function formatLogEntry(
  level: 'info' | 'warn' | 'error' | 'debug',
  context: AnalysisLogContext,
  telemetry: AnalysisTelemetry
): string {
  const timestamp = new Date().toISOString();
  const corrId = context.correlationId || generateCorrelationId(context.uploadId, context.sessionId);
  
  const entry = {
    timestamp,
    level,
    correlationId: corrId,
    uploadId: context.uploadId,
    sessionId: context.sessionId,
    jobId: context.jobId,
    sheetName: context.sheetName,
    event: telemetry.event,
    durationMs: telemetry.durationMs,
    status: telemetry.status,
    error: telemetry.error,
    ...telemetry.metadata,
  };
  
  return JSON.stringify(entry);
}

export const analysisLogger = {
  info(context: AnalysisLogContext, telemetry: AnalysisTelemetry): void {
    console.log(formatLogEntry('info', context, telemetry));
  },
  
  warn(context: AnalysisLogContext, telemetry: AnalysisTelemetry): void {
    console.warn(formatLogEntry('warn', context, telemetry));
  },
  
  error(context: AnalysisLogContext, telemetry: AnalysisTelemetry): void {
    console.error(formatLogEntry('error', context, telemetry));
  },
  
  debug(context: AnalysisLogContext, telemetry: AnalysisTelemetry): void {
    if (process.env.DEBUG) {
      console.debug(formatLogEntry('debug', context, telemetry));
    }
  },
  
  trackAnalysisStart(uploadId: string, sessionId: string, sheetCount: number): void {
    this.info(
      { uploadId, sessionId, correlationId: generateCorrelationId(uploadId, sessionId) },
      { event: 'analysis_session_started', status: 'started', metadata: { sheetCount } }
    );
  },
  
  trackSheetJobStart(context: AnalysisLogContext): { endTimer: (success: boolean, error?: string) => void } {
    const startTime = Date.now();
    this.info(context, { event: 'sheet_job_started', status: 'started' });
    
    return {
      endTimer: (success: boolean, error?: string) => {
        const durationMs = Date.now() - startTime;
        if (success) {
          this.info(context, { event: 'sheet_job_completed', status: 'completed', durationMs });
        } else {
          this.error(context, { event: 'sheet_job_failed', status: 'failed', durationMs, error });
        }
      }
    };
  },
  
  trackSandboxExecution(context: AnalysisLogContext, durationMs: number, success: boolean, error?: string): void {
    if (success) {
      this.info(context, { event: 'sandbox_execution_completed', status: 'completed', durationMs });
    } else {
      this.error(context, { event: 'sandbox_execution_failed', status: 'failed', durationMs, error });
    }
  },
  
  trackCodeGeneration(context: AnalysisLogContext, durationMs: number): void {
    this.info(context, { event: 'code_generation_completed', status: 'completed', durationMs });
  },
  
  trackPreviewGeneration(context: AnalysisLogContext, rowCount: number, colCount: number, truncated: boolean): void {
    this.debug(context, { 
      event: 'preview_generated', 
      metadata: { rowCount, colCount, truncated } 
    });
  },
};

export function createAnalysisContext(uploadId: string, sessionId?: string): AnalysisLogContext {
  return {
    uploadId,
    sessionId,
    correlationId: generateCorrelationId(uploadId, sessionId),
  };
}

export function withCorrelationId<T extends AnalysisLogContext>(
  context: T,
  jobId?: string,
  sheetName?: string
): T {
  return {
    ...context,
    jobId,
    sheetName,
  };
}
