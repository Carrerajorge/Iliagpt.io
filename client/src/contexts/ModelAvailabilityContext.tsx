import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { apiFetch } from "@/lib/apiClient";
import { useAuth } from "@/hooks/use-auth";
import { FREE_MODEL_ID, isFreeTierUser, isModelFreeForAll } from "@/lib/planUtils";

export interface AvailableModel {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  description: string | null;
  isEnabled: string;
  enabledAt: string | null;
  enabledByAdminId: string | null;
  displayOrder: number;
  icon: string | null;
  modelType: string;
  contextWindow: number | null;
}

interface ModelAvailabilityContextType {
  availableModels: AvailableModel[];
  allModels: AvailableModel[];
  isLoading: boolean;
  isAnyModelAvailable: boolean;
  enableModel: (id: string) => Promise<void>;
  disableModel: (id: string) => Promise<void>;
  toggleModel: (id: string, enabled: boolean) => Promise<void>;
  refetch: () => void;
  selectedModelId: string | null;
  setSelectedModelId: (id: string | null) => void;
}

const ModelAvailabilityContext = createContext<ModelAvailabilityContextType | null>(null);

function isLocalGemmaDevMode(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isGemmaModelId(modelId: string | null | undefined): boolean {
  return (modelId || "").trim().toLowerCase().startsWith("google/gemma-");
}

export function ModelAvailabilityProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedModelId, setSelectedModelIdState] = useState<string | null>(null);
  const { settings, updateSetting } = useSettingsContext();
  const { settings: platformSettings } = usePlatformSettings();
  const { user } = useAuth();

  const { data: modelsData, isLoading, refetch } = useQuery<{ models: AvailableModel[] }>({
    queryKey: ["/api/models/available"],
    queryFn: async () => {
      const res = await apiFetch("/api/models/available");
      if (!res.ok) throw new Error("Failed to fetch models");
      return res.json();
    },
    refetchInterval: 300_000,
    staleTime: 180_000,
    gcTime: 600_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const localMockModels: AvailableModel[] = useMemo(() => [
    {
      id: "llama3-8b",
      name: "Llama 3 (M\u00e1quina Local / Ollama)",
      provider: "Local (Off-Grid)",
      modelId: "llama3-8b",
      description: "Modelo Llama 3 ejecutado directamente en su hardware local via ollama o LM Studio",
      isEnabled: "true",
      enabledAt: new Date().toISOString(),
      enabledByAdminId: "system",
      displayOrder: 10,
      icon: null,
      modelType: "chat",
      contextWindow: 128000
    }
  ], []);

  const allModels = useMemo(
    () => [...localMockModels, ...(modelsData?.models || [])],
    [localMockModels, modelsData?.models],
  );

  const enabledModels = useMemo(
    () => allModels
      .map(m => ({ ...m, isEnabled: "true" as const }))
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)),
    [allModels],
  );

  const availableModels = enabledModels;

  const isAnyModelAvailable = availableModels.length > 0;

  const setSelectedModelId = useCallback((id: string | null) => {
    if (id && !enabledModels.find(m => m.id === id || m.modelId === id)) {
      toast({
        title: "Modelo no disponible",
        description: "El modelo seleccionado ya no está disponible",
        variant: "destructive",
      });
      setSelectedModelIdState(null);
      return;
    }
    setSelectedModelIdState(id);
  }, [enabledModels, toast]);

  useEffect(() => {
    if (selectedModelId && !enabledModels.find(m => m.id === selectedModelId || m.modelId === selectedModelId)) {
      toast({
        title: "Modelo desactivado",
        description: "El modelo seleccionado ya no está disponible",
        variant: "destructive",
      });
      setSelectedModelIdState(null);
    }
  }, [enabledModels, selectedModelId, toast]);

  const isFreeUser = isFreeTierUser(user ? { plan: (user as any).plan, role: (user as any).role, subscriptionStatus: (user as any).subscriptionStatus, subscriptionPlan: (user as any).subscriptionPlan } : null);

  const prevDefaultModelRef = useRef(settings.defaultModel);

  useEffect(() => {
    const findEnabled = (id: string) =>
      enabledModels.find((m) => m.modelId === id || m.id === id);

    const legacyDefaultModelIds = new Set(["gemini-2.5-flash"]);

    let resolvedId = selectedModelId;
    const localGemmaDevMode = isLocalGemmaDevMode();
    const localGemmaDefault =
      localGemmaDevMode && isGemmaModelId(platformSettings.default_model)
        ? findEnabled(platformSettings.default_model)
        : undefined;

    if (!resolvedId) {
      const userDefault = settings.defaultModel;
      const platformDefault = platformSettings.default_model;
      const preferPlatformDefault =
        !userDefault ||
        legacyDefaultModelIds.has(userDefault) ||
        (localGemmaDevMode && isGemmaModelId(platformDefault));
      const primary = preferPlatformDefault ? platformDefault : userDefault;
      const secondary = preferPlatformDefault ? userDefault : platformDefault;
      const target =
        (primary ? findEnabled(primary) : undefined) ||
        (secondary ? findEnabled(secondary) : undefined);
      resolvedId = target?.id ?? enabledModels[0]?.id ?? null;
    }

    if (localGemmaDefault) {
      const current = resolvedId ? findEnabled(resolvedId) : undefined;
      const shouldPromoteLocalGemma =
        !current ||
        current.modelId === FREE_MODEL_ID ||
        current.id === FREE_MODEL_ID;
      if (shouldPromoteLocalGemma) {
        resolvedId = localGemmaDefault.id;
      }
    }

    if (isFreeUser && resolvedId && enabledModels.length > 0) {
      const current = findEnabled(resolvedId);
      const allowCurrentModel =
        localGemmaDevMode && isGemmaModelId(current?.modelId || current?.id || null);
      if (
        current &&
        !isModelFreeForAll(current.modelId) &&
        !isModelFreeForAll(current.id) &&
        !allowCurrentModel
      ) {
        const freeModel = enabledModels.find(
          (m) => isModelFreeForAll(m.modelId) || isModelFreeForAll(m.id),
        );
        if (freeModel) {
          resolvedId = freeModel.id;
        }
      }
    }

    if (settings.defaultModel !== prevDefaultModelRef.current) {
      prevDefaultModelRef.current = settings.defaultModel;
      if (settings.defaultModel && !isFreeUser) {
        const target = findEnabled(settings.defaultModel);
        if (target && resolvedId !== target.id && resolvedId !== target.modelId) {
          resolvedId = target.id;
        }
      }
    }

    if (resolvedId && resolvedId !== selectedModelId) {
      setSelectedModelIdState(resolvedId);
    }

    if (resolvedId) {
      const model = findEnabled(resolvedId);
      if (model?.modelId && model.modelId !== settings.defaultModel) {
        updateSetting("defaultModel", model.modelId);
        prevDefaultModelRef.current = model.modelId;
      }
    }
  }, [enabledModels, selectedModelId, settings.defaultModel, platformSettings.default_model, updateSetting, isFreeUser]);

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await apiFetch(`/api/admin/models/${id}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: enabled }),
      });
      if (!res.ok) throw new Error("Failed to toggle model");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models"] });
      refetch();
    },
  });

  const enableModel = useCallback(async (id: string) => {
    await toggleMutation.mutateAsync({ id, enabled: true });
  }, [toggleMutation]);

  const disableModel = useCallback(async (id: string) => {
    await toggleMutation.mutateAsync({ id, enabled: false });
  }, [toggleMutation]);

  const toggleModel = useCallback(async (id: string, enabled: boolean) => {
    await toggleMutation.mutateAsync({ id, enabled });
  }, [toggleMutation]);

  const contextValue = useMemo(() => ({
    availableModels,
    allModels,
    isLoading,
    isAnyModelAvailable,
    enableModel,
    disableModel,
    toggleModel,
    refetch,
    selectedModelId,
    setSelectedModelId,
  }), [availableModels, allModels, isLoading, isAnyModelAvailable, enableModel, disableModel, toggleModel, refetch, selectedModelId, setSelectedModelId]);

  return (
    <ModelAvailabilityContext.Provider value={contextValue}>
      {children}
    </ModelAvailabilityContext.Provider>
  );
}

export function useModelAvailability() {
  const context = useContext(ModelAvailabilityContext);
  if (!context) {
    throw new Error("useModelAvailability must be used within ModelAvailabilityProvider");
  }
  return context;
}
