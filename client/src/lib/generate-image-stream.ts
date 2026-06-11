import { apiFetch } from "@/lib/apiClient";
import type { MediaGenerationProgress } from "@/components/media-generation-card";

export interface ImageGenerationDone {
  success: boolean;
  imageData: string;
  prompt: string;
  model?: string;
  provider?: string;
  latencyMs?: number;
}

interface GenerateImageStreamOptions {
  model?: string;
  aspectRatio?: string;
  quality?: "standard" | "hd";
  signal?: AbortSignal;
  onProgress?: (progress: MediaGenerationProgress) => void;
}

/**
 * Call POST /api/image/generate/stream and surface real progress stages.
 * Falls back to the plain JSON endpoint if the stream is unavailable.
 */
export async function generateImageWithProgress(
  prompt: string,
  options: GenerateImageStreamOptions = {},
): Promise<ImageGenerationDone> {
  const { signal, onProgress, ...body } = options;

  try {
    const res = await apiFetch("/api/image/generate/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, ...body }),
      signal,
    });

    if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("text/event-stream")) {
      throw new Error(`stream unavailable (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done: ImageGenerationDone | null = null;
    let streamError: string | null = null;

    const handleFrame = (frame: string) => {
      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) return;
      let payload: any;
      try {
        payload = JSON.parse(dataLines.join("\n"));
      } catch {
        return;
      }
      if (event === "progress") onProgress?.(payload as MediaGenerationProgress);
      else if (event === "done") done = payload as ImageGenerationDone;
      else if (event === "error") streamError = payload?.details || payload?.error || "Error al generar imagen";
    };

    while (true) {
      const { value, done: readerDone } = await reader.read();
      if (readerDone) break;
      buffer += decoder.decode(value, { stream: true });
      let separatorIndex: number;
      while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
        handleFrame(buffer.slice(0, separatorIndex));
        buffer = buffer.slice(separatorIndex + 2);
      }
    }
    if (buffer.trim()) handleFrame(buffer);

    if (streamError) throw new Error(streamError);
    if (done) return done;
    throw new Error("El stream terminó sin resultado");
  } catch (error: any) {
    if (error?.name === "AbortError" || signal?.aborted) throw error;

    // Fallback: plain JSON endpoint (no intermediate progress).
    onProgress?.({ stage: "generating" });
    const res = await apiFetch("/api/image/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, ...body }),
      signal,
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data?.details || data?.error || "Error al generar imagen");
    }
    return data as ImageGenerationDone;
  }
}
