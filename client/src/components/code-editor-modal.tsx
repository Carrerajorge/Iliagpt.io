import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { MonacoCodeEditor } from "./monaco-code-editor";
import { Save, X, Code2 } from "lucide-react";

export interface CodeEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
  language?: string;
  title?: string;
  onSave?: (code: string) => void;
  onCancel?: () => void;
  readOnly?: boolean;
}

export function CodeEditorModal({
  open,
  onOpenChange,
  code,
  language = "javascript",
  title,
  onSave,
  onCancel,
  readOnly = false,
}: CodeEditorModalProps) {
  const [currentCode, setCurrentCode] = useState(code);

  const handleChange = useCallback((value: string) => {
    setCurrentCode(value);
  }, []);

  const handleSave = useCallback(() => {
    onSave?.(currentCode);
    onOpenChange(false);
  }, [currentCode, onSave, onOpenChange]);

  const handleCancel = useCallback(() => {
    setCurrentCode(code);
    onCancel?.();
    onOpenChange(false);
  }, [code, onCancel, onOpenChange]);

  const handleKeyboardSave = useCallback(
    (value: string) => {
      onSave?.(value);
      onOpenChange(false);
    },
    [onSave, onOpenChange]
  );

  const displayTitle = title || `Edit ${language.charAt(0).toUpperCase() + language.slice(1)} Code`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[95vw] w-[1200px] h-[85vh] flex flex-col p-0 gap-0 bg-zinc-950 border-zinc-800"
        data-testid="code-editor-modal"
      >
        <DialogHeader className="px-4 py-3 border-b border-zinc-800 flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-zinc-100">
            <Code2 className="w-5 h-5 text-blue-400" />
            <span>{displayTitle}</span>
            <span className="ml-2 text-xs font-mono text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">
              {language}
            </span>
            {readOnly && (
              <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
                Read-only
              </span>
            )}
          </DialogTitle>
          <VisuallyHidden>
            <DialogDescription>Editor de código con resaltado de sintaxis</DialogDescription>
          </VisuallyHidden>
        </DialogHeader>

        <div className="flex-1 overflow-hidden p-2" data-testid="code-editor-container">
          <MonacoCodeEditor
            code={currentCode}
            language={language}
            readOnly={readOnly}
            onChange={handleChange}
            onSave={handleKeyboardSave}
            onCancel={handleCancel}
            height="100%"
            theme="auto"
            showMinimap={true}
            className="h-full"
          />
        </div>

        <DialogFooter className="px-4 py-3 border-t border-zinc-800 flex-shrink-0">
          <div className="flex items-center justify-between w-full">
            <div className="text-xs text-zinc-500">
              <span className="hidden sm:inline">
                Press <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">Ctrl+S</kbd> to save,{" "}
                <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">Esc</kbd> to cancel
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleCancel}
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                data-testid="button-cancel-edit"
              >
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
              {!readOnly && (
                <Button
                  onClick={handleSave}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                  data-testid="button-save-code"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Save
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
