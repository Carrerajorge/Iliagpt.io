import {
  OPENCLAW_1000,
  type CapabilityStatus,
  type OpenClaw1000Capability,
} from "../capabilities/generated/openClaw1000Capabilities.generated";
import { OPENCLAW_500 } from "../data/openClaw500Mapping";
import { getOpenClaw1000OverrideStatus } from "../data/openClaw1000StatusOverrides";

const RUNTIME_STATUS_BY_ID = new Map<number, CapabilityStatus>(
  OPENCLAW_500.map((capability) => [capability.id, capability.status as CapabilityStatus])
);

export function getOpenClaw1000RuntimeStatusById(id: number): CapabilityStatus {
  if (!Number.isFinite(id) || id <= 0) return "missing";
  const overrideStatus = getOpenClaw1000OverrideStatus(id);
  if (overrideStatus) return overrideStatus;
  if (id <= 500) return RUNTIME_STATUS_BY_ID.get(id) || "missing";
  return "missing";
}

export function getOpenClaw1000RuntimeStatus(capability: Pick<OpenClaw1000Capability, "id">): CapabilityStatus {
  return getOpenClaw1000RuntimeStatusById(capability.id);
}

export function toOpenClaw1000RuntimeCapability(capability: OpenClaw1000Capability): OpenClaw1000Capability {
  const runtimeStatus = getOpenClaw1000RuntimeStatus(capability);
  if (capability.status === runtimeStatus) return capability;
  return { ...capability, status: runtimeStatus };
}

export function toOpenClaw1000RuntimeCapabilities(capabilities: OpenClaw1000Capability[]): OpenClaw1000Capability[] {
  return capabilities.map(toOpenClaw1000RuntimeCapability);
}

export function getOpenClaw1000RuntimeStats(capabilities: OpenClaw1000Capability[] = OPENCLAW_1000) {
  const runtimeCaps = toOpenClaw1000RuntimeCapabilities(capabilities);

  let implemented = 0;
  let partial = 0;
  let stub = 0;
  let missing = 0;

  for (const capability of runtimeCaps) {
    if (capability.status === "implemented") implemented += 1;
    else if (capability.status === "partial") partial += 1;
    else if (capability.status === "stub") stub += 1;
    else missing += 1;
  }

  return {
    total: runtimeCaps.length,
    implemented,
    partial,
    stub,
    missing,
  };
}

export function getOpenClaw1000RuntimeGaps(capabilities: OpenClaw1000Capability[] = OPENCLAW_1000) {
  return toOpenClaw1000RuntimeCapabilities(capabilities).filter(
    (capability) => capability.status === "stub" || capability.status === "missing"
  );
}
