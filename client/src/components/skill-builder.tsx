import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Zap, 
  Plus, 
  X, 
  FileText, 
  Database, 
  Globe, 
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Check,
  AlertCircle,
  Lightbulb,
  Eye,
  BookOpen,
  Settings2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { UserSkill } from "@/hooks/use-user-skills";
import { motion, AnimatePresence } from "framer-motion";

interface SkillBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (skill: Omit<UserSkill, "id" | "createdAt" | "updatedAt" | "builtIn">) => void;
  editingSkill?: UserSkill | null;
}

const CATEGORY_OPTIONS = [
  { value: "documents", label: "Documentos", icon: FileText, color: "text-blue-600 bg-blue-100 dark:bg-blue-900/30" },
  { value: "data", label: "Datos", icon: Database, color: "text-purple-600 bg-purple-100 dark:bg-purple-900/30" },
  { value: "integrations", label: "Integraciones", icon: Globe, color: "text-cyan-600 bg-cyan-100 dark:bg-cyan-900/30" },
  { value: "custom", label: "Personalizado", icon: Sparkles, color: "text-amber-600 bg-amber-100 dark:bg-amber-900/30" },
];

const EXAMPLE_TEMPLATES = [
  {
    name: "Asistente de Código",
    description: "Ayuda con revisión de código, debugging y mejores prácticas.",
    instructions: `# Asistente de Código

## Instrucciones
Cuando el usuario pida ayuda con código:
1. Analiza el código proporcionado
2. Identifica problemas potenciales
3. Sugiere mejoras siguiendo mejores prácticas
4. Explica los cambios propuestos

## Mejores Prácticas
- Usa nombres descriptivos para variables
- Mantén funciones pequeñas y enfocadas
- Agrega comentarios cuando sea necesario
- Sigue los principios SOLID`,
    category: "custom" as const,
    features: ["Revisión de código", "Debugging", "Refactoring", "Documentación"],
  },
  {
    name: "Generador de Reportes",
    description: "Crea reportes profesionales a partir de datos estructurados.",
    instructions: `# Generador de Reportes

## Instrucciones
Para generar un reporte:
1. Analiza los datos proporcionados
2. Identifica métricas clave
3. Crea visualizaciones apropiadas
4. Resume hallazgos principales

## Formato de Salida
- Título y fecha
- Resumen ejecutivo
- Métricas principales
- Gráficos y tablas
- Conclusiones y recomendaciones`,
    category: "data" as const,
    features: ["Análisis de datos", "Visualizaciones", "Resúmenes", "Exportar PDF"],
  },
];

const STEPS = [
  { id: 1, name: "Fundamentos", description: "Nombre y descripción" },
  { id: 2, name: "Instrucciones", description: "Comportamiento del Skill" },
  { id: 3, name: "Revisar", description: "Confirmar y crear" },
];

export function SkillBuilder({ open, onOpenChange, onSave, editingSkill }: SkillBuilderProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [category, setCategory] = useState<"documents" | "data" | "integrations" | "custom">("custom");
  const [features, setFeatures] = useState<string[]>([]);
  const [newFeature, setNewFeature] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    if (editingSkill) {
      setName(editingSkill.name);
      setDescription(editingSkill.description);
      setInstructions(editingSkill.instructions);
      setCategory(editingSkill.category);
      setFeatures(editingSkill.features);
      setCurrentStep(1);
    } else {
      resetForm();
    }
  }, [editingSkill, open]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setInstructions("");
    setCategory("custom");
    setFeatures([]);
    setNewFeature("");
    setErrors({});
    setCurrentStep(1);
    setShowTemplates(false);
  };

  const addFeature = () => {
    if (newFeature.trim() && !features.includes(newFeature.trim())) {
      setFeatures([...features, newFeature.trim()]);
      setNewFeature("");
    }
  };

  const removeFeature = (feature: string) => {
    setFeatures(features.filter(f => f !== feature));
  };

  const applyTemplate = (template: typeof EXAMPLE_TEMPLATES[0]) => {
    setName(template.name);
    setDescription(template.description);
    setInstructions(template.instructions);
    setCategory(template.category);
    setFeatures(template.features);
    setShowTemplates(false);
    toast.success("Plantilla aplicada");
  };

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};
    
    if (step >= 1) {
      if (!name.trim()) {
        newErrors.name = "El nombre es requerido";
      } else if (name.length > 64) {
        newErrors.name = "Máximo 64 caracteres";
      }
      
      if (!description.trim()) {
        newErrors.description = "La descripción es requerida";
      } else if (description.length > 500) {
        newErrors.description = "Máximo 500 caracteres";
      }
    }
    
    if (step >= 2) {
      if (!instructions.trim()) {
        newErrors.instructions = "Las instrucciones son requeridas";
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => Math.min(prev + 1, 3));
    }
  };

  const handleBack = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  const handleSave = () => {
    if (!validateStep(3)) {
      toast.error("Por favor corrige los errores");
      return;
    }

    onSave({
      name: name.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      category,
      enabled: true,
      features,
    });

    resetForm();
    onOpenChange(false);
    toast.success(editingSkill ? "Skill actualizado" : "Skill creado exitosamente");
  };

  const getCategoryInfo = () => {
    return CATEGORY_OPTIONS.find(c => c.value === category) || CATEGORY_OPTIONS[3];
  };

  const isStepComplete = (step: number): boolean => {
    if (step === 1) return name.trim().length > 0 && description.trim().length > 0;
    if (step === 2) return instructions.trim().length > 0;
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden" data-testid="skill-builder-dialog">
        <VisuallyHidden>
          <DialogTitle>Skill Builder</DialogTitle>
          <DialogDescription>
            Wizard para crear o editar un Skill personalizado
          </DialogDescription>
        </VisuallyHidden>
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl shadow-lg">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-lg">
                {editingSkill ? "Editar Skill" : "Crear nuevo Skill"}
              </h2>
              <p className="text-sm text-muted-foreground">
                Paso {currentStep} de 3 — {STEPS[currentStep - 1].name}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-6 py-3 border-b bg-background">
          <div className="flex items-center gap-2">
            {STEPS.map((step, index) => (
              <div key={step.id} className="flex items-center gap-2 flex-1">
                <button
                  onClick={() => {
                    if (step.id < currentStep || isStepComplete(currentStep)) {
                      setCurrentStep(step.id);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg transition-all flex-1",
                    currentStep === step.id
                      ? "bg-primary text-primary-foreground"
                      : isStepComplete(step.id) && step.id < currentStep
                      ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  )}
                  data-testid={`step-${step.id}`}
                >
                  <span className={cn(
                    "flex items-center justify-center h-6 w-6 rounded-full text-xs font-medium",
                    currentStep === step.id
                      ? "bg-primary-foreground/20"
                      : isStepComplete(step.id) && step.id < currentStep
                      ? "bg-green-500 text-white"
                      : "bg-muted"
                  )}>
                    {isStepComplete(step.id) && step.id < currentStep ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      step.id
                    )}
                  </span>
                  <span className="text-sm font-medium hidden sm:inline">{step.name}</span>
                </button>
                {index < STEPS.length - 1 && (
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>

        <ScrollArea className="h-[400px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="p-6"
            >
              {currentStep === 1 && (
                <div className="space-y-6">
                  {!editingSkill && !showTemplates && (
                    <Card className="border-dashed border-2 hover:border-primary/50 transition-colors cursor-pointer"
                      onClick={() => setShowTemplates(true)}
                    >
                      <CardContent className="p-4 flex items-center gap-4">
                        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                          <Lightbulb className="h-5 w-5 text-amber-600" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">¿Comenzar con una plantilla?</p>
                          <p className="text-xs text-muted-foreground">
                            Usa una plantilla predefinida como punto de partida
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </CardContent>
                    </Card>
                  )}

                  {showTemplates && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium text-sm">Selecciona una plantilla</h4>
                        <Button variant="ghost" size="sm" onClick={() => setShowTemplates(false)}>
                          Cerrar
                        </Button>
                      </div>
                      <div className="grid gap-3">
                        {EXAMPLE_TEMPLATES.map((template, i) => (
                          <Card
                            key={i}
                            className="cursor-pointer hover:border-primary/50 transition-all"
                            onClick={() => applyTemplate(template)}
                            data-testid={`template-${i}`}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-start gap-3">
                                <div className={cn("p-2 rounded-lg", CATEGORY_OPTIONS.find(c => c.value === template.category)?.color)}>
                                  {(() => {
                                    const Icon = CATEGORY_OPTIONS.find(c => c.value === template.category)?.icon || Sparkles;
                                    return <Icon className="h-4 w-4" />;
                                  })()}
                                </div>
                                <div className="flex-1">
                                  <p className="font-medium text-sm">{template.name}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">{template.description}</p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}

                  {!showTemplates && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="skill-name" className="text-sm font-medium">
                          Nombre del Skill
                        </Label>
                        <Input
                          id="skill-name"
                          value={name}
                          onChange={(e) => { setName(e.target.value); setErrors(prev => ({ ...prev, name: "" })); }}
                          placeholder="ej: Asistente de Ventas"
                          className={cn("h-11", errors.name && "border-red-500 focus-visible:ring-red-500")}
                          maxLength={64}
                          data-testid="input-skill-name"
                        />
                        <div className="flex justify-between">
                          {errors.name ? (
                            <span className="text-xs text-red-500 flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" />
                              {errors.name}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Un nombre descriptivo y único</span>
                          )}
                          <span className="text-xs text-muted-foreground">{name.length}/64</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="skill-description" className="text-sm font-medium">
                          Descripción
                        </Label>
                        <Textarea
                          id="skill-description"
                          value={description}
                          onChange={(e) => { setDescription(e.target.value); setErrors(prev => ({ ...prev, description: "" })); }}
                          placeholder="Describe qué hace este Skill y cuándo debe activarse..."
                          className={cn("min-h-[80px] resize-none", errors.description && "border-red-500")}
                          maxLength={500}
                          data-testid="input-skill-description"
                        />
                        <div className="flex justify-between">
                          {errors.description ? (
                            <span className="text-xs text-red-500 flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" />
                              {errors.description}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Incluye cuándo debe activarse este Skill</span>
                          )}
                          <span className="text-xs text-muted-foreground">{description.length}/500</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Categoría</Label>
                        <div className="grid grid-cols-2 gap-2">
                          {CATEGORY_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setCategory(opt.value as typeof category)}
                              className={cn(
                                "flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left",
                                category === opt.value
                                  ? "border-primary bg-primary/5"
                                  : "border-transparent bg-muted/50 hover:bg-muted"
                              )}
                              data-testid={`category-${opt.value}`}
                            >
                              <div className={cn("p-2 rounded-lg", opt.color)}>
                                <opt.icon className="h-4 w-4" />
                              </div>
                              <span className="font-medium text-sm">{opt.label}</span>
                              {category === opt.value && (
                                <Check className="h-4 w-4 text-primary ml-auto" />
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {currentStep === 2 && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="skill-instructions" className="text-sm font-medium">
                        Instrucciones del Skill
                      </Label>
                      <Badge variant="outline" className="text-xs">Markdown</Badge>
                    </div>
                    <Textarea
                      id="skill-instructions"
                      value={instructions}
                      onChange={(e) => { setInstructions(e.target.value); setErrors(prev => ({ ...prev, instructions: "" })); }}
                      placeholder={`# Mi Skill

## Instrucciones
Describe paso a paso cómo debe comportarse el asistente cuando este Skill esté activo...

## Ejemplos
Proporciona ejemplos de cómo responder...`}
                      className={cn("min-h-[200px] font-mono text-sm resize-none", errors.instructions && "border-red-500")}
                      data-testid="textarea-skill-instructions"
                    />
                    {errors.instructions && (
                      <span className="text-xs text-red-500 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {errors.instructions}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Capacidades (opcional)</Label>
                    <div className="flex gap-2">
                      <Input
                        value={newFeature}
                        onChange={(e) => setNewFeature(e.target.value)}
                        placeholder="Agregar capacidad..."
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addFeature())}
                        className="h-10"
                        data-testid="input-new-feature"
                      />
                      <Button type="button" variant="outline" size="icon" onClick={addFeature} className="h-10 w-10">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    {features.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {features.map((feature, i) => (
                          <Badge key={i} variant="secondary" className="gap-1.5 py-1 px-2.5">
                            {feature}
                            <button
                              onClick={() => removeFeature(feature)}
                              className="hover:bg-muted rounded-sm"
                              data-testid={`remove-feature-${i}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {currentStep === 3 && (
                <div className="space-y-6">
                  <div className="text-center pb-4">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-green-400 to-emerald-600 rounded-2xl mb-4">
                      <Eye className="h-8 w-8 text-white" />
                    </div>
                    <h3 className="text-lg font-semibold">Vista previa del Skill</h3>
                    <p className="text-sm text-muted-foreground">Revisa los detalles antes de crear</p>
                  </div>

                  <Card>
                    <CardContent className="p-5">
                      <div className="flex items-start gap-4">
                        <div className={cn("p-3 rounded-xl", getCategoryInfo().color)}>
                          {(() => {
                            const Icon = getCategoryInfo().icon;
                            return <Icon className="h-6 w-6" />;
                          })()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-lg">{name || "Sin nombre"}</h4>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {description || "Sin descripción"}
                          </p>
                          <div className="flex items-center gap-2 mt-3">
                            <Badge variant="outline">{getCategoryInfo().label}</Badge>
                            <Badge variant="secondary" className="gap-1">
                              <Check className="h-3 w-3" />
                              Activo
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid grid-cols-2 gap-4">
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <BookOpen className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Instrucciones</span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-3 font-mono">
                          {instructions.slice(0, 150) || "Sin instrucciones"}
                          {instructions.length > 150 && "..."}
                        </p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Settings2 className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Capacidades</span>
                        </div>
                        {features.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {features.slice(0, 3).map((f, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">{f}</Badge>
                            ))}
                            {features.length > 3 && (
                              <Badge variant="secondary" className="text-xs">+{features.length - 3}</Badge>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">Sin capacidades definidas</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </ScrollArea>

        <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/30">
          <Button
            variant="ghost"
            onClick={currentStep === 1 ? () => onOpenChange(false) : handleBack}
            className="gap-2"
            data-testid="button-back"
          >
            {currentStep === 1 ? (
              "Cancelar"
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                Atrás
              </>
            )}
          </Button>
          
          {currentStep < 3 ? (
            <Button onClick={handleNext} className="gap-2" data-testid="button-next">
              Continuar
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSave} className="gap-2 bg-green-600 hover:bg-green-700" data-testid="button-save-skill">
              <Check className="h-4 w-4" />
              {editingSkill ? "Guardar Cambios" : "Crear Skill"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
