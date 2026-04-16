/**
 * Enhanced Orchestrator Integration for ILIAGPT PRO 3.0
 * 
 * Integrates new components (Knowledge Graph, HTN Planner, Self-Healing,
 * Decision Engine, Collaboration Protocol, Tool Composer) with the
 * existing AgentOrchestrator.
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";

// Import new components
import { getSelfHealingSystem, type ExecutionContext, type RemediationResult } from "./selfHealingSystem";
import { getDecisionEngine, type DecisionContext, type Decision } from "./autonomousDecisionEngine";
import { getKnowledgeGraph, type KnowledgeNode } from "./knowledgeGraph";
import { getHTNPlanner, type Plan, type Task } from "./htnPlanner";
import { getCollaborationProtocol, type AgentCapability } from "./collaborationProtocol";
import { getToolComposer, type Pipeline } from "./toolComposer";

// Types
export interface EnhancedPlan {
    id: string;
    objective: string;
    decision: Decision;
    htnPlan?: Plan;
    pipeline?: Pipeline;
    knowledgeContext: KnowledgeNode[];
    estimatedTime: number;
    confidence: number;
    requiresApproval: boolean;
}

export interface EnhancedExecutionResult {
    success: boolean;
    outputs: Record<string, any>;
    artifacts: any[];
    healingActions: RemediationResult[];
    knowledgeLearned: KnowledgeNode[];
    executionTime: number;
    agentsUsed: string[];
}

export interface OrchestratorConfig {
    autoApproveThreshold: number;
    maxRetries: number;
    enableSelfHealing: boolean;
    enableKnowledgeGraph: boolean;
    enableCollaboration: boolean;
    learningEnabled: boolean;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
    autoApproveThreshold: 0.85,
    maxRetries: 3,
    enableSelfHealing: true,
    enableKnowledgeGraph: true,
    enableCollaboration: true,
    learningEnabled: true
};

/**
 * Enhanced Orchestrator that integrates all new components
 */
export class EnhancedOrchestrator extends EventEmitter {
    private config: OrchestratorConfig;
    private selfHealing = getSelfHealingSystem();
    private decisionEngine = getDecisionEngine();
    private knowledgeGraph = getKnowledgeGraph();
    private htnPlanner = getHTNPlanner();
    private collaboration = getCollaborationProtocol();
    private toolComposer = getToolComposer();

    private userId: string;
    private sessionId: string;
    private conversationHistory: Array<{ role: string; content: string; timestamp: Date }> = [];

    constructor(userId: string, config: Partial<OrchestratorConfig> = {}) {
        super();
        this.userId = userId;
        this.sessionId = randomUUID();
        this.config = { ...DEFAULT_CONFIG, ...config };

        this.registerAgents();
        this.setupEventHandlers();
    }

    /**
     * Register all agents with the collaboration protocol
     */
    private registerAgents(): void {
        const agents: Array<{ id: string; capability: Omit<AgentCapability, 'id'> }> = [
            {
                id: "orchestrator",
                capability: {
                    name: "Orchestrator",
                    description: "Central coordinator",
                    tools: ["plan", "orchestrate", "delegate"],
                    specialties: ["coordination", "planning"],
                    currentLoad: 0,
                    maxLoad: 10,
                    performance: { successRate: 0.95, avgResponseTime: 100, tasksCompleted: 0 }
                }
            },
            {
                id: "research",
                capability: {
                    name: "Research Agent",
                    description: "Deep research and verification",
                    tools: ["search_web", "fetch_url", "research_deep", "verify", "summarize"],
                    specialties: ["research", "fact-checking", "analysis"],
                    currentLoad: 0,
                    maxLoad: 5,
                    performance: { successRate: 0.9, avgResponseTime: 5000, tasksCompleted: 0 }
                }
            },
            {
                id: "code",
                capability: {
                    name: "Code Agent",
                    description: "Software development",
                    tools: ["generate_code", "code_review", "code_test", "code_debug"],
                    specialties: ["programming", "debugging", "testing"],
                    currentLoad: 0,
                    maxLoad: 3,
                    performance: { successRate: 0.85, avgResponseTime: 10000, tasksCompleted: 0 }
                }
            },
            {
                id: "content",
                capability: {
                    name: "Content Agent",
                    description: "Document and content creation",
                    tools: ["generate_text", "doc_create", "slides_create", "translate"],
                    specialties: ["writing", "presentations", "documents"],
                    currentLoad: 0,
                    maxLoad: 5,
                    performance: { successRate: 0.9, avgResponseTime: 8000, tasksCompleted: 0 }
                }
            },
            {
                id: "data",
                capability: {
                    name: "Data Agent",
                    description: "Data analysis and visualization",
                    tools: ["data_analyze", "data_visualize", "spreadsheet_create"],
                    specialties: ["analytics", "statistics", "visualization"],
                    currentLoad: 0,
                    maxLoad: 4,
                    performance: { successRate: 0.88, avgResponseTime: 12000, tasksCompleted: 0 }
                }
            }
        ];

        for (const { id, capability } of agents) {
            this.collaboration.registerAgent(id, capability);
        }
    }

    /**
     * Setup event handlers for all components
     */
    private setupEventHandlers(): void {
        // Self-healing events
        this.selfHealing.on("healing_complete", (data) => {
            this.emit("healing", data);
            if (this.config.enableKnowledgeGraph) {
                this.knowledgeGraph.addNode("event", "healing_action", data, {
                    source: "self_healing",
                    importance: 0.7
                });
            }
        });

        // Decision engine events
        this.decisionEngine.on("decision_made", (data) => {
            this.emit("decision", data);
        });

        // HTN planner events
        this.htnPlanner.on("planning:complete", (data) => {
            this.emit("plan_created", data);
        });

        this.htnPlanner.on("execution:complete", (data) => {
            this.emit("execution_complete", data);
        });

        // Collaboration events
        this.collaboration.on("delegation:completed", (data) => {
            this.emit("delegation_complete", data);
        });
    }

    /**
     * Process a user message with enhanced intelligence
     */
    async processMessage(
        userMessage: string,
        attachments: any[] = [],
        options: { requireApproval?: boolean } = {}
    ): Promise<EnhancedPlan> {
        const startTime = Date.now();

        // Add to conversation history
        this.conversationHistory.push({
            role: "user",
            content: userMessage,
            timestamp: new Date()
        });

        // Step 1: Retrieve relevant knowledge
        const knowledgeContext = this.config.enableKnowledgeGraph
            ? this.retrieveRelevantKnowledge(userMessage)
            : [];

        // Step 2: Make autonomous decision
        const decisionContext: DecisionContext = {
            userId: this.userId,
            sessionId: this.sessionId,
            taskType: "mixed",
            input: userMessage,
            history: this.conversationHistory.map(h => ({
                role: h.role as "user" | "assistant" | "system",
                content: h.content,
                timestamp: h.timestamp
            })),
            availableAgents: Array.from(this.collaboration.getStats().registeredAgents ?
                ["orchestrator", "research", "code", "content", "data"] : []),
            availableTools: [],
            constraints: {
                requireApproval: options.requireApproval
            },
            metadata: {
                attachments: attachments.length,
                knowledgeNodes: knowledgeContext.length
            }
        };

        const decision = await this.decisionEngine.decide(decisionContext);

        // Step 3: Create HTN plan if task is non-trivial
        let htnPlan: Plan | undefined;
        let pipeline: Pipeline | undefined;

        if (decision.executionPlan.length > 1) {
            // Use HTN planner for complex tasks
            const planResult = await this.htnPlanner.plan(userMessage, {
                attachments,
                decision
            });

            if (planResult.success && planResult.plan) {
                htnPlan = planResult.plan;
            }

            // Also create a tool pipeline
            pipeline = this.toolComposer.createPipelineFromDescription(userMessage);
        }

        // Step 4: Build enhanced plan
        const enhancedPlan: EnhancedPlan = {
            id: randomUUID(),
            objective: decision.reasoning,
            decision,
            htnPlan,
            pipeline,
            knowledgeContext,
            estimatedTime: decision.estimatedTime,
            confidence: decision.confidence,
            requiresApproval: decision.requiresConfirmation ||
                decision.confidence < this.config.autoApproveThreshold
        };

        this.emit("plan_ready", enhancedPlan);

        // Step 5: Store planning knowledge
        if (this.config.enableKnowledgeGraph) {
            this.knowledgeGraph.addNode("decision", userMessage.substring(0, 50), {
                decision: decision.selectedAgent,
                confidence: decision.confidence,
                tools: decision.selectedTools
            }, {
                source: "decision_engine",
                importance: 0.6
            });
        }

        return enhancedPlan;
    }

    /**
     * Execute an enhanced plan
     */
    async executePlan(
        plan: EnhancedPlan,
        toolExecutor: (toolName: string, params: any) => Promise<any>
    ): Promise<EnhancedExecutionResult> {
        const startTime = Date.now();
        const healingActions: RemediationResult[] = [];
        const knowledgeLearned: KnowledgeNode[] = [];
        const artifacts: any[] = [];
        const outputs: Record<string, any> = {};
        const agentsUsed: string[] = [plan.decision.selectedAgent];

        this.emit("execution_start", { planId: plan.id });

        try {
            // Use pipeline if available
            if (plan.pipeline) {
                const pipelineResult = await this.toolComposer.executePipeline(
                    plan.pipeline.id,
                    { topic: plan.objective },
                    {
                        onProgress: (step, total, result) => {
                            this.emit("step_progress", { step, total, result });
                        }
                    }
                );

                Object.assign(outputs, pipelineResult.outputs);

                if (!pipelineResult.success && this.config.enableSelfHealing) {
                    // Attempt self-healing
                    for (const error of pipelineResult.errors) {
                        const context: ExecutionContext = {
                            runId: plan.id,
                            stepIndex: error.step,
                            toolName: plan.pipeline.steps[error.step]?.toolName || "unknown",
                            parameters: {},
                            previousAttempts: 0,
                            history: [],
                            metadata: {}
                        };

                        const { remediation } = await this.selfHealing.processError(
                            new Error(error.error),
                            context
                        );

                        healingActions.push(remediation);
                    }
                }
            }
            // Use HTN plan if available
            else if (plan.htnPlan) {
                const htnResult = await this.htnPlanner.execute(
                    plan.htnPlan.id,
                    async (task: Task) => {
                        if (task.toolName) {
                            return await this.executeToolWithHealing(
                                task.toolName,
                                task.toolParams || {},
                                toolExecutor,
                                plan.id,
                                healingActions
                            );
                        }
                        return null;
                    }
                );

                for (const [key, value] of htnResult.results) {
                    outputs[key] = value;
                }
            }
            // Direct execution based on decision
            else {
                for (let i = 0; i < plan.decision.executionPlan.length; i++) {
                    const step = plan.decision.executionPlan[i];

                    this.emit("step_start", { stepIndex: i, toolName: step.toolName });

                    const result = await this.executeToolWithHealing(
                        step.toolName,
                        step.parameters,
                        toolExecutor,
                        plan.id,
                        healingActions
                    );

                    outputs[step.toolName] = result;

                    if (result?.artifacts) {
                        artifacts.push(...result.artifacts);
                    }

                    this.emit("step_complete", { stepIndex: i, result });
                }
            }

            // Store learned knowledge
            if (this.config.enableKnowledgeGraph && this.config.learningEnabled) {
                const node = this.knowledgeGraph.addNode(
                    "fact",
                    `Executed: ${plan.objective.substring(0, 50)}`,
                    {
                        success: true,
                        executionTime: Date.now() - startTime,
                        agentsUsed,
                        toolsUsed: plan.decision.selectedTools
                    },
                    {
                        source: "execution",
                        importance: 0.5
                    }
                );
                knowledgeLearned.push(node);
            }

            // Update user preferences
            this.decisionEngine.updatePreferences(
                this.userId,
                plan.decision.selectedAgent,
                true
            );

            // Add assistant response to history
            this.conversationHistory.push({
                role: "assistant",
                content: JSON.stringify(outputs),
                timestamp: new Date()
            });

            return {
                success: true,
                outputs,
                artifacts,
                healingActions,
                knowledgeLearned,
                executionTime: Date.now() - startTime,
                agentsUsed
            };

        } catch (error) {
            // Handle failure with self-healing
            if (this.config.enableSelfHealing) {
                const context: ExecutionContext = {
                    runId: plan.id,
                    stepIndex: 0,
                    toolName: "unknown",
                    parameters: {},
                    previousAttempts: 0,
                    history: [],
                    metadata: {}
                };

                const { remediation } = await this.selfHealing.processError(
                    error as Error,
                    context
                );

                healingActions.push(remediation);
            }

            // Update preferences for failure
            this.decisionEngine.updatePreferences(
                this.userId,
                plan.decision.selectedAgent,
                false
            );

            this.emit("execution_failed", { planId: plan.id, error: (error as Error).message });

            return {
                success: false,
                outputs,
                artifacts,
                healingActions,
                knowledgeLearned,
                executionTime: Date.now() - startTime,
                agentsUsed
            };
        }
    }

    /**
     * Execute a tool with self-healing capabilities
     */
    private async executeToolWithHealing(
        toolName: string,
        params: any,
        executor: (toolName: string, params: any) => Promise<any>,
        planId: string,
        healingActions: RemediationResult[]
    ): Promise<any> {
        let attempts = 0;
        let lastError: Error | null = null;
        let currentParams = { ...params };

        while (attempts < this.config.maxRetries) {
            try {
                return await executor(toolName, currentParams);
            } catch (error) {
                lastError = error as Error;
                attempts++;

                if (this.config.enableSelfHealing) {
                    const context: ExecutionContext = {
                        runId: planId,
                        stepIndex: 0,
                        toolName,
                        parameters: currentParams,
                        previousAttempts: attempts,
                        history: [],
                        metadata: {}
                    };

                    const { diagnosis, remediation } = await this.selfHealing.processError(
                        lastError,
                        context
                    );

                    healingActions.push(remediation);

                    if (remediation.success && remediation.shouldRetry) {
                        // Apply modified parameters if provided
                        if (remediation.modifiedParameters) {
                            currentParams = remediation.modifiedParameters;
                        }

                        // Wait if delay specified
                        if (remediation.nextDelay) {
                            await new Promise(r => setTimeout(r, remediation.nextDelay));
                        }

                        continue;
                    }

                    // If fallback provided, return it
                    if (remediation.fallbackValue !== undefined) {
                        return remediation.fallbackValue;
                    }
                }

                // No more retries, throw
                if (attempts >= this.config.maxRetries) {
                    throw lastError;
                }
            }
        }

        throw lastError;
    }

    /**
     * Retrieve relevant knowledge for a query
     */
    private retrieveRelevantKnowledge(query: string): KnowledgeNode[] {
        if (!this.config.enableKnowledgeGraph) return [];

        // Find by label similarity
        const byLabel = this.knowledgeGraph.findByLabel(query, 0.5);

        // Find facts and decisions
        const facts = this.knowledgeGraph.findByType("fact").slice(0, 5);
        const decisions = this.knowledgeGraph.findByType("decision").slice(0, 3);

        // Combine and deduplicate
        const seen = new Set<string>();
        const results: KnowledgeNode[] = [];

        for (const node of [...byLabel.slice(0, 10), ...facts, ...decisions]) {
            if (!seen.has(node.id)) {
                seen.add(node.id);
                results.push(node);
            }
        }

        return results.slice(0, 15);
    }

    /**
     * Delegate a task to a specific agent
     */
    async delegateToAgent(
        agentId: string,
        task: any,
        options: { timeout?: number } = {}
    ): Promise<any> {
        if (!this.config.enableCollaboration) {
            throw new Error("Collaboration is disabled");
        }

        const delegation = await this.collaboration.delegateTask(
            "orchestrator",
            agentId,
            task,
            options
        );

        return delegation;
    }

    /**
     * Get system statistics
     */
    getStats(): {
        knowledge: any;
        decisions: any;
        healing: any;
        collaboration: any;
        toolComposer: any;
    } {
        return {
            knowledge: this.knowledgeGraph.getStats(),
            decisions: this.decisionEngine.getStats(),
            healing: this.selfHealing.getStats(),
            collaboration: this.collaboration.getStats(),
            toolComposer: this.toolComposer.getStats()
        };
    }

    /**
     * Clear session state
     */
    clearSession(): void {
        this.conversationHistory = [];
        this.sessionId = randomUUID();
    }
}

// Factory function
export function createEnhancedOrchestrator(
    userId: string,
    config?: Partial<OrchestratorConfig>
): EnhancedOrchestrator {
    return new EnhancedOrchestrator(userId, config);
}

export default EnhancedOrchestrator;
