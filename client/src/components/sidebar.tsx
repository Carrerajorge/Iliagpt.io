
import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { usePinnedGpts } from "@/hooks/use-pinned-gpts";
import {
  Search,
  Library,
  Bot,
  Plus,
  Code,
  MessageSquare,
  MoreHorizontal,
  Settings,
  PanelLeftClose,
  ChevronDown,
  ChevronRight,
  User,
  CreditCard,
  Shield,
  LogOut,
  Trash2,
  Pencil,
  Archive,
  EyeOff,
  Eye,
  Check,
  X,
  Monitor,
  LayoutGrid,
  FolderPlus,
  Folder,
  FolderOpen,
  Zap,
  SquarePen,
  Pin,
  Download,
  MoveRight,
  Brain,
  Megaphone,
  MessageCircle,
  SlidersHorizontal,
  Home,
} from "lucide-react";
import { IliaGPTLogo } from "@/components/iliagpt-logo";
import { OpenClawLogo } from "@/components/openclaw-panel";
import { cn } from "@/lib/utils";
import { isAdminUser } from "@/lib/admin";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SearchModal } from "@/components/search-modal";
import { SettingsDialog } from "@/components/settings-dialog";

import { Chat } from "@/hooks/use-chats";
import { useWhatsAppWebStatus } from "@/hooks/use-whatsapp-web";
import { Folder as FolderType } from "@/hooks/use-chat-folders";
import { diffZonedDays, formatZonedDate, getZonedDateParts, normalizeTimeZone } from "@/lib/platformDateTime";
import { DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal } from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { NewChatButton } from "@/components/chat/NewChatButton";
import { useProcessingChatIds, useChatStreamContent } from "@/stores/streamingStore";
import { CreateProjectModal, type CreateProjectData } from "@/components/create-project-modal";
import { EditProjectModal } from "@/components/edit-project-modal";
import { ProjectMemoriesModal } from "@/components/project-memories-modal";
import { ShareProjectModal } from "@/components/share-project-modal";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { useProjects, type Project } from "@/hooks/use-projects";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";

interface SidebarProps {
  className?: string;
  chats: Chat[];
  hiddenChats?: Chat[];
  pinnedChats?: Chat[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat?: () => void;
  onToggle?: () => void;
  onDeleteChat?: (id: string, e: React.MouseEvent) => void;
  onEditChat?: (id: string, newTitle: string) => void;
  onArchiveChat?: (id: string, e: React.MouseEvent) => void;
  onHideChat?: (id: string, e: React.MouseEvent) => void;
  onPinChat?: (id: string, e: React.MouseEvent) => void;
  onDownloadChat?: (id: string, e: React.MouseEvent) => void;
  onOpenGpts?: () => void;
  onOpenApps?: () => void;
  onOpenSkills?: () => void;
  onOpenWhatsAppConnect?: () => void;
  onOpenCodex?: () => void;
  onOpenLibrary?: () => void;
  onOpenOpenClaw?: () => void;
  processingChatIds?: string[];
  pendingResponseCounts?: Record<string, number>;
  onClearPendingCount?: (chatId: string) => void;
  folders?: FolderType[];
  onCreateFolder?: (name: string) => void;
  onMoveToFolder?: (chatId: string, folderId: string | null) => void;
  selectedProjectId?: string | null;
  onSelectProject?: (projectId: string) => void;
}

/**
 * Enhanced streaming indicator with animated progress ring
 * Shows visual progress as content streams in
 */
function StreamingProgressIndicator({ chatId }: { chatId: string }) {
  const content = useChatStreamContent(chatId);
  const contentLength = content?.length || 0;

  // Estimate progress based on typical response length (~2000 chars)
  const estimatedTotal = 2000;
  const progress = Math.min(contentLength / estimatedTotal, 0.95);
  const circumference = 2 * Math.PI * 6; // radius = 6
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <div className="relative h-5 w-5 flex-shrink-0" title={`${Math.round(progress * 100)}% cargado`}>
      {/* Background circle */}
      <svg className="h-5 w-5 -rotate-90" viewBox="0 0 16 16">
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-muted-foreground/20"
        />
        {/* Progress arc */}
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="url(#progress-gradient)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="transition-all duration-300"
        />
        <defs>
          <linearGradient id="progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(228, 97%, 50%)" />
            <stop offset="100%" stopColor="hsl(260, 97%, 55%)" />
          </linearGradient>
        </defs>
      </svg>
      {/* Pulsing center dot */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
      </div>
    </div>
  );
}

function ChatSpinner() {
  return (
    <svg
      className="h-4 w-4 flex-shrink-0"
      fill="hsl(228, 97%, 42%)"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g>
        <circle cx="12" cy="3" r="1">
          <animate id="spinner_7Z73" begin="0;spinner_tKsu.end-0.5s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73" />
        </circle>
        <circle cx="16.50" cy="4.21" r="1">
          <animate id="spinner_Wd87" begin="spinner_7Z73.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73" />
        </circle>
        <circle cx="7.50" cy="4.21" r="1">
          <animate id="spinner_tKsu" begin="spinner_tVVl.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73" />
        </circle>
        <circle cx="19.79" cy="7.50" r="1">
          <animate id="spinner_5L0R" begin="spinner_Wd87.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73" />
        </circle>
        <circle cx="4.21" cy="7.50" r="1">
          <animate id="spinner_tVVl" begin="spinner_u6j3.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73" />
        </circle>
        <circle cx="21.00" cy="12.00" r="1">
          <animate id="spinner_JSUN" begin="spinner_5L0R.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73" />
        </circle>
        <circle cx="3.00" cy="12.00" r="1">
          <animate id="spinner_u6j3" begin="spinner_YHwI.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73" />
        </circle>
        <circle cx="19.79" cy="16.50" r="1">
          <animate id="spinner_GKXF" begin="spinner_JSUN.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73" />
        </circle>
        <circle cx="4.21" cy="16.50" r="1">
          <animate id="spinner_YHwI" begin="spinner_xGMk.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73" />
        </circle>
        <circle cx="16.50" cy="19.79" r="1">
          <animate id="spinner_pMgl" begin="spinner_GKXF.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73" />
        </circle>
        <circle cx="7.50" cy="19.79" r="1">
          <animate id="spinner_xGMk" begin="spinner_pMgl.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73" />
        </circle>
        <circle cx="12" cy="21" r="1">
          <animate begin="spinner_xGMk.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73" />
        </circle>
      </g>
    </svg>
  );
}

export function Sidebar({
  className,
  chats,
  hiddenChats = [],
  pinnedChats = [],
  activeChatId,
  onSelectChat,
  onNewChat,
  onToggle,
  onDeleteChat,
  onEditChat,
  onArchiveChat,
  onHideChat,
  onPinChat,
  onDownloadChat,
  onOpenGpts,
  onOpenApps,
  onOpenSkills,
  onOpenWhatsAppConnect,
  onOpenCodex,
  onOpenLibrary,
  onOpenOpenClaw,
  processingChatIds = [],
  pendingResponseCounts = {},
  onClearPendingCount,
  folders = [],
  onCreateFolder,
  onMoveToFolder,
  selectedProjectId,
  onSelectProject
}: SidebarProps) {
  const [, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const isAdmin = isAdminUser(user as any);
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;
  const appName = platformSettings.app_name || "iliagpt";
  const appDescription = platformSettings.app_description || "AI Platform";
  const { pinnedGpts, unpinGpt } = usePinnedGpts();
  const { status: waStatus } = useWhatsAppWebStatus(true);
  const handleLogout = () => {
    logout();
  };
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [memoriesProject, setMemoriesProject] = useState<Project | null>(null);
  const [shareProject, setShareProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);

  // Projects hook for project folder management
  const { projects, createProject, deleteProject, updateProject, addChatToProject, getProjectForChat } = useProjects();

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const handleCreateFolder = () => {
    if (newFolderName.trim() && onCreateFolder) {
      onCreateFolder(newFolderName.trim());
      setNewFolderName("");
      setIsCreatingFolder(false);
    }
  };

  const allFolderChatIds = new Set(folders.flatMap(f => f.chatIds));
  const unfolderedChats = chats.filter(chat => !allFolderChatIds.has(chat.id));

  const handleStartEdit = (chat: Chat, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditTitle(chat.title);
  };

  const handleSaveEdit = (chatId: string) => {
    if (onEditChat && editTitle.trim()) {
      onEditChat(chatId, editTitle.trim());
    }
    setEditingChatId(null);
    setEditTitle("");
  };

  const handleCancelEdit = () => {
    setEditingChatId(null);
    setEditTitle("");
  };

  const getChatDateLabel = (timestamp: number) => {
    const now = Date.now();
    const diff = diffZonedDays(timestamp, now, platformTimeZone);

    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff !== null && diff > 1 && diff < 7) return "Previous 7 Days";

    const parts = getZonedDateParts(timestamp, platformTimeZone);
    const nowParts = getZonedDateParts(now, platformTimeZone);
    if (parts && nowParts && parts.year === nowParts.year) {
      return formatZonedDate(timestamp, {
        timeZone: platformTimeZone,
        dateFormat: platformDateFormat,
        includeYear: false,
      });
    }

    return parts ? String(parts.year) : "";
  };

  // Group unfoldered chats
  const groupedChats = unfolderedChats.reduce((groups, chat) => {
    const label = getChatDateLabel(chat.timestamp);
    if (!groups[label]) groups[label] = [];
    groups[label].push(chat);
    return groups;
  }, {} as Record<string, Chat[]>);

  const renderChatItem = (chat: Chat, indented = false) => (
    <div
      key={chat.id}
      className={cn(
        "group relative flex w-full items-center px-1.5 py-1 rounded-md cursor-pointer hover:bg-accent/40 active:bg-accent active:scale-[0.98] transition-all duration-75 select-none",
        activeChatId === chat.id && "bg-accent text-accent-foreground",
        chat.archived && "opacity-60",
        indented && "ml-0"
      )}
      style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
      onClick={() => !editingChatId && onSelectChat(chat.id)}
      data-testid={`chat-item-${chat.id}`}
    >
      {editingChatId === chat.id ? (
        <div className="flex w-full items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="h-6 text-xs flex-1" autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(chat.id); if (e.key === "Escape") handleCancelEdit(); }}
            data-testid={`input-edit-chat-${chat.id}`} />
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleSaveEdit(chat.id)} data-testid={`button-save-edit-${chat.id}`}><Check className="h-2.5 w-2.5 text-green-500" /></Button>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleCancelEdit} data-testid={`button-cancel-edit-${chat.id}`}><X className="h-2.5 w-2.5 text-red-500" /></Button>
        </div>
      ) : (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Chat options" className="shrink-0 p-0.5 rounded hover:bg-accent transition-opacity mr-1"
                onClick={(e) => e.stopPropagation()} data-testid={`button-chat-menu-${chat.id}`}>
                <span className="text-muted-foreground/60 text-xs leading-none">···</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52" sideOffset={5}>
              <DropdownMenuItem
                onClick={(e) => onPinChat?.(chat.id, e as unknown as React.MouseEvent)}
                data-testid={`menu - pin - ${chat.id} `}
              >
                <Pin className="h-4 w-4 mr-2" />
                {chat.pinned ? "Desfijar" : "Fijar chat"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => handleStartEdit(chat, e as unknown as React.MouseEvent)}
                data-testid={`menu - edit - ${chat.id} `}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger data-testid={`menu - move - folder - ${chat.id} `}>
                  <Folder className="h-4 w-4 mr-2" />
                  Mover a carpeta
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    {/* Create new folder option */}
                    <DropdownMenuItem
                      onClick={() => setIsCreatingFolder(true)}
                      data-testid={`menu - create - folder - ${chat.id} `}
                    >
                      <FolderPlus className="h-4 w-4 mr-2" />
                      Crear carpeta
                    </DropdownMenuItem>

                    {/* Show existing projects as folder options */}
                    {projects.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <p className="px-2 py-1.5 text-xs text-muted-foreground font-medium">Proyectos</p>
                        {projects.map((project) => {
                          const isInThisProject = project.chatIds.includes(chat.id);
                          return (
                            <DropdownMenuItem
                              key={project.id}
                              onClick={() => {
                                if (isInThisProject) {
                                  // Remove from this project
                                  const updatedChatIds = project.chatIds.filter(id => id !== chat.id);
                                  updateProject(project.id, { chatIds: updatedChatIds });
                                } else {
                                  // Add to this project
                                  addChatToProject(chat.id, project.id);
                                }
                              }}
                              data-testid={`menu - project - ${project.id} -${chat.id} `}
                            >
                              <span
                                className="h-3 w-3 rounded-full mr-2 flex-shrink-0"
                                ref={(el) => { if (el) el.style.backgroundColor = project.color; }}
                              />
                              <div className="flex-1 overflow-hidden" dir="rtl">{project.name}</div>
                              {isInThisProject && <Check className="h-4 w-4 ml-2 text-green-500" />}
                            </DropdownMenuItem>
                          );
                        })}
                      </>
                    )}

                    {/* Also show chat folders if any exist */}
                    {folders.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <p className="px-2 py-1.5 text-xs text-muted-foreground font-medium">Carpetas</p>
                        {folders.map((folder) => (
                          <DropdownMenuItem
                            key={folder.id}
                            onClick={() => onMoveToFolder?.(chat.id, folder.id)}
                            data-testid={`menu - folder - ${folder.id} -${chat.id} `}
                          >
                            <span
                              className="h-3 w-3 rounded-full mr-2 flex-shrink-0"
                              ref={(el) => { if (el) el.style.backgroundColor = folder.color; }}
                            />
                            {folder.name}
                          </DropdownMenuItem>
                        ))}
                        {allFolderChatIds.has(chat.id) && (
                          <DropdownMenuItem
                            onClick={() => onMoveToFolder?.(chat.id, null)}
                            data-testid={`menu - remove - folder - ${chat.id} `}
                          >
                            <X className="h-4 w-4 mr-2" />
                            Quitar de carpeta
                          </DropdownMenuItem>
                        )}
                      </>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              <DropdownMenuItem
                onClick={(e) => onDownloadChat?.(chat.id, e as unknown as React.MouseEvent)}
                data-testid={`menu - download - ${chat.id} `}
              >
                <Download className="h-4 w-4 mr-2" />
                Descargar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => onArchiveChat?.(chat.id, e as unknown as React.MouseEvent)}
                data-testid={`menu - archive - ${chat.id} `}
              >
                <Archive className="h-4 w-4 mr-2" />
                {chat.archived ? "Desarchivar" : "Archivar"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => onHideChat?.(chat.id, e as unknown as React.MouseEvent)}
                data-testid={`menu - hide - ${chat.id} `}
              >
                {chat.hidden ? <Eye className="h-4 w-4 mr-2" /> : <EyeOff className="h-4 w-4 mr-2" />}
                {chat.hidden ? "Mostrar" : "Ocultar"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  setDeletingChatId(chat.id);
                }}
                className="text-red-500 focus:text-red-500"
                data-testid={`menu - delete -${chat.id} `}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
            {chat.archived && <Archive className="h-2.5 w-2.5 text-muted-foreground shrink-0" />}
            {chat.id.startsWith('wa_') && <MessageCircle className="h-3 w-3 text-green-500 shrink-0" />}
            <span className="truncate text-[12px] cursor-default">{chat.title}</span>
            {processingChatIds.includes(chat.id) && <StreamingProgressIndicator chatId={chat.id} />}
            {!processingChatIds.includes(chat.id) && pendingResponseCounts[chat.id] > 0 && (
              <span className="flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-blue-600 text-white text-[9px] font-medium shrink-0" data-testid={`badge-pending-${chat.id}`}>
                {pendingResponseCounts[chat.id]}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );

  // Order of groups
  const groupOrder = ["Today", "Yesterday", "Previous 7 Days"];
  // Add other dynamic keys that might appear
  Object.keys(groupedChats).forEach(key => {
    if (!groupOrder.includes(key)) groupOrder.push(key);
  });

  return (
    <nav
      className={cn("flex h-screen w-[260px] flex-col bg-[#fafafa] dark:bg-[#111113] border-r border-border/40 text-sidebar-foreground", className)}
      aria-label="Navegación principal y chats"
      role="navigation"
    >
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2 min-w-0 cursor-pointer" onClick={() => setLocation("/")} data-testid="button-go-home">
          <IliaGPTLogo size={28} className="shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-bold tracking-tight truncate">{appName}</span>
            <span className="text-[10px] text-muted-foreground/60 leading-none">AI Platform</span>
          </div>
          {isAdmin && platformSettings.maintenance_mode && (
            <span className="shrink-0 rounded bg-amber-500/15 text-amber-600 px-1 py-px text-[9px] font-medium">MAINT</span>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md" onClick={onToggle} data-testid="button-toggle-sidebar">
          <PanelLeftClose className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>

      <div className="px-3 pb-2">
        <Button
          className="w-full justify-start gap-2 h-9 text-sm font-medium bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 text-white rounded-lg shadow-sm"
          onClick={onNewChat}
          data-testid="button-new-chat"
        >
          <SquarePen className="h-4 w-4" />
          Nuevo chat
          <span className="ml-auto text-[10px] bg-white/20 rounded px-1 py-0.5 font-mono">KN</span>
        </Button>
      </div>

      <div className="px-3 pb-2">
        <Button
          ref={searchButtonRef}
          variant="ghost"
          className="w-full justify-start gap-2 px-2.5 h-8 text-xs text-muted-foreground hover:text-foreground rounded-md border border-border/30 bg-background/50"
          onClick={() => setIsSearchModalOpen(true)}
          data-testid="button-search-chats"
        >
          <Search className="h-3.5 w-3.5" />
          Buscar chats...
          <span className="ml-auto text-[10px] text-muted-foreground/50 font-mono">⌘ K</span>
        </Button>
      </div>

      <div className="px-3 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">Herramientas</span>
      </div>
      <div className="flex flex-col gap-0.5 px-2 pb-2">
        <button onClick={onOpenLibrary} className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-accent/60 active:bg-accent active:scale-[0.98] transition-all duration-75 text-sm text-foreground/80 hover:text-foreground cursor-pointer select-none" style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }} data-testid="button-library">
          <Library className="h-4 w-4 text-violet-500 shrink-0 pointer-events-none" />
          <span className="pointer-events-none">Biblioteca</span>
        </button>
        <button onClick={onOpenGpts} className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-accent/60 active:bg-accent active:scale-[0.98] transition-all duration-75 text-sm text-foreground/80 hover:text-foreground cursor-pointer select-none" style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }} data-testid="button-gpts">
          <Bot className="h-4 w-4 text-amber-500 shrink-0 pointer-events-none" />
          <span className="pointer-events-none">GPTs</span>
        </button>
        <button onClick={() => window.open("/openclaw", "_blank", "noopener")} className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-accent/60 active:bg-accent active:scale-[0.98] transition-all duration-75 text-sm text-foreground/80 hover:text-foreground cursor-pointer select-none" style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }} data-testid="button-openclaw">
          <OpenClawLogo className="h-4 w-4 shrink-0 pointer-events-none" />
          <span className="pointer-events-none">OpenClaw</span>
        </button>
        <button onClick={onOpenSkills} className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-accent/60 active:bg-accent active:scale-[0.98] transition-all duration-75 text-sm text-foreground/80 hover:text-foreground cursor-pointer select-none" style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }} data-testid="button-skills">
          <Zap className="h-4 w-4 text-blue-500 shrink-0 pointer-events-none" />
          <span className="pointer-events-none">Skills</span>
        </button>
        <button onClick={onOpenApps} className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-accent/60 active:bg-accent active:scale-[0.98] transition-all duration-75 text-sm text-foreground/80 hover:text-foreground cursor-pointer select-none" style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }} data-testid="button-apps">
          <LayoutGrid className="h-4 w-4 text-emerald-500 shrink-0 pointer-events-none" />
          <span className="pointer-events-none">Aplicaciones</span>
        </button>
        <button onClick={onOpenWhatsAppConnect} className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-accent/60 active:bg-accent active:scale-[0.98] transition-all duration-75 text-sm text-foreground/80 hover:text-foreground cursor-pointer select-none relative" style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }} data-testid="button-whatsapp-connect">
          <MessageSquare className="h-4 w-4 text-green-500 shrink-0 pointer-events-none" />
          <span className="pointer-events-none">AppsWebChat (QR)</span>
          <span className={cn("ml-auto h-2 w-2 rounded-full shrink-0 pointer-events-none", waStatus.state === 'connected' ? 'bg-green-500' : waStatus.state === 'disconnected' ? 'bg-red-500' : 'bg-amber-500')} />
        </button>
        <a href="/project/website" onClick={(e) => { e.preventDefault(); window.location.href = '/project/website'; }} className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-accent/60 active:bg-accent active:scale-[0.98] transition-all duration-75 text-sm text-foreground/80 hover:text-foreground cursor-pointer select-none no-underline" style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }} data-testid="button-codex-vc">
          <Code className="h-4 w-4 text-cyan-500 shrink-0 pointer-events-none" />
          <span className="pointer-events-none">Codex VC</span>
        </a>
      </div>

      <div className="px-3 py-1">
        <div className="h-px bg-gradient-to-r from-transparent via-border/30 to-transparent" />
      </div>

      <ScrollArea className="flex-1 px-1 [&_[data-radix-scroll-area-viewport]]:scrollbar-thin [&_[data-radix-scroll-area-viewport]]:scrollbar-thumb-muted-foreground/20 [&_[data-radix-scroll-area-viewport]]:scrollbar-track-transparent">
        <div className="flex flex-col gap-0.5 pb-2">
          <div className="flex items-center justify-between px-2 pt-2 pb-1">
            <span className="text-base font-semibold text-foreground">Hilos</span>
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded" data-testid="button-filter-hilos">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Filtrar</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded" onClick={() => setIsCreateProjectOpen(true)} data-testid="button-new-folder-header">
                    <FolderPlus className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Nuevo proyecto</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {projects.length > 0 && (
            <div className="flex flex-col gap-px px-1">
              {projects.map((project) => {
                const projectChats = chats.filter(chat => project.chatIds.includes(chat.id));
                const isExpanded = expandedFolders.has(project.id);
                const isSelected = selectedProjectId === project.id;
                return (
                  <Collapsible key={project.id} open={isExpanded} onOpenChange={() => toggleFolder(project.id)}>
                    <div className={cn(
                      "group flex items-center gap-1 px-1.5 py-1 rounded-md transition-colors",
                      isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/40"
                    )}>
                      <CollapsibleTrigger asChild>
                        <button className="p-0.5 rounded shrink-0 hover:bg-accent">
                          <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform duration-150", isExpanded && "rotate-90")} />
                        </button>
                      </CollapsibleTrigger>
                      <div
                        className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); onSelectProject?.(project.id); }}
                        data-testid={`project-${project.id}`}
                      >
                        {isExpanded ? <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                        <span className="h-1.5 w-1.5 rounded-full shrink-0" ref={(el) => { if (el) el.style.backgroundColor = project.color; }} />
                        <span className="text-[12px] font-medium truncate flex-1">{project.name}</span>
                        {project.files.length > 0 && <span className="text-[9px] text-muted-foreground/60 tabular-nums">{project.files.length}f</span>}
                        <span className="text-[9px] text-muted-foreground/60 tabular-nums">{projectChats.length}</span>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-accent transition-opacity" onClick={(e) => e.stopPropagation()} data-testid={`project-menu-${project.id}`}>
                            <MoreHorizontal className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44" sideOffset={4}>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditingProject(project); }} data-testid={`project-edit-${project.id}`}>
                            <Pencil className="h-3.5 w-3.5 mr-2" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setMemoriesProject(project); }} data-testid={`project-memories-${project.id}`}>
                            <Brain className="h-3.5 w-3.5 mr-2" /> Memorias
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setShareProject(project); }} data-testid={`project-share-${project.id}`}>
                            <MoveRight className="h-3.5 w-3.5 mr-2" /> Compartir
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => {
                            e.stopPropagation();
                            const exportData = { ...project, exportedAt: new Date().toISOString(), version: "1.0" };
                            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a"); a.href = url; a.download = `${project.name.replace(/[^a-z0-9]/gi, "_")}_project.json`;
                            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                          }} data-testid={`project-export-${project.id}`}>
                            <Download className="h-3.5 w-3.5 mr-2" /> Exportar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setDeletingProject(project); }} className="text-red-500 focus:text-red-500" data-testid={`project-delete-${project.id}`}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <CollapsibleContent>
                      <div className="flex flex-col gap-px ml-3 pl-2 border-l border-border/20 mt-0.5">
                        {projectChats.length > 0 ? projectChats.map((chat) => renderChatItem(chat, true)) : (
                          <p className="text-[10px] text-muted-foreground/50 px-2 py-1 italic">Sin conversaciones</p>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          )}

          {folders.length > 0 && (
            <div className="flex flex-col gap-px px-1">
              {folders.map((folder) => {
                const folderChats = chats.filter(chat => folder.chatIds.includes(chat.id));
                const isExpanded = expandedFolders.has(folder.id);
                return (
                  <Collapsible key={folder.id} open={isExpanded} onOpenChange={() => toggleFolder(folder.id)}>
                    <CollapsibleTrigger asChild>
                      <div className="flex items-center gap-1.5 px-1.5 py-1 rounded-md cursor-pointer hover:bg-accent/40 transition-colors" data-testid={`folder-${folder.id}`}>
                        <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform duration-150", isExpanded && "rotate-90")} />
                        {isExpanded ? <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" /> : <Folder className="h-3.5 w-3.5 text-muted-foreground" />}
                        <span className="h-1.5 w-1.5 rounded-full shrink-0" ref={(el) => { if (el) el.style.backgroundColor = folder.color; }} />
                        <span className="text-[12px] font-medium flex-1 truncate">{folder.name}</span>
                        <span className="text-[9px] text-muted-foreground/60 tabular-nums">{folderChats.length}</span>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="flex flex-col gap-px ml-3 pl-2 border-l border-border/20 mt-0.5">
                        {folderChats.map((chat) => renderChatItem(chat, true))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          )}

          {isCreatingFolder && (
            <div className="flex items-center gap-1 px-2 py-0.5">
              <Input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="Nombre" className="h-6 text-xs flex-1" autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") { setIsCreatingFolder(false); setNewFolderName(""); } }}
                data-testid="input-new-folder-name" />
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleCreateFolder} data-testid="button-save-folder"><Check className="h-2.5 w-2.5 text-green-500" /></Button>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setIsCreatingFolder(false); setNewFolderName(""); }} data-testid="button-cancel-folder"><X className="h-2.5 w-2.5 text-red-500" /></Button>
            </div>
          )}

          {pinnedChats.length > 0 && (
            <div className="flex flex-col gap-px px-1">
              <div className="flex items-center gap-1 px-1.5 py-0.5">
                <Pin className="h-2.5 w-2.5 text-muted-foreground/40" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/50">Fijados</span>
              </div>
              {pinnedChats.map((chat) => renderChatItem(chat))}
            </div>
          )}

          {pinnedGpts.length > 0 && (
            <div className="flex flex-col gap-px px-1">
              <div className="px-1.5 py-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/50">GPTs</span>
              </div>
              {pinnedGpts.map((pinned) => (
                <div key={pinned.gptId} className="group flex items-center justify-between px-1.5 py-1 rounded-md cursor-pointer hover:bg-accent/40 transition-colors"
                  onClick={() => setLocation(`/gpts/${pinned.gpt.slug || pinned.gptId}`)} data-testid={`pinned-gpt-${pinned.gptId}`}>
                  <div className="flex items-center gap-1.5 min-w-0">
                    {pinned.gpt.avatar ? <img src={pinned.gpt.avatar} alt={pinned.gpt.name} className="h-4 w-4 rounded object-cover shrink-0" /> : <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    <span className="truncate text-[12px]">{pinned.gpt.name}</span>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <button className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-accent" data-testid={`button-pinned-gpt-menu-${pinned.gptId}`}>
                        <MoreHorizontal className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); unpinGpt(pinned.gptId); }} data-testid={`button-unpin-gpt-${pinned.gptId}`}>
                        <Pin className="h-3.5 w-3.5 mr-2" /> Desfijar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}

          {groupOrder.map((group) => {
            const groupChats = groupedChats[group];
            if (!groupChats || groupChats.length === 0) return null;
            return (
              <div key={group} className="flex flex-col gap-px px-1">
                <div className="px-1.5 py-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/50">{group}</span>
                </div>
                {groupChats.map((chat) => renderChatItem(chat))}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {hiddenChats.length > 0 && (
        <div className="px-1.5 border-t border-border/20">
          <Button variant="ghost" className="w-full justify-between px-2 py-1 h-7 text-[11px] text-muted-foreground" onClick={() => setShowHidden(!showHidden)} data-testid="button-toggle-hidden">
            <div className="flex items-center gap-1.5">
              <EyeOff className="h-3 w-3" />
              <span>Ocultos ({hiddenChats.length})</span>
            </div>
            <ChevronDown className={cn("h-3 w-3 transition-transform", showHidden && "rotate-180")} />
          </Button>
          {showHidden && (
            <div className="flex flex-col gap-px pb-1">
              {hiddenChats.map((chat) => (
                <div key={chat.id} className="group flex items-center justify-between px-2 py-1 rounded-md cursor-pointer hover:bg-accent/40 transition-colors opacity-60"
                  onClick={() => onSelectChat(chat.id)} data-testid={`hidden-chat-item-${chat.id}`}>
                  <span className="truncate text-[12px]" dir="ltr">{chat.title}</span>
                  <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-80" onClick={(e) => { e.stopPropagation(); onHideChat?.(chat.id, e); }} data-testid={`button-unhide-${chat.id}`}>
                    <Eye className="h-2.5 w-2.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-auto border-t border-border/20 p-3">
        <Popover open={isUserMenuOpen} onOpenChange={setIsUserMenuOpen}>
          <PopoverTrigger asChild>
            <button className="flex w-full items-center gap-2.5 p-1 rounded-md hover:bg-accent/40 transition-colors cursor-pointer" data-testid="button-user-menu">
              <div className="relative shrink-0">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-gradient-to-br from-violet-500 to-blue-500 text-white text-xs font-bold">
                    {isAdmin ? "A" : (user?.firstName?.[0] || user?.email?.[0] || "U").toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-[#fafafa] dark:border-[#111113]" />
              </div>
              <div className="flex flex-1 flex-col overflow-hidden text-left">
                <span className="truncate text-sm font-medium">
                  {isAdmin ? "Admin" : (user?.firstName || user?.email?.split("@")[0] || "Usuario")}
                </span>
                <span className="truncate text-[10px] text-muted-foreground/60 uppercase tracking-wide">
                  Cuenta personal
                </span>
              </div>
              <Settings className="h-4 w-4 text-muted-foreground/50 shrink-0" />
            </button>
          </PopoverTrigger>
            <PopoverContent className="w-auto min-w-56 p-2" align="start" side="top">
              <div className="flex flex-col">
                {/* Profile section */}
                <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal liquid-button" onClick={() => { setIsUserMenuOpen(false); setLocation("/profile"); }} data-testid="button-profile">
                  <User className="h-4 w-4" />
                  Perfil
                </Button>
                {isAdmin && (
                  <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal liquid-button" onClick={() => { setIsUserMenuOpen(false); setLocation("/billing"); }} data-testid="button-billing">
                    <CreditCard className="h-4 w-4" />
                    Facturación
                  </Button>
                )}

                <Separator className="my-1.5" />

                {/* Settings section */}
                <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal liquid-button" onClick={() => { setIsUserMenuOpen(false); setLocation("/workspace-settings"); }} data-testid="button-workspace-settings">
                  <Monitor className="h-4 w-4" />
                  Configuración del espacio de trabajo
                </Button>
                <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal liquid-button" onClick={() => { setIsUserMenuOpen(false); setIsSettingsOpen(true); }} data-testid="button-settings">
                  <Settings className="h-4 w-4" />
                  Configuración
                </Button>
                <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal liquid-button" onClick={() => { setIsUserMenuOpen(false); setLocation("/privacy"); }} data-testid="button-privacy">
                  <Shield className="h-4 w-4" />
                  Privacidad
                </Button>
                <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal liquid-button" onClick={() => { setIsUserMenuOpen(false); setLocation("/memory"); }} data-testid="button-memory">
                  <Brain className="h-4 w-4" />
                  Mis Memorias
                </Button>
                <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal liquid-button" onClick={() => { setIsUserMenuOpen(false); setLocation("/ads"); }} data-testid="button-ilia-ads">
                  <Megaphone className="h-4 w-4" />
                  IliaADS
                </Button>

                {isAdmin && (
                  <>
                    <Separator className="my-1.5" />
                    <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal liquid-button" onClick={() => { setIsUserMenuOpen(false); setLocation("/admin"); }} data-testid="button-admin-panel">
                      <Settings className="h-4 w-4" />
                      Admin Panel
                    </Button>
                  </>
                )}

                <Separator className="my-1.5" />
                <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal text-red-500 hover:text-red-600 hover:bg-red-50 liquid-button" onClick={() => { setIsUserMenuOpen(false); handleLogout(); }} data-testid="button-logout">
                  <LogOut className="h-4 w-4" />
                  Cerrar sesión
                </Button>
              </div>
            </PopoverContent>
          </Popover>
      </div>

      <SearchModal
        open={isSearchModalOpen}
        onOpenChange={setIsSearchModalOpen}
        chats={chats}
        onSelectChat={onSelectChat}
        triggerRef={searchButtonRef}
      />

      <SettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />

      <CreateProjectModal
        open={isCreateProjectOpen}
        onOpenChange={setIsCreateProjectOpen}
        onCreateProject={async (data) => {
          await createProject(data);
        }}
        knowledgeFiles={[]}
      />

      <EditProjectModal
        open={editingProject !== null}
        onOpenChange={(open) => !open && setEditingProject(null)}
        project={editingProject}
        onSave={(projectId, updates) => {
          updateProject(projectId, updates);
          setEditingProject(null);
        }}
      />

      <ProjectMemoriesModal
        open={memoriesProject !== null}
        onOpenChange={(open) => !open && setMemoriesProject(null)}
        project={memoriesProject}
        onUpdateProject={updateProject}
      />

      <ShareProjectModal
        open={shareProject !== null}
        onOpenChange={(open) => !open && setShareProject(null)}
        project={shareProject}
      />

      <DeleteConfirmDialog
        open={deletingProject !== null}
        onOpenChange={(open) => !open && setDeletingProject(null)}
        title={`¿Eliminar "${deletingProject?.name}" ? `}
        description="Esta acción no se puede deshacer. Se eliminarán todos los datos del proyecto incluyendo el prompt y los archivos adjuntos."
        onConfirm={() => {
          if (deletingProject) {
            deleteProject(deletingProject.id);
            console.log("[Sidebar] Project deleted:", deletingProject.id);
            setDeletingProject(null);
          }
        }}
      />

      {/* Chat Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deletingChatId !== null}
        onOpenChange={(open) => !open && setDeletingChatId(null)}
        title="¿Eliminar esta conversación?"
        description="Esta acción no se puede deshacer. Se eliminará permanentemente la conversación y todos sus mensajes."
        onConfirm={() => {
          if (deletingChatId && onDeleteChat) {
            // Create a synthetic event for the handler
            const syntheticEvent = { stopPropagation: () => { } } as React.MouseEvent;
            onDeleteChat(deletingChatId, syntheticEvent);
            console.log("[Sidebar] Chat deleted:", deletingChatId);
            setDeletingChatId(null);
          }
        }}
      />

    </nav >
  );
}
