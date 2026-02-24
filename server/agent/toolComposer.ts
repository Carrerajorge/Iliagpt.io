/**
 * Tool Composition Engine for ILIAGPT PRO 3.0
 * 
 * Permite crear pipelines de herramientas dinámicamente,
 * optimizar secuencias, aprender mejores combinaciones,
 * y cachear resultados intermedios.
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";

// ============================================
// Types and Interfaces
// ============================================

export interface Tool {
    id: string;
    name: string;
    description: string;
    category: string;
    inputSchema: Record<string, any>;
    outputSchema: Record<string, any>;
    execute: (params: any, context: any) => Promise<any>;
    estimatedDuration: number;
    cost: number;
    successRate: number;
}

export interface ToolStep {
    id: string;
    toolName: string;
    inputMapping: InputMapping[];
    outputKey: string;
    condition?: StepCondition;
    fallbackTool?: string;
    retries: number;
    timeout: number;
}

export interface InputMapping {
    paramName: string;
    source: 'literal' | 'context' | 'previous_output' | 'transform';
    value?: any;
    sourceKey?: string;
    transform?: (value: any) => any;
}

export interface StepCondition {
    type: 'always' | 'if_success' | 'if_failure' | 'custom';
    dependsOn?: string[];
    customCheck?: (context: PipelineContext) => boolean;
}

export interface DataFlowSpec {
    inputs: Record<string, any>;
    intermediates: Record<string, any>;
    outputs: Record<string, string>;
}

export interface ErrorStrategy {
    type: 'stop' | 'continue' | 'retry' | 'fallback';
    maxRetries: number;
    retryDelay: number;
    fallbackValue?: any;
}

export interface Pipeline {
    id: string;
    name: string;
    description: string;
    steps: ToolStep[];
    dataFlow: DataFlowSpec;
    errorStrategy: ErrorStrategy;
    metadata: {
        createdAt: Date;
        updatedAt: Date;
        executionCount: number;
        avgDuration: number;
        successRate: number;
    };
}

export interface PipelineContext {
    pipelineId: string;
    executionId: string;
    inputs: Record<string, any>;
    outputs: Record<string, any>;
    currentStep: number;
    status: 'running' | 'completed' | 'failed' | 'paused';
    errors: Array<{ step: number; error: string }>;
    startTime: Date;
    stepResults: Map<string, any>;
}

export interface ExecutionResult {
    success: boolean;
    outputs: Record<string, any>;
    executionTime: number;
    stepsExecuted: number;
    errors: Array<{ step: number; error: string }>;
}

export interface PipelineTemplate {
    id: string;
    name: string;
    pattern: string[];
    frequency: number;
    avgSuccessRate: number;
}

// ============================================
// Tool Composer Class
// ============================================

export class ToolComposer extends EventEmitter {
    private tools: Map<string, Tool>;
    private pipelines: Map<string, Pipeline>;
    private templates: Map<string, PipelineTemplate>;
    private resultCache: Map<string, { result: any; timestamp: number }>;
    private executionHistory: Array<{ pipelineId: string; success: boolean; duration: number }>;

    // Configuration
    private cacheTTL: number;
    private maxCacheSize: number;
    private learningEnabled: boolean;

    constructor(options: {
        cacheTTL?: number;
        maxCacheSize?: number;
        learningEnabled?: boolean;
    } = {}) {
        super();

        this.tools = new Map();
        this.pipelines = new Map();
        this.templates = new Map();
        this.resultCache = new Map();
        this.executionHistory = [];

        this.cacheTTL = options.cacheTTL || 300000; // 5 minutes
        this.maxCacheSize = options.maxCacheSize || 1000;
        this.learningEnabled = options.learningEnabled ?? true;
    }

    // ============================================
    // Tool Registration
    // ============================================

    /**
     * Register a tool
     */
    registerTool(tool: Tool): void {
        this.tools.set(tool.name, tool);
        this.emit("tool:registered", { toolName: tool.name });
    }

    /**
     * Get a tool by name
     */
    getTool(name: string): Tool | undefined {
        return this.tools.get(name);
    }

    /**
     * Find compatible tools for output type
     */
    findCompatibleTools(outputType: string): Tool[] {
        return Array.from(this.tools.values())
            .filter(t => {
                const inputKeys = Object.keys(t.inputSchema);
                return inputKeys.some(k => t.inputSchema[k].type === outputType);
            });
    }

    // ============================================
    // Pipeline Creation
    // ============================================

    /**
     * Create a new pipeline
     */
    createPipeline(
        name: string,
        steps: Omit<ToolStep, 'id'>[],
        options: {
            description?: string;
            errorStrategy?: Partial<ErrorStrategy>;
            dataFlow?: Partial<DataFlowSpec>;
        } = {}
    ): Pipeline {
        const pipeline: Pipeline = {
            id: randomUUID(),
            name,
            description: options.description || '',
            steps: steps.map(s => ({ ...s, id: randomUUID() })),
            dataFlow: {
                inputs: {},
                intermediates: {},
                outputs: {},
                ...options.dataFlow
            },
            errorStrategy: {
                type: 'stop',
                maxRetries: 3,
                retryDelay: 1000,
                ...options.errorStrategy
            },
            metadata: {
                createdAt: new Date(),
                updatedAt: new Date(),
                executionCount: 0,
                avgDuration: 0,
                successRate: 0
            }
        };

        this.pipelines.set(pipeline.id, pipeline);
        this.emit("pipeline:created", { pipelineId: pipeline.id, name });

        return pipeline;
    }

    /**
     * Create pipeline from natural language description
     */
    createPipelineFromDescription(description: string): Pipeline {
        const lowerDesc = description.toLowerCase();
        const steps: Omit<ToolStep, 'id'>[] = [];

        // Pattern matching for common workflows
        if (lowerDesc.includes('research') || lowerDesc.includes('investigar')) {
            steps.push({
                toolName: 'search_web',
                inputMapping: [{ paramName: 'query', source: 'context', sourceKey: 'topic' }],
                outputKey: 'searchResults',
                retries: 2,
                timeout: 10000
            });
            steps.push({
                toolName: 'summarize',
                inputMapping: [{ paramName: 'content', source: 'previous_output', sourceKey: 'searchResults' }],
                outputKey: 'summary',
                retries: 1,
                timeout: 15000
            });
        }

        if (lowerDesc.includes('presentation') || lowerDesc.includes('presentación') || lowerDesc.includes('ppt')) {
            steps.push({
                toolName: 'research_deep',
                inputMapping: [{ paramName: 'topic', source: 'context', sourceKey: 'topic' }],
                outputKey: 'researchData',
                retries: 2,
                timeout: 60000
            });
            steps.push({
                toolName: 'generate_text',
                inputMapping: [
                    { paramName: 'prompt', source: 'transform', transform: (ctx: any) => `Create an outline for: ${ctx.topic}` }
                ],
                outputKey: 'outline',
                retries: 1,
                timeout: 15000
            });
            steps.push({
                toolName: 'slides_create',
                inputMapping: [{ paramName: 'content', source: 'previous_output', sourceKey: 'outline' }],
                outputKey: 'presentation',
                retries: 1,
                timeout: 30000
            });
        }

        if (lowerDesc.includes('document') || lowerDesc.includes('documento') || lowerDesc.includes('word')) {
            steps.push({
                toolName: 'research_deep',
                inputMapping: [{ paramName: 'topic', source: 'context', sourceKey: 'topic' }],
                outputKey: 'researchData',
                retries: 2,
                timeout: 60000
            });
            steps.push({
                toolName: 'generate_text',
                inputMapping: [
                    { paramName: 'prompt', source: 'context', sourceKey: 'topic' },
                    { paramName: 'style', source: 'literal', value: 'academic' }
                ],
                outputKey: 'content',
                retries: 2,
                timeout: 30000
            });
            steps.push({
                toolName: 'doc_create',
                inputMapping: [{ paramName: 'content', source: 'previous_output', sourceKey: 'content' }],
                outputKey: 'document',
                retries: 1,
                timeout: 20000
            });
        }

        if (lowerDesc.includes('code') || lowerDesc.includes('código') || lowerDesc.includes('program')) {
            steps.push({
                toolName: 'generate_code',
                inputMapping: [
                    { paramName: 'description', source: 'context', sourceKey: 'topic' },
                    { paramName: 'language', source: 'context', sourceKey: 'language' }
                ],
                outputKey: 'code',
                retries: 2,
                timeout: 30000
            });
            steps.push({
                toolName: 'code_review',
                inputMapping: [{ paramName: 'code', source: 'previous_output', sourceKey: 'code' }],
                outputKey: 'review',
                retries: 1,
                timeout: 15000
            });
        }

        return this.createPipeline(`Auto: ${description.substring(0, 50)}`, steps, {
            description
        });
    }

    // ============================================
    // Pipeline Execution
    // ============================================

    /**
     * Execute a pipeline
     */
    async executePipeline(
        pipelineId: string,
        inputs: Record<string, any>,
        options: {
            onProgress?: (step: number, total: number, result: any) => void;
            timeout?: number;
        } = {}
    ): Promise<ExecutionResult> {
        const pipeline = this.pipelines.get(pipelineId);
        if (!pipeline) {
            return {
                success: false,
                outputs: {},
                executionTime: 0,
                stepsExecuted: 0,
                errors: [{ step: 0, error: 'Pipeline not found' }]
            };
        }

        const executionId = randomUUID();
        const startTime = Date.now();

        const context: PipelineContext = {
            pipelineId,
            executionId,
            inputs,
            outputs: {},
            currentStep: 0,
            status: 'running',
            errors: [],
            startTime: new Date(),
            stepResults: new Map()
        };

        this.emit("execution:start", { pipelineId, executionId });

        try {
            for (let i = 0; i < pipeline.steps.length; i++) {
                const step = pipeline.steps[i];
                context.currentStep = i;

                // Check condition
                if (step.condition && !this.checkStepCondition(step.condition, context)) {
                    continue;
                }

                // Check cache
                const cacheKey = this.getCacheKey(step, context);
                const cached = this.getFromCache(cacheKey);
                if (cached) {
                    context.stepResults.set(step.outputKey, cached);
                    context.outputs[step.outputKey] = cached;
                    continue;
                }

                // Get tool
                const tool = this.tools.get(step.toolName);
                if (!tool) {
                    if (step.fallbackTool) {
                        const fallback = this.tools.get(step.fallbackTool);
                        if (fallback) {
                            // Use fallback
                        }
                    }
                    context.errors.push({ step: i, error: `Tool not found: ${step.toolName}` });

                    if (pipeline.errorStrategy.type === 'stop') {
                        throw new Error(`Tool not found: ${step.toolName}`);
                    }
                    continue;
                }

                // Build parameters
                const params = this.buildParams(step.inputMapping, context);

                // Execute with retries
                let result: any;
                let attempts = 0;
                let lastError: Error | null = null;

                while (attempts <= step.retries) {
                    try {
                        this.emit("step:start", { pipelineId, executionId, step: i, toolName: step.toolName });

                        result = await Promise.race([
                            tool.execute(params, context),
                            new Promise((_, reject) =>
                                setTimeout(() => reject(new Error('Timeout')), step.timeout)
                            )
                        ]);

                        this.emit("step:complete", { pipelineId, executionId, step: i, result });
                        break;

                    } catch (error) {
                        lastError = error as Error;
                        attempts++;

                        if (attempts <= step.retries) {
                            await new Promise(r => setTimeout(r, pipeline.errorStrategy.retryDelay));
                        }
                    }
                }

                if (lastError && attempts > step.retries) {
                    context.errors.push({ step: i, error: lastError.message });

                    if (pipeline.errorStrategy.type === 'stop') {
                        throw lastError;
                    } else if (pipeline.errorStrategy.fallbackValue !== undefined) {
                        result = pipeline.errorStrategy.fallbackValue;
                    }
                }

                // Store result
                context.stepResults.set(step.outputKey, result);
                context.outputs[step.outputKey] = result;

                // Cache result
                this.addToCache(cacheKey, result);

                // Progress callback
                options.onProgress?.(i + 1, pipeline.steps.length, result);
            }

            context.status = 'completed';

        } catch (error) {
            context.status = 'failed';
            context.errors.push({ step: context.currentStep, error: (error as Error).message });
        }

        const executionTime = Date.now() - startTime;

        // Update metrics
        pipeline.metadata.executionCount++;
        pipeline.metadata.avgDuration =
            (pipeline.metadata.avgDuration * (pipeline.metadata.executionCount - 1) + executionTime) /
            pipeline.metadata.executionCount;
        pipeline.metadata.successRate =
            (pipeline.metadata.successRate * (pipeline.metadata.executionCount - 1) +
                (context.status === 'completed' ? 1 : 0)) /
            pipeline.metadata.executionCount;

        // Record for learning
        this.executionHistory.push({
            pipelineId,
            success: context.status === 'completed',
            duration: executionTime
        });

        // Learn patterns
        if (this.learningEnabled) {
            this.learnFromExecution(pipeline, context);
        }

        this.emit("execution:complete", {
            pipelineId,
            executionId,
            success: context.status === 'completed',
            executionTime
        });

        return {
            success: context.status === 'completed',
            outputs: context.outputs,
            executionTime,
            stepsExecuted: context.currentStep + 1,
            errors: context.errors
        };
    }

    private checkStepCondition(condition: StepCondition, context: PipelineContext): boolean {
        switch (condition.type) {
            case 'always':
                return true;
            case 'if_success':
                return context.errors.length === 0;
            case 'if_failure':
                return context.errors.length > 0;
            case 'custom':
                return condition.customCheck?.(context) ?? true;
            default:
                return true;
        }
    }

    private buildParams(mappings: InputMapping[], context: PipelineContext): Record<string, any> {
        const params: Record<string, any> = {};

        for (const mapping of mappings) {
            switch (mapping.source) {
                case 'literal':
                    params[mapping.paramName] = mapping.value;
                    break;
                case 'context':
                    params[mapping.paramName] = context.inputs[mapping.sourceKey!];
                    break;
                case 'previous_output':
                    params[mapping.paramName] = context.stepResults.get(mapping.sourceKey!);
                    break;
                case 'transform':
                    params[mapping.paramName] = mapping.transform?.(context.inputs);
                    break;
            }
        }

        return params;
    }

    // ============================================
    // Caching
    // ============================================

    private getCacheKey(step: ToolStep, context: PipelineContext): string {
        const params = this.buildParams(step.inputMapping, context);
        return `${step.toolName}:${JSON.stringify(params)}`;
    }

    private getFromCache(key: string): any | undefined {
        const cached = this.resultCache.get(key);
        if (!cached) return undefined;

        if (Date.now() - cached.timestamp > this.cacheTTL) {
            this.resultCache.delete(key);
            return undefined;
        }

        return cached.result;
    }

    private addToCache(key: string, result: any): void {
        if (this.resultCache.size >= this.maxCacheSize) {
            // Evict oldest
            const oldest = Array.from(this.resultCache.entries())
                .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
            if (oldest) {
                this.resultCache.delete(oldest[0]);
            }
        }

        this.resultCache.set(key, { result, timestamp: Date.now() });
    }

    // ============================================
    // Learning & Optimization
    // ============================================

    private learnFromExecution(pipeline: Pipeline, context: PipelineContext): void {
        // Extract tool sequence
        const sequence = pipeline.steps.map(s => s.toolName);
        const key = sequence.join('->');

        let template = this.templates.get(key);
        if (template) {
            template.frequency++;
            template.avgSuccessRate =
                (template.avgSuccessRate * (template.frequency - 1) +
                    (context.status === 'completed' ? 1 : 0)) / template.frequency;
        } else {
            template = {
                id: randomUUID(),
                name: `Pattern: ${sequence.slice(0, 3).join('->')}...`,
                pattern: sequence,
                frequency: 1,
                avgSuccessRate: context.status === 'completed' ? 1 : 0
            };
            this.templates.set(key, template);
        }
    }

    /**
     * Suggest optimized pipeline based on learned patterns
     */
    suggestOptimizedPipeline(goal: string): Pipeline | undefined {
        // Find best matching template
        const templates = Array.from(this.templates.values())
            .filter(t => t.avgSuccessRate > 0.7)
            .sort((a, b) =>
                (b.avgSuccessRate * b.frequency) - (a.avgSuccessRate * a.frequency)
            );

        if (templates.length === 0) return undefined;

        const bestTemplate = templates[0];

        // Create pipeline from template
        const steps: Omit<ToolStep, 'id'>[] = bestTemplate.pattern.map((toolName, i) => ({
            toolName,
            inputMapping: i === 0
                ? [{ paramName: 'input', source: 'context' as const, sourceKey: 'input' }]
                : [{ paramName: 'input', source: 'previous_output' as const, sourceKey: `step${i - 1}` }],
            outputKey: `step${i}`,
            retries: 2,
            timeout: 30000
        }));

        return this.createPipeline(`Optimized: ${goal}`, steps, {
            description: `Optimized based on pattern with ${(bestTemplate.avgSuccessRate * 100).toFixed(0)}% success rate`
        });
    }

    // ============================================
    // Pipeline Management
    // ============================================

    getPipeline(id: string): Pipeline | undefined {
        return this.pipelines.get(id);
    }

    listPipelines(): Pipeline[] {
        return Array.from(this.pipelines.values());
    }

    deletePipeline(id: string): boolean {
        return this.pipelines.delete(id);
    }

    getStats(): {
        totalTools: number;
        totalPipelines: number;
        totalTemplates: number;
        cacheSize: number;
        avgSuccessRate: number;
    } {
        const successCount = this.executionHistory.filter(e => e.success).length;

        return {
            totalTools: this.tools.size,
            totalPipelines: this.pipelines.size,
            totalTemplates: this.templates.size,
            cacheSize: this.resultCache.size,
            avgSuccessRate: this.executionHistory.length > 0
                ? successCount / this.executionHistory.length
                : 0
        };
    }
}

// Singleton instance
let toolComposerInstance: ToolComposer | null = null;

export function getToolComposer(): ToolComposer {
    if (!toolComposerInstance) {
        toolComposerInstance = new ToolComposer();
    }
    return toolComposerInstance;
}

export default ToolComposer;
