/**
 * Stream Manager (Mejora #10 - Fase 2)
 *
 * Gestión robusta de conexiones SSE para streaming de respuestas IA:
 *   - Cancelación explícita por requestId (el cliente envía DELETE)
 *   - Timeout automático si el cliente se desconecta
 *   - Rate de envío configurable para evitar saturar la red
 *   - Limpieza automática de streams zombies
 *
 * Uso:
 *   const stream = streamManager.create(res, requestId, userId);
 *   stream.write({ type: "chunk", content: "Hola" });
 *   stream.close();
 */

import type { Response } from "express";
import { Logger } from "../lib/logger";

// ─── Constantes ──────────────────────────────────────────────────────────────

const STREAM_HEARTBEAT_INTERVAL_MS = 20_000;  // ping cada 20s para mantener conexión viva
const STREAM_MAX_IDLE_MS = 180_000;           // cierra el stream si supera 3min sin chunks
const STREAM_MAX_LIFETIME_MS = 12 * 60_000;  // tiempo máximo absoluto de un stream (12min)
const MAX_ACTIVE_STREAMS_PER_USER = 5;        // protección contra SSE floods

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type StreamEvent =
    | { type: "chunk"; content: string; requestId: string }
    | { type: "done"; requestId: string; usage?: { inputTokens?: number; outputTokens?: number } }
    | { type: "error"; message: string; code?: string; requestId: string }
    | { type: "ping"; requestId: string }
    | { type: "cancel"; requestId: string };

export interface ManagedStream {
    requestId: string;
    userId: string;
    write: (event: StreamEvent) => boolean;
    close: (reason?: string) => void;
    isCancelled: () => boolean;
    isClosed: () => boolean;
}

interface StreamEntry {
    requestId: string;
    userId: string;
    res: Response;
    cancelled: boolean;
    closed: boolean;
    createdAt: number;
    lastChunkAt: number;
    heartbeatTimer: ReturnType<typeof setInterval> | null;
    maxLifetimeTimer: ReturnType<typeof setTimeout> | null;
}

// ─── State ───────────────────────────────────────────────────────────────────

const activeStreams = new Map<string, StreamEntry>();
const streamsByUser = new Map<string, Set<string>>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function encodeSSEEvent(event: StreamEvent): string {
    const data = JSON.stringify(event);
    return `data: ${data}\n\n`;
}

function cleanupEntry(entry: StreamEntry): void {
    if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer);
    if (entry.maxLifetimeTimer) clearTimeout(entry.maxLifetimeTimer);
    entry.heartbeatTimer = null;
    entry.maxLifetimeTimer = null;
    entry.closed = true;

    activeStreams.delete(entry.requestId);
    const userSet = streamsByUser.get(entry.userId);
    if (userSet) {
        userSet.delete(entry.requestId);
        if (userSet.size === 0) streamsByUser.delete(entry.userId);
    }
}

// ─── StreamManager ───────────────────────────────────────────────────────────

export const streamManager = {
    /**
     * Crea y registra un nuevo stream SSE.
     * Configura headers, heartbeats, y timeouts automáticamente.
     */
    create(res: Response, requestId: string, userId: string): ManagedStream {
        // Verificar límite por usuario
        const userStreams = streamsByUser.get(userId) ?? new Set();
        if (userStreams.size >= MAX_ACTIVE_STREAMS_PER_USER) {
            Logger.warn("[StreamManager] User exceeded max concurrent streams", { userId, requestId });
            // Cancelar el stream más antiguo
            const oldestId = [...userStreams][0];
            if (oldestId) this.cancel(oldestId, "evicted_by_new_stream");
        }

        // Configurar SSE headers
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("X-Request-Id", requestId);
        res.flushHeaders();

        const now = Date.now();
        const entry: StreamEntry = {
            requestId,
            userId,
            res,
            cancelled: false,
            closed: false,
            createdAt: now,
            lastChunkAt: now,
            heartbeatTimer: null,
            maxLifetimeTimer: null,
        };

        // Heartbeat para evitar que el cliente cierre la conexión
        entry.heartbeatTimer = setInterval(() => {
            if (entry.closed || entry.cancelled) {
                cleanupEntry(entry);
                return;
            }
            const idleSince = Date.now() - entry.lastChunkAt;
            if (idleSince > STREAM_MAX_IDLE_MS) {
                Logger.warn("[StreamManager] Stream idle timeout", { requestId, idleSince });
                managedStream.close("idle_timeout");
                return;
            }
            try {
                res.write(encodeSSEEvent({ type: "ping", requestId }));
            } catch {
                cleanupEntry(entry);
            }
        }, STREAM_HEARTBEAT_INTERVAL_MS);

        // Timeout máximo absoluto
        entry.maxLifetimeTimer = setTimeout(() => {
            if (!entry.closed) managedStream.close("max_lifetime_exceeded");
        }, STREAM_MAX_LIFETIME_MS);

        // Detectar desconexión del cliente
        res.on("close", () => cleanupEntry(entry));

        activeStreams.set(requestId, entry);
        userStreams.add(requestId);
        streamsByUser.set(userId, userStreams);

        const managedStream: ManagedStream = {
            requestId,
            userId,

            write(event: StreamEvent): boolean {
                if (entry.cancelled || entry.closed) return false;
                try {
                    res.write(encodeSSEEvent(event));
                    entry.lastChunkAt = Date.now();
                    return true;
                } catch (err) {
                    Logger.warn("[StreamManager] Write failed", { requestId, err });
                    cleanupEntry(entry);
                    return false;
                }
            },

            close(reason?: string): void {
                if (entry.closed) return;
                cleanupEntry(entry);
                try {
                    res.write(encodeSSEEvent({ type: "done", requestId }));
                    res.end();
                } catch {
                    // ignore
                }
                Logger.debug("[StreamManager] Stream closed", { requestId, userId, reason });
            },

            isCancelled(): boolean {
                return entry.cancelled;
            },

            isClosed(): boolean {
                return entry.closed;
            },
        };

        Logger.debug("[StreamManager] Stream created", { requestId, userId });
        return managedStream;
    },

    /**
     * Cancela un stream activo (iniciado por el cliente o por el servidor).
     */
    cancel(requestId: string, reason = "cancelled"): boolean {
        const entry = activeStreams.get(requestId);
        if (!entry || entry.closed) return false;

        entry.cancelled = true;
        try {
            entry.res.write(encodeSSEEvent({ type: "cancel", requestId }));
            entry.res.end();
        } catch {
            // ignore
        }
        cleanupEntry(entry);
        Logger.info("[StreamManager] Stream cancelled", { requestId, reason });
        return true;
    },

    /**
     * Número de streams activos en el servidor.
     */
    activeCount(): number {
        return activeStreams.size;
    },

    /**
     * Streams activos para un usuario concreto.
     */
    activeCountForUser(userId: string): number {
        return streamsByUser.get(userId)?.size ?? 0;
    },

    /**
     * Verifica si un stream específico está activo y no cancelado.
     */
    isActive(requestId: string): boolean {
        const entry = activeStreams.get(requestId);
        return !!entry && !entry.cancelled && !entry.closed;
    },
};

export default streamManager;
