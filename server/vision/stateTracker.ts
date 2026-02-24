import { unifiedEventBus } from '../agent/unifiedEventBus';
import { FrameAnalysis } from './elementDetector';
import { createTraceEvent } from '@shared/schema';

export type DesktopState = 'IDLE' | 'USER_ACTIVE' | 'AGENT_EXECUTING' | 'WAITING_RESPONSE' | 'ERROR_DETECTED' | 'VERIFICATION';

export interface StateTransition {
    from: DesktopState;
    to: DesktopState;
    timestamp: number;
    trigger: string;
}

export class DesktopStateTracker {
    private state: DesktopState = 'IDLE';
    private history: StateTransition[] = [];
    private readonly MAX_HISTORY = 100;

    async updateFromAnalysis(analysis: FrameAnalysis | any): Promise<void> {
        if (!analysis || !analysis.semanticState) return;

        const previousState = this.state;
        this.state = this.inferState(analysis);

        if (this.state !== previousState) {
            const transition: StateTransition = {
                from: previousState,
                to: this.state,
                timestamp: Date.now(),
                trigger: analysis.semanticState,
            };

            this.history.push(transition);
            if (this.history.length > this.MAX_HISTORY) {
                this.history.shift();
            }

            // Emitir traza estandarizada para BD y EventBus
            unifiedEventBus.emit('trace', createTraceEvent(
                'observation',
                'system-vision-loop',
                {
                    metadata: {
                        from: previousState,
                        to: this.state,
                        trigger: analysis.semanticState
                    },
                    summary: analysis.semanticState
                }
            ));
        }
    }

    private inferState(analysis: FrameAnalysis): DesktopState {
        const textLower = analysis.semanticState.toLowerCase();

        if (textLower.includes('error') || textLower.includes('fail') || textLower.includes('crash')) {
            return 'ERROR_DETECTED';
        }

        if (textLower.includes('typing') || textLower.includes('clicking') || textLower.includes('user is moving')) {
            return 'USER_ACTIVE';
        }

        if (textLower.includes('loading') || textLower.includes('waiting')) {
            return 'WAITING_RESPONSE';
        }

        if (analysis.actionableItems && analysis.actionableItems.length > 0) {
            return 'VERIFICATION';
        }

        return 'IDLE';
    }

    getCurrentState(): DesktopState {
        return this.state;
    }

    getHistoryDump(): StateTransition[] {
        return [...this.history];
    }
}

export const stateTracker = new DesktopStateTracker();
