import { memo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { 
  Keyboard, 
  X, 
  Command,
  ArrowUp,
  ArrowDown,
  CornerDownLeft
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Shortcut {
  keys: string[];
  description: string;
  category: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ["Enter"], description: "Enviar mensaje", category: "Chat" },
  { keys: ["Shift", "Enter"], description: "Nueva línea", category: "Chat" },
  { keys: ["↑"], description: "Editar último mensaje", category: "Chat" },
  { keys: ["Esc"], description: "Cancelar edición", category: "Chat" },
  
  { keys: ["Ctrl", "K"], description: "Buscar en chats", category: "Navegación" },
  { keys: ["Ctrl", "N"], description: "Nuevo chat", category: "Navegación" },
  { keys: ["Ctrl", "B"], description: "Toggle sidebar", category: "Navegación" },
  { keys: ["Ctrl", "Shift", "Z"], description: "Modo zen", category: "Navegación" },
  
  { keys: ["Ctrl", "C"], description: "Copiar selección", category: "Edición" },
  { keys: ["Ctrl", "V"], description: "Pegar", category: "Edición" },
  { keys: ["Ctrl", "Z"], description: "Deshacer", category: "Edición" },
  { keys: ["Ctrl", "Shift", "Z"], description: "Rehacer", category: "Edición" },
  
  { keys: ["?"], description: "Mostrar atajos", category: "General" },
  { keys: ["Ctrl", "/"], description: "Enfocar input", category: "General" },
];

interface KeyboardShortcutsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsPanel = memo(function KeyboardShortcutsPanel({
  isOpen,
  onClose,
}: KeyboardShortcutsPanelProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const categories = Array.from(new Set(SHORTCUTS.map(s => s.category)));

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "w-full max-w-lg",
              "bg-background rounded-xl shadow-2xl",
              "border border-border overflow-hidden"
            )}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-2">
                <Keyboard className="w-5 h-5 text-primary" />
                <h2 className="font-semibold">Atajos de teclado</h2>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onClose}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="p-4 max-h-[60vh] overflow-y-auto space-y-6">
              {categories.map((category) => (
                <div key={category}>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">
                    {category}
                  </h3>
                  <div className="space-y-1">
                    {SHORTCUTS.filter(s => s.category === category).map((shortcut, index) => (
                      <ShortcutItem key={index} shortcut={shortcut} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t bg-muted/30">
              <p className="text-xs text-muted-foreground text-center">
                Presiona <Kbd>?</Kbd> en cualquier momento para ver este panel
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

const ShortcutItem = memo(function ShortcutItem({
  shortcut,
}: {
  shortcut: Shortcut;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50">
      <span className="text-sm">{shortcut.description}</span>
      <div className="flex items-center gap-1">
        {shortcut.keys.map((key, index) => (
          <span key={index} className="flex items-center">
            {index > 0 && <span className="text-muted-foreground mx-0.5">+</span>}
            <Kbd>{key}</Kbd>
          </span>
        ))}
      </div>
    </div>
  );
});

const Kbd = memo(function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className={cn(
      "inline-flex items-center justify-center",
      "min-w-[20px] h-5 px-1.5",
      "text-[10px] font-medium",
      "bg-muted border border-border rounded",
      "shadow-sm"
    )}>
      {children}
    </kbd>
  );
});

export function useKeyboardShortcuts() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          e.preventDefault();
          setIsOpen(true);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen(prev => !prev),
  };
}

export default KeyboardShortcutsPanel;
