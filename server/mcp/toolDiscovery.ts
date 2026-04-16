/**
 * Tool Discovery via MCP (Model Context Protocol)
 * 
 * Features:
 * - Dynamic tool registration at runtime
 * - Schema validation for new tools
 * - Hot-reload without server restart
 * - Tool capability discovery
 */

import { z } from "zod";
import crypto from "crypto";
import { EventEmitter } from "events";

// Tool schema definition
export const ToolParameterSchema = z.object({
    name: z.string(),
    type: z.enum(["string", "number", "boolean", "array", "object"]),
    description: z.string(),
    required: z.boolean().default(false),
    default: z.any().optional(),
    enum: z.array(z.string()).optional(),
});

export const ToolDefinitionSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    version: z.string().default("1.0.0"),
    category: z.enum([
        "search",
        "analysis",
        "generation",
        "transformation",
        "integration",
        "utility",
    ]),
    parameters: z.array(ToolParameterSchema),
    capabilities: z.array(z.string()),
    inputSchema: z.any().optional(),
    outputSchema: z.any().optional(),
    timeout: z.number().default(30000),
    rateLimit: z.object({
        maxPerMinute: z.number(),
        maxConcurrent: z.number(),
    }).optional(),
});

export type ToolParameter = z.infer<typeof ToolParameterSchema>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

// Tool execution context
export interface ToolContext {
    requestId: string;
    userId?: string;
    traceId?: string;
    timeout: number;
    signal?: AbortSignal;
}

// Tool execution result
export interface ToolResult {
    success: boolean;
    data?: any;
    error?: string;
    metadata?: {
        executionTime: number;
        tokensUsed?: number;
    };
}

// Tool handler function
export type ToolHandler = (
    params: Record<string, any>,
    context: ToolContext
) => Promise<ToolResult>;

// Registered tool with handler
interface RegisteredTool {
    definition: ToolDefinition;
    handler: ToolHandler;
    registeredAt: Date;
    invocationCount: number;
    lastInvoked?: Date;
    source: "builtin" | "plugin" | "mcp";
}

// Tool registry
const toolRegistry = new Map<string, RegisteredTool>();
const eventEmitter = new EventEmitter();

// MCP Server connection
interface MCPConnection {
    id: string;
    url: string;
    status: "connected" | "disconnected" | "error";
    tools: string[];
    lastPing: Date;
}

const mcpConnections = new Map<string, MCPConnection>();

// Register a new tool
export function registerTool(
    definition: ToolDefinition,
    handler: ToolHandler,
    source: RegisteredTool["source"] = "plugin"
): { success: boolean; error?: string } {
    try {
        // Validate definition
        const validated = ToolDefinitionSchema.parse(definition);

        // Check for duplicate
        if (toolRegistry.has(validated.id)) {
            return {
                success: false,
                error: `Tool ${validated.id} already registered`
            };
        }

        // Register
        toolRegistry.set(validated.id, {
            definition: validated,
            handler,
            registeredAt: new Date(),
            invocationCount: 0,
            source,
        });

        eventEmitter.emit("tool:registered", validated);
        console.log(`[MCP] Registered tool: ${validated.id} (${source})`);

        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: `Validation error: ${(error as Error).message}`
        };
    }
}

// Unregister a tool
export function unregisterTool(toolId: string): boolean {
    const tool = toolRegistry.get(toolId);
    if (!tool) return false;

    toolRegistry.delete(toolId);
    eventEmitter.emit("tool:unregistered", toolId);
    console.log(`[MCP] Unregistered tool: ${toolId}`);

    return true;
}

// Update a tool definition
export function updateTool(
    toolId: string,
    updates: Partial<ToolDefinition>
): { success: boolean; error?: string } {
    const tool = toolRegistry.get(toolId);
    if (!tool) {
        return { success: false, error: `Tool ${toolId} not found` };
    }

    try {
        const newDefinition = { ...tool.definition, ...updates };
        const validated = ToolDefinitionSchema.parse(newDefinition);

        tool.definition = validated;
        eventEmitter.emit("tool:updated", validated);

        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: `Validation error: ${(error as Error).message}`
        };
    }
}

// Get tool by ID
export function getTool(toolId: string): RegisteredTool | undefined {
    return toolRegistry.get(toolId);
}

// List all tools
export function listTools(filter?: {
    category?: ToolDefinition["category"];
    capability?: string;
    source?: RegisteredTool["source"];
}): ToolDefinition[] {
    let tools = Array.from(toolRegistry.values());

    if (filter?.category) {
        tools = tools.filter(t => t.definition.category === filter.category);
    }

    if (filter?.capability) {
        tools = tools.filter(t =>
            t.definition.capabilities.includes(filter.capability!)
        );
    }

    if (filter?.source) {
        tools = tools.filter(t => t.source === filter.source);
    }

    return tools.map(t => t.definition);
}

// Search tools by query
export function searchTools(query: string): ToolDefinition[] {
    const lowerQuery = query.toLowerCase();

    return Array.from(toolRegistry.values())
        .filter(t =>
            t.definition.name.toLowerCase().includes(lowerQuery) ||
            t.definition.description.toLowerCase().includes(lowerQuery) ||
            t.definition.capabilities.some(c => c.toLowerCase().includes(lowerQuery))
        )
        .map(t => t.definition);
}

// Execute a tool
export async function executeTool(
    toolId: string,
    params: Record<string, any>,
    context: Partial<ToolContext> = {}
): Promise<ToolResult> {
    const tool = toolRegistry.get(toolId);

    if (!tool) {
        return {
            success: false,
            error: `Tool ${toolId} not found`
        };
    }

    const fullContext: ToolContext = {
        requestId: context.requestId || crypto.randomUUID(),
        userId: context.userId,
        traceId: context.traceId,
        timeout: context.timeout || tool.definition.timeout,
        signal: context.signal,
    };

    const startTime = Date.now();

    try {
        // Validate parameters
        const validationResult = validateToolParams(tool.definition, params);
        if (!validationResult.valid) {
            return {
                success: false,
                error: `Parameter validation failed: ${validationResult.errors?.join(", ")}`,
            };
        }

        // Execute with timeout
        const result = await Promise.race([
            tool.handler(params, fullContext),
            new Promise<ToolResult>((_, reject) =>
                setTimeout(() => reject(new Error("Tool execution timeout")), fullContext.timeout)
            ),
        ]);

        // Update stats
        tool.invocationCount++;
        tool.lastInvoked = new Date();

        return {
            ...result,
            metadata: {
                ...result.metadata,
                executionTime: Date.now() - startTime,
            },
        };
    } catch (error) {
        return {
            success: false,
            error: (error as Error).message,
            metadata: {
                executionTime: Date.now() - startTime,
            },
        };
    }
}

// Validate tool parameters
function validateToolParams(
    definition: ToolDefinition,
    params: Record<string, any>
): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];

    for (const paramDef of definition.parameters) {
        const value = params[paramDef.name];

        // Check required
        if (paramDef.required && value === undefined) {
            errors.push(`Missing required parameter: ${paramDef.name}`);
            continue;
        }

        if (value === undefined) continue;

        // Check type
        const actualType = Array.isArray(value) ? "array" : typeof value;
        if (actualType !== paramDef.type) {
            errors.push(`Parameter ${paramDef.name} should be ${paramDef.type}, got ${actualType}`);
        }

        // Check enum
        if (paramDef.enum && !paramDef.enum.includes(value)) {
            errors.push(`Parameter ${paramDef.name} must be one of: ${paramDef.enum.join(", ")}`);
        }
    }

    return {
        valid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
    };
}

// Connect to MCP server
export async function connectMCPServer(url: string): Promise<{
    success: boolean;
    connectionId?: string;
    tools?: string[];
    error?: string;
}> {
    const connectionId = crypto.randomUUID();

    try {
        // Fetch tool definitions from MCP server
        const response = await fetch(`${url}/tools`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        });

        if (!response.ok) {
            throw new Error(`MCP server returned ${response.status}`);
        }

        const data = await response.json();
        const tools: string[] = [];

        // Register discovered tools
        for (const toolDef of data.tools || []) {
            const handler = createMCPToolHandler(url, toolDef.id);
            const result = registerTool(toolDef, handler, "mcp");

            if (result.success) {
                tools.push(toolDef.id);
            }
        }

        // Store connection
        mcpConnections.set(connectionId, {
            id: connectionId,
            url,
            status: "connected",
            tools,
            lastPing: new Date(),
        });

        console.log(`[MCP] Connected to ${url}, discovered ${tools.length} tools`);

        return { success: true, connectionId, tools };
    } catch (error) {
        console.error(`[MCP] Connection failed to ${url}:`, error);
        return {
            success: false,
            error: (error as Error).message
        };
    }
}

// Create handler for MCP remote tool
function createMCPToolHandler(serverUrl: string, toolId: string): ToolHandler {
    return async (params, context) => {
        const response = await fetch(`${serverUrl}/tools/${toolId}/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ params, context }),
            signal: context.signal,
        });

        if (!response.ok) {
            return {
                success: false,
                error: `MCP tool execution failed: ${response.status}`,
            };
        }

        return response.json();
    };
}

// Disconnect from MCP server
export function disconnectMCPServer(connectionId: string): boolean {
    const connection = mcpConnections.get(connectionId);
    if (!connection) return false;

    // Unregister tools from this connection
    for (const toolId of connection.tools) {
        unregisterTool(toolId);
    }

    mcpConnections.delete(connectionId);
    console.log(`[MCP] Disconnected from ${connection.url}`);

    return true;
}

// Get registry stats
export function getRegistryStats(): {
    totalTools: number;
    byCategory: Record<string, number>;
    bySource: Record<string, number>;
    mcpConnections: number;
} {
    const tools = Array.from(toolRegistry.values());

    const byCategory: Record<string, number> = {};
    const bySource: Record<string, number> = {};

    for (const tool of tools) {
        byCategory[tool.definition.category] = (byCategory[tool.definition.category] || 0) + 1;
        bySource[tool.source] = (bySource[tool.source] || 0) + 1;
    }

    return {
        totalTools: tools.length,
        byCategory,
        bySource,
        mcpConnections: mcpConnections.size,
    };
}

// Event subscriptions
export function onToolRegistered(callback: (tool: ToolDefinition) => void): void {
    eventEmitter.on("tool:registered", callback);
}

export function onToolUnregistered(callback: (toolId: string) => void): void {
    eventEmitter.on("tool:unregistered", callback);
}

export default {
    registerTool,
    unregisterTool,
    updateTool,
    getTool,
    listTools,
    searchTools,
    executeTool,
    connectMCPServer,
    disconnectMCPServer,
    getRegistryStats,
    onToolRegistered,
    onToolUnregistered,
    ToolDefinitionSchema,
    ToolParameterSchema,
};
