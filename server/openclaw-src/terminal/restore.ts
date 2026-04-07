export function restoreTerminalState(
  _reason?: string,
  _options?: { resumeStdinIfPaused?: boolean },
): void {
  // No-op fallback for local/dev environments where terminal restoration
  // helpers are unavailable in the current OpenClaw source snapshot.
}
