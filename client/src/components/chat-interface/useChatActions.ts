/**
 * Chat Actions Hook
 * Handles all message sending, editing, and API interactions with defensive validation.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";

import { chatLogger } from "@/lib/logger";
import { useToast } from "@/hooks/use-toast";
import { Message, Attachment, type AIState } from "./types";

interface UseChatActionsProps {
  chatId: string | null;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setAiState: Dispatch<SetStateAction<AIState>>;
  setStreamingContent: Dispatch<SetStateAction<string>>;
  setUiPhase: Dispatch<SetStateAction<"idle" | "thinking" | "console" | "done">>;
  selectedDocTool: string | null;
  projectId?: string;
  gptConfig?: { systemPrompt?: string; model?: string };
}

type AiVisualState = AIState;

const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_ATTACHMENT_TOTAL_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_ATTACHMENTS = 8;
const MAX_MESSAGE_LENGTH = 16_000;
const MAX_ATTACHMENT_NAME_LENGTH = 200;
const REQUEST_TIMEOUT_MS = 120_000;
const FIRST_CHUNK_TIMEOUT_MS = 12_000;
const ALLOWED_ATTACHMENT_PREFIXES = [
  "image/",
  "audio/",
  "video/",
  "application/pdf",
  "text/",
  "application/json",
  "application/xml",
  "application/zip",
];
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F-\u009F]/g;

const sanitizeMessageText = (raw: string): string => {
  const normalized = (raw ?? "").normalize("NFKC").replace(CONTROL_CHAR_PATTERN, "").trim();
  return normalized.length > MAX_MESSAGE_LENGTH
    ? normalized.slice(0, MAX_MESSAGE_LENGTH)
    : normalized;
};

const sanitizeAttachmentName = (name: string): string => {
  const cleaned = (name ?? "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(CONTROL_CHAR_PATTERN, "_")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.slice(0, MAX_ATTACHMENT_NAME_LENGTH) || "archivo";
};

const isSupportedMimeType = (mime: string): boolean =>
  ALLOWED_ATTACHMENT_PREFIXES.some((prefix) => mime.toLowerCase().startsWith(prefix));

const generateRequestId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `req_${crypto.randomUUID()}`;
  }

  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Error de comunicación con el servidor";
};

const toFallbackMessage = (partial: string, detail: string): string => {
  const base = partial.trim();
  if (!base) {
    return `No se pudo completar la respuesta.\nDetalle: ${detail}`;
  }
  return `${base}\n\n[Respuesta parcial] La respuesta quedó incompleta. ${detail}`;
};

const hasRequestIdMismatch = (requestId: string | null, expected: string): boolean =>
  !!requestId && requestId !== expected;

export interface UseChatActionsReturn {
  sendMessage: (content: string, attachments?: File[]) => Promise<void>;
  editMessage: (messageId: string, newContent: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  regenerateMessage: (messageId: string) => Promise<void>;
  cancelRequest: () => void;
  isProcessing: boolean;
}

export function useChatActions({
  chatId,
  messages,
  setMessages,
  setAiState,
  setStreamingContent,
  setUiPhase,
  selectedDocTool,
  projectId,
  gptConfig,
}: UseChatActionsProps): UseChatActionsReturn {
  const { toast } = useToast();

  const mountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isProcessingRef = useRef(false);
  const requestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstChunkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequestFingerprintRef = useRef<string | null>(null);
  const streamBufferRef = useRef("");
  const requestIdRef = useRef<string | null>(null);
  const fullContentRef = useRef("");

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      if (requestTimeoutRef.current) {
        clearTimeout(requestTimeoutRef.current);
        requestTimeoutRef.current = null;
      }
      if (firstChunkTimeoutRef.current) {
        clearTimeout(firstChunkTimeoutRef.current);
        firstChunkTimeoutRef.current = null;
      }
    };
  }, []);

  const setAiStateForChat = useCallback(
    (value: SetStateAction<AiVisualState>, conversationId?: string | null) => {
      if (!mountedRef.current) return;
      if (conversationId && conversationId !== chatId) return;
      setAiState(value);
    },
    [chatId, setAiState],
  );

  const clearRequestTimers = useCallback(() => {
    if (requestTimeoutRef.current) {
      clearTimeout(requestTimeoutRef.current);
      requestTimeoutRef.current = null;
    }
    if (firstChunkTimeoutRef.current) {
      clearTimeout(firstChunkTimeoutRef.current);
      firstChunkTimeoutRef.current = null;
    }
  }, []);

  const clearRequestState = useCallback(() => {
    requestIdRef.current = null;
    fullContentRef.current = "";
    streamBufferRef.current = "";
    isProcessingRef.current = false;
    lastRequestFingerprintRef.current = null;
    abortControllerRef.current = null;
  }, []);

  const finalizeRequestState = useCallback(
    (nextState: AiVisualState = "idle") => {
      clearRequestTimers();
      clearRequestState();
      if (!mountedRef.current) return;
      setStreamingContent("");
      setAiStateForChat(nextState, chatId);
      setUiPhase(nextState === "done" ? "done" : "idle");
    },
    [clearRequestState, clearRequestTimers, chatId, setAiStateForChat, setStreamingContent, setUiPhase],
  );

  const emitAssistantMessage = useCallback(
    (content: string, metadata?: Record<string, unknown>) => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content,
          timestamp: new Date(),
          metadata: {
            model: gptConfig?.model,
            requestId: requestIdRef.current,
            ...metadata,
          },
        },
      ]);
    },
    [gptConfig?.model, setMessages],
  );

  const validateAttachments = useCallback((files: File[]) => {
    const safe: File[] = [];
    const errors: string[] = [];
    let total = 0;

    for (const file of files) {
      if (!file) {
        errors.push("archivo inválido");
        continue;
      }

      if (file.size <= 0) {
        errors.push(`${file.name}: archivo vacío`);
        continue;
      }

      if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        errors.push(`${file.name}: supera 20MB`);
        continue;
      }

      if (!isSupportedMimeType(file.type)) {
        errors.push(`${file.name}: MIME no permitido (${file.type || "desconocido"})`);
        continue;
      }

      total += file.size;
      safe.push(file);
    }

    return { safeFiles: safe, errors, totalBytes: total };
  }, []);

  const parseSseLine = useCallback(
    (line: string, currentEvent: string, accumulated: string): { event: string; content: string; done: boolean; error?: string } => {
      const trimmed = line.trim();
      if (!trimmed) {
        return { event: currentEvent, content: accumulated, done: false };
      }

      if (trimmed.startsWith("event:")) {
        return { event: trimmed.slice(6).trim() || "chunk", content: accumulated, done: false };
      }

      if (!trimmed.startsWith("data:")) {
        return { event: currentEvent, content: accumulated, done: false };
      }

      const payload = trimmed.slice(5).trimStart();
      if (!payload) {
        return { event: currentEvent, content: accumulated, done: false };
      }

      if (payload === "[DONE]") {
        return { event: currentEvent, content: accumulated, done: true };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return { event: currentEvent, content: accumulated, done: false };
      }

      if (!parsed || typeof parsed !== "object") {
        return { event: currentEvent, content: accumulated, done: false };
      }

      const parsedObj = parsed as Record<string, unknown>;
      const event = typeof parsedObj.event === "string" ? parsedObj.event : currentEvent;
      if (event === "done" || event === "finish" || parsedObj.done === true) {
        const finalContent =
          typeof parsedObj.content === "string"
            ? `${accumulated}${parsedObj.content}`
            : accumulated;
        return { event, content: finalContent, done: true };
      }

      if (
        event === "error" ||
        event === "production_error" ||
        typeof parsedObj.error === "string"
      ) {
        return {
          event,
          content: accumulated,
          done: true,
          error:
            typeof parsedObj.error === "string"
              ? parsedObj.error
              : "Error del stream",
        };
      }

      const incoming =
        typeof parsedObj.content === "string"
          ? parsedObj.content
          : typeof parsedObj.delta === "string"
            ? parsedObj.delta
            : "";

      return {
        event,
        content: incoming ? `${accumulated}${incoming}` : accumulated,
        done: false,
      };
    },
    [],
  );

  const sendMessage = useCallback(async (content: string, attachments?: File[]) => {
    const safeContent = sanitizeMessageText(content);
    if (content.length > MAX_MESSAGE_LENGTH) {
      toast({
        title: "Mensaje muy largo",
        description: `Se limitará el mensaje a ${MAX_MESSAGE_LENGTH} caracteres.`,
      });
    }

    const requestId = generateRequestId();
    const requestedFiles = attachments ?? [];
    const { safeFiles, errors, totalBytes } = validateAttachments(requestedFiles);
    const fingerprint = `${chatId || ""}|${safeContent}|${safeFiles.length}|${safeFiles.map((file) => file.name).join(",")}`;

    if (!safeContent && safeFiles.length === 0) return;

    if (safeFiles.length > MAX_ATTACHMENTS) {
      toast({
        title: "Límite de adjuntos",
        description: `Máximo ${MAX_ATTACHMENTS} archivos por mensaje.`,
        variant: "destructive",
      });
      return;
    }

    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      toast({
        title: "Límite de tamaño total",
        description: `La suma de adjuntos no puede exceder ${Math.round(MAX_ATTACHMENT_TOTAL_BYTES / (1024 * 1024))} MB.`,
        variant: "destructive",
      });
      return;
    }

    if (errors.length > 0) {
      toast({
        title: "Adjuntos inválidos",
        description: errors.join(" | "),
        variant: "destructive",
      });
      if (safeFiles.length === 0) return;
    }

    if (isProcessingRef.current && lastRequestFingerprintRef.current === fingerprint) {
      chatLogger.warn("chat-send-dedup", { chatId, requestId });
      return;
    }

    requestIdRef.current = requestId;
    lastRequestFingerprintRef.current = fingerprint;
    isProcessingRef.current = true;
    abortControllerRef.current = new AbortController();

    requestTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      abortControllerRef.current?.abort();
      finalizeRequestState("error");
      toast({
        title: "Timeout",
        description: `No se recibió respuesta en ${REQUEST_TIMEOUT_MS} ms.`,
        variant: "destructive",
      });
    }, REQUEST_TIMEOUT_MS);

    let firstChunkReceived = false;
    firstChunkTimeoutRef.current = setTimeout(() => {
      if (!firstChunkReceived && isProcessingRef.current && mountedRef.current) {
        abortControllerRef.current?.abort();
        finalizeRequestState("error");
        toast({
          title: "Timeout de stream",
          description: `Sin primer fragmento en ${FIRST_CHUNK_TIMEOUT_MS} ms.`,
          variant: "destructive",
        });
      }
    }, FIRST_CHUNK_TIMEOUT_MS);

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: safeContent,
      timestamp: new Date(),
      attachments: safeFiles.length
        ? await processAttachments(
            safeFiles.map((file) => ({ file, safeName: sanitizeAttachmentName(file.name) })),
          )
        : undefined,
    };

    const historyMessages = [...messages, userMessage].map((message) => ({
      role: message.role,
      content: sanitizeMessageText(message.content),
    }));

    setMessages((prev) => [...prev, userMessage]);
    setAiStateForChat("thinking", chatId);
    setUiPhase("thinking");
    setStreamingContent("");

    const controller = abortControllerRef.current;
    if (!controller) return;

    try {
      const response = await fetch("/api/chat/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
        credentials: "include",
        body: JSON.stringify({
          chatId,
          requestId,
          message: safeContent,
          messages: historyMessages,
          attachments: userMessage.attachments,
          projectId,
          docTool: selectedDocTool,
          ...gptConfig,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        let serverMessage = "";
        try {
          const serverJson = bodyText ? JSON.parse(bodyText) : null;
          if (serverJson && typeof serverJson === "object" && "error" in serverJson) {
            serverMessage = toErrorMessage((serverJson as { error?: unknown }).error);
          }
        } catch {
          serverMessage = bodyText;
        }

        const errorText = `HTTP ${response.status} ${response.statusText}${
          serverMessage ? ` - ${serverMessage.slice(0, 300)}` : ""
        }`;
        throw new Error(errorText);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No se recibió cuerpo en la respuesta.");
      }

      const decoder = new TextDecoder();
      let fullContent = "";
      let currentEvent = "chunk";
      let streamDone = false;
      let streamError: string | null = null;
      setAiStateForChat("responding", chatId);
      setUiPhase("console");

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!mountedRef.current) break;

        const chunk = decoder.decode(value, { stream: true });
        const buffered = `${streamBufferRef.current}${chunk}`;
        const lines = buffered.split("\n");
        streamBufferRef.current = lines.pop() || "";

        if (!firstChunkReceived) {
          firstChunkReceived = true;
          if (firstChunkTimeoutRef.current) {
            clearTimeout(firstChunkTimeoutRef.current);
            firstChunkTimeoutRef.current = null;
          }
        }

        for (const line of lines) {
          const parsed = parseSseLine(line, currentEvent, fullContent);
          currentEvent = parsed.event;
          if (parsed.error) {
            streamError = parsed.error;
            continue;
          }
          if (parsed.done) {
            streamDone = true;
            fullContent = parsed.content;
            break;
          }
          if (parsed.content !== fullContent) {
            fullContent = parsed.content;
            fullContentRef.current = fullContent;
            setStreamingContent(fullContent);
          }
        }

        if (streamError) {
          streamDone = true;
        }
      }

      if (!streamDone && streamBufferRef.current.startsWith("data:")) {
        const parsed = parseSseLine(streamBufferRef.current, currentEvent, fullContent);
        if (parsed.error) {
          streamError = parsed.error;
        } else if (parsed.done) {
          streamDone = true;
          fullContent = parsed.content;
        } else if (parsed.content !== fullContent) {
          fullContent = parsed.content;
          fullContentRef.current = fullContent;
          setStreamingContent(fullContent);
        }
      }

      if (!mountedRef.current) return;
      if (streamError) {
        const fallback = toFallbackMessage(fullContent, streamError);
        emitAssistantMessage(fallback, { fallback: true, failureSource: "stream", status: "partial" });
        finalizeRequestState("done");
        toast({
          title: "Respuesta parcial",
          description: streamError,
          variant: "destructive",
        });
        return;
      }

      if (fullContent) {
        emitAssistantMessage(fullContent, { status: "complete" });
        finalizeRequestState("done");
        return;
      }

      const fallback = toFallbackMessage(
        "",
        hasRequestIdMismatch(requestIdRef.current, requestId) ? "mensaje fuera de tiempo" : "sin contenido de respuesta",
      );
      emitAssistantMessage(fallback, { fallback: true, failureSource: "stream", status: "empty" });
      finalizeRequestState("error");
      toast({
        title: "Respuesta vacía",
        description: "La respuesta llegó sin contenido utilizable.",
        variant: "destructive",
      });
    } catch (error: unknown) {
      if (!mountedRef.current) return;
      if ((error as { name?: string })?.name === "AbortError") {
        finalizeRequestState("idle");
        return;
      }

      const message = toErrorMessage(error);
      const fallback = toFallbackMessage(fullContentRef.current, message);
      emitAssistantMessage(fallback, {
        status: fullContentRef.current ? "partial" : "failed",
        failureSource: "network",
      });
      finalizeRequestState("error");
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    }

    chatLogger.debug("chat-send-end", {
      chatId,
      requestId,
      status: requestTimeoutRef.current ? "ok" : "timeout_or_canceled",
      contentLength: fullContentRef.current.length,
    });
  }, [
    chatId,
    emitAssistantMessage,
    messages,
    projectId,
    selectedDocTool,
    setAiStateForChat,
    setMessages,
    setStreamingContent,
    setUiPhase,
    toast,
    validateAttachments,
    parseSseLine,
    finalizeRequestState,
    gptConfig?.model,
  ]);

  const editMessage = useCallback(async (messageId: string, newContent: string) => {
    const safeContent = sanitizeMessageText(newContent);
    setMessages((prev) =>
      prev.map((message) => (message.id === messageId ? { ...message, content: safeContent } : message)),
    );
  }, [setMessages]);

  const deleteMessage = useCallback(
    async (messageId: string) => {
      setMessages((prev) => prev.filter((message) => message.id !== messageId));
    },
    [setMessages],
  );

  const regenerateMessage = useCallback(
    async (messageId: string) => {
      const messageIndex = messages.findIndex((message) => message.id === messageId);
      if (messageIndex === -1) return;

      const previousUserMessage = [...messages]
        .slice(0, messageIndex)
        .reverse()
        .find((message) => message.role === "user");

      if (!previousUserMessage) return;

      setMessages((prev) => prev.slice(0, messageIndex));
      await sendMessage(previousUserMessage.content, undefined);
    },
    [messages, sendMessage, setMessages],
  );

  const cancelRequest = useCallback(() => {
    abortControllerRef.current?.abort();
    finalizeRequestState("idle");
  }, [finalizeRequestState]);

  return {
    sendMessage,
    editMessage,
    deleteMessage,
    regenerateMessage,
    cancelRequest,
    isProcessing: isProcessingRef.current,
  };
}

async function processAttachments(
  files: { file: File; safeName: string }[],
): Promise<Attachment[]> {
  return Promise.all(
    files.map(async ({ file, safeName }) => {
      const content = await readFileAsDataURL(file);
      return {
        id: crypto.randomUUID(),
        name: safeName,
        type: file.type,
        size: file.size,
        content,
        thumbnail: file.type.startsWith("image/") ? content : undefined,
      };
    }),
  );
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
