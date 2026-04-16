import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Lock, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { AvailableModel } from "@/contexts/ModelAvailabilityContext";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isFreeTierUser, isModelFreeForAll } from "@/lib/planUtils";

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
  if (model.tier === "free") return true;
  return isModelFreeForAll(model.modelId) || isModelFreeForAll(model.id);
}

function getModelLogo(model: AvailableModel): string {
  return model.logoUrl || model.icon || "/logos/openai.png";
}

export function StandardModelSelector({
  availableModels,
  selectedModelId,
  setSelectedModelId,
  modelsByProvider: _modelsByProvider,
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
  const isAdmin = userPlanInfo?.isAdmin === true;
  const isFreeUser = !isAdmin && isFreeTierUser(
    userPlanInfo ? { plan: userPlanInfo.plan, role: userPlanInfo.isAdmin ? "admin" : undefined } : null,
  );

  const resolvedModels = React.useMemo(
    () =>
      [...availableModels].sort((left, right) => {
        const orderDelta = (left.displayOrder || 0) - (right.displayOrder || 0);
        if (orderDelta !== 0) return orderDelta;
        return (left.name || "").localeCompare(right.name || "", "es", { sensitivity: "base" });
      }),
    [availableModels],
  );

  const selectedModel = React.useMemo(() => {
    if (!resolvedModels.length) return null;
    if (!selectedModelId) return resolvedModels[0] || null;
    return (
      resolvedModels.find((model) => model.id === selectedModelId || model.modelId === selectedModelId) ||
      resolvedModels[0] ||
      null
    );
  }, [resolvedModels, selectedModelId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (!isOpen) return;
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleSelect = (model: AvailableModel) => {
    if (isDisabled) return;

    // Admin bypasses all model restrictions
    if (!isAdmin) {
      const freeModel = isModelFree(model);
      if (isFreeUser && !freeModel) {
        onUpgradeClick?.();
        return;
      }

      if (model.availableToUser === false && model.requiresUpgrade) {
        onUpgradeClick?.();
        return;
      }
    }

    const handler = onModelChange ?? setSelectedModelId;
    handler(model.id);
    setIsOpen(false);
  };

  if (!resolvedModels.length) {
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
            isOpen && "bg-muted/60",
          )}
          disabled={isDisabled}
          data-testid="button-model-selector"
          title={
            activeGptName
              ? `Modelo fijado por GPT: ${activeGptName}`
              : modelChangeDisabled
                ? "Respuesta en curso"
                : "Seleccionar modelo"
          }
        >
          {selectedModel ? (
            <img
              src={getModelLogo(selectedModel)}
              alt=""
              className="w-4 h-4 rounded-sm object-cover flex-shrink-0"
            />
          ) : null}
          <span className="font-medium text-sm truncate max-w-[180px]">
            {selectedModel?.name || "Modelo"}
          </span>
          {selectedModel && !isModelFree(selectedModel) && !isAdmin ? (
            <Lock className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
          ) : null}
          <ChevronDown
            className={cn(
              "h-3 w-3 text-muted-foreground/50 flex-shrink-0 transition-transform duration-150",
              isOpen && "rotate-180",
            )}
          />
        </button>

        {isOpen ? (
          <div className="absolute top-full left-0 mt-1.5 w-72 bg-popover border border-border/40 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in-0 zoom-in-95 duration-100">
            <div className="py-1.5 max-h-[60vh] overflow-y-auto">
              {resolvedModels.map((model) => {
                const isSelected = selectedModel?.id === model.id;
                const paidModel = !isModelFree(model) && !isAdmin;
                const unavailableForUser = !isAdmin && model.availableToUser === false && model.requiresUpgrade;

                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => handleSelect(model)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors duration-75",
                      "hover:bg-muted/50 cursor-pointer",
                      isSelected && "bg-muted/40",
                    )}
                    data-testid={`option-model-${model.name.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <img
                      src={getModelLogo(model)}
                      alt=""
                      className="w-5 h-5 rounded-sm object-cover flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className={cn("text-[13px] truncate", isSelected ? "font-semibold" : "font-normal")}>
                        {model.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {model.providerDisplayName || model.provider}
                      </div>
                    </div>
                    {unavailableForUser ? (
                      <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
                        Upgrade
                      </span>
                    ) : null}
                    {paidModel ? <Lock className="h-3.5 w-3.5 text-muted-foreground/30 flex-shrink-0" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {onAddModel ? (
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
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
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
      ) : null}
    </div>
  );
}

export default StandardModelSelector;
