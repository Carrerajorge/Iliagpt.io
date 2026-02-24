/**
 * PromptUnderstanding Module v2.0
 * 
 * Production-grade prompt understanding with:
 * - LLM-powered extraction (Grok API)
 * - Contradiction detection
 * - Policy engine for safety
 * - Long context chunking
 * - History resolution
 * - Telemetry & observability
 */

import { Lexer } from "./lexer";
import { LLMExtractor, LLMExtractionResult } from "./llmExtractor";
import { Planner } from "./planner";
import { Verifier, VerificationResult } from "./verifier";
import { ContradictionDetector, ContradictionResult } from "./contradictionDetector";
import { PolicyEngine, PolicyViolation, PolicyConfig } from "./policyEngine";
import { LongContextChunker, TextChunk } from "./chunker";
import { HistoryResolver, ConversationTurn, ResolvedReference } from "./historyResolver";
import { telemetry, ExtractionTelemetry } from "./telemetry";
import { UserSpec, ExecutionPlan, ParserState } from "./types";
import { randomUUID } from "crypto";

export interface ProcessingOptions {
    useLLM?: boolean;
    checkContradictions?: boolean;
    resolveHistory?: boolean;
    conversationHistory?: ConversationTurn[];
    policyConfig?: PolicyConfig;
    skipVerification?: boolean;
}

export interface ProcessingResult {
    requestId: string;
    state: ParserState;
    spec: UserSpec;
    plan?: ExecutionPlan;
    verification?: VerificationResult;
    contradictions?: ContradictionResult;
    historyResolutions?: ResolvedReference[];
    policyViolations?: PolicyViolation[];
    isReady: boolean;
    needsClarification: boolean;
    clarificationQuestions: string[];
    confidence: number;
    usedLLM: boolean;
    processingTimeMs: number;
}

export class PromptUnderstanding {
    private lexer: Lexer;
    private llmExtractor: LLMExtractor;
    private planner: Planner;
    private verifier: Verifier;
    private contradictionDetector: ContradictionDetector;
    private policyEngine: PolicyEngine;
    private chunker: LongContextChunker;
    private historyResolver: HistoryResolver;
    private state: ParserState;

    constructor(policyConfig?: PolicyConfig) {
        this.lexer = new Lexer();
        this.llmExtractor = new LLMExtractor();
        this.planner = new Planner();
        this.verifier = new Verifier();
        this.contradictionDetector = new ContradictionDetector();
        this.policyEngine = new PolicyEngine(policyConfig);
        this.chunker = new LongContextChunker();
        this.historyResolver = new HistoryResolver();

        this.state = {
            tokensProcessed: 0,
            isComplete: false,
            currentSpec: this.createEmptySpec(),
            lastUpdated: new Date(),
            buffer: []
        };
    }

    /**
     * Process a full prompt with all enhancements
     */
    async processFullPrompt(
        text: string,
        options: ProcessingOptions = {}
    ): Promise<ProcessingResult> {
        const requestId = randomUUID();
        const startTime = Date.now();

        const {
            useLLM = true,
            checkContradictions = true,
            resolveHistory = true,
            conversationHistory = [],
            skipVerification = false
        } = options;

        let processedText = text;
        let historyResolutions: ResolvedReference[] = [];
        let usedLLM = false;

        // 1. Resolve history references
        if (resolveHistory && conversationHistory.length > 0) {
            const resolution = await this.historyResolver.resolve(text, conversationHistory);
            processedText = resolution.expandedMessage;
            historyResolutions = resolution.resolutions;
        }

        // 2. Handle long context
        let spec: UserSpec;
        if (this.chunker.needsChunking(processedText)) {
            const chunks = this.chunker.chunk(processedText);
            const partialSpecs: UserSpec[] = [];

            for (const chunk of chunks) {
                const chunkResult = useLLM
                    ? await this.llmExtractor.extractWithLLM(chunk.text)
                    : { spec: this.llmExtractor.extractWithHeuristics(chunk.text), usedLLM: false };
                partialSpecs.push(chunkResult.spec);
                usedLLM = usedLLM || chunkResult.usedLLM;
            }

            spec = this.chunker.mergeSpecs(partialSpecs);
        } else {
            // 3. Extract UserSpec
            const extractionResult = useLLM
                ? await this.llmExtractor.extractWithLLM(processedText)
                : { spec: this.llmExtractor.extractWithHeuristics(processedText), usedLLM: false };

            spec = extractionResult.spec;
            usedLLM = extractionResult.usedLLM;
        }

        // 4. Check for contradictions
        let contradictions: ContradictionResult | undefined;
        if (checkContradictions) {
            contradictions = useLLM
                ? await this.contradictionDetector.detect(processedText)
                : this.contradictionDetector.detectHeuristic(processedText);

            if (contradictions.hasContradictions) {
                spec.risks.push({
                    type: "contradiction",
                    description: contradictions.contradictions.map(c => c.description).join("; "),
                    severity: "high",
                    requiresConfirmation: true
                });
            }
        }

        // 5. Create execution plan
        const plan = this.planner.createPlan(spec);

        // 6. Verify with quality gates
        let verification: VerificationResult | undefined;
        if (!skipVerification) {
            verification = this.verifier.verify(spec, plan);
        }

        // 7. Apply policy engine
        const policyViolations = this.policyEngine.evaluate(spec, plan);
        const blockingViolations = this.policyEngine.getBlockingViolations(policyViolations);
        const confirmationRequired = this.policyEngine.getConfirmationRequired(policyViolations);

        // 8. Determine if clarification is needed
        const clarificationQuestions = this.buildClarificationQuestions(spec, verification, policyViolations);
        const needsClarification = clarificationQuestions.length > 0;

        // 9. Determine readiness
        const isReady =
            !needsClarification &&
            blockingViolations.length === 0 &&
            (verification?.isApproved ?? true) &&
            !contradictions?.hasContradictions;

        // Update state
        this.state = {
            tokensProcessed: this.chunker.estimateTokens(text),
            isComplete: true,
            currentSpec: spec,
            lastUpdated: new Date(),
            buffer: []
        };

        const processingTimeMs = Date.now() - startTime;

        // Log telemetry
        telemetry.logExtraction({
            requestId,
            inputText: text.substring(0, 500),
            inputTokens: this.state.tokensProcessed,
            extractedSpec: spec,
            usedLLM,
            extractionTimeMs: processingTimeMs,
            confidence: spec.confidence
        });

        if (verification) {
            telemetry.logVerification(requestId, policyViolations, verification.isApproved);
        }

        return {
            requestId,
            state: this.state,
            spec,
            plan,
            verification,
            contradictions,
            historyResolutions,
            policyViolations,
            isReady,
            needsClarification,
            clarificationQuestions,
            confidence: spec.confidence,
            usedLLM,
            processingTimeMs
        };
    }

    /**
     * Fast processing without LLM (for testing or fallback)
     */
    processSync(text: string): ProcessingResult {
        const requestId = randomUUID();
        const startTime = Date.now();

        // Use heuristics only
        const spec = this.llmExtractor.extractWithHeuristics(text);
        const plan = this.planner.createPlan(spec);
        const verification = this.verifier.verify(spec, plan);
        const policyViolations = this.policyEngine.evaluate(spec, plan);
        const contradictions = this.contradictionDetector.detectHeuristic(text);

        if (contradictions.hasContradictions) {
            spec.risks.push({
                type: "contradiction",
                description: "Conflicting instructions detected",
                severity: "high",
                requiresConfirmation: true
            });
        }

        const clarificationQuestions = this.buildClarificationQuestions(spec, verification, policyViolations);
        const blockingViolations = this.policyEngine.getBlockingViolations(policyViolations);

        this.state = {
            tokensProcessed: this.chunker.estimateTokens(text),
            isComplete: true,
            currentSpec: spec,
            lastUpdated: new Date(),
            buffer: []
        };

        return {
            requestId,
            state: this.state,
            spec,
            plan,
            verification,
            contradictions,
            historyResolutions: [],
            policyViolations,
            isReady: verification.isApproved && blockingViolations.length === 0,
            needsClarification: clarificationQuestions.length > 0,
            clarificationQuestions,
            confidence: spec.confidence,
            usedLLM: false,
            processingTimeMs: Date.now() - startTime
        };
    }

    private buildClarificationQuestions(
        spec: UserSpec,
        verification?: VerificationResult,
        violations?: PolicyViolation[]
    ): string[] {
        const questions: string[] = [];

        // From spec
        questions.push(...spec.questions);

        // From missing inputs
        for (const input of spec.missing_inputs) {
            questions.push(`Please provide: ${input}`);
        }

        // From verification
        if (verification?.verificationQuestions) {
            questions.push(...verification.verificationQuestions);
        }

        // From policy violations requiring confirmation
        if (violations) {
            for (const v of violations.filter(v => v.severity === "require_confirmation")) {
                questions.push(`Confirmation needed: ${v.message}`);
            }
        }

        return [...new Set(questions)]; // Deduplicate
    }

    private createEmptySpec(): UserSpec {
        return {
            goal: "",
            tasks: [],
            inputs_provided: {},
            missing_inputs: [],
            constraints: [],
            success_criteria: [],
            assumptions: [],
            risks: [],
            questions: [],
            confidence: 0
        };
    }

    reset(): void {
        this.lexer.reset();
        this.state = {
            tokensProcessed: 0,
            isComplete: false,
            currentSpec: this.createEmptySpec(),
            lastUpdated: new Date(),
            buffer: []
        };
    }

    // Expose sub-components for advanced usage
    getLexer(): Lexer { return this.lexer; }
    getExtractor(): LLMExtractor { return this.llmExtractor; }
    getPlanner(): Planner { return this.planner; }
    getVerifier(): Verifier { return this.verifier; }
    getPolicyEngine(): PolicyEngine { return this.policyEngine; }
    getContradictionDetector(): ContradictionDetector { return this.contradictionDetector; }
    getChunker(): LongContextChunker { return this.chunker; }
    getHistoryResolver(): HistoryResolver { return this.historyResolver; }
}

// Re-export all components
export * from "./types";
export * from "./lexer";
export * from "./llmExtractor";
export * from "./planner";
export * from "./verifier";
export * from "./contradictionDetector";
export * from "./policyEngine";
export * from "./chunker";
export * from "./historyResolver";
export * from "./telemetry";
