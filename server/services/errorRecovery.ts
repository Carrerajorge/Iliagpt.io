export interface CircuitState {
  name: string;
  status: 'closed' | 'open' | 'half-open';
  failures: number;
  successes: number;
  lastFailure: number | null;
  lastSuccess: number | null;
  openedAt: number | null;
}

export class ErrorRecovery {
  private circuits: Map<string, CircuitState> = new Map();
  private readonly failureThreshold = 5;
  private readonly resetTimeout = 30000;
  private readonly halfOpenSuccesses = 2;

  getOrCreateCircuit(name: string): CircuitState {
    if (!this.circuits.has(name)) {
      this.circuits.set(name, {
        name,
        status: 'closed',
        failures: 0,
        successes: 0,
        lastFailure: null,
        lastSuccess: null,
        openedAt: null
      });
    }
    return this.circuits.get(name)!;
  }

  recordSuccess(name: string): void {
    const circuit = this.getOrCreateCircuit(name);
    circuit.successes++;
    circuit.lastSuccess = Date.now();

    if (circuit.status === 'half-open') {
      if (circuit.successes >= this.halfOpenSuccesses) {
        circuit.status = 'closed';
        circuit.failures = 0;
        circuit.successes = 0;
        circuit.openedAt = null;
      }
    } else if (circuit.status === 'closed') {
      circuit.failures = 0;
    }
  }

  recordFailure(name: string): void {
    const circuit = this.getOrCreateCircuit(name);
    circuit.failures++;
    circuit.lastFailure = Date.now();
    circuit.successes = 0;

    if (circuit.status === 'closed' && circuit.failures >= this.failureThreshold) {
      circuit.status = 'open';
      circuit.openedAt = Date.now();
    } else if (circuit.status === 'half-open') {
      circuit.status = 'open';
      circuit.openedAt = Date.now();
    }
  }

  canExecute(name: string): boolean {
    const circuit = this.getOrCreateCircuit(name);

    if (circuit.status === 'closed') return true;

    if (circuit.status === 'open') {
      const elapsed = Date.now() - (circuit.openedAt || 0);
      if (elapsed >= this.resetTimeout) {
        circuit.status = 'half-open';
        circuit.successes = 0;
        return true;
      }
      return false;
    }

    return true;
  }

  async executeWithFallback<T>(
    name: string,
    operation: () => Promise<T>,
    fallback: () => Promise<T>
  ): Promise<T> {
    if (!this.canExecute(name)) {
      return fallback();
    }

    try {
      const result = await operation();
      this.recordSuccess(name);
      return result;
    } catch (error) {
      this.recordFailure(name);
      if (!this.canExecute(name)) {
        return fallback();
      }
      throw error;
    }
  }

  getAllCircuits(): CircuitState[] {
    return Array.from(this.circuits.values());
  }

  resetCircuit(name: string): void {
    const circuit = this.getOrCreateCircuit(name);
    circuit.status = 'closed';
    circuit.failures = 0;
    circuit.successes = 0;
    circuit.openedAt = null;
  }
}

export const errorRecovery = new ErrorRecovery();
