
import React from 'react';
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ShareChatDialog, ShareIcon } from "@/components/share-chat-dialog";
import { UpgradePlanDialog } from "@/components/upgrade-plan-dialog";
import { ScheduleDialog } from "@/components/schedule-dialog";
import { useModelAvailability, type AvailableModel } from "@/contexts/ModelAvailabilityContext";
import {
    ChevronDown,
    Pencil,
    Info,
    Settings,
    Calendar,
    EyeOff,
    Pin,
    Link,
    Star,
    Flag,
    Sparkles,
    MoreHorizontal,
    Folder,
    FolderPlus,
    Download,
    Archive,
    Trash2,
    Check,
    X,
    PanelLeftOpen
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ActiveGpt } from "@/types/chat";
import { useToast } from "@/hooks/use-toast";
import { useMemo, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { StandardModelSelector } from './StandardModelSelector';
import { GptActionMenu } from './GptActionMenu';
import { useChatIsProcessing } from "@/stores/streamingStore";

interface ChatHeaderProps {
    chatId: string | null;
    activeGpt: ActiveGpt;
    messages: { content: string }[];
    folders?: { id: string; name: string; color: string }[];
    currentFolderId?: string | null;
    isPinned?: boolean;
    isArchived?: boolean;
    isSidebarOpen: boolean;
    onToggleSidebar: () => void;
    // Callback props for actions
    onNewChat?: () => void;
    onEditGpt?: (gpt: ActiveGpt) => void;
    onHideGptFromSidebar?: (id: string) => void;
    onPinGptToSidebar?: (id: string) => void;
    isGptPinned?: (id: string) => boolean;
    onAboutGpt?: (gpt: ActiveGpt) => void;
    onPinChat?: (id: string, e: React.MouseEvent) => void;
    onArchiveChat?: (id: string, e: React.MouseEvent) => void;
    onHideChat?: (id: string, e: React.MouseEvent) => void;
    onDeleteChat?: (id: string, e: React.MouseEvent) => void;
    onDownloadChat?: (id: string, e: React.MouseEvent) => void;
    onEditChatTitle?: (id: string, newTitle: string) => void;
    onMoveToFolder?: (chatId: string, folderId: string | null) => void;
    onCreateFolder?: (name: string) => void;
    userPlanInfo?: { plan: string; isAdmin?: boolean; isPaid?: boolean } | null;
}

export function ChatHeader({
    chatId,
    activeGpt,
    messages,
    folders = [],
    currentFolderId,
    isPinned = false,
    isArchived = false,
    isSidebarOpen,
    onToggleSidebar,
    onNewChat,
    onEditGpt,
    onHideGptFromSidebar,
    onPinGptToSidebar,
    isGptPinned,
    onAboutGpt,
    onPinChat,
    onArchiveChat,
    onHideChat,
    onDeleteChat,
    onDownloadChat,
    onEditChatTitle,
    onMoveToFolder,
    onCreateFolder,
    userPlanInfo
}: ChatHeaderProps) {
    const { toast } = useToast();
    const [isUpgradeDialogOpen, setIsUpgradeDialogOpen] = useState(false);
    const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
    const currentInput = useChatStore((s) => s.input);
    const { availableModels, isAnyModelAvailable, selectedModelId, setSelectedModelId } = useModelAvailability();
    const isChatProcessing = useChatIsProcessing(chatId);

    const handleModelChange = (id: string) => {
        if (isChatProcessing) {
            toast({
                title: "Respuesta en curso",
                description: "Espera a que termine antes de cambiar el modelo.",
            });
            return;
        }
        setSelectedModelId(id);
    };

    // Model grouping logic
    const modelsByProvider = useMemo(() => {
        const grouped: Record<string, AvailableModel[]> = {};
        availableModels.forEach(model => {
            if (!grouped[model.provider]) {
                grouped[model.provider] = [];
            }
            grouped[model.provider].push(model);
        });
        return grouped;
    }, [availableModels]);

    const isCustomGpt = useMemo(() => {
        // Strict Check: Valid context requires explicit userId presence.
        // System models / Standard chat usually lack userId or have specific system IDs.

        // SPECIAL CASE: 'iliagpt' is the default system app wrapper, treat as Standard Chat.
        // This prevents the GPT Actions menu from appearing in the main chat interface.
        if (activeGpt?.name === 'iliagpt') return false;

        const isCustom = activeGpt && !!activeGpt.userId && !!activeGpt.id;

        return isCustom;
    }, [activeGpt]);


    return (
        <>
        <header className="sticky top-0 z-20 flex items-center justify-between px-3 md:px-4 py-2 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 h-14">
            <div className="flex items-center gap-2">
                {!isSidebarOpen && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={onToggleSidebar} className="-ml-2 h-9 w-9" aria-label="Toggle sidebar">
                                    <PanelLeftOpen className="h-5 w-5 text-muted-foreground" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                                <p>Mostrar barra lateral</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}

                {/* STRICT Separation: Custom GPT Actions vs Standard Model Selector */}
                {isCustomGpt ? (
                    <GptActionMenu
                        activeGpt={activeGpt}
                        modelsByProvider={modelsByProvider}
                        selectedModelId={selectedModelId}
                        setSelectedModelId={setSelectedModelId}
                        onModelChange={handleModelChange}
                        modelChangeDisabled={isChatProcessing}
                        onNewChat={onNewChat}
                        onAboutGpt={onAboutGpt}
                        onEditGpt={onEditGpt}
                        onHideGptFromSidebar={onHideGptFromSidebar}
                        onPinGptToSidebar={onPinGptToSidebar}
                        isGptPinned={isGptPinned}
                    />
                ) : (
                    <StandardModelSelector
                        availableModels={availableModels}
                        selectedModelId={selectedModelId}
                        setSelectedModelId={setSelectedModelId}
                        onModelChange={handleModelChange}
                        modelChangeDisabled={isChatProcessing}
                        modelsByProvider={modelsByProvider}
                        activeGptName={activeGpt?.name === 'iliagpt' ? undefined : activeGpt?.name}
                        userPlanInfo={userPlanInfo}
                        onUpgradeClick={() => setIsUpgradeDialogOpen(true)}
                    />
                )}
            </div>

            <div className="flex items-center gap-0.5 sm:gap-1">
                {/* Upgrade button - Show for free users and guests, hide for paid/admin */}
                {(!userPlanInfo || userPlanInfo.plan === "free") && !userPlanInfo?.isPaid && !userPlanInfo?.isAdmin && (
                    <Button
                        variant="outline"
                        size="sm"
                        className="flex rounded-full text-xs gap-1.5 px-2 sm:px-3 border-primary/30 bg-primary/5 hover:bg-primary/10"
                        onClick={() => setIsUpgradeDialogOpen(true)}
                        data-testid="button-upgrade-header"
                    >
                        <Sparkles className="h-3 w-3 text-primary" />
                        <span className="hidden sm:inline">Mejorar el plan a Go</span>
                        <span className="sm:hidden">Go</span>
                    </Button>
                )}

                {chatId && !chatId.startsWith("pending-") ? (
                    <ShareChatDialog chatId={chatId} chatTitle={messages[0]?.content?.slice(0, 30) || "Chat"}>
                        <Button variant="ghost" size="icon" data-testid="button-share-chat" aria-label="Share chat">
                            <ShareIcon size={20} />
                        </Button>
                    </ShareChatDialog>
                ) : (
                    <Button
                        variant="ghost"
                        size="icon"
                        data-testid="button-share-chat-disabled"
                        disabled
                        title="Envía un mensaje para poder compartir este chat"
                        aria-label="Share chat (disabled)"
                    >
                        <ShareIcon size={20} />
                    </Button>
                )}

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid="button-chat-options" aria-label="Chat options">
                            <MoreHorizontal className="h-5 w-5 text-muted-foreground" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52" sideOffset={5}>
                        <DropdownMenuItem
                            onClick={(e) => chatId && onPinChat?.(chatId, e)}
                            disabled={!chatId || chatId.startsWith("pending-")}
                            data-testid="menu-pin-chat"
                        >
                            <Pin className="h-4 w-4 mr-2" />
                            {isPinned ? "Desfijar" : "Fijar chat"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() => {
                                if (chatId && onEditChatTitle) {
                                    const newTitle = prompt("Nuevo título del chat:", messages[0]?.content?.slice(0, 50) || "Chat");
                                    if (newTitle && newTitle.trim()) {
                                        onEditChatTitle(chatId, newTitle.trim());
                                    }
                                }
                            }}
                            disabled={!chatId || chatId.startsWith("pending-")}
                            data-testid="menu-edit-chat"
                        >
                            <Pencil className="h-4 w-4 mr-2" />
                            Editar
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger
                                disabled={!chatId || chatId.startsWith("pending-")}
                                data-testid="menu-move-folder"
                            >
                                <Folder className="h-4 w-4 mr-2" />
                                Mover a carpeta
                            </DropdownMenuSubTrigger>
                            <DropdownMenuPortal>
                                <DropdownMenuSubContent>
                                    {folders.length > 0 ? (
                                        <>
                                            {folders.map((folder) => (
                                                <DropdownMenuItem
                                                    key={folder.id}
                                                    onClick={() => chatId && onMoveToFolder?.(chatId, folder.id)}
                                                    data-testid={`menu-folder-${folder.id}`}
                                                >
                                                    <div
                                                        className="w-4 h-4 rounded-full mr-2"
                                                        ref={(el) => { if (el) el.style.backgroundColor = folder.color; }}
                                                    />
                                                    {folder.name}
                                                </DropdownMenuItem>
                                            ))}
                                            {currentFolderId && (
                                                <>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        onClick={() => chatId && onMoveToFolder?.(chatId, null)}
                                                        data-testid="menu-remove-folder"
                                                    >
                                                        <X className="h-4 w-4 mr-2" />
                                                        Quitar de carpeta
                                                    </DropdownMenuItem>
                                                </>
                                            )}
                                        </>
                                    ) : (
                                        <DropdownMenuItem
                                            onClick={() => {
                                                const folderName = prompt("Nombre de la carpeta:");
                                                if (folderName && folderName.trim()) {
                                                    onCreateFolder?.(folderName.trim());
                                                }
                                            }}
                                            data-testid="menu-create-folder"
                                        >
                                            <FolderPlus className="h-4 w-4 mr-2" />
                                            Crear carpeta
                                        </DropdownMenuItem>
                                    )}
                                </DropdownMenuSubContent>
                            </DropdownMenuPortal>
                        </DropdownMenuSub>
                        <DropdownMenuItem
                            onClick={(e) => chatId && onDownloadChat?.(chatId, e)}
                            disabled={!chatId || chatId.startsWith("pending-")}
                            data-testid="menu-download-chat"
                        >
                            <Download className="h-4 w-4 mr-2" />
                            Descargar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() => setIsScheduleDialogOpen(true)}
                            disabled={!chatId || chatId.startsWith("pending-")}
                            data-testid="menu-schedule-chat"
                        >
                            <Calendar className="h-4 w-4 mr-2" />
                            Programar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={(e) => chatId && onArchiveChat?.(chatId, e)}
                            disabled={!chatId || chatId.startsWith("pending-")}
                            data-testid="menu-archive-chat"
                        >
                            <Archive className="h-4 w-4 mr-2" />
                            {isArchived ? "Desarchivar" : "Archivar"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={(e) => chatId && onHideChat?.(chatId, e)}
                            disabled={!chatId || chatId.startsWith("pending-")}
                            data-testid="menu-hide-chat"
                        >
                            <EyeOff className="h-4 w-4 mr-2" />
                            Ocultar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={(e) => chatId && onDeleteChat?.(chatId, e)}
                            disabled={!chatId || chatId.startsWith("pending-")}
                            className="text-red-500 focus:text-red-500"
                            data-testid="menu-delete-chat"
                        >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Eliminar
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <UpgradePlanDialog open={isUpgradeDialogOpen} onOpenChange={setIsUpgradeDialogOpen} />
        </header>
        {chatId && !chatId.startsWith("pending-") && (
            <ScheduleDialog
                open={isScheduleDialogOpen}
                onOpenChange={setIsScheduleDialogOpen}
                chatId={chatId}
                defaultPrompt={currentInput}
            />
        )}
        </>
    );
}
