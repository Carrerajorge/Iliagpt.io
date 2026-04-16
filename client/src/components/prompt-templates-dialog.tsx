import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { PromptTemplate } from "@/hooks/use-prompt-templates";
import { cn } from "@/lib/utils";

interface PromptTemplatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: PromptTemplate[];
  categories: string[];
  onAdd: (template: { title: string; content: string; category?: string }) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: { title?: string; content?: string; category?: string }) => void;
  onSelect: (content: string) => void;
  onIncrementUsage: (id: string) => void;
}

export function PromptTemplatesDialog({
  open,
  onOpenChange,
  templates,
  categories,
  onAdd,
  onRemove,
  onUpdate,
  onSelect,
  onIncrementUsage,
}: PromptTemplatesDialogProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const filteredTemplates = selectedCategory
    ? templates.filter((t) => t.category === selectedCategory)
    : templates;

  const sortedTemplates = [...filteredTemplates].sort(
    (a, b) => b.usageCount - a.usageCount
  );

  const handleAdd = () => {
    if (newTitle.trim() && newContent.trim()) {
      onAdd({
        title: newTitle.trim(),
        content: newContent.trim(),
        category: newCategory.trim() || undefined,
      });
      setNewTitle("");
      setNewContent("");
      setNewCategory("");
      setIsAdding(false);
    }
  };

  const handleUse = (template: PromptTemplate) => {
    onSelect(template.content);
    onIncrementUsage(template.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            Plantillas de prompts
          </DialogTitle>
          <VisuallyHidden>
            <DialogDescription>Gestiona y utiliza tus plantillas de prompts</DialogDescription>
          </VisuallyHidden>
        </DialogHeader>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant={selectedCategory === null ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setSelectedCategory(null)}
          >
            Todas
          </Badge>
          {categories.map((cat) => (
            <Badge
              key={cat}
              variant={selectedCategory === cat ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </Badge>
          ))}
        </div>

        <ScrollArea className="h-[350px] pr-4">
          {isAdding && (
            <div className="rounded-lg border p-3 mb-3 space-y-2 bg-muted/30">
              <Input
                placeholder="Título de la plantilla"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                autoFocus
              />
              <Textarea
                placeholder="Contenido del prompt..."
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={3}
              />
              <Input
                placeholder="Categoría (opcional)"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsAdding(false);
                    setNewTitle("");
                    setNewContent("");
                    setNewCategory("");
                  }}
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancelar
                </Button>
                <Button size="sm" onClick={handleAdd}>
                  <Check className="h-4 w-4 mr-1" />
                  Guardar
                </Button>
              </div>
            </div>
          )}

          {sortedTemplates.length === 0 && !isAdding ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground">No hay plantillas</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedTemplates.map((template) => (
                <div
                  key={template.id}
                  className="group rounded-lg border p-3 hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => handleUse(template)}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{template.title}</span>
                      {template.category && (
                        <Badge variant="secondary" className="text-xs">
                          {template.category}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-red-500 hover:text-red-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove(template.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {template.content}
                  </p>
                  {template.usageCount > 0 && (
                    <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground/70">
                      <TrendingUp className="h-3 w-3" />
                      Usado {template.usageCount} veces
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {!isAdding && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setIsAdding(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Nueva plantilla
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
