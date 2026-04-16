/**
 * InstructionsIndicator — Compact badge for the chat header showing
 * the count of active persistent instructions. Clicking opens a quick
 * popover with the list and a link to the full management page.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, ExternalLink, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/apiClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

interface QuickInstruction {
  id: string;
  fact: string;
  tags: string[];
  accessCount: number;
}

export function InstructionsIndicator() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [instructions, setInstructions] = useState<QuickInstruction[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const prevCountRef = useRef(0);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch("/api/instructions/status", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.hasActive) {
        setInstructions([]);
        setLoaded(true);
        return;
      }
      const listRes = await apiFetch("/api/instructions", { credentials: "include" });
      if (!listRes.ok) return;
      const listData = await listRes.json();
      const newList: QuickInstruction[] = listData.instructions || [];

      // Detect newly added instruction → show toast
      if (loaded && newList.length > prevCountRef.current && prevCountRef.current > 0) {
        const newest = newList[0];
        if (newest) {
          toast({
            title: "Nueva instrucción detectada",
            description: newest.fact.length > 80 ? newest.fact.slice(0, 77) + "..." : newest.fact,
            duration: 5000,
          });
        }
      }

      prevCountRef.current = newList.length;
      setInstructions(newList);
      setLoaded(true);
    } catch {
      // Non-critical
    }
  }, [user, loaded, toast]);

  useEffect(() => { load(); }, [load]);

  // Refresh when popover opens
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Auto-refresh every 30s to detect new instructions from chat messages
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [user, load]);

  if (!user || !loaded) return null;

  const hasInstructions = instructions.length > 0;

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/api/instructions/${id}`, { method: "DELETE", credentials: "include" });
      setInstructions((prev) => prev.filter((i) => i.id !== id));
    } catch { /* ignore */ }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 gap-1.5 rounded-full text-xs px-2.5 transition-colors",
            hasInstructions
              ? "border border-amber-500/30 bg-amber-500/5 text-amber-400 hover:bg-amber-500/10"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Lightbulb className={cn("h-3.5 w-3.5", hasInstructions && "text-amber-400")} />
          {hasInstructions && (
            <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] bg-amber-500/20 text-amber-300">
              {instructions.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start" sideOffset={8}>
        <div className="p-3 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-medium">Instrucciones activas</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1 text-muted-foreground"
              onClick={() => {
                setOpen(false);
                setLocation("/instructions");
              }}
            >
              Gestionar
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto p-2 space-y-1">
          {!hasInstructions && (
            <div className="py-4 px-3 text-center">
              <Lightbulb className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">
                No tienes instrucciones activas. Escribe algo como "siempre responde en inglés" en el chat.
              </p>
            </div>
          )}
          {instructions.map((inst) => (
            <div
              key={inst.id}
              className="group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/50 transition-colors"
            >
              <span className="text-amber-400 mt-0.5 shrink-0">•</span>
              <p className="text-xs text-muted-foreground flex-1 leading-relaxed">{inst.fact}</p>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(inst.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>

        <div className="p-2 border-t border-border/50">
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 text-xs text-muted-foreground gap-1"
            onClick={() => {
              setOpen(false);
              setLocation("/instructions");
            }}
          >
            <Plus className="h-3 w-3" />
            Añadir nueva instrucción
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
