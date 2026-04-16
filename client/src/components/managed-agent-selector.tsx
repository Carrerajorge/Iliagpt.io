import React, { useEffect } from "react";
import { Bot, Code, Search, FileText, BarChart3, X, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useManagedAgentStore, type ManagedAgentPreset } from "@/stores/managed-agent-store";

const ICON_MAP: Record<string, React.ElementType> = {
  code: Code,
  search: Search,
  "file-text": FileText,
  "bar-chart": BarChart3,
};

function PresetIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = ICON_MAP[icon] ?? Bot;
  return <Icon className={cn("h-4 w-4", className)} />;
}

export function ManagedAgentSelector() {
  const { presets, presetsLoaded, loadPresets, selectedPresetKey, setSelectedPresetKey } =
    useManagedAgentStore();
  const [open, setOpen] = React.useState(false);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  if (!presetsLoaded || presets.length === 0) return null;

  const selected = presets.find((p) => p.key === selectedPresetKey);

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "flex items-center gap-1.5 rounded-full text-xs px-2.5 h-7 transition-colors",
              selected
                ? "border-violet-400/60 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
                : "border-muted-foreground/20 hover:border-muted-foreground/40",
            )}
          >
            {selected ? (
              <>
                <PresetIcon icon={selected.icon} className="h-3.5 w-3.5" />
                <span className="max-w-[80px] truncate">{selected.name}</span>
                <Sparkles className="h-3 w-3 text-violet-400" />
              </>
            ) : (
              <>
                <Bot className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Agentes</span>
              </>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="start" sideOffset={8}>
          <div className="mb-2 px-2 pt-1">
            <p className="text-xs font-medium text-muted-foreground">Claude Managed Agents</p>
          </div>

          {/* None / Direct LLM option */}
          <button
            className={cn(
              "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted",
              !selectedPresetKey && "bg-muted",
            )}
            onClick={() => {
              setSelectedPresetKey(null);
              setOpen(false);
            }}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted-foreground/10">
              <Bot className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">LLM Directo</p>
              <p className="text-xs text-muted-foreground truncate">Sin agente — respuesta directa del modelo</p>
            </div>
            {!selectedPresetKey && <Badge variant="secondary" className="text-[10px] px-1.5">Activo</Badge>}
          </button>

          {presets.map((preset) => (
            <PresetCard
              key={preset.key}
              preset={preset}
              isSelected={selectedPresetKey === preset.key}
              onSelect={() => {
                setSelectedPresetKey(preset.key);
                setOpen(false);
              }}
            />
          ))}
        </PopoverContent>
      </Popover>

      {/* Quick clear button when agent is selected */}
      {selected && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 rounded-full text-muted-foreground hover:text-foreground"
          onClick={() => setSelectedPresetKey(null)}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

function PresetCard({
  preset,
  isSelected,
  onSelect,
}: {
  preset: ManagedAgentPreset;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={cn(
        "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted",
        isSelected && "bg-violet-500/10 border border-violet-400/30",
      )}
      onClick={onSelect}
    >
      <div
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg",
          isSelected ? "bg-violet-500/20 text-violet-400" : "bg-muted-foreground/10 text-muted-foreground",
        )}
      >
        <PresetIcon icon={preset.icon} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{preset.name}</p>
        <p className="text-xs text-muted-foreground truncate">{preset.description}</p>
      </div>
      {isSelected && <Badge variant="secondary" className="text-[10px] px-1.5 bg-violet-500/20 text-violet-300">Activo</Badge>}
    </button>
  );
}
