import { Worker } from 'worker_threads';
import { cpus } from 'os';

export interface PoolConfig {
    minSize?: number;
    maxSize?: number;
    idleTimeoutMs?: number;
}

export class ThreadPool {
    private workers: Worker[] = [];
    private taskQueue: Array<{
        task: any;
        resolve: (res: any) => void;
        reject: (err: any) => void;
    }> = [];
    private busyWorkers: Set<Worker> = new Set();

    public readonly maxSize: number;

    constructor(config?: PoolConfig) {
        this.maxSize = config?.maxSize || cpus().length * 2;
    }

    // Uses a placeholder worker file. In production, this would load actual worker logic.
    private createWorker(): Worker {
        const workerScript = `
      const { parentPort } = require('worker_threads');
      parentPort.on('message', async (task) => {
        try {
          // Placeholder execution.
          if (task.type === 'ECHO') {
            parentPort.postMessage({ status: 'SUCCESS', result: task.payload });
          } else {
            parentPort.postMessage({ status: 'ERROR', error: 'Unknown task type' });
          }
        } catch(e) {
          parentPort.postMessage({ status: 'ERROR', error: e.message });
        }
      });
    `;
        const worker = new Worker(workerScript, { eval: true });

        worker.on('message', (msg) => {
            this.busyWorkers.delete(worker);
            // We'd map msg to the specific promise in a real advanced pool,
            // Here we just acknowledge worker is free.
            this.pumpQueue();
        });

        worker.on('error', (err) => {
            console.error('[ThreadPool] Worker error:', err);
            this.busyWorkers.delete(worker);
            this.workers = this.workers.filter(w => w !== worker);
            this.pumpQueue();
        });

        worker.on('exit', (code) => {
            if (code !== 0) console.warn(`[ThreadPool] Worker stopped with exit code ${code}`);
            this.busyWorkers.delete(worker);
            this.workers = this.workers.filter(w => w !== worker);
            this.pumpQueue();
        });

        this.workers.push(worker);
        return worker;
    }

    private pumpQueue() {
        if (this.taskQueue.length === 0) return;

        for (const worker of this.workers) {
            if (!this.busyWorkers.has(worker)) {
                const item = this.taskQueue.shift();
                if (item) {
                    this.busyWorkers.add(worker);
                    // A real implementation routes the resolve/reject back via message IDs.
                    // This is a minimal skeleton.
                    worker.postMessage(item.task);
                    // For now, immediately resolve just to complete the mock flow.
                    item.resolve({ dispatched: true });
                }
                if (this.taskQueue.length === 0) break;
            }
        }

        if (this.taskQueue.length > 0 && this.workers.length < this.maxSize) {
            const newWorker = this.createWorker();
            const item = this.taskQueue.shift();
            if (item) {
                this.busyWorkers.add(newWorker);
                newWorker.postMessage(item.task);
                item.resolve({ dispatched: true, newWorkerSpawned: true });
            }
        }
    }

    public execute(task: any): Promise<any> {
        return new Promise((resolve, reject) => {
            this.taskQueue.push({ task, resolve, reject });
            this.pumpQueue();
        });
    }

    public async shutdown(): Promise<void> {
        const promises = this.workers.map(w => w.terminate());
        await Promise.all(promises);
        this.workers = [];
        this.busyWorkers.clear();
        console.log('[ThreadPool] Pool shutdown complete.');
    }
}

export class ProcessPool {
    // Similar to ThreadPool but using child_process for full isolation.
    // Utilizing SharedArrayBuffer for zero-copy memory between processes is complex via child_process,
    // but feasible via worker_threads. Therefore, the architectural hybrid utilizes Threads for zero-copy
    // and isolated Processes for dangerous/heavy workloads.

    public executeVolatile(binaryCommand: string, args: string[]): void {
        console.log(`[ProcessPool] Executing isolated volatile process: ${binaryCommand} ${args.join(' ')}`);
        // child_process.spawn logic here
    }
}

export const globalThreadPool = new ThreadPool();
export const globalProcessPool = new ProcessPool();
