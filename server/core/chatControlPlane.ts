import type { IntentResult } from "../../shared/schemas/intent";
import {
  createChatCognitiveKernelDecision,
  type ChatCognitiveKernelDecision,
} from "../cognitive";
import {
  usageQuotaService,
  type UnifiedQuotaErrorPayload,
} from "../services/usageQuotaService";
import { isProductionIntent } from "../services/productionHandler";
import {
  getChatCapabilityById,
  matchChatCapabilityRequest,
  type ChatCapabilityDefinition,
} from "./chatCapabilityContract";

export type ChatExecutionHandler =
  | "model_stream"
  | "production_handler"
  | "skill_auto_dispatcher";

export type ChatRenderSurface =
  | "conversation_stream"
  | "artifact_card"
  | "agent_steps";

export interface ChatControlPlaneFeatureFlags {
  memoryEnabled: boolean;
  recordingHistoryEnabled: boolean;
  webSearchAuto: boolean;
  codeInterpreterEnabled: boolean;
  canvasEnabled: boolean;
  voiceEnabled: boolean;
  voiceAdvanced: boolean;
  connectorSearchAuto: boolean;
}

export interface ChatControlPlaneInput {
  requestId: string;
  userId: string;
  message: string;
  clientMessages: Array<{ role: string; content: string }>;
  systemSections?: string[];
  chatId?: string;
  conversationId?: string;
  provider?: string | null;
  model?: string | null;
  latencyMode?: string | null;
  attachmentsCount?: number;
  hasDocumentAttachments?: boolean;
  intentResult?: IntentResult | null;
  featureFlags: ChatControlPlaneFeatureFlags;
  signal?: AbortSignal;
}

export interface ChatControlPlaneDecision {
  envelope: {
    requestId: string;
    userId: string;
    chatId: string | null;
    conversationId: string | null;
    provider: string | null;
    model: string | null;
    latencyMode: string | null;
    attachmentsCount: number;
    estimatedInputTokens: number;
  };
  contract: ChatCapabilityDefinition | null;
  cognitive: ChatCognitiveKernelDecision | null;
  authoritativeIntentResult: IntentResult | null;
  capability: {
    id: string;
    domainId: string | null;
    contractStatus: "integrated" | "partial" | "gap";
    workflow: "artifact_generation" | "skill_dispatch" | "agent_execution" | "conversation";
    handler: ChatExecutionHandler;
    renderSurface: ChatRenderSurface;
    splitView: boolean;
    showSteps: boolean;
    requiresApproval: boolean;
    multiLlm: boolean;
  };
  policy: {
    allowed: boolean;
    code: string | null;
    reason: string | null;
    statusCode: number | null;
    quota: UnifiedQuotaErrorPayload | null;
  };
}

function estimateInputTokens(
  messages: Array<{ role: string; content: string }>,
  systemSections: string[] = [],
): number {
  const base = messages.reduce((sum, message) => {
    const content = typeof message.content === "string" ? message.content : "";
    return sum + Math.ceil(content.length / 4);
  }, 0);

  const extras = systemSections.reduce((sum, section) => sum + Math.ceil(section.length / 4), 0);
  return base + extras;
}

function buildCapabilityDecision(
  authoritativeIntentResult: IntentResult | null,
  message: string,
  contract: ChatCapabilityDefinition | null,
): ChatControlPlaneDecision["capability"] {
  if (authoritativeIntentResult && isProductionIntent(authoritativeIntentResult, message)) {
    const outputFormat = authoritativeIntentResult.output_format || "artifact";
    const artifactContract =
      contract?.domainId === "artifact_generation"
        ? contract
        : getArtifactContractForFormat(outputFormat);

    return {
      id: artifactContract?.capabilityId || `artifact.${outputFormat}`,
      domainId: artifactContract?.domainId || "artifact_generation",
      contractStatus: artifactContract?.status || "integrated",
      workflow: "artifact_generation",
      handler: "production_handler",
      renderSurface: "artifact_card",
      splitView: true,
      showSteps: true,
      requiresApproval: artifactContract?.requiresApproval || false,
      multiLlm: artifactContract?.multiLlm ?? true,
    };
  }

  if (
    authoritativeIntentResult &&
    authoritativeIntentResult.intent !== "CHAT_GENERAL" &&
    authoritativeIntentResult.intent !== "NEED_CLARIFICATION"
  ) {
    return {
      id: contract?.capabilityId || `skill.${authoritativeIntentResult.intent.toLowerCase()}`,
      domainId: contract?.domainId || null,
      contractStatus: contract?.status || "partial",
      workflow: "skill_dispatch",
      handler: "skill_auto_dispatcher",
      renderSurface: "agent_steps",
      splitView: false,
      showSteps: true,
      requiresApproval: contract?.requiresApproval || false,
      multiLlm: contract?.multiLlm ?? true,
    };
  }

  if (contract) {
    return {
      id: contract.capabilityId,
      domainId: contract.domainId,
      contractStatus: contract.status,
      workflow: contract.workflow,
      handler: contract.handler,
      renderSurface: contract.renderSurface,
      splitView: contract.renderSurface === "artifact_card",
      showSteps: contract.renderSurface !== "conversation_stream",
      requiresApproval: contract.requiresApproval,
      multiLlm: contract.multiLlm,
    };
  }

  return {
    id: "conversation.chat",
    domainId: null,
    contractStatus: "partial",
    workflow: "conversation",
    handler: "model_stream",
    renderSurface: "conversation_stream",
    splitView: false,
    showSteps: false,
    requiresApproval: false,
    multiLlm: true,
  };
}

function getArtifactContractForFormat(outputFormat: string | null | undefined): ChatCapabilityDefinition | null {
  const normalized = String(outputFormat || "artifact").toLowerCase();
  const formatMap: Record<string, string> = {
    docx: "artifact.docx.professional",
    doc: "artifact.docx.professional",
    xlsx: "artifact.xlsx.professional",
    xls: "artifact.xlsx.professional",
    pptx: "artifact.pptx.professional",
    ppt: "artifact.pptx.professional",
    pdf: "artifact.pdf.professional",
    markdown: "artifact.structured.outputs",
    md: "artifact.structured.outputs",
    html: "artifact.structured.outputs",
    jsx: "artifact.structured.outputs",
    tsx: "artifact.structured.outputs",
    latex: "artifact.structured.outputs",
    csv: "artifact.structured.outputs",
    tsv: "artifact.structured.outputs",
    json: "artifact.structured.outputs",
    png: "artifact.structured.outputs",
  };

  const capabilityId = formatMap[normalized];
  return capabilityId ? getChatCapabilityById(capabilityId) : null;
}

async function evaluatePolicy(
  input: ChatControlPlaneInput,
  capability: ChatControlPlaneDecision["capability"],
  estimatedInputTokens: number,
  authoritativeIntentResult: IntentResult | null,
): Promise<ChatControlPlaneDecision["policy"]> {
  if (input.hasDocumentAttachments) {
    return {
      allowed: false,
      code: "USE_ANALYZE_ENDPOINT",
      reason: "Document attachments must use /api/analyze for deterministic extraction and analysis.",
      statusCode: 400,
      quota: null,
    };
  }

  if (capability.handler === "production_handler" && !input.featureFlags.canvasEnabled) {
    return {
      allowed: false,
      code: "CAPABILITY_DISABLED",
      reason: "Artifact generation is disabled for this user because canvas/document features are off.",
      statusCode: 409,
      quota: null,
    };
  }

  if (authoritativeIntentResult?.intent === "EXECUTE_CODE" && !input.featureFlags.codeInterpreterEnabled) {
    return {
      allowed: false,
      code: "CAPABILITY_DISABLED",
      reason: "Code execution is disabled for this user.",
      statusCode: 409,
      quota: null,
    };
  }

  if (typeof usageQuotaService.validateUnifiedQuota === "function") {
    const quotaResult = await usageQuotaService.validateUnifiedQuota(input.userId, estimatedInputTokens);
    if (!quotaResult.allowed) {
      return {
        allowed: false,
        code: quotaResult.payload.code,
        reason: quotaResult.payload.message,
        statusCode: quotaResult.payload.statusCode,
        quota: quotaResult.payload,
      };
    }
  }

  return {
    allowed: true,
    code: null,
    reason: null,
    statusCode: null,
    quota: null,
  };
}

export async function createChatControlPlaneDecision(
  input: ChatControlPlaneInput,
): Promise<ChatControlPlaneDecision> {
  const estimatedInputTokens = estimateInputTokens(input.clientMessages, input.systemSections || []);
  let cognitive: ChatCognitiveKernelDecision | null = null;
  if (input.message) {
    try {
      cognitive = await createChatCognitiveKernelDecision({
        userId: input.userId,
        message: input.message,
        intentResult: input.intentResult ?? null,
        preferredProvider: input.provider || undefined,
        enableMemory: input.featureFlags.memoryEnabled || input.featureFlags.recordingHistoryEnabled,
        memoryLimit: 4,
        conversationLength: input.clientMessages.length,
        signal: input.signal,
      });
    } catch {
      cognitive = null;
    }
  }

  const authoritativeIntentResult =
    cognitive?.authoritativeIntentResult ?? input.intentResult ?? null;
  const contract = matchChatCapabilityRequest(input.message)?.capability || null;
  const capability = buildCapabilityDecision(authoritativeIntentResult, input.message, contract);
  const policy = await evaluatePolicy(
    input,
    capability,
    estimatedInputTokens,
    authoritativeIntentResult,
  );

  return {
    envelope: {
      requestId: input.requestId,
      userId: input.userId,
      chatId: input.chatId || null,
      conversationId: input.conversationId || null,
      provider: input.provider || null,
      model: input.model || null,
      latencyMode: input.latencyMode || null,
      attachmentsCount: input.attachmentsCount || 0,
      estimatedInputTokens,
    },
    contract,
    cognitive,
    authoritativeIntentResult,
    capability,
    policy,
  };
}
