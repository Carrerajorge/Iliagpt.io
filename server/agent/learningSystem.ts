/**
 * Learning System - ILIAGPT PRO 3.0
 * User preference learning and pattern recognition
 */

import { EventEmitter } from "events";

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface Interaction {
    id: string;
    userId: string;
    timestamp: number;
    type: "query" | "tool_use" | "document" | "feedback";
    input: string;
    output?: string;
    toolsUsed?: string[];
    success: boolean;
    feedback?: "positive" | "negative" | "neutral";
    metadata: Record<string, any>;
}

export interface UserPattern {
    userId: string;
    preferredTools: Map<string, number>;
    topicInterests: Map<string, number>;
    timePreferences: { hour: number; count: number }[];
    successRate: number;
    totalInteractions: number;
    lastUpdated: number;
}

export interface LearningInsight {
    type: "preference" | "pattern" | "suggestion";
    userId: string;
    description: string;
    confidence: number;
    data: Record<string, any>;
}

// ============================================================================
// Learning System Class
// ============================================================================

export class LearningSystem extends EventEmitter {
    private interactions: Map<string, Interaction[]> = new Map();
    private patterns: Map<string, UserPattern> = new Map();
    private readonly maxInteractionsPerUser: number;
    private readonly decayFactor: number;

    constructor(
        options: { maxInteractionsPerUser?: number; decayFactor?: number } = {}
    ) {
        super();
        this.maxInteractionsPerUser = options.maxInteractionsPerUser || 500;
        this.decayFactor = options.decayFactor || 0.95;
    }

    // --------------------------------------------------------------------------
    // Interaction Recording
    // --------------------------------------------------------------------------

    recordInteraction(interaction: Omit<Interaction, "id" | "timestamp">): string {
        const id = `int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const fullInteraction: Interaction = {
            ...interaction,
            id,
            timestamp: Date.now(),
        };

        const userId = interaction.userId;
        if (!this.interactions.has(userId)) {
            this.interactions.set(userId, []);
        }

        const userInteractions = this.interactions.get(userId)!;
        userInteractions.push(fullInteraction);

        // Trim to max
        if (userInteractions.length > this.maxInteractionsPerUser) {
            userInteractions.shift();
        }

        this.updatePatterns(userId, fullInteraction);
        this.emit("interaction:recorded", fullInteraction);

        return id;
    }

    recordFeedback(
        interactionId: string,
        userId: string,
        feedback: "positive" | "negative" | "neutral"
    ): boolean {
        const userInteractions = this.interactions.get(userId);
        if (!userInteractions) return false;

        const interaction = userInteractions.find((i) => i.id === interactionId);
        if (!interaction) return false;

        interaction.feedback = feedback;
        this.emit("feedback:recorded", { interactionId, userId, feedback });

        return true;
    }

    // --------------------------------------------------------------------------
    // Pattern Analysis
    // --------------------------------------------------------------------------

    private updatePatterns(userId: string, interaction: Interaction): void {
        let pattern = this.patterns.get(userId);

        if (!pattern) {
            pattern = {
                userId,
                preferredTools: new Map(),
                topicInterests: new Map(),
                timePreferences: [],
                successRate: 0,
                totalInteractions: 0,
                lastUpdated: Date.now(),
            };
            this.patterns.set(userId, pattern);
        }

        // Update tool preferences
        if (interaction.toolsUsed) {
            for (const tool of interaction.toolsUsed) {
                const current = pattern.preferredTools.get(tool) || 0;
                pattern.preferredTools.set(tool, current + 1);
            }
        }

        // Extract topics from input
        const topics = this.extractTopics(interaction.input);
        for (const topic of topics) {
            const current = pattern.topicInterests.get(topic) || 0;
            pattern.topicInterests.set(topic, current + 1);
        }

        // Update time preferences
        const hour = new Date(interaction.timestamp).getHours();
        const timeEntry = pattern.timePreferences.find((t) => t.hour === hour);
        if (timeEntry) {
            timeEntry.count++;
        } else {
            pattern.timePreferences.push({ hour, count: 1 });
        }

        // Update success rate
        pattern.totalInteractions++;
        const successCount =
            (pattern.successRate * (pattern.totalInteractions - 1) +
                (interaction.success ? 1 : 0));
        pattern.successRate = successCount / pattern.totalInteractions;

        pattern.lastUpdated = Date.now();
    }

    private extractTopics(input: string): string[] {
        const topics: string[] = [];
        const lowerInput = input.toLowerCase();

        const topicPatterns: Record<string, RegExp> = {
            research: /research|study|paper|academic|scientific/,
            code: /code|program|function|api|debug/,
            document: /document|word|pdf|excel|presentation/,
            data: /data|analysis|chart|graph|statistics/,
            email: /email|mail|send|message/,
            web: /web|search|browse|url|site/,
        };

        for (const [topic, pattern] of Object.entries(topicPatterns)) {
            if (pattern.test(lowerInput)) {
                topics.push(topic);
            }
        }

        return topics;
    }

    // --------------------------------------------------------------------------
    // Insights & Recommendations
    // --------------------------------------------------------------------------

    getUserPattern(userId: string): UserPattern | null {
        return this.patterns.get(userId) || null;
    }

    getTopTools(userId: string, limit: number = 5): { tool: string; count: number }[] {
        const pattern = this.patterns.get(userId);
        if (!pattern) return [];

        return Array.from(pattern.preferredTools.entries())
            .map(([tool, count]) => ({ tool, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, limit);
    }

    getTopTopics(userId: string, limit: number = 5): { topic: string; count: number }[] {
        const pattern = this.patterns.get(userId);
        if (!pattern) return [];

        return Array.from(pattern.topicInterests.entries())
            .map(([topic, count]) => ({ topic, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, limit);
    }

    generateInsights(userId: string): LearningInsight[] {
        const pattern = this.patterns.get(userId);
        if (!pattern) return [];

        const insights: LearningInsight[] = [];

        // Tool preference insight
        const topTools = this.getTopTools(userId, 3);
        if (topTools.length > 0) {
            insights.push({
                type: "preference",
                userId,
                description: `User frequently uses: ${topTools.map((t) => t.tool).join(", ")}`,
                confidence: Math.min(pattern.totalInteractions / 20, 1),
                data: { tools: topTools },
            });
        }

        // Topic interest insight
        const topTopics = this.getTopTopics(userId, 3);
        if (topTopics.length > 0) {
            insights.push({
                type: "pattern",
                userId,
                description: `Main interests: ${topTopics.map((t) => t.topic).join(", ")}`,
                confidence: Math.min(pattern.totalInteractions / 15, 1),
                data: { topics: topTopics },
            });
        }

        // Time preference insight
        if (pattern.timePreferences.length >= 3) {
            const sorted = [...pattern.timePreferences].sort((a, b) => b.count - a.count);
            const peakHour = sorted[0].hour;
            insights.push({
                type: "pattern",
                userId,
                description: `Most active around ${peakHour}:00`,
                confidence: 0.7,
                data: { peakHour, distribution: pattern.timePreferences },
            });
        }

        return insights;
    }

    suggestTools(userId: string, currentInput: string): string[] {
        const pattern = this.patterns.get(userId);
        if (!pattern) return [];

        const topics = this.extractTopics(currentInput);
        const suggestions: Map<string, number> = new Map();

        // Get interactions related to similar topics
        const userInteractions = this.interactions.get(userId) || [];
        for (const interaction of userInteractions) {
            if (!interaction.toolsUsed || !interaction.success) continue;

            const interactionTopics = this.extractTopics(interaction.input);
            const overlap = topics.filter((t) => interactionTopics.includes(t)).length;

            if (overlap > 0) {
                for (const tool of interaction.toolsUsed) {
                    const score = (suggestions.get(tool) || 0) + overlap;
                    suggestions.set(tool, score);
                }
            }
        }

        return Array.from(suggestions.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([tool]) => tool);
    }

    // --------------------------------------------------------------------------
    // Decay & Cleanup
    // --------------------------------------------------------------------------

    applyDecay(): void {
        for (const pattern of Array.from(this.patterns.values())) {
            for (const [tool, count] of Array.from(pattern.preferredTools.entries())) {
                const decayed = count * this.decayFactor;
                if (decayed < 0.1) {
                    pattern.preferredTools.delete(tool);
                } else {
                    pattern.preferredTools.set(tool, decayed);
                }
            }

            for (const [topic, count] of Array.from(pattern.topicInterests.entries())) {
                const decayed = count * this.decayFactor;
                if (decayed < 0.1) {
                    pattern.topicInterests.delete(topic);
                } else {
                    pattern.topicInterests.set(topic, decayed);
                }
            }
        }

        this.emit("decay:applied");
    }

    reset(userId?: string): void {
        if (userId) {
            this.interactions.delete(userId);
            this.patterns.delete(userId);
        } else {
            this.interactions.clear();
            this.patterns.clear();
        }
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const learningSystem = new LearningSystem();
