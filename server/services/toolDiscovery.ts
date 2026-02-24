/**
 * Tool Discovery Service - ILIAGPT PRO 3.0
 * 
 * AI learns to use new tools automatically.
 * Dynamic tool registration and capability matching.
 */

// ============== Types ==============

export interface Tool {
    id: string;
    name: string;
    description: string;
    category: ToolCategory;
    capabilities: string[];
    inputSchema: ToolSchema;
    outputSchema: ToolSchema;
    examples: ToolExample[];
    performance: ToolPerformance;
    enabled: boolean;
    createdAt: Date;
}

export type ToolCategory =
    | "web"
    | "file"
    | "code"
    | "data"
    | "communication"
    | "ai"
    | "integration"
    | "utility";

export interface ToolSchema {
    type: "object" | "string" | "number" | "array" | "boolean";
    properties?: Record<string, { type: string; description: string; required?: boolean }>;
    description?: string;
}

export interface ToolExample {
    input: Record<string, any>;
    output: any;
    description: string;
}

export interface ToolPerformance {
    successRate: number;
    avgExecutionTime: number;
    totalCalls: number;
    lastUsed?: Date;
}

export interface ToolMatch {
    tool: Tool;
    score: number;
    matchedCapabilities: string[];
    reasoning: string;
}

export interface ToolSuggestion {
    taskDescription: string;
    suggestedTools: ToolMatch[];
    confidence: number;
    alternativeApproaches?: string[];
}

// ============== Tool Registry ==============

const tools: Map<string, Tool> = new Map();
const usageHistory: { toolId: string; taskType: string; success: boolean; timestamp: Date }[] = [];

// ============== Default Tools ==============

const DEFAULT_TOOLS: Omit<Tool, 'id' | 'createdAt' | 'performance'>[] = [
    {
        name: "web_search",
        description: "Search the web for information",
        category: "web",
        capabilities: ["search", "research", "find_information", "current_events"],
        inputSchema: { type: "object", properties: { query: { type: "string", description: "Search query" } } },
        outputSchema: { type: "array", description: "Search results" },
        examples: [{ input: { query: "latest AI news" }, output: [], description: "Search for news" }],
        enabled: true,
    },
    {
        name: "read_file",
        description: "Read contents of a file",
        category: "file",
        capabilities: ["read", "file_access", "data_extraction"],
        inputSchema: { type: "object", properties: { path: { type: "string", description: "File path" } } },
        outputSchema: { type: "string", description: "File contents" },
        examples: [{ input: { path: "/data/file.txt" }, output: "...", description: "Read text file" }],
        enabled: true,
    },
    {
        name: "execute_code",
        description: "Execute code in a sandbox",
        category: "code",
        capabilities: ["execute", "compute", "transform_data", "analyze"],
        inputSchema: { type: "object", properties: { language: { type: "string", description: "Programming language" }, code: { type: "string", description: "Code to execute" } } },
        outputSchema: { type: "object", description: "Execution result" },
        examples: [{ input: { language: "python", code: "print(2+2)" }, output: { stdout: "4" }, description: "Run Python" }],
        enabled: true,
    },
    {
        name: "send_email",
        description: "Send an email",
        category: "communication",
        capabilities: ["send_message", "notify", "communicate"],
        inputSchema: { type: "object", properties: { to: { type: "string", description: "Recipient" }, subject: { type: "string", description: "Subject" }, body: { type: "string", description: "Message body" } } },
        outputSchema: { type: "boolean", description: "Success status" },
        examples: [{ input: { to: "user@example.com", subject: "Hello", body: "..." }, output: true, description: "Send email" }],
        enabled: true,
    },
    {
        name: "database_query",
        description: "Query a database",
        category: "data",
        capabilities: ["query", "data_retrieval", "sql", "database_access"],
        inputSchema: { type: "object", properties: { query: { type: "string", description: "SQL query" }, database: { type: "string", description: "Database name" } } },
        outputSchema: { type: "array", description: "Query results" },
        examples: [{ input: { query: "SELECT * FROM users", database: "main" }, output: [], description: "Query users" }],
        enabled: true,
    },
    {
        name: "generate_image",
        description: "Generate an image from a prompt",
        category: "ai",
        capabilities: ["generate", "create_image", "visualization", "ai_generation"],
        inputSchema: { type: "object", properties: { prompt: { type: "string", description: "Image description" }, style: { type: "string", description: "Art style" } } },
        outputSchema: { type: "string", description: "Image URL" },
        examples: [{ input: { prompt: "A sunset over mountains", style: "realistic" }, output: "https://...", description: "Generate landscape" }],
        enabled: true,
    },
];

// ============== Tool Discovery Service ==============

export class ToolDiscoveryService {
    private learningEnabled = true;
    private capabilityIndex: Map<string, string[]> = new Map();

    constructor() {
        // Register default tools
        for (const tool of DEFAULT_TOOLS) {
            this.registerTool(tool);
        }
        this.buildCapabilityIndex();
    }

    // ======== Tool Registration ========

    /**
     * Register a new tool
     */
    registerTool(
        toolDef: Omit<Tool, 'id' | 'createdAt' | 'performance'>
    ): Tool {
        const id = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

        const tool: Tool = {
            ...toolDef,
            id,
            createdAt: new Date(),
            performance: {
                successRate: 1.0,
                avgExecutionTime: 0,
                totalCalls: 0,
            },
        };

        tools.set(id, tool);
        this.updateCapabilityIndex(tool);
        return tool;
    }

    /**
     * Auto-discover tool from API spec
     */
    async discoverFromOpenAPI(spec: any): Promise<Tool[]> {
        const discovered: Tool[] = [];

        if (!spec.paths) return discovered;

        for (const [path, methods] of Object.entries(spec.paths)) {
            for (const [method, details] of Object.entries(methods as any)) {
                if (method === 'get' || method === 'post') {
                    const op: any = details as any;
                    const tool = this.registerTool({
                        name: op.operationId || `${method}_${path.replace(/\//g, '_')}`,
                        description: op.summary || op.description || `${method.toUpperCase()} ${path}`,
                        category: "integration",
                        capabilities: this.extractCapabilities(op.description || ""),
                        inputSchema: this.extractInputSchema(op.parameters || [], op.requestBody),
                        // (moved above to use op.*)
                        
                        outputSchema: { type: "object", description: "API response" },
                        examples: [],
                        enabled: true,
                    });
                    discovered.push(tool);
                }
            }
        }

        return discovered;
    }

    /**
     * Learn tool from demonstration
     */
    async learnFromDemonstration(
        name: string,
        description: string,
        demonstrations: { input: any; output: any }[]
    ): Promise<Tool> {
        // Infer schema from demonstrations
        const inputSchema = this.inferSchema(demonstrations.map(d => d.input));
        const outputSchema = this.inferSchema(demonstrations.map(d => d.output));

        return this.registerTool({
            name,
            description,
            category: "utility",
            capabilities: this.extractCapabilities(description),
            inputSchema,
            outputSchema,
            examples: demonstrations.map(d => ({ ...d, description: "Learned example" })),
            enabled: true,
        });
    }

    // ======== Tool Discovery ========

    /**
     * Find best tools for a task
     */
    async discoverTools(taskDescription: string): Promise<ToolSuggestion> {
        const taskCapabilities = this.extractCapabilities(taskDescription);
        const matches: ToolMatch[] = [];

        for (const tool of tools.values()) {
            if (!tool.enabled) continue;

            const matchedCapabilities = tool.capabilities.filter(c =>
                taskCapabilities.some(tc => this.similarCapability(c, tc))
            );

            if (matchedCapabilities.length > 0) {
                const score = this.calculateMatchScore(tool, taskCapabilities, matchedCapabilities);
                matches.push({
                    tool,
                    score,
                    matchedCapabilities,
                    reasoning: this.generateReasoning(tool, matchedCapabilities, taskDescription),
                });
            }
        }

        // Sort by score
        matches.sort((a, b) => b.score - a.score);

        return {
            taskDescription,
            suggestedTools: matches.slice(0, 5),
            confidence: matches.length > 0 ? matches[0].score : 0,
            alternativeApproaches: this.suggestAlternatives(taskDescription, matches),
        };
    }

    /**
     * Get tool by capability
     */
    getToolsByCapability(capability: string): Tool[] {
        const toolIds = this.capabilityIndex.get(capability.toLowerCase()) || [];
        return toolIds.map(id => tools.get(id)!).filter(Boolean);
    }

    // ======== Learning ========

    /**
     * Record tool usage for learning
     */
    recordUsage(toolId: string, taskType: string, success: boolean, executionTime: number): void {
        const tool = tools.get(toolId);
        if (!tool) return;

        // Update performance
        tool.performance.totalCalls++;
        tool.performance.lastUsed = new Date();
        tool.performance.avgExecutionTime = (
            (tool.performance.avgExecutionTime * (tool.performance.totalCalls - 1) + executionTime) /
            tool.performance.totalCalls
        );
        tool.performance.successRate = (
            (tool.performance.successRate * (tool.performance.totalCalls - 1) + (success ? 1 : 0)) /
            tool.performance.totalCalls
        );

        // Record in history
        usageHistory.push({ toolId, taskType, success, timestamp: new Date() });
        if (usageHistory.length > 10000) usageHistory.shift();

        // Learn new capability associations
        if (this.learningEnabled && success) {
            this.learnCapabilityAssociation(tool, taskType);
        }
    }

    /**
     * Learn new capability from successful usage
     */
    private learnCapabilityAssociation(tool: Tool, taskType: string): void {
        const newCapabilities = this.extractCapabilities(taskType);

        for (const cap of newCapabilities) {
            if (!tool.capabilities.includes(cap)) {
                // Check if this association is consistent
                const relevantHistory = usageHistory.filter(h =>
                    h.toolId === tool.id && h.taskType.includes(cap)
                );

                if (relevantHistory.filter(h => h.success).length >= 3) {
                    tool.capabilities.push(cap);
                    this.updateCapabilityIndex(tool);
                }
            }
        }
    }

    // ======== Helpers ========

    private extractCapabilities(text: string): string[] {
        const keywords = [
            "search", "find", "read", "write", "execute", "compute", "analyze",
            "send", "receive", "create", "delete", "update", "query", "generate",
            "transform", "convert", "validate", "notify", "schedule", "monitor",
        ];

        const words = text.toLowerCase().split(/\s+/);
        return keywords.filter(k => words.some(w => w.includes(k)));
    }

    private similarCapability(a: string, b: string): boolean {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        return aLower.includes(bLower) || bLower.includes(aLower) ||
            this.levenshteinDistance(aLower, bLower) <= 2;
    }

    private levenshteinDistance(a: string, b: string): number {
        const dp: number[][] = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(0));
        for (let i = 0; i <= a.length; i++) dp[i][0] = i;
        for (let j = 0; j <= b.length; j++) dp[0][j] = j;

        for (let i = 1; i <= a.length; i++) {
            for (let j = 1; j <= b.length; j++) {
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
                );
            }
        }
        return dp[a.length][b.length];
    }

    private calculateMatchScore(
        tool: Tool,
        taskCapabilities: string[],
        matchedCapabilities: string[]
    ): number {
        const capabilityScore = matchedCapabilities.length / Math.max(taskCapabilities.length, 1);
        const performanceScore = tool.performance.successRate;
        const recencyBonus = tool.performance.lastUsed
            ? Math.max(0, 1 - (Date.now() - tool.performance.lastUsed.getTime()) / (7 * 24 * 60 * 60 * 1000))
            : 0;

        return (capabilityScore * 0.5 + performanceScore * 0.3 + recencyBonus * 0.2);
    }

    private generateReasoning(tool: Tool, matched: string[], task: string): string {
        return `Tool "${tool.name}" matches capabilities [${matched.join(", ")}] for task: ${task.slice(0, 50)}...`;
    }

    private suggestAlternatives(task: string, matches: ToolMatch[]): string[] {
        const alternatives: string[] = [];

        if (matches.length === 0) {
            alternatives.push("Consider breaking down the task into smaller subtasks");
            alternatives.push("Try rephrasing the task description");
        } else if (matches[0].score < 0.5) {
            alternatives.push("Combine multiple tools for better results");
            alternatives.push("Register a custom tool for this specific task");
        }

        return alternatives;
    }

    private buildCapabilityIndex(): void {
        this.capabilityIndex.clear();
        for (const tool of tools.values()) {
            this.updateCapabilityIndex(tool);
        }
    }

    private updateCapabilityIndex(tool: Tool): void {
        for (const cap of tool.capabilities) {
            const capLower = cap.toLowerCase();
            const existing = this.capabilityIndex.get(capLower) || [];
            if (!existing.includes(tool.id)) {
                existing.push(tool.id);
                this.capabilityIndex.set(capLower, existing);
            }
        }
    }

    private extractInputSchema(params: any[], requestBody?: any): ToolSchema {
        const properties: Record<string, any> = {};

        for (const param of params) {
            properties[param.name] = {
                type: param.schema?.type || "string",
                description: param.description || "",
                required: param.required,
            };
        }

        return { type: "object", properties };
    }

    private inferSchema(samples: any[]): ToolSchema {
        if (samples.length === 0) return { type: "object" };

        const first = samples[0];
        if (typeof first === "string") return { type: "string" };
        if (typeof first === "number") return { type: "number" };
        if (typeof first === "boolean") return { type: "boolean" };
        if (Array.isArray(first)) return { type: "array" };

        const properties: Record<string, any> = {};
        for (const key of Object.keys(first)) {
            properties[key] = { type: typeof first[key], description: "" };
        }

        return { type: "object", properties };
    }

    // ======== Management ========

    getTool(id: string): Tool | undefined {
        return tools.get(id);
    }

    listTools(category?: ToolCategory): Tool[] {
        const all = Array.from(tools.values());
        return category ? all.filter(t => t.category === category) : all;
    }

    disableTool(id: string): boolean {
        const tool = tools.get(id);
        if (tool) {
            tool.enabled = false;
            return true;
        }
        return false;
    }
}

// ============== Singleton ==============

let toolDiscoveryInstance: ToolDiscoveryService | null = null;

export function getToolDiscovery(): ToolDiscoveryService {
    if (!toolDiscoveryInstance) {
        toolDiscoveryInstance = new ToolDiscoveryService();
    }
    return toolDiscoveryInstance;
}

export default ToolDiscoveryService;
