import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
  buildOpenClaw1000CapabilityProfile,
  type OpenClaw1000CapabilityProfile,
} from "./openClaw1000CapabilityProfiler";

export type SuperProgrammingCapabilityId =
  | "objective_translation"
  | "architecture_design"
  | "implementation"
  | "testing_quality"
  | "code_review_security"
  | "delivery_cicd"
  | "prod_observability"
  | "performance_finops"
  | "tooling_coordination"
  | "engineering_memory"
  | "roadmap_debt_management"
  | "governance_guardrails";

export type CapabilityStatus = "implemented" | "partial" | "missing";
export type TaskPriority = "critical" | "high" | "medium";
export type PlanPhaseId = "foundation" | "delivery" | "reliability" | "scale";
export type RunMode = "dry-run" | "live";
export type RunStatus = "running" | "completed" | "failed";
export type RunStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

interface PathAnyCheckDefinition {
  kind: "path_any";
  id: string;
  label: string;
  weight: number;
  anyOf: string[];
  remediation: string;
}

interface FileContainsCheckDefinition {
  kind: "file_contains";
  id: string;
  label: string;
  weight: number;
  file: string;
  allOf: string[];
  remediation: string;
}

type CapabilityCheckDefinition = PathAnyCheckDefinition | FileContainsCheckDefinition;

interface CapabilityDefinition {
  id: SuperProgrammingCapabilityId;
  phase: PlanPhaseId;
  name: string;
  description: string;
  owners: string[];
  checks: CapabilityCheckDefinition[];
  defaultActions: string[];
}

export interface CapabilityCheckResult {
  id: string;
  label: string;
  weight: number;
  passed: boolean;
  evidence?: string;
  remediation: string;
}

export interface CapabilityAssessment {
  id: SuperProgrammingCapabilityId;
  name: string;
  description: string;
  phase: PlanPhaseId;
  score: number;
  status: CapabilityStatus;
  owners: string[];
  checks: CapabilityCheckResult[];
  gaps: string[];
  recommendedActions: string[];
}

export interface SuperProgrammingAssessment {
  assessmentId: string;
  generatedAt: number;
  projectRoot: string;
  objective?: string;
  overallScore: number;
  maturity: CapabilityStatus;
  summary: {
    implemented: number;
    partial: number;
    missing: number;
  };
  capabilities: CapabilityAssessment[];
  priorities: Array<{
    capabilityId: SuperProgrammingCapabilityId;
    score: number;
    reason: string;
  }>;
  openClawProfile: {
    totalMatched: number;
    categories: Array<{ category: string; count: number }>;
    recommendedTools: string[];
  };
}

export interface SuperProgrammingTask {
  id: string;
  capabilityId: SuperProgrammingCapabilityId;
  capabilityName: string;
  title: string;
  description: string;
  owner: string;
  priority: TaskPriority;
  dispatchQuery: string;
  acceptanceCriteria: string[];
  estimatedImpact: number;
}

export interface SuperProgrammingPlanPhase {
  id: PlanPhaseId;
  name: string;
  description: string;
  targetCapabilities: SuperProgrammingCapabilityId[];
  tasks: SuperProgrammingTask[];
}

export interface SuperProgrammingPlan {
  planId: string;
  createdAt: number;
  objective: string;
  targetMaturity: number;
  assessment: SuperProgrammingAssessment;
  phases: SuperProgrammingPlanPhase[];
  priorityBacklog: SuperProgrammingTask[];
  guardrails: string[];
  estimatedWeeks: number;
}

export interface SuperProgrammingRunStep {
  id: string;
  task: SuperProgrammingTask;
  status: RunStepStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  output?: unknown;
}

export interface SuperProgrammingRun {
  runId: string;
  createdAt: number;
  updatedAt: number;
  mode: RunMode;
  status: RunStatus;
  objective: string;
  planId: string;
  steps: SuperProgrammingRunStep[];
  summary: {
    total: number;
    completed: number;
    failed: number;
    skipped: number;
    durationMs: number;
  };
}

export interface BuildPlanOptions {
  targetMaturity?: number;
}

export interface RunPlanOptions {
  dryRun?: boolean;
  maxTasks?: number;
  stopOnFailure?: boolean;
}

const CAPABILITY_DEFINITIONS: CapabilityDefinition[] = [
  {
    id: "objective_translation",
    phase: "foundation",
    name: "Objective Translation",
    description: "Traduce objetivos de negocio en specs técnicas ejecutables y verificables.",
    owners: ["orchestrator", "product-analyst"],
    checks: [
      {
        kind: "path_any",
        id: "request-understanding-pipeline",
        label: "Pipeline de entendimiento de solicitud",
        weight: 35,
        anyOf: ["server/routes/requestUnderstandingRoutes.ts", "server/agent/requestUnderstanding.ts"],
        remediation: "Agregar un pipeline de entendimiento antes de planificar ejecución.",
      },
      {
        kind: "path_any",
        id: "chat-routing",
        label: "Routing de intención/complejidad",
        weight: 30,
        anyOf: ["server/routes/chatRoutes.ts", "server/agent/agentRouter.ts"],
        remediation: "Introducir análisis de intención y complejidad para enrutar al agente correcto.",
      },
      {
        kind: "file_contains",
        id: "agentic-tests",
        label: "Pruebas específicas de flujo agentic",
        weight: 35,
        file: "package.json",
        allOf: ["test:agentic", "test:agentic:integration"],
        remediation: "Agregar scripts y pruebas para validar la traducción de objetivos a ejecución.",
      },
    ],
    defaultActions: [
      "Definir contrato de entrada/salida por objetivo (spec, constraints, acceptance checks).",
      "Añadir validación determinística previa a ejecutar herramientas con side effects.",
    ],
  },
  {
    id: "architecture_design",
    phase: "delivery",
    name: "Architecture Design",
    description: "Diseña arquitectura end-to-end con tradeoffs explícitos.",
    owners: ["system-architect", "orchestrator"],
    checks: [
      {
        kind: "path_any",
        id: "architecture-docs",
        label: "Documentación de arquitectura/ADRs",
        weight: 30,
        anyOf: ["docs/SYSTEM_OVERVIEW.md", "docs/adrs"],
        remediation: "Documentar decisiones de arquitectura y tradeoffs en ADRs.",
      },
      {
        kind: "path_any",
        id: "orchestrator-planner",
        label: "Planificador/orquestador de arquitectura",
        weight: 40,
        anyOf: ["server/agent/orchestrator/planner.ts", "server/agent/superAgent/orchestrator.ts"],
        remediation: "Implementar capa de planificación de arquitectura antes de ejecutar subtareas.",
      },
      {
        kind: "path_any",
        id: "shared-schemas",
        label: "Modelado de dominios y contratos",
        weight: 30,
        anyOf: ["shared/schema/index.ts", "shared/schema/agent.ts"],
        remediation: "Definir schemas compartidos para contratos de dominio.",
      },
    ],
    defaultActions: [
      "Forzar revisión de tradeoffs en cada diseño (latencia, costo, seguridad, mantenibilidad).",
      "Validar impacto de cambios arquitectónicos sobre rutas críticas y datos.",
    ],
  },
  {
    id: "implementation",
    phase: "delivery",
    name: "Cross-stack Implementation",
    description: "Implementa código end-to-end en backend, frontend e integraciones.",
    owners: ["code-agent", "fullstack-agent"],
    checks: [
      {
        kind: "path_any",
        id: "core-app",
        label: "Entrypoints backend/frontend",
        weight: 35,
        anyOf: ["server/index.ts", "client/src/main.tsx"],
        remediation: "Establecer estructura base backend/frontend para ejecución end-to-end.",
      },
      {
        kind: "path_any",
        id: "build-pipeline",
        label: "Pipeline de build",
        weight: 30,
        anyOf: ["script/build.ts", "package.json"],
        remediation: "Agregar pipeline de build reproducible para todo el stack.",
      },
      {
        kind: "path_any",
        id: "execution-engine",
        label: "Motor de ejecución agentic",
        weight: 35,
        anyOf: ["server/agent/orchestrator/executor.ts", "server/routes/toolExecutionRouter.ts"],
        remediation: "Crear motor de ejecución modular para tareas compuestas.",
      },
    ],
    defaultActions: [
      "Agregar plantillas de implementación reutilizable por tipo de feature.",
      "Bloquear merges sin validación de compilación de backend y frontend.",
    ],
  },
  {
    id: "testing_quality",
    phase: "delivery",
    name: "Testing & Quality",
    description: "Asegura cobertura de pruebas unitarias, integración y e2e.",
    owners: ["qa-agent", "code-agent"],
    checks: [
      {
        kind: "path_any",
        id: "unit-integration-tests",
        label: "Suite de tests unitarios/integración",
        weight: 40,
        anyOf: ["tests", "server/agent/orchestrator/__tests__"],
        remediation: "Agregar pruebas unitarias e integración para rutas y agentes críticos.",
      },
      {
        kind: "path_any",
        id: "e2e-tests",
        label: "Pruebas e2e",
        weight: 30,
        anyOf: ["e2e", "playwright.config.ts"],
        remediation: "Incorporar pruebas e2e para flujos con usuario real.",
      },
      {
        kind: "file_contains",
        id: "coverage-scripts",
        label: "Scripts de cobertura y quality gate",
        weight: 30,
        file: "package.json",
        allOf: ["test:coverage", "quality:gate"],
        remediation: "Agregar cobertura y quality gate en pipeline CI.",
      },
    ],
    defaultActions: [
      "Definir umbrales mínimos de cobertura por capa.",
      "Agregar pruebas de regresión para bugs críticos cerrados.",
    ],
  },
  {
    id: "code_review_security",
    phase: "delivery",
    name: "Code Review & Security",
    description: "Aplica revisión automática de bugs, seguridad y mantenibilidad.",
    owners: ["security-agent", "reviewer-agent"],
    checks: [
      {
        kind: "path_any",
        id: "linting-hooks",
        label: "Lint + hooks pre-commit",
        weight: 30,
        anyOf: ["eslint.config.js", ".husky/pre-commit"],
        remediation: "Configurar linting obligatorio y hooks en pre-commit.",
      },
      {
        kind: "path_any",
        id: "security-policies",
        label: "Políticas y documentación de seguridad",
        weight: 30,
        anyOf: ["SECURITY.md", "docs/ciberseguridad_critica.md"],
        remediation: "Definir políticas de seguridad y checklist de hardening.",
      },
      {
        kind: "path_any",
        id: "security-routes",
        label: "Capacidades runtime de seguridad",
        weight: 40,
        anyOf: ["server/routes/securityRouter.ts", "server/services/superIntelligence/audit"],
        remediation: "Añadir validaciones runtime y auditoría de eventos sensibles.",
      },
    ],
    defaultActions: [
      "Añadir revisión de secretos, dependencias vulnerables y permisos en PRs.",
      "Aumentar pruebas de seguridad sobre endpoints de ejecución/autonomía.",
    ],
  },
  {
    id: "delivery_cicd",
    phase: "reliability",
    name: "CI/CD & Progressive Delivery",
    description: "Automatiza integración, despliegue gradual y rollback.",
    owners: ["devops-agent", "release-agent"],
    checks: [
      {
        kind: "path_any",
        id: "ci-workflows",
        label: "Workflows CI",
        weight: 35,
        anyOf: [".github/workflows", "scripts/test-all.sh"],
        remediation: "Configurar workflows CI con validaciones de build/test/security.",
      },
      {
        kind: "path_any",
        id: "deployment-assets",
        label: "Assets de despliegue",
        weight: 35,
        anyOf: ["Dockerfile", "docker-compose.yml"],
        remediation: "Definir artefactos de despliegue reproducibles y versionados.",
      },
      {
        kind: "path_any",
        id: "release-automation",
        label: "Scripts de release/rollback",
        weight: 30,
        anyOf: ["deploy.sh", "scripts/prod-rigorous-checks.sh"],
        remediation: "Agregar scripts de release con validación previa y rollback automático.",
      },
    ],
    defaultActions: [
      "Implementar despliegues por etapas con feature flags para cambios críticos.",
      "Añadir validación post-deploy y rollback automático por health checks.",
    ],
  },
  {
    id: "prod_observability",
    phase: "reliability",
    name: "Production Observability",
    description: "Monitorea métricas, trazas, alertas y salud de producción.",
    owners: ["sre-agent", "observability-agent"],
    checks: [
      {
        kind: "path_any",
        id: "observability-stack",
        label: "Stack observabilidad",
        weight: 40,
        anyOf: ["observability/prometheus/prometheus.yml", "observability/dashboards"],
        remediation: "Configurar stack de observabilidad con métricas y dashboards.",
      },
      {
        kind: "path_any",
        id: "metrics-endpoints",
        label: "Endpoints de métricas/health",
        weight: 30,
        anyOf: ["server/routes/metricsRouter.ts", "server/routes/healthRouter.ts"],
        remediation: "Exponer endpoints de health y métricas con SLOs.",
      },
      {
        kind: "path_any",
        id: "runbooks-alerts",
        label: "Runbooks y alerting",
        weight: 30,
        anyOf: ["observability/runbooks", "observability/alerts"],
        remediation: "Crear runbooks y alertas accionables para incidentes frecuentes.",
      },
    ],
    defaultActions: [
      "Alinear alertas con SLOs por componente crítico.",
      "Integrar trazabilidad completa de ejecución agentic en producción.",
    ],
  },
  {
    id: "performance_finops",
    phase: "reliability",
    name: "Performance & FinOps",
    description: "Optimiza latencia, consumo de recursos y costo cloud.",
    owners: ["performance-agent", "finops-agent"],
    checks: [
      {
        kind: "path_any",
        id: "finops-routing",
        label: "Rutas de finops y costo",
        weight: 35,
        anyOf: ["server/routes/finopsRouter.ts", "server/services/costTracking.ts"],
        remediation: "Implementar telemetría de costo por feature/modelo.",
      },
      {
        kind: "path_any",
        id: "analytics-performance",
        label: "Servicios analíticos de performance",
        weight: 35,
        anyOf: ["server/services/advancedAnalytics.ts", "server/services/costOptimizer.ts"],
        remediation: "Agregar análisis de performance y optimización de costo continua.",
      },
      {
        kind: "file_contains",
        id: "performance-scripts",
        label: "Scripts de verificación rigurosa",
        weight: 30,
        file: "package.json",
        allOf: ["verify:prod", "test:prod:agentic100"],
        remediation: "Añadir pruebas de performance/costo dentro de CI/CD.",
      },
    ],
    defaultActions: [
      "Definir presupuesto por servicio y alarmas por desviación.",
      "Optimizar rutas de alta latencia con caché y batching de llamadas LLM.",
    ],
  },
  {
    id: "tooling_coordination",
    phase: "scale",
    name: "Tooling Coordination",
    description: "Coordina herramientas del ecosistema (repo, tickets, nube, mensajería).",
    owners: ["integration-agent", "orchestrator"],
    checks: [
      {
        kind: "path_any",
        id: "tool-registry",
        label: "Registro central de tools",
        weight: 40,
        anyOf: ["server/agent/toolRegistry.ts", "server/agent/registry/toolRegistry.ts"],
        remediation: "Consolidar inventario central de tools y capacidades.",
      },
      {
        kind: "path_any",
        id: "integration-routes",
        label: "Integraciones externas",
        weight: 30,
        anyOf: ["server/routes/appsIntegrationRouter.ts", "server/routes/connectorRouter.ts"],
        remediation: "Crear conectores estándar para sistemas externos.",
      },
      {
        kind: "path_any",
        id: "agent-ecosystem",
        label: "Ecosistema multiagente",
        weight: 30,
        anyOf: ["server/routes/agentEcosystemRouter.ts", "server/routes/multiAgentRouter.ts"],
        remediation: "Habilitar coordinación multiagente con políticas de delegación.",
      },
    ],
    defaultActions: [
      "Unificar policy de acceso y tracing para todos los conectores.",
      "Agregar catálogo dinámico de capacidades y healthcheck por integración.",
    ],
  },
  {
    id: "engineering_memory",
    phase: "foundation",
    name: "Engineering Memory",
    description: "Mantiene memoria técnica del proyecto y del contexto de ejecución.",
    owners: ["memory-agent", "knowledge-agent"],
    checks: [
      {
        kind: "path_any",
        id: "memory-routes",
        label: "APIs de memoria",
        weight: 35,
        anyOf: ["server/routes/memoryRouter.ts", "server/routes/conversationMemoryRoutes.ts"],
        remediation: "Añadir endpoints para persistir contexto y decisiones del sistema.",
      },
      {
        kind: "path_any",
        id: "semantic-memory",
        label: "Memoria semántica/RAG",
        weight: 35,
        anyOf: ["server/memory/SemanticMemoryStore.ts", "server/routes/ragMemoryRouter.ts"],
        remediation: "Introducir memoria semántica para recuperación de contexto técnico.",
      },
      {
        kind: "path_any",
        id: "knowledge-docs",
        label: "Worklog y docs vivas",
        weight: 30,
        anyOf: ["docs/WORKLOG.md", "HANDOFF.md"],
        remediation: "Mantener bitácora técnica actualizada para transferencia de contexto.",
      },
    ],
    defaultActions: [
      "Persistir decisiones arquitectónicas relevantes junto con su rationale.",
      "Conectar memoria de conversaciones con memoria de ejecución agentic.",
    ],
  },
  {
    id: "roadmap_debt_management",
    phase: "scale",
    name: "Roadmap & Tech Debt",
    description: "Gestiona roadmap técnico, deuda y migraciones con priorización.",
    owners: ["staff-agent", "delivery-manager"],
    checks: [
      {
        kind: "path_any",
        id: "roadmap-docs",
        label: "Roadmaps y planes",
        weight: 40,
        anyOf: ["docs/ROADMAP_100_PERCENT.md", "IMPROVEMENT_PLAN.md", "WORK_PLAN.md"],
        remediation: "Crear roadmap técnico con hitos y owners claros.",
      },
      {
        kind: "path_any",
        id: "change-tracking",
        label: "Seguimiento de cambios",
        weight: 30,
        anyOf: ["CHANGELOG.md", "docs/SPEC_PROGRESS.md"],
        remediation: "Registrar cambios de producto/sistema en changelog estructurado.",
      },
      {
        kind: "path_any",
        id: "quality-enforcement",
        label: "Quality gates de entrega",
        weight: 30,
        anyOf: ["scripts/quality-gate.ts", "scripts/agent-verify.sh"],
        remediation: "Automatizar quality gates para controlar deuda técnica incremental.",
      },
    ],
    defaultActions: [
      "Implementar scoring de deuda por dominio y prioridad de remediación.",
      "Generar roadmap trimestral con riesgos y dependencias explícitas.",
    ],
  },
  {
    id: "governance_guardrails",
    phase: "foundation",
    name: "Governance & Guardrails",
    description: "Aplica permisos, auditoría y aprobación humana en acciones críticas.",
    owners: ["security-agent", "compliance-agent"],
    checks: [
      {
        kind: "path_any",
        id: "execution-guard",
        label: "Guard pre-ejecución",
        weight: 35,
        anyOf: ["server/middleware/preExecutionIntentGuard.ts", "server/routes/securityRouter.ts"],
        remediation: "Añadir guard pre-ejecución para bloquear operaciones no seguras.",
      },
      {
        kind: "path_any",
        id: "audit-system",
        label: "Sistema de auditoría",
        weight: 35,
        anyOf: ["server/services/superIntelligence/audit", "server/routes/auditDashboardRouter.ts"],
        remediation: "Instrumentar auditoría de operaciones críticas y trazabilidad.",
      },
      {
        kind: "path_any",
        id: "auth-hardening",
        label: "Controles de autenticación reforzada",
        weight: 30,
        anyOf: ["server/middleware/auth.ts", "server/routes/twoFactorRouter.ts"],
        remediation: "Aplicar MFA/2FA para endpoints críticos y consola administrativa.",
      },
    ],
    defaultActions: [
      "Definir policy de aprobaciones humanas para acciones irreversibles.",
      "Registrar eventos de seguridad con correlación de runId y actor.",
    ],
  },
];

interface TaskTemplate {
  title: string;
  description: string;
  owner: string;
  priority: TaskPriority;
  acceptanceCriteria: string[];
  queryHint: string;
}

const TASK_LIBRARY: Record<SuperProgrammingCapabilityId, TaskTemplate[]> = {
  objective_translation: [
    {
      title: "Normalizar contrato de objetivos",
      description: "Crear contrato único objetivo->spec con constraints y checks.",
      owner: "orchestrator",
      priority: "critical",
      acceptanceCriteria: [
        "Toda solicitud genera spec estructurada con acceptance checks.",
        "El plan de ejecución se rechaza si faltan constraints críticos.",
      ],
      queryHint: "define contrato técnico de objetivo y validaciones previas",
    },
    {
      title: "Enrutamiento por complejidad",
      description: "Fortalecer enrutamiento de intents para tareas simples vs complejas.",
      owner: "orchestrator",
      priority: "high",
      acceptanceCriteria: [
        "Se calcula complejidad por solicitud.",
        "Se enruta automáticamente a flujo determinista o agentic.",
      ],
      queryHint: "mejora routing de intenciones con score de complejidad",
    },
  ],
  architecture_design: [
    {
      title: "Checklist de tradeoffs por diseño",
      description: "Forzar análisis de latencia/costo/seguridad en cada cambio mayor.",
      owner: "system-architect",
      priority: "high",
      acceptanceCriteria: [
        "Cada cambio arquitectónico incluye tradeoffs documentados.",
        "Las decisiones quedan registradas en ADR.",
      ],
      queryHint: "genera plantilla ADR con tradeoffs y riesgos",
    },
  ],
  implementation: [
    {
      title: "Plantillas de feature end-to-end",
      description: "Crear patrones reusables backend/frontend/tests para nuevas features.",
      owner: "code-agent",
      priority: "high",
      acceptanceCriteria: [
        "Las nuevas features siguen plantilla estándar.",
        "Se reduce tiempo de entrega por feature.",
      ],
      queryHint: "crear scaffold estandar para features fullstack",
    },
  ],
  testing_quality: [
    {
      title: "Cobertura mínima por capa",
      description: "Establecer umbrales de cobertura para unit/integration/e2e.",
      owner: "qa-agent",
      priority: "critical",
      acceptanceCriteria: [
        "CI falla si no se cumple cobertura mínima.",
        "Existen tests de regresión para bugs críticos.",
      ],
      queryHint: "configura quality gate de cobertura y regresión",
    },
    {
      title: "Suite e2e de rutas críticas",
      description: "Automatizar flujos críticos de usuario y operaciones de riesgo.",
      owner: "qa-agent",
      priority: "high",
      acceptanceCriteria: [
        "Las rutas críticas tienen prueba e2e estable.",
        "El reporte e2e se publica en CI.",
      ],
      queryHint: "agrega pruebas e2e para los flujos críticos",
    },
  ],
  code_review_security: [
    {
      title: "Revisión automática de seguridad",
      description: "Agregar escaneo de secretos, dependencias y hardening por PR.",
      owner: "security-agent",
      priority: "critical",
      acceptanceCriteria: [
        "PR bloqueada ante vulnerabilidades críticas.",
        "Se registran hallazgos con prioridad y evidencia.",
      ],
      queryHint: "implementa pipeline de revisión de seguridad para pull requests",
    },
  ],
  delivery_cicd: [
    {
      title: "Despliegue progresivo con rollback",
      description: "Automatizar release por etapas con rollback automático por salud.",
      owner: "devops-agent",
      priority: "critical",
      acceptanceCriteria: [
        "Deploy usa stages controladas y verificables.",
        "Existe rollback automático ante degradación.",
      ],
      queryHint: "configura pipeline ci cd con canary y rollback automatico",
    },
  ],
  prod_observability: [
    {
      title: "SLOs y alertas accionables",
      description: "Alinear métricas, umbrales y runbooks para incident response.",
      owner: "sre-agent",
      priority: "critical",
      acceptanceCriteria: [
        "Alertas mapeadas a runbooks operativos.",
        "Se miden SLOs de latencia y error rate.",
      ],
      queryHint: "define slos alertas y runbooks de operacion",
    },
  ],
  performance_finops: [
    {
      title: "Panel de costo y latencia por capacidad",
      description: "Medir costo/latencia por modelo, herramienta y endpoint.",
      owner: "finops-agent",
      priority: "high",
      acceptanceCriteria: [
        "Existe dashboard costo-latencia por servicio.",
        "Hay alertas de desviación presupuestaria.",
      ],
      queryHint: "instrumenta analitica de costo y latencia por endpoint",
    },
  ],
  tooling_coordination: [
    {
      title: "Política unificada de integraciones",
      description: "Consolidar auth, permisos y tracing en todos los conectores.",
      owner: "integration-agent",
      priority: "high",
      acceptanceCriteria: [
        "Todos los conectores aplican la misma policy.",
        "El tracing incluye origen y destino por ejecución.",
      ],
      queryHint: "unifica policy de conectores e integraciones externas",
    },
  ],
  engineering_memory: [
    {
      title: "Memoria técnica consolidada",
      description: "Enlazar memoria conversacional, decisiones y eventos de ejecución.",
      owner: "memory-agent",
      priority: "high",
      acceptanceCriteria: [
        "El agente recupera contexto histórico relevante automáticamente.",
        "Cada cambio crítico queda asociado a rationale técnico.",
      ],
      queryHint: "consolida memoria tecnica y trazabilidad de decisiones",
    },
  ],
  roadmap_debt_management: [
    {
      title: "Roadmap técnico basado en deuda",
      description: "Priorizar deuda/riesgos con score e impacto esperado.",
      owner: "staff-agent",
      priority: "high",
      acceptanceCriteria: [
        "Existe backlog de deuda con scoring explícito.",
        "Se publica roadmap trimestral con hitos y riesgos.",
      ],
      queryHint: "genera roadmap tecnico con priorizacion de deuda",
    },
  ],
  governance_guardrails: [
    {
      title: "Matriz de aprobaciones humanas",
      description: "Definir qué operaciones exigen confirmación explícita.",
      owner: "compliance-agent",
      priority: "critical",
      acceptanceCriteria: [
        "Operaciones irreversibles requieren confirmación.",
        "Toda aprobación queda auditada con actor y timestamp.",
      ],
      queryHint: "define guardrails de aprobacion humana para acciones criticas",
    },
  ],
};

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  critical: 300,
  high: 200,
  medium: 100,
};

const PHASE_METADATA: Record<PlanPhaseId, { name: string; description: string; capabilities: SuperProgrammingCapabilityId[] }> = {
  foundation: {
    name: "Foundation",
    description: "Especificación, memoria y guardrails de operación segura.",
    capabilities: ["objective_translation", "engineering_memory", "governance_guardrails"],
  },
  delivery: {
    name: "Delivery Engine",
    description: "Arquitectura, implementación y calidad de entrega continua.",
    capabilities: ["architecture_design", "implementation", "testing_quality", "code_review_security"],
  },
  reliability: {
    name: "Reliability & Ops",
    description: "CI/CD, observabilidad y optimización de performance/costo.",
    capabilities: ["delivery_cicd", "prod_observability", "performance_finops"],
  },
  scale: {
    name: "Scale & Governance",
    description: "Integraciones, roadmap técnico y mejora continua.",
    capabilities: ["tooling_coordination", "roadmap_debt_management"],
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeCapabilityStatus(score: number): CapabilityStatus {
  if (score >= 75) return "implemented";
  if (score >= 40) return "partial";
  return "missing";
}

function computeOverallMaturity(score: number): CapabilityStatus {
  if (score >= 80) return "implemented";
  if (score >= 50) return "partial";
  return "missing";
}

function toRelative(projectRoot: string, absoluteOrRelative: string): string {
  const absolute = path.resolve(projectRoot, absoluteOrRelative);
  return path.relative(projectRoot, absolute) || ".";
}

interface ProjectInspector {
  pathExists(relativePath: string): Promise<boolean>;
  findFirstExisting(paths: string[]): Promise<string | undefined>;
  fileContains(relativeFile: string, fragments: string[]): Promise<boolean>;
}

function createProjectInspector(projectRoot: string): ProjectInspector {
  const pathCache = new Map<string, Promise<boolean>>();
  const contentCache = new Map<string, Promise<string | null>>();

  const pathExists = async (relativePath: string): Promise<boolean> => {
    const absolutePath = path.resolve(projectRoot, relativePath);
    if (!pathCache.has(absolutePath)) {
      pathCache.set(
        absolutePath,
        fs
          .access(absolutePath)
          .then(() => true)
          .catch(() => false),
      );
    }
    return pathCache.get(absolutePath) as Promise<boolean>;
  };

  const readFileSafe = async (relativePath: string): Promise<string | null> => {
    const absolutePath = path.resolve(projectRoot, relativePath);
    if (!contentCache.has(absolutePath)) {
      contentCache.set(
        absolutePath,
        fs
          .readFile(absolutePath, "utf8")
          .then((content) => content)
          .catch(() => null),
      );
    }
    return contentCache.get(absolutePath) as Promise<string | null>;
  };

  return {
    pathExists,
    async findFirstExisting(paths: string[]): Promise<string | undefined> {
      for (const candidate of paths) {
        if (await pathExists(candidate)) {
          return candidate;
        }
      }
      return undefined;
    },
    async fileContains(relativeFile: string, fragments: string[]): Promise<boolean> {
      const content = await readFileSafe(relativeFile);
      if (!content) return false;
      return fragments.every((fragment) => content.includes(fragment));
    },
  };
}

async function evaluateCapability(
  definition: CapabilityDefinition,
  inspector: ProjectInspector,
  projectRoot: string,
): Promise<CapabilityAssessment> {
  const checks: CapabilityCheckResult[] = [];

  for (const check of definition.checks) {
    if (check.kind === "path_any") {
      const evidencePath = await inspector.findFirstExisting(check.anyOf);
      checks.push({
        id: check.id,
        label: check.label,
        weight: check.weight,
        passed: Boolean(evidencePath),
        evidence: evidencePath ? toRelative(projectRoot, evidencePath) : undefined,
        remediation: check.remediation,
      });
      continue;
    }

    const passed = await inspector.fileContains(check.file, check.allOf);
    checks.push({
      id: check.id,
      label: check.label,
      weight: check.weight,
      passed,
      evidence: passed ? toRelative(projectRoot, check.file) : undefined,
      remediation: check.remediation,
    });
  }

  const totalWeight = checks.reduce((acc, item) => acc + item.weight, 0) || 1;
  const passedWeight = checks.filter((item) => item.passed).reduce((acc, item) => acc + item.weight, 0);
  const score = Math.round((passedWeight / totalWeight) * 100);
  const status = computeCapabilityStatus(score);

  const gaps = checks.filter((check) => !check.passed).map((check) => check.label);
  const recommendedActions = [
    ...definition.defaultActions,
    ...checks.filter((check) => !check.passed).map((check) => check.remediation),
  ].filter((value, index, all) => all.indexOf(value) === index);

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    phase: definition.phase,
    score,
    status,
    owners: definition.owners,
    checks,
    gaps,
    recommendedActions,
  };
}

function buildOpenClawSummary(objective?: string): {
  profile: OpenClaw1000CapabilityProfile;
  summary: {
    totalMatched: number;
    categories: Array<{ category: string; count: number }>;
    recommendedTools: string[];
  };
} {
  const profileQuery =
    objective?.trim() ||
    "autonomous software engineering planning implementation testing ci cd observability security";
  const profile = buildOpenClaw1000CapabilityProfile(profileQuery, {
    limit: 20,
    minScore: 0.1,
    includeStatuses: ["implemented", "partial"],
  });
  const fallbackTools = ["code_generate", "test_run", "workflow_create", "monitor", "security_scan"];
  const recommendedTools =
    profile.recommendedTools.length > 0 ? profile.recommendedTools : fallbackTools;

  return {
    profile,
    summary: {
      totalMatched: profile.matches.length,
      categories: profile.categories.map((entry) => ({
        category: entry.category,
        count: entry.count,
      })),
      recommendedTools,
    },
  };
}

function buildDispatchQuery(
  objective: string,
  capability: CapabilityAssessment,
  task: TaskTemplate,
): string {
  return [
    `Objetivo principal: ${objective}`,
    `Capacidad a reforzar: ${capability.name}`,
    `Tarea: ${task.title}`,
    `Instrucción: ${task.queryHint}`,
    "Entrega con evidencia verificable y pasos reproducibles.",
  ].join("\n");
}

function taskCountFromGap(score: number, targetMaturity: number): number {
  const deficit = Math.max(0, targetMaturity - score);
  if (deficit >= 35) return 2;
  if (deficit >= 15) return 1;
  return 0;
}

function estimateImpact(score: number, targetMaturity: number, priority: TaskPriority): number {
  const deficit = Math.max(0, targetMaturity - score);
  const base = priority === "critical" ? 30 : priority === "high" ? 22 : 16;
  return clamp(base + deficit, 10, 100);
}

function sortBacklog(a: SuperProgrammingTask, b: SuperProgrammingTask): number {
  const ap = PRIORITY_WEIGHT[a.priority];
  const bp = PRIORITY_WEIGHT[b.priority];
  if (ap !== bp) return bp - ap;
  if (a.estimatedImpact !== b.estimatedImpact) return b.estimatedImpact - a.estimatedImpact;
  return a.title.localeCompare(b.title);
}

function summarizeExecutionResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const asRecord = result as Record<string, unknown>;

  const summary: Record<string, unknown> = {
    intent: asRecord.intent,
  };

  const workflowResult = asRecord.workflowResult as Record<string, unknown> | undefined;
  if (workflowResult) {
    summary.workflowStatus = workflowResult.status;
    summary.workflowId = workflowResult.id;
  }

  const agentResult = asRecord.agentResult as Record<string, unknown> | undefined;
  if (agentResult) {
    summary.agentName = agentResult.agentName;
    summary.agentSuccess = agentResult.success;
    summary.agentDuration = agentResult.duration;
  }

  const toolResults = Array.isArray(asRecord.toolResults) ? asRecord.toolResults : undefined;
  if (toolResults) {
    summary.toolCalls = toolResults.length;
    summary.toolSuccess = toolResults.every((item) => {
      const candidate = item as Record<string, unknown>;
      return candidate.success === true;
    });
  }

  return summary;
}

function isExecutionSuccessful(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const asRecord = result as Record<string, unknown>;

  const workflowResult = asRecord.workflowResult as Record<string, unknown> | undefined;
  if (workflowResult) {
    return workflowResult.status === "completed";
  }

  const agentResult = asRecord.agentResult as Record<string, unknown> | undefined;
  if (agentResult) {
    return agentResult.success === true;
  }

  const toolResults = Array.isArray(asRecord.toolResults) ? asRecord.toolResults : undefined;
  if (toolResults && toolResults.length > 0) {
    return toolResults.every((item) => {
      const candidate = item as Record<string, unknown>;
      return candidate.success === true;
    });
  }

  return false;
}

export class SuperProgrammingAgentService {
  private readonly runStore = new Map<string, SuperProgrammingRun>();
  private readonly runOrder: string[] = [];
  private readonly maxRunHistory = 150;

  constructor(private readonly projectRoot: string = process.cwd()) {}

  private saveRun(run: SuperProgrammingRun): void {
    this.runStore.set(run.runId, run);
    if (!this.runOrder.includes(run.runId)) {
      this.runOrder.push(run.runId);
    }

    if (this.runOrder.length > this.maxRunHistory) {
      const overflow = this.runOrder.splice(0, this.runOrder.length - this.maxRunHistory);
      for (const runId of overflow) {
        this.runStore.delete(runId);
      }
    }
  }

  async assess(objective?: string): Promise<SuperProgrammingAssessment> {
    const inspector = createProjectInspector(this.projectRoot);

    const capabilities = await Promise.all(
      CAPABILITY_DEFINITIONS.map((definition) =>
        evaluateCapability(definition, inspector, this.projectRoot),
      ),
    );

    capabilities.sort((a, b) => a.score - b.score);

    const overallScore = Math.round(
      capabilities.reduce((acc, item) => acc + item.score, 0) / Math.max(1, capabilities.length),
    );

    const summary = {
      implemented: capabilities.filter((item) => item.status === "implemented").length,
      partial: capabilities.filter((item) => item.status === "partial").length,
      missing: capabilities.filter((item) => item.status === "missing").length,
    };

    const priorities = capabilities.slice(0, 5).map((item) => ({
      capabilityId: item.id,
      score: item.score,
      reason: item.gaps[0] || "Reforzar robustez operativa",
    }));

    const { summary: openClawProfile } = buildOpenClawSummary(objective);

    return {
      assessmentId: `spa_assess_${randomUUID()}`,
      generatedAt: Date.now(),
      projectRoot: this.projectRoot,
      objective,
      overallScore,
      maturity: computeOverallMaturity(overallScore),
      summary,
      capabilities,
      priorities,
      openClawProfile,
    };
  }

  async buildPlan(objective: string, options: BuildPlanOptions = {}): Promise<SuperProgrammingPlan> {
    const trimmedObjective = objective.trim();
    const targetMaturity = clamp(options.targetMaturity ?? 85, 40, 100);
    const assessment = await this.assess(trimmedObjective);

    const capabilitiesById = new Map(assessment.capabilities.map((capability) => [capability.id, capability]));

    const phases: SuperProgrammingPlanPhase[] = [];
    const backlog: SuperProgrammingTask[] = [];

    for (const phaseId of ["foundation", "delivery", "reliability", "scale"] as const) {
      const phaseMeta = PHASE_METADATA[phaseId];
      const tasks: SuperProgrammingTask[] = [];

      for (const capabilityId of phaseMeta.capabilities) {
        const capability = capabilitiesById.get(capabilityId);
        if (!capability) continue;

        const templates = TASK_LIBRARY[capabilityId] || [];
        const requiredTasks = taskCountFromGap(capability.score, targetMaturity);

        for (let i = 0; i < Math.min(requiredTasks, templates.length); i++) {
          const template = templates[i];
          const task: SuperProgrammingTask = {
            id: `task_${randomUUID()}`,
            capabilityId,
            capabilityName: capability.name,
            title: template.title,
            description: template.description,
            owner: template.owner,
            priority: template.priority,
            dispatchQuery: buildDispatchQuery(trimmedObjective, capability, template),
            acceptanceCriteria: template.acceptanceCriteria,
            estimatedImpact: estimateImpact(capability.score, targetMaturity, template.priority),
          };
          tasks.push(task);
          backlog.push(task);
        }
      }

      phases.push({
        id: phaseId,
        name: phaseMeta.name,
        description: phaseMeta.description,
        targetCapabilities: phaseMeta.capabilities,
        tasks,
      });
    }

    if (backlog.length === 0) {
      const fallbackCapabilities = [...assessment.capabilities]
        .sort((a, b) => a.score - b.score)
        .slice(0, 2);

      for (const capability of fallbackCapabilities) {
        const templates = TASK_LIBRARY[capability.id] || [];
        if (templates.length === 0) continue;
        const template = templates[0];

        const fallbackTask: SuperProgrammingTask = {
          id: `task_${randomUUID()}`,
          capabilityId: capability.id,
          capabilityName: capability.name,
          title: `${template.title} (hardening)`,
          description: template.description,
          owner: template.owner,
          priority: "medium",
          dispatchQuery: buildDispatchQuery(trimmedObjective, capability, template),
          acceptanceCriteria: template.acceptanceCriteria,
          estimatedImpact: 18,
        };

        backlog.push(fallbackTask);

        const targetPhase = phases.find((phase) => phase.targetCapabilities.includes(capability.id));
        if (targetPhase) {
          targetPhase.tasks.push(fallbackTask);
        }
      }
    }

    backlog.sort(sortBacklog);

    const estimatedWeeks = clamp(Math.ceil(backlog.length / 4), 1, 16);

    return {
      planId: `spa_plan_${randomUUID()}`,
      createdAt: Date.now(),
      objective: trimmedObjective,
      targetMaturity,
      assessment,
      phases,
      priorityBacklog: backlog,
      guardrails: [
        "No ejecutar acciones irreversibles sin confirmación humana.",
        "No desplegar a producción sin pasar quality gate y health checks.",
        "Mantener trazabilidad completa de cambios y decisiones por runId.",
      ],
      estimatedWeeks,
    };
  }

  async runPlan(plan: SuperProgrammingPlan, options: RunPlanOptions = {}): Promise<SuperProgrammingRun> {
    const maxTasks = clamp(options.maxTasks ?? 6, 1, 40);
    const mode: RunMode = options.dryRun ?? true ? "dry-run" : "live";
    const stopOnFailure = options.stopOnFailure ?? true;

    const selectedTasks = plan.priorityBacklog.slice(0, maxTasks);
    const steps: SuperProgrammingRunStep[] = selectedTasks.map((task) => ({
      id: `step_${randomUUID()}`,
      task,
      status: "pending",
    }));

    const run: SuperProgrammingRun = {
      runId: `spa_run_${randomUUID()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mode,
      status: "running",
      objective: plan.objective,
      planId: plan.planId,
      steps,
      summary: {
        total: steps.length,
        completed: 0,
        failed: 0,
        skipped: 0,
        durationMs: 0,
      },
    };

    this.saveRun(run);

    const startedAt = Date.now();

    for (let index = 0; index < run.steps.length; index++) {
      const step = run.steps[index];
      step.status = "running";
      step.startedAt = Date.now();
      run.updatedAt = Date.now();

      try {
        if (mode === "dry-run") {
          step.status = "completed";
          step.output = {
            mode,
            message: "Step validated in dry-run mode.",
            dispatchQuery: step.task.dispatchQuery,
          };
        } else {
          const { orchestrator } = await import("../agent/registry");
          const executionResult = await orchestrator.executeTask(step.task.dispatchQuery);

          if (!isExecutionSuccessful(executionResult)) {
            throw new Error("Execution returned a non-successful result.");
          }

          step.status = "completed";
          step.output = summarizeExecutionResult(executionResult);
        }
      } catch (error) {
        const err = error as Error;
        step.status = "failed";
        step.error = err.message || "Unknown execution error";

        if (stopOnFailure) {
          for (let tail = index + 1; tail < run.steps.length; tail++) {
            const nextStep = run.steps[tail];
            nextStep.status = "skipped";
            nextStep.error = "Skipped due to previous failure";
            nextStep.completedAt = Date.now();
          }
          break;
        }
      } finally {
        step.completedAt = Date.now();
      }

      this.saveRun(run);
    }

    run.updatedAt = Date.now();
    run.summary = {
      total: run.steps.length,
      completed: run.steps.filter((step) => step.status === "completed").length,
      failed: run.steps.filter((step) => step.status === "failed").length,
      skipped: run.steps.filter((step) => step.status === "skipped").length,
      durationMs: Date.now() - startedAt,
    };

    run.status = run.summary.failed > 0 ? "failed" : "completed";

    this.saveRun(run);
    return run;
  }

  listRuns(limit = 25): SuperProgrammingRun[] {
    const capped = clamp(limit, 1, 100);
    const ids = this.runOrder.slice(-capped).reverse();
    return ids
      .map((id) => this.runStore.get(id))
      .filter((run): run is SuperProgrammingRun => Boolean(run));
  }

  getRun(runId: string): SuperProgrammingRun | undefined {
    return this.runStore.get(runId);
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }
}

export const superProgrammingAgentService = new SuperProgrammingAgentService();
