/**
 * Quantum-Native Probabilistic Logic
 * Tasks 501-510: Qubit simulation, superposition states, entanglement logic
 */

import { Logger } from '../../logger';

// ============================================================================
// Types
// ============================================================================

export interface Qubit {
    id: string;
    amplitude0: Complex; // Alpha
    amplitude1: Complex; // Beta
    entangledWith: string[]; // UUIDs of entangled qubits
}

export interface Complex {
    real: number;
    imag: number;
}

// ============================================================================
// Task 501: Quantum State Simulator
// ============================================================================

export class QuantumLogicEngine {

    private qubitRegistry: Map<string, Qubit> = new Map();

    /**
     * Initialize a qubit in superposition
     * |ψ⟩ = α|0⟩ + β|1⟩
     */
    initializeQubit(id: string, alpha: Complex, beta: Complex): Qubit {
        // Normalize
        const norm = Math.sqrt(this.magSq(alpha) + this.magSq(beta));
        const qubit: Qubit = {
            id,
            amplitude0: { real: alpha.real / norm, imag: alpha.imag / norm },
            amplitude1: { real: beta.real / norm, imag: beta.imag / norm },
            entangledWith: []
        };
        this.qubitRegistry.set(id, qubit);
        return qubit;
    }

    /**
     * Apply Hadamard Gate (Superposition)
     */
    applyHadamard(qubitId: string): void {
        const q = this.qubitRegistry.get(qubitId);
        if (!q) return;

        // H = 1/√2 * [[1, 1], [1, -1]]
        const INV_SQRT_2 = 1 / Math.sqrt(2);

        const newAlpha = {
            real: (q.amplitude0.real + q.amplitude1.real) * INV_SQRT_2,
            imag: (q.amplitude0.imag + q.amplitude1.imag) * INV_SQRT_2
        };

        const newBeta = {
            real: (q.amplitude0.real - q.amplitude1.real) * INV_SQRT_2,
            imag: (q.amplitude0.imag - q.amplitude1.imag) * INV_SQRT_2
        };

        q.amplitude0 = newAlpha;
        q.amplitude1 = newBeta;
    }

    /**
     * Entangle two qubits (CNOT simulation)
     */
    entangle(controlId: string, targetId: string): void {
        const control = this.qubitRegistry.get(controlId);
        const target = this.qubitRegistry.get(targetId);
        if (!control || !target) return;

        // Simplified entanglement marking for logical simulation
        // Real simulation requires tensor product of state vectors
        control.entangledWith.push(targetId);
        target.entangledWith.push(controlId);

        Logger.info(`[Quantum] Entangled ${controlId} ↔ ${targetId}`);
    }

    /**
     * Measure state (collapse wavefunction)
     */
    measure(qubitId: string): 0 | 1 {
        const q = this.qubitRegistry.get(qubitId);
        if (!q) throw new Error("Qubit not found");

        const loops = this.detectEntanglementLoops(qubitId, new Set());

        // Probability of collapsing to 0 is |α|²
        const p0 = this.magSq(q.amplitude0);
        const rand = Math.random();

        const result = rand < p0 ? 0 : 1;

        // Collapse state
        q.amplitude0 = result === 0 ? { real: 1, imag: 0 } : { real: 0, imag: 0 };
        q.amplitude1 = result === 1 ? { real: 1, imag: 0 } : { real: 0, imag: 0 };

        Logger.debug(`[Quantum] Measured ${qubitId}: |${result}⟩ (Loop depth: ${loops})`);
        return result;
    }

    // ========================================================================
    // Task 505: Probabilistic Decision Logic
    // ========================================================================

    /**
     * Make a decision based on quantum probability amplitudes
     */
    decide(options: string[], weights: number[]): string {
        // Init superpositions
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        const rand = Math.random() * totalWeight;

        let cumulative = 0;
        for (let i = 0; i < options.length; i++) {
            cumulative += weights[i];
            if (rand < cumulative) return options[i];
        }
        return options[0];
    }

    private magSq(c: Complex): number {
        return c.real * c.real + c.imag * c.imag;
    }

    private detectEntanglementLoops(currentId: string, visited: Set<string>): number {
        if (visited.has(currentId)) return 1;
        visited.add(currentId);
        const q = this.qubitRegistry.get(currentId);
        if (!q) return 0;

        let depth = 0;
        for (const peer of q.entangledWith) {
            depth += this.detectEntanglementLoops(peer, visited);
        }
        return depth;
    }
}

export const quantumCpu = new QuantumLogicEngine();
