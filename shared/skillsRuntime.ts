export type BundledSkillCategory =
  | "documents"
  | "data"
  | "integrations"
  | "custom"
  | "automation";

export interface BundledSkill {
  id: string;
  name: string;
  description: string;
  category: BundledSkillCategory;
  features?: string[];
  vendor?: string;
  homepage?: string;
}

export type SkillRuntimeStatus =
  | "ready"
  | "needs_setup"
  | "disabled"
  | "catalog_only"
  | "error";

export type SkillCertificationStatus =
  | "runtime"
  | "verified"
  | "uncertified";

export type SkillRuntimeSource = "builtin" | "filesystem" | "catalog";
export type SkillRuntimeSnapshotSource = "remote_runtime" | "fallback";

export interface RuntimeSkillDescriptor {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  status: SkillRuntimeStatus;
  certification: SkillCertificationStatus;
  source: SkillRuntimeSource;
  fallback: boolean;
  tools?: string[];
  filePath?: string;
  updatedAt?: number;
  reason?: string;
  vendor?: string;
  homepage?: string;
}

export interface OpenClawSkillsRuntimeSnapshot {
  runtimeAvailable: boolean;
  source: SkillRuntimeSnapshotSource;
  fallback: boolean;
  fetchedAt: string;
  skills: RuntimeSkillDescriptor[];
  message?: string;
}

export const SKILL_RUNTIME_STATUS_LABELS: Record<SkillRuntimeStatus, string> = {
  ready: "Listo",
  needs_setup: "Config pendiente",
  disabled: "Deshabilitado",
  catalog_only: "Solo catálogo",
  error: "Error runtime",
};

export const SKILL_CERTIFICATION_LABELS: Record<SkillCertificationStatus, string> = {
  runtime: "Runtime",
  verified: "Certificado",
  uncertified: "Sin certificar",
};

export function normalizeOpenClawSkillStatus(
  status?: "ready" | "needs_setup" | "disabled",
): SkillRuntimeStatus {
  if (status === "needs_setup") return "needs_setup";
  if (status === "disabled") return "disabled";
  return "ready";
}

export function createCatalogOnlyRuntimeSkill(skill: BundledSkill): RuntimeSkillDescriptor {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    enabled: false,
    status: "catalog_only",
    certification: "uncertified",
    source: "catalog",
    fallback: true,
    reason: "Listed in catalog, but no executable runtime adapter is currently active.",
    vendor: skill.vendor,
    homepage: skill.homepage,
  };
}
