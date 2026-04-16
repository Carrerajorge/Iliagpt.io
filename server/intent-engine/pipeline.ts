import { 
  PipelineContext, 
  NormalizedInput, 
  IntentClassification, 
  Constraints,
  StructuredOutput,
  ResolverResult,
  QualityCheckResult,
  SessionState
} from './types';
import { normalizer } from './normalizer';
import { intentClassifier } from './intent-classifier';
import { constraintExtractor } from './constraint-extractor';
import { resolveWithIntent, getResolver } from './resolvers';
import { qualityGate } from './quality-gate';
import { selfHealEngine } from './self-heal';
import { stateManager } from './state-manager';

export interface PipelineResult {
  success: boolean;
  output: StructuredOutput | null;
  rawResponse?: string;
  context: PipelineContext;
  qualityScore: number;
  repairAttempts: number;
  processingTimeMs: number;
  error?: string;
}

export interface PipelineOptions {
  sessionId: string;
  userId: string;
  skipQualityGate?: boolean;
  skipSelfHeal?: boolean;
  forceIntent?: string;
}

export class IntentEnginePipeline {
  async process(input: string, options: PipelineOptions): Promise<PipelineResult> {
    const startTime = Date.now();

    try {
      let session = stateManager.getSession(options.sessionId);
      if (!session) {
        session = stateManager.createSession(options.sessionId, options.userId);
      }

      const normalizedInput = normalizer.normalize(input);

      const intentClassification = intentClassifier.classify(normalizedInput);

      const constraints = constraintExtractor.extract(normalizedInput, intentClassification);
      
      const mergedConstraints = constraintExtractor.mergeWithPrevious(
        constraints, 
        session.constraints
      );

      if (stateManager.detectTopicChange(session, mergedConstraints.domain)) {
        stateManager.resetConstraints(options.sessionId);
      } else {
        stateManager.updateConstraints(options.sessionId, mergedConstraints);
      }

      const context: PipelineContext = {
        sessionState: session,
        normalizedInput,
        intentClassification,
        constraints: mergedConstraints,
        repairAttempts: []
      };

      const resolver = getResolver(intentClassification.intent);
      
      if (!resolver) {
        return this.createFallbackResponse(context, startTime, 
          `No resolver for intent: ${intentClassification.intent}`);
      }

      const resolverResult = await resolveWithIntent(context);
      context.resolverResult = resolverResult;

      if (!resolverResult.success) {
        return this.createFallbackResponse(context, startTime, resolverResult.rawOutput);
      }

      if (options.skipQualityGate) {
        return this.createSuccessResponse(context, resolverResult.data, startTime, 1.0, 0);
      }

      const qualityResult = qualityGate.verify(resolverResult.data, mergedConstraints, context);
      context.qualityResult = qualityResult;

      if (qualityResult.passed) {
        stateManager.addTurn(options.sessionId, {
          role: 'user',
          content: input,
          intent: intentClassification.intent,
          timestamp: new Date()
        });

        return this.createSuccessResponse(
          context, 
          resolverResult.data, 
          startTime, 
          qualityResult.score, 
          0
        );
      }

      if (options.skipSelfHeal) {
        return this.createSuccessResponse(
          context, 
          resolverResult.data, 
          startTime, 
          qualityResult.score, 
          0
        );
      }

      const repairResult = await selfHealEngine.repair(context, resolverResult.data, qualityResult);
      context.repairAttempts = repairResult.attempts;

      stateManager.addTurn(options.sessionId, {
        role: 'user',
        content: input,
        intent: intentClassification.intent,
        timestamp: new Date()
      });

      const finalQuality = qualityGate.verify(repairResult.result, mergedConstraints, context);

      return this.createSuccessResponse(
        context,
        repairResult.result,
        startTime,
        finalQuality.score,
        repairResult.attempts.length
      );

    } catch (error) {
      return {
        success: false,
        output: null,
        context: {} as PipelineContext,
        qualityScore: 0,
        repairAttempts: 0,
        processingTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private createSuccessResponse(
    context: PipelineContext,
    output: StructuredOutput,
    startTime: number,
    qualityScore: number,
    repairAttempts: number
  ): PipelineResult {
    return {
      success: true,
      output,
      context,
      qualityScore,
      repairAttempts,
      processingTimeMs: Date.now() - startTime
    };
  }

  private createFallbackResponse(
    context: PipelineContext,
    startTime: number,
    error?: string
  ): PipelineResult {
    return {
      success: false,
      output: null,
      context,
      qualityScore: 0,
      repairAttempts: 0,
      processingTimeMs: Date.now() - startTime,
      error
    };
  }

  async analyzeOnly(input: string): Promise<{
    normalizedInput: NormalizedInput;
    intent: IntentClassification;
    constraints: Constraints;
  }> {
    const normalizedInput = normalizer.normalize(input);
    const intent = intentClassifier.classify(normalizedInput);
    const constraints = constraintExtractor.extract(normalizedInput, intent);

    return {
      normalizedInput,
      intent,
      constraints
    };
  }

  getSessionState(sessionId: string): SessionState | null {
    return stateManager.getSession(sessionId);
  }

  resetSession(sessionId: string): void {
    stateManager.deleteSession(sessionId);
  }
}

export const intentEnginePipeline = new IntentEnginePipeline();
