import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { llmGateway } from "../lib/llmGateway";
import { storage } from "../storage";
import {
  extractAllAttachmentsContent,
  formatAttachmentsAsContext,
  type Attachment,
  type ExtractedContent,
} from "../services/attachmentService";
import {
  buildDocumentPrompt,
  createAuditLog,
  detectIntent,
  validateResponse,
} from "../services/intentGuard";

const MAX_DOCUMENT_RESPONSE_RETRIES = 2;
const DEFAULT_DOCUMENT_MODEL = "gemini-2.5-flash";
const ATTACHMENT_READY_MAX_WAIT_MS = process.env.NODE_ENV === "test" ? 25 : 20_000;
const ATTACHMENT_READY_POLL_MS = process.env.NODE_ENV === "test" ? 1 : 500;
const EXTENSION_MIME_TYPE_MAP: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  html: "text/html",
  htm: "text/html",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
};
const ATTACHMENT_TRANSCRIPTION_PATTERNS = [
  /\btranscrib(?:e|ir|elo|ela|an|eme)?\b/i,
  /\btranscription\b/i,
  /\bocr\b/i,
  /\bextrae(?:r)?\s+(?:todo\s+)?el\s+texto\b/i,
  /\bextrae(?:r)?\s+texto\b/i,
  /\blee(?:r)?\s+(?:todo\s+)?el\s+texto\b/i,
  /\bcopia(?:r)?\s+(?:todo\s+)?el\s+texto\b/i,
  /\btexto\s+completo\b/i,
  /\bpasalo?\s+a\s+texto\b/i,
  /\bwhat\s+does\s+(?:this|the)\s+(?:image|document|file)\s+say\b/i,
  /\bextract\s+(?:all\s+)?text\b/i,
  /\bread\s+the\s+text\b/i,
];

function getAttachmentExtension(name: string): string {
  const trimmedName = String(name || "").trim().toLowerCase();
  const extensionIndex = trimmedName.lastIndexOf(".");
  if (extensionIndex < 0) {
    return "";
  }
  return trimmedName.slice(extensionIndex + 1);
}

function inferMimeTypeFromAttachmentName(name: string): string {
  return EXTENSION_MIME_TYPE_MAP[getAttachmentExtension(name)] || "";
}

function normalizeAttachmentMimeType(name: string, rawMimeType: string): string {
  const normalizedMimeType = String(rawMimeType || "").trim().toLowerCase();
  const inferredMimeType = inferMimeTypeFromAttachmentName(name);
  const extension = getAttachmentExtension(name);

  if (extension === "csv") {
    return "text/csv";
  }

  if (!normalizedMimeType || normalizedMimeType === "application/octet-stream") {
    return inferredMimeType || "application/octet-stream";
  }

  if ((normalizedMimeType === "text/plain" || normalizedMimeType === "application/vnd.ms-excel") && inferredMimeType) {
    return inferredMimeType;
  }

  return normalizedMimeType;
}

async function normalizeAttachmentForExtraction(raw: unknown): Promise<Attachment | null> {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const attachment = raw as Record<string, unknown>;
  let name = String(attachment.name || attachment.filename || "").trim();
  let storagePath = String(attachment.storagePath || attachment.path || "").trim();
  let fileId =
    typeof attachment.fileId === "string"
      ? attachment.fileId
      : typeof attachment.id === "string"
        ? attachment.id
        : undefined;
  const fileRecord =
    fileId
      ? await storage.getFile(fileId)
      : storagePath
        ? await storage.getFileByStoragePath(storagePath)
        : undefined;

  if (fileRecord) {
    if (!fileId && typeof fileRecord.id === "string") {
      fileId = fileRecord.id;
    }
    if (!name && typeof fileRecord.name === "string") {
      name = fileRecord.name;
    }
    if (!storagePath && typeof fileRecord.storagePath === "string") {
      storagePath = fileRecord.storagePath;
    }
  }

  const mimeType = normalizeAttachmentMimeType(
    name,
    String(attachment.mimeType || attachment.type || fileRecord?.type || "").trim(),
  );

  if (!name || !storagePath) {
    return null;
  }

  return {
    name,
    storagePath,
    mimeType,
    type: mimeType || "application/octet-stream",
    fileId,
  };
}

async function normalizeAttachmentsForExtraction(attachments: unknown[]): Promise<Attachment[]> {
  const normalizedAttachments = await Promise.all(
    attachments.map((attachment) => normalizeAttachmentForExtraction(attachment))
  );

  return normalizedAttachments.filter((attachment): attachment is Attachment => attachment !== null);
}

async function extractNormalizedAttachmentContents(attachments: unknown[]): Promise<ExtractedContent[]> {
  const normalizedAttachments = await normalizeAttachmentsForExtraction(attachments);
  if (normalizedAttachments.length === 0) {
    return [];
  }

  const extractedContents = await extractAllAttachmentsContent(normalizedAttachments);
  if (extractedContents.length > 0) {
    return extractedContents;
  }

  return waitForReadyAttachmentContents(normalizedAttachments);
}

function isPendingFileStatus(status: string | null | undefined): boolean {
  return status === "processing" || status === "pending" || status === "uploading";
}

function getAttachmentDocumentType(mimeType: string): string | undefined {
  return mimeType.startsWith("image/") ? "Image OCR" : undefined;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshAttachmentMetadata(attachment: Attachment): Promise<{
  attachment: Attachment;
  pending: boolean;
}> {
  if (!attachment.fileId) {
    return { attachment, pending: false };
  }

  const file = await storage.getFile(attachment.fileId);
  if (!file) {
    return { attachment, pending: false };
  }

  const refreshedName = attachment.name || file.name;
  const refreshedStoragePath = attachment.storagePath || file.storagePath;
  const refreshedMimeType = normalizeAttachmentMimeType(
    refreshedName,
    attachment.mimeType || file.type || "",
  );

  return {
    attachment: {
      ...attachment,
      name: refreshedName,
      storagePath: refreshedStoragePath || attachment.storagePath,
      mimeType: refreshedMimeType,
      type: refreshedMimeType || "application/octet-stream",
    },
    pending: isPendingFileStatus(file.status),
  };
}

async function extractReadyAttachmentContent(attachment: Attachment): Promise<{
  content: ExtractedContent | null;
  pending: boolean;
}> {
  if (!attachment.fileId) {
    return { content: null, pending: false };
  }

  const file = await storage.getFile(attachment.fileId);
  if (!file) {
    return { content: null, pending: false };
  }

  if (isPendingFileStatus(file.status)) {
    return { content: null, pending: true };
  }

  if (file.status !== "ready") {
    return { content: null, pending: false };
  }

  const chunks = await storage.getFileChunks(file.id);
  const text = chunks
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
    .map((chunk) => String(chunk.content || ""))
    .join("\n")
    .trim();

  if (!text) {
    return { content: null, pending: false };
  }

  const mimeType = attachment.mimeType || file.type || "application/octet-stream";

  return {
    content: {
      fileName: attachment.name || file.name,
      content: text,
      mimeType,
      documentType: getAttachmentDocumentType(mimeType),
    },
    pending: false,
  };
}

async function waitForReadyAttachmentContents(attachments: Attachment[]): Promise<ExtractedContent[]> {
  const deadline = Date.now() + ATTACHMENT_READY_MAX_WAIT_MS;
  let currentAttachments = attachments;

  while (Date.now() <= deadline) {
    let sawPendingAttachment = false;
    const refreshedAttachments: Attachment[] = [];

    for (const attachment of currentAttachments) {
      const refreshed = await refreshAttachmentMetadata(attachment);
      refreshedAttachments.push(refreshed.attachment);
      if (refreshed.pending) {
        sawPendingAttachment = true;
      }
    }

    const extractedContents = await extractAllAttachmentsContent(refreshedAttachments);
    if (extractedContents.length > 0) {
      return extractedContents;
    }

    const contents: ExtractedContent[] = [];

    for (const attachment of refreshedAttachments) {
      const ready = await extractReadyAttachmentContent(attachment);
      if (ready.content) {
        contents.push(ready.content);
      } else if (ready.pending) {
        sawPendingAttachment = true;
      }
    }

    if (contents.length > 0) {
      return contents;
    }

    if (!sawPendingAttachment) {
      return [];
    }

    currentAttachments = refreshedAttachments;
    await sleep(ATTACHMENT_READY_POLL_MS);
  }

  return [];
}

function formatAttachmentsAsTranscript(extractedContents: ExtractedContent[]): string {
  if (extractedContents.length === 0) {
    return "";
  }

  if (extractedContents.length === 1) {
    return extractedContents[0]?.content?.trim() || "";
  }

  return extractedContents
    .map((content) => {
      const typeLabel = content.documentType ? ` (${content.documentType})` : "";
      return `--- ${content.fileName}${typeLabel} ---\n${content.content.trim()}`;
    })
    .join("\n\n");
}

export function isAttachmentTranscriptionRequest(message: string): boolean {
  const normalizedMessage = String(message || "").trim();
  if (!normalizedMessage) {
    return false;
  }

  return ATTACHMENT_TRANSCRIPTION_PATTERNS.some((pattern) => pattern.test(normalizedMessage));
}

export async function buildDocumentAttachmentContext(attachments: unknown[]): Promise<string> {
  const extractedContents = await extractNormalizedAttachmentContents(attachments);
  if (extractedContents.length === 0) {
    return "";
  }

  return formatAttachmentsAsContext(extractedContents);
}

export async function generateDirectAttachmentTranscriptionResponse(options: {
  userMessage: string;
  attachments: unknown[];
}): Promise<string | null> {
  if (!isAttachmentTranscriptionRequest(options.userMessage)) {
    return null;
  }

  const extractedContents = await extractNormalizedAttachmentContents(options.attachments);
  if (extractedContents.length === 0) {
    return null;
  }

  return formatAttachmentsAsTranscript(extractedContents);
}

export async function generateDirectDocumentResponse(options: {
  userMessage: string;
  attachments: unknown[];
  userId: string;
  modelId?: string;
}): Promise<string | null> {
  const attachmentContext = await buildDocumentAttachmentContext(options.attachments);
  if (!attachmentContext.trim()) {
    return null;
  }

  const intentContract = detectIntent(options.userMessage, false, true);
  if (intentContract.taskType === "web_search") {
    return null;
  }

  const documentPrompt = buildDocumentPrompt(
    intentContract,
    attachmentContext,
    options.userMessage
  );

  let systemPrompt = documentPrompt;
  let attempt = 0;

  try {
    while (attempt <= MAX_DOCUMENT_RESPONSE_RETRIES) {
      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: options.userMessage },
      ];

      const llmResponse = await llmGateway.chat(messages, {
        temperature: 0.3,
        maxTokens: 2500,
        userId: options.userId,
        model: options.modelId || DEFAULT_DOCUMENT_MODEL,
      });

      const validation = validateResponse(llmResponse.content, intentContract);
      if (validation.valid) {
        return llmResponse.content;
      }

      if (attempt < MAX_DOCUMENT_RESPONSE_RETRIES && validation.suggestedRetryPrompt) {
        systemPrompt = `${documentPrompt}\n\nCORRECCIÓN IMPORTANTE:\n${validation.suggestedRetryPrompt}`;
        attempt++;
        continue;
      }

      const auditLog = createAuditLog(
        intentContract,
        options.userMessage,
        "agent_document_direct_response",
        attempt < MAX_DOCUMENT_RESPONSE_RETRIES ? "retry" : "fail",
        validation.error
      );
      console.error(
        `[DocumentDirectResponse] Validation failed after retries: ${JSON.stringify(auditLog)}`
      );

      return "Error de análisis: el sistema detectó una inconsistencia en la respuesta. Reformula tu pregunta sobre el documento.";
    }
  } catch (error: unknown) {
    console.error("[DocumentDirectResponse] Failed to analyze attachment content:", error);
    const message = error instanceof Error ? error.message : "no se pudo procesar el archivo adjunto.";
    return `Error al analizar el documento: ${message}`;
  }

  return null;
}
