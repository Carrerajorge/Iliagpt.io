import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Keyboard } from "lucide-react";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const shortcuts = [
  { keys: ["Ctrl/⌘", "Enter"], description: "Enviar mensaje", category: "chat" },
  { keys: ["Escape"], description: "Cancelar generación", category: "chat" },
  { keys: ["Ctrl", "N"], description: "Nuevo chat", category: "navigation" },
  { keys: ["Ctrl", "K"], description: "Búsqueda rápida", category: "navigation" },
  { keys: ["Ctrl", ","], description: "Configuración", category: "navigation" },
  { keys: ["Ctrl", "E"], description: "Exportar chat actual", category: "actions" },
  { keys: ["Ctrl", "T"], description: "Plantillas de prompts", category: "actions" },
  { keys: ["Ctrl", "Shift", "F"], description: "Favoritos", category: "actions" },
  { keys: ["Ctrl", "/"], description: "Mostrar atajos", category: "help" },
  { keys: ["Shift", "Enter"], description: "Nueva línea", category: "chat" },
];

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Atajos de teclado
          </DialogTitle>
          <VisuallyHidden>
            <DialogDescription>Lista de atajos de teclado disponibles</DialogDescription>
          </VisuallyHidden>
        </DialogHeader>
        <div className="space-y-1 py-2">
          {shortcuts.map((shortcut, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between py-2 px-1 rounded hover:bg-muted/50 transition-colors"
            >
              <span className="text-sm text-muted-foreground">
                {shortcut.description}
              </span>
              <div className="flex items-center gap-1">
                {shortcut.keys.map((key, keyIdx) => (
                  <kbd
                    key={keyIdx}
                    className="px-2 py-1 text-xs font-medium bg-muted border border-border rounded shadow-sm"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
