/**
 * Emotional Intelligence System
 * Tasks 151-160: Sentiment analysis, empathy engine, personality simulation
 */

import { Logger } from '../logger';
import { aiService } from './modelOrchestrator';

// ============================================================================
// Types
// ============================================================================

export interface EmotionalState {
    valence: number;   // -1 (negative) to 1 (positive)
    arousal: number;   // 0 (calm) to 1 (excited)
    dominance: number; // 0 (submissive) to 1 (dominant)
    primaryEmotion: 'joy' | 'sadness' | 'anger' | 'fear' | 'trust' | 'surprise' | 'anticipation' | 'disgust' | 'neutral';
}

export interface UserProfile {
    id: string;
    baselineState: EmotionalState;
    communicationStyle: 'formal' | 'casual' | 'direct' | 'empathetic';
    triggers: string[];
}

// ============================================================================
// Task 151: Sentiment Analysis Engine
// ============================================================================

export class SentimentEngine {

    async analyze(content: string): Promise<EmotionalState> {
        // In production: Use specialized model or lightweight BERT
        const response = await aiService.generateCompletion({
            taskId: 'sentiment-analysis',
            messages: [
                { role: 'system', content: 'Analyze the emotional content. Return JSON with valence, arousal, dominance (0-1) and primaryEmotion.' },
                { role: 'user', content }
            ],
            requirements: { tier: 'flash', jsonMode: true }
        });

        try {
            return JSON.parse(response.content);
        } catch {
            return { valence: 0, arousal: 0, dominance: 0.5, primaryEmotion: 'neutral' };
        }
    }
}

// ============================================================================
// Task 155: Empathy Response Generator
// ============================================================================

export class EmpathyEngine {

    async generateResponse(
        userContent: string,
        userEmotion: EmotionalState,
        context: string
    ): Promise<string> {

        // Adjust tone based on user emotion
        let toneInstruction = 'neutral';
        if (userEmotion.valence < -0.5) toneInstruction = 'supportive and gentle';
        else if (userEmotion.valence > 0.5) toneInstruction = 'enthusiastic and shared joy';
        else if (userEmotion.arousal > 0.8 && userEmotion.primaryEmotion === 'anger') toneInstruction = 'calm, de-escalating and validating';

        const response = await aiService.generateCompletion({
            taskId: 'empathy-response',
            messages: [
                { role: 'system', content: `You are an empathetic companion. Current user emotion: ${userEmotion.primaryEmotion}. Tone: ${toneInstruction}.` },
                { role: 'user', content: `Context: ${context}\n\nUser said: "${userContent}"\n\nGenerate a compassionate, aligned response:` }
            ],
            requirements: { tier: 'pro' }
        });

        return response.content;
    }
}

// ============================================================================
// Task 158: Dynamic Personality Simulator
// ============================================================================

export class PersonalitySimulator {
    private currentMood: EmotionalState = { valence: 0.5, arousal: 0.5, dominance: 0.5, primaryEmotion: 'joy' };

    updateMood(interaction: string, userEmotion: EmotionalState) {
        // Simple affective computing model
        // 1. Emotional Contagion: Move closer to user emotion
        const contagionFactor = 0.2;
        this.currentMood.valence = this.currentMood.valence * (1 - contagionFactor) + userEmotion.valence * contagionFactor;
        this.currentMood.arousal = this.currentMood.arousal * (1 - contagionFactor) + userEmotion.arousal * contagionFactor;

        Logger.debug(`[Personality] Mood updated: Valence ${this.currentMood.valence.toFixed(2)}`);
    }

    getPersonaPrompt(basePersona: string): string {
        // Modify base persona prompt based on current mood
        let moodModifier = "";
        if (this.currentMood.valence > 0.6) moodModifier = "You are currently in a great mood, optimistic and energetic.";
        else if (this.currentMood.valence < 0.2) moodModifier = "You are feeling pensive and serious, focusing on deep reflection.";

        return `${basePersona}\n${moodModifier}`;
    }
}

export const sentiment = new SentimentEngine();
export const empathy = new EmpathyEngine();
export const personality = new PersonalitySimulator();
