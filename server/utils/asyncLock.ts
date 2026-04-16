export class AsyncLock {
    private permits: number = 1;
    private queue: ((value: void | PromiseLike<void>) => void)[] = [];

    async acquire(): Promise<void> {
        if (this.permits > 0) {
            this.permits--;
            return Promise.resolve();
        }
        return new Promise<void>(resolve => {
            this.queue.push(resolve);
        });
    }

    release(): void {
        if (this.queue.length > 0) {
            const resolve = this.queue.shift();
            if (resolve) resolve();
        } else {
            this.permits++;
        }
    }

    async withLock<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}
