import { Sidebar } from "@/components/sidebar";
import { MiniSidebar } from "@/components/mini-sidebar";
import { ChatInterface } from "@/components/chat-interface";
import { GptExplorer, Gpt } from "@/components/gpt-explorer";
import { GptBuilder } from "@/components/gpt-builder";
import { AboutGptDialog } from "@/components/about-gpt-dialog";
import { UserLibrary } from "@/components/user-library";
import { AppsView } from "@/components/apps-view";
import { SearchModal } from "@/components/search-modal";
import { SettingsDialog } from "@/components/settings-dialog";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import { ExportChatDialog } from "@/components/export-chat-dialog";
import { FavoritesDialog } from "@/components/favorites-dialog";
import { PromptTemplatesDialog } from "@/components/prompt-templates-dialog";
import { OfflineIndicator, OfflineBanner } from "@/components/offline-indicator";
import { MediaLibraryModal } from "@/components/media-library-modal";
import { useMediaLibrary } from "@/hooks/use-media-library";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useFavorites } from "@/hooks/use-favorites";
import { usePromptTemplates } from "@/hooks/use-prompt-templates";
import { useNotifications } from "@/hooks/use-notifications";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocation } from "wouter";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useChats, Message } from "@/hooks/use-chats";
import { useChatFolders } from "@/hooks/use-chat-folders";
import { usePinnedGpts } from "@/hooks/use-pinned-gpts";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useStreamingStore, useProcessingChatIds, usePendingBadges } from "@/stores/streamingStore";
import { useBackgroundStreamNotifications } from "@/hooks/use-background-stream-notifications";
import { useAgentStore } from "@/stores/agent-store";
import { useSuperAgentStore } from "@/stores/super-agent-store";
import { pollingManager } from "@/lib/polling-manager";
import { queryClient } from "@/lib/queryClient";

export default function Home() {
  const isMobile = useIsMobile();
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();


  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation("/welcome");
    }
  }, [isAuthenticated, isLoading, setLocation]);

  useEffect(() => {
    useMediaLibrary.getState().preload();
  }, []);

  const [isSidebarOpen, setIsSidebarOpen] = useState(!isMobile);
  const [isNewChatMode, setIsNewChatMode] = useState(false);
  const [newChatStableKey, setNewChatStableKey] = useState<string | null>(null);
  const [isGptExplorerOpen, setIsGptExplorerOpen] = useState(false);
  const [isGptBuilderOpen, setIsGptBuilderOpen] = useState(false);
  const [aboutGptId, setAboutGptId] = useState<string | null>(null);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isMediaLibraryOpen, setIsMediaLibraryOpen] = useState(false);
  const [isAppsDialogOpen, setIsAppsDialogOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [editingGpt, setEditingGpt] = useState<Gpt | null>(null);
  const [activeGpt, setActiveGpt] = useState<Gpt | null>(null);
  
  const { favorites, addFavorite, removeFavorite, isFavorite } = useFavorites();
  const { templates, addTemplate, removeTemplate, updateTemplate, incrementUsage, categories } = usePromptTemplates();
  const { notifyTaskComplete, requestPermission } = useNotifications();
  const { isOnline } = useOnlineStatus();
  
  const { 
    chats, 
    hiddenChats,
    pinnedChats,
    activeChat, 
    setActiveChatId, 
    createChat, 
    addMessage,
    deleteChat,
    editChatTitle,
    archiveChat,
    hideChat,
    pinChat,
    downloadChat,
    updateMessageAttachments,
    editMessageAndTruncate,
    truncateAndReplaceMessage,
    truncateMessagesAt
  } = useChats();

  const {
    folders,
    createFolder,
    moveChatToFolder,
    removeChatFromFolder,
    getFolderForChat
  } = useChatFolders();

  const handleMoveToFolder = useCallback((chatId: string, folderId: string | null) => {
    if (folderId === null) {
      removeChatFromFolder(chatId);
    } else {
      moveChatToFolder(chatId, folderId);
    }
  }, [moveChatToFolder, removeChatFromFolder]);

  // AI processing state - kept in parent to survive ChatInterface key changes
  const [aiState, setAiStateRaw] = useState<"idle" | "thinking" | "responding">("idle");
  const [aiStateChatId, setAiStateChatId] = useState<string | null>(null);
  const [aiProcessSteps, setAiProcessSteps] = useState<{step: string; status: "pending" | "active" | "done"}[]>([]);
  
  // Super Agent UI state - kept in parent to survive ChatInterface key changes
  const [uiPhase, setUiPhase] = useState<'idle' | 'thinking' | 'console' | 'done'>('idle');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  
  // Wrapper for setAiState that tracks which chat the state belongs to
  const setAiState = useCallback((newState: "idle" | "thinking" | "responding" | ((prev: "idle" | "thinking" | "responding") => "idle" | "thinking" | "responding")) => {
    const resolvedState = typeof newState === 'function' ? newState(aiState) : newState;
    setAiStateRaw(resolvedState);
    if (resolvedState === 'idle') {
      setAiStateChatId(null);
    } else {
      // Capture the current chat ID when entering non-idle state
      const currentChatId = activeChat?.id || pendingChatIdRef.current;
      if (currentChatId) {
        setAiStateChatId(currentChatId);
      }
    }
  }, [aiState, activeChat?.id]);
  
  // Use global streaming store for tracking processing chats and pending badges
  const processingChatIds = useProcessingChatIds();
  const pendingResponseCounts = usePendingBadges();
  const { clearBadge } = useStreamingStore();

  // Background stream notifications with sound
  useBackgroundStreamNotifications(chats, activeChat?.id || null);

  // Store the pending chat ID during new chat creation
  const pendingChatIdRef = useRef<string | null>(null);
  
  const handleClearPendingCount = useCallback((chatId: string) => {
    clearBadge(chatId);
  }, [clearBadge]);
  
  // Clear pending count when selecting a chat
  const handleSelectChatWithClear = useCallback((id: string) => {
    // Keep processing state for background chats - don't clear processingChatIds
    // This allows multiple chats to process simultaneously
    handleClearPendingCount(id);
    
    // DO NOT reset aiState - let background streaming complete naturally
    // The aiStateChatId check prevents the indicator from showing on wrong chat
    // Only reset process steps for UI display
    setAiProcessSteps([]);
    
    setIsNewChatMode(false);
    setNewChatStableKey(null);
    setActiveChatId(id);
  }, [handleClearPendingCount, setActiveChatId, setAiProcessSteps]);

  // Listen for select-chat custom event (used by Agent Mode navigation)
  // This event is used when agent creates a new chat - we need to preserve the stable key
  // to prevent component remount which would lose the agent run state
  useEffect(() => {
    const handleSelectChatEvent = (event: CustomEvent<{ chatId: string; preserveKey?: boolean }>) => {
      const { chatId, preserveKey } = event.detail;
      if (chatId) {
        // For agent mode navigation, don't reset the stable key - just update the active chat ID
        // This prevents component remount and preserves agent run state
        handleClearPendingCount(chatId);
        setIsNewChatMode(false);
        // Only reset stableKey if not preserving (for regular navigation)
        if (!preserveKey) {
          setNewChatStableKey(null);
        }
        setActiveChatId(chatId);
        setAiProcessSteps([]);
      }
    };
    
    window.addEventListener("select-chat", handleSelectChatEvent as EventListener);
    return () => {
      window.removeEventListener("select-chat", handleSelectChatEvent as EventListener);
    };
  }, [handleClearPendingCount, setActiveChatId, setAiProcessSteps]);

  const handleNewChat = (options?: { preserveGpt?: boolean }) => {
    // TRANSACTIONAL RESET: Block all re-hydration for 5 seconds
    // This prevents stale state from coming back after navigation
    useAgentStore.getState().blockRehydration();
    
    // Clear all streaming badges and pending response indicators
    useStreamingStore.getState().clearAllBadges();
    
    // Clear all Super Agent runs
    useSuperAgentStore.getState().clearAllRuns();
    
    // Cancel all active agent runs and clear agent state
    pollingManager.cancelAll();
    useAgentStore.getState().clearAllRuns();
    
    // Clear conversation state query cache to prevent stale data
    queryClient.removeQueries({ queryKey: ['conversationState'] });
    
    // Reset AI processing state for UI display
    setAiProcessSteps([]);
    setAiStateRaw('idle');
    setAiStateChatId(null);
    
    // Reset Super Agent UI state
    setUiPhase('idle');
    setActiveRunId(null);
    
    // Clear chat references - this triggers new chat mode
    setActiveChatId(null);
    setIsNewChatMode(true);
    setNewChatStableKey(null);
    pendingChatIdRef.current = null;
    
    // AGGRESSIVE RESET: Clear active GPT to return to LLM models view
    // Only clear GPT if not explicitly preserving it (e.g., when selecting a new GPT)
    if (!options?.preserveGpt) {
      setActiveGpt(null);
    }
    
    // Close any open dialogs
    setIsAppsDialogOpen(false);
  };
  
  const handleSendNewChatMessage = useCallback((message: Message) => {
    const { pendingId, stableKey } = createChat();
    pendingChatIdRef.current = pendingId;
    // CRITICAL: Use the stableKey from createChat to ensure chatInterfaceKey
    // matches activeChat.stableKey after backend confirms. This prevents
    // component remount when newChatStableKey is cleared during navigation.
    setNewChatStableKey(stableKey);
    setIsNewChatMode(false);
    addMessage(pendingId, message);
  }, [createChat, addMessage]);
  
  // Stable message sender that uses the correct chat ID
  // IMPORTANT: If targetChatId is provided, use it (for streaming responses that need affinity)
  // Otherwise fall back to current active chat (for new messages from user)
  const handleSendMessage = useCallback(async (message: Message, targetChatId?: string) => {
    // Use explicit targetChatId if provided (ensures streaming responses go to correct chat)
    const resolvedChatId = targetChatId || activeChat?.id || pendingChatIdRef.current;
    if (resolvedChatId) {
      return await addMessage(resolvedChatId, message);
    } else {
      // Fallback: create new chat
      handleSendNewChatMessage(message);
      return undefined;
    }
  }, [activeChat?.id, addMessage, handleSendNewChatMessage]);


  const chatInterfaceKey = useMemo(() => {
    // Prioritize newChatStableKey to prevent component remount during new chat creation
    if (newChatStableKey) return newChatStableKey;
    if (activeChat) return activeChat.stableKey;
    return "default-chat";
  }, [activeChat?.stableKey, newChatStableKey]);

  // Get messages from either activeChat or pending chat
  const currentMessages = useMemo(() => {
    if (activeChat?.messages) return activeChat.messages;
    // Check if there's a pending chat with messages
    const pendingId = pendingChatIdRef.current;
    if (pendingId) {
      const pendingChat = chats.find(c => c.id === pendingId);
      if (pendingChat?.messages) return pendingChat.messages;
    }
    return [];
  }, [activeChat?.messages, chats]);

  // Dummy setMessages for ChatInterface - Agent Mode uses its own internal state
  // We pass messages as read-only from currentMessages
  const noopSetMessages = useCallback(() => {
    // No-op - Agent Mode will manage its own local state for real-time updates
  }, []);

  const handleOpenGpts = () => {
    setIsGptExplorerOpen(true);
  };

  const handleOpenApps = () => {
    setIsAppsDialogOpen(true);
  };

  const handleOpenSkills = () => {
    setLocation("/skills");
  };

  const handleOpenLibrary = () => {
    setIsMediaLibraryOpen(true);
  };

  const handleSelectGpt = (gpt: Gpt) => {
    setActiveGpt(gpt);
    handleNewChat({ preserveGpt: true });
    toast.success(`Usando ${gpt.name}`);
  };

  const handleCreateGpt = () => {
    setEditingGpt(null);
    setIsGptBuilderOpen(true);
  };

  const handleEditGptFromChat = useCallback((gpt: { id: string; name: string; description: string | null; systemPrompt: string }) => {
    if (activeGpt) {
      setEditingGpt(activeGpt);
      setIsGptBuilderOpen(true);
    }
  }, [activeGpt]);

  const { isPinned, pinGpt, unpinGpt } = usePinnedGpts();

  const handleHideGptFromSidebar = async (gptId: string) => {
    try {
      await unpinGpt(gptId);
      toast.success("GPT ocultado de la barra lateral");
    } catch (error) {
      toast.error("Error al ocultar el GPT");
    }
  };

  const handlePinGptToSidebar = async (gptId: string) => {
    try {
      await pinGpt(gptId);
      toast.success("GPT fijado en la barra lateral");
    } catch (error) {
      toast.error("Error al fijar el GPT");
    }
  };

  const handleToggleGptPin = async (gptId: string) => {
    if (isPinned(gptId)) {
      await handleHideGptFromSidebar(gptId);
    } else {
      await handlePinGptToSidebar(gptId);
    }
  };

  const handleAboutGptFromChat = useCallback((gpt: { id: string; name: string; description: string | null }) => {
    setAboutGptId(gpt.id);
  }, []);

  // Keyboard shortcuts
  useKeyboardShortcuts([
    {
      key: "n",
      ctrl: true,
      description: "Nuevo chat",
      action: () => handleNewChat(),
    },
    {
      key: "k",
      ctrl: true,
      description: "Búsqueda rápida",
      action: () => setIsSearchOpen(true),
    },
    {
      key: ",",
      ctrl: true,
      description: "Configuración",
      action: () => setIsSettingsOpen(true),
    },
    {
      key: "e",
      ctrl: true,
      description: "Exportar chat",
      action: () => {
        if (activeChat || currentMessages.length > 0) {
          setIsExportOpen(true);
        }
      },
    },
    {
      key: "/",
      ctrl: true,
      description: "Mostrar atajos",
      action: () => setIsShortcutsOpen(true),
    },
    {
      key: "t",
      ctrl: true,
      description: "Plantillas de prompts",
      action: () => setIsTemplatesOpen(true),
    },
    {
      key: "f",
      ctrl: true,
      shift: true,
      description: "Favoritos",
      action: () => setIsFavoritesOpen(true),
    },
    {
      key: "Escape",
      description: "Cerrar diálogo",
      action: () => {
        setIsSearchOpen(false);
        setIsSettingsOpen(false);
        setIsShortcutsOpen(false);
        setIsExportOpen(false);
        setIsGptExplorerOpen(false);
        setIsLibraryOpen(false);
        setIsMediaLibraryOpen(false);
        setIsFavoritesOpen(false);
        setIsTemplatesOpen(false);
      },
    },
  ]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background relative">
      <OfflineBanner />
      <div className="liquid-blob liquid-blob-1 opacity-30"></div>
      <div className="liquid-blob liquid-blob-2 opacity-20"></div>
      <div className="liquid-blob liquid-blob-3 opacity-25"></div>
      
      {/* Desktop Sidebar - Full */}
      <div className={isSidebarOpen ? "hidden md:block" : "hidden"}>
        <Sidebar 
          chats={chats} 
          hiddenChats={hiddenChats}
          pinnedChats={pinnedChats}
          activeChatId={activeChat?.id || null} 
          onSelectChat={handleSelectChatWithClear} 
          onNewChat={handleNewChat} 
          onToggle={() => setIsSidebarOpen(false)} 
          onDeleteChat={deleteChat}
          onEditChat={editChatTitle}
          onArchiveChat={archiveChat}
          onHideChat={hideChat}
          onPinChat={pinChat}
          onDownloadChat={downloadChat}
          onOpenGpts={handleOpenGpts}
          onOpenApps={handleOpenApps}
          onOpenSkills={handleOpenSkills}
          onOpenLibrary={handleOpenLibrary}
          processingChatIds={processingChatIds}
          pendingResponseCounts={pendingResponseCounts}
          onClearPendingCount={handleClearPendingCount}
          folders={folders}
          onCreateFolder={createFolder}
          onMoveToFolder={handleMoveToFolder}
        />
      </div>

      {/* Desktop Sidebar - Mini (collapsed) */}
      <div className={!isSidebarOpen ? "hidden md:block" : "hidden"}>
        <MiniSidebar 
          onNewChat={handleNewChat}
          onExpand={() => setIsSidebarOpen(true)}
        />
      </div>

      {/* Mobile Sidebar */}
      <div className="md:hidden absolute top-4 left-3 z-50">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="bg-card border border-border rounded-lg mt-[-9px] mb-[-9px] ml-[-5px] mr-[-5px]">
              <Menu className="h-6 w-6 text-foreground" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-[260px]">
            <Sidebar 
              chats={chats} 
              hiddenChats={hiddenChats}
              pinnedChats={pinnedChats}
              activeChatId={activeChat?.id || null} 
              onSelectChat={handleSelectChatWithClear} 
              onNewChat={handleNewChat} 
              onToggle={() => setIsSidebarOpen(!isSidebarOpen)} 
              onDeleteChat={deleteChat}
              onEditChat={editChatTitle}
              onArchiveChat={archiveChat}
              onHideChat={hideChat}
              onPinChat={pinChat}
              onDownloadChat={downloadChat}
              onOpenGpts={handleOpenGpts}
              onOpenApps={handleOpenApps}
              onOpenSkills={handleOpenSkills}
              onOpenLibrary={handleOpenLibrary}
              processingChatIds={processingChatIds}
              pendingResponseCounts={pendingResponseCounts}
              onClearPendingCount={handleClearPendingCount}
              folders={folders}
              onCreateFolder={createFolder}
              onMoveToFolder={handleMoveToFolder}
            />
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full w-full min-h-0">
        {isAppsDialogOpen ? (
          <AppsView 
            onClose={() => setIsAppsDialogOpen(false)}
            onOpenGmail={() => {
              setIsAppsDialogOpen(false);
            }}
          />
        ) : (activeChat || isNewChatMode || chats.length === 0) && (
          <ChatInterface 
            key={chatInterfaceKey} 
            messages={currentMessages}
            setMessages={noopSetMessages}
            onSendMessage={handleSendMessage}
            isSidebarOpen={isSidebarOpen} 
            onToggleSidebar={() => setIsSidebarOpen(true)}
            onCloseSidebar={() => setIsSidebarOpen(false)}
            activeGpt={activeGpt}
            aiState={aiState}
            setAiState={setAiState}
            aiStateChatId={aiStateChatId}
            aiProcessSteps={aiProcessSteps}
            setAiProcessSteps={setAiProcessSteps}
            chatId={activeChat?.id || pendingChatIdRef.current || null}
            onOpenApps={handleOpenApps}
            onUpdateMessageAttachments={updateMessageAttachments}
            onEditMessageAndTruncate={editMessageAndTruncate}
            onTruncateAndReplaceMessage={truncateAndReplaceMessage}
            onTruncateMessagesAt={truncateMessagesAt}
            onNewChat={handleNewChat}
            onEditGpt={handleEditGptFromChat}
            onHideGptFromSidebar={handleHideGptFromSidebar}
            onPinGptToSidebar={handlePinGptToSidebar}
            isGptPinned={isPinned}
            onAboutGpt={handleAboutGptFromChat}
            onPinChat={pinChat}
            onArchiveChat={archiveChat}
            onHideChat={hideChat}
            onDeleteChat={deleteChat}
            onDownloadChat={downloadChat}
            onEditChatTitle={editChatTitle}
            isPinned={activeChat?.pinned === true || activeChat?.pinned === "true"}
            isArchived={activeChat?.archived === true || activeChat?.archived === "true"}
            folders={folders}
            onMoveToFolder={handleMoveToFolder}
            onCreateFolder={createFolder}
            currentFolderId={activeChat?.id ? getFolderForChat(activeChat.id)?.id || null : null}
            uiPhase={uiPhase}
            setUiPhase={setUiPhase}
            activeRunId={activeRunId}
            setActiveRunId={setActiveRunId}
          />
        )}
      </main>

      {/* GPT Explorer Modal */}
      <GptExplorer
        open={isGptExplorerOpen}
        onOpenChange={setIsGptExplorerOpen}
        onSelectGpt={handleSelectGpt}
        onCreateGpt={handleCreateGpt}
      />

      {/* About GPT Dialog */}
      <AboutGptDialog
        open={!!aboutGptId}
        onOpenChange={(open) => !open && setAboutGptId(null)}
        gptId={aboutGptId}
        onSelectGpt={async (gpt) => {
          setAboutGptId(null);
          try {
            const res = await fetch(`/api/gpts/${gpt.id}`);
            if (res.ok) {
              const fullGpt = await res.json();
              handleSelectGpt(fullGpt);
            }
          } catch (error) {
            console.error("Error fetching GPT:", error);
          }
        }}
        onEditGpt={() => {
          if (activeGpt) {
            setAboutGptId(null);
            setEditingGpt(activeGpt);
            setIsGptBuilderOpen(true);
          }
        }}
        onCopyLink={() => {
          if (aboutGptId) {
            navigator.clipboard.writeText(`${window.location.origin}/gpts/${aboutGptId}`);
            toast.success("Enlace copiado al portapapeles");
          }
        }}
      />

      {/* GPT Builder Modal */}
      <GptBuilder
        open={isGptBuilderOpen}
        onOpenChange={setIsGptBuilderOpen}
        editingGpt={editingGpt}
        onSave={() => {
          setIsGptBuilderOpen(false);
          setEditingGpt(null);
        }}
      />

      {/* User Library Modal */}
      <UserLibrary
        open={isLibraryOpen}
        onOpenChange={setIsLibraryOpen}
      />

      {/* Media Library Modal */}
      <MediaLibraryModal
        open={isMediaLibraryOpen}
        onOpenChange={setIsMediaLibraryOpen}
      />

      {/* Search Modal */}
      <SearchModal
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        chats={chats}
        onSelectChat={handleSelectChatWithClear}
      />

      {/* Settings Dialog */}
      <SettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />

      {/* Keyboard Shortcuts Dialog */}
      <KeyboardShortcutsDialog
        open={isShortcutsOpen}
        onOpenChange={setIsShortcutsOpen}
      />

      {/* Export Chat Dialog */}
      <ExportChatDialog
        open={isExportOpen}
        onOpenChange={setIsExportOpen}
        chatTitle={activeChat?.title || "Conversación"}
        messages={currentMessages}
      />

      {/* Favorites Dialog */}
      <FavoritesDialog
        open={isFavoritesOpen}
        onOpenChange={setIsFavoritesOpen}
        favorites={favorites}
        onRemove={removeFavorite}
        onSelect={handleSelectChatWithClear}
      />

      {/* Prompt Templates Dialog */}
      <PromptTemplatesDialog
        open={isTemplatesOpen}
        onOpenChange={setIsTemplatesOpen}
        templates={templates}
        categories={categories}
        onAdd={addTemplate}
        onRemove={removeTemplate}
        onUpdate={updateTemplate}
        onSelect={setPendingPrompt}
        onIncrementUsage={incrementUsage}
      />

    </div>
  );
}
