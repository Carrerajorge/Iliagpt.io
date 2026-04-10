/**
 * Office Engine feature gating.
 *
 * The product already routes DOCX generation through the Office Engine from
 * chat. To avoid a half-enabled state where chat can create runs but the HTTP
 * surface (/api/office-engine/*) is missing, the engine is enabled by default
 * unless it is explicitly turned off.
 */

function normalizeBooleanEnv(value: string | undefined): boolean | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  return null;
}

export function isOfficeEngineEnabled(): boolean {
  const configured = normalizeBooleanEnv(process.env.FEATURE_OFFICE_ENGINE);
  return configured ?? true;
}
