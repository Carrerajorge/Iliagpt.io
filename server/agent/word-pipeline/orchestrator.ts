import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import {
  PipelineState, PipelineStateSchema, PipelineEvent, PipelineEventSchema,
  StageResult, StageResultSchema, StageStatus, StageConfig, StageConfigSchema,
  OrchestratorConfig, OrchestratorConfigSchema, QualityGateResult, GAP, GAPSchema,
  Stage, StageContext, SupportedLocale, PIPELINE_VERSION, createPipelineEvent,
  DocumentPlan, SourceRef, EvidenceChunk, NormalizedFact, SectionContent, Claim
} from "./contracts";
import { detectLanguage } from "../../services/intent-engine/langDetect";
import type { DocumentSpec } from "./documentSpec";
import type { ThemeId } from "./themeManager";

export interface CompoundPlanStep {
  id: string;
  type: "generate_section" | "verify_claims" | "apply_style" | "assemble";
  sectionId?: string;
  config?: Record<string, unknown>;
  dependsOn?: string[];
}

export interface CompoundPlan {
  id: string;
  steps: CompoundPlanStep[];
  documentSpec?: DocumentSpec;
  themeId?: ThemeId;
}

type StageId = "planner" | "evidence" | "analyzer" | "normalizer" | "writer" | "claims" | "verifier" | "critic" | "assembler";

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

const DEFAULT_STAGE_CONFIG: StageConfig = StageConfigSchema.parse({});

export class WordAgentOrchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private state: PipelineState | null = null;
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private semanticCache: Map<string, { result: any; timestamp: number }> = new Map();
  private abortController: AbortController | null = null;
  
  private stages: Map<StageId, Stage<any, any>> = new Map();
  
  private readonly stageOrder: StageId[] = [
    "planner", "evidence", "analyzer", "normalizer", 
    "writer", "claims", "verifier", "critic", "assembler"
  ];

  constructor(config: Partial<OrchestratorConfig> = {}) {
    super();
    this.config = OrchestratorConfigSchema.parse(config);
  }

  registerStage<TInput, TOutput>(stageId: StageId, stage: Stage<TInput, TOutput>): void {
    this.stages.set(stageId, stage);
  }

  async execute(query: string, options: {
    locale?: SupportedLocale;
    onEvent?: (event: PipelineEvent) => void;
    documentSpec?: DocumentSpec;
    themeId?: ThemeId;
    compoundPlan?: CompoundPlan;
  } = {}): Promise<{ success: boolean; state: PipelineState; artifacts: PipelineState["artifacts"] }> {
    const runId = uuidv4();
    const startTime = Date.now();
    this.abortController = new AbortController();
    
    const detectedLang = detectLanguage(query);
    const locale = options.locale || options.documentSpec?.locale || detectedLang.locale;
    
    const documentSpec = options.documentSpec;
    const themeId = options.themeId || (documentSpec?.theme_id as ThemeId) || "default";
    const compoundPlan = options.compoundPlan;
    
    this.state = PipelineStateSchema.parse({
      runId,
      pipelineVersion: PIPELINE_VERSION,
      query,
      locale,
      status: "initializing",
      sources: [],
      evidence: [],
      facts: [],
      sections: [],
      claims: [],
      gaps: [],
      stageResults: [],
      qualityGates: [],
      artifacts: [],
      startedAt: new Date().toISOString(),
    });
    
    if (documentSpec) {
      (this.state as any).documentSpec = documentSpec;
    }
    if (themeId) {
      (this.state as any).themeId = themeId;
    }
    if (compoundPlan) {
      (this.state as any).compoundPlan = compoundPlan;
    }

    const emitEvent = (event: Omit<PipelineEvent, "runId" | "timestamp">) => {
      const fullEvent = createPipelineEvent(runId, event.eventType, event);
      this.emit("event", fullEvent);
      options.onEvent?.(fullEvent);
    };

    emitEvent({ eventType: "pipeline.started", message: `Starting Word pipeline v${PIPELINE_VERSION}` });

    try {
      for (const stageId of this.stageOrder) {
        if (this.abortController.signal.aborted) {
          throw new Error("Pipeline aborted");
        }

        const stage = this.stages.get(stageId);
        if (!stage) {
          console.warn(`[WordOrchestrator] Stage ${stageId} not registered, skipping`);
          continue;
        }

        const stageConfig = this.getStageConfig(stageId);
        const context: StageContext = {
          runId,
          locale,
          state: this.state,
          config: stageConfig,
          emitEvent,
          abortSignal: this.abortController.signal,
        };

        this.state.currentStage = stageId;
        this.state.status = this.getStatusForStage(stageId);

        if (stageId === "assembler") {
          const claimVerificationResult = this.enforceClaimVerificationPolicy(emitEvent);
          if (!claimVerificationResult.passed) {
            throw new Error(`Claim verification policy failed: ${claimVerificationResult.reason}`);
          }
        }

        const stageResult = await this.executeStageWithResilience(
          stageId,
          stage,
          this.getStageInput(stageId),
          context
        );

        this.state.stageResults.push(stageResult);

        if (stageResult.status === "failed" && !this.canContinueAfterFailure(stageId)) {
          throw new Error(`Stage ${stageId} failed: ${stageResult.error?.message}`);
        }

        this.applyStageOutput(stageId, stageResult.output);

        if (stageResult.qualityGate && !stageResult.qualityGate.passed) {
          this.state.qualityGates.push(stageResult.qualityGate);
          
          if (stageResult.qualityGate.score < 0.5) {
            emitEvent({
              eventType: "quality_gate.failed",
              stageId,
              stageName: stage.name,
              data: stageResult.qualityGate,
            });

            if (this.state.currentIteration < this.config.maxIterations - 1) {
              const gaps = this.detectGaps(stageId, stageResult.qualityGate);
              this.state.gaps.push(...gaps);
              
              for (const gap of gaps) {
                emitEvent({ eventType: "gap.detected", data: gap });
              }

              await this.handleGaps(gaps, context);
              this.state.currentIteration++;
            }
          }
        } else if (stageResult.qualityGate) {
          this.state.qualityGates.push(stageResult.qualityGate);
          emitEvent({
            eventType: "quality_gate.passed",
            stageId,
            stageName: stage.name,
            data: stageResult.qualityGate,
          });
        }

        if (stageResult.tokensUsed) {
          this.state.totalTokensUsed += stageResult.tokensUsed;
        }
      }

      this.state.status = "completed";
      this.state.completedAt = new Date().toISOString();
      this.state.totalDurationMs = Date.now() - startTime;

      emitEvent({
        eventType: "pipeline.completed",
        message: `Pipeline completed in ${this.state.totalDurationMs}ms`,
        data: {
          artifactCount: this.state.artifacts.length,
          totalTokens: this.state.totalTokensUsed,
          iterations: this.state.currentIteration,
        },
      });

      return { success: true, state: this.state, artifacts: this.state.artifacts };

    } catch (error: any) {
      this.state.status = "failed";
      this.state.error = error.message;
      this.state.completedAt = new Date().toISOString();
      this.state.totalDurationMs = Date.now() - startTime;

      emitEvent({
        eventType: "pipeline.failed",
        message: error.message,
        data: { error: error.message },
      });

      return { success: false, state: this.state, artifacts: [] };
    }
  }

  abort(): void {
    this.abortController?.abort();
  }

  private async executeStageWithResilience(
    stageId: StageId,
    stage: Stage<any, any>,
    input: any,
    context: StageContext
  ): Promise<StageResult> {
    const startTime = Date.now();
    const config = context.config;
    let retryCount = 0;
    let lastError: Error | null = null;

    context.emitEvent({
      eventType: "stage.started",
      stageId,
      stageName: stage.name,
    });

    if (this.isCircuitOpen(stageId)) {
      if (this.config.fallbackToRules && stage.fallback) {
        try {
          const fallbackResult = await stage.fallback(input, context);
          const qualityGate = stage.validate(fallbackResult);
          
          return StageResultSchema.parse({
            stageId,
            stageName: stage.name,
            status: "completed" as StageStatus,
            startedAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startTime,
            output: fallbackResult,
            qualityGate,
          });
        } catch (fallbackError: any) {
          return this.createFailedResult(stageId, stage.name, fallbackError, startTime, retryCount);
        }
      }
      
      return this.createFailedResult(stageId, stage.name, new Error("Circuit breaker open"), startTime, 0);
    }

    const cacheKey = this.getCacheKey(stageId, input);
    if (config.enableSemanticCache) {
      const cached = this.semanticCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < config.cacheTTLSeconds * 1000) {
        context.emitEvent({
          eventType: "stage.completed",
          stageId,
          stageName: stage.name,
          message: "Cache hit",
        });
        
        return StageResultSchema.parse({
          stageId,
          stageName: stage.name,
          status: "completed" as StageStatus,
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          output: cached.result,
          qualityGate: stage.validate(cached.result),
        });
      }
    }

    while (retryCount <= config.maxRetries) {
      try {
        let timeoutTimer: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutTimer = setTimeout(() => reject(new Error(`Stage ${stageId} timed out`)), config.timeoutMs);
        });

        const executePromise = stage.execute(input, context);
        const output = await Promise.race([executePromise, timeoutPromise]);
        clearTimeout(timeoutTimer!);

        const qualityGate = stage.validate(output);

        this.resetCircuitBreaker(stageId);

        if (config.enableSemanticCache) {
          this.semanticCache.set(cacheKey, { result: output, timestamp: Date.now() });
        }

        context.emitEvent({
          eventType: "stage.completed",
          stageId,
          stageName: stage.name,
          message: `Completed in ${Date.now() - startTime}ms`,
        });

        return StageResultSchema.parse({
          stageId,
          stageName: stage.name,
          status: "completed" as StageStatus,
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          retryCount,
          output,
          qualityGate,
        });

      } catch (error: any) {
        lastError = error;
        retryCount++;

        if (retryCount <= config.maxRetries) {
          const delay = config.retryDelayMs * Math.pow(config.retryBackoffMultiplier, retryCount - 1);
          
          context.emitEvent({
            eventType: "stage.retrying",
            stageId,
            stageName: stage.name,
            message: `Retry ${retryCount}/${config.maxRetries} after ${delay}ms`,
          });

          await this.sleep(delay);
        }
      }
    }

    this.recordCircuitBreakerFailure(stageId);

    if (this.config.fallbackToRules && stage.fallback) {
      try {
        context.emitEvent({
          eventType: "stage.progress",
          stageId,
          stageName: stage.name,
          message: "Using fallback",
        });

        const fallbackResult = await stage.fallback(input, context);
        const qualityGate = stage.validate(fallbackResult);

        return StageResultSchema.parse({
          stageId,
          stageName: stage.name,
          status: "completed" as StageStatus,
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          retryCount,
          output: fallbackResult,
          qualityGate,
        });
      } catch (fallbackError: any) {
        lastError = fallbackError;
      }
    }

    context.emitEvent({
      eventType: "stage.failed",
      stageId,
      stageName: stage.name,
      message: lastError?.message || "Unknown error",
    });

    return this.createFailedResult(stageId, stage.name, lastError!, startTime, retryCount);
  }

  private createFailedResult(stageId: string, stageName: string, error: Error, startTime: number, retryCount: number): StageResult {
    return StageResultSchema.parse({
      stageId,
      stageName,
      status: "failed" as StageStatus,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      retryCount,
      error: {
        code: "STAGE_FAILED",
        message: error.message,
        retryable: false,
      },
    });
  }

  private getStageConfig(stageId: StageId): StageConfig {
    const overrides = this.config.stageConfigs?.[stageId] || {};
    return StageConfigSchema.parse({ ...DEFAULT_STAGE_CONFIG, ...overrides });
  }

  private getStatusForStage(stageId: StageId): PipelineState["status"] {
    const statusMap: Record<StageId, PipelineState["status"]> = {
      planner: "planning",
      evidence: "gathering",
      analyzer: "analyzing",
      normalizer: "analyzing",
      writer: "writing",
      claims: "writing",
      verifier: "verifying",
      critic: "verifying",
      assembler: "assembling",
    };
    return statusMap[stageId] || "initializing";
  }

  private getStageInput(stageId: StageId): any {
    if (!this.state) return null;
    
    switch (stageId) {
      case "planner":
        return { query: this.state.query, locale: this.state.locale };
      case "evidence":
        return { plan: this.state.plan, query: this.state.query };
      case "analyzer":
        return { evidence: this.state.evidence, sources: this.state.sources };
      case "normalizer":
        return { facts: this.state.facts, locale: this.state.locale };
      case "writer":
        return { plan: this.state.plan, facts: this.state.facts, evidence: this.state.evidence };
      case "claims":
        return { sections: this.state.sections };
      case "verifier":
        return { claims: this.state.claims, evidence: this.state.evidence };
      case "critic":
        return { sections: this.state.sections, claims: this.state.claims, facts: this.state.facts };
      case "assembler":
        return { plan: this.state.plan, sections: this.state.sections };
      default:
        return {};
    }
  }

  private applyStageOutput(stageId: StageId, output: any): void {
    if (!this.state || !output) return;
    
    switch (stageId) {
      case "planner":
        this.state.plan = output as DocumentPlan;
        break;
      case "evidence":
        this.state.sources = output.sources || [];
        this.state.evidence = output.evidence || [];
        break;
      case "analyzer":
        this.state.facts = [...this.state.facts, ...(output.facts || [])];
        break;
      case "normalizer":
        this.state.facts = output.normalizedFacts || this.state.facts;
        break;
      case "writer":
        this.state.sections = output.sections || [];
        break;
      case "claims":
        this.state.claims = output.claims || [];
        break;
      case "verifier":
        this.state.claims = output.verifiedClaims || this.state.claims;
        break;
      case "critic":
        break;
      case "assembler":
        if (output.artifact) {
          this.state.artifacts.push(output.artifact);
        }
        break;
    }
  }

  private detectGaps(stageId: StageId, qualityGate: QualityGateResult): GAP[] {
    const gaps: GAP[] = [];
    
    for (const issue of qualityGate.issues) {
      if (issue.severity === "error") {
        gaps.push(GAPSchema.parse({
          id: uuidv4(),
          type: this.issueToGapType(issue.message),
          missing: issue.message,
          question: this.generateGapQuestion(issue.message),
          priority: "high",
          suggestedAction: this.suggestGapAction(stageId, issue.message),
        }));
      }
    }
    
    return gaps;
  }

  private issueToGapType(message: string): GAP["type"] {
    if (message.toLowerCase().includes("citation")) return "weak_citation";
    if (message.toLowerCase().includes("evidence")) return "missing_evidence";
    if (message.toLowerCase().includes("claim")) return "unverified_claim";
    if (message.toLowerCase().includes("section")) return "incomplete_section";
    return "data_inconsistency";
  }

  private generateGapQuestion(message: string): string {
    return `How can we resolve: ${message}?`;
  }

  private suggestGapAction(stageId: StageId, _message: string): GAP["suggestedAction"] {
    if (stageId === "evidence" || stageId === "verifier") return "re_retrieve";
    if (stageId === "planner") return "re_plan";
    return "fallback";
  }

  private async handleGaps(gaps: GAP[], context: StageContext): Promise<void> {
    for (const gap of gaps) {
      if (gap.suggestedAction === "re_retrieve") {
        const evidenceStage = this.stages.get("evidence");
        if (evidenceStage) {
          await this.executeStageWithResilience(
            "evidence",
            evidenceStage,
            { query: gap.question, plan: this.state?.plan },
            context
          );
        }
      }
      
      gap.resolvedAt = new Date().toISOString();
      context.emitEvent({ eventType: "gap.resolved", data: gap });
    }
  }

  private enforceClaimVerificationPolicy(
    emitEvent: (event: Omit<PipelineEvent, "runId" | "timestamp">) => void
  ): { passed: boolean; reason?: string } {
    if (!this.state) return { passed: false, reason: "No pipeline state" };
    
    const claims = this.state.claims;
    const claimsRequiringCitation = claims.filter(c => c.requiresCitation);
    const verifiedClaims = claimsRequiringCitation.filter(c => c.verified);
    const unverifiedClaims = claimsRequiringCitation.filter(c => !c.verified);
    
    if (claimsRequiringCitation.length === 0) {
      return { passed: true };
    }
    
    const verificationRate = verifiedClaims.length / claimsRequiringCitation.length;
    const minVerificationRate = this.config.minClaimVerificationRate || 0.5;
    
    emitEvent({
      eventType: "stage.progress",
      stageId: "assembler",
      stageName: "Pre-Assembly Verification",
      progress: 0,
      message: `Claim verification: ${verifiedClaims.length}/${claimsRequiringCitation.length} (${(verificationRate * 100).toFixed(0)}%)`,
    });
    
    if (verificationRate < minVerificationRate) {
      for (const claim of unverifiedClaims.slice(0, 5)) {
        this.state.gaps.push(GAPSchema.parse({
          id: uuidv4(),
          type: "unverified_claim",
          missing: `Citation for: ${claim.text.slice(0, 100)}`,
          question: `What source supports: "${claim.text.slice(0, 100)}"?`,
          claimId: claim.id,
          sectionId: claim.sectionId,
          priority: "critical",
          suggestedAction: "re_retrieve",
        }));
      }
      
      emitEvent({
        eventType: "quality_gate.failed",
        stageId: "pre_assembler_check",
        stageName: "Claim Verification Policy",
        data: {
          gateId: "claim_verification_policy",
          gateName: "Claim Verification Policy",
          passed: false,
          score: verificationRate,
          threshold: minVerificationRate,
          issues: [
            { severity: "error", message: `${unverifiedClaims.length} claims require citations but lack verification` }
          ],
          checkedAt: new Date().toISOString(),
        },
      });
      
      return { 
        passed: false, 
        reason: `Verification rate ${(verificationRate * 100).toFixed(0)}% below minimum ${(minVerificationRate * 100).toFixed(0)}%. ${unverifiedClaims.length} claims unverified.`
      };
    }
    
    emitEvent({
      eventType: "quality_gate.passed",
      stageId: "pre_assembler_check",
      stageName: "Claim Verification Policy",
      data: {
        gateId: "claim_verification_policy",
        gateName: "Claim Verification Policy",
        passed: true,
        score: verificationRate,
        threshold: minVerificationRate,
        issues: [],
        checkedAt: new Date().toISOString(),
      },
    });
    
    return { passed: true };
  }

  private canContinueAfterFailure(stageId: StageId): boolean {
    const criticalStages: StageId[] = ["planner", "assembler"];
    return !criticalStages.includes(stageId);
  }

  private isCircuitOpen(stageId: string): boolean {
    const state = this.circuitBreakers.get(stageId);
    if (!state?.isOpen) return false;
    
    const config = this.getStageConfig(stageId as StageId);
    if (Date.now() - state.lastFailure > config.circuitBreakerResetMs) {
      state.isOpen = false;
      state.failures = 0;
      return false;
    }
    
    return true;
  }

  private recordCircuitBreakerFailure(stageId: string): void {
    const config = this.getStageConfig(stageId as StageId);
    let state = this.circuitBreakers.get(stageId);
    
    if (!state) {
      state = { failures: 0, lastFailure: 0, isOpen: false };
      this.circuitBreakers.set(stageId, state);
    }
    
    state.failures++;
    state.lastFailure = Date.now();
    
    if (state.failures >= config.circuitBreakerThreshold) {
      state.isOpen = true;
    }
  }

  private resetCircuitBreaker(stageId: string): void {
    this.circuitBreakers.delete(stageId);
  }

  private getCacheKey(stageId: string, input: any): string {
    const crypto = require("crypto");
    const hash = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
    return `${stageId}:${hash}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const wordOrchestrator = new WordAgentOrchestrator();
