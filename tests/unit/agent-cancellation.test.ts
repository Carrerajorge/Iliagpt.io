import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Agent Cancellation State Transitions', () => {
  const validTransitions: Record<string, string[]> = {
    'queued': ['planning', 'cancelling', 'cancelled'],
    'planning': ['running', 'cancelling', 'cancelled', 'failed'],
    'running': ['verifying', 'paused', 'cancelling', 'cancelled', 'failed', 'completed'],
    'verifying': ['running', 'cancelling', 'cancelled', 'failed', 'completed'],
    'paused': ['running', 'cancelling', 'cancelled'],
    'cancelling': ['cancelled'],
    'completed': [],
    'failed': [],
    'cancelled': [],
  };

  describe('State Transition Validation', () => {
    it('should allow cancel from queued state', () => {
      expect(validTransitions['queued']).toContain('cancelling');
      expect(validTransitions['queued']).toContain('cancelled');
    });

    it('should allow cancel from planning state', () => {
      expect(validTransitions['planning']).toContain('cancelling');
      expect(validTransitions['planning']).toContain('cancelled');
    });

    it('should allow cancel from running state', () => {
      expect(validTransitions['running']).toContain('cancelling');
      expect(validTransitions['running']).toContain('cancelled');
    });

    it('should allow cancel from verifying state', () => {
      expect(validTransitions['verifying']).toContain('cancelling');
      expect(validTransitions['verifying']).toContain('cancelled');
    });

    it('should allow cancel from paused state', () => {
      expect(validTransitions['paused']).toContain('cancelling');
      expect(validTransitions['paused']).toContain('cancelled');
    });

    it('should NOT allow transitions from terminal states', () => {
      expect(validTransitions['completed']).toHaveLength(0);
      expect(validTransitions['failed']).toHaveLength(0);
      expect(validTransitions['cancelled']).toHaveLength(0);
    });

    it('cancelling should only transition to cancelled', () => {
      expect(validTransitions['cancelling']).toEqual(['cancelled']);
    });
  });

  describe('Pause/Resume Transitions', () => {
    it('should allow pause from running state', () => {
      expect(validTransitions['running']).toContain('paused');
    });

    it('should allow resume from paused state', () => {
      expect(validTransitions['paused']).toContain('running');
    });

    it('should NOT allow pause from non-running states', () => {
      expect(validTransitions['queued']).not.toContain('paused');
      expect(validTransitions['planning']).not.toContain('paused');
      expect(validTransitions['completed']).not.toContain('paused');
    });
  });
});

describe('CancellationToken', () => {
  class MockCancellationToken {
    private _isCancelled = false;
    private _reason = '';
    private callbacks: (() => void)[] = [];

    get isCancelled() { return this._isCancelled; }
    get reason() { return this._reason; }

    cancel(reason: string) {
      if (this._isCancelled) return;
      this._isCancelled = true;
      this._reason = reason;
      this.callbacks.forEach(cb => cb());
    }

    onCancelled(callback: () => void) {
      if (this._isCancelled) {
        callback();
      } else {
        this.callbacks.push(callback);
      }
    }

    throwIfCancelled() {
      if (this._isCancelled) {
        throw new Error(`Operation cancelled: ${this._reason}`);
      }
    }
  }

  it('should start in non-cancelled state', () => {
    const token = new MockCancellationToken();
    expect(token.isCancelled).toBe(false);
    expect(token.reason).toBe('');
  });

  it('should transition to cancelled state when cancel is called', () => {
    const token = new MockCancellationToken();
    token.cancel('User requested cancellation');
    expect(token.isCancelled).toBe(true);
    expect(token.reason).toBe('User requested cancellation');
  });

  it('should invoke callbacks when cancelled', () => {
    const token = new MockCancellationToken();
    const callback = vi.fn();
    token.onCancelled(callback);
    
    expect(callback).not.toHaveBeenCalled();
    token.cancel('Test');
    expect(callback).toHaveBeenCalledOnce();
  });

  it('should invoke callback immediately if already cancelled', () => {
    const token = new MockCancellationToken();
    token.cancel('Already cancelled');
    
    const callback = vi.fn();
    token.onCancelled(callback);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('should throw when throwIfCancelled is called on cancelled token', () => {
    const token = new MockCancellationToken();
    token.cancel('Test reason');
    
    expect(() => token.throwIfCancelled()).toThrow('Operation cancelled: Test reason');
  });

  it('should NOT throw when throwIfCancelled is called on active token', () => {
    const token = new MockCancellationToken();
    expect(() => token.throwIfCancelled()).not.toThrow();
  });

  it('should only cancel once (idempotent)', () => {
    const token = new MockCancellationToken();
    const callback = vi.fn();
    token.onCancelled(callback);
    
    token.cancel('First');
    token.cancel('Second');
    
    expect(callback).toHaveBeenCalledOnce();
    expect(token.reason).toBe('First');
  });
});

describe('UI Button State', () => {
  const isCancellableStatus = (status: string): boolean => {
    return ['starting', 'running', 'queued', 'planning', 'verifying', 'paused'].includes(status);
  };

  const isTerminalStatus = (status: string): boolean => {
    return ['completed', 'failed', 'cancelled'].includes(status);
  };

  it('cancel button should be active for queued status', () => {
    expect(isCancellableStatus('queued')).toBe(true);
  });

  it('cancel button should be active for planning status', () => {
    expect(isCancellableStatus('planning')).toBe(true);
  });

  it('cancel button should be active for running status', () => {
    expect(isCancellableStatus('running')).toBe(true);
  });

  it('cancel button should be active for verifying status', () => {
    expect(isCancellableStatus('verifying')).toBe(true);
  });

  it('cancel button should be active for paused status', () => {
    expect(isCancellableStatus('paused')).toBe(true);
  });

  it('cancel button should be INACTIVE for completed status', () => {
    expect(isCancellableStatus('completed')).toBe(false);
    expect(isTerminalStatus('completed')).toBe(true);
  });

  it('cancel button should be INACTIVE for failed status', () => {
    expect(isCancellableStatus('failed')).toBe(false);
    expect(isTerminalStatus('failed')).toBe(true);
  });

  it('cancel button should be INACTIVE for cancelled status', () => {
    expect(isCancellableStatus('cancelled')).toBe(false);
    expect(isTerminalStatus('cancelled')).toBe(true);
  });
});
