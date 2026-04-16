import { globalBroker } from './messageBroker.js';

export interface WorkspaceObservation {
    source: string;
    type: 'perception' | 'reasoning' | 'action_result';
    payload: any;
    confidence: number;
    timestamp: number;
}

export class GlobalWorkspace {
    private blackboard: WorkspaceObservation[] = [];
    private attentionThreshold = 0.7; // Only attend points with >= 0.7 confidence

    constructor() { }

    public initialize() {
        console.log('[GlobalWorkspace] Initializing Blackboard & Attention Mechanism...');
    }

    public publish(observation: WorkspaceObservation) {
        this.blackboard.push(observation);
        this.evaluateAttention(observation);
    }

    private evaluateAttention(observation: WorkspaceObservation) {
        if (observation.confidence >= this.attentionThreshold) {
            console.log(`[GlobalWorkspace] ATTENTION triggered by ${observation.source}:`, observation.type);
            // Brodcast salient information to all connected agents (GWT)
            globalBroker.publishRedisEvent({
                event: 'GWT_BROADCAST',
                salient_data: observation
            });
        }
    }

    public getSalientContext(): WorkspaceObservation[] {
        return this.blackboard.filter(o => o.confidence >= this.attentionThreshold);
    }
}

export const globalWorkspace = new GlobalWorkspace();
