
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
  MessageCircle,
} from "lucide-react";
import { IliaGPTLogo } from "@/components/iliagpt-logo";
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

const PremiumIcons = {
  Library: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
      <path d="M8 7h6" />
      <path d="M8 11h8" />
    </svg>
  ),
  Gpt: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9.88 3.2a1 1 0 0 0-1.76 0L5.3 8.3c-.3.56-.74 1-1.3 1.3L1.2 11.2a1 1 0 0 0 0 1.76l2.8 1.6c.56.3 1 .74 1.3 1.3l1.6 2.8c.2.36.72.36.92 0l1.6-2.8c.3-.56.74-1 1.3-1.3l2.8-1.6c.36-.2.36-.72 0-.92l-2.8-1.6c-.56-.3-1-.74-1.3-1.3l-1.6-2.8Z" />
      <path d="M19.2 4.2a.6.6 0 0 0-1.1 0l-.8 1.4c-.1.2-.3.3-.5.4l-1.4.8a.6.6 0 0 0 0 1.1l1.4.8c.2.1.4.3.5.5l.8 1.4a.6.6 0 0 0 1.1 0l.8-1.4c.1-.2.3-.3.5-.5l1.4-.8a.6.6 0 0 0 0-1.1l-1.4-.8c-.2-.1-.4-.3-.5-.4l-.8-1.4Z" opacity="0.6" />
      <path d="M21.2 16.2a.6.6 0 0 0-1.1 0l-.3.6c-.1.2-.3.3-.5.4l-.6.3a.6.6 0 0 0 0 1.1l.6.3c.2.1.4.3.5.5l.3.6a.6.6 0 0 0 1.1 0l.3-.6c.1-.2.3-.3.5-.5l.6-.3a.6.6 0 0 0 0-1.1l-.6-.3c-.2-.1-.4-.3-.5-.4l-.3-.6Z" opacity="0.4" />
    </svg>
  ),
  Skills: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  ),
  Apps: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" opacity="0.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <path d="M6.5 17.5h.01" strokeWidth="3" strokeLinecap="round" />
    </svg>
  ),
  ChatQr: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      <rect x="8" y="8" width="3" height="3" rx="0.5" />
      <rect x="13" y="8" width="3" height="3" rx="0.5" />
      <rect x="8" y="13" width="3" height="3" rx="0.5" />
      <rect x="13" y="13" width="3" height="3" rx="0.5" fill="currentColor" />
    </svg>
  ),
  Code: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <polyline points="8 10 12 14 8 18" />
      <line x1="16" y1="18" x2="16" y2="18" strokeWidth="2.5" />
    </svg>
  )
};
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { NewChatButton } from "@/components/chat/NewChatButton";
import { useProcessingChatIds, useChatStreamContent } from "@/stores/streamingStore";
import { CreateProjectModal, type CreateProjectData } from "@/components/create-project-modal";
import { useUserSkills } from "@/hooks/use-user-skills";
import { BUNDLED_SKILLS } from "@/data/bundledSkills";
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
  const appName = platformSettings.app_name || "ILIAGPT";
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
        "group relative flex w-full items-center px-2 py-2.5 rounded-xl cursor-pointer liquid-hover hover:bg-[#A5A0FF]/10 transition-all duration-300",
        activeChatId === chat.id && "bg-[#A5A0FF]/15 shadow-sm text-primary",
        chat.archived && "opacity-70",
        indented && "ml-4"
      )}
      onClick={() => !editingChatId && onSelectChat(chat.id)}
      data-testid={`chat - item - ${chat.id} `}
    >
      {editingChatId === chat.id ? (
        <div className="flex w-full items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="h-7 text-sm flex-1"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveEdit(chat.id);
              if (e.key === "Escape") handleCancelEdit();
            }}
            data-testid={`input - edit - chat - ${chat.id} `}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => handleSaveEdit(chat.id)}
            data-testid={`button - save - edit - ${chat.id} `}
          >
            <Check className="h-3 w-3 text-green-500" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleCancelEdit}
            data-testid={`button - cancel - edit - ${chat.id} `}
          >
            <X className="h-3 w-3 text-red-500" />
          </Button>
        </div>
      ) : (
        <>
          {/* 3-dot menu on the LEFT */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Chat options"
                className="flex-shrink-0 h-7 w-7 flex items-center justify-center rounded-md opacity-100 hover:bg-muted transition-colors mr-1"
                onClick={(e) => e.stopPropagation()}
                data-testid={`button - chat - menu - ${chat.id} `}
              >
                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
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
          {/* Chat title and indicators */}
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            {chat.archived && <Archive className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
            {chat.id.startsWith('wa_') && <MessageCircle className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />}
            <TooltipProvider delayDuration={500}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="truncate text-sm font-medium cursor-default">{chat.title}</span>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p className="text-xs">{chat.title}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {processingChatIds.includes(chat.id) && (
              <StreamingProgressIndicator chatId={chat.id} />
            )}
            {!processingChatIds.includes(chat.id) && pendingResponseCounts[chat.id] > 0 && (
              <span
                className="flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-blue-600 text-white text-xs font-medium flex-shrink-0"
                data-testid={`badge - pending - ${chat.id} `}
              >
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
      className={cn("flex h-screen w-[280px] flex-col bg-background/80 backdrop-blur-xl border-r border-border/50 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.1)] text-sidebar-foreground transition-all duration-300", className)}
      aria-label="Navegación principal y chats"
      role="navigation"
    >
      <div className="flex h-16 items-center justify-between px-5 py-3 border-b border-border/40 bg-gradient-to-b from-background to-background/50">
        <div className="flex items-center gap-3">
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-lg blur opacity-0 group-hover:opacity-100 transition duration-500"></div>
            <IliaGPTLogo size={34} className="drop-shadow-sm relative z-10" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-bold tracking-tight leading-none bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">{appName}</span>
            <div className="flex items-center gap-2 min-w-0 mt-0.5">
              <span className="text-[10px] text-muted-foreground font-medium truncate">{appDescription}</span>
              {isAdmin && platformSettings.maintenance_mode ? (
                <span className="shrink-0 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-[10px] font-medium">
                  Mantenimiento
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted/80 rounded-lg transition-all" onClick={onToggle}>
          <svg className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
            <line x1="9" y1="3" x2="9" y2="21" stroke="currentColor" strokeWidth="1.5" />
            <path d="M14 9L17 12L14 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>
      </div>

      <div className="px-2 py-2 flex flex-col gap-1">
        <NewChatButton onNewChat={onNewChat} variant="full" showTooltip={false} />

        <button
          ref={searchButtonRef}
          onClick={() => setIsSearchModalOpen(true)}
          className="w-full mt-2 mb-2 group flex items-center justify-between gap-2 px-3 py-2.5 text-sm text-muted-foreground bg-muted/30 hover:bg-muted/60 border border-border/40 hover:border-border/80 rounded-xl transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-[#A5A0FF]/50 hover:shadow-sm"
          data-testid="button-search-chats"
        >
          <div className="flex items-center gap-2 font-medium">
            <Search className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            <span className="group-hover:text-foreground transition-colors">Buscar chats...</span>
          </div>
          <kbd className="hidden lg:inline-flex h-5 items-center gap-1 rounded-md border border-border/50 bg-background/50 px-1.5 font-mono text-[10px] font-medium text-muted-foreground group-hover:bg-background group-hover:text-foreground transition-all shadow-sm">
            <span className="text-xs">⌘</span>K
          </kbd>
        </button>

        <div className="space-y-1 mt-2">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 px-3 py-5 text-sm font-medium rounded-xl hover:bg-muted/60 hover:shadow-sm hover:-translate-y-0.5 transition-all duration-300 group"
            onClick={onOpenLibrary}
            data-testid="button-library"
          >
            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500 group-hover:bg-blue-500 group-hover:text-white transition-colors">
              <PremiumIcons.Library className="h-4 w-4" />
            </div>
            Biblioteca
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 px-3 py-5 text-sm font-medium rounded-xl hover:bg-muted/60 hover:shadow-sm hover:-translate-y-0.5 transition-all duration-300 group"
            onClick={onOpenGpts}
            data-testid="button-gpts"
          >
            <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-500 group-hover:bg-purple-500 group-hover:text-white transition-colors">
              <PremiumIcons.Gpt className="h-4 w-4" />
            </div>
            GPTs
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 px-3 py-5 text-sm font-medium rounded-xl hover:bg-muted/60 hover:shadow-sm hover:-translate-y-0.5 transition-all duration-300 group h-auto"
            onClick={onOpenSkills}
            data-testid="button-skills"
          >
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500 group-hover:bg-amber-500 group-hover:text-white transition-colors mt-0.5 shrink-0">
              <PremiumIcons.Skills className="h-4 w-4" />
            </div>
            <span className="flex flex-col items-start leading-tight">
              <span>Skills</span>
              <span className="text-[10px] font-normal text-muted-foreground group-hover:text-muted-foreground/80 transition-colors">Capacidades modulares</span>
            </span>
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 px-3 py-5 text-sm font-medium rounded-xl hover:bg-muted/60 hover:shadow-sm hover:-translate-y-0.5 transition-all duration-300 group"
            onClick={onOpenApps}
            data-testid="button-apps"
          >
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 group-hover:bg-emerald-500 group-hover:text-white transition-colors">
              <PremiumIcons.Apps className="h-4 w-4" />
            </div>
            Aplicaciones
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 px-3 py-5 text-sm font-medium rounded-xl hover:bg-muted/60 hover:shadow-sm hover:-translate-y-0.5 transition-all duration-300 group"
            onClick={onOpenWhatsAppConnect}
            data-testid="button-whatsapp-connect"
          >
            <div className="p-1.5 rounded-lg bg-green-500/10 text-green-500 group-hover:bg-green-500 group-hover:text-white transition-colors">
              <PremiumIcons.ChatQr className="h-4 w-4" />
            </div>
            <span className="flex-1 text-left">AppsWebChat (QR)</span>
            <span
              className={cn(
                "h-2 w-2 rounded-full ring-2 ring-background shadow-sm",
                waStatus.state === 'connected' && 'bg-green-500',
                (waStatus.state === 'connecting' || waStatus.state === 'qr' || waStatus.state === 'pairing_code') && 'bg-amber-500 animate-pulse',
                waStatus.state === 'disconnected' && 'bg-red-500'
              )}
              title={`Canales: ${waStatus.state}`}
            />
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 px-3 py-5 text-sm font-medium rounded-xl hover:bg-blue-50/80 dark:hover:bg-blue-500/10 hover:shadow-sm hover:-translate-y-0.5 transition-all duration-300 group text-blue-600 dark:text-blue-400 mt-1"
            onClick={onOpenCodex}
            data-testid="button-codex"
          >
            <div className="p-1.5 rounded-lg bg-blue-600/10 dark:bg-blue-400/10 text-blue-600 dark:text-blue-400 group-hover:bg-blue-600 dark:group-hover:bg-blue-400 group-hover:text-white dark:group-hover:text-neutral-900 transition-colors">
              <PremiumIcons.Code className="h-4 w-4" />
            </div>
            Codex
          </Button>
        </div>
      </div>

      <Separator className="mx-4 my-2 w-auto" />

      <ScrollArea className="flex-1 px-2 liquid-scroll [&_[data-radix-scroll-area-viewport]]:scrollbar-thin [&_[data-radix-scroll-area-viewport]]:scrollbar-thumb-muted-foreground/30 [&_[data-radix-scroll-area-viewport]]:scrollbar-track-transparent hover:[&_[data-radix-scroll-area-viewport]]:scrollbar-thumb-muted-foreground/50">
        <div className="flex flex-col gap-4 pb-4">

          {folders.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <div className="px-2 py-1.5">
                <h3 className="text-xs font-medium text-muted-foreground">Carpetas</h3>
              </div>
              {folders.map((folder) => {
                const folderChats = chats.filter(chat => folder.chatIds.includes(chat.id));
                const isExpanded = expandedFolders.has(folder.id);
                return (
                  <Collapsible key={folder.id} open={isExpanded} onOpenChange={() => toggleFolder(folder.id)}>
                    <CollapsibleTrigger asChild>
                      <div
                        className="flex items-center gap-2 px-2 py-2 rounded-xl cursor-pointer hover:bg-accent transition-all duration-300"
                        data-testid={`folder - ${folder.id} `}
                      >
                        {isExpanded ? (
                          <FolderOpen className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Folder className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span
                          className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                          ref={(el) => { if (el) el.style.backgroundColor = folder.color; }}
                        />
                        <span className="text-sm font-medium flex-1">{folder.name}</span>
                        <span className="text-xs text-muted-foreground">{folderChats.length}</span>
                        <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="flex flex-col gap-0.5 mt-0.5">
                        {folderChats.map((chat) => renderChatItem(chat, true))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
              {isCreatingFolder ? (
                <div className="flex items-center gap-1 px-2 py-1">
                  <Input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Nombre de carpeta"
                    className="h-7 text-sm flex-1"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFolder();
                      if (e.key === "Escape") {
                        setIsCreatingFolder(false);
                        setNewFolderName("");
                      }
                    }}
                    data-testid="input-new-folder-name"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleCreateFolder}
                    data-testid="button-save-folder"
                  >
                    <Check className="h-3 w-3 text-green-500" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => {
                      setIsCreatingFolder(false);
                      setNewFolderName("");
                    }}
                    data-testid="button-cancel-folder"
                  >
                    <X className="h-3 w-3 text-red-500" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 px-2 text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => setIsCreateProjectOpen(true)}
                  data-testid="button-new-folder"
                >
                  <FolderPlus className="h-4 w-4" />
                  Nueva Carpeta
                </Button>
              )}
            </div>
          )}

          {folders.length === 0 && (
            <div className="px-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 px-2 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setIsCreateProjectOpen(true)}
                data-testid="button-new-folder"
              >
                <FolderPlus className="h-4 w-4" />
                Nueva Carpeta
              </Button>

              {/* Projects List */}
              {projects.length > 0 && (
                <div className="flex flex-col gap-0.5 mt-2">
                  {projects.map((project) => {
                    const projectChats = chats.filter(chat => project.chatIds.includes(chat.id));
                    const isExpanded = expandedFolders.has(project.id);
                    return (
                      <Collapsible key={project.id} open={isExpanded} onOpenChange={() => toggleFolder(project.id)}>
                        <div className="group flex items-center gap-1 px-2 py-2 rounded-xl hover:bg-accent transition-all duration-300">
                          <CollapsibleTrigger asChild>
                            <button
                              aria-label="Expand project"
                              className="p-1 hover:bg-muted rounded cursor-pointer shrink-0">
                              <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
                            </button>
                          </CollapsibleTrigger>

                          {/* Three dots menu - ON THE LEFT */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label="Project options"
                                className="flex-shrink-0 h-7 w-7 flex items-center justify-center rounded-md opacity-100 hover:bg-muted transition-colors"
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`project - menu - ${project.id} `}
                              >
                                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-48" sideOffset={5}>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingProject(project);
                                }}
                                data-testid={`project - edit - ${project.id} `}
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMemoriesProject(project);
                                }}
                                data-testid={`project - memories - ${project.id} `}
                              >
                                <Library className="h-4 w-4 mr-2" />
                                Memories
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShareProject(project);
                                }}
                                data-testid={`project - share - ${project.id} `}
                              >
                                <MoveRight className="h-4 w-4 mr-2" />
                                Share
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Export project as JSON
                                  const exportData = {
                                    ...project,
                                    exportedAt: new Date().toISOString(),
                                    version: "1.0"
                                  };
                                  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = url;
                                  a.download = `${project.name.replace(/[^a-z0-9]/gi, "_")} _project.json`;
                                  document.body.appendChild(a);
                                  a.click();
                                  document.body.removeChild(a);
                                  URL.revokeObjectURL(url);
                                }}
                                data-testid={`project -export -${project.id} `}
                              >
                                <Download className="h-4 w-4 mr-2" />
                                Export
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingProject(project);
                                }}
                                className="text-red-500 focus:text-red-500"
                                data-testid={`project - delete -${project.id} `}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>

                          {/* Project content */}
                          <div
                            className={cn(
                              "flex items-center gap-2 flex-1 min-w-0 cursor-pointer p-1 rounded-md transition-colors",
                              selectedProjectId === project.id ? "bg-accent/50 text-accent-foreground" : "hover:bg-muted/50"
                            )}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onSelectProject?.(project.id);
                            }}
                            data-testid={`project - ${project.id} `}
                          >
                            {project.backgroundImage ? (
                              <div
                                className="h-5 w-5 rounded flex-shrink-0 bg-cover bg-center"
                                ref={(el) => { if (el) el.style.backgroundImage = `url(${project.backgroundImage})`; }}
                              />
                            ) : isExpanded ? (
                              <FolderOpen className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Folder className="h-4 w-4 text-muted-foreground" />
                            )}
                            <span
                              className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                              ref={(el) => { if (el) el.style.backgroundColor = project.color; }}
                            />
                            <span className="text-sm font-medium flex-1 truncate">{project.name}</span>
                            {project.systemPrompt && (
                              <span className="text-xs text-muted-foreground" title="Has system prompt">📝</span>
                            )}
                            {project.files.length > 0 && (
                              <span className="text-xs text-muted-foreground" title={`${project.files.length} files`}>📎{project.files.length}</span>
                            )}
                            <span className="text-xs text-muted-foreground">{projectChats.length}</span>
                          </div>
                        </div>
                        <CollapsibleContent>
                          <div className="flex flex-col gap-0.5 mt-0.5">
                            {projectChats.length > 0 ? (
                              projectChats.map((chat) => renderChatItem(chat, true))
                            ) : (
                              <p className="text-xs text-muted-foreground px-6 py-2 italic">
                                No hay chats. Mueve chats aquí.
                              </p>
                            )}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Pinned Chats Section */}
          {pinnedChats.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <div className="px-2 py-1.5">
                <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Pin className="h-3 w-3" />
                  Fijados
                </h3>
              </div>
              {pinnedChats.map((chat) => renderChatItem(chat))}
            </div>
          )}

          {/* Pinned GPTs Section */}
          {pinnedGpts.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <div className="px-2 py-1.5">
                <h3 className="text-xs font-medium text-muted-foreground">GPTs</h3>
              </div>
              {pinnedGpts.map((pinned) => (
                <div
                  key={pinned.gptId}
                  className="group flex w-full items-center justify-between px-2 py-2 rounded-xl cursor-pointer hover:bg-accent transition-all duration-300"
                  onClick={() => setLocation(`/ gpts / ${pinned.gpt.slug || pinned.gptId} `)}
                  data-testid={`pinned - gpt - ${pinned.gptId} `}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {pinned.gpt.avatar ? (
                      <img
                        src={pinned.gpt.avatar}
                        alt={pinned.gpt.name}
                        className="h-6 w-6 rounded-md object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                        <Bot className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <span className="truncate text-sm">{pinned.gpt.name}</span>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 flex-shrink-0"
                        data-testid={`button - pinned - gpt - menu - ${pinned.gptId} `}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          unpinGpt(pinned.gptId);
                        }}
                        className="flex items-center gap-2"
                        data-testid={`button - unpin - gpt - ${pinned.gptId} `}
                      >
                        <Pin className="h-4 w-4" />
                        <span>Desfijar</span>
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
              <div key={group} className="flex flex-col gap-0.5">
                <div className="px-2 py-1.5">
                  <h3 className="text-xs font-medium text-muted-foreground">{group}</h3>
                </div>
                {groupChats.map((chat) => renderChatItem(chat))}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Hidden Chats Section */}
      {
        hiddenChats.length > 0 && (
          <div className="px-2 border-t">
            <Button
              variant="ghost"
              className="w-full justify-between px-2 py-2 text-sm font-medium text-muted-foreground liquid-button"
              onClick={() => setShowHidden(!showHidden)}
              data-testid="button-toggle-hidden"
            >
              <div className="flex items-center gap-2">
                <EyeOff className="h-4 w-4" />
                <span>Ocultos ({hiddenChats.length})</span>
              </div>
              <ChevronDown className={cn("h-4 w-4 transition-transform", showHidden && "rotate-180")} />
            </Button>
            {showHidden && (
              <div className="flex flex-col gap-0.5 pb-2">
                {hiddenChats.map((chat) => (
                  <div
                    key={chat.id}
                    className="group flex w-full items-center justify-between px-2 py-2 rounded-md cursor-pointer hover:bg-accent transition-colors opacity-70"
                    onClick={() => onSelectChat(chat.id)}
                    data-testid={`hidden - chat - item - ${chat.id} `}
                  >
                    <span className="truncate" dir="ltr">
                      {chat.title}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-80"
                      onClick={(e) => {
                        e.stopPropagation();
                        onHideChat?.(chat.id, e);
                      }}
                      data-testid={`button - unhide - ${chat.id} `}
                    >
                      <Eye className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      }

      <div className="mt-auto border-t p-4">
        <div className="flex w-full items-center gap-3 rounded-lg p-2">
          <Popover open={isUserMenuOpen} onOpenChange={setIsUserMenuOpen}>
            <PopoverTrigger asChild>
              <button className="flex flex-1 items-center gap-3 liquid-button cursor-pointer" data-testid="button-user-menu">
                <div className="relative">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300">
                      {isAdmin ? "A" : (user?.firstName?.[0] || user?.email?.[0] || "U").toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  {/* Online status indicator */}
                  <span className="absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-background" title="En línea" />
                </div>
                <div className="flex flex-1 flex-col overflow-hidden text-left">
                  <span className="truncate text-sm font-medium">
                    {isAdmin ? "Admin" : (user?.firstName || user?.email?.split("@")[0] || "Usuario")}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {(() => {
                      // Avoid hardcoding plan by email. Use server-provided plan when available.
                      const plan = ((user as any)?.plan || "free").toString().toLowerCase();
                      return plan === "free" ? "Cuenta personal" : plan.toUpperCase();
                    })()}
                  </span>
                </div>
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
