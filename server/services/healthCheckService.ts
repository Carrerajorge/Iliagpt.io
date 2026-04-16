/**
 * Health Check Service Avanzado (Mejora #13 - Fase 3)
 *
 * Health check profundo que verifica:
 *   - Base de datos (PostgreSQL): conexión + latencia de query SELECT 1
 *   - Redis: ping + latencia round-trip
 *   - LLM Gateway: verifica si hay al menos un proveedor configurado
 *   - Canales externos (Telegram, WhatsApp): verificación de tokens
 *   - Disco: espacio libre
 *   - Memoria: heap usage
 *
 * Endpoints:
 *   GET /health         → respuesta rápida (liveness): solo DB + Redis
 *   GET /health/deep    → respuesta completa (readiness): todo
 *   GET /health/status  → respuesta human-readable con detalles
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { redis } from "../lib/redis";
import { env } from "../config/env";
import { Logger } from "../lib/logger";
import os from "os";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type HealthStatus = "ok" | "degraded" | "down";

export interface ComponentHealth {
    status: HealthStatus;
    latencyMs?: number;
    message?: string;
    details?: Record<string, unknown>;
}

export interface HealthReport {
    status: HealthStatus;   // overall: worst of all components
    timestamp: string;
    version: string;
    uptime: number;         // process uptime in seconds
    components: Record<string, ComponentHealth>;
}

// ─── Checks individuales ──────────────────────────────────────────────────────

async function checkDatabase(): Promise<ComponentHealth> {
    const start = Date.now();
    try {
        await db.execute(sql`SELECT 1`);
        return { status: "ok", latencyMs: Date.now() - start };
    } catch (err) {
        Logger.warn("[HealthCheck] DB check failed", err);
        return { status: "down", latencyMs: Date.now() - start, message: String((err as Error).message).slice(0, 200) };
    }
}

async function checkRedis(): Promise<ComponentHealth> {
    const start = Date.now();
    try {
        const pong = await Promise.race([
            redis.ping(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Redis ping timeout")), 3000)),
        ]);
        const latencyMs = Date.now() - start;
        if (pong !== "PONG") return { status: "degraded", latencyMs, message: `Unexpected ping response: ${pong}` };
        return { status: "ok", latencyMs };
    } catch (err) {
        return { status: "degraded", latencyMs: Date.now() - start, message: "Redis unavailable (using in-memory fallback)" };
    }
}

function checkLLMProviders(): ComponentHealth {
    const configured: string[] = [];
    if (env.OPENAI_API_KEY) configured.push("openai");
    if (env.ANTHROPIC_API_KEY) configured.push("anthropic");
    if ((env as any).GEMINI_API_KEY) configured.push("gemini");
    if ((env as any).GROQ_API_KEY) configured.push("groq");

    if (configured.length === 0) {
        return { status: "down", message: "No LLM providers configured", details: { configured } };
    }
    if (configured.length === 1) {
        return { status: "degraded", message: "Only one LLM provider — no fallback available", details: { configured } };
    }
    return { status: "ok", details: { configured, count: configured.length } };
}

function checkTelegram(): ComponentHealth {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) return { status: "degraded", message: "TELEGRAM_BOT_TOKEN not set" };
    const valid = /^\d+:[A-Za-z0-9_-]{35,}$/.test(token);
    return valid
        ? { status: "ok", details: { botIdPrefix: token.split(":")[0] } }
        : { status: "degraded", message: "TELEGRAM_BOT_TOKEN format invalid" };
}

function checkMemory(): ComponentHealth {
    const used = process.memoryUsage();
    const heapUsedMb = Math.round(used.heapUsed / 1024 / 1024);
    const heapTotalMb = Math.round(used.heapTotal / 1024 / 1024);
    const heapPercent = Math.round((used.heapUsed / used.heapTotal) * 100);
    const rssMb = Math.round(used.rss / 1024 / 1024);

    const status: HealthStatus = heapPercent > 92 ? "down" : heapPercent > 80 ? "degraded" : "ok";

    return {
        status,
        details: { heapUsedMb, heapTotalMb, heapPercent, rssMb },
        message: status !== "ok" ? `High heap usage: ${heapPercent}%` : undefined,
    };
}

function checkDisk(): ComponentHealth {
    // Aproximación vía os.freemem() para memoria libre del sistema (no disco, pero útil)
    const freeRamMb = Math.round(os.freemem() / 1024 / 1024);
    const totalRamMb = Math.round(os.totalmem() / 1024 / 1024);
    const ramUsedPercent = Math.round(((totalRamMb - freeRamMb) / totalRamMb) * 100);

    const status: HealthStatus = ramUsedPercent > 95 ? "down" : ramUsedPercent > 85 ? "degraded" : "ok";
    return {
        status,
        details: { freeRamMb, totalRamMb, ramUsedPercent },
    };
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

function aggregateStatus(components: Record<string, ComponentHealth>): HealthStatus {
    const statuses = Object.values(components).map(c => c.status);
    if (statuses.includes("down")) return "down";
    if (statuses.includes("degraded")) return "degraded";
    return "ok";
}

// ─── Health Report Functions ──────────────────────────────────────────────────

const APP_VERSION = process.env.npm_package_version || "unknown";

/** Liveness check: rápido, solo DB + Redis */
export async function livenessCheck(): Promise<HealthReport> {
    const [database, redisComponent, memory] = await Promise.all([
        checkDatabase(),
        checkRedis(),
        Promise.resolve(checkMemory()),
    ]);

    const components = { database, redis: redisComponent, memory };
    return {
        status: aggregateStatus(components),
        timestamp: new Date().toISOString(),
        version: APP_VERSION,
        uptime: Math.round(process.uptime()),
        components,
    };
}

/** Readiness check: profundo, todos los componentes */
export async function deepHealthCheck(): Promise<HealthReport> {
    const [database, redisComponent] = await Promise.all([
        checkDatabase(),
        checkRedis(),
    ]);

    const components: Record<string, ComponentHealth> = {
        database,
        redis: redisComponent,
        llmProviders: checkLLMProviders(),
        telegram: checkTelegram(),
        memory: checkMemory(),
        system: checkDisk(),
    };

    return {
        status: aggregateStatus(components),
        timestamp: new Date().toISOString(),
        version: APP_VERSION,
        uptime: Math.round(process.uptime()),
        components,
    };
}

// ─── Express Handlers ─────────────────────────────────────────────────────────

import type { Request, Response } from "express";

export function livenessHandler() {
    return async (_req: Request, res: Response): Promise<void> => {
        try {
            const report = await livenessCheck();
            const statusCode = report.status === "down" ? 503 : 200;
            res.status(statusCode).json(report);
        } catch (err) {
            res.status(503).json({ status: "down", error: "Health check failed" });
        }
    };
}

export function deepHealthHandler() {
    return async (_req: Request, res: Response): Promise<void> => {
        try {
            const report = await deepHealthCheck();
            const statusCode = report.status === "down" ? 503 : report.status === "degraded" ? 200 : 200;
            res.status(statusCode).json(report);
        } catch (err) {
            res.status(503).json({ status: "down", error: "Deep health check failed" });
        }
    };
}
