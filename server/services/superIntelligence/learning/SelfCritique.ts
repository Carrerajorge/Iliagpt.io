/**
 * Self-Critique - RLAIF (Reinforcement Learning from AI Feedback)
 *
 * Enables the AI to evaluate and improve its own responses through
 * systematic self-assessment and iterative refinement.
 */

import { EventEmitter } from 'events';
import { rewardModel, RewardPrediction } from './RewardModel';

// Critique dimensions
export type CritiqueDimension =
  | 'accuracy'      // Factual correctness
  | 'completeness'  // Coverage of the topic
  | 'clarity'       // Ease of understanding
  | 'relevance'     // Pertinence to the query
  | 'helpfulness'   // Practical usefulness
  | 'safety'        // Avoidance of harmful content
  | 'conciseness'   // Appropriate length
  | 'coherence'     // Logical flow
  | 'engagement'    // User interest
  | 'technical';    // Technical accuracy

// Critique result
export interface CritiqueResult {
  id: string;
  query: string;
  response: string;
  overallScore: number;
  dimensionScores: Record<CritiqueDimension, {
    score: number;
    reasoning: string;
    suggestions: string[];
  }>;
  strengths: string[];
  weaknesses: string[];
  improvementSuggestions: string[];
  revisedResponse?: string;
  confidence: number;
  timestamp: number;
}

// Critique policy
export interface CritiquePolicy {
  dimensions: CritiqueDimension[];
  weights: Partial<Record<CritiqueDimension, number>>;
  minAcceptableScore: number;
  maxIterations: number;
  improvementThreshold: number;
}

// Revision iteration
export interface RevisionIteration {
  iteration: number;
  originalScore: number;
  newScore: number;
  improvement: number;
  changes: string[];
  response: string;
}

// Constitutional principle (for Constitutional AI)
export interface ConstitutionalPrinciple {
  id: string;
  name: string;
  description: string;
  category: 'harmlessness' | 'helpfulness' | 'honesty';
  evaluationPrompt: string;
  revisionPrompt: string;
  weight: number;
}

/**
 * SelfCritique - AI self-evaluation system
 */
export class SelfCritique extends EventEmitter {
  private defaultPolicy: CritiquePolicy;
  private principles: Map<string, ConstitutionalPrinciple>;
  private critiqueHistory: Map<string, CritiqueResult>;
  private revisionHistory: Map<string, RevisionIteration[]>;

  constructor() {
    super();
    this.defaultPolicy = this.getDefaultPolicy();
    this.principles = new Map();
    this.critiqueHistory = new Map();
    this.revisionHistory = new Map();

    // Initialize constitutional principles
    this.initializeConstitutionalPrinciples();
  }

  /**
   * Get default critique policy
   */
  private getDefaultPolicy(): CritiquePolicy {
    return {
      dimensions: [
        'accuracy', 'completeness', 'clarity', 'relevance',
        'helpfulness', 'safety', 'conciseness', 'coherence'
      ],
      weights: {
        accuracy: 0.20,
        completeness: 0.15,
        clarity: 0.15,
        relevance: 0.15,
        helpfulness: 0.15,
        safety: 0.10,
        conciseness: 0.05,
        coherence: 0.05
      },
      minAcceptableScore: 0.7,
      maxIterations: 3,
      improvementThreshold: 0.05
    };
  }

  /**
   * Initialize constitutional AI principles
   */
  private initializeConstitutionalPrinciples(): void {
    const principles: ConstitutionalPrinciple[] = [
      {
        id: 'harmless_1',
        name: 'Avoid Harmful Content',
        description: 'Response should not contain harmful, dangerous, or illegal content',
        category: 'harmlessness',
        evaluationPrompt: 'Does this response avoid harmful, dangerous, or illegal content?',
        revisionPrompt: 'Revise to remove any harmful, dangerous, or illegal content',
        weight: 1.5
      },
      {
        id: 'harmless_2',
        name: 'Avoid Bias',
        description: 'Response should be fair and avoid discrimination',
        category: 'harmlessness',
        evaluationPrompt: 'Is this response fair and free from discrimination or bias?',
        revisionPrompt: 'Revise to be more fair and balanced',
        weight: 1.2
      },
      {
        id: 'helpful_1',
        name: 'Be Helpful',
        description: 'Response should directly address the user\'s needs',
        category: 'helpfulness',
        evaluationPrompt: 'Does this response directly and helpfully address what the user asked?',
        revisionPrompt: 'Revise to be more helpful and directly address the query',
        weight: 1.3
      },
      {
        id: 'helpful_2',
        name: 'Be Practical',
        description: 'Response should provide actionable information',
        category: 'helpfulness',
        evaluationPrompt: 'Does this response provide practical, actionable information?',
        revisionPrompt: 'Revise to include more practical and actionable advice',
        weight: 1.1
      },
      {
        id: 'honest_1',
        name: 'Be Truthful',
        description: 'Response should be factually accurate',
        category: 'honesty',
        evaluationPrompt: 'Is this response factually accurate and truthful?',
        revisionPrompt: 'Revise to correct any factual inaccuracies',
        weight: 1.4
      },
      {
        id: 'honest_2',
        name: 'Acknowledge Uncertainty',
        description: 'Response should acknowledge when uncertain',
        category: 'honesty',
        evaluationPrompt: 'Does this response appropriately acknowledge uncertainty?',
        revisionPrompt: 'Revise to acknowledge limitations and uncertainties',
        weight: 1.0
      }
    ];

    for (const principle of principles) {
      this.principles.set(principle.id, principle);
    }
  }

  /**
   * Perform critique on a response
   */
  async critique(
    query: string,
    response: string,
    policy: Partial<CritiquePolicy> = {}
  ): Promise<CritiqueResult> {
    const mergedPolicy = { ...this.defaultPolicy, ...policy };
    const critiqueId = `critique_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Evaluate each dimension
    const dimensionScores: CritiqueResult['dimensionScores'] = {} as any;

    for (const dimension of mergedPolicy.dimensions) {
      const evaluation = this.evaluateDimension(query, response, dimension);
      dimensionScores[dimension] = evaluation;
    }

    // Calculate overall score
    let weightedSum = 0;
    let totalWeight = 0;

    for (const dimension of mergedPolicy.dimensions) {
      const weight = mergedPolicy.weights[dimension] || 0.1;
      weightedSum += dimensionScores[dimension].score * weight;
      totalWeight += weight;
    }

    const overallScore = weightedSum / totalWeight;

    // Identify strengths and weaknesses
    const strengths: string[] = [];
    const weaknesses: string[] = [];

    for (const dimension of mergedPolicy.dimensions) {
      const score = dimensionScores[dimension].score;
      if (score >= 0.8) {
        strengths.push(`Strong ${dimension}: ${dimensionScores[dimension].reasoning}`);
      } else if (score < 0.5) {
        weaknesses.push(`Weak ${dimension}: ${dimensionScores[dimension].reasoning}`);
      }
    }

    // Generate improvement suggestions
    const improvementSuggestions: string[] = [];

    for (const dimension of mergedPolicy.dimensions) {
      if (dimensionScores[dimension].score < 0.7) {
        improvementSuggestions.push(...dimensionScores[dimension].suggestions);
      }
    }

    // Get reward model prediction for confidence
    const rewardPrediction = rewardModel.predict(query, response);

    const result: CritiqueResult = {
      id: critiqueId,
      query,
      response,
      overallScore,
      dimensionScores,
      strengths,
      weaknesses,
      improvementSuggestions: improvementSuggestions.slice(0, 5),
      confidence: (overallScore + rewardPrediction.confidence) / 2,
      timestamp: Date.now()
    };

    this.critiqueHistory.set(critiqueId, result);
    this.emit('critique:completed', { critiqueId, overallScore });

    return result;
  }

  /**
   * Evaluate a single dimension
   */
  private evaluateDimension(
    query: string,
    response: string,
    dimension: CritiqueDimension
  ): { score: number; reasoning: string; suggestions: string[] } {
    switch (dimension) {
      case 'accuracy':
        return this.evaluateAccuracy(query, response);
      case 'completeness':
        return this.evaluateCompleteness(query, response);
      case 'clarity':
        return this.evaluateClarity(response);
      case 'relevance':
        return this.evaluateRelevance(query, response);
      case 'helpfulness':
        return this.evaluateHelpfulness(query, response);
      case 'safety':
        return this.evaluateSafety(response);
      case 'conciseness':
        return this.evaluateConciseness(query, response);
      case 'coherence':
        return this.evaluateCoherence(response);
      case 'engagement':
        return this.evaluateEngagement(response);
      case 'technical':
        return this.evaluateTechnical(query, response);
      default:
        return { score: 0.5, reasoning: 'Unable to evaluate', suggestions: [] };
    }
  }

  /**
   * Evaluate accuracy (heuristic-based)
   */
  private evaluateAccuracy(query: string, response: string): { score: number; reasoning: string; suggestions: string[] } {
    let score = 0.7; // Base score
    const suggestions: string[] = [];

    // Check for hedging language (good for accuracy)
    const hedgingPatterns = /\b(might|may|could|possibly|perhaps|generally|typically|usually|often|sometimes)\b/gi;
    const hedging = (response.match(hedgingPatterns) || []).length;

    if (hedging > 0) {
      score += 0.1;
    }

    // Check for absolute claims without evidence (bad for accuracy)
    const absolutePatterns = /\b(always|never|definitely|certainly|absolutely|impossible|guaranteed)\b/gi;
    const absolutes = (response.match(absolutePatterns) || []).length;

    if (absolutes > 2) {
      score -= 0.15;
      suggestions.push('Avoid absolute claims without evidence');
    }

    // Check for source references (good)
    const hasReferences = /\b(according to|research shows|studies indicate|documentation|official)\b/i.test(response);
    if (hasReferences) {
      score += 0.1;
    }

    score = Math.max(0, Math.min(1, score));

    return {
      score,
      reasoning: score >= 0.7 ? 'Response appears factually grounded' : 'Response may contain unsupported claims',
      suggestions
    };
  }

  /**
   * Evaluate completeness
   */
  private evaluateCompleteness(query: string, response: string): { score: number; reasoning: string; suggestions: string[] } {
    let score = 0.6;
    const suggestions: string[] = [];

    // Check if response addresses question words in query
    const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'which', 'qué', 'cómo', 'por qué'];
    const queryWords = query.toLowerCase().split(/\s+/);
    const hasQuestionWord = questionWords.some(qw => queryWords.includes(qw));

    if (hasQuestionWord) {
      // Check if response seems to answer the question type
      if (query.toLowerCase().includes('how') && (response.includes('step') || response.includes('1.') || response.includes('-'))) {
        score += 0.2;
      } else if (query.toLowerCase().includes('why') && (response.includes('because') || response.includes('reason') || response.includes('debido'))) {
        score += 0.2;
      } else {
        suggestions.push('Ensure the response type matches the question type');
      }
    }

    // Check response length relative to query complexity
    const queryLength = query.length;
    const responseLength = response.length;

    if (responseLength < queryLength) {
      score -= 0.1;
      suggestions.push('Response may be too brief for the query');
    } else if (responseLength > queryLength * 10) {
      score += 0.15;
    }

    // Check for multiple aspects covered
    const paragraphs = response.split(/\n\n+/);
    if (paragraphs.length >= 2) {
      score += 0.1;
    }

    score = Math.max(0, Math.min(1, score));

    return {
      score,
      reasoning: score >= 0.7 ? 'Response covers the topic adequately' : 'Response may be incomplete',
      suggestions
    };
  }

  /**
   * Evaluate clarity
   */
  private evaluateClarity(response: string): { score: number; reasoning: string; suggestions: string[] } {
    let score = 0.7;
    const suggestions: string[] = [];

    const words = response.split(/\s+/);
    const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);

    // Average sentence length
    const avgSentenceLength = words.length / Math.max(sentences.length, 1);

    if (avgSentenceLength > 30) {
      score -= 0.15;
      suggestions.push('Break up long sentences for better clarity');
    } else if (avgSentenceLength < 20) {
      score += 0.1;
    }

    // Check for structured elements
    const hasLists = /^[\-\*\d]+\./m.test(response);
    const hasHeaders = /^#+\s/m.test(response);
    const hasCodeBlocks = /```/.test(response);

    if (hasLists) score += 0.1;
    if (hasHeaders) score += 0.05;
    if (hasCodeBlocks) score += 0.05;

    // Check for jargon density
    const technicalPatterns = /\b[A-Z]{2,}\b/g; // Acronyms
    const acronyms = (response.match(technicalPatterns) || []).length;

    if (acronyms > 5) {
      score -= 0.1;
      suggestions.push('Consider explaining acronyms for clarity');
    }

    score = Math.max(0, Math.min(1, score));

    return {
      score,
      reasoning: score >= 0.7 ? 'Response is clear and well-structured' : 'Response could be clearer',
      suggestions
    };
  }

  /**
   * Evaluate relevance
   */
  private evaluateRelevance(query: string, response: string): { score: number; reasoning: string; suggestions: string[] } {
    let score = 0.5;
    const suggestions: string[] = [];

    // Check keyword overlap
    const queryKeywords = this.extractKeywords(query);
    const responseKeywords = this.extractKeywords(response);

    let matchCount = 0;
    for (const keyword of queryKeywords) {
      if (responseKeywords.has(keyword)) {
        matchCount++;
      }
    }

    const overlap = queryKeywords.size > 0 ? matchCount / queryKeywords.size : 0;
    score += overlap * 0.4;

    // Check if response starts with acknowledgment of question
    const startsRelevant = /^(yes|no|sure|certainly|to answer|the answer|regarding|about|para responder|sí|no)/i.test(response.trim());
    if (startsRelevant) {
      score += 0.1;
    }

    // Penalize very short or very long responses
    if (response.length < 50) {
      score -= 0.2;
      suggestions.push('Response may be too brief to be relevant');
    }

    score = Math.max(0, Math.min(1, score));

    return {
      score,
      reasoning: score >= 0.7 ? 'Response is relevant to the query' : 'Response may not fully address the query',
      suggestions
    };
  }

  /**
   * Evaluate helpfulness
   */
  private evaluateHelpfulness(query: string, response: string): { score: number; reasoning: string; suggestions: string[] } {
    let score = 0.6;
    const suggestions: string[] = [];

    // Check for actionable content
    const actionPatterns = /\b(you can|try|use|run|execute|install|configure|click|select|choose|puedes|intenta|usa|ejecuta)\b/gi;
    const actionCount = (response.match(actionPatterns) || []).length;

    if (actionCount >= 2) {
      score += 0.2;
    } else if (actionCount === 0) {
      suggestions.push('Add actionable suggestions or steps');
    }

    // Check for examples
    const hasExamples = /\b(for example|e\.g\.|such as|like this|here's|por ejemplo|como este)\b/i.test(response);
    if (hasExamples) {
      score += 0.1;
    }

    // Check for code examples
    const hasCode = /```/.test(response);
    if (hasCode && query.toLowerCase().match(/\b(code|program|script|function|error|bug|código|programar)\b/)) {
      score += 0.15;
    }

    // Check for helpful closing
    const helpfulClosing = /\b(hope this helps|let me know|feel free|happy to help|espero que ayude|avísame)\b/i.test(response);
    if (helpfulClosing) {
      score += 0.05;
    }

    score = Math.max(0, Math.min(1, score));

    return {
      score,
      reasoning: score >= 0.7 ? 'Response provides helpful information' : 'Response could be more helpful',
      suggestions
    };
  }

  /**
   * Evaluate safety
   */
  private evaluateSafety(response: string): { score: number; reasoning: string; suggestions: string[] } {
    let score = 1.0;
    const suggestions: string[] = [];

    // Check for potentially harmful content patterns
    const harmfulPatterns = [
      /\b(hack|exploit|attack|inject|bypass|crack)\b/i,
      /\b(kill|murder|harm|hurt|destroy|weapon)\b/i,
      /\b(hate|racist|sexist|discriminat)\b/i
    ];

    for (const pattern of harmfulPatterns) {
      if (pattern.test(response)) {
        score -= 0.3;
        suggestions.push('Review content for potentially harmful language');
      }
    }

    // Check for appropriate warnings in sensitive topics
    const sensitiveTopics = /\b(medical|legal|financial|security|health)\b/i.test(response);
    const hasDisclaimer = /\b(consult|professional|advice|disclaimer|not a substitute)\b/i.test(response);

    if (sensitiveTopics && !hasDisclaimer) {
      score -= 0.1;
      suggestions.push('Add appropriate disclaimers for sensitive topics');
    }

    score = Math.max(0, Math.min(1, score));

    return {
      score,
      reasoning: score >= 0.9 ? 'Response appears safe' : 'Response may contain concerning content',
      suggestions
    };
  }

  /**
   * Evaluate conciseness
   */
  private evaluateConciseness(query: string, response: string): { score: number; reasoning: string; suggestions: string[] } {
    let score = 0.7;
    const suggestions: string[] = [];

    const queryWords = query.split(/\s+/).length;
    const responseWords = response.split(/\s+/).length;

    // Ideal response length heuristic
    const idealMinWords = Math.max(20, queryWords * 2);
    const idealMaxWords = Math.max(200, queryWords * 20);

    if (responseWords < idealMinWords) {
      score -= 0.1;
      suggestions.push('Response may be too brief');
    } else if (responseWords > idealMaxWords) {
      score -= 0.15;
      suggestions.push('Consider making response more concise');
    } else {
      score += 0.1;
    }

    // Check for repetition
    const sentences = response.split(/[.!?]+/);
    const uniqueSentences = new Set(sentences.map(s => s.toLowerCase().trim()));
    const repetitionRatio = uniqueSentences.size / sentences.length;

    if (repetitionRatio < 0.8) {
      score -= 0.1;
      suggestions.push('Remove repetitive content');
    }

    score = Math.max(0, Math.min(1, score));

    return {
      score,
      reasoning: score >= 0.7 ? 'Response length is appropriate' : 'Response length could be improved',
      suggestions
    };
  }

  /**
   * Evaluate coherence
   */
  private evaluateCoherence(response: string): { score: number; reasoning: string; suggestions: string[] } {
    let score = 0.7;
    const suggestions: string[] = [];

    const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);

    if (sentences.length < 2) {
      return { score: 0.5, reasoning: 'Too short to evaluate coherence', suggestions: [] };
    }

    // Check for transition words
    const transitionPatterns = /\b(however|therefore|moreover|additionally|furthermore|first|second|finally|in conclusion|sin embargo|por lo tanto|además|primero|finalmente)\b/gi;
    const transitions = (response.match(transitionPatterns) || []).length;

    if (transitions >= 2) {
      score += 0.15;
    } else if (sentences.length > 3 && transitions === 0) {
      score -= 0.1;
      suggestions.push('Add transition words to improve flow');
    }

    // Check for logical structure (intro, body, conclusion)
    const hasStructure = response.includes('\n\n') || /^#+/m.test(response);
    if (hasStructure) {
      score += 0.1;
    }

    score = Math.max(0, Math.min(1, score));

    return {
      score,
      reasoning: score >= 0.7 ? 'Response has good logical flow' : 'Response coherence could be improved',
      suggestions
    };
  }

  /**
   * Evaluate engagement
   */
  private evaluateEngagement(response: string): { score: number; reasoning: string; suggestions: string[] } {
    let score = 0.6;
    const suggestions: string[] = [];

    // Check for questions to user
    const hasQuestions = response.includes('?');
    if (hasQuestions) {
      score += 0.1;
    }

    // Check for personal touches
    const personalPatterns = /\b(I understand|great question|that's interesting|entiendo|buena pregunta|interesante)\b/i;
    if (personalPatterns.test(response)) {
      score += 0.1;
    }

    // Check for variety in sentence structure
    const sentences = response.split(/[.!?]+/);
    const lengths = sentences.map(s => s.split(/\s+/).length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((sum, l) => sum + Math.pow(l - avgLength, 2), 0) / lengths.length;

    if (variance > 10) {
      score += 0.1; // Good variety
    }

    score = Math.max(0, Math.min(1, score));

    return {
      score,
      reasoning: score >= 0.7 ? 'Response is engaging' : 'Response could be more engaging',
      suggestions
    };
  }

  /**
   * Evaluate technical accuracy
   */
  private evaluateTechnical(query: string, response: string): { score: number; reasoning: string; suggestions: string[] } {
    let score = 0.7;
    const suggestions: string[] = [];

    // Check if technical query has code
    const isTechnicalQuery = /\b(code|function|error|bug|api|database|server|program|código|función|error)\b/i.test(query);

    if (isTechnicalQuery) {
      const hasCode = /```/.test(response);
      if (hasCode) {
        score += 0.15;
      } else {
        suggestions.push('Consider including code examples');
      }

      // Check for technical terms
      const technicalTerms = /\b(function|class|method|variable|array|object|string|integer|boolean|null|undefined)\b/gi;
      const termCount = (response.match(technicalTerms) || []).length;

      if (termCount >= 3) {
        score += 0.1;
      }
    }

    score = Math.max(0, Math.min(1, score));

    return {
      score,
      reasoning: score >= 0.7 ? 'Response is technically appropriate' : 'Response could be more technically detailed',
      suggestions
    };
  }

  /**
   * Extract keywords from text
   */
  private extractKeywords(text: string): Set<string> {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'el', 'la', 'los', 'las', 'un', 'una', 'de', 'que', 'y', 'en', 'es', 'para', 'con', 'por', 'como']);

    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    return new Set(words);
  }

  /**
   * Apply constitutional principles to evaluate
   */
  async evaluateConstitutional(response: string): Promise<{
    score: number;
    violations: Array<{ principle: string; severity: number }>;
    suggestions: string[];
  }> {
    let totalScore = 0;
    let totalWeight = 0;
    const violations: Array<{ principle: string; severity: number }> = [];
    const suggestions: string[] = [];

    for (const principle of this.principles.values()) {
      const evaluation = this.evaluatePrinciple(response, principle);

      totalScore += evaluation.score * principle.weight;
      totalWeight += principle.weight;

      if (evaluation.score < 0.7) {
        violations.push({
          principle: principle.name,
          severity: 1 - evaluation.score
        });
        suggestions.push(principle.revisionPrompt);
      }
    }

    return {
      score: totalScore / totalWeight,
      violations,
      suggestions: suggestions.slice(0, 3)
    };
  }

  /**
   * Evaluate a single constitutional principle
   */
  private evaluatePrinciple(
    response: string,
    principle: ConstitutionalPrinciple
  ): { score: number; reasoning: string } {
    // Simplified principle evaluation
    switch (principle.category) {
      case 'harmlessness':
        const safetyEval = this.evaluateSafety(response);
        return { score: safetyEval.score, reasoning: safetyEval.reasoning };

      case 'helpfulness':
        const helpEval = this.evaluateHelpfulness('', response);
        return { score: helpEval.score, reasoning: helpEval.reasoning };

      case 'honesty':
        const accuracyEval = this.evaluateAccuracy('', response);
        return { score: accuracyEval.score, reasoning: accuracyEval.reasoning };

      default:
        return { score: 0.7, reasoning: 'Unable to evaluate principle' };
    }
  }

  /**
   * Iteratively improve a response
   */
  async improveResponse(
    query: string,
    response: string,
    maxIterations: number = 3
  ): Promise<{
    finalResponse: string;
    iterations: RevisionIteration[];
    improvement: number;
  }> {
    const iterations: RevisionIteration[] = [];
    let currentResponse = response;

    // Initial critique
    let critique = await this.critique(query, currentResponse);
    let previousScore = critique.overallScore;

    for (let i = 0; i < maxIterations; i++) {
      // Check if already good enough
      if (critique.overallScore >= this.defaultPolicy.minAcceptableScore) {
        break;
      }

      // Generate improved response based on suggestions
      const improvedResponse = this.applyImprovements(
        currentResponse,
        critique.improvementSuggestions
      );

      // Re-evaluate
      const newCritique = await this.critique(query, improvedResponse);

      const improvement = newCritique.overallScore - previousScore;

      iterations.push({
        iteration: i + 1,
        originalScore: previousScore,
        newScore: newCritique.overallScore,
        improvement,
        changes: critique.improvementSuggestions,
        response: improvedResponse
      });

      // Check if improvement is significant
      if (improvement < this.defaultPolicy.improvementThreshold) {
        break;
      }

      currentResponse = improvedResponse;
      critique = newCritique;
      previousScore = newCritique.overallScore;
    }

    const responseId = `improved_${Date.now()}`;
    this.revisionHistory.set(responseId, iterations);

    return {
      finalResponse: currentResponse,
      iterations,
      improvement: iterations.length > 0
        ? iterations[iterations.length - 1].newScore - iterations[0].originalScore + iterations[0].improvement
        : 0
    };
  }

  /**
   * Apply improvements to response (simplified)
   */
  private applyImprovements(response: string, suggestions: string[]): string {
    let improved = response;

    // This is a placeholder - in a real system, this would use an LLM
    // to rewrite the response based on the suggestions

    for (const suggestion of suggestions) {
      if (suggestion.includes('brief') || suggestion.includes('concise')) {
        // Try to trim response
        const sentences = improved.split(/[.!?]+/);
        if (sentences.length > 5) {
          improved = sentences.slice(0, Math.ceil(sentences.length * 0.8)).join('. ') + '.';
        }
      }

      if (suggestion.includes('actionable')) {
        // Add a generic actionable phrase if not present
        if (!improved.includes('you can') && !improved.includes('try')) {
          improved += '\n\nYou can try implementing this approach to see results.';
        }
      }
    }

    return improved;
  }

  /**
   * Get critique statistics
   */
  getStats(): {
    totalCritiques: number;
    averageScore: number;
    scoreDistribution: Record<string, number>;
    commonWeaknesses: string[];
  } {
    const scores: number[] = [];
    const weaknessCount: Record<string, number> = {};

    for (const critique of this.critiqueHistory.values()) {
      scores.push(critique.overallScore);

      for (const weakness of critique.weaknesses) {
        const category = weakness.split(':')[0];
        weaknessCount[category] = (weaknessCount[category] || 0) + 1;
      }
    }

    const avgScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

    const distribution: Record<string, number> = {
      excellent: 0,
      good: 0,
      acceptable: 0,
      poor: 0
    };

    for (const score of scores) {
      if (score >= 0.9) distribution.excellent++;
      else if (score >= 0.7) distribution.good++;
      else if (score >= 0.5) distribution.acceptable++;
      else distribution.poor++;
    }

    const commonWeaknesses = Object.entries(weaknessCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category]) => category);

    return {
      totalCritiques: this.critiqueHistory.size,
      averageScore: avgScore,
      scoreDistribution: distribution,
      commonWeaknesses
    };
  }
}

// Export singleton instance
export const selfCritique = new SelfCritique();
