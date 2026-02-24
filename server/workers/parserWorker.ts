/**
 * Parser Worker - Standalone worker script for parser execution
 * PARE Phase 2 Security Hardening
 * 
 * Runs in worker_threads to isolate parser execution with resource limits.
 */

import { parentPort, workerData } from 'worker_threads';
import type { 
  WorkerMessageToWorker, 
  WorkerMessageFromWorker, 
  ParserTask, 
  ParserTaskResult 
} from '../lib/pareWorkerTask.ts';
import { deserializeContent, WorkerErrorCode } from '../lib/pareWorkerTask.ts';

if (!parentPort) {
  throw new Error('This script must be run as a worker thread');
}

const port = parentPort;

let selfTerminationTimer: NodeJS.Timeout | null = null;

function getMemoryUsageMB(): number {
  try {
    const usage = process.memoryUsage();
    return usage.heapUsed / (1024 * 1024);
  } catch {
    return 0;
  }
}

function sendResult(result: ParserTaskResult): void {
  const message: WorkerMessageFromWorker = { type: 'result', result };
  port.postMessage(message);
}

function sendError(taskId: string, error: string, errorCode: string): void {
  const message: WorkerMessageFromWorker = { 
    type: 'error', 
    taskId, 
    error, 
    errorCode 
  };
  port.postMessage(message);
}

function sendReady(): void {
  const message: WorkerMessageFromWorker = { type: 'ready' };
  port.postMessage(message);
}

function sendShutdownComplete(): void {
  const message: WorkerMessageFromWorker = { type: 'shutdown_complete' };
  port.postMessage(message);
}

function setSelfTerminationTimer(timeoutMs: number, taskId: string): void {
  if (selfTerminationTimer) {
    clearTimeout(selfTerminationTimer);
  }
  
  selfTerminationTimer = setTimeout(() => {
    sendError(taskId, `Worker self-terminated after ${timeoutMs}ms timeout`, WorkerErrorCode.TIMEOUT);
    process.exit(1);
  }, timeoutMs + 1000);
}

function clearSelfTerminationTimer(): void {
  if (selfTerminationTimer) {
    clearTimeout(selfTerminationTimer);
    selfTerminationTimer = null;
  }
}

async function executeTask(task: ParserTask): Promise<ParserTaskResult> {
  const startTime = Date.now();
  const initialMemory = getMemoryUsageMB();
  const timeout = task.options?.timeout || 30000;
  
  setSelfTerminationTimer(timeout, task.taskId);
  
  try {
    const content = deserializeContent(task.content);
    const fileType = {
      mimeType: task.mimeType,
      extension: task.extension,
      confidence: task.confidence,
    };
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Task timeout after ${timeout}ms`));
      }, timeout);
    });
    
    const parsePromise = (async () => {
      return {
        text: content.toString('utf8').slice(0, 10000),
        metadata: {
          parser: task.parserName,
          workerExecuted: true,
          fileSize: content.length,
          mimeType: task.mimeType,
        },
      };
    })();
    
    const result = await Promise.race([parsePromise, timeoutPromise]);
    
    clearSelfTerminationTimer();
    
    const parseTimeMs = Date.now() - startTime;
    const memoryUsedMB = getMemoryUsageMB() - initialMemory;
    
    return {
      taskId: task.taskId,
      success: true,
      result,
      metrics: {
        parseTimeMs,
        memoryUsedMB: Math.max(0, memoryUsedMB),
      },
    };
    
  } catch (error) {
    clearSelfTerminationTimer();
    
    const parseTimeMs = Date.now() - startTime;
    const memoryUsedMB = getMemoryUsageMB() - initialMemory;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    let errorCode = WorkerErrorCode.PARSE_ERROR;
    if (errorMessage.includes('timeout')) {
      errorCode = WorkerErrorCode.TIMEOUT;
    } else if (errorMessage.includes('memory')) {
      errorCode = WorkerErrorCode.MEMORY_EXCEEDED;
    }
    
    return {
      taskId: task.taskId,
      success: false,
      error: errorMessage,
      errorCode,
      metrics: {
        parseTimeMs,
        memoryUsedMB: Math.max(0, memoryUsedMB),
      },
    };
  }
}

port.on('message', async (message: WorkerMessageToWorker) => {
  switch (message.type) {
    case 'task':
      try {
        const result = await executeTask(message.task);
        sendResult(result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        sendError(message.task.taskId, errorMessage, WorkerErrorCode.UNKNOWN);
      }
      break;
      
    case 'shutdown':
      clearSelfTerminationTimer();
      sendShutdownComplete();
      process.exit(0);
      break;
  }
});

port.on('error', (error) => {
  console.error('[ParserWorker] Port error:', error);
});

sendReady();
