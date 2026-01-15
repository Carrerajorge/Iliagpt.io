import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useLocation } from "wouter";
import { Sidebar } from "@/components/sidebar";
import { MiniSidebar } from "@/components/mini-sidebar";
import { ChatInterface } from "@/components/chat-interface";
import { AiStepsRail } from "@/components/ai-steps-rail";
import { WorkspaceProvider, useWorkspace } from "@/contexts/workspace-context";
import { useChats, Message } from "@/hooks/use-chats";
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
import { useBackgroundStreamNotifications } from "@/hooks/use-background-stream-notifications";

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
        "group relative flex w-1.5 items-center justify-center bg-transparent transition-colors hover:bg-accent/50 active:bg-accent",
        className
      )}
      {...props}
    >
      <div className="z-10 flex h-8 w-3 items-center justify-center rounded-sm opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>
    </PanelResizeHandle>
  );
}

function WorkspaceContent() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  const isMobile = useIsMobile();
  const { activeDocumentId, setActiveDocument } = useWorkspace();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation("/welcome");
    }
  }, [isAuthenticated, isLoading, setLocation]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(!isMobile);
  const [isAiRailCollapsed, setIsAiRailCollapsed] = useState(false);
  const [isNewChatMode, setIsNewChatMode] = useState(false);
  const [newChatStableKey, setNewChatStableKey] = useState<string | null>(null);

  const [aiState, setAiState] = useState<"idle" | "thinking" | "responding">("idle");
  const [aiProcessSteps, setAiProcessSteps] = useState<{step: string; status: "pending" | "active" | "done"}[]>([]);
  
  // Use global streaming store for tracking processing chats and pending badges
  const processingChatIds = useProcessingChatIds();
  const pendingResponseCounts = usePendingBadges();
  const { clearBadge } = useStreamingStore();

  const pendingChatIdRef = useRef<string | null>(null);

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

  // Background stream notifications with sound
  useBackgroundStreamNotifications(chats, activeChat?.id || null);

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
    // DON'T clear processingChatIdRef or call setAiState("idle") here
    // Let the background streaming complete naturally and trigger badge notification
    // Only reset the process steps for UI
    setAiProcessSteps([]);
  }, [handleClearPendingCount, setActiveChatId, setAiProcessSteps]);

  const handleNewChat = () => {
    // Keep processing state for background chats - don't clear processingChatIds
    // The previous chat will continue streaming in the background
    const newKey = `new-chat-${Date.now()}`;
    setActiveChatId(null);
    setIsNewChatMode(true);
    setNewChatStableKey(newKey);
    pendingChatIdRef.current = null;
    // DON'T clear processingChatIdRef or call setAiState("idle") here
    // Let the background streaming complete naturally and trigger badge notification
    // Only reset the process steps for UI
    setAiProcessSteps([]);
  };

  const handleSendNewChatMessage = useCallback((message: Message) => {
    const { pendingId, stableKey } = createChat();
    pendingChatIdRef.current = pendingId;
    setNewChatStableKey((prev) => prev || stableKey);
    setIsNewChatMode(false);
    addMessage(pendingId, message);
  }, [createChat, addMessage]);

  // IMPORTANT: If targetChatId is provided, use it (for streaming responses that need affinity)
  // Otherwise fall back to current active chat (for new messages from user)
  const handleSendMessage = useCallback(async (message: Message, targetChatId?: string) => {
    const resolvedChatId = targetChatId || activeChat?.id || pendingChatIdRef.current;
    if (resolvedChatId) {
      return await addMessage(resolvedChatId, message);
    } else {
      handleSendNewChatMessage(message);
      return undefined;
    }
  }, [activeChat?.id, addMessage, handleSendNewChatMessage]);

  const chatInterfaceKey = useMemo(() => {
    if (newChatStableKey) return newChatStableKey;
    if (activeChat) return activeChat.stableKey;
    return "default-chat";
  }, [activeChat?.stableKey, newChatStableKey]);

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
      <div className="liquid-blob liquid-blob-1 opacity-30"></div>
      <div className="liquid-blob liquid-blob-2 opacity-20"></div>
      <div className="liquid-blob liquid-blob-3 opacity-25"></div>

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
              key={chatInterfaceKey}
              messages={displayMessages}
              setMessages={setDisplayMessages}
              onSendMessage={handleSendMessage}
              chatId={activeChat?.id || pendingChatIdRef.current}
              aiState={aiState}
              setAiState={setAiState}
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
                <ChatInterface
                  key={chatInterfaceKey}
                  messages={displayMessages}
                  setMessages={setDisplayMessages}
                  onSendMessage={handleSendMessage}
                  chatId={activeChat?.id || pendingChatIdRef.current}
                  aiState={aiState}
                  setAiState={setAiState}
                  aiProcessSteps={aiProcessSteps}
                  setAiProcessSteps={setAiProcessSteps}
                />
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
