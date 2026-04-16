/**
 * PARE Worker Task - Worker task interfaces and message protocol
 * PARE Phase 2 Security Hardening
 */

export interface ParserTaskOptions {
  timeout?: number;
  maxMemory?: number;
}

export interface ParserTask {
  taskId: string;
  parserName: string;
  content: Buffer | string;
  mimeType: string;
  filename: string;
  extension: string;
  confidence: number;
  options?: ParserTaskOptions;
}

export interface ParserTaskResult {
  taskId: string;
  success: boolean;
  result?: {
    text: string;
    metadata?: Record<string, any>;
    warnings?: string[];
  };
  error?: string;
  errorCode?: string;
  metrics: {
    parseTimeMs: number;
    memoryUsedMB: number;
  };
}

export type WorkerMessageToWorker =
  | { type: 'task'; task: ParserTask }
  | { type: 'shutdown' };

export type WorkerMessageFromWorker =
  | { type: 'result'; result: ParserTaskResult }
  | { type: 'error'; taskId: string; error: string; errorCode: string }
  | { type: 'ready' }
  | { type: 'shutdown_complete' };

// NOTE: This must be runtime-loadable under Node's "strip types" TS loader.
// Node cannot strip TypeScript enums (it throws: "TypeScript enum is not supported in strip-only mode").
export const WorkerErrorCode = {
  TIMEOUT: 'WORKER_TIMEOUT',
  MEMORY_EXCEEDED: 'WORKER_MEMORY_EXCEEDED',
  PARSE_ERROR: 'WORKER_PARSE_ERROR',
  WORKER_TERMINATED: 'WORKER_TERMINATED',
  UNKNOWN: 'WORKER_UNKNOWN_ERROR',
} as const;

export type WorkerErrorCode = (typeof WorkerErrorCode)[keyof typeof WorkerErrorCode];

export function serializeTask(task: ParserTask): ParserTask {
  return {
    ...task,
    content: typeof task.content === 'string' 
      ? task.content 
      : task.content.toString('base64'),
  };
}

export function deserializeContent(content: Buffer | string): Buffer {
  if (Buffer.isBuffer(content)) {
    return content;
  }
  return Buffer.from(content, 'base64');
}
