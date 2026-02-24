/**
 * Exocortex Neural Interface API
 * Tasks 521-530: BCI integration, thought-to-text, external cognitive offloading
 */

import { Logger } from '../../logger';
import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export interface NeuralSignal {
    channel: number;
    frequency: number; // Hz (Delta, Theta, Alpha, Beta, Gamma)
    amplitude: number; // uV
    timestamp: number;
}

export interface CognitiveLoad {
    focus: number; // 0-100
    stress: number; // 0-100
    fatigue: number; // 0-100
    zone: 'flow' | 'distracted' | 'overloaded';
}

// ============================================================================
// Task 521: BCI (Brain-Computer Interface) Stream Handler
// ============================================================================

export class ExocortexInterface extends EventEmitter {

    private connectedDevice: string | null = null;
    private buffer: NeuralSignal[] = [];

    connect(deviceId: string) {
        this.connectedDevice = deviceId;
        Logger.info(`[Exocortex] Linked to BCI Device: ${deviceId}`);
        this.emit('connected', { deviceId });
    }

    streamData(signals: NeuralSignal[]) {
        if (!this.connectedDevice) return;

        this.buffer.push(...signals);
        if (this.buffer.length > 1000) {
            this.processBuffer(); // Analyze chunk
            this.buffer = [];
        }
    }

    // ========================================================================
    // Task 525: Cognitive State Analysis (Neurofeedback)
    // ========================================================================

    analyzeState(): CognitiveLoad {
        // Analyze aggregate Beta/Alpha ratios
        // Mock calculation
        const alpha = Math.random() * 50;
        const beta = Math.random() * 50;

        const focus = (beta / (alpha + 1)) * 100;

        let zone: CognitiveLoad['zone'] = 'distracted';
        if (focus > 70) zone = 'flow';
        if (focus < 30) zone = 'overloaded';

        return {
            focus: Math.min(100, focus),
            stress: Math.random() * 40,
            fatigue: Math.random() * 20,
            zone
        };
    }

    // ========================================================================
    // Task 528: Thought-to-Action Bridge
    // ========================================================================

    interpretIntent(recentSignals: NeuralSignal[]): string | null {
        // Pattern matching on P300 signals
        // Mock: 10% chance of detecting a distinct intent
        if (Math.random() > 0.9) {
            const intents = ['SCROLL_DOWN', 'SELECT', 'BACK', 'HOME'];
            return intents[Math.floor(Math.random() * intents.length)];
        }
        return null;
    }
}

export const exocortex = new ExocortexInterface();
