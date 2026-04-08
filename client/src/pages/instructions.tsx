/**
 * Instructions Management Page
 *
 * Professional UI for viewing, creating, editing, and managing persistent
 * user instructions that IliaGPT follows across all conversations.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import {
  Lightbulb,
  Plus,
  Pencil,
  Trash2,
  Search,
  Globe,
  MessageSquare,
  MoreHorizontal,
  Sparkles,
  ShieldCheck,
  Languages,
  Palette,
  FileText,
  Type,
  Zap,
  Eye,
  EyeOff,
  RefreshCw,
  ArrowLeft,
  Clock,
  BarChart3,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/apiClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
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

// ---------------------------------------------------------------------------
// Topic config
// ---------------------------------------------------------------------------

const TOPIC_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  language:   { icon: Languages,   color: "bg-blue-500/10 text-blue-400 border-blue-500/30",    label: "Idioma" },
  tone:       { icon: Palette,     color: "bg-purple-500/10 text-purple-400 border-purple-500/30", label: "Tono" },
  format:     { icon: FileText,    color: "bg-green-500/10 text-green-400 border-green-500/30",  label: "Formato" },
  content:    { icon: Type,        color: "bg-orange-500/10 text-orange-400 border-orange-500/30", label: "Contenido" },
  behavior:   { icon: Zap,         color: "bg-amber-500/10 text-amber-400 border-amber-500/30",  label: "Comportamiento" },
  preference: { icon: Sparkles,    color: "bg-pink-500/10 text-pink-400 border-pink-500/30",     label: "Preferencia" },
  context:    { icon: ShieldCheck,  color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",    label: "Contexto" },
  meta:       { icon: Globe,       color: "bg-gray-500/10 text-gray-400 border-gray-500/30",     label: "Meta" },
  general:    { icon: Lightbulb,   color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30", label: "General" },
};

function getTopicFromTags(tags: string[]): string {
  const topicTag = tags?.find((t) => t.startsWith("topic:"));
  return topicTag ? topicTag.replace("topic:", "") : "general";
}

function getScopeLabel(scope: string): string {
  if (scope === "global") return "Todas las conversaciones";
  if (scope === "conversation") return "Solo esta conversación";
  if (scope === "gpt") return "GPT específico";
  return scope;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days}d`;
  return `hace ${Math.floor(days / 30)}mes`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InstructionsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTopic, setFilterTopic] = useState<string | null>(null);

  // Create dialog
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newText, setNewText] = useState("");
  const [newTopic, setNewTopic] = useState("general");
  const [isCreating, setIsCreating] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  // Test detection dialog
  const [isTestOpen, setIsTestOpen] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [testResult, setTestResult] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const loadInstructions = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const res = await apiFetch("/api/instructions", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setInstructions(data.instructions || []);
    } catch (err) {
      toast({ title: "Error", description: "No se pudieron cargar las instrucciones", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [user, toast]);

  useEffect(() => { loadInstructions(); }, [loadInstructions]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleCreate = async () => {
    if (!newText.trim()) return;
    setIsCreating(true);
    try {
      const res = await apiFetch("/api/instructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text: newText.trim(), topic: newTopic }),
      });
      if (!res.ok) throw new Error("Failed to create");
      toast({ title: "Instrucción creada", description: "Se aplicará en tus próximas conversaciones." });
      setNewText("");
      setIsCreateOpen(false);
      loadInstructions();
    } catch {
      toast({ title: "Error", description: "No se pudo crear la instrucción", variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editText.trim()) return;
    try {
      const res = await apiFetch(`/api/instructions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text: editText.trim() }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast({ title: "Instrucción actualizada" });
      setEditingId(null);
      loadInstructions();
    } catch {
      toast({ title: "Error", description: "No se pudo actualizar", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    // Optimistic removal with undo
    const removed = instructions.find((i) => i.id === id);
    if (!removed) return;
    setInstructions((prev) => prev.filter((i) => i.id !== id));

    const undoTimeout = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/instructions/${id}`, { method: "DELETE", credentials: "include" });
        if (!res.ok) throw new Error("Failed");
      } catch {
        setInstructions((prev) => [...prev, removed]);
        toast({ title: "Error", description: "No se pudo eliminar", variant: "destructive" });
      }
    }, 4000);

    toast({
      title: "Instrucción eliminada",
      description: removed.fact.length > 50 ? removed.fact.slice(0, 47) + "..." : removed.fact,
      duration: 4000,
      action: (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            clearTimeout(undoTimeout);
            setInstructions((prev) => [...prev, removed].sort((a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            ));
          }}
        >
          Deshacer
        </Button>
      ),
    });
  };

  const handleTestDetection = async () => {
    if (!testMessage.trim()) return;
    setIsTesting(true);
    try {
      const res = await apiFetch("/api/instructions/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: testMessage, useLLM: true }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      toast({ title: "Error", description: "Error en la detección", variant: "destructive" });
    } finally {
      setIsTesting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  const filteredInstructions = instructions.filter((inst) => {
    if (filterTopic && getTopicFromTags(inst.tags) !== filterTopic) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return inst.fact.toLowerCase().includes(q);
    }
    return true;
  });

  // Group by topic for stats
  const topicCounts: Record<string, number> = {};
  for (const inst of instructions) {
    const topic = getTopicFromTags(inst.tags);
    topicCounts[topic] = (topicCounts[topic] || 0) + 1;
  }

  const totalUsage = instructions.reduce((sum, i) => sum + (i.accessCount || 0), 0);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="w-96">
          <CardContent className="pt-6 text-center">
            <Lightbulb className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">Inicia sesión</h2>
            <p className="text-muted-foreground">Para gestionar tus instrucciones persistentes.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Hero header */}
        <div className="relative overflow-hidden rounded-xl border border-amber-500/10 bg-gradient-to-br from-amber-500/5 via-transparent to-violet-500/5 p-5 sm:p-6">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-400/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="relative flex items-start gap-4">
            <Button variant="ghost" size="icon" className="shrink-0 -ml-1 -mt-1" onClick={() => setLocation("/")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-1">
                <div className="h-8 w-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
                  <Lightbulb className="h-4 w-4 text-amber-400" />
                </div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Instrucciones Persistentes</h1>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-lg">
                Directivas que IliaGPT sigue automáticamente en todas tus conversaciones.
                Se inyectan por relevancia semántica para optimizar el uso de tokens.
              </p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={loadInstructions} disabled={isLoading}>
              <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-muted">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <Lightbulb className="h-4 w-4 text-violet-400" />
              </div>
              <div>
                <p className="text-2xl font-bold leading-none">{instructions.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Activas</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-muted">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold leading-none">{totalUsage}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Usos totales</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-muted">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-green-500/10 flex items-center justify-center">
                <Globe className="h-4 w-4 text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold leading-none">{Object.keys(topicCounts).length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Categorías</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-muted">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-4 w-4 text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold leading-none">
                  {instructions.length > 0 ? Math.round(instructions.reduce((s, i) => s + (i.confidence || 0), 0) / instructions.length * 100) : 0}%
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Confianza avg</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Actions bar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar instrucciones..."
              className="pl-9"
            />
          </div>

          {/* Topic filter pills */}
          <div className="flex gap-1.5 flex-wrap">
            <Button
              variant={filterTopic === null ? "secondary" : "ghost"}
              size="sm"
              className="h-8 text-xs rounded-full"
              onClick={() => setFilterTopic(null)}
            >
              Todas
            </Button>
            {Object.entries(topicCounts).map(([topic, cnt]) => {
              const config = TOPIC_CONFIG[topic] || TOPIC_CONFIG.general;
              const Icon = config.icon;
              return (
                <Button
                  key={topic}
                  variant={filterTopic === topic ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 text-xs rounded-full gap-1"
                  onClick={() => setFilterTopic(filterTopic === topic ? null : topic)}
                >
                  <Icon className="h-3 w-3" />
                  {config.label}
                  <span className="text-muted-foreground ml-0.5">({cnt})</span>
                </Button>
              );
            })}
          </div>

          {/* Create + Test buttons */}
          <div className="flex gap-2">
            <Dialog open={isTestOpen} onOpenChange={setIsTestOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-8">
                  <Zap className="h-3.5 w-3.5 mr-1.5" />
                  Probar
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Probar detección de instrucciones</DialogTitle>
                  <DialogDescription>
                    Escribe un mensaje para ver si el sistema lo detecta como instrucción persistente.
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  placeholder='Ej: "siempre respondeme en inglés"'
                  rows={3}
                />
                {testResult && (
                  <div className="rounded-lg border p-3 text-sm space-y-2">
                    <div className="flex items-center gap-2">
                      {testResult.found ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="font-medium">
                        {testResult.found ? "Instrucción detectada" : "No se detectó instrucción"}
                      </span>
                      <Badge variant="outline" className="text-[10px]">{testResult.stage}</Badge>
                      <Badge variant="outline" className="text-[10px]">{testResult.durationMs}ms</Badge>
                    </div>
                    {testResult.instructions?.map((inst: any, i: number) => (
                      <div key={i} className="pl-6 space-y-1">
                        <p className="text-muted-foreground">{inst.normalized || inst.rawText}</p>
                        <div className="flex gap-1.5">
                          <Badge variant="secondary" className="text-[10px]">
                            {Math.round(inst.confidence * 100)}% confianza
                          </Badge>
                          <Badge variant="secondary" className="text-[10px]">{inst.topic}</Badge>
                          <Badge variant="secondary" className="text-[10px]">{inst.scope}</Badge>
                          {inst.isRevocation && <Badge variant="destructive" className="text-[10px]">Revocación</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <DialogFooter>
                  <Button onClick={handleTestDetection} disabled={isTesting || !testMessage.trim()}>
                    {isTesting ? "Analizando..." : "Analizar mensaje"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="h-8">
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Nueva
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nueva instrucción</DialogTitle>
                  <DialogDescription>
                    Escribe una directiva que IliaGPT seguirá en todas tus conversaciones.
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  placeholder='Ej: "Siempre responde en español formal, sin emojis"'
                  rows={3}
                />
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(TOPIC_CONFIG).map(([key, config]) => {
                    const Icon = config.icon;
                    return (
                      <Button
                        key={key}
                        variant={newTopic === key ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 text-xs gap-1 rounded-full"
                        onClick={() => setNewTopic(key)}
                      >
                        <Icon className="h-3 w-3" />
                        {config.label}
                      </Button>
                    );
                  })}
                </div>
                <DialogFooter>
                  <Button onClick={handleCreate} disabled={isCreating || !newText.trim()}>
                    {isCreating ? "Guardando..." : "Crear instrucción"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Instructions list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="border-muted">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                      <div className="flex gap-2 pt-1">
                        <Skeleton className="h-4 w-16 rounded-full" />
                        <Skeleton className="h-4 w-12 rounded-full" />
                        <Skeleton className="h-4 w-14 rounded-full" />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredInstructions.length === 0 ? (
          <Card className="border-dashed border-muted-foreground/20 bg-gradient-to-b from-muted/30 to-transparent">
            <CardContent className="py-12 text-center">
              <div className="relative mx-auto w-16 h-16 mb-5">
                <div className="absolute inset-0 rounded-2xl bg-amber-500/10 animate-pulse" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Lightbulb className="h-8 w-8 text-amber-400/60" />
                </div>
              </div>
              <h3 className="text-lg font-semibold">
                {instructions.length === 0 ? "Define cómo quieres que responda IliaGPT" : "Sin resultados"}
              </h3>
              <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto leading-relaxed">
                {instructions.length === 0
                  ? "Las instrucciones personalizan cada respuesta. Escríbelas en el chat o créalas aquí."
                  : "Intenta con otra búsqueda o cambia el filtro de categoría."}
              </p>
              {instructions.length === 0 && (
                <div className="mt-6 space-y-3">
                  <div className="flex flex-wrap gap-2 justify-center">
                    {[
                      { text: "Siempre responde en inglés", icon: Languages },
                      { text: "No uses emojis", icon: Type },
                      { text: "Sé breve y conciso", icon: Zap },
                    ].map((example) => (
                      <Button
                        key={example.text}
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs gap-1.5 rounded-full border-dashed hover:border-solid transition-all"
                        onClick={() => { setNewText(example.text); setIsCreateOpen(true); }}
                      >
                        <example.icon className="h-3 w-3 text-muted-foreground" />
                        {example.text}
                      </Button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground/50">Haz clic en un ejemplo para usarlo como base</p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredInstructions.map((inst) => {
              const topic = getTopicFromTags(inst.tags);
              const config = TOPIC_CONFIG[topic] || TOPIC_CONFIG.general;
              const Icon = config.icon;
              const isEditing = editingId === inst.id;

              return (
                <Card key={inst.id} className={cn("border-muted transition-all group hover:border-muted-foreground/30", isEditing && "ring-1 ring-primary/30")}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {/* Topic icon */}
                      <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border", config.color)}>
                        <Icon className="h-4 w-4" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="space-y-2">
                            <Textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              rows={2}
                              autoFocus
                            />
                            <div className="flex gap-2">
                              <Button size="sm" className="h-7" onClick={() => handleUpdate(inst.id)}>Guardar</Button>
                              <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditingId(null)}>Cancelar</Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-sm leading-relaxed">{inst.fact}</p>

                            {/* Metadata row */}
                            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                              <Badge variant="outline" className={cn("text-[10px] border", config.color)}>
                                {config.label}
                              </Badge>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className="text-[10px] gap-1">
                                    <Globe className="h-2.5 w-2.5" />
                                    {inst.scope === "global" ? "Global" : inst.scope}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>{getScopeLabel(inst.scope)}</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className="text-[10px] gap-1">
                                    <BarChart3 className="h-2.5 w-2.5" />
                                    {inst.accessCount}x
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>Usada {inst.accessCount} veces en prompts</TooltipContent>
                              </Tooltip>
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Clock className="h-2.5 w-2.5" />
                                {timeAgo(inst.createdAt)}
                              </span>
                            </div>

                            {/* Confidence bar */}
                            <div className="flex items-center gap-2 mt-2">
                              <span className="text-[10px] text-muted-foreground w-16 shrink-0">Confianza</span>
                              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all duration-500",
                                    (inst.confidence || 0) >= 0.8 ? "bg-green-500" :
                                    (inst.confidence || 0) >= 0.6 ? "bg-amber-500" : "bg-red-500",
                                  )}
                                  style={{ width: `${Math.round((inst.confidence || 0) * 100)}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-muted-foreground w-8 text-right">
                                {Math.round((inst.confidence || 0) * 100)}%
                              </span>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Actions */}
                      {!isEditing && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => { setEditingId(inst.id); setEditText(inst.fact); }}>
                              <Pencil className="h-3.5 w-3.5 mr-2" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDelete(inst.id)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Info footer */}
        <Card className="border-muted bg-muted/30">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Sparkles className="h-5 w-5 text-violet-400 shrink-0 mt-0.5" />
              <div className="text-sm text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Detección automática</p>
                <p>
                  Las instrucciones se detectan automáticamente cuando escribes directivas como
                  "siempre respondeme en inglés" o "nunca uses emojis" en el chat.
                  También puedes crearlas manualmente desde aquí.
                </p>
                <p>
                  Las instrucciones se inyectan en el contexto de cada conversación según su relevancia
                  semántica con tu mensaje actual, optimizando el uso de tokens.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
