import { unifiedEventBus } from './unifiedEventBus';
import { actionPredictor } from '../vision/actionPredictor';
import { globalFrameCache } from '../vision/frameCache';
import { hal } from '../native/hal';
import { worldModel } from './worldModel';
import { agentMemory } from './memory';
import { freeEnergy } from './freeEnergy';

export interface AgentContext {
    runId: string;
    objective: string;
    maxSteps: number;
}

export class AutonomousAgentBrain {
    private isRunning = false;
    private currentRunId: string | null = null;

    async startWorkflow(context: AgentContext) {
        if (this.isRunning) throw new Error("Brain is already executing a workflow.");
        this.isRunning = true;
        this.currentRunId = context.runId;

        console.log(`[Brain][T09] Booting Active Inference Engine. Objective: ${context.objective}`);
        await unifiedEventBus.publish('agent.lifecycle.start', { runId: context.runId, objective: context.objective });

        let step = 0;
        let replanCount = 0;

        try {
            while (this.isRunning && step < context.maxSteps) {
                step++;
                // 1. Observe (Sensory input)
                const screenBuffer = await hal.captureScreen();
                globalFrameCache.set(`frame_${step}`, { id: `frame_${step}`, timestamp: Date.now(), buffer: screenBuffer });

                const rawElements = await hal.getElementTree();

                // 2. Predict & Synthesize
                const currentState = `A11y nodes: ${rawElements.length}, Screen Hash: ${screenBuffer.length}`;

                // T09-003: Memory Push & Context Retrieval
                agentMemory.pushShortTerm(`Observed state: ${currentState}`, { runId: context.runId, step });
                const episodicContext = await agentMemory.recallEpisodic(currentState, 1);
                const memoryPrompt = `Short Term: ${agentMemory.getShortTermContext()}\nEpisodic: ${episodicContext.join(' | ')}\nRules: ${agentMemory.getLongTermRules()}`;

                const prediction = await actionPredictor.predictNextAction(`${context.objective}\nContext:\n${memoryPrompt}`, rawElements);

                if (!prediction) {
                    console.warn(`[Brain] No obvious action found. Falling back to MCTS exploration.`);
                    // T09-001: MCTS Expand logic would inject here
                    replanCount++;
                    if (replanCount > 3) throw new Error("Agent Stuck: Exceeded replan threshold.");
                    continue; // Skip to next observation
                }

                // 3. Act
                console.log(`[Brain] Acting on prediction: ${prediction.actionType} on ${prediction.elementId}`);
                await hal.performAction(prediction.elementId, prediction.actionType);

                // 4. Learn (World Model feedback loop)
                const nextScreen = await hal.captureScreen();
                const nextState = `A11y nodes: ${(await hal.getElementTree()).length}`;

                // T09-004: Evaluate Free Energy (Surprise)
                const surprise = await freeEnergy.evaluateSurprise(currentState, prediction, nextState);
                console.log(`[Brain] Action outcome perceived. Free Energy (Surprise): ${(surprise * 100).toFixed(1)}%`);
                await unifiedEventBus.publish('agent.freeEnergy', { runId: context.runId, freeEnergy: surprise });

                // T09-002: World Model Persist
                await worldModel.recordTransition(currentState, prediction, nextState, surprise, 'Objective Segment');

                await new Promise(r => setTimeout(r, 1500)); // Natural interaction delay
            }
        } catch (e: any) {
            console.error(`[Brain] Fatal Error during inference:`, e);
            await unifiedEventBus.publish('agent.lifecycle.error', { runId: context.runId, error: e?.message });
        } finally {
            this.isRunning = false;
            this.currentRunId = null;
            await unifiedEventBus.publish('agent.lifecycle.end', { runId: context.runId, steps: step });
        }
    }

    stopWorkflow() {
        this.isRunning = false;
        console.log(`[Brain] Sent HALT signal.`);
    }
}

export const brain = new AutonomousAgentBrain();
