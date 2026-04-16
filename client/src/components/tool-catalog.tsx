import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Search,
  Zap,
  Terminal,
  Globe,
  Sparkles,
  Cog,
  Database,
  FileText,
  Code,
  GitBranch,
  Plug,
  Calendar,
  Shield,
  Repeat,
  HardDrive,
  Activity,
  Brain,
  Lightbulb,
  Layers,
  MessageCircle,
  Wrench,
  X,
  ChevronRight,
  Command,
} from "lucide-react";
import Fuse from "fuse.js";

interface Tool {
  name: string;
  description: string;
  category: string;
  icon: string;
}

interface Category {
  name: string;
  icon: string;
  count: number;
}

interface ToolsResponse {
  success: boolean;
  count: number;
  tools: Tool[];
  categories: Category[];
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  zap: Zap,
  terminal: Terminal,
  globe: Globe,
  sparkles: Sparkles,
  cog: Cog,
  database: Database,
  "file-text": FileText,
  code: Code,
  "git-branch": GitBranch,
  plug: Plug,
  calendar: Calendar,
  shield: Shield,
  repeat: Repeat,
  "hard-drive": HardDrive,
  activity: Activity,
  brain: Brain,
  lightbulb: Lightbulb,
  layers: Layers,
  "message-circle": MessageCircle,
  wrench: Wrench,
};

function getIcon(iconName: string) {
  return ICON_MAP[iconName] || Wrench;
}

interface ToolCatalogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectTool?: (tool: Tool) => void;
}

export function ToolCatalog({ open, onOpenChange, onSelectTool }: ToolCatalogProps) {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { data, isLoading } = useQuery<ToolsResponse>({
    queryKey: ["/api/tools"],
    enabled: open,
  });

  const fuse = useMemo(() => {
    if (!data?.tools) return null;
    return new Fuse(data.tools, {
      keys: [
        { name: "name", weight: 0.7 },
        { name: "description", weight: 0.3 },
      ],
      threshold: 0.4,
      includeScore: true,
    });
  }, [data?.tools]);

  const filteredTools = useMemo(() => {
    if (!data?.tools) return [];
    
    let tools = data.tools;
    
    if (selectedCategory !== "all") {
      tools = tools.filter(t => t.category === selectedCategory);
    }
    
    if (query.trim() && fuse) {
      const results = fuse.search(query);
      const matchedNames = new Set(results.map(r => r.item.name));
      tools = tools.filter(t => matchedNames.has(t.name));
    }
    
    return tools;
  }, [data?.tools, selectedCategory, query, fuse]);

  const groupedTools = useMemo(() => {
    const grouped: Record<string, Tool[]> = {};
    for (const tool of filteredTools) {
      if (!grouped[tool.category]) {
        grouped[tool.category] = [];
      }
      grouped[tool.category].push(tool);
    }
    return grouped;
  }, [filteredTools]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedCategory("all");
      setSelectedIndex(0);
    }
  }, [open]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, filteredTools.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && filteredTools.length > 0) {
      e.preventDefault();
      const tool = filteredTools[selectedIndex];
      if (tool && onSelectTool) {
        onSelectTool(tool);
        onOpenChange(false);
      }
    }
  }, [filteredTools, selectedIndex, onSelectTool, onOpenChange]);

  const handleSelectTool = (tool: Tool) => {
    if (onSelectTool) {
      onSelectTool(tool);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-3xl p-0 gap-0 overflow-hidden rounded-xl"
        onKeyDown={handleKeyDown}
        data-testid="modal-tool-catalog"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Tool Catalog</DialogTitle>
          <DialogDescription>Browse and search available tools</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/30">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search tools by name or description..."
            className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-8 text-sm bg-transparent"
            autoFocus
            data-testid="input-tool-search"
          />
          {query && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 flex-shrink-0"
              onClick={() => setQuery("")}
              data-testid="button-clear-tool-search"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground border-l pl-3">
            <Command className="h-3 w-3" />
            <span>+K</span>
          </div>
        </div>

        <div className="flex h-[500px]">
          <div className="w-48 border-r bg-muted/20 p-2">
            <div className="text-xs font-medium text-muted-foreground px-2 py-1.5 mb-1">
              Categories
            </div>
            <button
              className={cn(
                "w-full px-2 py-1.5 rounded-md text-left text-sm flex items-center gap-2 transition-colors",
                selectedCategory === "all" 
                  ? "bg-primary text-primary-foreground" 
                  : "hover:bg-muted"
              )}
              onClick={() => setSelectedCategory("all")}
              data-testid="button-category-all"
            >
              <Layers className="h-4 w-4" />
              <span>All Tools</span>
              <Badge variant="secondary" className="ml-auto text-[10px] h-5">
                {data?.count || 0}
              </Badge>
            </button>
            
            <ScrollArea className="h-[420px] mt-2">
              <div className="space-y-0.5">
                {data?.categories?.map(cat => {
                  const IconComp = getIcon(cat.icon);
                  return (
                    <button
                      key={cat.name}
                      className={cn(
                        "w-full px-2 py-1.5 rounded-md text-left text-sm flex items-center gap-2 transition-colors",
                        selectedCategory === cat.name 
                          ? "bg-primary text-primary-foreground" 
                          : "hover:bg-muted"
                      )}
                      onClick={() => setSelectedCategory(cat.name)}
                      data-testid={`button-category-${cat.name.toLowerCase()}`}
                    >
                      <IconComp className="h-4 w-4" />
                      <span className="truncate flex-1">{cat.name}</span>
                      <Badge 
                        variant={selectedCategory === cat.name ? "outline" : "secondary"} 
                        className="text-[10px] h-5"
                      >
                        {cat.count}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          <div className="flex-1 flex flex-col">
            <div className="px-4 py-2 border-b bg-muted/10 flex items-center justify-between">
              <span className="text-sm font-medium">
                {selectedCategory === "all" ? "All Tools" : selectedCategory}
              </span>
              <span className="text-xs text-muted-foreground">
                {filteredTools.length} tool{filteredTools.length !== 1 ? "s" : ""}
              </span>
            </div>
            
            <ScrollArea className="flex-1">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-sm text-muted-foreground">Loading tools...</div>
                </div>
              ) : filteredTools.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-12">
                  <Wrench className="h-10 w-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">No tools found</p>
                  {query && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Try a different search term
                    </p>
                  )}
                </div>
              ) : (
                <div className="p-2">
                  {selectedCategory === "all" ? (
                    Object.entries(groupedTools).map(([category, tools]) => (
                      <div key={category} className="mb-4 last:mb-0">
                        <div className="text-xs font-medium text-muted-foreground px-2 py-1.5 flex items-center gap-2">
                          {(() => {
                            const catData = data?.categories?.find(c => c.name === category);
                            const IconComp = catData ? getIcon(catData.icon) : Wrench;
                            return <IconComp className="h-3.5 w-3.5" />;
                          })()}
                          {category}
                        </div>
                        <div className="space-y-0.5">
                          {tools.map((tool, idx) => {
                            const globalIdx = filteredTools.indexOf(tool);
                            return (
                              <ToolItem
                                key={tool.name}
                                tool={tool}
                                isSelected={globalIdx === selectedIndex}
                                onClick={() => handleSelectTool(tool)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="space-y-0.5">
                      {filteredTools.map((tool, idx) => (
                        <ToolItem
                          key={tool.name}
                          tool={tool}
                          isSelected={idx === selectedIndex}
                          onClick={() => handleSelectTool(tool)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        <div className="border-t px-4 py-2 flex items-center justify-between text-[10px] text-muted-foreground bg-muted/20">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-background border rounded font-mono">↑↓</kbd>
              <span>navigate</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-background border rounded font-mono">↵</kbd>
              <span>select</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-background border rounded font-mono">esc</kbd>
              <span>close</span>
            </div>
          </div>
          <span>Press ⌘+K anytime to open</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ToolItemProps {
  tool: Tool;
  isSelected: boolean;
  onClick: () => void;
}

function ToolItem({ tool, isSelected, onClick }: ToolItemProps) {
  const IconComp = getIcon(tool.icon);
  
  return (
    <button
      className={cn(
        "w-full px-3 py-2.5 rounded-lg text-left flex items-start gap-3 transition-colors group",
        isSelected ? "bg-accent" : "hover:bg-muted/50"
      )}
      onClick={onClick}
      data-testid={`tool-item-${tool.name}`}
    >
      <div className={cn(
        "p-1.5 rounded-md",
        isSelected ? "bg-primary/20" : "bg-muted"
      )}>
        <IconComp className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{tool.name}</span>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5">
            {tool.category}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {tool.description}
        </p>
      </div>
      <ChevronRight className={cn(
        "h-4 w-4 text-muted-foreground flex-shrink-0 mt-1 transition-opacity",
        isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      )} />
    </button>
  );
}

export function useToolSuggestions(input: string) {
  const { data } = useQuery<ToolsResponse>({
    queryKey: ["/api/tools"],
    staleTime: 5 * 60 * 1000,
  });

  const suggestions = useMemo(() => {
    if (!input || input.length < 2 || !data?.tools) return [];
    
    const lowerInput = input.toLowerCase();
    const intentMatches: Array<{ tool: Tool; score: number }> = [];
    
    const intentKeywords: Record<string, string[]> = {
      search: ["search", "find", "look for", "buscar", "encontrar"],
      document: ["document", "word", "create doc", "documento", "crear documento"],
      browser: ["browse", "open", "visit", "navigate", "url", "web", "página", "navegar"],
      slides: ["presentation", "slides", "ppt", "powerpoint", "presentación", "diapositivas"],
      generate: ["generate", "create", "make", "generar", "crear"],
      python: ["python", "script", "code", "run", "execute", "ejecutar", "código"],
      file: ["file", "read", "write", "save", "archivo", "leer", "guardar"],
      research: ["research", "investigate", "analyze", "investigar", "analizar"],
      shell: ["command", "terminal", "shell", "bash", "comando"],
      plan: ["plan", "organize", "task", "planificar", "organizar", "tarea"],
    };
    
    for (const tool of data.tools) {
      const keywords = intentKeywords[tool.name.toLowerCase()] || [];
      for (const keyword of keywords) {
        if (lowerInput.includes(keyword)) {
          intentMatches.push({ tool, score: keyword.length / lowerInput.length });
        }
      }
      
      if (tool.description.toLowerCase().includes(lowerInput)) {
        intentMatches.push({ tool, score: 0.3 });
      }
    }
    
    intentMatches.sort((a, b) => b.score - a.score);
    
    const seen = new Set<string>();
    return intentMatches
      .filter(m => {
        if (seen.has(m.tool.name)) return false;
        seen.add(m.tool.name);
        return true;
      })
      .slice(0, 3)
      .map(m => m.tool);
  }, [input, data?.tools]);

  return suggestions;
}
