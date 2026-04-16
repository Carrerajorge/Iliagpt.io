/**
 * Tool Types - Shared type definitions for tools
 * 
 * Extracted to avoid circular dependencies
 */

import { z } from "zod";
import { randomUUID } from "crypto";

export type ArtifactType = "file" | "image" | "document" | "chart" | "data" | "preview" | "link";
export type ToolCapability = "reads_files" | "writes_files" | "requires_network" | "accesses_external_api" | "executes_code" | "long_running" | "produces_artifacts";

export interface ToolContext {
    userId: string;
    chatId: string;
    runId: string;
    correlationId?: string;
    stepIndex?: number;
    userPlan?: "free" | "pro" | "admin";
    isConfirmed?: boolean;
    signal?: AbortSignal;
}

export interface ToolArtifact {
    id: string;
    type: ArtifactType;
    name: string;
    mimeType?: string;
    url?: string;
    data: any;
    size?: number;
    createdAt: Date;
}

export interface ToolPreview {
    type: "text" | "html" | "markdown" | "image" | "chart";
    content: any;
    title?: string;
}

export interface ToolLog {
    level: "debug" | "info" | "warn" | "error";
    message: string;
    timestamp: Date;
    data?: any;
}

export interface ToolMetrics {
    durationMs: number;
    tokensUsed?: number;
    apiCalls?: number;
    bytesProcessed?: number;
    successRate?: number;
    errorRate?: number;
}

export interface ToolResult {
    success: boolean;
    output: any;
    artifacts?: ToolArtifact[];
    previews?: ToolPreview[];
    logs?: ToolLog[];
    metrics?: ToolMetrics;
    error?: {
        code: string;
        message: string;
        retryable: boolean;
        details?: any;
    };
}

export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: z.ZodSchema;
    capabilities?: ToolCapability[];
    execute: (input: any, context: ToolContext) => Promise<ToolResult>;
}

/**
 * Helper to create an artifact
 */
export function createArtifact(type: ArtifactType, name: string, data: any, mimeType?: string, url?: string): ToolArtifact {
    return {
        id: randomUUID(),
        type,
        name,
        mimeType,
        url,
        data,
        size: (typeof data === "string" && data.length > 0) ? data.length : (Buffer.isBuffer(data) && data.length > 0) ? data.length : undefined,
        createdAt: new Date(),
    };
}

/**
 * Helper to create an error object
 */
export function createError(code: string, message: string, retryable: boolean = false, details?: any): ToolResult["error"] {
    return { code, message, retryable, details };
}
