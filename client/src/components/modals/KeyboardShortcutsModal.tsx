/**
 * Keyboard Shortcuts Modal
 *
 * Displays all available keyboard shortcuts in a clean, organized modal.
 * Can be triggered from the command palette (⌘?) or settings page.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Keyboard, Command } from "lucide-react";

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutCategory {
  title: string;
  shortcuts: Array<{
    keys: string;
    description: string;
  }>;
}

// All keyboard shortcuts organized by category
const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    title: "General",
    shortcuts: [
      { keys: "⌘ K", description: "Abrir paleta de comandos" },
      { keys: "⌘ N", description: "Nuevo chat" },
      { keys: "⌘ ,", description: "Abrir configuración" },
      { keys: "Esc", description: "Cerrar diálogo / modal" },
    ],
  },
  {
    title: "Navegación",
    shortcuts: [
      { keys: "⌘ G", description: "Ir a GPTs" },
      { keys: "⌘ S", description: "Ir a Skills" },
      { keys: "⌘ L", description: "Abrir biblioteca" },
      { keys: "⌘ Shift K", description: "Abrir catálogo de herramientas" },
    ],
  },
  {
    title: "Chat",
    shortcuts: [
      { keys: "⌘ E", description: "Exportar chat" },
      { keys: "Enter", description: "Enviar mensaje" },
      { keys: "Shift Enter", description: "Nueva línea en mensaje" },
    ],
  },
  {
    title: "Apariencia",
    shortcuts: [
      { keys: "⌘ T", description: "Alternar tema claro/oscuro" },
      { keys: "⌘ ?", description: "Ver atajos de teclado" },
    ],
  },
];

function ShortcutKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-xs font-medium bg-muted border border-border rounded shadow-sm">
      {children}
    </kbd>
  );
}

function ShortcutRow({ keys, description }: { keys: string; description: string }) {
  // Parse the keys string to render individual key badges
  const keyParts = keys.split(" ").filter(Boolean);

  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-foreground">{description}</span>
      <div className="flex items-center gap-1">
        {keyParts.map((key, index) => (
          <ShortcutKey key={index}>
            {key === "⌘" ? <Command className="w-3 h-3" /> : key}
          </ShortcutKey>
        ))}
      </div>
    </div>
  );
}

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="w-5 h-5" />
            Atajos de teclado
          </DialogTitle>
          <DialogDescription>
            Usa estos atajos para navegar más rápido
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {SHORTCUT_CATEGORIES.map((category) => (
            <div key={category.title}>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                {category.title}
              </h3>
              <div className="divide-y divide-border/50">
                {category.shortcuts.map((shortcut, index) => (
                  <ShortcutRow
                    key={index}
                    keys={shortcut.keys}
                    description={shortcut.description}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="pt-4 border-t mt-4">
          <p className="text-xs text-muted-foreground text-center">
            En Mac usa <ShortcutKey>⌘</ShortcutKey>, en Windows/Linux usa <ShortcutKey>Ctrl</ShortcutKey>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default KeyboardShortcutsModal;
