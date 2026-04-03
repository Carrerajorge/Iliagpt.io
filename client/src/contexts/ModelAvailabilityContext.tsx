import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { apiFetch } from "@/lib/apiClient";
import { useAuth } from "@/hooks/use-auth";
import { FREE_MODEL_ID, isFreeTierUser } from "@/lib/planUtils";

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

  const localMockModels: AvailableModel[] = [
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
  ];

  const allModels = [...localMockModels, ...(modelsData?.models || [])];
  const enabledModels = allModels
    .map(m => ({ ...m, isEnabled: "true" }))
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

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

  // Initialize selected model from Settings -> Default Model.
  useEffect(() => {
    if (selectedModelId) return;

    const legacyDefaultModelIds = new Set(["gemini-2.5-flash"]);

    const findEnabled = (id: string) =>
      enabledModels.find((m) => m.modelId === id || m.id === id);

    const userDefault = settings.defaultModel;
    const platformDefault = platformSettings.default_model;
    const preferPlatformDefault =
      !userDefault || legacyDefaultModelIds.has(userDefault);

    const primary = preferPlatformDefault ? platformDefault : userDefault;
    const secondary = preferPlatformDefault ? userDefault : platformDefault;

    const target = (primary ? findEnabled(primary) : undefined) || (secondary ? findEnabled(secondary) : undefined);
    if (target) {
      setSelectedModelIdState(target.id);
      return;
    }
    if (enabledModels[0]) {
      // Fall back to the first enabled model so the rest of the app has a stable selection.
      setSelectedModelIdState(enabledModels[0].id);
    }
  }, [enabledModels, selectedModelId, settings.defaultModel, platformSettings.default_model]);

  // Keep Settings -> Default Model in sync with the selector.
  useEffect(() => {
    if (!selectedModelId) return;
    const model = enabledModels.find((m) => m.id === selectedModelId || m.modelId === selectedModelId);
    if (!model?.modelId) return;
    if (model.modelId !== settings.defaultModel) {
      updateSetting("defaultModel", model.modelId);
    }
  }, [enabledModels, selectedModelId, settings.defaultModel, updateSetting]);

  const isFreeUser = isFreeTierUser(user ? { plan: (user as any).plan, role: (user as any).role, subscriptionStatus: (user as any).subscriptionStatus, subscriptionPlan: (user as any).subscriptionPlan } : null);

  useEffect(() => {
    if (!isFreeUser || !selectedModelId || enabledModels.length === 0) return;
    const current = enabledModels.find(m => m.id === selectedModelId || m.modelId === selectedModelId);
    if (current && current.modelId !== FREE_MODEL_ID && current.id !== FREE_MODEL_ID) {
      const freeModel = enabledModels.find(m => m.modelId === FREE_MODEL_ID || m.id === FREE_MODEL_ID);
      if (freeModel) {
        setSelectedModelIdState(freeModel.id);
      }
    }
  }, [isFreeUser, selectedModelId, enabledModels]);

  const prevDefaultModelRef = useRef(settings.defaultModel);

  // If the user changes Default Model from Settings, reflect it in the selector.
  useEffect(() => {
    if (settings.defaultModel !== prevDefaultModelRef.current) {
      prevDefaultModelRef.current = settings.defaultModel;
      if (!settings.defaultModel) return;
      const target = enabledModels.find((m) => m.modelId === settings.defaultModel || m.id === settings.defaultModel);
      if (!target) return;
      if (selectedModelId === target.id || selectedModelId === target.modelId) return;
      setSelectedModelIdState(target.id);
    }
  }, [enabledModels, selectedModelId, settings.defaultModel]);

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

  const enableModel = async (id: string) => {
    await toggleMutation.mutateAsync({ id, enabled: true });
  };

  const disableModel = async (id: string) => {
    await toggleMutation.mutateAsync({ id, enabled: false });
  };

  const toggleModel = async (id: string, enabled: boolean) => {
    await toggleMutation.mutateAsync({ id, enabled });
  };

  return (
    <ModelAvailabilityContext.Provider
      value={{
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
      }}
    >
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
