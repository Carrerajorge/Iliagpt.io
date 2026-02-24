/**
 * Cognitive Architecture Module
 *
 * Unified cognitive system providing reasoning, planning, and memory capabilities
 * for the super-intelligence layer.
 */

import { reasoningEngine, ReasoningEngine } from './ReasoningEngine';
import { planningEngine, PlanningEngine } from './PlanningEngine';
import { memoryHierarchy, MemoryHierarchy } from './MemoryHierarchy';

// Re-export all components
export * from './ReasoningEngine';
export * from './PlanningEngine';
export * from './MemoryHierarchy';

// Types for cognitive processing
export interface CognitiveContext {
  userId: string;
  sessionId: string;
  query: string;
  intent?: string;
  entities?: Record<string, any>;
  emotionalState?: {
    primary: string;
    intensity: number;
  };
  userProfile?: {
    expertise: string;
    preferences: Record<string, any>;
  };
  conversationHistory?: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }>;
}

export interface CognitiveResult {
  understanding: {
    interpretedQuery: string;
    keyPoints: string[];
    ambiguities: string[];
  };
  reasoning: {
    approach: string;
    steps: Array<{
      step: number;
      description: string;
      result: any;
    }>;
    confidence: number;
  };
  plan: {
    id: string;
    tasks: Array<{
      id: string;
      name: string;
      status: string;
    }>;
    estimatedSteps: number;
  };
  response: {
    content: string;
    type: 'direct' | 'exploratory' | 'clarification' | 'action';
    followUp?: string[];
  };
  metadata: {
    processingTime: number;
    memoryUpdates: number;
    reasoningDepth: number;
  };
}

export interface ThinkingProcess {
  phase: 'understanding' | 'reasoning' | 'planning' | 'synthesis';
  thoughts: string[];
  decisions: Array<{
    decision: string;
    rationale: string;
    alternatives: string[];
  }>;
  uncertainties: Array<{
    aspect: string;
    level: number;
    mitigation: string;
  }>;
}

/**
 * CognitiveCore - Unified cognitive processing system
 * Integrates reasoning, planning, and memory into a coherent thinking system
 */
export class CognitiveCore {
  private reasoning: ReasoningEngine;
  private planning: PlanningEngine;
  private memory: MemoryHierarchy;
  private processingHistory: Map<string, CognitiveResult[]>;
  private thinkingTraces: Map<string, ThinkingProcess[]>;

  constructor() {
    this.reasoning = reasoningEngine;
    this.planning = planningEngine;
    this.memory = memoryHierarchy;
    this.processingHistory = new Map();
    this.thinkingTraces = new Map();
  }

  /**
   * Main cognitive processing pipeline
   */
  async process(context: CognitiveContext): Promise<CognitiveResult> {
    const startTime = Date.now();
    const thinkingTrace: ThinkingProcess[] = [];

    try {
      // Phase 1: Understanding
      thinkingTrace.push({
        phase: 'understanding',
        thoughts: [
          `Analyzing query: "${context.query}"`,
          `User context: ${context.userId}, session: ${context.sessionId}`,
          context.intent ? `Detected intent: ${context.intent}` : 'Intent not provided'
        ],
        decisions: [],
        uncertainties: []
      });

      const understanding = await this.understand(context);

      // Phase 2: Memory retrieval
      const relevantMemories = await this.retrieveRelevantMemories(context);

      // Phase 3: Reasoning
      thinkingTrace.push({
        phase: 'reasoning',
        thoughts: [
          `Retrieved ${relevantMemories.length} relevant memories`,
          'Initiating reasoning chain...'
        ],
        decisions: [],
        uncertainties: []
      });

      const reasoningResult = await this.reason(context, understanding, relevantMemories);

      // Phase 4: Planning
      thinkingTrace.push({
        phase: 'planning',
        thoughts: [
          `Reasoning confidence: ${reasoningResult.confidence}`,
          'Creating execution plan...'
        ],
        decisions: [],
        uncertainties: []
      });

      const planResult = await this.plan(context, reasoningResult);

      // Phase 5: Synthesis
      thinkingTrace.push({
        phase: 'synthesis',
        thoughts: [
          `Plan created with ${planResult.tasks.length} tasks`,
          'Synthesizing response...'
        ],
        decisions: [{
          decision: 'Response type selection',
          rationale: this.determineResponseType(understanding, reasoningResult),
          alternatives: ['direct', 'exploratory', 'clarification', 'action']
        }],
        uncertainties: []
      });

      const response = await this.synthesize(context, understanding, reasoningResult, planResult);

      // Update memory with this interaction
      await this.updateMemory(context, understanding, reasoningResult, response);

      const result: CognitiveResult = {
        understanding,
        reasoning: {
          approach: reasoningResult.approach || 'hybrid',
          steps: reasoningResult.steps || [],
          confidence: reasoningResult.confidence
        },
        plan: {
          id: planResult.id,
          tasks: planResult.tasks,
          estimatedSteps: planResult.tasks.length
        },
        response,
        metadata: {
          processingTime: Date.now() - startTime,
          memoryUpdates: 1,
          reasoningDepth: reasoningResult.steps?.length || 0
        }
      };

      // Store processing history
      this.storeProcessingHistory(context.sessionId, result);
      this.thinkingTraces.set(context.sessionId, thinkingTrace);

      return result;
    } catch (error) {
      console.error('[CognitiveCore] Processing error:', error);
      throw error;
    }
  }

  /**
   * Understanding phase - Interpret and analyze the query
   */
  private async understand(context: CognitiveContext): Promise<CognitiveResult['understanding']> {
    const keyPoints: string[] = [];
    const ambiguities: string[] = [];

    // Extract key points from query
    const words = context.query.toLowerCase().split(/\s+/);
    const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'which', 'qué', 'cómo', 'por qué', 'cuándo', 'dónde', 'quién'];
    const actionWords = ['create', 'make', 'build', 'fix', 'update', 'delete', 'change', 'add', 'remove', 'crear', 'hacer', 'construir', 'arreglar', 'actualizar'];

    // Identify question type
    const isQuestion = questionWords.some(w => words.includes(w)) || context.query.includes('?');
    const isAction = actionWords.some(w => words.some(word => word.startsWith(w)));

    if (isQuestion) {
      keyPoints.push('Query is a question seeking information');
    }
    if (isAction) {
      keyPoints.push('Query requests an action to be performed');
    }

    // Check for ambiguities
    const pronouns = ['it', 'this', 'that', 'they', 'them', 'esto', 'eso', 'ellos'];
    const usedPronouns = pronouns.filter(p => words.includes(p));
    if (usedPronouns.length > 0 && !context.conversationHistory?.length) {
      ambiguities.push(`Unclear reference: "${usedPronouns.join(', ')}" without prior context`);
    }

    // Extract entities if provided
    if (context.entities && Object.keys(context.entities).length > 0) {
      keyPoints.push(`Identified entities: ${Object.keys(context.entities).join(', ')}`);
    }

    return {
      interpretedQuery: context.query,
      keyPoints,
      ambiguities
    };
  }

  /**
   * Retrieve relevant memories for the context
   */
  private async retrieveRelevantMemories(context: CognitiveContext): Promise<any[]> {
    const memories: any[] = [];

    // Search in different memory tiers
    const tiers: Array<'working' | 'short_term' | 'long_term' | 'episodic' | 'semantic'> =
      ['working', 'short_term', 'episodic', 'semantic'];

    for (const tier of tiers) {
      const tierMemories = await this.memory.search(context.userId, context.query, {
        tier,
        limit: 5
      });
      memories.push(...tierMemories);
    }

    // Sort by relevance
    return memories.sort((a, b) => (b.relevance || 0) - (a.relevance || 0)).slice(0, 10);
  }

  /**
   * Reasoning phase - Apply logical reasoning to understand and solve
   */
  private async reason(
    context: CognitiveContext,
    understanding: CognitiveResult['understanding'],
    memories: any[]
  ): Promise<any> {
    // Build reasoning context
    const reasoningContext = {
      query: context.query,
      understanding,
      memories: memories.map(m => m.content).slice(0, 5),
      userProfile: context.userProfile
    };

    // Determine reasoning type based on query
    let reasoningType: 'deductive' | 'inductive' | 'abductive' | 'causal' = 'deductive';

    const queryLower = context.query.toLowerCase();
    if (queryLower.includes('why') || queryLower.includes('por qué') || queryLower.includes('causa')) {
      reasoningType = 'causal';
    } else if (queryLower.includes('might') || queryLower.includes('could') || queryLower.includes('podría')) {
      reasoningType = 'abductive';
    } else if (queryLower.includes('pattern') || queryLower.includes('trend') || queryLower.includes('patrón')) {
      reasoningType = 'inductive';
    }

    // Execute reasoning
    const result = await this.reasoning.reason({
      type: reasoningType,
      premises: [
        { type: 'fact', content: `User query: ${context.query}` },
        ...memories.slice(0, 3).map(m => ({ type: 'fact' as const, content: m.content }))
      ],
      goal: 'Provide accurate and helpful response',
      context: reasoningContext
    });

    return {
      approach: reasoningType,
      steps: result.chain?.steps || [],
      confidence: result.confidence || 0.7,
      conclusion: result.conclusion
    };
  }

  /**
   * Planning phase - Create execution plan if needed
   */
  private async plan(context: CognitiveContext, reasoningResult: any): Promise<any> {
    // Determine if planning is needed
    const needsPlanning = this.requiresPlanning(context.query, reasoningResult);

    if (!needsPlanning) {
      return {
        id: `plan_${Date.now()}`,
        tasks: [{
          id: `task_${Date.now()}`,
          name: 'Direct response',
          status: 'ready'
        }],
        estimatedSteps: 1
      };
    }

    // Create a plan for complex tasks
    const planResult = await this.planning.createPlan({
      goal: context.query,
      context: {
        userId: context.userId,
        reasoning: reasoningResult
      },
      constraints: {
        maxSteps: 10,
        timeLimit: 30000
      }
    });

    return {
      id: planResult.id,
      tasks: planResult.tasks.map(t => ({
        id: t.id,
        name: t.name,
        status: t.status
      })),
      estimatedSteps: planResult.tasks.length
    };
  }

  /**
   * Determine if query requires planning
   */
  private requiresPlanning(query: string, reasoningResult: any): boolean {
    const complexityIndicators = [
      'step by step', 'paso a paso',
      'multiple', 'varios', 'múltiples',
      'then', 'después', 'luego',
      'first', 'primero',
      'create', 'build', 'implement', 'crear', 'construir', 'implementar'
    ];

    const queryLower = query.toLowerCase();
    const hasComplexityIndicator = complexityIndicators.some(i => queryLower.includes(i));
    const lowConfidence = reasoningResult.confidence < 0.6;

    return hasComplexityIndicator || lowConfidence;
  }

  /**
   * Synthesis phase - Generate final response
   */
  private async synthesize(
    context: CognitiveContext,
    understanding: CognitiveResult['understanding'],
    reasoningResult: any,
    planResult: any
  ): Promise<CognitiveResult['response']> {
    const responseType = this.determineResponseTypeEnum(understanding, reasoningResult);

    // Build response content based on type
    let content = '';
    const followUp: string[] = [];

    if (understanding.ambiguities.length > 0 && responseType === 'clarification') {
      content = `I need some clarification: ${understanding.ambiguities.join('; ')}`;
      followUp.push('Could you provide more context?');
    } else if (responseType === 'action') {
      content = `I'll help you with that. Here's the plan:\n${planResult.tasks.map((t: any, i: number) => `${i + 1}. ${t.name}`).join('\n')}`;
      followUp.push('Should I proceed with this plan?');
    } else if (responseType === 'exploratory') {
      content = reasoningResult.conclusion || 'Let me explore this further...';
      followUp.push('Would you like me to go deeper into any aspect?');
    } else {
      content = reasoningResult.conclusion || 'Based on my analysis...';
    }

    return {
      content,
      type: responseType,
      followUp: followUp.length > 0 ? followUp : undefined
    };
  }

  /**
   * Determine response type description
   */
  private determineResponseType(understanding: CognitiveResult['understanding'], reasoningResult: any): string {
    if (understanding.ambiguities.length > 0) {
      return 'clarification needed due to ambiguities';
    }
    if (reasoningResult.confidence < 0.5) {
      return 'exploratory response due to uncertainty';
    }
    if (reasoningResult.approach === 'causal') {
      return 'explanatory response';
    }
    return 'direct response';
  }

  /**
   * Determine response type enum
   */
  private determineResponseTypeEnum(
    understanding: CognitiveResult['understanding'],
    reasoningResult: any
  ): 'direct' | 'exploratory' | 'clarification' | 'action' {
    if (understanding.ambiguities.length > 0) {
      return 'clarification';
    }
    if (understanding.keyPoints.some(kp => kp.includes('action'))) {
      return 'action';
    }
    if (reasoningResult.confidence < 0.5) {
      return 'exploratory';
    }
    return 'direct';
  }

  /**
   * Update memory with interaction
   */
  private async updateMemory(
    context: CognitiveContext,
    understanding: CognitiveResult['understanding'],
    reasoningResult: any,
    response: CognitiveResult['response']
  ): Promise<void> {
    // Store in episodic memory
    await this.memory.store(context.userId, {
      type: 'episodic',
      content: JSON.stringify({
        query: context.query,
        understanding: understanding.keyPoints,
        response: response.content,
        confidence: reasoningResult.confidence
      }),
      metadata: {
        sessionId: context.sessionId,
        intent: context.intent,
        timestamp: Date.now()
      }
    });

    // If high confidence reasoning, store in semantic memory
    if (reasoningResult.confidence > 0.8 && reasoningResult.conclusion) {
      await this.memory.store(context.userId, {
        type: 'semantic',
        content: reasoningResult.conclusion,
        metadata: {
          source: 'reasoning',
          confidence: reasoningResult.confidence
        }
      });
    }
  }

  /**
   * Store processing history for session
   */
  private storeProcessingHistory(sessionId: string, result: CognitiveResult): void {
    const history = this.processingHistory.get(sessionId) || [];
    history.push(result);

    // Keep last 50 results per session
    if (history.length > 50) {
      history.shift();
    }

    this.processingHistory.set(sessionId, history);
  }

  /**
   * Get processing history for session
   */
  getProcessingHistory(sessionId: string): CognitiveResult[] {
    return this.processingHistory.get(sessionId) || [];
  }

  /**
   * Get thinking trace for debugging
   */
  getThinkingTrace(sessionId: string): ThinkingProcess[] {
    return this.thinkingTraces.get(sessionId) || [];
  }

  /**
   * Quick response for simple queries
   */
  async quickProcess(userId: string, query: string): Promise<string> {
    const result = await this.process({
      userId,
      sessionId: `quick_${Date.now()}`,
      query
    });

    return result.response.content;
  }

  /**
   * Get cognitive system stats
   */
  getStats(): {
    totalSessions: number;
    totalProcessed: number;
    memoryStats: any;
  } {
    let totalProcessed = 0;
    this.processingHistory.forEach(history => {
      totalProcessed += history.length;
    });

    return {
      totalSessions: this.processingHistory.size,
      totalProcessed,
      memoryStats: this.memory.getStats()
    };
  }
}

// Export singleton instance
export const cognitiveCore = new CognitiveCore();

// Export instances
export { reasoningEngine, planningEngine, memoryHierarchy };

/**
 * Initialize the cognitive system
 */
export async function initializeCognitiveSystem(): Promise<void> {
  console.log('[CognitiveSystem] Initializing cognitive architecture...');

  // Initialize sub-components
  await reasoningEngine.initialize?.();
  await planningEngine.initialize?.();
  await memoryHierarchy.initialize?.();

  console.log('[CognitiveSystem] Cognitive architecture initialized');
  console.log('[CognitiveSystem] - ReasoningEngine: ready');
  console.log('[CognitiveSystem] - PlanningEngine: ready');
  console.log('[CognitiveSystem] - MemoryHierarchy: ready');
  console.log('[CognitiveSystem] - CognitiveCore: ready');
}
