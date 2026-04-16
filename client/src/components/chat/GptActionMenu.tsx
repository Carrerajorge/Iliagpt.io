import React, { useState } from 'react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
    DropdownMenuPortal
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Pencil, Info, Settings, EyeOff, Pin, Link, Star, Flag, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActiveGpt } from "@/types/chat";
import { useToast } from "@/hooks/use-toast";
import { AvailableModel } from "@/contexts/ModelAvailabilityContext";

interface GptActionMenuProps {
    activeGpt: ActiveGpt;
    modelsByProvider: Record<string, AvailableModel[]>;
    selectedModelId: string | null;
    setSelectedModelId: (id: string) => void;
    onModelChange?: (id: string) => void;
    modelChangeDisabled?: boolean;
    onNewChat?: () => void;
    onAboutGpt?: (gpt: ActiveGpt) => void;
    onEditGpt?: (gpt: ActiveGpt) => void;
    onHideGptFromSidebar?: (id: string) => void;
    onPinGptToSidebar?: (id: string) => void;
    isGptPinned?: (id: string) => boolean;
}

export function GptActionMenu({
    activeGpt,
    modelsByProvider,
    selectedModelId,
    setSelectedModelId,
    onModelChange,
    modelChangeDisabled = false,
    onNewChat,
    onAboutGpt,
    onEditGpt,
    onHideGptFromSidebar,
    onPinGptToSidebar,
    isGptPinned
}: GptActionMenuProps) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);

    console.log("[GptActionMenu] Rendering");

    // Helper to find selected model data to facilitate UI logic
    // We infer the selected model object from available lists if needed, 
    // but primarily we just need the ID to check equality.

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <div
                    className="flex items-center gap-1 sm:gap-2 cursor-pointer hover:bg-muted/50 px-1.5 sm:px-2 py-1 rounded-md transition-colors mt-[-5px] mb-[-5px] pt-[8px] pb-[8px] pl-[7px] pr-[7px]"
                    data-testid="button-gpt-context-menu"
                >
                    <span className="font-semibold text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none">
                        {activeGpt.name}
                    </span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 max-h-96 overflow-y-auto">
                {/* GPT-specific options */}
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        <span>Modelos</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                        <DropdownMenuSubContent className="w-56">
                            {Object.entries(modelsByProvider).map(([provider, models], providerIndex) => (
                                <React.Fragment key={provider}>
                                    {providerIndex > 0 && <DropdownMenuSeparator />}
                                    <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                                        {provider === "xai" ? "xAI" : provider === "gemini" ? "Google Gemini" : provider}
                                    </div>
                                        {models.map((model) => (
                                            <DropdownMenuItem
                                                key={model.id}
                                                className={cn(
                                                    "flex items-center gap-2",
                                                    selectedModelId === model.id ? "bg-muted" : "",
                                                    modelChangeDisabled && "opacity-50 cursor-not-allowed"
                                                )}
                                                onClick={() => {
                                                if (modelChangeDisabled) {
                                                    toast({
                                                        title: "Respuesta en curso",
                                                        description: "Espera a que termine para cambiar el modelo.",
                                                    });
                                                    setOpen(false);
                                                    return;
                                                }
                                                const handler = onModelChange ?? setSelectedModelId;
                                                handler(model.id);
                                                setOpen(false);
                                                }}
                                            >
                                            {selectedModelId === model.id && <Check className="h-4 w-4" />}
                                            <span className={cn(selectedModelId !== model.id ? "pl-6" : "")}>{model.name}</span>
                                        </DropdownMenuItem>
                                    ))}
                                </React.Fragment>
                            ))}
                        </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                </DropdownMenuSub>

                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onNewChat} className="flex items-center gap-2">
                    <Pencil className="h-4 w-4" />
                    <span>Nuevo chat</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAboutGpt?.(activeGpt)} className="flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    <span>Acerca de</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEditGpt?.(activeGpt)} className="flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    <span>Editar GPT</span>
                </DropdownMenuItem>
                {isGptPinned?.(activeGpt.id) ? (
                    <DropdownMenuItem onClick={() => onHideGptFromSidebar?.(activeGpt.id)} className="flex items-center gap-2">
                        <EyeOff className="h-4 w-4" />
                        <span>Ocultar de la barra lateral</span>
                    </DropdownMenuItem>
                ) : (
                    <DropdownMenuItem onClick={() => onPinGptToSidebar?.(activeGpt.id)} className="flex items-center gap-2">
                        <Pin className="h-4 w-4" />
                        <span>Fijar en la barra lateral</span>
                    </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/gpts/${activeGpt.id}`);
                        toast({ title: "Enlace copiado", description: "El enlace del GPT se ha copiado al portapapeles" });
                    }}
                    className="flex items-center gap-2"
                >
                    <Link className="h-4 w-4" />
                    <span>Copiar enlace</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => toast({ title: "Valorar GPT", description: "Esta función estará disponible próximamente" })}
                    className="flex items-center gap-2"
                >
                    <Star className="h-4 w-4" />
                    <span>Valorar GPT</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => toast({ title: "Denunciar GPT", description: "Puedes reportar contenido inapropiado a soporte" })}
                    className="flex items-center gap-2 text-destructive"
                >
                    <Flag className="h-4 w-4" />
                    <span>Denunciar GPT</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export default GptActionMenu;
