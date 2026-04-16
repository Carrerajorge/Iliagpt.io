/**
 * Instructions Management — Premium UI
 *
 * Features:
 * - Quick-add bar inline (no dialog for creation)
 * - Grouped by topic with collapsible section headers
 * - Framer motion staggered enter/exit animations
 * - Glassmorphism card hover effects
 * - Inline editing with auto-focus
 * - Confidence bar + usage sparkline
 * - Optimistic delete with undo toast
 * - Test detector panel (expandable)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import {
  Lightbulb, Plus, Pencil, Trash2, Search, Globe, MoreHorizontal,
  Sparkles, ShieldCheck, Languages, Palette, FileText, Type, Zap,
  RefreshCw, ArrowLeft, Clock, BarChart3, CheckCircle2, AlertCircle,
  ChevronDown, ChevronRight, Send, X, FlaskConical, Hash,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { apiFetch } from "@/lib/apiClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types & config
// ---------------------------------------------------------------------------

interface Instruction {
  id: string;
  fact: string;
  category: string;
  confidence: number;
  salienceScore: number;
  scope: string;
  tags: string[];
  metadata: Record<string, unknown>;
  accessCount: number;
  createdAt: string;
  updatedAt: string;
}

const TOPICS: Record<string, { icon: React.ElementType; color: string; bg: string; label: string; labelEn: string }> = {
  language:   { icon: Languages,  color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/20",    label: "Idioma",          labelEn: "Language" },
  tone:       { icon: Palette,    color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20", label: "Tono y estilo",   labelEn: "Tone & Style" },
  format:     { icon: FileText,   color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", label: "Formato",      labelEn: "Format" },
  content:    { icon: Type,       color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20", label: "Contenido",       labelEn: "Content" },
  behavior:   { icon: Zap,        color: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/20",  label: "Comportamiento",  labelEn: "Behavior" },
  preference: { icon: Sparkles,   color: "text-pink-400",   bg: "bg-pink-500/10 border-pink-500/20",    label: "Preferencias",    labelEn: "Preferences" },
  context:    { icon: ShieldCheck, color: "text-cyan-400",  bg: "bg-cyan-500/10 border-cyan-500/20",    label: "Contexto",        labelEn: "Context" },
  meta:       { icon: Globe,      color: "text-slate-400",  bg: "bg-slate-500/10 border-slate-500/20",  label: "Meta",            labelEn: "Meta" },
  general:    { icon: Lightbulb,  color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/20", label: "General",         labelEn: "General" },
};

function topicOf(tags: string[]): string {
  return tags?.find((t) => t.startsWith("topic:"))?.slice(6) || "general";
}

function ago(d: string): string {
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "ahora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const day = Math.floor(h / 24);
  return day < 30 ? `${day}d` : `${Math.floor(day / 30)}mo`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatPill({ value, label, icon: Icon, accent }: { value: number | string; label: string; icon: React.ElementType; accent: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm">
      <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center", accent)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div>
        <p className="text-lg font-semibold leading-none tabular-nums">{value}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 cursor-default">
          <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
            <motion.div
              className={cn("h-full rounded-full", pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-400")}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground">{pct}%</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">Confianza de detección: {pct}%</TooltipContent>
    </Tooltip>
  );
}

function InstructionRow({
  inst, isEditing, editText, onStartEdit, onCancelEdit, onSave, onDelete, onEditChange,
}: {
  inst: Instruction; isEditing: boolean; editText: string;
  onStartEdit: () => void; onCancelEdit: () => void;
  onSave: () => void; onDelete: () => void;
  onEditChange: (v: string) => void;
}) {
  const topic = topicOf(inst.tags);
  const t = TOPICS[topic] || TOPICS.general;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
      className={cn(
        "group relative flex items-start gap-3 px-3.5 py-3 rounded-lg transition-all",
        "hover:bg-muted/40",
        isEditing && "bg-muted/50 ring-1 ring-primary/20",
      )}
    >
      {/* Left accent bar */}
      <div className={cn("absolute left-0 top-3 bottom-3 w-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity", t.color.replace("text-", "bg-"))} />

      {/* Icon */}
      <div className={cn("h-7 w-7 rounded-md flex items-center justify-center shrink-0 border", t.bg)}>
        <t.icon className={cn("h-3.5 w-3.5", t.color)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="space-y-2">
            <Textarea value={editText} onChange={(e) => onEditChange(e.target.value)} rows={2} autoFocus className="text-sm" />
            <div className="flex gap-2">
              <Button size="sm" className="h-6 text-xs px-2.5" onClick={onSave}>Guardar</Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={onCancelEdit}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed pr-6">{inst.fact}</p>
            <div className="flex items-center gap-3 mt-1.5">
              <ConfidenceBar value={inst.confidence || 0.8} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[10px] text-muted-foreground tabular-nums flex items-center gap-0.5">
                    <BarChart3 className="h-2.5 w-2.5" />{inst.accessCount || 0}
                  </span>
                </TooltipTrigger>
                <TooltipContent>Inyectada {inst.accessCount || 0} veces en prompts</TooltipContent>
              </Tooltip>
              <span className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" />{ago(inst.createdAt)}
              </span>
              {inst.scope !== "global" && (
                <Badge variant="outline" className="text-[9px] h-4 px-1">{inst.scope}</Badge>
              )}
            </div>
          </>
        )}
      </div>

      {/* Actions (hover) */}
      {!isEditing && (
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onStartEdit}>
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-3 w-3 text-muted-foreground" />
          </Button>
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InstructionsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const quickAddRef = useRef<HTMLInputElement>(null);

  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Quick-add
  const [quickText, setQuickText] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  // Edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  // Test panel
  const [testOpen, setTestOpen] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);

  // Collapsed topic groups
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // ── Data ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const res = await apiFetch("/api/instructions", { credentials: "include" });
      if (res.ok) {
        const d = await res.json();
        setInstructions(d.instructions || []);
      }
    } catch { /* ignore */ }
    setIsLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // ── Actions ───────────────────────────────────────────────────────────
  const handleQuickAdd = async () => {
    const text = quickText.trim();
    if (!text) return;
    setIsAdding(true);
    try {
      const res = await apiFetch("/api/instructions", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        setQuickText("");
        toast({ title: "Instrucción creada" });
        load();
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
    setIsAdding(false);
  };

  const handleUpdate = async (id: string) => {
    if (!editText.trim()) return;
    try {
      await apiFetch(`/api/instructions/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: editText.trim() }),
      });
      setEditId(null);
      load();
    } catch { toast({ title: "Error al actualizar", variant: "destructive" }); }
  };

  const handleDelete = (id: string) => {
    const removed = instructions.find((i) => i.id === id);
    if (!removed) return;
    setInstructions((p) => p.filter((i) => i.id !== id));

    const timer = setTimeout(async () => {
      try { await apiFetch(`/api/instructions/${id}`, { method: "DELETE", credentials: "include" }); }
      catch { setInstructions((p) => [...p, removed]); }
    }, 4000);

    toast({
      title: "Eliminada",
      description: removed.fact.slice(0, 60),
      duration: 4000,
      action: <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => {
        clearTimeout(timer);
        setInstructions((p) => [...p, removed].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      }}>Deshacer</Button>,
    });
  };

  const handleTest = async () => {
    if (!testMsg.trim()) return;
    setTesting(true);
    try {
      const r = await apiFetch("/api/instructions/detect", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: testMsg, useLLM: true }),
      });
      setTestResult(await r.json());
    } catch { /* ignore */ }
    setTesting(false);
  };

  // ── Derived ───────────────────────────────────────────────────────────
  const filtered = instructions.filter((i) =>
    !search || i.fact.toLowerCase().includes(search.toLowerCase()),
  );

  // Group by topic, preserve order
  const groups: Array<{ topic: string; items: Instruction[] }> = [];
  const seen = new Map<string, Instruction[]>();
  for (const inst of filtered) {
    const t = topicOf(inst.tags);
    if (!seen.has(t)) { seen.set(t, []); groups.push({ topic: t, items: seen.get(t)! }); }
    seen.get(t)!.push(inst);
  }

  const totalUsage = instructions.reduce((s, i) => s + (i.accessCount || 0), 0);
  const avgConfidence = instructions.length ? Math.round(instructions.reduce((s, i) => s + (i.confidence || 0), 0) / instructions.length * 100) : 0;

  const toggleCollapse = (topic: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    next.has(topic) ? next.delete(topic) : next.add(topic);
    return next;
  });

  // ── Render ────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <Lightbulb className="h-10 w-10 mx-auto text-muted-foreground/30" />
          <p className="text-muted-foreground">Inicia sesión para gestionar instrucciones.</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setLocation("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
              <Lightbulb className="h-4.5 w-4.5 text-amber-400" />
              Instrucciones
            </h1>
            <p className="text-xs text-muted-foreground">Directivas persistentes que IliaGPT sigue en cada respuesta</p>
          </div>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setTestOpen(!testOpen)}>
              <FlaskConical className="h-3 w-3" />
              <span className="hidden sm:inline">Probar</span>
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={load} disabled={isLoading}>
              <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* ── Stats row ───────────────────────────────────────────── */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <StatPill value={instructions.length} label="Activas" icon={Lightbulb} accent="bg-amber-500/10 text-amber-400" />
          <StatPill value={totalUsage} label="Inyecciones" icon={BarChart3} accent="bg-blue-500/10 text-blue-400" />
          <StatPill value={groups.length} label="Categorías" icon={Hash} accent="bg-emerald-500/10 text-emerald-400" />
          <StatPill value={`${avgConfidence}%`} label="Confianza" icon={CheckCircle2} accent="bg-violet-500/10 text-violet-400" />
        </div>

        {/* ── Quick-add bar ───────────────────────────────────────── */}
        <div className="relative">
          <Input
            ref={quickAddRef}
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleQuickAdd(); } }}
            placeholder='Escribe una instrucción... ej: "siempre responde en inglés"'
            className="pr-20 h-10 bg-muted/30 border-dashed focus:border-solid text-sm"
            disabled={isAdding}
          />
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex gap-1">
            {quickText && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setQuickText("")}>
                <X className="h-3 w-3" />
              </Button>
            )}
            <Button
              size="sm"
              className="h-7 text-xs gap-1 rounded-md"
              onClick={handleQuickAdd}
              disabled={isAdding || !quickText.trim()}
            >
              <Send className="h-3 w-3" />
              Crear
            </Button>
          </div>
        </div>

        {/* ── Search (only when > 5 instructions) ─────────────────── */}
        {instructions.length > 5 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar instrucciones..."
              className="pl-8 h-8 text-xs"
            />
          </div>
        )}

        {/* ── Test panel (collapsible) ────────────────────────────── */}
        <AnimatePresence>
          {testOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <Card className="border-dashed">
                <CardContent className="p-4 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground">Probador de detección</p>
                  <Textarea
                    value={testMsg}
                    onChange={(e) => setTestMsg(e.target.value)}
                    placeholder='Escribe un mensaje para probar, ej: "nunca uses markdown"'
                    rows={2}
                    className="text-sm"
                  />
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="h-7 text-xs" onClick={handleTest} disabled={testing || !testMsg.trim()}>
                      {testing ? "Analizando..." : "Analizar"}
                    </Button>
                    {testResult && (
                      <div className="flex items-center gap-1.5 text-xs">
                        {testResult.found
                          ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /><span className="text-emerald-400">Detectada</span></>
                          : <><AlertCircle className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-muted-foreground">No detectada</span></>
                        }
                        <Badge variant="outline" className="text-[9px] h-4">{testResult.stage}</Badge>
                        <Badge variant="outline" className="text-[9px] h-4">{testResult.durationMs}ms</Badge>
                      </div>
                    )}
                  </div>
                  {testResult?.instructions?.map((inst: any, i: number) => (
                    <div key={i} className="rounded-md bg-muted/50 px-3 py-2 text-xs space-y-1">
                      <p className="font-medium">{inst.normalized || inst.rawText}</p>
                      <div className="flex gap-1">
                        <Badge variant="secondary" className="text-[9px] h-4">{Math.round(inst.confidence * 100)}%</Badge>
                        <Badge variant="secondary" className="text-[9px] h-4">{inst.topic}</Badge>
                        <Badge variant="secondary" className="text-[9px] h-4">{inst.scope}</Badge>
                        {inst.isRevocation && <Badge variant="destructive" className="text-[9px] h-4">revocación</Badge>}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Instruction list ────────────────────────────────────── */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-start gap-3 px-3.5 py-3">
                <Skeleton className="h-7 w-7 rounded-md shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-4/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", damping: 20 }}>
              <div className="relative mx-auto w-14 h-14 mb-4">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-amber-500/20 to-violet-500/20 animate-pulse" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Lightbulb className="h-6 w-6 text-amber-400/70" />
                </div>
              </div>
              <h3 className="text-sm font-medium">{instructions.length === 0 ? "Sin instrucciones todavía" : "Sin resultados"}</h3>
              <p className="text-xs text-muted-foreground mt-1.5 max-w-xs mx-auto">
                {instructions.length === 0
                  ? "Usa la barra de arriba o escribe directivas en el chat como:"
                  : "Prueba con otra búsqueda."}
              </p>
              {instructions.length === 0 && (
                <div className="flex flex-wrap gap-1.5 justify-center mt-4">
                  {["Siempre responde en inglés", "Sin emojis", "Sé breve y directo", "Usa formato markdown"].map((ex) => (
                    <button
                      key={ex}
                      className="text-[11px] px-2.5 py-1 rounded-full border border-dashed border-muted-foreground/20 text-muted-foreground hover:border-amber-500/40 hover:text-amber-400 transition-colors"
                      onClick={() => { setQuickText(ex); quickAddRef.current?.focus(); }}
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        ) : (
          <div className="space-y-1">
            <AnimatePresence mode="popLayout">
              {groups.map(({ topic, items }) => {
                const t = TOPICS[topic] || TOPICS.general;
                const isCollapsed = collapsed.has(topic);
                return (
                  <motion.div key={topic} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    {/* Topic group header */}
                    <button
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted/30"
                      onClick={() => toggleCollapse(topic)}
                    >
                      {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      <t.icon className={cn("h-3 w-3", t.color)} />
                      <span className="font-medium">{t.label}</span>
                      <span className="text-muted-foreground/50">{items.length}</span>
                    </button>

                    <AnimatePresence>
                      {!isCollapsed && items.map((inst) => (
                        <InstructionRow
                          key={inst.id}
                          inst={inst}
                          isEditing={editId === inst.id}
                          editText={editText}
                          onStartEdit={() => { setEditId(inst.id); setEditText(inst.fact); }}
                          onCancelEdit={() => setEditId(null)}
                          onSave={() => handleUpdate(inst.id)}
                          onDelete={() => handleDelete(inst.id)}
                          onEditChange={setEditText}
                        />
                      ))}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {/* ── Footer tip ──────────────────────────────────────────── */}
        {instructions.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/20 text-[11px] text-muted-foreground">
            <Sparkles className="h-3 w-3 text-violet-400 shrink-0" />
            Las instrucciones se inyectan automáticamente por relevancia semántica en cada conversación.
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
