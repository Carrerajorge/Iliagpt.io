interface PipelineMetricsState {
  emitted: number;
  dropped: number;
  flushed: number;
  failed: number;
  queueDepth: number;
  maxQueueDepth: number;
  lastFlushAt: number;
}

const state: PipelineMetricsState = {
  emitted: 0,
  dropped: 0,
  flushed: 0,
  failed: 0,
  queueDepth: 0,
  maxQueueDepth: 0,
  lastFlushAt: 0,
};

export const pipelineMetrics = {
  recordEmitted() {
    state.emitted += 1;
    state.queueDepth = Math.max(0, state.queueDepth + 1);
    if (state.queueDepth > state.maxQueueDepth) {
      state.maxQueueDepth = state.queueDepth;
    }
  },
  recordDropped() {
    state.dropped += 1;
    state.queueDepth = Math.max(0, state.queueDepth - 1);
  },
  recordFlushed() {
    state.flushed += 1;
    state.queueDepth = Math.max(0, state.queueDepth - 1);
    state.lastFlushAt = Date.now();
  },
  recordFailed() {
    state.failed += 1;
    state.queueDepth = Math.max(0, state.queueDepth - 1);
  },
  getSnapshot() {
    return {
      emitted: state.emitted,
      dropped: state.dropped,
      flushed: state.flushed,
      failed: state.failed,
      queueDepth: state.queueDepth,
      maxQueueDepth: state.maxQueueDepth,
      lastFlushAt: state.lastFlushAt,
    };
  },
  reset() {
    state.emitted = 0;
    state.dropped = 0;
    state.flushed = 0;
    state.failed = 0;
    state.queueDepth = 0;
    state.maxQueueDepth = 0;
    state.lastFlushAt = 0;
  },
};

