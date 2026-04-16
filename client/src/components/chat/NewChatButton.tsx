import { useState, useCallback } from "react";
import { SquarePen, Loader2, Check } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface NewChatButtonProps {
  onNewChat?: () => void;
  isCreating?: boolean;
  variant?: "full" | "compact" | "fab";
  className?: string;
  showTooltip?: boolean;
}

export function NewChatButton({
  onNewChat,
  isCreating = false,
  variant = "full",
  className,
  showTooltip = true,
}: NewChatButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleClick = useCallback(() => {
    if (isCreating) return;
    
    onNewChat?.();
    
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 800);
  }, [isCreating, onNewChat]);

  const baseClasses = "relative overflow-hidden group font-medium transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2";
  
  const variantClasses = {
    full: "flex items-center justify-between gap-3 w-full px-4 py-2.5 text-sm rounded-lg bg-gradient-to-r from-primary via-primary/90 to-primary bg-[length:200%_100%] hover:bg-[position:100%_0] text-primary-foreground shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]",
    compact: "flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-lg bg-gradient-to-r from-primary to-primary/80 text-primary-foreground shadow hover:shadow-md hover:scale-105 active:scale-95",
    fab: "fixed bottom-6 right-6 z-50 flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-r from-primary to-primary/80 text-primary-foreground shadow-xl hover:shadow-2xl hover:scale-110 active:scale-95 md:hidden",
  };

  const successClasses = showSuccess ? "!bg-green-600 !shadow-green-500/40" : "";

  const buttonContent = (
    <button
      className={cn(baseClasses, variantClasses[variant], successClasses, className)}
      onClick={handleClick}
      disabled={isCreating}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid="button-new-chat"
      title="Nuevo chat (Ctrl+N)"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
      
      <div className="flex items-center gap-2 relative z-10">
        {isCreating ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : showSuccess ? (
          <Check className="h-5 w-5" />
        ) : (
          <SquarePen className={cn("h-5 w-5 transition-transform duration-300", isHovered && "scale-110")} />
        )}
        
        {variant !== "fab" && (
          <span>{isCreating ? "Creando..." : showSuccess ? "¡Creado!" : "Nuevo chat"}</span>
        )}
      </div>
      
      {variant === "full" && (
        <kbd className="hidden lg:inline-flex items-center px-1.5 py-0.5 text-xs bg-black/20 rounded border border-white/20 relative z-10">
          ⌘N
        </kbd>
      )}
    </button>
  );

  if (!showTooltip || variant === "full") {
    return buttonContent;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{buttonContent}</TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">
          <span>Nuevo chat</span>
          <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded">Ctrl+N</kbd>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function NewChatFab({ onNewChat }: { onNewChat?: () => void }) {
  return <NewChatButton onNewChat={onNewChat} variant="fab" showTooltip={false} />;
}
