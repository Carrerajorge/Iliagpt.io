/**
 * Reward Model - RLHF-inspired reward modeling
 *
 * Learns to predict human preferences from feedback data
 * and provides reward signals for response optimization.
 */

import { EventEmitter } from 'events';
import { feedbackCollector, FeedbackEntry } from './FeedbackCollector';

// Training example
export interface TrainingExample {
  id: string;
  query: string;
  response: string;
  features: ResponseFeatures;
  reward: number;
  confidence: number;
  source: 'human' | 'comparison' | 'ai';
  timestamp: number;
}

// Response features for reward prediction
export interface ResponseFeatures {
  length: number;
  sentenceCount: number;
  avgSentenceLength: number;
  hasCodeBlocks: boolean;
  codeBlockCount: number;
  hasLinks: boolean;
  hasList: boolean;
  questionCount: number;
  technicalTerms: number;
  readabilityScore: number;
  relevanceScore: number;
  completenessScore: number;
  coherenceScore: number;
  politenessScore: number;
}

// Feature weights for reward calculation
export interface FeatureWeights {
  length: number;
  codeBlocks: number;
  lists: number;
  readability: number;
  relevance: number;
  completeness: number;
  coherence: number;
  politeness: number;
}

// Reward prediction
export interface RewardPrediction {
  reward: number;
  confidence: number;
  featureContributions: Record<string, number>;
  explanation: string;
}

// Model metrics
export interface ModelMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  meanAbsoluteError: number;
  correlationWithHuman: number;
}

/**
 * RewardModel - Predicts rewards for responses
 */
export class RewardModel extends EventEmitter {
  private trainingExamples: Map<string, TrainingExample>;
  private featureWeights: FeatureWeights;
  private bias: number;
  private learningRate: number;
  private trainingHistory: Array<{
    epoch: number;
    loss: number;
    metrics: ModelMetrics;
    timestamp: number;
  }>;
  private initialized: boolean = false;

  constructor() {
    super();
    this.trainingExamples = new Map();
    this.featureWeights = this.getDefaultWeights();
    this.bias = 0.5;
    this.learningRate = 0.01;
    this.trainingHistory = [];
  }

  /**
   * Get default feature weights
   */
  private getDefaultWeights(): FeatureWeights {
    return {
      length: 0.05,
      codeBlocks: 0.15,
      lists: 0.10,
      readability: 0.15,
      relevance: 0.25,
      completeness: 0.15,
      coherence: 0.10,
      politeness: 0.05
    };
  }

  /**
   * Initialize the reward model
   */
  async initialize(): Promise<void> {
    console.log('[RewardModel] Initializing...');

    // Load training data from feedback
    await this.loadTrainingData();

    // Initial training if we have enough examples
    if (this.trainingExamples.size >= 10) {
      await this.train(5); // 5 epochs
    }

    this.initialized = true;
    console.log('[RewardModel] Initialized with', this.trainingExamples.size, 'training examples');
  }

  /**
   * Load training data from feedback collector
   */
  private async loadTrainingData(): Promise<void> {
    const feedback = feedbackCollector.queryFeedback({
      processed: true
    }, 5000);

    for (const entry of feedback) {
      if (entry.data.rating === undefined) continue;

      const example = this.feedbackToExample(entry);
      this.trainingExamples.set(example.id, example);
    }
  }

  /**
   * Convert feedback entry to training example
   */
  private feedbackToExample(entry: FeedbackEntry): TrainingExample {
    const features = this.extractFeatures(entry.context.response);

    return {
      id: entry.id,
      query: entry.context.query,
      response: entry.context.response,
      features,
      reward: entry.data.rating || 0.5,
      confidence: entry.source === 'user' ? 0.9 : 0.7,
      source: entry.source === 'user' ? 'human' : entry.type === 'comparison' ? 'comparison' : 'ai',
      timestamp: entry.timestamp
    };
  }

  /**
   * Extract features from a response
   */
  extractFeatures(response: string): ResponseFeatures {
    const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const words = response.split(/\s+/).filter(w => w.length > 0);
    const codeBlocks = (response.match(/```[\s\S]*?```/g) || []).length;
    const inlineCode = (response.match(/`[^`]+`/g) || []).length;
    const links = (response.match(/https?:\/\/[^\s]+/g) || []).length;
    const listItems = (response.match(/^[\-\*\d]+\./gm) || []).length;
    const questions = (response.match(/\?/g) || []).length;

    // Technical terms (simplified heuristic)
    const technicalPatterns = /\b(api|function|class|method|variable|database|server|client|async|await|promise|callback|interface|type|schema|query|mutation|hook|component|state|props|render|deploy|config|env|npm|yarn|git|docker|kubernetes|aws|azure|gcp)\b/gi;
    const technicalTerms = (response.match(technicalPatterns) || []).length;

    // Calculate readability (simplified Flesch-Kincaid-like)
    const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / Math.max(words.length, 1);
    const avgSentenceLength = words.length / Math.max(sentences.length, 1);
    const readabilityScore = Math.max(0, Math.min(1,
      1 - (avgWordLength - 4) / 6 - (avgSentenceLength - 15) / 30
    ));

    // Simplified relevance/completeness/coherence scores (would need query context for real scoring)
    const hasGreeting = /^(hi|hello|hey|thanks|thank you|hola|gracias)/i.test(response.trim());
    const hasConclusion = /(hope this helps|let me know|feel free|espero que|avísame)/i.test(response);

    return {
      length: response.length,
      sentenceCount: sentences.length,
      avgSentenceLength,
      hasCodeBlocks: codeBlocks > 0 || inlineCode > 0,
      codeBlockCount: codeBlocks + inlineCode,
      hasLinks: links > 0,
      hasList: listItems > 0,
      questionCount: questions,
      technicalTerms,
      readabilityScore,
      relevanceScore: 0.7, // Placeholder - would need actual relevance calculation
      completenessScore: hasConclusion ? 0.8 : 0.6,
      coherenceScore: sentences.length > 0 ? 0.75 : 0.5,
      politenessScore: hasGreeting || hasConclusion ? 0.9 : 0.6
    };
  }

  /**
   * Predict reward for a response
   */
  predict(query: string, response: string): RewardPrediction {
    const features = this.extractFeatures(response);
    const contributions: Record<string, number> = {};

    // Calculate weighted sum
    let weightedSum = this.bias;

    // Length contribution (normalized)
    const lengthContrib = Math.min(features.length / 2000, 1) * this.featureWeights.length;
    contributions['length'] = lengthContrib;
    weightedSum += lengthContrib;

    // Code blocks contribution
    const codeContrib = features.hasCodeBlocks ? this.featureWeights.codeBlocks : 0;
    contributions['codeBlocks'] = codeContrib;
    weightedSum += codeContrib;

    // Lists contribution
    const listContrib = features.hasList ? this.featureWeights.lists : 0;
    contributions['lists'] = listContrib;
    weightedSum += listContrib;

    // Readability contribution
    const readContrib = features.readabilityScore * this.featureWeights.readability;
    contributions['readability'] = readContrib;
    weightedSum += readContrib;

    // Relevance contribution
    const relContrib = features.relevanceScore * this.featureWeights.relevance;
    contributions['relevance'] = relContrib;
    weightedSum += relContrib;

    // Completeness contribution
    const compContrib = features.completenessScore * this.featureWeights.completeness;
    contributions['completeness'] = compContrib;
    weightedSum += compContrib;

    // Coherence contribution
    const cohContrib = features.coherenceScore * this.featureWeights.coherence;
    contributions['coherence'] = cohContrib;
    weightedSum += cohContrib;

    // Politeness contribution
    const polContrib = features.politenessScore * this.featureWeights.politeness;
    contributions['politeness'] = polContrib;
    weightedSum += polContrib;

    // Clamp to [0, 1]
    const reward = Math.max(0, Math.min(1, weightedSum));

    // Calculate confidence based on feature coverage
    const confidence = this.calculateConfidence(features);

    // Generate explanation
    const explanation = this.generateExplanation(contributions, reward);

    return {
      reward,
      confidence,
      featureContributions: contributions,
      explanation
    };
  }

  /**
   * Calculate prediction confidence
   */
  private calculateConfidence(features: ResponseFeatures): number {
    let confidence = 0.5;

    // More text = more confidence
    if (features.length > 100) confidence += 0.1;
    if (features.length > 500) confidence += 0.1;

    // Training data quality
    if (this.trainingExamples.size > 100) confidence += 0.1;
    if (this.trainingExamples.size > 500) confidence += 0.1;

    // Recent training
    if (this.trainingHistory.length > 0) {
      const lastTraining = this.trainingHistory[this.trainingHistory.length - 1];
      if (lastTraining.metrics.accuracy > 0.7) confidence += 0.1;
    }

    return Math.min(0.95, confidence);
  }

  /**
   * Generate explanation for reward
   */
  private generateExplanation(contributions: Record<string, number>, reward: number): string {
    const sortedContribs = Object.entries(contributions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const topFactors = sortedContribs
      .map(([name, value]) => `${name}: +${(value * 100).toFixed(1)}%`)
      .join(', ');

    const quality = reward > 0.8 ? 'excellent' :
      reward > 0.6 ? 'good' :
        reward > 0.4 ? 'acceptable' : 'needs improvement';

    return `Response rated as ${quality} (${(reward * 100).toFixed(1)}%). Top factors: ${topFactors}`;
  }

  /**
   * Add training example
   */
  addTrainingExample(
    query: string,
    response: string,
    reward: number,
    source: 'human' | 'comparison' | 'ai' = 'human'
  ): string {
    const id = `train_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const features = this.extractFeatures(response);

    const example: TrainingExample = {
      id,
      query,
      response,
      features,
      reward,
      confidence: source === 'human' ? 0.9 : 0.7,
      source,
      timestamp: Date.now()
    };

    this.trainingExamples.set(id, example);
    this.emit('example:added', { id, reward, source });

    return id;
  }

  /**
   * Train the reward model
   */
  async train(epochs: number = 10): Promise<ModelMetrics> {
    console.log(`[RewardModel] Training for ${epochs} epochs with ${this.trainingExamples.size} examples`);

    const examples = Array.from(this.trainingExamples.values());
    if (examples.length < 5) {
      throw new Error('Not enough training examples');
    }

    // Split data
    const shuffled = examples.sort(() => Math.random() - 0.5);
    const trainSize = Math.floor(shuffled.length * 0.8);
    const trainSet = shuffled.slice(0, trainSize);
    const testSet = shuffled.slice(trainSize);

    let lastMetrics: ModelMetrics | null = null;

    for (let epoch = 0; epoch < epochs; epoch++) {
      let epochLoss = 0;

      // Training pass
      for (const example of trainSet) {
        const prediction = this.predict(example.query, example.response);
        const error = example.reward - prediction.reward;
        epochLoss += error * error;

        // Update weights (simplified gradient descent)
        this.updateWeights(example.features, error, example.confidence);
      }

      epochLoss /= trainSet.length;

      // Evaluate on test set
      const metrics = this.evaluate(testSet);
      lastMetrics = metrics;

      this.trainingHistory.push({
        epoch: epoch + 1,
        loss: epochLoss,
        metrics,
        timestamp: Date.now()
      });

      this.emit('epoch:completed', { epoch: epoch + 1, loss: epochLoss, metrics });
    }

    console.log('[RewardModel] Training complete. Final metrics:', lastMetrics);
    return lastMetrics!;
  }

  /**
   * Update weights based on error
   */
  private updateWeights(features: ResponseFeatures, error: number, confidence: number): void {
    const adjustedLR = this.learningRate * confidence;

    // Update each weight based on feature values and error
    this.featureWeights.length += adjustedLR * error * Math.min(features.length / 2000, 1);
    this.featureWeights.codeBlocks += adjustedLR * error * (features.hasCodeBlocks ? 1 : 0);
    this.featureWeights.lists += adjustedLR * error * (features.hasList ? 1 : 0);
    this.featureWeights.readability += adjustedLR * error * features.readabilityScore;
    this.featureWeights.relevance += adjustedLR * error * features.relevanceScore;
    this.featureWeights.completeness += adjustedLR * error * features.completenessScore;
    this.featureWeights.coherence += adjustedLR * error * features.coherenceScore;
    this.featureWeights.politeness += adjustedLR * error * features.politenessScore;

    // Update bias
    this.bias += adjustedLR * error * 0.1;

    // Normalize weights to prevent explosion
    const totalWeight = Object.values(this.featureWeights).reduce((sum, w) => sum + Math.abs(w), 0);
    if (totalWeight > 2) {
      for (const key of Object.keys(this.featureWeights) as Array<keyof FeatureWeights>) {
        this.featureWeights[key] /= totalWeight;
      }
    }
  }

  /**
   * Evaluate model on a dataset
   */
  private evaluate(testSet: TrainingExample[]): ModelMetrics {
    let totalError = 0;
    let correctPredictions = 0;
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;

    const predictions: number[] = [];
    const actuals: number[] = [];

    for (const example of testSet) {
      const prediction = this.predict(example.query, example.response);
      const error = Math.abs(example.reward - prediction.reward);
      totalError += error;

      predictions.push(prediction.reward);
      actuals.push(example.reward);

      // Binary classification metrics (threshold = 0.5)
      const predictedGood = prediction.reward >= 0.5;
      const actualGood = example.reward >= 0.5;

      if (predictedGood === actualGood) correctPredictions++;
      if (predictedGood && actualGood) truePositives++;
      if (predictedGood && !actualGood) falsePositives++;
      if (!predictedGood && actualGood) falseNegatives++;
    }

    const accuracy = correctPredictions / testSet.length;
    const precision = truePositives / Math.max(truePositives + falsePositives, 1);
    const recall = truePositives / Math.max(truePositives + falseNegatives, 1);
    const f1Score = 2 * (precision * recall) / Math.max(precision + recall, 0.001);
    const meanAbsoluteError = totalError / testSet.length;
    const correlationWithHuman = this.calculateCorrelation(predictions, actuals);

    return {
      accuracy,
      precision,
      recall,
      f1Score,
      meanAbsoluteError,
      correlationWithHuman
    };
  }

  /**
   * Calculate Pearson correlation
   */
  private calculateCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    if (n === 0) return 0;

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    return denominator === 0 ? 0 : numerator / denominator;
  }

  /**
   * Compare two responses (for comparison training)
   */
  compare(query: string, responseA: string, responseB: string): {
    winner: 'A' | 'B' | 'tie';
    rewardA: number;
    rewardB: number;
    margin: number;
    explanation: string;
  } {
    const predA = this.predict(query, responseA);
    const predB = this.predict(query, responseB);

    const margin = Math.abs(predA.reward - predB.reward);
    const winner = margin < 0.1 ? 'tie' : (predA.reward > predB.reward ? 'A' : 'B');

    return {
      winner,
      rewardA: predA.reward,
      rewardB: predB.reward,
      margin,
      explanation: `Response ${winner === 'tie' ? 'are roughly equal' : winner + ' is preferred'} (A: ${(predA.reward * 100).toFixed(1)}%, B: ${(predB.reward * 100).toFixed(1)}%)`
    };
  }

  /**
   * Get current model weights
   */
  getWeights(): FeatureWeights {
    return { ...this.featureWeights };
  }

  /**
   * Get model statistics
   */
  getStats(): {
    trainingExamples: number;
    epochsTrained: number;
    latestMetrics: ModelMetrics | null;
    weights: FeatureWeights;
    bias: number;
  } {
    const latestHistory = this.trainingHistory[this.trainingHistory.length - 1];

    return {
      trainingExamples: this.trainingExamples.size,
      epochsTrained: this.trainingHistory.length,
      latestMetrics: latestHistory?.metrics || null,
      weights: this.getWeights(),
      bias: this.bias
    };
  }
}

// Export singleton instance
export const rewardModel = new RewardModel();
