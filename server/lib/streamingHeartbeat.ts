
import { Response } from 'express';

// Keeps SSE/Streaming connections alive by sending a comment every 15s
// Prevents Load Balancers (AWS ALB, Nginx) from killing "idle" connections during long LLM thoughts

export const SseHeartbeat = (res: Response, intervalMs = 15000) => {
    const timer = setInterval(() => {
        // Only send if connection is still writable
        if (!res.writableEnded) {
            // SSE comment format (starts with :)
            res.write(`: heartbeat ${Date.now()}\n\n`);
        } else {
            clearInterval(timer);
        }
    }, intervalMs);

    // Cleanup on close
    res.on('close', () => clearInterval(timer));
    res.on('finish', () => clearInterval(timer));

    return timer;
};
