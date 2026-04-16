import { memo, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

interface ZenModeProps {
  isActive: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
}

export const ZenMode = memo(function ZenMode({
  isActive,
  onToggle,
  children,
  className,
}: ZenModeProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isActive) {
        onToggle();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "z") {
        e.preventDefault();
        onToggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, onToggle]);

  useEffect(() => {
    if (isActive) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isActive]);

  return (
    <AnimatePresence>
      {isActive ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className={cn(
            "fixed inset-0 z-50",
            "bg-background",
            "flex flex-col",
            className
          )}
        >
          <div className="absolute top-4 right-4 z-10">
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggle}
              className="h-10 w-10 rounded-full bg-muted/80 backdrop-blur hover:bg-muted"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex-1 flex items-center justify-center p-4">
            <div className="w-full max-w-3xl">
              {children}
            </div>
          </div>

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <span className="text-xs text-muted-foreground/50">
              Presiona ESC para salir del modo zen
            </span>
          </div>
        </motion.div>
      ) : (
        children
      )}
    </AnimatePresence>
  );
});

interface ZenToggleButtonProps {
  isZenMode: boolean;
  onToggle: () => void;
  className?: string;
}

export const ZenToggleButton = memo(function ZenToggleButton({
  isZenMode,
  onToggle,
  className,
}: ZenToggleButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      className={cn(
        "h-8 w-8 rounded-full",
        "text-muted-foreground hover:text-foreground",
        className
      )}
      title={isZenMode ? "Salir del modo zen (Ctrl+Shift+Z)" : "Modo zen (Ctrl+Shift+Z)"}
    >
      {isZenMode ? (
        <Minimize2 className="h-4 w-4" />
      ) : (
        <Maximize2 className="h-4 w-4" />
      )}
    </Button>
  );
});

export function useZenMode() {
  const [isZenMode, setIsZenMode] = useState(false);

  const toggleZenMode = useCallback(() => {
    setIsZenMode(prev => !prev);
  }, []);

  const enableZenMode = useCallback(() => {
    setIsZenMode(true);
  }, []);

  const disableZenMode = useCallback(() => {
    setIsZenMode(false);
  }, []);

  return {
    isZenMode,
    toggleZenMode,
    enableZenMode,
    disableZenMode,
  };
}

import { useState } from "react";

export default ZenMode;
