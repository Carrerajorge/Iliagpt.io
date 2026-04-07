export const ADMIN_SECTIONS = [
  "dashboard",
  "monitoring",
  "users",
  "conversations",
  "ai-models",
  "payments",
  "invoices",
  "analytics",
  "database",
  "security",
  "reports",
  "settings",
  "agentic",
  "excel",
  "terminal",
  "releases",
  "budget",
  "sre",
  "governance",
  "security-dashboard",
  "experiments",
  "voice",
  "data-plane",
  "files",
  "orchestrator",
  "browser",
  "research",
  "observability",
  "chaos",
  "gateway-logs",
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

const ADMIN_SECTION_SLUGS: Record<AdminSection, string> = {
  dashboard: "",
  monitoring: "monitoring",
  users: "users",
  conversations: "conversations",
  "ai-models": "ai-models",
  payments: "payments",
  invoices: "invoices",
  analytics: "analytics",
  database: "database",
  security: "security",
  reports: "reports",
  settings: "settings",
  agentic: "agentic-engine",
  excel: "excel-manager",
  terminal: "terminal",
  releases: "app-releases",
  budget: "budget",
  sre: "sre",
  governance: "governance",
  "security-dashboard": "security-monitor",
  experiments: "model-experiments",
  voice: "voice-plane",
  "data-plane": "data-plane",
  files: "file-plane",
  orchestrator: "superorchestrator",
  browser: "browser-plane",
  research: "deep-research",
  observability: "observability",
  chaos: "chaos-testing",
  "gateway-logs": "gateway-logs",
};

const ADMIN_SECTION_ALIASES: Record<AdminSection, string[]> = {
  dashboard: ["dashboard", "home"],
  monitoring: ["monitoring"],
  users: ["users"],
  conversations: ["conversations"],
  "ai-models": ["ai-models", "ai-model", "models", "ai-models-dashboard"],
  payments: ["payments"],
  invoices: ["invoices"],
  analytics: ["analytics"],
  database: ["database", "db"],
  security: ["security"],
  reports: ["reports"],
  settings: ["settings", "configuration", "configuracion"],
  agentic: ["agentic", "agentic-engine"],
  excel: ["excel", "excel-manager"],
  terminal: ["terminal", "terminal-plane"],
  releases: ["releases", "app-releases"],
  budget: ["budget", "budget-costs", "budget-and-costs"],
  sre: ["sre", "sre-panel"],
  governance: ["governance"],
  "security-dashboard": ["security-dashboard", "security-monitor"],
  experiments: ["experiments", "model-experiments"],
  voice: ["voice", "voice-plane"],
  "data-plane": ["data-plane"],
  files: ["files", "file-plane"],
  orchestrator: ["orchestrator", "superorchestrator", "super-orchestrator"],
  browser: ["browser", "browser-plane"],
  research: ["research", "deep-research"],
  observability: ["observability"],
  chaos: ["chaos", "chaos-testing"],
  "gateway-logs": ["gateway-logs", "logs", "openclaw-logs"],
};

const SECTION_BY_ALIAS = new Map<string, AdminSection>();

for (const section of ADMIN_SECTIONS) {
  SECTION_BY_ALIAS.set(section, section);
  SECTION_BY_ALIAS.set(ADMIN_SECTION_SLUGS[section], section);
  for (const alias of ADMIN_SECTION_ALIASES[section]) {
    SECTION_BY_ALIAS.set(alias, section);
  }
}

export function isAdminSection(value: string | null | undefined): value is AdminSection {
  return Boolean(value) && ADMIN_SECTIONS.includes(value as AdminSection);
}

function normalizeAdminSection(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
}

function resolveAdminSection(value: string | null | undefined): AdminSection | null {
  const normalized = normalizeAdminSection(value);
  if (!normalized) return null;
  return SECTION_BY_ALIAS.get(normalized) ?? null;
}

export function getAdminSectionFromRoute(pathname: string, search: string): AdminSection {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/admin";

  if (normalizedPath.startsWith("/admin/")) {
    const slug = normalizedPath.slice("/admin/".length).split("/")[0];
    const section = resolveAdminSection(slug);
    if (section) {
      return section;
    }
  }

  const querySection = resolveAdminSection(new URLSearchParams(search).get("section"));
  if (querySection) {
    return querySection;
  }

  if (normalizedPath === "/admin") {
    return "dashboard";
  }

  return "dashboard";
}

export function getAdminHref(section: AdminSection): string {
  const slug = ADMIN_SECTION_SLUGS[section];
  return slug ? `/admin/${slug}` : "/admin";
}
