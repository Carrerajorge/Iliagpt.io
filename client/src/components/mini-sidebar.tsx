import { SquarePen, Search, Library, Bot, Zap, LayoutGrid, MessageSquare, Code } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { IliaGPTLogo } from "@/components/iliagpt-logo";
import { isAdminUser } from "@/lib/admin";
import { useLocation } from "wouter";

interface MiniSidebarProps {
  className?: string;
  onNewChat?: () => void;
  onExpand?: () => void;
  onOpenLibrary?: () => void;
  onOpenGpts?: () => void;
  onOpenSkills?: () => void;
  onOpenApps?: () => void;
  onOpenWhatsAppConnect?: () => void;
}

export function MiniSidebar({ className, onNewChat, onExpand, onOpenLibrary, onOpenGpts, onOpenSkills, onOpenApps, onOpenWhatsAppConnect }: MiniSidebarProps) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const isAdmin = isAdminUser(user as any);
  const displayName = isAdmin ? "Admin" : (user?.firstName || user?.email?.split("@")[0] || "Usuario");
  const avatarInitial = isAdmin ? "A" : (user?.firstName?.[0] || user?.email?.[0] || "U").toUpperCase();

  const btnClass = "h-10 w-10 rounded-xl hover:bg-accent transition-all duration-200";

  return (
    <TooltipProvider delayDuration={100}>
      <div className={cn(
        "flex h-screen w-[60px] flex-col items-center py-3 liquid-sidebar-light dark:liquid-sidebar border-r border-border",
        className
      )}>
        <div className="flex flex-col items-center gap-1 mb-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={btnClass} onClick={onExpand}>
                <IliaGPTLogo size={28} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>Expandir Sidebar</p></TooltipContent>
          </Tooltip>
        </div>

        <div className="flex flex-col items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={btnClass} onClick={onNewChat} data-testid="mini-button-new-chat">
                <SquarePen className="h-5 w-5 text-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>Nuevo Chat</p></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={btnClass} onClick={onExpand} data-testid="mini-button-search">
                <Search className="h-5 w-5 text-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>Buscar chats</p></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={btnClass} onClick={onOpenLibrary} data-testid="mini-button-library">
                <Library className="h-5 w-5 text-indigo-500" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>Biblioteca</p></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={btnClass} onClick={onOpenGpts} data-testid="mini-button-gpts">
                <Bot className="h-5 w-5 text-amber-500" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>GPTs</p></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={btnClass} onClick={() => setLocation("/openclaw")} data-testid="mini-button-openclaw">
                <span aria-hidden="true" className="text-[18px] leading-none">🦞</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>OpenClaw</p></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={btnClass} onClick={onOpenSkills} data-testid="mini-button-skills">
                <Zap className="h-5 w-5 text-blue-500" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>Skills</p></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={btnClass} onClick={onOpenApps} data-testid="mini-button-apps">
                <LayoutGrid className="h-5 w-5 text-emerald-500" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>Apps</p></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={btnClass} onClick={onOpenWhatsAppConnect} data-testid="mini-button-whatsapp">
                <MessageSquare className="h-5 w-5 text-green-500" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>AppsWebChat (QR)</p></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={btnClass} onClick={() => { window.location.href = '/project/website'; }} data-testid="mini-button-codex">
                <Code className="h-5 w-5 text-cyan-500" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>Codex VC</p></TooltipContent>
          </Tooltip>
        </div>

        <div className="mt-auto">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={btnClass} data-testid="mini-button-user">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-muted text-muted-foreground text-sm">{avatarInitial}</AvatarFallback>
                </Avatar>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>{displayName}</p></TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
