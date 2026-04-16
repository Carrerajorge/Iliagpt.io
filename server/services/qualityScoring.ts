/**
 * Quality Scoring Service - ILIAGPT PRO 3.0
 * 
 * Measure and track AI response quality.
 * Automated evaluation and feedback collection.
 */

// ============== Types ==============

export interface QualityScore {
    id: string;
    messageId: string;
    userId: string;
    model: string;
    timestamp: Date;
    metrics: QualityMetrics;
    overallScore: number;
    feedback?: UserFeedback;
}

export interface QualityMetrics {
    relevance: number;      // 0-1: How relevant to the query
    accuracy: number;       // 0-1: Factual accuracy
    coherence: number;      // 0-1: Logical flow
    helpfulness: number;    // 0-1: Practical usefulness
    completeness: number;   // 0-1: Coverage of topic
    conciseness: number;    // 0-1: Appropriate length
    safety: number;         // 0-1: No harmful content
    creativity: number;     // 0-1: Original thinking
}

export interface UserFeedback {
    rating: 1 | 2 | 3 | 4 | 5;
    liked?: boolean;
    issues?: FeedbackIssue[];
    comment?: string;
    submittedAt: Date;
}

export type FeedbackIssue =
    | "incorrect"
    | "incomplete"
    | "unhelpful"
    | "too_long"
    | "too_short"
    | "off_topic"
    | "confusing"
    | "inappropriate";

export interface QualityReport {
    period: { start: Date; end: Date };
    totalResponses: number;
    averageScore: number;
    metricAverages: QualityMetrics;
    distribution: { score: number; count: number }[];
    topIssues: { issue: FeedbackIssue; count: number }[];
    modelComparison: { model: string; avgScore: number; count: number }[];
    trends: { date: string; avgScore: number }[];
}

// ============== Storage ==============

const scores: Map<string, QualityScore> = new Map();
const feedbackLog: { messageId: string; feedback: UserFeedback }[] = [];

// ============== Quality Scoring Service ==============

export class QualityScoringService {
    private weights: Record<keyof QualityMetrics, number> = {
        relevance: 0.2,
        accuracy: 0.2,
        coherence: 0.15,
        helpfulness: 0.15,
        completeness: 0.1,
        conciseness: 0.1,
        safety: 0.05,
        creativity: 0.05,
    };

    // ======== Scoring ========

    /**
     * Score a response automatically
     */
    async scoreResponse(
        messageId: string,
        userId: string,
        model: string,
        query: string,
        response: string
    ): Promise<QualityScore> {
        const metrics = await this.evaluateMetrics(query, response);
        const overallScore = this.calculateOverallScore(metrics);

        const score: QualityScore = {
            id: `score_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            messageId,
            userId,
            model,
            timestamp: new Date(),
            metrics,
            overallScore,
        };

        scores.set(score.id, score);
        return score;
    }

    /**
     * Evaluate individual metrics
     */
    private async evaluateMetrics(query: string, response: string): Promise<QualityMetrics> {
        return {
            relevance: this.evaluateRelevance(query, response),
            accuracy: this.evaluateAccuracy(response),
            coherence: this.evaluateCoherence(response),
            helpfulness: this.evaluateHelpfulness(query, response),
            completeness: this.evaluateCompleteness(query, response),
            conciseness: this.evaluateConciseness(response),
            safety: this.evaluateSafety(response),
            creativity: this.evaluateCreativity(response),
        };
    }

    private evaluateRelevance(query: string, response: string): number {
        const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        const responseWords = response.toLowerCase().split(/\s+/);

        let matches = 0;
        for (const word of responseWords) {
            if (queryWords.has(word)) matches++;
        }

        const relevanceScore = Math.min(1, matches / Math.max(queryWords.size, 1) * 2);
        return Math.max(0.3, relevanceScore);
    }

    private evaluateAccuracy(response: string): number {
        // Penalize known uncertain phrases
        const uncertainPhrases = [
            "i'm not sure",
            "i don't know",
            "might be",
            "possibly",
            "i think maybe",
        ];

        const lower = response.toLowerCase();
        let penalty = 0;
        for (const phrase of uncertainPhrases) {
            if (lower.includes(phrase)) penalty += 0.1;
        }

        return Math.max(0.5, 1 - penalty);
    }

    private evaluateCoherence(response: string): number {
        const sentences = response.split(/[.!?]+/).filter(s => s.trim());

        if (sentences.length < 2) return 0.7;

        // Check for logical connectors
        const connectors = ["therefore", "however", "because", "thus", "also", "additionally"];
        let connectorCount = 0;
        for (const conn of connectors) {
            if (response.toLowerCase().includes(conn)) connectorCount++;
        }

        const connectorScore = Math.min(1, 0.6 + connectorCount * 0.1);

        // Check for consistent structure (lists, paragraphs)
        const hasStructure = response.includes("\n") || response.includes("•") || response.includes("-");

        return hasStructure ? connectorScore + 0.1 : connectorScore;
    }

    private evaluateHelpfulness(query: string, response: string): number {
        // Check for actionable content
        const actionWords = ["steps", "first", "then", "finally", "try", "use", "do"];
        let actionScore = 0;
        for (const word of actionWords) {
            if (response.toLowerCase().includes(word)) actionScore += 0.05;
        }

        // Check for examples
        const hasExamples = response.toLowerCase().includes("example") ||
            response.includes("```") ||
            response.includes("e.g.");

        return Math.min(1, 0.5 + actionScore + (hasExamples ? 0.2 : 0));
    }

    private evaluateCompleteness(query: string, response: string): number {
        const questionWords = query.match(/\b(what|how|why|when|where|who|which)\b/gi) || [];

        // Longer responses tend to be more complete
        const lengthScore = Math.min(1, response.length / 500);

        // Check if response addresses question type
        const hasAnswer = response.length > 50;

        return hasAnswer ? 0.5 + lengthScore * 0.5 : 0.3;
    }

    private evaluateConciseness(response: string): number {
        const wordCount = response.split(/\s+/).length;

        if (wordCount < 20) return 0.6; // Too short
        if (wordCount > 1000) return 0.5; // Too long
        if (wordCount > 500) return 0.7;
        if (wordCount < 50) return 0.8;

        return 0.9; // Sweet spot
    }

    private evaluateSafety(response: string): number {
        const harmfulPatterns = [
            /\b(kill|harm|attack|exploit)\b/i,
            /\b(password|credit card|ssn)\b/i,
            /\b(illegal|unauthorized)\b/i,
        ];

        for (const pattern of harmfulPatterns) {
            if (pattern.test(response)) return 0.5;
        }

        return 1.0;
    }

    private evaluateCreativity(response: string): number {
        // Check for varied vocabulary
        const words = response.toLowerCase().split(/\s+/);
        const uniqueWords = new Set(words);
        const vocabularyRatio = uniqueWords.size / Math.max(words.length, 1);

        // Check for metaphors/analogies
        const hasAnalogy = response.toLowerCase().includes("like") ||
            response.toLowerCase().includes("similar to");

        return Math.min(1, vocabularyRatio + (hasAnalogy ? 0.1 : 0));
    }

    /**
     * Calculate overall score
     */
    private calculateOverallScore(metrics: QualityMetrics): number {
        let score = 0;
        for (const [key, value] of Object.entries(metrics)) {
            score += value * (this.weights[key as keyof QualityMetrics] || 0);
        }
        return Math.round(score * 100) / 100;
    }

    // ======== Feedback ========

    /**
     * Record user feedback
     */
    recordFeedback(messageId: string, feedback: Omit<UserFeedback, 'submittedAt'>): void {
        const fullFeedback: UserFeedback = {
            ...feedback,
            submittedAt: new Date(),
        };

        feedbackLog.push({ messageId, feedback: fullFeedback });

        // Update score if exists
        for (const score of scores.values()) {
            if (score.messageId === messageId) {
                score.feedback = fullFeedback;
                break;
            }
        }
    }

    // ======== Reporting ========

    /**
     * Generate quality report
     */
    generateReport(
        startDate: Date,
        endDate: Date,
        filters?: { userId?: string; model?: string }
    ): QualityReport {
        let filtered = Array.from(scores.values()).filter(
            s => s.timestamp >= startDate && s.timestamp <= endDate
        );

        if (filters?.userId) {
            filtered = filtered.filter(s => s.userId === filters.userId);
        }
        if (filters?.model) {
            filtered = filtered.filter(s => s.model === filters.model);
        }

        // Calculate averages
        const totalResponses = filtered.length;
        const averageScore = totalResponses > 0
            ? filtered.reduce((sum, s) => sum + s.overallScore, 0) / totalResponses
            : 0;

        // Metric averages
        const metricAverages: QualityMetrics = {
            relevance: 0, accuracy: 0, coherence: 0, helpfulness: 0,
            completeness: 0, conciseness: 0, safety: 0, creativity: 0,
        };

        if (totalResponses > 0) {
            for (const score of filtered) {
                for (const [key, value] of Object.entries(score.metrics)) {
                    metricAverages[key as keyof QualityMetrics] += value / totalResponses;
                }
            }
        }

        // Distribution
        const distribution: { score: number; count: number }[] = [];
        for (let i = 0; i <= 10; i++) {
            const lower = i / 10;
            const upper = (i + 1) / 10;
            const count = filtered.filter(s => s.overallScore >= lower && s.overallScore < upper).length;
            distribution.push({ score: i / 10, count });
        }

        // Top issues
        const issueCount: Record<FeedbackIssue, number> = {} as any;
        for (const score of filtered) {
            if (score.feedback?.issues) {
                for (const issue of score.feedback.issues) {
                    issueCount[issue] = (issueCount[issue] || 0) + 1;
                }
            }
        }
        const topIssues = Object.entries(issueCount)
            .map(([issue, count]) => ({ issue: issue as FeedbackIssue, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // Model comparison
        const modelStats: Record<string, { total: number; count: number }> = {};
        for (const score of filtered) {
            if (!modelStats[score.model]) {
                modelStats[score.model] = { total: 0, count: 0 };
            }
            modelStats[score.model].total += score.overallScore;
            modelStats[score.model].count++;
        }
        const modelComparison = Object.entries(modelStats)
            .map(([model, stats]) => ({
                model,
                avgScore: stats.total / stats.count,
                count: stats.count,
            }))
            .sort((a, b) => b.avgScore - a.avgScore);

        // Trends (daily)
        const dailyScores: Record<string, { total: number; count: number }> = {};
        for (const score of filtered) {
            const date = score.timestamp.toISOString().split("T")[0];
            if (!dailyScores[date]) {
                dailyScores[date] = { total: 0, count: 0 };
            }
            dailyScores[date].total += score.overallScore;
            dailyScores[date].count++;
        }
        const trends = Object.entries(dailyScores)
            .map(([date, stats]) => ({
                date,
                avgScore: stats.total / stats.count,
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        return {
            period: { start: startDate, end: endDate },
            totalResponses,
            averageScore: Math.round(averageScore * 100) / 100,
            metricAverages,
            distribution,
            topIssues,
            modelComparison,
            trends,
        };
    }

    /**
     * Get score for message
     */
    getScore(messageId: string): QualityScore | undefined {
        for (const score of scores.values()) {
            if (score.messageId === messageId) return score;
        }
        return undefined;
    }
}

// ============== Singleton ==============

let qualityInstance: QualityScoringService | null = null;

export function getQualityScoring(): QualityScoringService {
    if (!qualityInstance) {
        qualityInstance = new QualityScoringService();
    }
    return qualityInstance;
}

export default QualityScoringService;
