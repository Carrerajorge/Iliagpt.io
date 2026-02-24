import { normalizeFileForUpload } from "@/lib/attachmentIngest";
import { apiFetch } from "@/lib/apiClient";
import { ensureCsrfToken, resolveUploadUrlForResponse, uploadBlobWithProgress } from "@/lib/uploadTransport";
import type { FileStatusResponse } from "@shared/uploadContracts";

export interface ValidationResult {
  type: 'validation_result';
  valid: boolean;
  errors: string[];
  file: {
    name: string;
    size: number;
    type: string;
    extension: string;
  };
}

export interface UploadProgress {
  fileId: string;
  phase: 'validating' | 'uploading' | 'processing' | 'completed' | 'error';
  uploadProgress: number;
  processingProgress: number;
  error?: string;
}

interface FileConfig {
  allowedMimeTypes: string[];
  allowedExtensions: Record<string, string>;
  maxFileSize: number;
  chunkSize: number;
  maxParallelChunks: number;
}

interface MultipartSession {
  uploadId: string;
  storagePath: string;
}

interface UploadOptions {
  uploadId?: string;
  conversationId?: string | null;
}

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  baseDelay: number = RETRY_BASE_DELAY_MS,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new Error('Upload cancelled');
    }
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      // Don't retry on validation or client errors (4xx)
      const msg = (error?.message || '').toLowerCase();
      if (
        msg.includes('cancelled') ||
        msg.includes('abort') ||
        msg.includes('not permitted') ||
        msg.includes('not allowed') ||
        msg.includes('too large') ||
        msg.includes('empty')
      ) {
        throw error;
      }
      if (attempt < maxRetries) {
        const jitter = Math.floor(Math.random() * 200);
        const delay = baseDelay * Math.pow(2, attempt) + jitter;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError || new Error('Upload failed after retries');
}

export class ChunkedFileUploader {
  private worker: Worker | null = null;
  private ws: WebSocket | null = null;
  private config: FileConfig | null = null;
  private wsReconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private wsListeners: Map<string, (status: any) => void> = new Map();
  private statusPollTimers: Map<string, number> = new Map();
  private abortController: AbortController | null = null;
  private wsAuthFailed = false;

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    try {
      this.worker = new Worker(
        new URL('../workers/fileValidationWorker.ts', import.meta.url),
        { type: 'module' }
      );
    } catch (error) {
      console.error('Failed to initialize validation worker:', error);
    }
  }

  private async fetchConfig(): Promise<FileConfig> {
    if (this.config) return this.config;

    const response = await apiFetch('/api/files/config', {
      ...(this.abortController?.signal ? { signal: this.abortController.signal } : {}),
    });
    if (!response.ok) {
      throw new Error('Failed to fetch file upload configuration');
    }

    this.config = await response.json();
    return this.config!;
  }

  private async readFileHeaderBytes(file: File, numBytes: number = 16): Promise<number[]> {
    try {
      const slice = file.slice(0, numBytes);
      const buffer = await slice.arrayBuffer();
      return Array.from(new Uint8Array(buffer));
    } catch (error) {
      console.warn('Failed to read file header bytes:', error);
      return [];
    }
  }

  async validateFile(file: File): Promise<ValidationResult> {
    const config = await this.fetchConfig();
    const headerBytes = await this.readFileHeaderBytes(file);

    if (!this.worker) {
      const errors: string[] = [];
      const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();

      const detectedMimeType = this.detectMimeTypeFromBytes(headerBytes, file.type, extension);

      if (!this.isValidMimeType(detectedMimeType, file.type, config.allowedMimeTypes)) {
        errors.push('Tipo de archivo no permitido');
      }
      if (file.size > config.maxFileSize) {
        errors.push(`El archivo excede el tamaño máximo de ${config.maxFileSize / (1024 * 1024)}MB`);
      }
      if (file.size === 0) {
        errors.push('El archivo está vacío');
      }

      return {
        type: 'validation_result',
        valid: errors.length === 0,
        errors,
        file: { name: file.name, size: file.size, type: file.type, extension },
      };
    }

    return new Promise((resolve) => {
      const handleMessage = (e: MessageEvent<ValidationResult>) => {
        this.worker?.removeEventListener('message', handleMessage);
        resolve(e.data);
      };

      this.worker!.addEventListener('message', handleMessage);
      this.worker!.postMessage({
        type: 'validate',
        file: {
          name: file.name,
          size: file.size,
          type: file.type,
        },
        config: {
          allowedMimeTypes: config.allowedMimeTypes,
          allowedExtensions: config.allowedExtensions,
          maxFileSize: config.maxFileSize,
        },
        headerBytes,
      });
    });
  }

  private detectMimeTypeFromBytes(headerBytes: number[], declaredType: string, extension: string): string | null {
    const MAGIC_BYTES: Record<string, number[]> = {
      'image/jpeg': [0xFF, 0xD8, 0xFF],
      'image/png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
      'image/gif': [0x47, 0x49, 0x46, 0x38],
      'application/pdf': [0x25, 0x50, 0x44, 0x46],
      'application/zip': [0x50, 0x4B, 0x03, 0x04],
    };

    if (!headerBytes || headerBytes.length === 0) return null;

    for (const [mimeType, signature] of Object.entries(MAGIC_BYTES)) {
      if (headerBytes.length >= signature.length) {
        const matches = signature.every((byte, i) => headerBytes[i] === byte);
        if (matches) return mimeType;
      }
    }
    return null;
  }

  private isValidMimeType(detectedType: string | null, declaredType: string, allowedTypes: string[]): boolean {
    if (!detectedType) {
      return allowedTypes.includes(declaredType);
    }
    if (allowedTypes.includes(detectedType)) return true;

    const zipBasedTypes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ];

    if (detectedType === 'application/zip' && zipBasedTypes.includes(declaredType)) {
      return allowedTypes.some(t => zipBasedTypes.includes(t) || t === declaredType);
    }

    return false;
  }

  async uploadFile(
    file: File,
    onProgress: (progress: UploadProgress) => void,
    options: UploadOptions = {}
  ): Promise<{ fileId: string; storagePath: string }> {
    this.abortController = new AbortController();
    const normalizedFile = normalizeFileForUpload(file);
    const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    try {
      onProgress({
        fileId,
        phase: 'validating',
        uploadProgress: 0,
        processingProgress: 0,
      });

      const validation = await this.validateFile(normalizedFile);
      if (!validation.valid) {
        throw new Error(validation.errors.join('. '));
      }

      onProgress({
        fileId,
        phase: 'uploading',
        uploadProgress: 0,
        processingProgress: 0,
      });

      const config = await this.fetchConfig();
      const useChunked = normalizedFile.size > config.chunkSize;

      let storagePath: string;
      let registeredFileId: string | undefined;

      if (useChunked) {
        const result = await this.uploadChunked(normalizedFile, config, options, (percent) => {
          onProgress({
            fileId: registeredFileId || fileId,
            phase: 'uploading',
            uploadProgress: percent,
            processingProgress: 0,
          });
        });
        storagePath = result.storagePath;
        if (result.fileId) {
          registeredFileId = result.fileId;
        }
      } else {
        const result = await this.uploadSingle(
          normalizedFile,
          options,
          (percent) => {
            onProgress({
              fileId: registeredFileId || fileId,
              phase: 'uploading',
              uploadProgress: percent,
              processingProgress: 0,
            });
          }
        );
        storagePath = result.storagePath;
      }

      // Register the file in the database if not already done (chunked upload does it via /complete)
      if (!registeredFileId) {
        const endpoint = '/api/files';

        const registerRes = await retryWithBackoff(async () => {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (options.uploadId) {
            headers["X-Upload-Id"] = options.uploadId;
          }
          if (options.conversationId) {
            headers["X-Conversation-Id"] = options.conversationId;
          }
          await ensureCsrfToken();
          const res = await apiFetch(endpoint, {
            method: 'POST',
            headers,
            ...(this.abortController?.signal ? { signal: this.abortController.signal } : {}),
            body: JSON.stringify({
              name: normalizedFile.name,
              type: normalizedFile.type,
              size: normalizedFile.size,
              storagePath,
              ...(options.uploadId ? { uploadId: options.uploadId } : {}),
              ...(options.conversationId ? { conversationId: options.conversationId } : {}),
            }),
          });
          if (!res.ok) {
            const errorData = await res.json().catch(() => ({ error: 'Registration failed' }));
            throw new Error(errorData.error || `File registration failed with status ${res.status}`);
          }
          return res.json();
        }, 2, RETRY_BASE_DELAY_MS, this.abortController.signal);

        registeredFileId = registerRes.id;
      }

      const actualFileId = registeredFileId || fileId;

      onProgress({
        fileId: actualFileId,
        phase: 'processing',
        uploadProgress: 100,
        processingProgress: 0,
      });

      return { fileId: actualFileId, storagePath };
    } catch (error: any) {
      onProgress({
        fileId,
        phase: 'error',
        uploadProgress: 0,
        processingProgress: 0,
        error: error.message || 'Error al subir el archivo',
      });
      throw error;
    }
  }

  private async uploadSingle(
    file: File,
    options: UploadOptions = {},
    onProgress: (percent: number) => void
  ): Promise<{ storagePath: string }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (options.uploadId) {
      headers["X-Upload-Id"] = options.uploadId;
    }
    if (options.conversationId) {
      headers["X-Conversation-Id"] = options.conversationId;
    }

    // Get upload URL with retry
    const { uploadURL, storagePath, responseUrl } = await retryWithBackoff(async () => {
      await ensureCsrfToken();
      const response = await apiFetch('/api/objects/upload', {
        method: 'POST',
        headers,
        ...(this.abortController?.signal ? { signal: this.abortController.signal } : {}),
        body: JSON.stringify({
          ...(options.uploadId ? { uploadId: options.uploadId } : {}),
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          ...(options.conversationId ? { conversationId: options.conversationId } : {}),
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to get upload URL (status ${response.status})`);
      }
      const data = await response.json();
      if (!data.uploadURL || !data.storagePath) {
        throw new Error('Server returned invalid upload configuration');
      }
      return { ...data, responseUrl: response.url };
    }, 2, RETRY_BASE_DELAY_MS, this.abortController?.signal);
    const effectiveUploadUrl = resolveUploadUrlForResponse(uploadURL, responseUrl);

    // Upload file with retry
    await retryWithBackoff(
      () => uploadBlobWithProgress(effectiveUploadUrl, file, onProgress, {
        timeoutMs: 90_000,
        skipContentType: true,
      }),
      MAX_RETRIES,
      RETRY_BASE_DELAY_MS,
      this.abortController?.signal,
    );

    return { storagePath };
  }

  private async uploadChunked(
    file: File,
    config: FileConfig,
    options: UploadOptions = {},
    onProgress: (percent: number) => void
  ): Promise<{ storagePath: string; fileId?: string }> {
    const totalChunks = Math.ceil(file.size / config.chunkSize);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (options.uploadId) {
      headers["X-Upload-Id"] = options.uploadId;
    }
    if (options.conversationId) {
      headers["X-Conversation-Id"] = options.conversationId;
    }

    const createResponse = await retryWithBackoff(async () => {
      await ensureCsrfToken();
      const res = await apiFetch('/api/objects/multipart/create', {
        method: 'POST',
        headers,
        ...(this.abortController?.signal ? { signal: this.abortController.signal } : {}),
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          totalChunks,
          ...(options.uploadId ? { uploadId: options.uploadId } : {}),
          ...(options.conversationId ? { conversationId: options.conversationId } : {}),
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: 'Failed to create multipart upload' }));
        throw new Error(error.error || 'Failed to create multipart upload');
      }
      return res.json();
    }, 2, RETRY_BASE_DELAY_MS, this.abortController?.signal);

    const session: MultipartSession = createResponse;
    const uploadedParts: { partNumber: number; etag?: string }[] = [];
    let completedChunks = 0;

    const uploadChunk = async (partNumber: number): Promise<void> => {
      const start = (partNumber - 1) * config.chunkSize;
      const end = Math.min(start + config.chunkSize, file.size);
      const chunk = file.slice(start, end);

      await retryWithBackoff(async () => {
        await ensureCsrfToken();
        const signResponse = await apiFetch('/api/objects/multipart/sign-part', {
          method: 'POST',
          headers,
          ...(this.abortController?.signal ? { signal: this.abortController.signal } : {}),
          body: JSON.stringify({
            uploadId: session.uploadId,
            partNumber,
            ...(options.uploadId ? { uploadId: options.uploadId } : {}),
          }),
        });

        if (!signResponse.ok) {
          throw new Error(`Failed to sign part ${partNumber}`);
        }

        const { signedUrl } = await signResponse.json();
        const effectiveSignedUrl = resolveUploadUrlForResponse(signedUrl, signResponse.url);

        await uploadBlobWithProgress(effectiveSignedUrl, chunk, () => {}, {
          timeoutMs: 90_000,
          skipContentType: true,
        });
      }, MAX_RETRIES, RETRY_BASE_DELAY_MS, this.abortController?.signal);

      uploadedParts.push({ partNumber });
      completedChunks++;
      onProgress(Math.round((completedChunks / totalChunks) * 100));
    };

    const chunkNumbers = Array.from({ length: totalChunks }, (_, i) => i + 1);

    for (let i = 0; i < chunkNumbers.length; i += config.maxParallelChunks) {
      const batch = chunkNumbers.slice(i, i + config.maxParallelChunks);
      await Promise.all(batch.map(uploadChunk));
    }

    const result = await retryWithBackoff(async () => {
      await ensureCsrfToken();
      const completeResponse = await apiFetch('/api/objects/multipart/complete', {
        method: 'POST',
        headers,
        ...(this.abortController?.signal ? { signal: this.abortController.signal } : {}),
        body: JSON.stringify({
          uploadId: session.uploadId,
          parts: uploadedParts.sort((a, b) => a.partNumber - b.partNumber),
          ...(options.uploadId ? { uploadId: options.uploadId } : {}),
          ...(options.conversationId ? { conversationId: options.conversationId } : {}),
        }),
      });
      if (!completeResponse.ok) {
        throw new Error('Failed to complete multipart upload');
      }
      return completeResponse.json();
    }, 2, RETRY_BASE_DELAY_MS, this.abortController?.signal);

    return { storagePath: result.storagePath, fileId: result.fileId };
  }

  private uploadWithProgress(
    url: string,
    data: Blob,
    onProgress: (percent: number) => void
  ): Promise<void> {
    return uploadBlobWithProgress(url, data, onProgress, {
      timeoutMs: 90_000,
      skipContentType: true,
      ...(this.abortController?.signal ? { signal: this.abortController.signal } : {}),
    });
  }

  subscribeToProcessingStatus(
    fileId: string,
    onStatus: (status: any) => void
  ): () => void {
    this.wsListeners.set(fileId, onStatus);
    this.ensureWebSocketConnection();
    if (this.wsAuthFailed) {
      this.startStatusPolling(fileId);
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', fileId }));
    }

    return () => {
      this.wsListeners.delete(fileId);
      this.stopStatusPolling(fileId);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'unsubscribe', fileId }));
      }
    };
  }

  private startStatusPolling(fileId: string): void {
    if (this.statusPollTimers.has(fileId)) return;

    const pollOnce = async (): Promise<void> => {
      try {
        await ensureCsrfToken();
        const response = await apiFetch(`/api/files/${encodeURIComponent(fileId)}/status`, {
          method: "GET",
        });
        if (!response.ok) return;

        const status = await response.json() as FileStatusResponse;
        const listener = this.wsListeners.get(fileId);
        if (listener) {
          listener({
            type: "file_status",
            fileId,
            state: status.status,
            processingProgress: Number(status.processingProgress || 0),
            uploadProgress: 100,
            ...(status.processingError ? { error: status.processingError } : {}),
          });
        }

        if (status.status === "ready" || status.status === "failed" || status.status === "error") {
          this.stopStatusPolling(fileId);
        }
      } catch {
        // Keep polling on transient errors; unsubscribe/terminal state stops the loop.
      }
    };

    const timer = window.setInterval(() => {
      void pollOnce();
    }, 2000);
    this.statusPollTimers.set(fileId, timer);
    void pollOnce();
  }

  private stopStatusPolling(fileId: string): void {
    const timer = this.statusPollTimers.get(fileId);
    if (typeof timer === "number") {
      window.clearInterval(timer);
      this.statusPollTimers.delete(fileId);
    }
  }

  private ensureWebSocketConnection(): void {
    if (this.wsAuthFailed) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/file-status`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.wsReconnectAttempts = 0;
      Array.from(this.statusPollTimers.keys()).forEach((fileId) => this.stopStatusPolling(fileId));
      this.wsListeners.forEach((_, fileId) => {
        this.ws?.send(JSON.stringify({ type: 'subscribe', fileId }));
      });
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'auth_error') {
          this.wsAuthFailed = true;
          // Notify listeners so callers can fall back (e.g., to polling) instead of hanging.
          this.wsListeners.forEach((listener, fileId) => {
            listener(data);
            this.startStatusPolling(fileId);
          });
          this.ws?.close();
          return;
        }
        if (data.type === 'file_status' && data.fileId) {
          const listener = this.wsListeners.get(data.fileId);
          if (listener) {
            listener(data);
          }
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onclose = () => {
      if (!this.wsAuthFailed && this.wsListeners.size > 0 && this.wsReconnectAttempts < this.maxReconnectAttempts) {
        this.wsReconnectAttempts++;
        setTimeout(() => this.ensureWebSocketConnection(), 1000 * this.wsReconnectAttempts);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.wsListeners.forEach((_, fileId) => this.startStatusPolling(fileId));
    };
  }

  cancel(): void {
    this.abortController?.abort();
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ws?.close();
    this.ws = null;
    this.statusPollTimers.forEach((timer) => window.clearInterval(timer));
    this.statusPollTimers.clear();
    this.wsListeners.clear();
    this.abortController?.abort();
  }
}

let uploaderInstance: ChunkedFileUploader | null = null;

export function getFileUploader(): ChunkedFileUploader {
  if (!uploaderInstance) {
    uploaderInstance = new ChunkedFileUploader();
  }
  return uploaderInstance;
}
