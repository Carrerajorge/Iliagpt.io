import { useState, useCallback } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Pencil, Trash2, Check, X, Info, AlertTriangle, AlertCircle, Lightbulb } from "lucide-react";
import type { CodeAnnotation } from "@/hooks/useCodeAnnotations";

export interface CodeAnnotationTooltipProps {
  annotation: CodeAnnotation;
  onEdit?: (id: string, content: string) => void;
  onDelete?: (id: string) => void;
  trigger: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

const typeStyles = {
  info: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-400",
    icon: Info,
    label: "Info",
  },
  warning: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-400",
    icon: AlertTriangle,
    label: "Warning",
  },
  error: {
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    text: "text-red-400",
    icon: AlertCircle,
    label: "Error",
  },
  explanation: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-400",
    icon: Lightbulb,
    label: "Explanation",
  },
};

export function CodeAnnotationTooltip({
  annotation,
  onEdit,
  onDelete,
  trigger,
  side = 'right',
}: CodeAnnotationTooltipProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(annotation.content);
  const [open, setOpen] = useState(false);

  const style = typeStyles[annotation.type];
  const Icon = style.icon;

  const handleStartEdit = useCallback(() => {
    setEditContent(annotation.content);
    setIsEditing(true);
  }, [annotation.content]);

  const handleCancelEdit = useCallback(() => {
    setEditContent(annotation.content);
    setIsEditing(false);
  }, [annotation.content]);

  const handleSaveEdit = useCallback(() => {
    if (onEdit && editContent.trim()) {
      onEdit(annotation.id, editContent.trim());
    }
    setIsEditing(false);
  }, [onEdit, annotation.id, editContent]);

  const handleDelete = useCallback(() => {
    if (onDelete) {
      onDelete(annotation.id);
    }
    setOpen(false);
  }, [onDelete, annotation.id]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild data-testid={`annotation-trigger-${annotation.id}`}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        className={cn(
          "w-80 p-0 border",
          style.border,
          "bg-zinc-900"
        )}
        data-testid={`annotation-tooltip-${annotation.id}`}
      >
        <div className={cn("px-3 py-2 border-b flex items-center gap-2", style.border, style.bg)}>
          <Icon className={cn("w-4 h-4", style.text)} />
          <span className={cn("text-xs font-medium", style.text)}>
            {style.label}
          </span>
          <span className="text-xs text-zinc-500 ml-auto">
            Line {annotation.line}
          </span>
        </div>

        <div className="p-3">
          {isEditing ? (
            <div className="space-y-2">
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="min-h-[80px] text-sm bg-zinc-800 border-zinc-700 resize-none"
                placeholder="Enter annotation..."
                autoFocus
                data-testid={`annotation-edit-textarea-${annotation.id}`}
              />
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancelEdit}
                  className="h-7 px-2 text-zinc-400 hover:text-white"
                  data-testid={`annotation-cancel-edit-${annotation.id}`}
                >
                  <X className="w-3.5 h-3.5 mr-1" />
                  Cancel
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSaveEdit}
                  className={cn("h-7 px-2", style.text, "hover:bg-zinc-800")}
                  data-testid={`annotation-save-edit-${annotation.id}`}
                >
                  <Check className="w-3.5 h-3.5 mr-1" />
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p
                className="text-sm text-zinc-300 whitespace-pre-wrap"
                data-testid={`annotation-content-${annotation.id}`}
              >
                {annotation.content}
              </p>
              <div className="flex justify-end gap-1 mt-3 pt-2 border-t border-zinc-800">
                {onEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleStartEdit}
                    className="h-7 px-2 text-zinc-400 hover:text-white hover:bg-zinc-800"
                    data-testid={`annotation-edit-button-${annotation.id}`}
                  >
                    <Pencil className="w-3.5 h-3.5 mr-1" />
                    Edit
                  </Button>
                )}
                {onDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDelete}
                    className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    data-testid={`annotation-delete-button-${annotation.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    Delete
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default CodeAnnotationTooltip;
