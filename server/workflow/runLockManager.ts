export class RunLockManager {
  private readonly tails = new Map<string, Promise<void>>();

  async withLock<T>(runId: string, timeoutMs: number, task: () => Promise<T>): Promise<T> {
    const previousTail = this.tails.get(runId) ?? Promise.resolve();

    let releaseCurrent!: () => void;
    const currentTail = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    this.tails.set(
      runId,
      previousTail
        .catch(() => {
          // Ignore previous lock errors to keep the queue moving.
        })
        .then(() => currentTail),
    );

    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      await Promise.race([
        previousTail.catch(() => {
          // Ignore previous lock errors; the lock is still considered released.
        }),
        new Promise<void>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`Timeout waiting for lock on run ${runId}`));
          }, timeoutMs);
        }),
      ]);

      return await task();
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      releaseCurrent();
      if (this.tails.get(runId) === currentTail) {
        this.tails.delete(runId);
      }
    }
  }
}
