import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Lock, Plus } from "lucide-react";
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

interface CuratedModel {
    displayName: string;
    matchIds: string[];
    logo: string;
    free: boolean;
}

const CURATED_MODELS: CuratedModel[] = [
    {
        displayName: "Gemma 4 31B",
        matchIds: ["google/gemma-4-31b-it", "google/gemma-4-31b-it:free"],
        logo: "/logos/gemma.png",
        free: true,
    },
    {
        displayName: "Grok 4.1 Fast",
        matchIds: ["grok-4-1-fast-non-reasoning", "x-ai/grok-4.1-fast"],
        logo: "/logos/grok.png",
        free: true,
    },
    {
        displayName: "GPT-5.4",
        matchIds: ["openai/gpt-5.4", "gpt-5.4", "openai/chatgpt-5.4", "openai/gpt-4.1", "gpt-4.1"],
        logo: "/logos/chatgpt.png",
        free: false,
    },
    {
        displayName: "Gemini 3.1 Pro",
        matchIds: ["gemini-3.1-pro", "google/gemini-3.1-pro", "gemini-3.1-pro-preview", "google/gemini-3.1-pro-preview"],
        logo: "/logos/gemini.png",
        free: false,
    },
    {
        displayName: "Grok 4.2",
        matchIds: ["x-ai/grok-4.2", "grok-4.2"],
        logo: "/logos/grok.png",
        free: false,
    },
    {
        displayName: "GLM 5.1",
        matchIds: ["z-ai/glm-5.1", "glm-5.1"],
        logo: "/logos/glm.png",
        free: false,
    },
    {
        displayName: "Kimi K2.5",
        matchIds: ["moonshotai/kimi-k2.5"],
        logo: "/logos/kimi.png",
        free: false,
    },
];

function findAvailableModel(curated: CuratedModel, availableModels: AvailableModel[]): AvailableModel | null {
    for (const mid of curated.matchIds) {
        const found = availableModels.find(
            (m) => m.modelId === mid || m.id === mid
        );
        if (found) return found;
    }
    return null;
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

    const resolvedModels = React.useMemo(() => {
        return CURATED_MODELS.map((curated) => {
            const available = findAvailableModel(curated, availableModels);
            return { curated, available };
        });
    }, [availableModels]);

    const selectedEntry = React.useMemo(() => {
        if (!selectedModelId) return resolvedModels[0] || null;
        const found = resolvedModels.find(
            (r) => r.available && (r.available.id === selectedModelId || r.available.modelId === selectedModelId)
        );
        return found || resolvedModels[0] || null;
    }, [selectedModelId, resolvedModels]);

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

    const handleSelect = (entry: typeof resolvedModels[0]) => {
        if (isDisabled) return;
        if (!entry.available) return;

        if (isFreeUser && !entry.curated.free) {
            if (onUpgradeClick) onUpgradeClick();
            return;
        }

        const handler = onModelChange ?? setSelectedModelId;
        handler(entry.available.id);
        setIsOpen(false);
    };

    if (resolvedModels.length === 0) {
        return (
            <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-not-allowed opacity-50"
                data-testid="button-model-selector-disabled"
            >
                <span className="text-xs text-muted-foreground">Sin modelos</span>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-0.5">
            <div ref={dropdownRef} className="relative">
                <button
                    type="button"
                    onClick={() => !isDisabled && setIsOpen(!isOpen)}
                    className={cn(
                        "flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-150",
                        isDisabled ? "cursor-not-allowed opacity-50" : "hover:bg-muted/60 cursor-pointer",
                        isOpen && "bg-muted/60"
                    )}
                    disabled={isDisabled}
                    data-testid="button-model-selector"
                    title={activeGptName ? `Modelo fijado por GPT: ${activeGptName}` : modelChangeDisabled ? "Respuesta en curso" : "Seleccionar modelo"}
                >
                    {selectedEntry && (
                        <img
                            src={selectedEntry.curated.logo}
                            alt=""
                            className="w-4 h-4 rounded-sm object-cover flex-shrink-0"
                        />
                    )}
                    <span className="font-medium text-sm truncate max-w-[160px]">
                        {selectedEntry?.curated.displayName || "Modelo"}
                    </span>
                    {selectedEntry && !selectedEntry.curated.free && (
                        <Lock className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
                    )}
                    <ChevronDown className={cn(
                        "h-3 w-3 text-muted-foreground/50 flex-shrink-0 transition-transform duration-150",
                        isOpen && "rotate-180"
                    )} />
                </button>

                {isOpen && (
                    <div className="absolute top-full left-0 mt-1.5 w-64 bg-popover border border-border/40 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in-0 zoom-in-95 duration-100">
                        <div className="py-1.5">
                            {resolvedModels.map((entry, idx) => {
                                const isSelected = selectedEntry === entry;
                                const disabled = !entry.available;

                                return (
                                    <button
                                        key={entry.curated.displayName}
                                        type="button"
                                        onClick={() => handleSelect(entry)}
                                        disabled={disabled}
                                        className={cn(
                                            "w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors duration-75",
                                            disabled
                                                ? "opacity-40 cursor-not-allowed"
                                                : "hover:bg-muted/50 cursor-pointer",
                                            isSelected && "bg-muted/40"
                                        )}
                                        data-testid={`option-model-${entry.curated.displayName.toLowerCase().replace(/\s+/g, "-")}`}
                                    >
                                        <img
                                            src={entry.curated.logo}
                                            alt=""
                                            className="w-5 h-5 rounded-sm object-cover flex-shrink-0"
                                        />
                                        <span className={cn(
                                            "flex-1 text-[13px] truncate",
                                            isSelected ? "font-semibold" : "font-normal"
                                        )}>
                                            {entry.curated.displayName}
                                        </span>
                                        {entry.curated.free ? null : (
                                            <Lock className="h-3.5 w-3.5 text-muted-foreground/30 flex-shrink-0" />
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
