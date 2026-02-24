import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Globe,
  Code,
  FileText,
  BarChart3,
  Image,
  Video,
  Music,
  Mail,
  Calendar,
  Shield,
  Database,
  Terminal,
  Sparkles,
  FileSpreadsheet,
  PresentationIcon,
  Zap,
  Bot,
  Brain,
  Lightbulb,
  Wand2,
  ChevronRight,
  Star,
  TrendingUp,
  X,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface Skill {
  id: string;
  name: string;
  description: string;
  icon: typeof Search;
  category: string;
  primaryAgent: string;
  tools: string[];
  requiredInputs: string[];
  outputType: string;
  example?: string;
  popular?: boolean;
  new?: boolean;
}

const SKILL_CATEGORIES = [
  { id: "popular", name: "Populares", icon: Star },
  { id: "research", name: "Investigación", icon: Search },
  { id: "documents", name: "Documentos", icon: FileText },
  { id: "data", name: "Datos y Análisis", icon: BarChart3 },
  { id: "code", name: "Desarrollo", icon: Code },
  { id: "media", name: "Multimedia", icon: Image },
  { id: "automation", name: "Automatización", icon: Zap },
  { id: "communication", name: "Comunicación", icon: Mail },
];

const CATEGORY_ICONS: Record<string, typeof Search> = {
  research: Globe,
  documents: FileText,
  data: BarChart3,
  code: Code,
  media: Image,
  automation: Zap,
  communication: Mail,
};

interface ApiSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  primaryAgent: string;
  tools: string[];
  requiredInputs: string[];
  outputType: string;
  tags?: string[];
  version?: string;
  popular?: boolean;
  new?: boolean;
  deprecated?: boolean;
  implementationStatus?: string;
}

async function fetchSkills(): Promise<ApiSkill[]> {
  const response = await fetch("/api/agent/skills");
  if (!response.ok) {
    throw new Error("Failed to fetch skills");
  }
  const data = await response.json();
  return data.skills || [];
}

function mapApiSkillToSkill(apiSkill: ApiSkill): Skill {
  const IconComponent = CATEGORY_ICONS[apiSkill.category] || Sparkles;
  return {
    id: apiSkill.id,
    name: apiSkill.name,
    description: apiSkill.description,
    icon: IconComponent,
    category: apiSkill.category,
    primaryAgent: apiSkill.primaryAgent,
    tools: apiSkill.tools,
    requiredInputs: apiSkill.requiredInputs,
    outputType: apiSkill.outputType,
    popular: apiSkill.popular,
    new: apiSkill.new,
  };
}

const FALLBACK_SKILLS: Skill[] = [
  {
    id: "web-research",
    name: "Investigar en la web",
    description: "Busca información en internet, sintetiza resultados y cita fuentes",
    icon: Globe,
    category: "research",
    primaryAgent: "ResearchAgent",
    tools: ["search_web", "fetch_url", "research_deep"],
    requiredInputs: ["tema o pregunta"],
    outputType: "Resumen con citas",
    popular: true,
  },
  {
    id: "create-document",
    name: "Crear documento Word/PDF",
    description: "Genera documentos profesionales como reportes, cartas o contratos",
    icon: FileText,
    category: "documents",
    primaryAgent: "DocumentAgent",
    tools: ["doc_create", "pdf_manipulate"],
    requiredInputs: ["tipo de documento", "contenido"],
    outputType: "Documento descargable",
    popular: true,
  },
  {
    id: "generate-image",
    name: "Generar imagen con IA",
    description: "Crea imágenes originales basadas en descripciones de texto",
    icon: Image,
    category: "media",
    primaryAgent: "ContentAgent",
    tools: ["generate_image"],
    requiredInputs: ["descripción de la imagen"],
    outputType: "Imagen PNG/JPG",
    popular: true,
  },
  {
    id: "generate-code",
    name: "Escribir código",
    description: "Genera código en cualquier lenguaje con explicaciones",
    icon: Code,
    category: "code",
    primaryAgent: "CodeAgent",
    tools: ["code_generate", "code_review"],
    requiredInputs: ["lenguaje", "funcionalidad"],
    outputType: "Código fuente",
    popular: true,
  },
];

interface SkillsGalleryProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSkill: (skill: Skill) => void;
}

export function SkillsGallery({ isOpen, onClose, onSelectSkill }: SkillsGalleryProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const { data: apiSkills, isLoading, error, refetch } = useQuery({
    queryKey: ["agent-skills"],
    queryFn: fetchSkills,
    enabled: isOpen,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  const skills: Skill[] = useMemo(() => {
    if (!apiSkills || apiSkills.length === 0) {
      return FALLBACK_SKILLS;
    }
    return apiSkills.map(mapApiSkillToSkill);
  }, [apiSkills]);

  const filteredSkills = useMemo(() => {
    let filtered = skills;

    if (selectedCategory === "popular") {
      filtered = filtered.filter(s => s.popular);
    } else if (selectedCategory) {
      filtered = filtered.filter(s => s.category === selectedCategory);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        s =>
          s.name.toLowerCase().includes(query) ||
          s.description.toLowerCase().includes(query) ||
          s.example?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [searchQuery, selectedCategory, skills]);

  const handleSelect = (skill: Skill) => {
    onSelectSkill(skill);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] p-0 gap-0 bg-background/80 backdrop-blur-2xl border-border/50 shadow-2xl" data-testid="skills-gallery-dialog">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Wand2 className="h-5 w-5 text-primary" />
            Galería de Capacidades
          </DialogTitle>
        </DialogHeader>

        <div className="flex h-[500px]">
          <div className="w-48 border-r border-border/30 bg-[#A5A0FF]/[0.02] p-3">
            <div className="space-y-1">
              <Button
                variant={selectedCategory === null ? "secondary" : "ghost"}
                size="sm"
                className="w-full justify-start"
                onClick={() => setSelectedCategory(null)}
                data-testid="category-all"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Todas
              </Button>
              {SKILL_CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                return (
                  <Button
                    key={cat.id}
                    variant={selectedCategory === cat.id ? "secondary" : "ghost"}
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => setSelectedCategory(cat.id)}
                    data-testid={`category-${cat.id}`}
                  >
                    <Icon className="h-4 w-4 mr-2" />
                    {cat.name}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 flex flex-col">
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Buscar capacidad..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm bg-muted/30 rounded-lg border border-border/30 focus:bg-background focus:ring-2 focus:ring-[#A5A0FF]/30 outline-none transition-all placeholder:text-muted-foreground"
                  data-testid="skills-search-input"
                />
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-3 grid grid-cols-1 gap-2">
                {isLoading ? (
                  <div className="text-center py-12">
                    <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      Cargando capacidades...
                    </p>
                  </div>
                ) : error ? (
                  <div className="text-center py-12">
                    <X className="h-8 w-8 text-destructive/50 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground mb-2">
                      Error al cargar capacidades
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refetch()}
                      data-testid="skills-retry-button"
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Reintentar
                    </Button>
                  </div>
                ) : filteredSkills.length === 0 ? (
                  <div className="text-center py-12">
                    <Lightbulb className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      No se encontraron capacidades
                    </p>
                  </div>
                ) : (
                  filteredSkills.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      onClick={() => handleSelect(skill)}
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface SkillCardProps {
  skill: Skill;
  onClick: () => void;
}

function SkillCard({ skill, onClick }: SkillCardProps) {
  const Icon = skill.icon;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-4 rounded-2xl border border-border/50 bg-card overflow-hidden group",
        "transition-all duration-300 hover:bg-[#A5A0FF]/[0.02] hover:border-[#A5A0FF]/40 hover:shadow-lg hover:shadow-[#A5A0FF]/10 hover:-translate-y-0.5",
        "focus:outline-none focus:ring-2 focus:ring-[#A5A0FF]/30"
      )}
      data-testid={`skill-card-${skill.id}`}
    >
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-gradient-to-br from-[#A5A0FF]/10 to-transparent text-[#A5A0FF] shrink-0 border border-[#A5A0FF]/20 shadow-sm shadow-[#A5A0FF]/5 group-hover:scale-105 transition-transform duration-300">
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 mt-0.5">
            <span className="font-semibold text-base">{skill.name}</span>
            {skill.popular && (
              <Badge variant="secondary" className="text-[10px] h-5 px-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                <Star className="h-3 w-3 mr-1 fill-current" />
                Popular
              </Badge>
            )}
            {skill.new && (
              <Badge className="text-[10px] h-5 px-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                Nuevo
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground/90 line-clamp-2">
            {skill.description}
          </p>
          {skill.example && (
            <p className="text-xs text-[#A5A0FF]/80 mt-2 font-medium bg-[#A5A0FF]/5 py-1 px-2 rounded-md inline-block border border-[#A5A0FF]/10">
              Ej: "{skill.example}"
            </p>
          )}
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground/30 group-hover:text-[#A5A0FF] transition-colors shrink-0 mt-3 group-hover:translate-x-1" />
      </div>
    </button>
  );
}

interface SkillsCommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSkill: (skill: Skill) => void;
}

export function SkillsCommandPalette({
  isOpen,
  onClose,
  onSelectSkill,
}: SkillsCommandPaletteProps) {
  const { data: apiSkills, isLoading } = useQuery({
    queryKey: ["agent-skills"],
    queryFn: fetchSkills,
    enabled: isOpen,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  const skills: Skill[] = useMemo(() => {
    if (!apiSkills || apiSkills.length === 0) {
      return FALLBACK_SKILLS;
    }
    return apiSkills.map(mapApiSkillToSkill);
  }, [apiSkills]);

  const handleSelect = (skill: Skill) => {
    onSelectSkill(skill);
    onClose();
  };

  const popularSkills = skills.filter(s => s.popular);
  const otherSkills = skills.filter(s => !s.popular);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="p-0 max-w-lg" data-testid="skills-command-palette">
        <Command className="rounded-lg border-0">
          <CommandInput placeholder="¿Qué quieres hacer?" />
          <CommandList className="max-h-[400px]">
            {isLoading ? (
              <div className="py-6 text-center">
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : (
              <>
                <CommandEmpty>No se encontraron capacidades</CommandEmpty>

                <CommandGroup heading="Populares">
                  {popularSkills.map((skill) => {
                    const Icon = skill.icon;
                    return (
                      <CommandItem
                        key={skill.id}
                        value={skill.name}
                        onSelect={() => handleSelect(skill)}
                        className="gap-3 py-2.5 px-3 rounded-lg transition-colors group"
                        data-testid={`command-skill-${skill.id}`}
                      >
                        <div className="p-1.5 rounded-md bg-gradient-to-br from-[#A5A0FF]/10 to-transparent border border-[#A5A0FF]/20 text-[#A5A0FF] group-hover:scale-105 transition-transform">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-sm">{skill.name}</div>
                          <div className="text-xs text-muted-foreground/80">{skill.description}</div>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>

                <CommandSeparator />

                <CommandGroup heading="Todas las capacidades">
                  {otherSkills.map((skill) => {
                    const Icon = skill.icon;
                    return (
                      <CommandItem
                        key={skill.id}
                        value={skill.name}
                        onSelect={() => handleSelect(skill)}
                        className="gap-3 py-2.5"
                        data-testid={`command-skill-${skill.id}`}
                      >
                        <div className="p-1.5 rounded bg-muted">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-sm">{skill.name}</div>
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {skill.description}
                          </div>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export { FALLBACK_SKILLS as SKILLS, SKILL_CATEGORIES };
