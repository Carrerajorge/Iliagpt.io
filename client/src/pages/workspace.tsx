import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useLocation } from "wouter";
import { Sidebar } from "@/components/sidebar";
import { MiniSidebar } from "@/components/mini-sidebar";
import { ChatInterface } from "@/components/chat-interface";
import { AiStepsRail } from "@/components/ai-steps-rail";
import { WorkspaceProvider, useWorkspace } from "@/contexts/workspace-context";
import { useChats, Message, generateStableChatKey, resolveRealChatId } from "@/hooks/use-chats";
import { useChatFolders } from "@/hooks/use-chat-folders";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu, FileText, X, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { useStreamingStore, useProcessingChatIds, usePendingBadges } from "@/stores/streamingStore";
import { resolveConversationUiStateKey } from "@/lib/conversationUiState";
import type { AIState, AiProcessStep } from "@/components/chat-interface/types";

const PANEL_SIZES_KEY = "workspace-panel-sizes";

interface StoredPanelSizes {
  sidebar: number;
  main: number;
  aiRail: number;
  chat: number;
  document: number;
}

const defaultSizes: StoredPanelSizes = {
  sidebar: 20,
  main: 60,
  aiRail: 20,
  chat: 60,
  document: 40,
};

function ResizeHandle({ className, ...props }: { className?: string; id?: string }) {
  return (
    <PanelResizeHandle
      className={cn(
        "group relative flex w-1.5 items-center justify-center bg-transparent transition-colors hover:bg-[#A5A0FF]/20 active:bg-[#A5A0FF]/30",
        className
      )}
      {...props}
    >
      <div className="z-10 flex h-12 w-1 items-center justify-center rounded-full bg-[#A5A0FF]/50 opacity-0 group-hover:opacity-100 transition-all duration-300 shadow-[0_0_8px_rgba(165,160,255,0.4)]">
      </div>
    </PanelResizeHandle>
  );
}

function WorkspaceContent() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading, isReady } = useAuth();
  const isMobile = useIsMobile();
  const { activeDocumentId, setActiveDocument } = useWorkspace();

  useEffect(() => {
    if (isReady && !isLoading && !isAuthenticated) {
      setLocation("/welcome");
    }
  }, [isAuthenticated, isLoading, isReady, setLocation]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(!isMobile);
  const [isAiRailCollapsed, setIsAiRailCollapsed] = useState(false);
  const [isNewChatMode, setIsNewChatMode] = useState(false);
  const [newChatStableKey, setNewChatStableKey] = useState<string | null>(null);

  type WorkspaceConversationUiState = {
    aiState: AIState;
    aiProcessSteps: AiProcessStep[];
    pendingRequestId: string | null;
    streamBuffer: string;
  };

  const createWorkspaceConversationUiState = (): WorkspaceConversationUiState => ({
    aiState: "idle",
    aiProcessSteps: [],
    pendingRequestId: null,
    streamBuffer: "",
  });

  const [conversationUiStateMap, setConversationUiStateMap] = useState<Record<string, WorkspaceConversationUiState>>({});

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
  } = useChats();

  // Use global streaming store for tracking processing chats and pending badges
  const processingChatIds = useProcessingChatIds();
  const pendingResponseCounts = usePendingBadges();
  const { clearBadge } = useStreamingStore();

  const pendingChatIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeChat?.id) return;
    if (newChatStableKey) return;
    setNewChatStableKey(generateStableChatKey());
  }, [activeChat?.id, newChatStableKey]);

  const ensureConversationUiState = useCallback((conversationId: string | null | undefined) => {
    if (!conversationId) return;
    setConversationUiStateMap((prev) => {
      if (prev[conversationId]) return prev;
      return { ...prev, [conversationId]: createWorkspaceConversationUiState() };
    });
  }, []);

  const moveConversationUiState = useCallback((fromConversationId?: string | null, toConversationId?: string | null) => {
    if (!fromConversationId || !toConversationId || fromConversationId === toConversationId) return;
    setConversationUiStateMap((prev) => {
      const sourceState = prev[fromConversationId];
      if (!sourceState) return prev;
      const { [fromConversationId]: _, ...rest } = prev;
      if (rest[toConversationId]) return rest;
      return { ...rest, [toConversationId]: sourceState };
    });
  }, []);

  const activeConversationId = useMemo(() => {
    if (activeChat?.id) return activeChat.id;
    if (pendingChatIdRef.current) return pendingChatIdRef.current;
    if (isNewChatMode && newChatStableKey) return newChatStableKey;
    return null;
  }, [activeChat?.id, isNewChatMode, newChatStableKey]);

  useEffect(() => {
    ensureConversationUiState(activeConversationId);
  }, [activeConversationId, ensureConversationUiState]);

  const activeConversationState = activeConversationId
    ? conversationUiStateMap[activeConversationId]
    : undefined;

  const aiState: AIState = activeConversationState?.aiState || "idle";
  const aiProcessSteps: AiProcessStep[] = activeConversationState?.aiProcessSteps || [];

  const setAiState = useCallback((nextState: React.SetStateAction<AIState>, conversationId?: string | null) => {
    setConversationUiStateMap((prev) => {
      const targetConversationId = resolveConversationUiStateKey({
        requestedConversationId: conversationId,
        activeConversationId,
        pendingConversationId: pendingChatIdRef.current,
        draftConversationId: newChatStableKey,
        existingConversationIds: Object.keys(prev),
        resolveConversationId: resolveRealChatId,
      });
      if (!targetConversationId) return prev;
      const current = prev[targetConversationId] || createWorkspaceConversationUiState();
      const resolvedState = typeof nextState === "function"
        ? (nextState as (prev: AIState) => AIState)(current.aiState)
        : nextState;
      return {
        ...prev,
        [targetConversationId]: {
          ...current,
          aiState: resolvedState,
          aiProcessSteps: resolvedState === "idle" ? [] : current.aiProcessSteps,
        },
      };
    });
  }, [activeConversationId, newChatStableKey]);

  const setAiProcessSteps = useCallback((nextSteps: React.SetStateAction<AiProcessStep[]>, conversationId?: string | null) => {
    setConversationUiStateMap((prev) => {
      const targetConversationId = resolveConversationUiStateKey({
        requestedConversationId: conversationId,
        activeConversationId,
        pendingConversationId: pendingChatIdRef.current,
        draftConversationId: newChatStableKey,
        existingConversationIds: Object.keys(prev),
        resolveConversationId: resolveRealChatId,
      });
      if (!targetConversationId) return prev;
      const current = prev[targetConversationId] || createWorkspaceConversationUiState();
      const resolvedSteps = typeof nextSteps === "function"
        ? (nextSteps as (prev: AiProcessStep[]) => AiProcessStep[])(current.aiProcessSteps)
        : nextSteps;
      return {
        ...prev,
        [targetConversationId]: {
          ...current,
          aiProcessSteps: resolvedSteps,
        },
      };
    });
  }, [activeConversationId, newChatStableKey]);

  const [panelSizes, setPanelSizes] = useState<StoredPanelSizes>(() => {
    try {
      const stored = localStorage.getItem(PANEL_SIZES_KEY);
      if (stored) {
        return { ...defaultSizes, ...JSON.parse(stored) };
      }
    } catch {
      // ignore
    }
    return defaultSizes;
  });

  const savePanelSizes = useCallback((sizes: Partial<StoredPanelSizes>) => {
    setPanelSizes((prev) => {
      const updated = { ...prev, ...sizes };
      try {
        localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  }, []);



  const {
    folders,
    createFolder,
    moveChatToFolder,
    removeChatFromFolder,
  } = useChatFolders();

  const handleMoveToFolder = useCallback((chatId: string, folderId: string | null) => {
    if (folderId === null) {
      removeChatFromFolder(chatId);
    } else {
      moveChatToFolder(chatId, folderId);
    }
  }, [moveChatToFolder, removeChatFromFolder]);

  const handleClearPendingCount = useCallback((chatId: string) => {
    clearBadge(chatId);
  }, [clearBadge]);

  const handleSelectChatWithClear = useCallback((id: string) => {
    // Keep processing state for background chats - don't clear processingChatIds
    // This allows multiple chats to process simultaneously
    handleClearPendingCount(id);
    setIsNewChatMode(false);
    setNewChatStableKey(null);
    setActiveChatId(id);
  }, [handleClearPendingCount, setActiveChatId]);

  const handleNewChat = () => {
    // Keep processing state for background chats - don't clear processingChatIds
    // The previous chat will continue streaming in the background
    const newKey = generateStableChatKey();
    setActiveChatId(null);
    setIsNewChatMode(true);
    setNewChatStableKey(newKey);
    ensureConversationUiState(newKey);
    pendingChatIdRef.current = null;
  };

  const handleSendNewChatMessage = useCallback(async (message: Message) => {
    const { pendingId, stableKey } = createChat(newChatStableKey);
    moveConversationUiState(newChatStableKey, pendingId);
    ensureConversationUiState(pendingId);
    pendingChatIdRef.current = pendingId;
    setNewChatStableKey((prev) => prev || stableKey);
    setIsNewChatMode(false);
    // IMPORTANT: return the promise so ChatInterface can await it and continue the flow
    const result = await addMessage(pendingId, message);
    const realId = result?.run?.chatId || (result ? resolveRealChatId(pendingId) : null);
    if (realId && !realId.startsWith("pending-")) {
      moveConversationUiState(pendingId, realId);
    }
    return result;
  }, [addMessage, createChat, ensureConversationUiState, moveConversationUiState, newChatStableKey]);

  const handleSendMessage = useCallback(async (message: Message) => {
    const targetChatId = activeChat?.id || pendingChatIdRef.current;
    if (targetChatId) {
      return await addMessage(targetChatId, message);
    }
    return await handleSendNewChatMessage(message);
  }, [activeChat?.id, addMessage, handleSendNewChatMessage]);

  const currentMessages = useMemo(() => {
    if (activeChat?.messages) return activeChat.messages;
    const pendingId = pendingChatIdRef.current;
    if (pendingId) {
      const pendingChat = chats.find((c) => c.id === pendingId);
      if (pendingChat?.messages) return pendingChat.messages;
    }
    return [];
  }, [activeChat?.messages, chats]);

  // Local messages state for agent mode updates (syncs with currentMessages)
  const [displayMessages, setDisplayMessages] = useState<Message[]>([]);

  // Sync displayMessages with currentMessages when it changes
  useEffect(() => {
    setDisplayMessages(currentMessages);
  }, [currentMessages]);

  useKeyboardShortcuts([
    {
      key: "n",
      ctrl: true,
      description: "Nuevo chat",
      action: () => handleNewChat(),
    },
    {
      key: "b",
      ctrl: true,
      description: "Alternar barra lateral",
      action: () => setIsSidebarOpen((prev) => !prev),
    },
  ]);

  const sidebarContent = (
    <Sidebar
      chats={chats}
      hiddenChats={hiddenChats}
      pinnedChats={pinnedChats}
      activeChatId={activeChat?.id || null}
      onSelectChat={handleSelectChatWithClear}
      onNewChat={handleNewChat}
      onToggle={() => setIsSidebarOpen(false)}
      onDeleteChat={(id, e) => {
        e.stopPropagation();
        deleteChat(id);
      }}
      onEditChat={editChatTitle}
      onArchiveChat={(id, e) => {
        e.stopPropagation();
        archiveChat(id);
      }}
      onHideChat={(id, e) => {
        e.stopPropagation();
        hideChat(id);
      }}
      onPinChat={(id, e) => {
        e.stopPropagation();
        pinChat(id);
      }}
      onDownloadChat={(id, e) => {
        e.stopPropagation();
        downloadChat(id);
      }}
      processingChatIds={processingChatIds}
      pendingResponseCounts={pendingResponseCounts}
      onClearPendingCount={handleClearPendingCount}
      folders={folders}
      onCreateFolder={createFolder}
      onMoveToFolder={handleMoveToFolder}
    />
  );

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background relative" data-testid="workspace-container">
      <div className="liquid-blob liquid-blob-1 opacity-[0.07] dark:opacity-[0.05]"></div>
      <div className="liquid-blob liquid-blob-2 opacity-[0.05] dark:opacity-[0.03]"></div>
      <div className="liquid-blob liquid-blob-3 opacity-[0.06] dark:opacity-[0.04]"></div>

      {isMobile ? (
        <>
          <Sheet open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="fixed top-4 left-4 z-50 md:hidden"
                data-testid="button-open-sidebar-mobile"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-80">
              {sidebarContent}
            </SheetContent>
          </Sheet>

          <div className="flex-1 flex flex-col">
            <ChatInterface
              messages={displayMessages}
              setMessages={setDisplayMessages}
              onSendMessage={handleSendMessage}
              chatId={activeChat?.id || pendingChatIdRef.current}
              conversationLockScope={activeChat?.stableKey || newChatStableKey || null}
              aiState={aiState}
              setAiState={setAiState}
              aiStateChatId={aiState === "idle" ? null : activeConversationId}
              aiProcessSteps={aiProcessSteps}
              setAiProcessSteps={setAiProcessSteps}
            />
          </div>
        </>
      ) : (
        <PanelGroup
          direction="horizontal"
          onLayout={(sizes) => {
            if (sizes.length >= 3) {
              savePanelSizes({
                sidebar: sizes[0],
                main: sizes[1],
                aiRail: sizes[2],
              });
            }
          }}
          data-testid="workspace-panel-group"
        >
          {isSidebarOpen ? (
            <>
              <Panel
                defaultSize={panelSizes.sidebar}
                minSize={15}
                maxSize={30}
                id="sidebar-panel"
                data-testid="panel-sidebar"
              >
                {sidebarContent}
              </Panel>
              <ResizeHandle id="sidebar-resize" />
            </>
          ) : (
            <div className="flex-shrink-0">
              <MiniSidebar
                onNewChat={handleNewChat}
                onExpand={() => setIsSidebarOpen(true)}
              />
            </div>
          )}

          <Panel
            defaultSize={isSidebarOpen ? panelSizes.main : 80}
            minSize={40}
            id="main-panel"
            data-testid="panel-main"
          >
            <PanelGroup
              direction="vertical"
              onLayout={(sizes) => {
                if (sizes.length >= 2) {
                  savePanelSizes({
                    chat: sizes[0],
                    document: sizes[1],
                  });
                }
              }}
            >
              <Panel
                defaultSize={activeDocumentId ? panelSizes.chat : 100}
                minSize={30}
                id="chat-panel"
                data-testid="panel-chat"
              >
                <div className="relative h-full">
                  <ChatInterface
                    messages={displayMessages}
                    setMessages={setDisplayMessages}
                    onSendMessage={handleSendMessage}
                    chatId={activeChat?.id || pendingChatIdRef.current}
                    conversationLockScope={activeChat?.stableKey || newChatStableKey || null}
                    aiState={aiState}
                    setAiState={setAiState}
                    aiStateChatId={aiState === "idle" ? null : activeConversationId}
                    aiProcessSteps={aiProcessSteps}
                    setAiProcessSteps={setAiProcessSteps}
                  />
                </div>
              </Panel>

              {activeDocumentId && (
                <>
                  <PanelResizeHandle className="h-1.5 bg-transparent hover:bg-accent/50 active:bg-accent transition-colors flex items-center justify-center">
                    <div className="w-8 h-1 rounded-full bg-muted-foreground/20" />
                  </PanelResizeHandle>
                  <Panel
                    defaultSize={panelSizes.document}
                    minSize={20}
                    id="document-panel"
                    data-testid="panel-document"
                  >
                    <div className="h-full flex flex-col bg-background border-t">
                      <div className="flex items-center justify-between px-4 py-2 border-b">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Documento</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setActiveDocument(null)}
                          data-testid="button-close-document"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex-1 flex items-center justify-center text-muted-foreground">
                        <p className="text-sm">Vista previa del documento</p>
                      </div>
                    </div>
                  </Panel>
                </>
              )}
            </PanelGroup>
          </Panel>

          <ResizeHandle id="ai-rail-resize" />

          <Panel
            defaultSize={isAiRailCollapsed ? 3 : panelSizes.aiRail}
            minSize={0}
            maxSize={35}
            collapsible
            collapsedSize={3}
            onCollapse={() => setIsAiRailCollapsed(true)}
            onExpand={() => setIsAiRailCollapsed(false)}
            id="ai-rail-panel"
            data-testid="panel-ai-rail"
          >
            <AiStepsRail
              isCollapsed={isAiRailCollapsed}
              onToggle={() => setIsAiRailCollapsed((prev) => !prev)}
            />
          </Panel>
        </PanelGroup>
      )}
    </div>
  );
}

export default function Workspace() {
  return (
    <WorkspaceProvider>
      <WorkspaceContent />
    </WorkspaceProvider>
  );
}
