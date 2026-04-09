import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Lock, Plus, Sparkles } from "lucide-react";
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

const MODEL_LOGOS: Record<string, string> = {
    "openai": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/openai.svg",
    "anthropic": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/anthropic.svg",
    "google": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/googlegemini.svg",
    "gemini": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/googlegemini.svg",
    "x-ai": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/x.svg",
    "xai": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/x.svg",
    "meta": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/meta.svg",
    "deepseek": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/deepseek.svg",
};

function getProviderFromModel(model: AvailableModel): string {
    const p = (model.provider || "").toLowerCase();
    const mid = (model.modelId || model.id || "").toLowerCase();
    if (mid.includes("grok") || mid.includes("x-ai") || p === "xai" || p === "x-ai") return "xai";
    if (mid.includes("gemini") || mid.includes("gemma") || p === "google" || p === "gemini") return "google";
    if (mid.includes("claude") || p === "anthropic") return "anthropic";
    if (mid.includes("gpt") || mid.includes("o1") || mid.includes("o3") || p === "openai") return "openai";
    if (mid.includes("deepseek") || p === "deepseek") return "deepseek";
    if (mid.includes("llama") || mid.includes("meta") || p === "meta") return "meta";
    if (mid.includes("kimi") || mid.includes("moonshot")) return "moonshot";
    if (mid.includes("glm") || mid.includes("z-ai") || mid.includes("zhipu")) return "zhipu";
    if (mid.includes("mistral") || mid.includes("codestral")) return "mistral";
    if (mid.includes("cohere") || mid.includes("command")) return "cohere";
    return p || "other";
}

function ProviderIcon({ provider, className }: { provider: string; className?: string }) {
    const getEmoji = () => {
        switch (provider) {
            case "xai": return "𝕏";
            case "google": return "✦";
            case "anthropic": return "◈";
            case "openai": return "◉";
            case "deepseek": return "◆";
            case "meta": return "◎";
            case "moonshot": return "☽";
            case "zhipu": return "智";
            case "mistral": return "▲";
            case "cohere": return "⬡";
            default: return "●";
        }
    };

    return (
        <span className={cn("flex items-center justify-center w-4 h-4 text-[10px] font-bold opacity-60", className)}>
            {getEmoji()}
        </span>
    );
}

function getShortName(model: AvailableModel): string {
    let name = model.name || model.modelId || "";
    name = name.replace(/^(xAI|Google|Anthropic|OpenAI|Meta|MoonshotAI|Z\.ai|Cohere|Deep Cogito|DeepSeek):\s*/i, "");
    return name;
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
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const isDisabled = !!activeGptName || modelChangeDisabled;

    const isFreeUser = isFreeTierUser(userPlanInfo ? { plan: userPlanInfo.plan, role: userPlanInfo.isAdmin ? "admin" : undefined } : null);

    const selectedModelData = React.useMemo(() => {
        if (!selectedModelId) return availableModels[0] || null;
        return availableModels.find(m => m.id === selectedModelId || m.modelId === selectedModelId) || availableModels[0] || null;
    }, [selectedModelId, availableModels]);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        }
        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
            return () => document.removeEventListener("mousedown", handleClickOutside);
        }
    }, [isOpen]);

    const handleSelect = (model: AvailableModel) => {
        if (isDisabled) return;

        if (isFreeUser && !isModelFree(model)) {
            if (onUpgradeClick) onUpgradeClick();
            return;
        }

        const handler = onModelChange ?? setSelectedModelId;
        handler(model.id);
        setIsOpen(false);
    };

    if (availableModels.length === 0) {
        return (
            <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-not-allowed opacity-50"
                data-testid="button-model-selector-disabled"
            >
                <span className="text-xs text-muted-foreground">Sin modelos</span>
            </div>
        );
    }

    const selectedProvider = selectedModelData ? getProviderFromModel(selectedModelData) : "other";
    const selectedShortName = selectedModelData ? getShortName(selectedModelData) : "Modelo";
    const selectedIsFree = selectedModelData ? isModelFree(selectedModelData) : false;

    const sortedModels = [...availableModels].sort((a, b) => {
        const aFree = isModelFree(a) ? 0 : 1;
        const bFree = isModelFree(b) ? 0 : 1;
        if (aFree !== bFree) return aFree - bFree;
        return getShortName(a).localeCompare(getShortName(b));
    });

    return (
        <div className="flex items-center gap-0.5">
            <div ref={dropdownRef} className="relative">
                <button
                    type="button"
                    onClick={() => !isDisabled && setIsOpen(!isOpen)}
                    className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all duration-150",
                        isDisabled ? "cursor-not-allowed opacity-50" : "hover:bg-muted/60 cursor-pointer",
                        isOpen && "bg-muted/60"
                    )}
                    disabled={isDisabled}
                    data-testid="button-model-selector"
                    title={activeGptName ? `Modelo fijado por GPT: ${activeGptName}` : modelChangeDisabled ? "Respuesta en curso" : "Seleccionar modelo"}
                >
                    <ProviderIcon provider={selectedProvider} />
                    <span className="font-medium text-sm truncate max-w-[180px]">
                        {selectedShortName}
                    </span>
                    {!selectedIsFree && (
                        <Lock className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
                    )}
                    <ChevronDown className={cn(
                        "h-3 w-3 text-muted-foreground/60 flex-shrink-0 transition-transform duration-150",
                        isOpen && "rotate-180"
                    )} />
                </button>

                {isOpen && (
                    <div className="absolute top-full left-0 mt-1 w-72 bg-popover border border-border/50 rounded-xl shadow-lg z-50 overflow-hidden animate-in fade-in-0 zoom-in-95 duration-100">
                        <div className="max-h-[380px] overflow-y-auto py-1.5">
                            {sortedModels.map((model) => {
                                const provider = getProviderFromModel(model);
                                const shortName = getShortName(model);
                                const free = isModelFree(model);
                                const isSelected = model.id === selectedModelData?.id;

                                return (
                                    <button
                                        key={model.id}
                                        type="button"
                                        onClick={() => handleSelect(model)}
                                        className={cn(
                                            "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors duration-75",
                                            "hover:bg-muted/50",
                                            isSelected && "bg-muted/40"
                                        )}
                                        data-testid={`option-model-${model.modelId}`}
                                    >
                                        <ProviderIcon provider={provider} className={cn(isSelected && "opacity-100")} />
                                        <span className={cn(
                                            "flex-1 text-sm truncate",
                                            isSelected ? "font-semibold" : "font-normal"
                                        )}>
                                            {shortName}
                                        </span>
                                        {free ? (
                                            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-full">
                                                Free
                                            </span>
                                        ) : (
                                            <Lock className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0" />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
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
