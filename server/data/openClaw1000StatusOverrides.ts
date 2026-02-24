import type { CapabilityStatus } from "../capabilities/generated/openClaw1000Capabilities.generated";

export interface OpenClaw1000StatusOverride {
  id: number;
  status: CapabilityStatus;
  note?: string;
  updatedAt?: string;
}

/**
 * Runtime status overrides for the OpenClaw1000 backlog.
 * - Use this list to advance capabilities one-by-one to partial/implemented.
 * - Keep entries sorted by id for easier reviews.
 */
export const OPENCLAW_1000_STATUS_OVERRIDES: OpenClaw1000StatusOverride[] = [];

const OPENCLAW_1000_STATUS_OVERRIDES_MAP = new Map<number, CapabilityStatus>(
  OPENCLAW_1000_STATUS_OVERRIDES.map((entry) => [entry.id, entry.status])
);

export function getOpenClaw1000OverrideStatus(id: number): CapabilityStatus | undefined {
  return OPENCLAW_1000_STATUS_OVERRIDES_MAP.get(id);
}
