import type { RawImageOutput } from "./types";

const DATA_URL_RE = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i;
const HTTP_IMAGE_URL_RE = /https?:\/\/[^\s)"\]]+\.(?:png|jpe?g|webp|gif)[^\s)"\]]*/i;

export async function fetchImageAsBase64(url: string, timeoutMs = 20000): Promise<RawImageOutput | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    return {
      imageBase64: buf.toString("base64"),
      mimeType: res.headers.get("content-type")?.split(";")[0] || "image/png",
    };
  } catch {
    return null;
  }
}

function fromDataUrl(value: string): RawImageOutput | null {
  const match = value.match(DATA_URL_RE);
  if (!match) return null;
  return { imageBase64: match[2], mimeType: match[1] };
}

function looksLikeBareBase64(value: string): boolean {
  return value.length > 100 && /^[A-Za-z0-9+/=]+$/.test(value.slice(0, 100));
}

async function fromImageEntry(entry: unknown): Promise<RawImageOutput | null> {
  if (!entry) return null;

  if (typeof entry === "string") {
    const dataUrl = fromDataUrl(entry);
    if (dataUrl) return dataUrl;
    if (entry.startsWith("http")) return fetchImageAsBase64(entry);
    if (looksLikeBareBase64(entry)) return { imageBase64: entry, mimeType: "image/png" };
    return null;
  }

  const obj = entry as Record<string, any>;
  if (typeof obj.b64_json === "string") {
    return { imageBase64: obj.b64_json, mimeType: obj.content_type || "image/png" };
  }
  if (obj.inline_data?.data) {
    return { imageBase64: obj.inline_data.data, mimeType: obj.inline_data.mime_type || "image/png" };
  }
  if (obj.inlineData?.data) {
    return { imageBase64: obj.inlineData.data, mimeType: obj.inlineData.mimeType || "image/png" };
  }
  if (obj.image_url) {
    const url = typeof obj.image_url === "string" ? obj.image_url : obj.image_url?.url;
    if (typeof url === "string") return fromImageEntry(url);
  }
  if (typeof obj.url === "string") {
    return fromImageEntry(obj.url);
  }
  return null;
}

/**
 * Normalize the many shapes chat-completions APIs use to return images
 * (message.image, message.images[], data URLs / raw base64 / hosted URLs
 * inside content strings, multimodal content parts) into one RawImageOutput.
 */
export async function extractImageFromChatMessage(message: any): Promise<RawImageOutput | null> {
  if (!message) return null;

  if (typeof message.image === "string") {
    const out = await fromImageEntry(message.image);
    if (out) return out;
  }

  if (Array.isArray(message.images)) {
    for (const entry of message.images) {
      const out = await fromImageEntry(entry);
      if (out) return out;
    }
  }

  const content = message.content;

  if (typeof content === "string" && content.length > 0) {
    const dataUrlMatch = content.match(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/i);
    if (dataUrlMatch) {
      const out = fromDataUrl(dataUrlMatch[0]);
      if (out) return out;
    }
    const urlMatch = content.match(HTTP_IMAGE_URL_RE);
    if (urlMatch) {
      const out = await fetchImageAsBase64(urlMatch[0]);
      if (out) return out;
    }
  }

  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === "image_url" && part.image_url?.url) {
        const out = await fromImageEntry(part.image_url.url);
        if (out) return out;
      }
      const inline = await fromImageEntry(part);
      if (inline) return inline;
    }
  }

  return null;
}
