import { hasMeaningfulAssistantContent } from "./assistantContent";
import { normalizeFollowUpSuggestions } from "./followUpSuggestions";

const DEFAULT_ASSISTANT_FALLBACK_CONTENT = "Lo siento, no pude generar una respuesta en este momento. Por favor, intenta de nuevo.";
const ALLOWED_CONFIDENCE = new Set(["high", "medium", "low"]);

export type AssistantConfidence = "high" | "medium" | "low";

export interface AssistantMessageMetadataInput<
  TArtifact = unknown,
  TWebSource = unknown,
  TSearchQuery = unknown,
  TRetrievalStep = unknown,
  TStep = unknown,
> {
  artifact?: TArtifact | null;
  artifacts?: TArtifact[] | null;
  webSources?: TWebSource[] | null;
  searchQueries?: TSearchQuery[] | null;
  totalSearches?: unknown;
  followUpSuggestions?: unknown;
  confidence?: unknown;
  uncertaintyReason?: unknown;
  retrievalSteps?: TRetrievalStep[] | null;
  steps?: TStep[] | null;
}

export interface AssistantMessageInput<
  TArtifact = unknown,
  TFigmaDiagram = unknown,
  TGoogleFormPreview = unknown,
  TGmailPreview = unknown,
  TWebSource = unknown,
  TSearchQuery = unknown,
  TRetrievalStep = unknown,
  TStep = unknown,
> extends AssistantMessageMetadataInput<TArtifact, TWebSource, TSearchQuery, TRetrievalStep, TStep> {
  id?: unknown;
  timestamp?: unknown;
  requestId?: unknown;
  userMessageId?: unknown;
  content: unknown;
  fallbackContent?: string;
  artifact?: TArtifact | null;
  figmaDiagram?: TFigmaDiagram | null;
  generatedImage?: unknown;
  googleFormPreview?: TGoogleFormPreview | null;
  gmailPreview?: TGmailPreview | null;
  ui_components?: unknown;
}

export interface AssistantMessageRecord<
  TArtifact = unknown,
  TFigmaDiagram = unknown,
  TGoogleFormPreview = unknown,
  TGmailPreview = unknown,
  TWebSource = unknown,
  TSearchQuery = unknown,
  TRetrievalStep = unknown,
  TStep = unknown,
> extends AssistantMessageMetadataInput<TArtifact, TWebSource, TSearchQuery, TRetrievalStep, TStep> {
  id?: string;
  role: "assistant";
  content: string;
  timestamp?: Date;
  requestId?: string;
  userMessageId?: string;
  artifact?: TArtifact;
  artifacts?: TArtifact[];
  figmaDiagram?: TFigmaDiagram;
  generatedImage?: string;
  googleFormPreview?: TGoogleFormPreview;
  gmailPreview?: TGmailPreview;
  followUpSuggestions?: string[];
  confidence?: AssistantConfidence;
  uncertaintyReason?: string;
  totalSearches?: number;
  ui_components?: string[];
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeAssistantContent(content: unknown, fallbackContent?: string): string {
  if (typeof content === "string" && hasMeaningfulAssistantContent(content)) {
    return content;
  }

  const fallback = fallbackContent?.trim() || DEFAULT_ASSISTANT_FALLBACK_CONTENT;
  return fallback;
}

function normalizePositiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

function normalizeConfidence(value: unknown): AssistantConfidence | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return ALLOWED_CONFIDENCE.has(normalized) ? (normalized as AssistantConfidence) : undefined;
}

function normalizeArray<T>(value: T[] | null | undefined): T[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value;
}

function normalizeUiComponents(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const normalized = Array.from(new Set(value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)));

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeTimestamp(value: unknown): Date | undefined {
  if (!(value instanceof Date)) return undefined;
  return Number.isNaN(value.getTime()) ? undefined : value;
}

export function buildAssistantMessage<
  TArtifact = unknown,
  TFigmaDiagram = unknown,
  TGoogleFormPreview = unknown,
  TGmailPreview = unknown,
  TWebSource = unknown,
  TSearchQuery = unknown,
  TRetrievalStep = unknown,
  TStep = unknown,
>(
  input: AssistantMessageInput<
    TArtifact,
    TFigmaDiagram,
    TGoogleFormPreview,
    TGmailPreview,
    TWebSource,
    TSearchQuery,
    TRetrievalStep,
    TStep
  >,
): AssistantMessageRecord<
  TArtifact,
  TFigmaDiagram,
  TGoogleFormPreview,
  TGmailPreview,
  TWebSource,
  TSearchQuery,
  TRetrievalStep,
  TStep
> {
  const followUpSuggestions = normalizeFollowUpSuggestions(input.followUpSuggestions);

  return {
    id: normalizeOptionalString(input.id),
    role: "assistant",
    content: normalizeAssistantContent(input.content, input.fallbackContent),
    timestamp: normalizeTimestamp(input.timestamp),
    requestId: normalizeOptionalString(input.requestId),
    userMessageId: normalizeOptionalString(input.userMessageId),
    artifact: input.artifact ?? undefined,
    artifacts: normalizeArray(input.artifacts),
    figmaDiagram: input.figmaDiagram ?? undefined,
    generatedImage: normalizeOptionalString(input.generatedImage),
    googleFormPreview: input.googleFormPreview ?? undefined,
    gmailPreview: input.gmailPreview ?? undefined,
    webSources: normalizeArray(input.webSources),
    searchQueries: normalizeArray(input.searchQueries),
    totalSearches: normalizePositiveNumber(input.totalSearches),
    followUpSuggestions: followUpSuggestions.length > 0 ? followUpSuggestions : undefined,
    confidence: normalizeConfidence(input.confidence),
    uncertaintyReason: normalizeOptionalString(input.uncertaintyReason),
    retrievalSteps: normalizeArray(input.retrievalSteps),
    steps: normalizeArray(input.steps),
    ui_components: normalizeUiComponents(input.ui_components),
  };
}

export function buildAssistantMessageMetadata<
  TArtifact = unknown,
  TWebSource = unknown,
  TSearchQuery = unknown,
  TRetrievalStep = unknown,
  TStep = unknown,
>(
  input: AssistantMessageMetadataInput<TArtifact, TWebSource, TSearchQuery, TRetrievalStep, TStep>,
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};

  if (input.artifact) metadata.artifact = input.artifact;
  const artifacts = normalizeArray(input.artifacts);
  if (artifacts) metadata.artifacts = artifacts;

  const webSources = normalizeArray(input.webSources);
  const searchQueries = normalizeArray(input.searchQueries);
  const totalSearches = normalizePositiveNumber(input.totalSearches);
  const followUpSuggestions = normalizeFollowUpSuggestions(input.followUpSuggestions);
  const confidence = normalizeConfidence(input.confidence);
  const uncertaintyReason = normalizeOptionalString(input.uncertaintyReason);
  const retrievalSteps = normalizeArray(input.retrievalSteps);
  const steps = normalizeArray(input.steps);

  if (webSources) metadata.webSources = webSources;
  if (searchQueries) metadata.searchQueries = searchQueries;
  if (totalSearches !== undefined) metadata.totalSearches = totalSearches;
  if (followUpSuggestions.length > 0) metadata.followUpSuggestions = followUpSuggestions;
  if (confidence) metadata.confidence = confidence;
  if (uncertaintyReason) metadata.uncertaintyReason = uncertaintyReason;
  if (retrievalSteps) metadata.retrievalSteps = retrievalSteps;
  if (steps) metadata.steps = steps;

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}
