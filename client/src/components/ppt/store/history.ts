export type HistoryState<T> = {
  past: T[];
  present: T;
  future: T[];
};

export function createHistory<T>(initial: T): HistoryState<T> {
  return { past: [], present: initial, future: [] };
}

export function pushHistory<T>(h: HistoryState<T>, next: T, limit = 80): HistoryState<T> {
  const past = [...h.past, h.present];
  if (past.length > limit) past.shift();
  return { past, present: next, future: [] };
}

export function undoHistory<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.past.length === 0) return h;
  const prev = h.past[h.past.length - 1];
  const past = h.past.slice(0, -1);
  const future = [h.present, ...h.future];
  return { past, present: prev, future };
}

export function redoHistory<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.future.length === 0) return h;
  const next = h.future[0];
  const future = h.future.slice(1);
  const past = [...h.past, h.present];
  return { past, present: next, future };
}

export function canUndo<T>(h: HistoryState<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: HistoryState<T>): boolean {
  return h.future.length > 0;
}
