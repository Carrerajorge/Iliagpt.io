import React from "react";
import { ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { AvailableModel } from "@/contexts/ModelAvailabilityContext";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { FREE_MODEL_ID, isFreeTierUser, isModelFreeForAll } from "@/lib/planUtils";

interface StandardModelSelectorProps {
    availableModels: AvailableModel[];
    selectedModelId: string | null;
    setSelectedModelId: (id: string) => void;
    modelsByProvider: Record<string, AvailableModel[]>;
    activeGptName?: string;
    onModelChange?: (id: string) => void;
    modelChangeDisabled?: boolean;
    onAddModel?: () => void;
    userPlanInfo?: { plan: string; isAdmin?: boolean; isPaid?: boolean } | null;
    onUpgradeClick?: () => void;
}

function isModelFree(model: AvailableModel): boolean {
    return isModelFreeForAll(model.modelId) || isModelFreeForAll(model.id);
}

export function StandardModelSelector({
    availableModels,
    selectedModelId,
    setSelectedModelId,
    modelsByProvider,
    activeGptName,
    onModelChange,
    modelChangeDisabled = false,
    onAddModel,
    userPlanInfo,
    onUpgradeClick,
}: StandardModelSelectorProps) {
    const isAnyModelAvailable = availableModels.length > 0;
    const isDisabled = !!activeGptName || modelChangeDisabled;

    const isFreeUser = isFreeTierUser(userPlanInfo ? { plan: userPlanInfo.plan, role: userPlanInfo.isAdmin ? "admin" : undefined } : null);

    const selectedModelData = React.useMemo(() => {
        if (!selectedModelId) return availableModels[0] || null;
        return availableModels.find(m => m.id === selectedModelId || m.modelId === selectedModelId) || availableModels[0] || null;
    }, [selectedModelId, availableModels]);

    const providerLabel = (provider: string) => {
        if (provider === "xai") return "xAI";
        if (provider === "google" || provider === "gemini") return "Google Gemini";
        if (provider === "openrouter") return "OpenRouter";
        return provider;
    };

    const handleChange = React.useCallback((newId: string) => {
        if (isDisabled) return;

        if (isFreeUser) {
            const target = availableModels.find(m => m.id === newId || m.modelId === newId);
            if (target && !isModelFree(target)) {
                if (onUpgradeClick) {
                    onUpgradeClick();
                }
                return;
            }
        }

        const handler = onModelChange ?? setSelectedModelId;
        handler(newId);
    }, [isDisabled, isFreeUser, availableModels, onModelChange, setSelectedModelId, onUpgradeClick]);

    if (!isAnyModelAvailable) {
        return (
            <div
                className="relative flex items-center gap-1 sm:gap-2 bg-gray-200 dark:bg-gray-700 px-1.5 sm:px-2 py-1 rounded-md cursor-not-allowed opacity-60"
                data-testid="button-model-selector-disabled"
                title="No hay modelos disponibles. Un administrador debe activar al menos un modelo."
            >
                <select
                    className="appearance-none bg-transparent pr-6 font-semibold text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none text-gray-500 dark:text-gray-400 outline-none"
                    disabled
                    value=""
                    aria-label="Selector de modelo"
                >
                    <option value="">Sin modelos activos</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-gray-400 flex-shrink-0" />
            </div>
        );
    }

    return (
        <div className="flex items-center gap-0.5">
            <div
                className={cn(
                    "relative flex items-center gap-1 sm:gap-2 rounded-md transition-colors mt-[-5px] mb-[-5px] pt-[8px] pb-[8px] pl-[7px] pr-[7px]",
                    isDisabled ? "cursor-not-allowed opacity-60" : "hover:bg-muted/50"
                )}
                data-testid="button-model-selector"
                title={activeGptName ? `Modelo fijado por GPT: ${activeGptName}` : modelChangeDisabled ? "Respuesta en curso" : "Seleccionar modelo"}
            >
                <select
                    className={cn(
                        "appearance-none bg-transparent pr-6 font-semibold text-xs sm:text-sm truncate max-w-[160px] sm:max-w-none outline-none",
                        isDisabled && "pointer-events-none"
                    )}
                    value={selectedModelData?.id || ""}
                    onChange={(e) => handleChange(e.target.value)}
                    disabled={isDisabled}
                    aria-label="Selector de modelo"
                >
                    {Object.entries(modelsByProvider).map(([provider, models]) => (
                        <optgroup key={provider} label={providerLabel(provider)}>
                            {models.map((model) => {
                                const locked = isFreeUser && !isModelFree(model);
                                return (
                                    <option
                                        key={model.id}
                                        value={model.id}
                                        disabled={locked}
                                        data-testid={`option-model-${model.modelId}`}
                                    >
                                        {locked ? `\u{1F512} ${model.name}` : model.name}
                                    </option>
                                );
                            })}
                        </optgroup>
                    ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-muted-foreground flex-shrink-0" />
            </div>
            {onAddModel && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                onClick={onAddModel}
                                className={cn(
                                    "flex items-center justify-center h-7 w-7 rounded-md",
                                    "text-muted-foreground hover:text-foreground",
                                    "hover:bg-muted/70 transition-colors",
                                    "border border-dashed border-muted-foreground/30 hover:border-blue-400",
                                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                )}
                                data-testid="button-add-gemini-oauth"
                                aria-label="Vincular cuenta de Google para Gemini"
                            >
                                <Plus className="h-3.5 w-3.5" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            <p>Vincular Google Gemini CLI OAuth</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
        </div>
    );
}

export default StandardModelSelector;
