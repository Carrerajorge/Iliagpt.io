class ChatAgenticCircuit {
  private failures: number[] = [];
  private isOpen = false;
  private openedAt: number | null = null;
  private readonly failureThreshold = 10;
  private readonly windowMs = 60000;
  private readonly cooldownMs = 300000;

  recordFailure(): void {
    const now = Date.now();
    this.failures.push(now);
    this.failures = this.failures.filter(t => now - t < this.windowMs);
    
    if (this.failures.length >= this.failureThreshold && !this.isOpen) {
      this.isOpen = true;
      this.openedAt = now;
      console.warn('[Agentic] Chat circuit opened due to repeated failures');
    }
  }

  recordSuccess(): void {
    this.failures = [];
    if (this.isOpen) {
      this.isOpen = false;
      this.openedAt = null;
      console.info('[Agentic] Chat circuit closed after success');
    }
  }

  isAvailable(): boolean {
    if (!this.isOpen) return true;
    if (this.openedAt && Date.now() - this.openedAt > this.cooldownMs) {
      this.isOpen = false;
      this.openedAt = null;
      return true;
    }
    return false;
  }

  getStatus(): { isOpen: boolean; failures: number; cooldownRemaining: number | null } {
    return {
      isOpen: this.isOpen,
      failures: this.failures.length,
      cooldownRemaining: this.isOpen && this.openedAt ? Math.max(0, this.cooldownMs - (Date.now() - this.openedAt)) : null
    };
  }
}

export const chatAgenticCircuit = new ChatAgenticCircuit();
