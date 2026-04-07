import { apiFetch } from "@/lib/apiClient";

function toUrl(input: string): URL | null {
  try {
    if (typeof window !== "undefined") {
      return new URL(input, window.location.origin);
    }
    return new URL(input, "http://localhost");
  } catch {
    return null;
  }
}

export function isLocalArtifactUrl(input?: string | null): input is string {
  if (!input) return false;
  const resolved = toUrl(input);
  return resolved?.pathname.startsWith("/api/artifacts/") ?? false;
}

function getFilenameFromDisposition(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }
  const plainMatch = headerValue.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? null;
}

function getFilenameFromUrl(input: string, fallbackName = "download"): string {
  const resolved = toUrl(input);
  const pathname = resolved?.pathname ?? input;
  const candidate = pathname.split("/").filter(Boolean).pop();
  return candidate ? decodeURIComponent(candidate) : fallbackName;
}

export async function fetchArtifactResponse(input: string, init?: RequestInit): Promise<Response> {
  if (isLocalArtifactUrl(input)) {
    return apiFetch(input, init);
  }
  return fetch(input, {
    credentials: "include",
    ...init,
  });
}

export async function fetchArtifactText(input: string): Promise<string> {
  const response = await fetchArtifactResponse(input);
  if (!response.ok) {
    throw new Error(`Artifact fetch failed: ${response.status}`);
  }
  return response.text();
}

export async function downloadArtifact(input: string, fallbackName?: string): Promise<void> {
  const response = await fetchArtifactResponse(input);
  if (!response.ok) {
    throw new Error(`Artifact download failed: ${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const filename =
    fallbackName ||
    getFilenameFromDisposition(response.headers.get("content-disposition")) ||
    getFilenameFromUrl(input);

  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}
