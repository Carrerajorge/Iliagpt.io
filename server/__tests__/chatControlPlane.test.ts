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

describe("chat control plane", () => {
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

  it("routes explicit artifact intents to the production handler", async () => {
    createChatCognitiveKernelDecisionMock.mockResolvedValueOnce({
      workflow: "artifact_generation",
      cognitiveIntent: { intent: "doc_generation", confidence: 0.96, reasoning: "doc request" },
      sharedIntent: { intent: "CREATE_DOCUMENT" },
      authoritativeIntentResult: {
        intent: "CREATE_DOCUMENT",
        output_format: "docx",
        slots: { topic: "mercado" },
        confidence: 0.96,
        normalized_text: "crea un word",
        language_detected: "es",
      },
      provider: { name: "smart-router", reason: "docx generation", capabilities: [] },
      context: {
        retrievedCount: 1,
        includedCount: 1,
        totalChars: 120,
        errors: [],
        renderedContext: "[Memoria relevante]\n• [note] prioriza tono ejecutivo",
        telemetry: { memoryLookupMs: 1, documentLookupMs: 0, totalMs: 1 },
      },
      corrected: false,
      correctionReason: null,
      metadata: {},
    });

    const { createChatControlPlaneDecision } = await import("../core/chatControlPlane");
    const decision = await createChatControlPlaneDecision({
      requestId: "req-1",
      userId: "user-1",
      message: "crea un Word de estudio de mercado",
      clientMessages: [{ role: "user", content: "crea un Word de estudio de mercado" }],
      featureFlags: {
        memoryEnabled: true,
        recordingHistoryEnabled: false,
        webSearchAuto: true,
        codeInterpreterEnabled: true,
        canvasEnabled: true,
        voiceEnabled: true,
        voiceAdvanced: false,
        connectorSearchAuto: false,
      },
      intentResult: {
        intent: "CREATE_DOCUMENT",
        output_format: "docx",
        slots: { topic: "mercado" },
        confidence: 0.95,
        normalized_text: "crea un word",
        language_detected: "es",
      },
    });

    expect(decision.capability).toMatchObject({
      workflow: "artifact_generation",
      handler: "production_handler",
      renderSurface: "artifact_card",
      splitView: true,
      showSteps: true,
      id: "artifact.docx.professional",
    });
    expect(decision.policy.allowed).toBe(true);
  });

  it("blocks document attachments and forces /api/analyze", async () => {
    const { createChatControlPlaneDecision } = await import("../core/chatControlPlane");
    const decision = await createChatControlPlaneDecision({
      requestId: "req-2",
      userId: "user-1",
      message: "analiza este pdf",
      clientMessages: [{ role: "user", content: "analiza este pdf" }],
      hasDocumentAttachments: true,
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
      intentResult: {
        intent: "ANALYZE_DOCUMENT",
        output_format: null,
        slots: { topic: "pdf" },
        confidence: 0.92,
        normalized_text: "analiza este pdf",
        language_detected: "es",
      },
    });

    expect(decision.policy).toMatchObject({
      allowed: false,
      code: "USE_ANALYZE_ENDPOINT",
      statusCode: 400,
    });
    expect(validateUnifiedQuotaMock).not.toHaveBeenCalled();
  });

  it("blocks code execution when the capability is disabled", async () => {
    createChatCognitiveKernelDecisionMock.mockResolvedValueOnce({
      workflow: "skill_dispatch",
      cognitiveIntent: { intent: "code_execution", confidence: 0.9, reasoning: "code" },
      sharedIntent: { intent: "EXECUTE_CODE" },
      authoritativeIntentResult: {
        intent: "EXECUTE_CODE",
        output_format: null,
        slots: { topic: "script" },
        confidence: 0.91,
        normalized_text: "escribe python",
        language_detected: "es",
      },
      provider: { name: "smart-router", reason: "code", capabilities: [] },
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

    const { createChatControlPlaneDecision } = await import("../core/chatControlPlane");
    const decision = await createChatControlPlaneDecision({
      requestId: "req-3",
      userId: "user-1",
      message: "escribe un script en python",
      clientMessages: [{ role: "user", content: "escribe un script en python" }],
      featureFlags: {
        memoryEnabled: false,
        recordingHistoryEnabled: false,
        webSearchAuto: true,
        codeInterpreterEnabled: false,
        canvasEnabled: true,
        voiceEnabled: true,
        voiceAdvanced: false,
        connectorSearchAuto: false,
      },
      intentResult: {
        intent: "EXECUTE_CODE",
        output_format: null,
        slots: { topic: "script" },
        confidence: 0.91,
        normalized_text: "escribe python",
        language_detected: "es",
      },
    });

    expect(decision.capability.handler).toBe("skill_auto_dispatcher");
    expect(decision.policy).toMatchObject({
      allowed: false,
      code: "CAPABILITY_DISABLED",
      statusCode: 409,
    });
  });

  it("propagates unified quota blocks", async () => {
    validateUnifiedQuotaMock.mockResolvedValueOnce({
      allowed: false,
      payload: {
        ok: false,
        code: "TOKEN_QUOTA_EXCEEDED",
        message: "sin cuota",
        statusCode: 402,
        quota: {
          unified: true,
          resetAt: null,
          monthlyAllowed: false,
          dailyAllowed: true,
          requestAllowed: true,
        },
        billing: {
          unified: true,
          statusUrl: "/api/billing/status",
          upgradeUrl: "/workspace-settings?section=billing",
        },
      },
    });

    const { createChatControlPlaneDecision } = await import("../core/chatControlPlane");
    const decision = await createChatControlPlaneDecision({
      requestId: "req-4",
      userId: "user-1",
      message: "hola",
      clientMessages: [{ role: "user", content: "hola" }],
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
      intentResult: {
        intent: "CHAT_GENERAL",
        output_format: null,
        slots: {},
        confidence: 0.7,
        normalized_text: "hola",
        language_detected: "es",
      },
    });

    expect(decision.policy.allowed).toBe(false);
    expect(decision.policy.code).toBe("TOKEN_QUOTA_EXCEEDED");
    expect(decision.policy.quota?.billing.statusUrl).toBe("/api/billing/status");
  });

  it("falls back to the capability contract when no authoritative intent is available", async () => {
    const { createChatControlPlaneDecision } = await import("../core/chatControlPlane");
    const decision = await createChatControlPlaneDecision({
      requestId: "req-5",
      userId: "user-1",
      message: "organiza mi carpeta de contratos, deduplica archivos y crea subcarpetas",
      clientMessages: [
        {
          role: "user",
          content: "organiza mi carpeta de contratos, deduplica archivos y crea subcarpetas",
        },
      ],
      provider: "openai",
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

    expect(decision.contract?.capabilityId).toBe("files.local.management");
    expect(decision.capability).toMatchObject({
      id: "files.local.management",
      domainId: "local_file_management",
      contractStatus: "partial",
      workflow: "agent_execution",
      handler: "skill_auto_dispatcher",
      renderSurface: "agent_steps",
      requiresApproval: true,
      multiLlm: true,
    });
    expect(decision.policy.allowed).toBe(true);
  });

  it.each(["openai", "anthropic", "xai"])(
    "keeps the same capability contract across providers for %s",
    async (provider) => {
      const { createChatControlPlaneDecision } = await import("../core/chatControlPlane");
      const decision = await createChatControlPlaneDecision({
        requestId: `req-provider-${provider}`,
        userId: "user-1",
        provider,
        message: "crea un dashboard de ventas en Excel con formulas SUMIF y VLOOKUP",
        clientMessages: [
          {
            role: "user",
            content: "crea un dashboard de ventas en Excel con formulas SUMIF y VLOOKUP",
          },
        ],
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
        intentResult: {
          intent: "CREATE_DOCUMENT",
          output_format: "xlsx",
          slots: { topic: "ventas" },
          confidence: 0.95,
          normalized_text: "crea un excel de ventas",
          language_detected: "es",
        },
      });

      expect(decision.capability).toMatchObject({
        id: "artifact.xlsx.professional",
        domainId: "artifact_generation",
        workflow: "artifact_generation",
        handler: "production_handler",
        renderSurface: "artifact_card",
        multiLlm: true,
      });
      expect(decision.envelope.provider).toBe(provider);
      expect(decision.contract?.multiLlm).toBe(true);
    },
  );
});
