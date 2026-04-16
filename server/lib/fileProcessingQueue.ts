export interface FileJob {
  fileId: string;
  storagePath: string;
  mimeType: string;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  retries: number;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export type FileStatusUpdate = {
  type: 'file_status';
  fileId: string;
  status: FileJob['status'];
  progress: number;
  error?: string;
};

export class FileProcessingQueue {
  private jobs: Map<string, FileJob> = new Map();
  private queue: string[] = [];
  private activeCount: number = 0;
  private maxConcurrent: number = 3;
  private onStatusChange?: (update: FileStatusUpdate) => void;
  private processCallback?: (job: FileJob) => Promise<void>;
  private maxRetries: number = 3;

  enqueue(job: Omit<FileJob, 'status' | 'retries' | 'progress'>): FileJob {
    const newJob: FileJob = {
      ...job,
      status: 'pending',
      progress: 0,
      retries: 0,
    };
    
    this.jobs.set(job.fileId, newJob);
    this.queue.push(job.fileId);
    this.notifyStatusChange(newJob);

    this.processNext();

    return newJob;
  }

  setStatusChangeHandler(handler: (update: FileStatusUpdate) => void): void {
    this.onStatusChange = handler;
  }

  setProcessCallback(callback: (job: FileJob) => Promise<void>): void {
    this.processCallback = callback;
  }

  getJob(fileId: string): FileJob | undefined {
    return this.jobs.get(fileId);
  }

  getAllJobs(): FileJob[] {
    return Array.from(this.jobs.values());
  }

  getPendingJobs(): FileJob[] {
    return Array.from(this.jobs.values()).filter(j => j.status === 'pending');
  }

  getProcessingJobs(): FileJob[] {
    return Array.from(this.jobs.values()).filter(j => j.status === 'processing');
  }

  updateProgress(fileId: string, progress: number): void {
    const job = this.jobs.get(fileId);
    if (job && job.status === 'processing') {
      job.progress = Math.min(100, Math.max(0, progress));
      this.notifyStatusChange(job);
    }
  }

  markCompleted(fileId: string): void {
    const job = this.jobs.get(fileId);
    if (job) {
      job.status = 'completed';
      job.progress = 100;
      job.completedAt = new Date();
      this.notifyStatusChange(job);
    }
  }

  markFailed(fileId: string, error: string): void {
    const job = this.jobs.get(fileId);
    if (job) {
      job.retries++;
      if (job.retries < this.maxRetries) {
        job.status = 'pending';
        job.error = error;
        this.queue.push(fileId);
        this.notifyStatusChange(job);
        this.processNext();
      } else {
        job.status = 'failed';
        job.error = error;
        job.completedAt = new Date();
        this.notifyStatusChange(job);
      }
    }
  }

  removeJob(fileId: string): boolean {
    this.queue = this.queue.filter(id => id !== fileId);
    return this.jobs.delete(fileId);
  }

  private async processNext(): Promise<void> {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const fileId = this.queue.shift();
    if (!fileId) {
      return;
    }

    const job = this.jobs.get(fileId);
    if (!job || job.status !== 'pending') {
      this.processNext();
      return;
    }

    this.activeCount++;
    job.status = 'processing';
    job.startedAt = new Date();
    this.notifyStatusChange(job);

    // Start another concurrent job if available
    this.processNext();

    try {
      if (this.processCallback) {
        await this.processCallback(job);
      }
      this.markCompleted(fileId);
    } catch (error: any) {
      console.error(`[FileQueue] Error processing job ${fileId}:`, error);
      this.markFailed(fileId, error.message || 'Unknown error');
    } finally {
      this.activeCount--;
      this.processNext();
    }
  }

  private notifyStatusChange(job: FileJob): void {
    if (this.onStatusChange) {
      this.onStatusChange({
        type: 'file_status',
        fileId: job.fileId,
        status: job.status,
        progress: job.progress,
        error: job.error,
      });
    }
  }
}

export const fileProcessingQueue = new FileProcessingQueue();
