import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  FileSpreadsheet, 
  FileText, 
  Presentation, 
  FileType, 
  Database, 
  Code, 
  Globe, 
  Mail,
  MessageCircle,
  CalendarDays,
  Calculator,
  BarChart3,
  Search,
  Zap,
  Check,
  Info,
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  Copy,
  Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useUserSkills, UserSkill } from "@/hooks/use-user-skills";
import { SkillBuilder } from "./skill-builder";

interface BuiltInSkill {
  id: string;
  name: string;
  description: string;
  category: "documents" | "data" | "integrations" | "custom";
  icon: React.ReactNode;
  enabled: boolean;
  builtIn: true;
  features: string[];
}

type Skill = BuiltInSkill | UserSkill;

const BUILT_IN_SKILLS: BuiltInSkill[] = [
  {
    id: "xlsx",
    name: "Excel",
    description: "Crear hojas de cálculo, analizar datos, generar reportes con gráficos y fórmulas avanzadas.",
    category: "documents",
    icon: <FileSpreadsheet className="h-6 w-6 text-green-600" />,
    enabled: true,
    builtIn: true,
    features: ["Crear workbooks", "Fórmulas (SUM, AVERAGE, IF...)", "Gráficos", "Formato condicional", "Múltiples hojas"]
  },
  {
    id: "docx",
    name: "Word",
    description: "Crear documentos profesionales, CVs, reportes, cartas y más con formato rico.",
    category: "documents",
    icon: <FileText className="h-6 w-6 text-blue-600" />,
    enabled: true,
    builtIn: true,
    features: ["Documentos profesionales", "CVs y cartas", "Tablas y listas", "Estilos y formato", "Encabezados"]
  },
  {
    id: "pptx",
    name: "PowerPoint",
    description: "Crear presentaciones con diapositivas, gráficos y contenido visual atractivo.",
    category: "documents",
    icon: <Presentation className="h-6 w-6 text-orange-600" />,
    enabled: true,
    builtIn: true,
    features: ["Diapositivas", "Gráficos y tablas", "Imágenes", "Transiciones", "Notas del orador"]
  },
  {
    id: "pdf",
    name: "PDF",
    description: "Extraer texto y tablas de PDFs, llenar formularios, combinar documentos.",
    category: "documents",
    icon: <FileType className="h-6 w-6 text-red-600" />,
    enabled: true,
    builtIn: true,
    features: ["Extraer texto", "Leer tablas", "Llenar formularios", "Analizar contenido", "OCR de imágenes"]
  },
  {
    id: "data-analysis",
    name: "Análisis de Datos",
    description: "Procesar grandes conjuntos de datos, estadísticas, visualizaciones y reportes.",
    category: "data",
    icon: <BarChart3 className="h-6 w-6 text-purple-600" />,
    enabled: true,
    builtIn: true,
    features: ["Estadísticas", "Visualizaciones", "Correlaciones", "Tendencias", "Exportar reportes"]
  },
  {
    id: "formulas",
    name: "Motor de Fórmulas",
    description: "Evaluar fórmulas matemáticas complejas, cálculos financieros y científicos.",
    category: "data",
    icon: <Calculator className="h-6 w-6 text-indigo-600" />,
    enabled: true,
    builtIn: true,
    features: ["Matemáticas avanzadas", "Funciones financieras", "Trigonometría", "Álgebra", "Conversiones"]
  },
  {
    id: "web-search",
    name: "Búsqueda Web",
    description: "Buscar información actualizada en internet y fuentes académicas.",
    category: "integrations",
    icon: <Globe className="h-6 w-6 text-cyan-600" />,
    enabled: true,
    builtIn: true,
    features: ["Búsqueda web", "Google Scholar", "Noticias", "Verificación de hechos", "Citas"]
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Leer y analizar correos electrónicos, buscar mensajes, resumir conversaciones.",
    category: "integrations",
    icon: <Mail className="h-6 w-6 text-red-500" />,
    enabled: true,
    builtIn: true,
    features: ["Leer emails", "Buscar mensajes", "Resumir hilos", "Filtrar por fecha", "Analizar adjuntos"]
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Leer y enviar mensajes de WhatsApp, buscar conversaciones y automatizar respuestas.",
    category: "integrations",
    icon: <MessageCircle className="h-6 w-6 text-green-600" />,
    enabled: true,
    builtIn: true,
    features: ["Leer chats", "Enviar mensajes", "Buscar conversaciones", "Auto-respuestas", "Estado de conexión"]
  },
  {
    id: "calendar-tasks",
    name: "Calendario y Tareas",
    description: "Crear eventos, recordatorios y tareas para organizar seguimiento y productividad.",
    category: "integrations",
    icon: <CalendarDays className="h-6 w-6 text-sky-600" />,
    enabled: true,
    builtIn: true,
    features: ["Eventos", "Recordatorios", "Tareas", "Agenda semanal", "Priorización"]
  },
  {
    id: "automation",
    name: "Automatizaciones",
    description: "Construir flujos automáticos programados para reportes, alertas y procesos repetitivos.",
    category: "integrations",
    icon: <Zap className="h-6 w-6 text-amber-600" />,
    enabled: true,
    builtIn: true,
    features: ["Workflows", "Ejecución programada", "Reintentos", "Monitoreo de runs", "Acciones encadenadas"]
  },
  {
    id: "code-execution",
    name: "Ejecución de Código",
    description: "Ejecutar código Python, JavaScript y otros lenguajes para análisis y automatización.",
    category: "data",
    icon: <Code className="h-6 w-6 text-yellow-600" />,
    enabled: false,
    builtIn: true,
    features: ["Python", "JavaScript", "Visualizaciones", "Procesamiento de datos", "Automatización"]
  },
  {
    id: "database",
    name: "Base de Datos",
    description: "Consultar y analizar datos de bases de datos SQL, generar reportes.",
    category: "data",
    icon: <Database className="h-6 w-6 text-gray-600" />,
    enabled: false,
    builtIn: true,
    features: ["Consultas SQL", "Joins", "Agregaciones", "Exportar datos", "Visualizar esquemas"]
  },
];

interface SkillsExplorerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SkillsExplorer({ open, onOpenChange }: SkillsExplorerProps) {
  const { skills: userSkills, createSkill, updateSkill, deleteSkill, toggleSkill: toggleUserSkill, duplicateSkill } = useUserSkills();
  const [builtInStates, setBuiltInStates] = useState<Record<string, boolean>>(
    Object.fromEntries(BUILT_IN_SKILLS.map(s => [s.id, s.enabled]))
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<UserSkill | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const allSkills = useMemo(() => {
    const builtIn: Skill[] = BUILT_IN_SKILLS.map(s => ({
      ...s,
      enabled: builtInStates[s.id] ?? s.enabled
    }));
    return [...builtIn, ...userSkills];
  }, [userSkills, builtInStates]);

  const toggleBuiltInSkill = (skillId: string) => {
    setBuiltInStates(prev => {
      const newState = { ...prev, [skillId]: !prev[skillId] };
      const skill = BUILT_IN_SKILLS.find(s => s.id === skillId);
      toast.success(newState[skillId] ? `${skill?.name} activado` : `${skill?.name} desactivado`);
      return newState;
    });
  };

  const handleToggleSkill = (skill: Skill) => {
    if (skill.builtIn) {
      toggleBuiltInSkill(skill.id);
    } else {
      toggleUserSkill(skill.id);
      toast.success(!skill.enabled ? `${skill.name} activado` : `${skill.name} desactivado`);
    }
  };

  const filteredSkills = allSkills.filter(skill => {
    const matchesSearch = skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          skill.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "all" || skill.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const enabledCount = allSkills.filter(s => s.enabled).length;
  const customCount = userSkills.length;

  const categoryLabels: Record<string, string> = {
    all: "Todos",
    documents: "Documentos",
    data: "Datos",
    integrations: "Integraciones",
    custom: "Personalizados"
  };

  const handleCreateSkill = () => {
    setEditingSkill(null);
    setIsBuilderOpen(true);
  };

  const handleEditSkill = (skill: UserSkill) => {
    setEditingSkill(skill);
    setIsBuilderOpen(true);
  };

  const handleSaveSkill = (skillData: Omit<UserSkill, "id" | "createdAt" | "updatedAt" | "builtIn">) => {
    if (editingSkill) {
      updateSkill(editingSkill.id, skillData);
    } else {
      createSkill(skillData);
    }
  };

  const handleDeleteSkill = (id: string) => {
    deleteSkill(id);
    setDeleteConfirmId(null);
    if (selectedSkill && !selectedSkill.builtIn && selectedSkill.id === id) {
      setSelectedSkill(null);
    }
    toast.success("Skill eliminado");
  };

  const handleDuplicateSkill = (id: string) => {
    const newSkill = duplicateSkill(id);
    if (newSkill) {
      toast.success("Skill duplicado");
    }
  };

  const getSkillIcon = (skill: Skill): React.ReactNode => {
    if (skill.builtIn) {
      return (skill as BuiltInSkill).icon;
    }
    return <Sparkles className="h-6 w-6 text-purple-500" />;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl h-[80vh] p-0 gap-0" data-testid="skills-explorer-dialog">
          <DialogHeader className="px-6 py-4 border-b">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                <Zap className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <DialogTitle className="text-xl" data-testid="skills-title">Skills</DialogTitle>
                <DialogDescription>
                  Capacidades modulares que extienden la funcionalidad de iliagpt
                </DialogDescription>
              </div>
            </div>
            <div className="absolute right-14 top-4 flex items-center gap-2">
              <Badge variant="secondary">
                {enabledCount} activos
              </Badge>
              {customCount > 0 && (
                <Badge variant="outline" className="text-purple-600">
                  {customCount} personalizados
                </Badge>
              )}
            </div>
          </DialogHeader>

          <div className="flex flex-col h-full">
            <div className="px-6 py-3 border-b bg-muted/30">
              <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar skills..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                    data-testid="skills-search-input"
                  />
                </div>
                <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
                  <TabsList>
                    {Object.entries(categoryLabels).map(([key, label]) => (
                      <TabsTrigger key={key} value={key} data-testid={`tab-${key}`}>
                        {label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                <Button onClick={handleCreateSkill} className="gap-2" data-testid="button-create-skill">
                  <Plus className="h-4 w-4" />
                  Crear Skill
                </Button>
              </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
              <ScrollArea className="flex-1 p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredSkills.map((skill) => (
                    <div
                      key={skill.id}
                      className={cn(
                        "group relative p-4 rounded-xl border transition-all duration-200 cursor-pointer",
                        skill.enabled 
                          ? "bg-card border-primary/20 shadow-sm" 
                          : "bg-muted/30 border-border hover:border-primary/30",
                        selectedSkill?.id === skill.id && "ring-2 ring-primary"
                      )}
                      onClick={() => setSelectedSkill(skill)}
                      data-testid={`skill-card-${skill.id}`}
                    >
                      <div className="flex items-start gap-4">
                        <div className={cn(
                          "p-3 rounded-xl transition-colors",
                          skill.enabled ? "bg-background" : "bg-muted"
                        )}>
                          {getSkillIcon(skill)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <h3 className="font-semibold text-base">{skill.name}</h3>
                            <div className="flex items-center gap-2">
                              {!skill.builtIn && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 opacity-0 group-hover:opacity-100"
                                      onClick={(e) => e.stopPropagation()}
                                      data-testid={`skill-menu-${skill.id}`}
                                    >
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEditSkill(skill as UserSkill); }}>
                                      <Pencil className="h-4 w-4 mr-2" />
                                      Editar
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDuplicateSkill(skill.id); }}>
                                      <Copy className="h-4 w-4 mr-2" />
                                      Duplicar
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem 
                                      className="text-red-600"
                                      onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(skill.id); }}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Eliminar
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                              <Switch
                                checked={skill.enabled}
                                onCheckedChange={() => handleToggleSkill(skill)}
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`skill-toggle-${skill.id}`}
                              />
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {skill.description}
                          </p>
                          <div className="flex gap-2 mt-2">
                            {skill.builtIn ? (
                              <Badge variant="outline" className="text-xs">
                                Integrado
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs text-purple-600 border-purple-200">
                                Personalizado
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      {skill.enabled && (
                        <div className="absolute top-2 right-2">
                          <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {filteredSkills.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Zap className="h-12 w-12 text-muted-foreground/30 mb-4" />
                    <p className="text-muted-foreground">No se encontraron skills</p>
                    <Button variant="link" onClick={handleCreateSkill} className="mt-2">
                      Crear un skill personalizado
                    </Button>
                  </div>
                )}
              </ScrollArea>

              {selectedSkill && (
                <div className="w-80 border-l bg-muted/20 p-6 overflow-auto">
                  <div className="space-y-6">
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-background rounded-xl shadow-sm">
                        {getSkillIcon(selectedSkill)}
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg">{selectedSkill.name}</h3>
                        <Badge variant={selectedSkill.enabled ? "default" : "secondary"}>
                          {selectedSkill.enabled ? "Activo" : "Inactivo"}
                        </Badge>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                        <Info className="h-4 w-4" />
                        Descripción
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {selectedSkill.description}
                      </p>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium mb-3">Capacidades</h4>
                      <div className="space-y-2">
                        {selectedSkill.features.map((feature, index) => (
                          <div key={index} className="flex items-center gap-2 text-sm">
                            <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                            <span>{feature}</span>
                          </div>
                        ))}
                        {selectedSkill.features.length === 0 && (
                          <p className="text-sm text-muted-foreground">Sin capacidades definidas</p>
                        )}
                      </div>
                    </div>

                    {!selectedSkill.builtIn && 'instructions' in selectedSkill && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">Instrucciones</h4>
                        <div className="p-3 bg-muted rounded-lg text-sm font-mono max-h-40 overflow-auto whitespace-pre-wrap">
                          {(selectedSkill as UserSkill).instructions.slice(0, 300)}
                          {(selectedSkill as UserSkill).instructions.length > 300 && "..."}
                        </div>
                      </div>
                    )}

                    <div className="pt-4 border-t space-y-2">
                      <Button 
                        className="w-full"
                        variant={selectedSkill.enabled ? "outline" : "default"}
                        onClick={() => handleToggleSkill(selectedSkill)}
                        data-testid="skill-detail-toggle"
                      >
                        {selectedSkill.enabled ? "Desactivar Skill" : "Activar Skill"}
                      </Button>
                      {!selectedSkill.builtIn && (
                        <Button 
                          className="w-full"
                          variant="outline"
                          onClick={() => handleEditSkill(selectedSkill as UserSkill)}
                          data-testid="skill-detail-edit"
                        >
                          <Pencil className="h-4 w-4 mr-2" />
                          Editar Skill
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <SkillBuilder
        open={isBuilderOpen}
        onOpenChange={setIsBuilderOpen}
        onSave={handleSaveSkill}
        editingSkill={editingSkill}
      />

      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este Skill?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El Skill será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteConfirmId && handleDeleteSkill(deleteConfirmId)}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
