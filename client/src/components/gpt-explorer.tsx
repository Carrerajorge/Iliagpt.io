import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { SkeletonCard } from "@/components/skeletons";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Plus,
  Bot,
  Sparkles,
  Code,
  PenTool,
  BarChart3,
  BookOpen,
  Briefcase,
  ArrowRight,
  Link as LinkIcon,
  X,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface Gpt {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatar: string | null;
  categoryId: string | null;
  creatorId: string | null;
  visibility: string | null;
  systemPrompt: string;
  temperature: string | null;
  topP: string | null;
  maxTokens: number | null;
  welcomeMessage: string | null;
  capabilities: any;
  conversationStarters: string[] | null;
  usageCount: number | null;
  version: number | null;
  isPublished: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GptCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  sortOrder: number | null;
}

interface GptExplorerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectGpt: (gpt: Gpt) => void;
  onCreateGpt: () => void;
  onEditGpt?: (gpt: Gpt) => void;
}

const defaultCategories = [
  { slug: "destacados", name: "Principales selecciones", icon: Sparkles },
  { slug: "imagen", name: "DALL-E", icon: PenTool },
  { slug: "escritura", name: "Escritura", icon: PenTool },
  { slug: "productividad", name: "Productividad", icon: Briefcase },
  { slug: "investigacion", name: "Investigación y análisis", icon: BookOpen },
  { slug: "programacion", name: "Programación", icon: Code },
];

// ─── Canvas 3D scene for GPT card previews ───────────────────────────
// Uses html-in-canvas API (layoutsubtree + drawElementImage) when available,
// with a Three.js CSS3DRenderer fallback for browsers without the flag.

function useCanvasRenderer(containerRef: React.RefObject<HTMLDivElement | null>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const supportsHtmlInCanvas = useRef(false);

  useEffect(() => {
    // Detect html-in-canvas support (canvas[layoutsubtree] + drawElementImage)
    const testCanvas = document.createElement("canvas");
    testCanvas.setAttribute("layoutsubtree", "");
    const ctx = testCanvas.getContext("2d");
    supportsHtmlInCanvas.current = !!(ctx && typeof (ctx as any).drawElementImage === "function");
  }, []);

  const initCanvas = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Create the canvas overlay for ambient cascade particles
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 pointer-events-none z-0";
    canvas.width = container.offsetWidth;
    canvas.height = container.offsetHeight;
    container.style.position = "relative";
    container.insertBefore(canvas, container.firstChild);
    canvasRef.current = canvas;

    // If html-in-canvas is available, set the layoutsubtree attribute
    if (supportsHtmlInCanvas.current) {
      canvas.setAttribute("layoutsubtree", "");
    }

    const ctx = canvas.getContext("2d")!;
    const particles: Array<{
      x: number; y: number; vx: number; vy: number;
      size: number; opacity: number; life: number; maxLife: number;
    }> = [];

    // Cascade / waterfall particle effect
    function spawnParticle() {
      particles.push({
        x: Math.random() * canvas.width,
        y: -10,
        vx: (Math.random() - 0.5) * 0.3,
        vy: 0.4 + Math.random() * 0.8,
        size: 1 + Math.random() * 2,
        opacity: 0.15 + Math.random() * 0.25,
        life: 0,
        maxLife: 300 + Math.random() * 200,
      });
    }

    let tick = 0;
    function animate() {
      tick++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Spawn cascade particles
      if (tick % 3 === 0 && particles.length < 60) spawnParticle();

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life++;
        const fadeOut = Math.max(0, 1 - p.life / p.maxLife);
        ctx.globalAlpha = p.opacity * fadeOut;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        if (p.life > p.maxLife || p.y > canvas.height + 10) {
          particles.splice(i, 1);
        }
      }
      ctx.globalAlpha = 1;

      // If html-in-canvas is available, render card elements into canvas
      if (supportsHtmlInCanvas.current) {
        const cards = container!.querySelectorAll<HTMLElement>("[data-canvas-card]");
        cards.forEach((el) => {
          try {
            (ctx as any).drawElementImage(el, 0, 0);
          } catch {
            // Silently skip if element can't be drawn
          }
        });
      }

      animFrameRef.current = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      canvas.remove();
    };
  }, [containerRef]);

  return { initCanvas, canvasRef, supportsHtmlInCanvas };
}

// ─── Cascade entrance animation hook ─────────────────────────────────

function useCascadeEntrance(itemCount: number, isVisible: boolean) {
  const [visibleItems, setVisibleItems] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!isVisible) {
      setVisibleItems(new Set());
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < itemCount; i++) {
      timers.push(
        setTimeout(() => {
          setVisibleItems((prev) => new Set([...prev, i]));
        }, i * 80)
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [itemCount, isVisible]);

  return visibleItems;
}

export function GptExplorer({ open, onOpenChange, onSelectGpt, onCreateGpt, onEditGpt }: GptExplorerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("destacados");
  const [gpts, setGpts] = useState<Gpt[]>([]);
  const [myGpts, setMyGpts] = useState<Gpt[]>([]);
  const [categories, setCategories] = useState<GptCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"explore" | "my-gpts">("explore");
  const [canvasMode, setCanvasMode] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const { initCanvas, supportsHtmlInCanvas } = useCanvasRenderer(gridRef);

  useEffect(() => {
    if (open) {
      fetchGpts();
      fetchCategories();
    }
  }, [open]);

  useEffect(() => {
    if (canvasMode && gridRef.current) {
      const cleanup = initCanvas();
      return cleanup;
    }
  }, [canvasMode, initCanvas]);

  const fetchGpts = async () => {
    try {
      setLoading(true);
      const [publicRes, myRes] = await Promise.all([
        fetch("/api/gpts?visibility=public"),
        fetch("/api/gpts/my")
      ]);
      const [publicData, myData] = await Promise.all([
        publicRes.json(),
        myRes.json()
      ]);
      setGpts(Array.isArray(publicData) ? publicData : []);
      setMyGpts(Array.isArray(myData) ? myData : []);
    } catch (error) {
      console.error("Error fetching GPTs:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch("/api/gpt-categories");
      const data = await res.json();
      setCategories(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching categories:", error);
    }
  };

  const filteredGpts = useMemo(() => {
    let filtered = view === "my-gpts" ? myGpts : gpts;
    if (searchQuery.trim()) {
      filtered = filtered.filter(gpt =>
        gpt.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        gpt.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    return filtered;
  }, [gpts, myGpts, searchQuery, view]);

  const displayGpts = useMemo(() => {
    if (activeTab === "destacados") return myGpts.slice(0, 6);
    return [...gpts].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0)).slice(0, 6);
  }, [gpts, myGpts, activeTab]);

  const cascadeItems = useCascadeEntrance(displayGpts.length, open && !loading);

  const handleSelectGpt = (gpt: Gpt) => {
    onSelectGpt(gpt);
    onOpenChange(false);
  };

  const handleCreateNew = () => {
    onCreateGpt();
    onOpenChange(false);
  };

  const handleEditGpt = (gpt: Gpt) => {
    if (onEditGpt) {
      onEditGpt(gpt);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-screen h-screen max-w-none rounded-none p-0 gap-0 overflow-hidden bg-white dark:bg-black border-none"
        data-testid="gpt-explorer-dialog"
      >
        <VisuallyHidden>
          <DialogTitle>Explorar GPTs</DialogTitle>
          <DialogDescription>Descubre y crea versiones personalizadas de ChatGPT</DialogDescription>
        </VisuallyHidden>
        <div className="flex flex-col h-full">
          {/* ─── Top bar ─── */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center gap-6">
              <span
                className={cn(
                  "text-sm font-medium cursor-pointer transition-colors",
                  view === "explore"
                    ? "text-black dark:text-white"
                    : "text-neutral-400 dark:text-neutral-500 hover:text-black dark:hover:text-white"
                )}
                onClick={() => setView("explore")}
                data-testid="tab-explore-gpts"
              >
                Explorar GPT
              </span>
              <span
                className={cn(
                  "text-sm font-medium cursor-pointer transition-colors",
                  view === "my-gpts"
                    ? "text-black dark:text-white"
                    : "text-neutral-400 dark:text-neutral-500 hover:text-black dark:hover:text-white"
                )}
                onClick={() => setView("my-gpts")}
                data-testid="tab-my-gpts"
              >
                Mis GPT
              </span>
            </div>
            <div className="flex items-center gap-2">
              {/* Canvas mode toggle */}
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCanvasMode(!canvasMode)}
                className={cn(
                  "border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-900",
                  canvasMode && "bg-black text-white dark:bg-white dark:text-black hover:bg-neutral-800 dark:hover:bg-neutral-200"
                )}
                title={canvasMode ? "Desactivar vista Canvas 3D" : "Activar vista Canvas 3D"}
              >
                <Layers className="h-4 w-4" />
              </Button>
              <Button
                onClick={handleCreateNew}
                className="gap-2 bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 rounded-lg font-medium"
                data-testid="button-create-gpt"
              >
                <Plus className="h-4 w-4" />
                Crear
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                className="text-neutral-500 hover:text-black dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900"
                data-testid="button-close-gpt-explorer"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* ─── Content area ─── */}
          <ScrollArea className="flex-1">
            <div className="p-6">
              {/* Header */}
              <div className="text-center mb-10">
                <h1 className="text-5xl font-bold mb-4 tracking-tight text-black dark:text-white">
                  GPT
                </h1>
                <p className="text-neutral-500 dark:text-neutral-400 max-w-xl mx-auto text-base leading-relaxed">
                  Descubre y crea versiones personalizadas de ChatGPT que combinen instrucciones, conocimientos adicionales y cualquier combinación de habilidades.
                </p>
              </div>

              {/* Search bar */}
              <div className="relative max-w-xl mx-auto mb-10">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                <Input
                  placeholder="Buscar GPT"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-11 h-12 rounded-full border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-black dark:text-white placeholder:text-neutral-400 focus-visible:ring-black dark:focus-visible:ring-white focus-visible:ring-1"
                  data-testid="input-search-gpts"
                />
              </div>

              {/* Canvas badge */}
              {canvasMode && (
                <div className="flex items-center justify-center gap-2 mb-6">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-100 dark:bg-neutral-900 text-xs text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-800">
                    <Layers className="h-3 w-3" />
                    Canvas 3D {supportsHtmlInCanvas.current ? "(html-in-canvas nativo)" : "(fallback)"}
                  </div>
                </div>
              )}

              {view === "explore" ? (
                <>
                  {/* Category tabs */}
                  <div className="flex items-center gap-1.5 mb-8 overflow-x-auto pb-2">
                    {defaultCategories.map((cat) => (
                      <Button
                        key={cat.slug}
                        variant="ghost"
                        className={cn(
                          "whitespace-nowrap rounded-full px-5 h-9 text-sm font-medium transition-all",
                          activeTab === cat.slug
                            ? "bg-black text-white dark:bg-white dark:text-black hover:bg-neutral-800 dark:hover:bg-neutral-200"
                            : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-900 hover:text-black dark:hover:text-white"
                        )}
                        onClick={() => setActiveTab(cat.slug)}
                        data-testid={`tab-category-${cat.slug}`}
                      >
                        {cat.name}
                      </Button>
                    ))}
                    <Button
                      variant="ghost"
                      className="whitespace-nowrap rounded-full h-9 w-9 p-0 text-neutral-400 hover:text-black dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900"
                      data-testid="button-more-categories"
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* GPT cards section */}
                  {!searchQuery && (
                    <div className="mb-8">
                      <h2 className="text-lg font-semibold mb-1 text-black dark:text-white">
                        {activeTab === "destacados" ? "Tus GPTs creados" : "Popular en tu espacio de trabajo"}
                      </h2>
                      <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-5">
                        {activeTab === "destacados"
                          ? "Los GPTs que has creado en tu cuenta"
                          : "Los GPTs más populares en tu espacio de trabajo"}
                      </p>

                      <div ref={gridRef} className="relative grid grid-cols-1 md:grid-cols-2 gap-3">
                        {loading ? (
                          Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="flex items-start gap-4 p-4 rounded-xl bg-neutral-50 dark:bg-neutral-950 animate-pulse border border-neutral-100 dark:border-neutral-900">
                              <div className="w-12 h-12 rounded-xl bg-neutral-200 dark:bg-neutral-800" />
                              <div className="flex-1 space-y-2">
                                <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded w-3/4" />
                                <div className="h-3 bg-neutral-100 dark:bg-neutral-900 rounded w-full" />
                              </div>
                            </div>
                          ))
                        ) : displayGpts.length > 0 ? (
                          displayGpts.map((gpt, index) => (
                            <div
                              key={gpt.id}
                              data-canvas-card
                              className={cn(
                                "transition-all duration-500",
                                cascadeItems.has(index)
                                  ? "opacity-100 translate-y-0"
                                  : "opacity-0 translate-y-6"
                              )}
                              style={{ transitionDelay: `${index * 60}ms` }}
                            >
                              <GptCard
                                gpt={gpt}
                                index={index + 1}
                                onClick={() => handleSelectGpt(gpt)}
                                showEdit={activeTab === "destacados"}
                                onEdit={handleEditGpt}
                              />
                            </div>
                          ))
                        ) : (
                          <div className="col-span-2 text-center py-12 text-neutral-500">
                            <Bot className="h-14 w-14 mx-auto mb-4 text-neutral-300 dark:text-neutral-700" />
                            <p className="mb-1 text-black dark:text-white font-medium">
                              {activeTab === "destacados" ? "No has creado ningún GPT todavía." : "No hay GPTs disponibles todavía."}
                            </p>
                            <Button
                              variant="link"
                              onClick={handleCreateNew}
                              className="mt-1 text-black dark:text-white underline underline-offset-4 hover:text-neutral-600 dark:hover:text-neutral-300 font-semibold"
                            >
                              Crea tu primer GPT
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Search results */}
                  {searchQuery && (
                    <div className="space-y-4">
                      {filteredGpts.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {filteredGpts.map((gpt, index) => (
                            <GptCard
                              key={gpt.id}
                              gpt={gpt}
                              index={index + 1}
                              onClick={() => handleSelectGpt(gpt)}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-12 text-neutral-500">
                          <Search className="h-12 w-12 mx-auto mb-4 text-neutral-300 dark:text-neutral-700" />
                          <p>No se encontraron GPTs para "{searchQuery}"</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                /* ─── My GPTs view ─── */
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-black dark:text-white">Mis GPTs</h2>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCreateNew}
                      className="border-neutral-300 dark:border-neutral-700 text-black dark:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-lg"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Crear nuevo
                    </Button>
                  </div>

                  {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <SkeletonCard key={i} />
                      ))}
                    </div>
                  ) : filteredGpts.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {filteredGpts.map((gpt, index) => (
                        <GptCard
                          key={gpt.id}
                          gpt={gpt}
                          index={index + 1}
                          onClick={() => handleSelectGpt(gpt)}
                          showEdit
                          onEdit={handleEditGpt}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-16 text-neutral-500">
                      <Bot className="h-14 w-14 mx-auto mb-4 text-neutral-300 dark:text-neutral-700" />
                      <p className="mb-4 text-black dark:text-white">No has creado ningún GPT todavía.</p>
                      <Button
                        onClick={handleCreateNew}
                        className="bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 rounded-lg"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Crear mi primer GPT
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* View more button */}
              {!searchQuery && view === "explore" && (
                <div className="mt-10 text-center">
                  <Button
                    variant="outline"
                    className="w-full max-w-xs rounded-lg border-neutral-300 dark:border-neutral-700 text-black dark:text-white hover:bg-neutral-50 dark:hover:bg-neutral-950 font-medium"
                    data-testid="button-view-more"
                  >
                    Ver más
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── GPT Card ────────────────────────────────────────────────────────

interface GptCardProps {
  gpt: Gpt;
  index?: number;
  onClick: () => void;
  showEdit?: boolean;
  onEdit?: (gpt: Gpt) => void;
}

function GptCard({ gpt, index, onClick, showEdit, onEdit }: GptCardProps) {
  const visibilityLabels: Record<string, string> = {
    'private': 'Privado',
    'team': 'Equipo',
    'public': 'Público'
  };

  const isPopular = (gpt.usageCount || 0) > 50;
  const isRecent = new Date(gpt.updatedAt).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000;

  return (
    <div
      className={cn(
        "flex items-start gap-4 p-4 rounded-xl cursor-pointer transition-all duration-200 group relative",
        "border border-transparent hover:border-neutral-200 dark:hover:border-neutral-800",
        "hover:bg-neutral-50 dark:hover:bg-neutral-950",
        "hover:shadow-sm"
      )}
      onClick={onClick}
      data-testid={`gpt-card-${gpt.id}`}
    >
      {/* Popular badge */}
      {isPopular && (
        <div className="absolute -top-2 -right-2 px-2.5 py-0.5 rounded-full bg-black dark:bg-white text-white dark:text-black text-[9px] font-bold tracking-wide uppercase shadow-sm">
          Popular
        </div>
      )}

      {/* Recent badge */}
      {isRecent && !isPopular && (
        <div className="absolute -top-2 -right-2 px-2.5 py-0.5 rounded-full bg-neutral-600 dark:bg-neutral-400 text-white dark:text-black text-[9px] font-bold tracking-wide uppercase shadow-sm">
          Nuevo
        </div>
      )}

      {index && (
        <span className="text-2xl font-bold w-6 flex-shrink-0 text-neutral-200 dark:text-neutral-800 tabular-nums">
          {index}
        </span>
      )}

      <div className={cn(
        "w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 border",
        isPopular
          ? "bg-black dark:bg-white border-neutral-300 dark:border-neutral-700"
          : "bg-neutral-100 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800"
      )}>
        {gpt.avatar ? (
          <img src={gpt.avatar} alt={gpt.name} className="w-full h-full rounded-xl object-cover" />
        ) : (
          <Bot className={cn("h-6 w-6", isPopular ? "text-white dark:text-black" : "text-neutral-400 dark:text-neutral-600")} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-medium truncate text-black dark:text-white">{gpt.name}</h3>
          {gpt.visibility && gpt.visibility !== 'public' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900">
              {visibilityLabels[gpt.visibility] || gpt.visibility}
            </span>
          )}
        </div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 line-clamp-2 mt-0.5">
          {gpt.description || "Sin descripción"}
        </p>
        <div className="flex items-center gap-2 mt-1.5 text-xs text-neutral-400 dark:text-neutral-500">
          <span>Por ti</span>
          {gpt.usageCount && gpt.usageCount > 0 && (
            <>
              <span className="text-neutral-300 dark:text-neutral-700">·</span>
              <span className="flex items-center gap-1">
                <LinkIcon className="inline h-3 w-3" />
                {gpt.usageCount.toLocaleString()} usos
              </span>
            </>
          )}
        </div>
      </div>

      {showEdit && onEdit && (
        <Button
          variant="ghost"
          size="sm"
          className="opacity-0 group-hover:opacity-100 transition-opacity text-neutral-500 hover:text-black dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-lg"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(gpt);
          }}
          data-testid={`button-edit-gpt-${gpt.id}`}
        >
          Editar
        </Button>
      )}
    </div>
  );
}
