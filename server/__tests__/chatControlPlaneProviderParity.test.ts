import { beforeEach, describe, expect, it, vi } from "vitest";

const { createChatCognitiveKernelDecisionMock, validateUnifiedQuotaMock } = vi.hoisted(() => ({
  createChatCognitiveKernelDecisionMock: vi.fn(),
  validateUnifiedQuotaMock: vi.fn(),
}));

vi.mock("../cognitive", () => ({
  createChatCognitiveKernelDecision: createChatCognitiveKernelDecisionMock,
}));

vi.mock("../services/usageQuotaService", () => ({
  usageQuotaService: {
    validateUnifiedQuota: validateUnifiedQuotaMock,
  },
}));

type ProviderParityCase = {
  prompt: string;
  capabilityId: string;
  domainId: string;
  handler: "production_handler" | "skill_auto_dispatcher" | "model_stream";
};

const parityCases: ProviderParityCase[] = [
  {
    prompt: "crea un xlsx con tablas dinámicas y gráficos",
    capabilityId: "artifact.xlsx.professional",
    domainId: "artifact_generation",
    handler: "production_handler",
  },
  {
    prompt: "genera una presentación con speaker notes y watermark",
    capabilityId: "artifact.pptx.professional",
    domainId: "artifact_generation",
    handler: "production_handler",
  },
  {
    prompt: "redacta un paper técnico con comentarios y redlines",
    capabilityId: "artifact.docx.professional",
    domainId: "artifact_generation",
    handler: "production_handler",
  },
  {
    prompt: "combina pdf y extrae datos del formulario pdf",
    capabilityId: "artifact.pdf.professional",
    domainId: "artifact_generation",
    handler: "production_handler",
  },
  {
    prompt: "organiza mi carpeta y deduplica archivos",
    capabilityId: "files.local.management",
    domainId: "local_file_management",
    handler: "skill_auto_dispatcher",
  },
  {
    prompt: "entrena un modelo predictivo y haz forecast",
    capabilityId: "data.analytics.science",
    domainId: "data_science",
    handler: "skill_auto_dispatcher",
  },
  {
    prompt: "detecta contradicciones y cita fuentes",
    capabilityId: "research.synthesis.multisource",
    domainId: "synthesis_research",
    handler: "skill_auto_dispatcher",
  },
  {
    prompt: "convierte PDF a PowerPoint y csv a excel",
    capabilityId: "conversion.cross.format",
    domainId: "format_conversion",
    handler: "skill_auto_dispatcher",
  },
  {
    prompt: "navega un sitio y extrae contenido",
    capabilityId: "browser.automation",
    domainId: "browser_automation",
    handler: "skill_auto_dispatcher",
  },
  {
    prompt: "usa mi computadora para abrir chrome",
    capabilityId: "desktop.computer.use",
    domainId: "computer_use",
    handler: "skill_auto_dispatcher",
  },
  {
    prompt: "programa un digest semanal y métricas semanales",
    capabilityId: "tasks.scheduled",
    domainId: "scheduled_tasks",
    handler: "skill_auto_dispatcher",
  },
  {
    prompt: "usa dispatch desde ios",
    capabilityId: "dispatch.mobile.desktop",
    domainId: "dispatch",
    handler: "model_stream",
  },
  {
    prompt: "opera sobre slack, notion y github",
    capabilityId: "connectors.mcp.operations",
    domainId: "connectors",
    handler: "skill_auto_dispatcher",
  },
  {
    prompt: "crea un skill y actualiza instrucciones de carpeta",
    capabilityId: "plugins.customization",
    domainId: "plugins_customization",
    handler: "skill_auto_dispatcher",
  },
  {
    prompt: "ejecuta python con pandas en vm aislada",
    capabilityId: "code.execution.sandbox",
    domainId: "code_execution",
    handler: "skill_auto_dispatcher",
  },
  {
    prompt: "coordina múltiples sub-agentes en paralelo",
    capabilityId: "agents.subagents.parallel",
    domainId: "subagents",
    handler: "skill_auto_dispatcher",
  },
  {
    prompt: "workspace persistente por proyecto",
    capabilityId: "workspace.project.cowork",
    domainId: "project_workspaces",
    handler: "skill_auto_dispatcher",
  },
  {
    prompt: "explica opentelemetry y rbac enterprise",
    capabilityId: "enterprise.controls.analytics",
    domainId: "enterprise",
    handler: "model_stream",
  },
];

describe("chat control plane provider parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createChatCognitiveKernelDecisionMock.mockResolvedValue({
      workflow: "conversation",
      cognitiveIntent: { intent: "general_chat", confidence: 0.8, reasoning: "default" },
      sharedIntent: null,
      authoritativeIntentResult: null,
      provider: { name: "smart-router", reason: "default", capabilities: [] },
      context: {
        retrievedCount: 0,
        includedCount: 0,
        totalChars: 0,
        errors: [],
        renderedContext: null,
        telemetry: { memoryLookupMs: 0, documentLookupMs: 0, totalMs: 0 },
      },
      corrected: false,
      correctionReason: null,
      metadata: {},
    });
    validateUnifiedQuotaMock.mockResolvedValue({ allowed: true });
  });

  it.each(["openai", "anthropic", "xai"])(
    "preserves control-plane capability mappings for provider %s",
    async (provider) => {
      const { createChatControlPlaneDecision } = await import("../core/chatControlPlane");

      for (const testCase of parityCases) {
        const decision = await createChatControlPlaneDecision({
          requestId: `req-${provider}-${testCase.capabilityId}`,
          userId: "user-1",
          provider,
          model: `${provider}-model`,
          message: testCase.prompt,
          clientMessages: [{ role: "user", content: testCase.prompt }],
          featureFlags: {
            memoryEnabled: false,
            recordingHistoryEnabled: false,
            webSearchAuto: true,
            codeInterpreterEnabled: true,
            canvasEnabled: true,
            voiceEnabled: true,
            voiceAdvanced: false,
            connectorSearchAuto: false,
          },
          intentResult: null,
        });

        expect(decision.envelope.provider).toBe(provider);
        expect(decision.contract?.capabilityId).toBe(testCase.capabilityId);
        expect(decision.capability.id).toBe(testCase.capabilityId);
        expect(decision.capability.domainId).toBe(testCase.domainId);
        expect(decision.capability.handler).toBe(testCase.handler);
        expect(decision.capability.multiLlm).toBe(true);
        expect(decision.policy.allowed).toBe(true);
      }
    },
  );
});
