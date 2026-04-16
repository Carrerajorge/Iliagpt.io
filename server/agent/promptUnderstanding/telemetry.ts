/**
 * Telemetry Module
 * 
 * Logs UserSpec extraction results for analysis and model improvement.
 * Tracks discrepancies between extraction and actual execution.
 */

import { UserSpec, ExecutionPlan } from "./types";

export interface TelemetryEvent {
    id: string;
    timestamp: Date;
    type: "extraction" | "verification" | "execution" | "feedback";
    data: Record<string, any>;
}

export interface ExtractionTelemetry {
    requestId: string;
    userId?: string;
    inputText: string;
    inputTokens: number;
    extractedSpec: UserSpec;
    usedLLM: boolean;
    extractionTimeMs: number;
    confidence: number;
}

export interface ExecutionTelemetry {
    requestId: string;
    planId: string;
    stepsPlanned: number;
    stepsExecuted: number;
    stepsFailed: number;
    executionTimeMs: number;
    success: boolean;
}

export interface FeedbackTelemetry {
    requestId: string;
    rating: number; // 1-5
    wasCorrect: boolean;
    userComments?: string;
    corrections?: {
        field: string;
        expected: any;
        actual: any;
    }[];
}

type TelemetryCallback = (event: TelemetryEvent) => void;

class TelemetryCollector {
    private events: TelemetryEvent[] = [];
    private maxEvents: number = 10000;
    private callbacks: TelemetryCallback[] = [];
    private enabled: boolean = true;

    constructor() {
        // Auto-cleanup old events periodically
        setInterval(() => this.cleanup(), 60000);
    }

    enable(): void {
        this.enabled = true;
    }

    disable(): void {
        this.enabled = false;
    }

    onEvent(callback: TelemetryCallback): void {
        this.callbacks.push(callback);
    }

    logExtraction(data: ExtractionTelemetry): void {
        if (!this.enabled) return;

        const event: TelemetryEvent = {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            type: "extraction",
            data
        };

        this.addEvent(event);
        console.log(`[Telemetry:Extraction] ${data.requestId} - confidence: ${data.confidence}, usedLLM: ${data.usedLLM}, time: ${data.extractionTimeMs}ms`);
    }

    logVerification(requestId: string, violations: any[], passed: boolean): void {
        if (!this.enabled) return;

        const event: TelemetryEvent = {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            type: "verification",
            data: { requestId, violations, passed }
        };

        this.addEvent(event);
        console.log(`[Telemetry:Verification] ${requestId} - passed: ${passed}, violations: ${violations.length}`);
    }

    logExecution(data: ExecutionTelemetry): void {
        if (!this.enabled) return;

        const event: TelemetryEvent = {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            type: "execution",
            data
        };

        this.addEvent(event);
        console.log(`[Telemetry:Execution] ${data.requestId} - success: ${data.success}, steps: ${data.stepsExecuted}/${data.stepsPlanned}, time: ${data.executionTimeMs}ms`);
    }

    logFeedback(data: FeedbackTelemetry): void {
        if (!this.enabled) return;

        const event: TelemetryEvent = {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            type: "feedback",
            data
        };

        this.addEvent(event);
        console.log(`[Telemetry:Feedback] ${data.requestId} - rating: ${data.rating}, correct: ${data.wasCorrect}`);
    }

    private addEvent(event: TelemetryEvent): void {
        this.events.push(event);

        // Notify callbacks
        for (const cb of this.callbacks) {
            try {
                cb(event);
            } catch (e) {
                console.error("[Telemetry] Callback error:", e);
            }
        }

        // Enforce max events
        if (this.events.length > this.maxEvents) {
            this.events.splice(0, this.events.length - this.maxEvents);
        }
    }

    private cleanup(): void {
        // Remove events older than 24 hours
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        this.events = this.events.filter(e => e.timestamp > cutoff);
    }

    getEvents(filter?: {
        type?: TelemetryEvent["type"];
        since?: Date;
        limit?: number;
    }): TelemetryEvent[] {
        let results = [...this.events];

        if (filter?.type) {
            results = results.filter(e => e.type === filter.type);
        }
        if (filter?.since) {
            results = results.filter(e => e.timestamp >= filter.since);
        }
        if (filter?.limit) {
            results = results.slice(-filter.limit);
        }

        return results;
    }

    getStats(): {
        totalEvents: number;
        byType: Record<string, number>;
        avgExtractionTime: number;
        avgConfidence: number;
        successRate: number;
    } {
        const byType: Record<string, number> = {};
        let extractionTimes: number[] = [];
        let confidences: number[] = [];
        let executions = 0;
        let successes = 0;

        for (const event of this.events) {
            byType[event.type] = (byType[event.type] || 0) + 1;

            if (event.type === "extraction") {
                extractionTimes.push(event.data.extractionTimeMs);
                confidences.push(event.data.confidence);
            }

            if (event.type === "execution") {
                executions++;
                if (event.data.success) successes++;
            }
        }

        return {
            totalEvents: this.events.length,
            byType,
            avgExtractionTime: extractionTimes.length > 0
                ? extractionTimes.reduce((a, b) => a + b, 0) / extractionTimes.length
                : 0,
            avgConfidence: confidences.length > 0
                ? confidences.reduce((a, b) => a + b, 0) / confidences.length
                : 0,
            successRate: executions > 0 ? successes / executions : 0
        };
    }

    export(): TelemetryEvent[] {
        return [...this.events];
    }

    clear(): void {
        this.events = [];
    }
}

// Singleton instance
export const telemetry = new TelemetryCollector();
