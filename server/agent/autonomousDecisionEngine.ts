/**
 * Autonomous Decision Engine for ILIAGPT PRO
 * 
 * Enables the agent to make intelligent decisions without user intervention.
 * Uses confidence scoring, context analysis, and learned preferences.
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";

// ============================================
// Types and Interfaces
// ============================================

export interface DecisionContext {
    userId: string;
    sessionId: string;
    taskType: TaskType;
    input: string;
    history: ConversationHistoryItem[];
    availableAgents: string[];
    availableTools: string[];
    constraints: DecisionConstraints;
    metadata: Record<string, any>;
}

export type TaskType =
    | "research"
    | "document_creation"
    | "code_generation"
    | "data_analysis"
    | "communication"
    | "automation"
    | "creative"
    | "mixed"
    | "unknown";

export interface ConversationHistoryItem {
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: Date;
    metadata?: Record<string, any>;
}

export interface DecisionConstraints {
    maxTokens?: number;
    maxTime?: number;
    allowedAgents?: string[];
    blockedTools?: string[];
    requireApproval?: boolean;
    budgetLimit?: number;
}

export interface Decision {
    id: string;
    approved: boolean;
    confidence: number;
    reasoning: string;
    selectedAgent: string;
    selectedTools: string[];
    executionPlan: ExecutionStep[];
    estimatedTime: number;
    estimatedCost: number;
    requiresConfirmation: boolean;
    alternatives: AlternativeDecision[];
}

export interface ExecutionStep {
    order: number;
    toolName: string;
    description: string;
    parameters: Record<string, any>;
    expectedOutput: string;
    fallbackTool?: string;
    isOptional: boolean;
}

export interface AlternativeDecision {
    agent: string;
    confidence: number;
    reasoning: string;
}

export interface TaskAnalysis {
    taskType: TaskType;
    complexity: "simple" | "moderate" | "complex";
    estimatedSteps: number;
    requiredCapabilities: string[];
    suggestedAgents: string[];
    suggestedTools: string[];
    outputFormat: string | null;
    keywords: string[];
    intent: string;
}

export interface UserPreference {
    userId: string;
    preferredAgents: Record<string, number>;
    preferredTools: Record<string, number>;
    autoApproveThreshold: number;
    preferredOutputFormats: string[];
    languagePreference: string;
}

// ============================================
// Intent Recognition
// ============================================

const INTENT_PATTERNS: Record<string, { patterns: RegExp[]; taskType: TaskType; capabilities: string[] }> = {
    presentation: {
        patterns: [
            /create\s+(a\s+)?presentat(ion|ación)/i,
            /make\s+(a\s+)?(ppt|powerpoint|slides)/i,
            /crea(r)?\s+(una?\s+)?(presentación|ppt|diapositivas)/i,
            /generar?\s+(una?\s+)?presentación/i
        ],
        taskType: "document_creation",
        capabilities: ["slides_create", "generate_image", "data_visualize"]
    },
    document: {
        patterns: [
            /create\s+(a\s+)?document/i,
            /write\s+(a\s+)?(report|essay|paper)/i,
            /crea(r)?\s+(un\s+)?document/i,
            /redactar\s+(un\s+)?(informe|ensayo|artículo)/i,
            /genera(r)?\s+(un\s+)?(word|docx)/i
        ],
        taskType: "document_creation",
        capabilities: ["doc_create", "research_deep", "summarize"]
    },
    research: {
        patterns: [
            /investigar?\s+sobre/i,
            /research\s+(about|on)/i,
            /buscar?\s+información/i,
            /find\s+(information|data)\s+(about|on)/i,
            /análisis\s+de/i,
            /analizar?\s+/i
        ],
        taskType: "research",
        capabilities: ["search_web", "research_deep", "verify", "summarize"]
    },
    code: {
        patterns: [
            /crea(r)?\s+(un\s+)?(código|programa|script)/i,
            /write\s+(a\s+)?(code|program|script)/i,
            /develop\s+(a\s+)?/i,
            /program(ar)?\s+/i,
            /fix\s+(the\s+)?bug/i,
            /debug/i
        ],
        taskType: "code_generation",
        capabilities: ["generate_code", "code_review", "code_test", "code_debug"]
    },
    data: {
        patterns: [
            /anali(zar|sis)\s+(de\s+)?datos/i,
            /analyze\s+data/i,
            /create\s+(a\s+)?spreadsheet/i,
            /generar?\s+(un\s+)?excel/i,
            /data\s+visualization/i,
            /gráfic(o|a)/i
        ],
        taskType: "data_analysis",
        capabilities: ["data_analyze", "data_visualize", "spreadsheet_create"]
    },
    email: {
        patterns: [
            /enviar?\s+(un\s+)?email/i,
            /send\s+(an?\s+)?email/i,
            /escrib(ir|e)\s+(un\s+)?correo/i,
            /write\s+(an?\s+)?email/i,
            /draft\s+(an?\s+)?email/i
        ],
        taskType: "communication",
        capabilities: ["email_manage", "generate_text"]
    },
    automation: {
        patterns: [
            /automat(izar|e)/i,
            /schedule\s+/i,
            /programar?\s+(una?\s+)?tarea/i,
            /set\s+up\s+/i,
            /create\s+(a\s+)?workflow/i
        ],
        taskType: "automation",
        capabilities: ["schedule_cron", "trigger_event", "workflow"]
    },
    computer_use: {
        patterns: [
            /computer\s+use/i,
            /control\s+(del\s+)?(computador|ordenador|laptop|pc)/i,
            /agentic\s+brows/i,
            /autónom(o|a|amente)\s+(navega|busca|control)/i,
            /autonomous(ly)?\s+(browse|navigate|search|control)/i,
            /control\s+(de\s+)?pantalla/i,
            /screen\s+(control|interact)/i,
            /terminal\s+control/i,
            /browser\s+control/i,
            /iniciativa\s+propia/i,
            /self.initiative/i
        ],
        taskType: "mixed",
        capabilities: ["computer_use_session", "computer_use_navigate", "computer_use_interact", "computer_use_agentic", "terminal_execute", "vision_analyze"]
    }
};

const OUTPUT_FORMAT_PATTERNS: Record<string, RegExp[]> = {
    pptx: [/ppt(x)?|powerpoint|presentación|slides|diapositivas/i],
    docx: [/docx?|word|documento|informe|report|essay/i],
    xlsx: [/xlsx?|excel|spreadsheet|hoja\s+de\s+cálculo/i],
    pdf: [/pdf/i],
    html: [/html|web\s+page|página\s+web/i],
    json: [/json|api\s+response/i],
    csv: [/csv|comma\s+separated/i]
};

// ============================================
// Agent Capabilities Database
// ============================================

const AGENT_CAPABILITIES: Record<string, { capabilities: string[]; specialties: string[]; priority: number }> = {
    computer_use: {
        capabilities: ["computer_use_session", "computer_use_navigate", "computer_use_interact", "computer_use_agentic", "computer_use_screenshot", "computer_use_extract", "generate_perfect_ppt", "generate_perfect_doc", "generate_perfect_excel", "terminal_execute", "terminal_system_info", "terminal_file_op", "vision_analyze"],
        specialties: ["browser control", "screen interaction", "terminal", "autonomous navigation", "document generation", "computer control", "agentic browsing"],
        priority: 0
    },
    research: {
        capabilities: ["search_web", "research_deep", "verify", "summarize", "memory_store"],
        specialties: ["investigación", "research", "fact-checking", "analysis"],
        priority: 1
    },
    code: {
        capabilities: ["generate_code", "code_review", "code_test", "code_debug", "code_refactor", "shell"],
        specialties: ["programming", "desarrollo", "debugging", "testing"],
        priority: 2
    },
    data: {
        capabilities: ["data_analyze", "data_visualize", "data_transform", "spreadsheet_create", "db_sql"],
        specialties: ["analytics", "visualization", "estadística", "reporting"],
        priority: 3
    },
    content: {
        capabilities: ["generate_text", "slides_create", "doc_create", "translate", "summarize"],
        specialties: ["writing", "redacción", "presentations", "creative"],
        priority: 4
    },
    communication: {
        capabilities: ["email_manage", "calendar_manage", "slack_interact", "generate_text"],
        specialties: ["email", "scheduling", "messaging"],
        priority: 5
    },
    browser: {
        capabilities: ["browser_navigate", "browser_interact", "browser_extract", "fetch_url"],
        specialties: ["web automation", "scraping", "testing"],
        priority: 6
    },
    document: {
        capabilities: ["file_read", "file_write", "ocr_extract", "doc_create", "pdf_manipulate"],
        specialties: ["document processing", "OCR", "conversion"],
        priority: 7
    }
};

// ============================================
// Decision Engine Class
// ============================================

export class AutonomousDecisionEngine extends EventEmitter {
    private confidenceThreshold: number;
    private userPreferences: Map<string, UserPreference>;
    private decisionHistory: Decision[];
    private maxHistorySize: number;

    constructor(options: {
        confidenceThreshold?: number;
        maxHistorySize?: number
    } = {}) {
        super();
        this.confidenceThreshold = options.confidenceThreshold ?? 0.85;
        this.userPreferences = new Map();
        this.decisionHistory = [];
        this.maxHistorySize = options.maxHistorySize ?? 500;
    }

    /**
     * Analyze a task to understand its requirements
     */
    analyzeTask(input: string, context?: Partial<DecisionContext>): TaskAnalysis {
        const lowerInput = input.toLowerCase();

        // Detect task type and capabilities
        let taskType: TaskType = "unknown";
        let requiredCapabilities: string[] = [];
        let suggestedAgents: string[] = [];

        for (const [intent, config] of Object.entries(INTENT_PATTERNS)) {
            if (config.patterns.some(p => p.test(input))) {
                taskType = config.taskType;
                requiredCapabilities = config.capabilities;
                break;
            }
        }

        // Detect output format
        let outputFormat: string | null = null;
        for (const [format, patterns] of Object.entries(OUTPUT_FORMAT_PATTERNS)) {
            if (patterns.some(p => p.test(input))) {
                outputFormat = format;
                break;
            }
        }

        // Find matching agents based on capabilities
        for (const [agentId, agentConfig] of Object.entries(AGENT_CAPABILITIES)) {
            const capabilityMatch = requiredCapabilities.filter(c =>
                agentConfig.capabilities.includes(c)
            ).length;

            if (capabilityMatch > 0) {
                suggestedAgents.push(agentId);
            }
        }

        // Estimate complexity
        const complexity = this.estimateComplexity(input, requiredCapabilities);

        // Extract keywords
        const keywords = this.extractKeywords(input);

        // Infer intent
        const intent = this.inferIntent(input, taskType);

        return {
            taskType,
            complexity,
            estimatedSteps: this.estimateSteps(complexity, requiredCapabilities.length),
            requiredCapabilities,
            suggestedAgents: suggestedAgents.slice(0, 3),
            suggestedTools: requiredCapabilities.slice(0, 5),
            outputFormat,
            keywords,
            intent
        };
    }

    private estimateComplexity(
        input: string,
        capabilities: string[]
    ): "simple" | "moderate" | "complex" {
        const factors = {
            inputLength: input.length > 200 ? 1 : 0,
            multipleOutputs: /and|y|además|also/i.test(input) ? 1 : 0,
            multipleSteps: /then|después|luego|after/i.test(input) ? 1 : 0,
            capabilityCount: capabilities.length > 3 ? 1 : 0,
            specialRequirements: /professional|profesional|detailed|detallado|comprehensive/i.test(input) ? 1 : 0
        };

        const score = Object.values(factors).reduce((a, b) => a + b, 0);

        if (score <= 1) return "simple";
        if (score <= 3) return "moderate";
        return "complex";
    }

    private estimateSteps(
        complexity: "simple" | "moderate" | "complex",
        capabilityCount: number
    ): number {
        const baseSteps = { simple: 2, moderate: 4, complex: 8 };
        return Math.max(baseSteps[complexity], capabilityCount);
    }

    private extractKeywords(input: string): string[] {
        const stopWords = new Set([
            "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
            "have", "has", "had", "do", "does", "did", "will", "would", "could",
            "should", "may", "might", "must", "shall", "can", "need", "dare",
            "un", "una", "el", "la", "los", "las", "de", "del", "en", "con",
            "para", "por", "sobre", "que", "y", "o", "pero", "si", "no",
            "me", "te", "se", "nos", "les", "lo", "le", "create", "make", "crea"
        ]);

        return input
            .toLowerCase()
            .replace(/[^\w\sáéíóúñü]/g, " ")
            .split(/\s+/)
            .filter(word => word.length > 2 && !stopWords.has(word))
            .slice(0, 10);
    }

    private inferIntent(input: string, taskType: TaskType): string {
        const intentTemplates: Record<TaskType, string> = {
            research: "Investigate and compile information about the topic",
            document_creation: "Create a professional document with the specified content",
            code_generation: "Develop code solution for the described requirement",
            data_analysis: "Analyze data and provide insights with visualizations",
            communication: "Draft and manage communication as specified",
            automation: "Set up automated workflow or scheduled task",
            creative: "Generate creative content based on the prompt",
            mixed: "Execute multiple related tasks to fulfill the request",
            unknown: "Process the request using the most appropriate approach"
        };

        return intentTemplates[taskType];
    }

    /**
     * Make a decision about how to handle a task
     */
    async decide(context: DecisionContext): Promise<Decision> {
        const decisionId = randomUUID();
        const analysis = this.analyzeTask(context.input, context);

        this.emit("analysis_complete", { decisionId, analysis });

        // Calculate confidence based on multiple factors
        const confidence = this.calculateConfidence(analysis, context);

        // Select the best agent
        const selectedAgent = this.selectAgent(analysis, context);

        // Select tools for the task
        const selectedTools = this.selectTools(analysis, context);

        // Generate execution plan
        const executionPlan = this.generateExecutionPlan(analysis, selectedAgent, selectedTools);

        // Estimate time and cost
        const estimatedTime = this.estimateTime(executionPlan);
        const estimatedCost = this.estimateCost(executionPlan);

        // Determine if confirmation is needed
        const requiresConfirmation = this.needsConfirmation(confidence, context, analysis);

        // Generate alternative decisions
        const alternatives = this.generateAlternatives(analysis, selectedAgent);

        const decision: Decision = {
            id: decisionId,
            approved: confidence >= this.confidenceThreshold && !requiresConfirmation,
            confidence,
            reasoning: this.generateReasoning(analysis, selectedAgent, confidence),
            selectedAgent,
            selectedTools,
            executionPlan,
            estimatedTime,
            estimatedCost,
            requiresConfirmation,
            alternatives
        };

        // Store decision
        this.decisionHistory.push(decision);
        if (this.decisionHistory.length > this.maxHistorySize) {
            this.decisionHistory.shift();
        }

        this.emit("decision_made", { decision, analysis });

        return decision;
    }

    private calculateConfidence(analysis: TaskAnalysis, context: DecisionContext): number {
        let confidence = 0.5; // Base confidence

        // Increase for known task type
        if (analysis.taskType !== "unknown") {
            confidence += 0.2;
        }

        // Increase for matching agents
        if (analysis.suggestedAgents.length > 0) {
            confidence += 0.1;
        }

        // Increase for clear output format
        if (analysis.outputFormat) {
            confidence += 0.1;
        }

        // Decrease for complexity
        const complexityPenalty = { simple: 0, moderate: -0.05, complex: -0.15 };
        confidence += complexityPenalty[analysis.complexity];

        // Check user preferences if available
        const userPref = this.userPreferences.get(context.userId);
        if (userPref) {
            // Boost if user has history with suggested agent
            if (analysis.suggestedAgents.some(a => (userPref.preferredAgents[a] || 0) > 0.5)) {
                confidence += 0.1;
            }
        }

        // Increase based on conversation context
        if (context.history.length > 0) {
            confidence += 0.05; // Has context
        }

        return Math.min(0.99, Math.max(0.1, confidence));
    }

    private selectAgent(analysis: TaskAnalysis, context: DecisionContext): string {
        if (analysis.suggestedAgents.length === 0) {
            return "orchestrator";
        }

        // Check user preferences
        const userPref = this.userPreferences.get(context.userId);
        if (userPref) {
            const preferred = analysis.suggestedAgents
                .map(a => ({ agent: a, score: userPref.preferredAgents[a] || 0 }))
                .sort((a, b) => b.score - a.score);

            if (preferred[0].score > 0.5) {
                return preferred[0].agent;
            }
        }

        // Check constraints
        if (context.constraints.allowedAgents) {
            const allowed = analysis.suggestedAgents.filter(a =>
                context.constraints.allowedAgents!.includes(a)
            );
            if (allowed.length > 0) {
                return allowed[0];
            }
        }

        return analysis.suggestedAgents[0];
    }

    private selectTools(analysis: TaskAnalysis, context: DecisionContext): string[] {
        let tools = [...analysis.suggestedTools];

        // Remove blocked tools
        if (context.constraints.blockedTools) {
            tools = tools.filter(t => !context.constraints.blockedTools!.includes(t));
        }

        // Add essential tools based on output format - prefer perfect generators
        if (analysis.outputFormat === "pptx") {
            if (!tools.includes("generate_perfect_ppt")) {
                tools.unshift("generate_perfect_ppt");
            }
        }
        if (analysis.outputFormat === "docx") {
            if (!tools.includes("generate_perfect_doc")) {
                tools.unshift("generate_perfect_doc");
            }
        }
        if (analysis.outputFormat === "xlsx") {
            if (!tools.includes("generate_perfect_excel")) {
                tools.unshift("generate_perfect_excel");
            }
        }

        return tools.slice(0, 8);
    }

    private generateExecutionPlan(
        analysis: TaskAnalysis,
        agent: string,
        tools: string[]
    ): ExecutionStep[] {
        const steps: ExecutionStep[] = [];
        let order = 1;

        // Research step if needed
        if (analysis.taskType === "research" || analysis.requiredCapabilities.includes("research_deep")) {
            steps.push({
                order: order++,
                toolName: "research_deep",
                description: `Research: ${analysis.keywords.slice(0, 3).join(", ")}`,
                parameters: { topic: analysis.keywords.join(" "), depth: "standard" },
                expectedOutput: "Compiled research findings",
                isOptional: false
            });
        }

        // Main processing step
        for (const tool of tools.slice(0, 5)) {
            if (tool !== "research_deep") {
                steps.push({
                    order: order++,
                    toolName: tool,
                    description: `Execute: ${tool}`,
                    parameters: {},
                    expectedOutput: `Output from ${tool}`,
                    isOptional: steps.length > 3
                });
            }
        }

        // Output generation step
        if (analysis.outputFormat) {
            const outputTools: Record<string, string> = {
                pptx: "slides_create",
                docx: "doc_create",
                xlsx: "spreadsheet_create"
            };

            const outputTool = outputTools[analysis.outputFormat];
            if (outputTool && !steps.some(s => s.toolName === outputTool)) {
                steps.push({
                    order: order++,
                    toolName: outputTool,
                    description: `Generate ${analysis.outputFormat.toUpperCase()} output`,
                    parameters: { format: analysis.outputFormat },
                    expectedOutput: `${analysis.outputFormat.toUpperCase()} file`,
                    isOptional: false
                });
            }
        }

        return steps;
    }

    private estimateTime(plan: ExecutionStep[]): number {
        // Rough estimate: 5 seconds per step baseline
        const baseTime = plan.length * 5000;

        // Add time for complex tools
        const complexTools = ["research_deep", "data_analyze", "generate_code"];
        const complexCount = plan.filter(s => complexTools.includes(s.toolName)).length;

        return baseTime + (complexCount * 15000);
    }

    private estimateCost(plan: ExecutionStep[]): number {
        // Placeholder cost estimation
        // In production, this would use actual API costs
        const apiCallCost = 0.01;
        return plan.length * apiCallCost;
    }

    private needsConfirmation(
        confidence: number,
        context: DecisionContext,
        analysis: TaskAnalysis
    ): boolean {
        // Always require confirmation if explicitly set
        if (context.constraints.requireApproval) {
            return true;
        }

        // Don't need confirmation for high confidence simple tasks
        if (confidence >= 0.9 && analysis.complexity === "simple") {
            return false;
        }

        // Check user auto-approve threshold
        const userPref = this.userPreferences.get(context.userId);
        if (userPref && confidence >= userPref.autoApproveThreshold) {
            return false;
        }

        // Complex tasks always need confirmation
        if (analysis.complexity === "complex") {
            return true;
        }

        return confidence < this.confidenceThreshold;
    }

    private generateAlternatives(analysis: TaskAnalysis, primaryAgent: string): AlternativeDecision[] {
        return analysis.suggestedAgents
            .filter(a => a !== primaryAgent)
            .slice(0, 2)
            .map(agent => ({
                agent,
                confidence: 0.7,
                reasoning: `Alternative: Use ${agent} agent for this task`
            }));
    }

    private generateReasoning(
        analysis: TaskAnalysis,
        selectedAgent: string,
        confidence: number
    ): string {
        const parts: string[] = [];

        parts.push(`Task identified as: ${analysis.taskType} (${analysis.complexity} complexity)`);
        parts.push(`Selected agent: ${selectedAgent}`);
        parts.push(`Confidence: ${(confidence * 100).toFixed(0)}%`);

        if (analysis.outputFormat) {
            parts.push(`Expected output: ${analysis.outputFormat.toUpperCase()}`);
        }

        parts.push(`Estimated steps: ${analysis.estimatedSteps}`);

        return parts.join(". ");
    }

    /**
     * Update user preferences based on feedback
     */
    updatePreferences(
        userId: string,
        agentId: string,
        success: boolean
    ): void {
        let pref = this.userPreferences.get(userId);

        if (!pref) {
            pref = {
                userId,
                preferredAgents: {},
                preferredTools: {},
                autoApproveThreshold: 0.85,
                preferredOutputFormats: [],
                languagePreference: "es"
            };
            this.userPreferences.set(userId, pref);
        }

        // Update agent preference score
        const currentScore = pref.preferredAgents[agentId] || 0.5;
        const adjustment = success ? 0.05 : -0.03;
        pref.preferredAgents[agentId] = Math.max(0, Math.min(1, currentScore + adjustment));

        this.emit("preferences_updated", { userId, agentId, success });
    }

    /**
     * Get decision statistics
     */
    getStats(): {
        totalDecisions: number;
        autoApproved: number;
        avgConfidence: number;
        topAgents: Array<{ agent: string; count: number }>;
    } {
        const autoApproved = this.decisionHistory.filter(d => d.approved).length;
        const avgConfidence = this.decisionHistory.length > 0
            ? this.decisionHistory.reduce((sum, d) => sum + d.confidence, 0) / this.decisionHistory.length
            : 0;

        const agentCounts = new Map<string, number>();
        for (const decision of this.decisionHistory) {
            const count = agentCounts.get(decision.selectedAgent) || 0;
            agentCounts.set(decision.selectedAgent, count + 1);
        }

        const topAgents = Array.from(agentCounts.entries())
            .map(([agent, count]) => ({ agent, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        return {
            totalDecisions: this.decisionHistory.length,
            autoApproved,
            avgConfidence,
            topAgents
        };
    }
}

// Singleton instance
let decisionEngineInstance: AutonomousDecisionEngine | null = null;

export function getDecisionEngine(): AutonomousDecisionEngine {
    if (!decisionEngineInstance) {
        decisionEngineInstance = new AutonomousDecisionEngine();
    }
    return decisionEngineInstance;
}

export default AutonomousDecisionEngine;
