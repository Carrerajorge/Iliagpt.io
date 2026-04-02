import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/apiClient";

export type OAuthProvider = "openai" | "gemini" | "anthropic";

export interface ProviderStatus {
  provider: OAuthProvider;
  globalConnected: boolean;
  globalLabel: string | null;
  userConnected: boolean;
  connected: boolean;
}

export interface AllProvidersStatus {
  providers: Record<OAuthProvider, ProviderStatus>;
}

export interface OAuthStartResponse {
  authUrl: string;
  state: string;
}

const ALL_STATUS_KEY = ["/api/oauth/providers/status"];

export function useAllProvidersStatus() {
  return useQuery<AllProvidersStatus>({
    queryKey: ALL_STATUS_KEY,
    queryFn: async () => {
      const res = await apiFetch("/api/oauth/providers/status", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("No se pudo obtener el estado de proveedores");
      return res.json();
    },
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useProviderOAuthStart(provider: OAuthProvider) {
  const queryClient = useQueryClient();

  return useMutation<OAuthStartResponse, Error, { isGlobal?: boolean }>({
    mutationFn: async ({ isGlobal }) => {
      const url = `/api/oauth/providers/${provider}/start${isGlobal ? "?scope=global" : ""}`;
      const res = await apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || `No se pudo iniciar OAuth para ${provider}`);
      }
      return res.json();
    },
    onSuccess: () => {
      // Will be invalidated after callback completes
    },
  });
}

export function useAnthropicKeySubmit() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, { apiKey: string; label?: string; isGlobal?: boolean }>({
    mutationFn: async ({ apiKey, label, isGlobal }) => {
      const url = `/api/oauth/providers/anthropic/key${isGlobal ? "?scope=global" : ""}`;
      const res = await apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, label }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || "No se pudo guardar la API key");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALL_STATUS_KEY });
    },
  });
}

export function useProviderDisconnect(provider: OAuthProvider) {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, { isGlobal?: boolean }>({
    mutationFn: async ({ isGlobal }) => {
      const url = `/api/oauth/providers/${provider}/disconnect${isGlobal ? "?scope=global" : ""}`;
      const res = await apiFetch(url, { method: "DELETE" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || `No se pudo desconectar ${provider}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALL_STATUS_KEY });
    },
  });
}

/**
 * Opens a popup for OAuth flow and listens for the postMessage result.
 * Returns a promise that resolves when the OAuth flow completes.
 */
export function openOAuthPopup(authUrl: string): Promise<{ status: "success" | "error"; message: string }> {
  return new Promise((resolve) => {
    const popup = window.open(
      authUrl,
      "provider-oauth-popup",
      "popup=yes,width=720,height=860,resizable=yes,scrollbars=yes",
    );

    if (!popup) {
      resolve({ status: "error", message: "No se pudo abrir la ventana. Habilita popups." });
      return;
    }

    popup.focus();

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "provider-oauth-result") return;

      window.removeEventListener("message", handleMessage);
      clearInterval(pollClosed);

      resolve({
        status: event.data.status || "error",
        message: event.data.message || "",
      });
    };

    window.addEventListener("message", handleMessage);

    // Poll to detect if user closed the popup manually
    const pollClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(pollClosed);
        window.removeEventListener("message", handleMessage);
        resolve({ status: "error", message: "Ventana cerrada por el usuario" });
      }
    }, 1000);

    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(pollClosed);
      window.removeEventListener("message", handleMessage);
      if (!popup.closed) popup.close();
      resolve({ status: "error", message: "El flujo OAuth expiró" });
    }, 5 * 60 * 1000);
  });
}
