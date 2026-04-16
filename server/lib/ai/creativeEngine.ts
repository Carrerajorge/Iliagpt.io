/**
 * Creative Engine (Generative Capabilities)
 * Tasks 161-170: Storytelling, brainstorming, art direction, and humor
 */

import { Logger } from '../logger';
import { aiService } from './modelOrchestrator';

// ============================================================================
// Types
// ============================================================================

export interface CreativeBrief {
    params: Record<string, any>;
    style: string;
    constraints: string[];
    inspiration?: string[];
}

// ============================================================================
// Task 161: Narrative Engine
// ============================================================================

export class NarrativeEngine {

    async generateStory(premise: string, genre: string = 'sci-fi'): Promise<string> {
        Logger.info(`[Creative] Generating ${genre} story from premise: ${premise}`);

        // Multi-step generation: Outline -> Draft -> Polish
        const outline = await this.createOutline(premise);

        const response = await aiService.generateCompletion({
            taskId: 'story-write',
            messages: [
                { role: 'system', content: `Write a compelling ${genre} story based on the outline.` },
                { role: 'user', content: `Outline: ${outline}` }
            ],
            requirements: { tier: 'ultra', minContext: 8000 }
        });

        return response.content;
    }

    private async createOutline(premise: string): Promise<string> {
        const response = await aiService.generateCompletion({
            taskId: 'story-outline',
            messages: [
                { role: 'system', content: 'Create a 5-point story arc outline.' },
                { role: 'user', content: premise }
            ],
            requirements: { tier: 'pro' }
        });
        return response.content;
    }
}

// ============================================================================
// Task 164: Creative Brainstorming
// ============================================================================

export class BrainstormingEngine {

    async generateIdeas(topic: string, count: number = 10, lateralThinking: boolean = true): Promise<string[]> {
        const technique = lateralThinking ? 'Use lateral thinking and SCAMPER method.' : 'Use direct logical extension.';

        const response = await aiService.generateCompletion({
            taskId: 'brainstorm',
            messages: [
                { role: 'system', content: `Generate ${count} unique, innovative ideas. ${technique} Return JSON string array.` },
                { role: 'user', content: `Topic: ${topic}` }
            ],
            requirements: { tier: 'ultra', jsonMode: true }
        });

        try {
            return JSON.parse(response.content);
        } catch {
            return ['Error parsing ideas'];
        }
    }
}

// ============================================================================
// Task 168: Art Direction & Visual Prompting
// ============================================================================

export class ArtDirector {

    async enhanceVisualPrompt(basicIdea: string, style: string = 'photorealistic'): Promise<string> {
        const response = await aiService.generateCompletion({
            taskId: 'art-prompt',
            messages: [
                { role: 'system', content: 'You are an expert AI Art prompt engineer (Midjourney/DALL-E 3). Convert the idea into a detailed, high-fidelity prompt with lighting, composition, and style keywords.' },
                { role: 'user', content: `Idea: ${basicIdea}\nStyle: ${style}` }
            ],
            requirements: { tier: 'pro' }
        });

        return response.content;
    }
}

export const storyteller = new NarrativeEngine();
export const brainstormer = new BrainstormingEngine();
export const artDirector = new ArtDirector();
