import { apiFetch } from "@/lib/apiClient";

type ApiFetchOptions = RequestInit & { timeoutMs?: number };

async function parseJsonBody<T>(response: Response): Promise<T | null> {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  return JSON.parse(text) as T;
}

async function buildApiError(response: Response): Promise<Error> {
  try {
    const payload = await parseJsonBody<{ error?: string; message?: string }>(response);
    const message = payload?.error || payload?.message;
    if (message) {
      return new Error(message);
    }
  } catch {
    // Fall through to the generic status error below when the payload is not JSON.
  }

  return new Error(`Request failed: ${response.status}`);
}

export async function apiFetchOk(url: string, options: ApiFetchOptions = {}): Promise<Response> {
  const response = await apiFetch(url, { credentials: "include", ...options });

  if (!response.ok) {
    throw await buildApiError(response);
  }

  return response;
}

export async function apiFetchJson<T = any>(url: string, options: ApiFetchOptions = {}): Promise<T> {
  const response = await apiFetchOk(url, options);
  return (await parseJsonBody<T>(response)) as T;
}

export async function apiFetchJsonNullable<T = any>(url: string, options: ApiFetchOptions = {}): Promise<T | null> {
  const response = await apiFetchOk(url, options);
  return parseJsonBody<T>(response);
}
