import { useEffect, useCallback } from "react";

interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
}

interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
}

export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcut[],
  options: UseKeyboardShortcutsOptions = {}
) {
  const { enabled = true } = options;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;
      
      if (!event.key) return;

      const target = event.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || 
                      target.tagName === "TEXTAREA" || 
                      target.isContentEditable;

      for (const shortcut of shortcuts) {
        const ctrlOrMeta = shortcut.ctrl || shortcut.meta;
        const requiresCtrl = Boolean(ctrlOrMeta);
        const requiresShift = Boolean(shortcut.shift);
        const requiresAlt = Boolean(shortcut.alt);
        
        const hasCtrl = event.ctrlKey || event.metaKey;
        const hasShift = event.shiftKey;
        const hasAlt = event.altKey;
        
        const matchesCtrl = requiresCtrl ? hasCtrl : !hasCtrl;
        const matchesShift = requiresShift ? hasShift : !hasShift;
        const matchesAlt = requiresAlt ? hasAlt : !hasAlt;
        const matchesKey = event.key.toLowerCase() === shortcut.key.toLowerCase();

        if (matchesKey && matchesCtrl && matchesShift && matchesAlt) {
          if (isInput && !requiresCtrl && shortcut.key !== "Escape") continue;
          
          event.preventDefault();
          event.stopPropagation();
          shortcut.action();
          return;
        }
      }
    },
    [shortcuts, enabled]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}

export const KEYBOARD_SHORTCUTS = [
  { keys: "Ctrl+N", description: "Nuevo chat" },
  { keys: "Ctrl+K", description: "Búsqueda rápida" },
  { keys: "Ctrl+Shift+K", description: "Tool Catalog" },
  { keys: "Ctrl+/", description: "Atajos de teclado" },
  { keys: "Ctrl+,", description: "Configuración" },
  { keys: "Ctrl+E", description: "Exportar chat" },
  { keys: "Ctrl+Enter", description: "Enviar mensaje" },
  { keys: "Escape", description: "Cerrar diálogo" },
] as const;
