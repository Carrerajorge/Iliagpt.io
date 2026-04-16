import { useState, useCallback } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  MessageSquare,
  Pencil,
  Trash2,
  Check,
  X,
  Info,
  AlertTriangle,
  AlertCircle,
  Lightbulb,
} from "lucide-react";
import type { CodeAnnotation } from "@/hooks/useCodeAnnotations";

export interface CodeAnnotationSidebarProps {
  annotations: CodeAnnotation[];
  onAnnotationClick?: (annotation: CodeAnnotation) => void;
  onEdit?: (id: string, content: string) => void;
  onDelete?: (id: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

const typeConfig = {
  info: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-400",
    dot: "bg-blue-500",
    icon: Info,
  },
  warning: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-400",
    dot: "bg-amber-500",
    icon: AlertTriangle,
  },
  error: {
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    text: "text-red-400",
    dot: "bg-red-500",
    icon: AlertCircle,
  },
  explanation: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-400",
    dot: "bg-emerald-500",
    icon: Lightbulb,
  },
};

interface AnnotationItemProps {
  annotation: CodeAnnotation;
  onClick?: () => void;
  onEdit?: (id: string, content: string) => void;
  onDelete?: (id: string) => void;
}

function AnnotationItem({ annotation, onClick, onEdit, onDelete }: AnnotationItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(annotation.content);

  const config = typeConfig[annotation.type];
  const Icon = config.icon;

  const handleStartEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditContent(annotation.content);
    setIsEditing(true);
  }, [annotation.content]);

  const handleCancelEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditContent(annotation.content);
    setIsEditing(false);
  }, [annotation.content]);

  const handleSaveEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onEdit && editContent.trim()) {
      onEdit(annotation.id, editContent.trim());
    }
    setIsEditing(false);
  }, [onEdit, annotation.id, editContent]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete(annotation.id);
    }
  }, [onDelete, annotation.id]);

  return (
    <div
      className={cn(
        "group rounded-lg border p-3 transition-all duration-200",
        config.border,
        "hover:bg-zinc-800/50 cursor-pointer"
      )}
      onClick={onClick}
      data-testid={`sidebar-annotation-${annotation.id}`}
    >
      <div className="flex items-start gap-2">
        <div className={cn("p-1.5 rounded", config.bg)}>
          <Icon className={cn("w-3.5 h-3.5", config.text)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className={cn("text-xs font-medium", config.text)}>
              Line {annotation.line}
            </span>
            {!isEditing && (
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {onEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleStartEdit}
                    className="h-6 w-6 p-0 text-zinc-400 hover:text-white hover:bg-zinc-700"
                    data-testid={`sidebar-edit-${annotation.id}`}
                  >
                    <Pencil className="w-3 h-3" />
                  </Button>
                )}
                {onDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDelete}
                    className="h-6 w-6 p-0 text-zinc-400 hover:text-red-400 hover:bg-red-500/10"
                    data-testid={`sidebar-delete-${annotation.id}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
              </div>
            )}
          </div>

          {isEditing ? (
            <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="min-h-[60px] text-xs bg-zinc-800 border-zinc-700 resize-none"
                autoFocus
                data-testid={`sidebar-edit-textarea-${annotation.id}`}
              />
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancelEdit}
                  className="h-6 px-2 text-xs text-zinc-400"
                  data-testid={`sidebar-cancel-${annotation.id}`}
                >
                  <X className="w-3 h-3 mr-1" />
                  Cancel
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSaveEdit}
                  className={cn("h-6 px-2 text-xs", config.text)}
                  data-testid={`sidebar-save-${annotation.id}`}
                >
                  <Check className="w-3 h-3 mr-1" />
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <p
              className="text-xs text-zinc-400 line-clamp-2"
              data-testid={`sidebar-content-${annotation.id}`}
            >
              {annotation.content}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function CodeAnnotationSidebar({
  annotations,
  onAnnotationClick,
  onEdit,
  onDelete,
  isOpen,
  onToggle,
}: CodeAnnotationSidebarProps) {
  const sortedAnnotations = [...annotations].sort((a, b) => a.line - b.line);

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <div
        className="border-l border-zinc-800 bg-zinc-900/50 h-full flex flex-col"
        data-testid="annotation-sidebar"
      >
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full flex items-center justify-between px-3 py-2 h-10 rounded-none border-b border-zinc-800 hover:bg-zinc-800"
            data-testid="sidebar-toggle"
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-zinc-400" />
              <span className="text-sm text-zinc-300">Annotations</span>
              <span className="text-xs text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
                {annotations.length}
              </span>
            </div>
            <ChevronRight
              className={cn(
                "w-4 h-4 text-zinc-400 transition-transform duration-200",
                isOpen && "rotate-90"
              )}
            />
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="flex-1 overflow-hidden">
          <ScrollArea className="h-full" data-testid="sidebar-scroll-area">
            <div className="p-2 space-y-2">
              {sortedAnnotations.length === 0 ? (
                <div
                  className="text-center py-8 text-zinc-500 text-sm"
                  data-testid="sidebar-empty"
                >
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No annotations yet</p>
                  <p className="text-xs mt-1">
                    Click on a line to add one
                  </p>
                </div>
              ) : (
                sortedAnnotations.map((annotation) => (
                  <AnnotationItem
                    key={annotation.id}
                    annotation={annotation}
                    onClick={() => onAnnotationClick?.(annotation)}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export default CodeAnnotationSidebar;
