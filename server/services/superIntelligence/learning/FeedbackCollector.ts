/**
 * Feedback Collector - Collects and processes feedback for learning
 *
 * Gathers feedback from multiple sources: explicit user feedback,
 * implicit behavioral signals, and AI-generated assessments.
 */

import { EventEmitter } from 'events';

// Feedback types
export type FeedbackType =
  | 'explicit_rating'      // User provided rating (1-5, thumbs up/down)
  | 'explicit_text'        // User provided text feedback
  | 'implicit_accept'      // User accepted/used the response
  | 'implicit_reject'      // User rejected/ignored the response
  | 'implicit_edit'        // User edited the response
  | 'implicit_regenerate'  // User asked for regeneration
  | 'implicit_followup'    // User asked clarifying question
  | 'ai_assessment'        // AI-generated quality assessment
  | 'comparison'           // A/B comparison result
  | 'correction';          // User provided correction

// Feedback source
export type FeedbackSource = 'user' | 'system' | 'ai_critic' | 'peer_review';

// Feedback entry
export interface FeedbackEntry {
  id: string;
  type: FeedbackType;
  source: FeedbackSource;
  responseId: string;
  conversationId: string;
  userId: string;
  timestamp: number;
  data: {
    rating?: number;        // 1-5 or 0-1
    text?: string;          // Text feedback
    originalResponse?: string;
    editedResponse?: string;
    comparisonWinner?: string;
    categories?: string[];  // Feedback categories
    sentiment?: number;     // -1 to 1
  };
  context: {
    query: string;
    response: string;
    modelUsed?: string;
    latency?: number;
    tokensUsed?: number;
  };
  metadata: Record<string, any>;
  processed: boolean;
  processedAt?: number;
}

// Aggregated feedback
export interface AggregatedFeedback {
  responseId: string;
  totalFeedback: number;
  averageRating: number;
  sentimentScore: number;
  categories: Record<string, number>;
  acceptanceRate: number;
  editRate: number;
  regenerateRate: number;
  timespan: {
    start: number;
    end: number;
  };
}

// Feedback filter
export interface FeedbackFilter {
  types?: FeedbackType[];
  sources?: FeedbackSource[];
  userId?: string;
  startTime?: number;
  endTime?: number;
  minRating?: number;
  processed?: boolean;
}

/**
 * FeedbackCollector - Collects and manages feedback data
 */
export class FeedbackCollector extends EventEmitter {
  private feedbackStore: Map<string, FeedbackEntry>;
  private feedbackByResponse: Map<string, string[]>;
  private feedbackByUser: Map<string, string[]>;
  private processingQueue: string[];
  private isProcessing: boolean = false;

  constructor() {
    super();
    this.feedbackStore = new Map();
    this.feedbackByResponse = new Map();
    this.feedbackByUser = new Map();
    this.processingQueue = [];
  }

  /**
   * Collect explicit rating feedback
   */
  async collectRating(
    userId: string,
    responseId: string,
    conversationId: string,
    rating: number,
    context: FeedbackEntry['context'],
    categories?: string[]
  ): Promise<string> {
    return this.collectFeedback({
      type: 'explicit_rating',
      source: 'user',
      responseId,
      conversationId,
      userId,
      data: {
        rating: Math.max(1, Math.min(5, rating)), // Normalize to 1-5
        categories
      },
      context
    });
  }

  /**
   * Collect text feedback
   */
  async collectTextFeedback(
    userId: string,
    responseId: string,
    conversationId: string,
    text: string,
    context: FeedbackEntry['context']
  ): Promise<string> {
    // Analyze sentiment
    const sentiment = this.analyzeSentiment(text);

    return this.collectFeedback({
      type: 'explicit_text',
      source: 'user',
      responseId,
      conversationId,
      userId,
      data: {
        text,
        sentiment
      },
      context
    });
  }

  /**
   * Collect implicit acceptance signal
   */
  async collectAcceptance(
    userId: string,
    responseId: string,
    conversationId: string,
    context: FeedbackEntry['context']
  ): Promise<string> {
    return this.collectFeedback({
      type: 'implicit_accept',
      source: 'system',
      responseId,
      conversationId,
      userId,
      data: { rating: 1 },
      context
    });
  }

  /**
   * Collect edit feedback
   */
  async collectEdit(
    userId: string,
    responseId: string,
    conversationId: string,
    originalResponse: string,
    editedResponse: string,
    context: FeedbackEntry['context']
  ): Promise<string> {
    // Calculate edit distance ratio
    const editRatio = this.calculateEditRatio(originalResponse, editedResponse);

    return this.collectFeedback({
      type: 'implicit_edit',
      source: 'system',
      responseId,
      conversationId,
      userId,
      data: {
        originalResponse,
        editedResponse,
        rating: 1 - editRatio // Less editing = higher rating
      },
      context
    });
  }

  /**
   * Collect regeneration request
   */
  async collectRegeneration(
    userId: string,
    responseId: string,
    conversationId: string,
    context: FeedbackEntry['context']
  ): Promise<string> {
    return this.collectFeedback({
      type: 'implicit_regenerate',
      source: 'system',
      responseId,
      conversationId,
      userId,
      data: { rating: 0.3 }, // Low implicit rating
      context
    });
  }

  /**
   * Collect AI assessment
   */
  async collectAIAssessment(
    responseId: string,
    conversationId: string,
    assessment: {
      rating: number;
      categories: string[];
      explanation: string;
    },
    context: FeedbackEntry['context']
  ): Promise<string> {
    return this.collectFeedback({
      type: 'ai_assessment',
      source: 'ai_critic',
      responseId,
      conversationId,
      userId: 'system',
      data: {
        rating: assessment.rating,
        categories: assessment.categories,
        text: assessment.explanation
      },
      context
    });
  }

  /**
   * Collect comparison result
   */
  async collectComparison(
    userId: string,
    responseAId: string,
    responseBId: string,
    conversationId: string,
    winnerId: string,
    context: FeedbackEntry['context']
  ): Promise<string[]> {
    const winnerFeedback = await this.collectFeedback({
      type: 'comparison',
      source: 'user',
      responseId: winnerId,
      conversationId,
      userId,
      data: {
        rating: 1,
        comparisonWinner: winnerId
      },
      context,
      metadata: { opponent: winnerId === responseAId ? responseBId : responseAId }
    });

    const loserFeedback = await this.collectFeedback({
      type: 'comparison',
      source: 'user',
      responseId: winnerId === responseAId ? responseBId : responseAId,
      conversationId,
      userId,
      data: {
        rating: 0,
        comparisonWinner: winnerId
      },
      context,
      metadata: { opponent: winnerId }
    });

    return [winnerFeedback, loserFeedback];
  }

  /**
   * Collect user correction
   */
  async collectCorrection(
    userId: string,
    responseId: string,
    conversationId: string,
    originalResponse: string,
    correction: string,
    context: FeedbackEntry['context']
  ): Promise<string> {
    return this.collectFeedback({
      type: 'correction',
      source: 'user',
      responseId,
      conversationId,
      userId,
      data: {
        originalResponse,
        editedResponse: correction,
        rating: 0.2 // Low rating since correction was needed
      },
      context
    });
  }

  /**
   * Core feedback collection method
   */
  private async collectFeedback(
    entry: Omit<FeedbackEntry, 'id' | 'timestamp' | 'processed' | 'metadata'> & { metadata?: Record<string, any> }
  ): Promise<string> {
    const feedbackId = `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const feedbackEntry: FeedbackEntry = {
      ...entry,
      id: feedbackId,
      timestamp: Date.now(),
      processed: false,
      metadata: entry.metadata || {}
    };

    // Store feedback
    this.feedbackStore.set(feedbackId, feedbackEntry);

    // Index by response
    if (!this.feedbackByResponse.has(entry.responseId)) {
      this.feedbackByResponse.set(entry.responseId, []);
    }
    this.feedbackByResponse.get(entry.responseId)!.push(feedbackId);

    // Index by user
    if (!this.feedbackByUser.has(entry.userId)) {
      this.feedbackByUser.set(entry.userId, []);
    }
    this.feedbackByUser.get(entry.userId)!.push(feedbackId);

    // Add to processing queue
    this.processingQueue.push(feedbackId);

    this.emit('feedback:collected', { feedbackId, type: entry.type, source: entry.source });

    // Process queue asynchronously
    this.processQueueAsync();

    return feedbackId;
  }

  /**
   * Process feedback queue asynchronously
   */
  private async processQueueAsync(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;

    while (this.processingQueue.length > 0) {
      const feedbackId = this.processingQueue.shift();
      if (!feedbackId) continue;

      try {
        await this.processFeedback(feedbackId);
      } catch (error) {
        console.error(`[FeedbackCollector] Error processing feedback ${feedbackId}:`, error);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Process a single feedback entry
   */
  private async processFeedback(feedbackId: string): Promise<void> {
    const feedback = this.feedbackStore.get(feedbackId);
    if (!feedback || feedback.processed) return;

    // Normalize rating to 0-1 scale
    if (feedback.data.rating !== undefined) {
      if (feedback.type === 'explicit_rating' && feedback.data.rating > 1) {
        // Convert 1-5 to 0-1
        feedback.data.rating = (feedback.data.rating - 1) / 4;
      }
    }

    // Mark as processed
    feedback.processed = true;
    feedback.processedAt = Date.now();

    this.emit('feedback:processed', { feedbackId, feedback });
  }

  /**
   * Get feedback for a response
   */
  getFeedbackForResponse(responseId: string): FeedbackEntry[] {
    const feedbackIds = this.feedbackByResponse.get(responseId) || [];
    return feedbackIds
      .map(id => this.feedbackStore.get(id))
      .filter((f): f is FeedbackEntry => f !== undefined);
  }

  /**
   * Get feedback from a user
   */
  getFeedbackByUser(userId: string): FeedbackEntry[] {
    const feedbackIds = this.feedbackByUser.get(userId) || [];
    return feedbackIds
      .map(id => this.feedbackStore.get(id))
      .filter((f): f is FeedbackEntry => f !== undefined);
  }

  /**
   * Query feedback with filters
   */
  queryFeedback(filter: FeedbackFilter, limit: number = 100): FeedbackEntry[] {
    let results: FeedbackEntry[] = Array.from(this.feedbackStore.values());

    if (filter.types && filter.types.length > 0) {
      results = results.filter(f => filter.types!.includes(f.type));
    }

    if (filter.sources && filter.sources.length > 0) {
      results = results.filter(f => filter.sources!.includes(f.source));
    }

    if (filter.userId) {
      results = results.filter(f => f.userId === filter.userId);
    }

    if (filter.startTime) {
      results = results.filter(f => f.timestamp >= filter.startTime!);
    }

    if (filter.endTime) {
      results = results.filter(f => f.timestamp <= filter.endTime!);
    }

    if (filter.minRating !== undefined) {
      results = results.filter(f => (f.data.rating || 0) >= filter.minRating!);
    }

    if (filter.processed !== undefined) {
      results = results.filter(f => f.processed === filter.processed);
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp - a.timestamp);

    return results.slice(0, limit);
  }

  /**
   * Aggregate feedback for a response
   */
  aggregateFeedback(responseId: string): AggregatedFeedback | null {
    const feedback = this.getFeedbackForResponse(responseId);

    if (feedback.length === 0) return null;

    let totalRating = 0;
    let ratingCount = 0;
    let totalSentiment = 0;
    let sentimentCount = 0;
    let acceptCount = 0;
    let editCount = 0;
    let regenerateCount = 0;
    const categories: Record<string, number> = {};

    let minTime = Infinity;
    let maxTime = 0;

    for (const entry of feedback) {
      minTime = Math.min(minTime, entry.timestamp);
      maxTime = Math.max(maxTime, entry.timestamp);

      if (entry.data.rating !== undefined) {
        totalRating += entry.data.rating;
        ratingCount++;
      }

      if (entry.data.sentiment !== undefined) {
        totalSentiment += entry.data.sentiment;
        sentimentCount++;
      }

      if (entry.data.categories) {
        for (const cat of entry.data.categories) {
          categories[cat] = (categories[cat] || 0) + 1;
        }
      }

      switch (entry.type) {
        case 'implicit_accept':
          acceptCount++;
          break;
        case 'implicit_edit':
          editCount++;
          break;
        case 'implicit_regenerate':
          regenerateCount++;
          break;
      }
    }

    return {
      responseId,
      totalFeedback: feedback.length,
      averageRating: ratingCount > 0 ? totalRating / ratingCount : 0.5,
      sentimentScore: sentimentCount > 0 ? totalSentiment / sentimentCount : 0,
      categories,
      acceptanceRate: feedback.length > 0 ? acceptCount / feedback.length : 0,
      editRate: feedback.length > 0 ? editCount / feedback.length : 0,
      regenerateRate: feedback.length > 0 ? regenerateCount / feedback.length : 0,
      timespan: {
        start: minTime,
        end: maxTime
      }
    };
  }

  /**
   * Simple sentiment analysis
   */
  private analyzeSentiment(text: string): number {
    const positiveWords = ['great', 'good', 'excellent', 'helpful', 'perfect', 'amazing', 'wonderful', 'thanks', 'genial', 'excelente', 'bueno', 'gracias'];
    const negativeWords = ['bad', 'wrong', 'terrible', 'useless', 'horrible', 'awful', 'poor', 'confused', 'malo', 'terrible', 'inútil', 'confuso'];

    const words = text.toLowerCase().split(/\s+/);
    let score = 0;

    for (const word of words) {
      if (positiveWords.some(pw => word.includes(pw))) score++;
      if (negativeWords.some(nw => word.includes(nw))) score--;
    }

    return Math.max(-1, Math.min(1, score / Math.max(words.length, 1)));
  }

  /**
   * Calculate edit ratio (Levenshtein-like)
   */
  private calculateEditRatio(original: string, edited: string): number {
    const maxLen = Math.max(original.length, edited.length);
    if (maxLen === 0) return 0;

    // Simple character-level difference ratio
    let differences = 0;
    const minLen = Math.min(original.length, edited.length);

    for (let i = 0; i < minLen; i++) {
      if (original[i] !== edited[i]) differences++;
    }

    differences += Math.abs(original.length - edited.length);

    return differences / maxLen;
  }

  /**
   * Get collector statistics
   */
  getStats(): {
    totalFeedback: number;
    feedbackByType: Record<FeedbackType, number>;
    feedbackBySource: Record<FeedbackSource, number>;
    averageRating: number;
    processingQueueSize: number;
  } {
    const feedbackByType: Record<string, number> = {};
    const feedbackBySource: Record<string, number> = {};
    let totalRating = 0;
    let ratingCount = 0;

    for (const feedback of this.feedbackStore.values()) {
      feedbackByType[feedback.type] = (feedbackByType[feedback.type] || 0) + 1;
      feedbackBySource[feedback.source] = (feedbackBySource[feedback.source] || 0) + 1;

      if (feedback.data.rating !== undefined) {
        totalRating += feedback.data.rating;
        ratingCount++;
      }
    }

    return {
      totalFeedback: this.feedbackStore.size,
      feedbackByType: feedbackByType as Record<FeedbackType, number>,
      feedbackBySource: feedbackBySource as Record<FeedbackSource, number>,
      averageRating: ratingCount > 0 ? totalRating / ratingCount : 0,
      processingQueueSize: this.processingQueue.length
    };
  }

  /**
   * Export feedback for training
   */
  exportForTraining(filter?: FeedbackFilter): Array<{
    query: string;
    response: string;
    rating: number;
    feedback_type: string;
  }> {
    const feedback = filter ? this.queryFeedback(filter, 10000) : Array.from(this.feedbackStore.values());

    return feedback
      .filter(f => f.data.rating !== undefined)
      .map(f => ({
        query: f.context.query,
        response: f.context.response,
        rating: f.data.rating!,
        feedback_type: f.type
      }));
  }
}

// Export singleton instance
export const feedbackCollector = new FeedbackCollector();
