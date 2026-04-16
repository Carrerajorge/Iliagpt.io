import { memo, useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { 
  Edit3, 
  Check, 
  X, 
  Copy, 
  Download, 
  Maximize2,
  Code,
  FileText,
  Table,
  Undo,
  Redo,
  Save
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type ArtifactType = "code" | "text" | "markdown" | "json" | "table";

interface EditableArtifactProps {
  content: string;
  type: ArtifactType;
  language?: string;
  title?: string;
  onSave?: (content: string) => void;
  onCopy?: () => void;
  onDownload?: () => void;
  onExpand?: () => void;
  className?: string;
  readOnly?: boolean;
}

export const EditableArtifact = memo(function EditableArtifact({
  content,
  type,
  language,
  title,
  onSave,
  onCopy,
  onDownload,
  onExpand,
  className,
  readOnly = false,
}: EditableArtifactProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(content);
  const [history, setHistory] = useState<string[]>([content]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const typeIcons = {
    code: Code,
    text: FileText,
    markdown: FileText,
    json: Code,
    table: Table,
  };
  const Icon = typeIcons[type];

  const handleEdit = useCallback(() => {
    setIsEditing(true);
    setEditedContent(content);
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, [content]);

  const handleSave = useCallback(() => {
    if (editedContent !== content) {
      onSave?.(editedContent);
      setHistory(prev => [...prev.slice(0, historyIndex + 1), editedContent]);
      setHistoryIndex(prev => prev + 1);
    }
    setIsEditing(false);
  }, [editedContent, content, onSave, historyIndex]);

  const handleCancel = useCallback(() => {
    setEditedContent(content);
    setIsEditing(false);
  }, [content]);

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1);
      setEditedContent(history[historyIndex - 1]);
    }
  }, [historyIndex, history]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(prev => prev + 1);
      setEditedContent(history[historyIndex + 1]);
    }
  }, [historyIndex, history]);

  const handleCopy = useCallback(() => {
    const textToCopy = isEditing ? editedContent : content;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onCopy?.();
  }, [isEditing, editedContent, content, onCopy]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-lg border bg-card overflow-hidden",
        "group",
        className
      )}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          {title && <span className="text-sm font-medium">{title}</span>}
          {language && (
            <Badge variant="secondary" className="text-[10px] h-5">
              {language}
            </Badge>
          )}
        </div>

        <div className={cn(
          "flex items-center gap-1",
          "opacity-0 group-hover:opacity-100 transition-opacity",
          isEditing && "opacity-100"
        )}>
          {isEditing ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleUndo}
                disabled={historyIndex === 0}
                title="Deshacer"
              >
                <Undo className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleRedo}
                disabled={historyIndex >= history.length - 1}
                title="Rehacer"
              >
                <Redo className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-green-600 hover:text-green-700"
                onClick={handleSave}
                title="Guardar"
              >
                <Check className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-red-500 hover:text-red-600"
                onClick={handleCancel}
                title="Cancelar"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </>
          ) : (
            <>
              {!readOnly && onSave && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleEdit}
                  title="Editar"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleCopy}
                title="Copiar"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </Button>
              {onDownload && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onDownload}
                  title="Descargar"
                >
                  <Download className="w-3.5 h-3.5" />
                </Button>
              )}
              {onExpand && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onExpand}
                  title="Expandir"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="relative">
        {isEditing ? (
          <Textarea
            ref={textareaRef}
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className={cn(
              "min-h-[200px] max-h-[500px] resize-y",
              "font-mono text-sm",
              "border-0 rounded-none focus-visible:ring-0",
              "bg-background"
            )}
            onKeyDown={(e) => {
              if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSave();
              }
              if (e.key === "Escape") {
                handleCancel();
              }
            }}
          />
        ) : (
          <pre
            className={cn(
              "p-4 overflow-auto max-h-[400px]",
              "font-mono text-sm",
              "bg-muted/20"
            )}
          >
            <code>{content}</code>
          </pre>
        )}
      </div>

      {isEditing && (
        <div className="px-3 py-1.5 border-t bg-muted/30 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {editedContent.length} caracteres
          </span>
          <span className="text-xs text-muted-foreground">
            Ctrl+S para guardar • Esc para cancelar
          </span>
        </div>
      )}
    </motion.div>
  );
});

export default EditableArtifact;
