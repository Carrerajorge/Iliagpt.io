export type ResponseHealthState =
  | "complete"
  | "recovered"
  | "partial"
  | "failed";

export interface ResponseHealthMetadata {
  state: ResponseHealthState;
  retryable?: boolean;
  reason?: string;
  detail?: string;
  provider?: string;
}

export function isResponseHealthState(
  value: unknown,
): value is ResponseHealthState {
  return (
    value === "complete" ||
    value === "recovered" ||
    value === "partial" ||
    value === "failed"
  );
}

export function normalizeResponseHealth(
  value: unknown,
): ResponseHealthMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  if (!isResponseHealthState(raw.state)) {
    return undefined;
  }

  return {
    state: raw.state,
    retryable: raw.retryable === true,
    reason: typeof raw.reason === "string" ? raw.reason : undefined,
    detail: typeof raw.detail === "string" ? raw.detail : undefined,
    provider: typeof raw.provider === "string" ? raw.provider : undefined,
  };
}
