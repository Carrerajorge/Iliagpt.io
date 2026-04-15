import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronLeft,
  Plus,
  X,
  MoreHorizontal,
  Link as LinkIcon,
  History,
  Copy,
  Trash2,
  Mic,
  Send,
  Upload,
  FileText,
  HelpCircle,
  RotateCcw,
  Lock,
  Users,
  ExternalLink,
  Wand2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/apiClient";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { useModelAvailability } from "@/contexts/ModelAvailabilityContext";
import type { Gpt } from "./gpt-explorer";
import type { GptKnowledge, GptAction } from "@shared/schema";

interface GptBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingGpt?: Gpt | null;
  onSave?: (gpt: Gpt) => void;
}

interface ActionFormData {
  name: string;
  description: string;
  httpMethod: string;
  endpoint: string;
  authType: string;
  authConfig?: string;
  openApiSpec?: string;
}

// ─── Instruction template generator ──────────────────────────────────
// Generates a structured system prompt from a GPT name + description
function generateInstructionTemplate(name: string, description: string): string {
  if (!name.trim()) return "";
  const desc = description.trim() || `un asistente especializado llamado "${name}"`;
  return `Eres "${name}". ${desc}.

## Rol y objetivo
Tu propósito principal es cumplir fielmente las instrucciones que el usuario ha definido para este GPT. Debes mantenerte en contexto y nunca desviarte de tu rol.

## Comportamiento
- Responde SIEMPRE dentro del dominio de tu especialidad definida arriba.
- Si el usuario hace una pregunta fuera de tu alcance, redirige amablemente al tema principal.
- Usa un tono profesional, claro y directo.
- Si tienes acceso a una Base de Conocimiento (RAG), prioriza esa información sobre tu conocimiento general.
- Nunca inventes datos ni cites fuentes que no existan en tu base de conocimiento.

## Formato de respuesta
- Estructura tus respuestas con encabezados, listas o pasos cuando sea apropiado.
- Sé conciso pero completo.
- Adapta la profundidad de la respuesta a la complejidad de la pregunta.`;
}

export function GptBuilder({ open, onOpenChange, editingGpt, onSave }: GptBuilderProps) {
  const { toast } = useToast();
  const { availableModels } = useModelAvailability();
  const [activeTab, setActiveTab] = useState<"crear" | "configurar">("configurar");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [knowledgeFiles, setKnowledgeFiles] = useState<GptKnowledge[]>([]);
  const [actions, setActions] = useState<GptAction[]>([]);
  const [previewMessage, setPreviewMessage] = useState("");
  const [previewModelId, setPreviewModelId] = useState<string>("");
  const [hasChanges, setHasChanges] = useState(false);
  const [showActionEditor, setShowActionEditor] = useState(false);
  const [editingAction, setEditingAction] = useState<GptAction | null>(null);
  const [actionForm, setActionForm] = useState<ActionFormData>({
    name: "",
    description: "",
    httpMethod: "GET",
    endpoint: "",
    authType: "none"
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [savedGptData, setSavedGptData] = useState<Gpt | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    description: "",
    systemPrompt: "",
    welcomeMessage: "",
    temperature: 0.7,
    topP: 1,
    maxTokens: 4096,
    visibility: "private" as "private" | "team" | "public",
    conversationStarters: [""],
    recommendedModel: "",
    capabilities: {
      webBrowsing: true,
      canvas: true,
      imageGeneration: true,
      codeInterpreter: false,
      wordCreation: true,
      excelCreation: true,
      pptCreation: true
    }
  });

  useEffect(() => {
    if (editingGpt) {
      setFormData({
        name: editingGpt.name,
        slug: editingGpt.slug,
        description: editingGpt.description || "",
        systemPrompt: editingGpt.systemPrompt,
        welcomeMessage: editingGpt.welcomeMessage || "",
        temperature: parseFloat(editingGpt.temperature || "0.7"),
        topP: parseFloat(editingGpt.topP || "1"),
        maxTokens: editingGpt.maxTokens || 4096,
        visibility: (editingGpt.visibility as "private" | "team" | "public") || "private",
        conversationStarters: Array.isArray(editingGpt.conversationStarters) && editingGpt.conversationStarters.length > 0
          ? editingGpt.conversationStarters
          : [""],
        recommendedModel: "",
        capabilities: editingGpt.capabilities || {
          webBrowsing: true,
          canvas: true,
          imageGeneration: true,
          codeInterpreter: false,
          wordCreation: true,
          excelCreation: true,
          pptCreation: true
        }
      });
      loadKnowledgeAndActions(editingGpt.id);
      setAvatarPreview(editingGpt.avatar || null);
    } else {
      setFormData({
        name: "",
        slug: "",
        description: "",
        systemPrompt: "",
        welcomeMessage: "",
        temperature: 0.7,
        topP: 1,
        maxTokens: 4096,
        visibility: "private",
        conversationStarters: [""],
        recommendedModel: "",
        capabilities: {
          webBrowsing: true,
          canvas: true,
          imageGeneration: true,
          codeInterpreter: false,
          wordCreation: true,
          excelCreation: true,
          pptCreation: true
        }
      });
      setKnowledgeFiles([]);
      setActions([]);
      setAvatarPreview(null);
    }
    setHasChanges(false);
    setPreviewMessage("");
  }, [editingGpt, open]);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result as string);
        setHasChanges(true);
      };
      reader.readAsDataURL(file);
    }
  };

  const loadKnowledgeAndActions = async (gptId: string) => {
    try {
      const [knowledgeRes, actionsRes] = await Promise.all([
        apiFetch(`/api/gpts/${gptId}/knowledge`),
        apiFetch(`/api/gpts/${gptId}/actions`)
      ]);
      if (knowledgeRes.ok) setKnowledgeFiles(await knowledgeRes.json());
      if (actionsRes.ok) setActions(await actionsRes.json());
    } catch (error) {
      console.error("Error loading knowledge/actions:", error);
    }
  };

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  };

  const handleFormChange = (updates: Partial<typeof formData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
    setHasChanges(true);
  };

  const syncFormData = (updates: Partial<typeof formData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  // Auto-generate instructions when name/description change and systemPrompt is empty
  const handleAutoGenerateInstructions = () => {
    const template = generateInstructionTemplate(formData.name, formData.description);
    if (template) {
      handleFormChange({ systemPrompt: template });
      toast({ title: "Instrucciones generadas", description: "Personaliza el system prompt según tus necesidades" });
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast({
        title: "Error",
        description: "El nombre es requerido",
        variant: "destructive"
      });
      return;
    }

    if (!formData.systemPrompt.trim()) {
      toast({
        title: "Instrucciones requeridas",
        description: "El System Prompt es obligatorio. Define cómo debe comportarse tu GPT.",
        variant: "destructive"
      });
      return;
    }

    setSaving(true);
    try {
      const slug = formData.slug || generateSlug(formData.name);
      const payload = {
        name: formData.name,
        slug,
        description: formData.description,
        avatar: avatarPreview,
        systemPrompt: formData.systemPrompt,
        welcomeMessage: formData.welcomeMessage,
        temperature: formData.temperature.toString(),
        topP: formData.topP.toString(),
        maxTokens: formData.maxTokens,
        visibility: formData.visibility,
        conversationStarters: formData.conversationStarters.filter(s => s.trim()),
        capabilities: formData.capabilities,
        recommendedModel: formData.recommendedModel || null
      };

      const url = editingGpt ? `/api/gpts/${editingGpt.id}` : "/api/gpts";
      const method = editingGpt ? "PATCH" : "POST";

      const response = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const savedGpt = await response.json();
        setSavedGptData(savedGpt);
        syncFormData({
          visibility: savedGpt.visibility || "private",
          name: savedGpt.name,
          slug: savedGpt.slug,
          description: savedGpt.description || "",
        });
        setHasChanges(false);
        setShowUpdateModal(true);
      } else {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Error al guardar");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "No se pudo guardar el GPT",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  const { uploadFile, isUploading: isHookUploading, progress: uploadProgress } = useUpload({
    uploadIdPrefix: `gpt-knowledge-${editingGpt?.id || 'new'}`,
  });

  const handleFileUpload = async (files: FileList) => {
    if (!editingGpt) {
      toast({
        title: "Guarda primero",
        description: "Guarda el GPT antes de subir archivos",
        variant: "destructive"
      });
      return;
    }

    setUploading(true);
    let uploadedCount = 0;

    for (const file of Array.from(files)) {
      try {
        const uploadRes = await uploadFile(file);

        if (uploadRes && uploadRes.storagePath) {
          const response = await apiFetch(`/api/gpts/${editingGpt.id}/knowledge`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: file.name,
              fileType: file.type || "application/octet-stream",
              fileSize: file.size,
              storageUrl: uploadRes.storagePath,
              embeddingStatus: "pending"
            })
          });

          if (response.ok) {
            const newKnowledge = await response.json();
            setKnowledgeFiles(prev => [newKnowledge, ...prev]);
            uploadedCount++;
          }
        }
      } catch (error) {
        console.error("Error uploading file:", error);
      }
    }

    setUploading(false);
    if (uploadedCount > 0) {
      toast({ title: `${uploadedCount} archivo(s) agregado(s) a la base de conocimiento` });
    } else {
      toast({ title: "No se pudieron agregar archivos", variant: "destructive" });
    }
  };

  const handleDeleteKnowledge = async (id: string) => {
    if (!editingGpt) return;
    try {
      await apiFetch(`/api/gpts/${editingGpt.id}/knowledge/${id}`, { method: "DELETE" });
      setKnowledgeFiles(prev => prev.filter(k => k.id !== id));
    } catch (error) {
      console.error("Error deleting knowledge:", error);
    }
  };

  const handleDeleteGpt = async () => {
    if (!editingGpt) return;
    if (!confirm("¿Estás seguro de que quieres eliminar este GPT?")) return;

    try {
      const response = await apiFetch(`/api/gpts/${editingGpt.id}`, { method: "DELETE" });
      if (response.ok) {
        toast({ title: "GPT eliminado" });
        onOpenChange(false);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo eliminar el GPT",
        variant: "destructive"
      });
    }
  };

  const handleDuplicateGpt = async () => {
    if (!editingGpt) return;
    try {
      const response = await apiFetch("/api/gpts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${formData.name} (copia)`,
          slug: generateSlug(`${formData.name}-copia-${Date.now()}`),
          description: formData.description,
          avatar: avatarPreview,
          systemPrompt: formData.systemPrompt,
          welcomeMessage: formData.welcomeMessage,
          temperature: formData.temperature.toString(),
          topP: formData.topP.toString(),
          maxTokens: formData.maxTokens,
          visibility: formData.visibility,
          conversationStarters: formData.conversationStarters.filter(s => s.trim()),
          capabilities: formData.capabilities,
          recommendedModel: formData.recommendedModel || null
        })
      });
      if (response.ok) {
        toast({ title: "GPT duplicado" });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo duplicar el GPT",
        variant: "destructive"
      });
    }
  };

  const addConversationStarter = () => {
    setFormData(prev => ({
      ...prev,
      conversationStarters: [...prev.conversationStarters, ""]
    }));
    setHasChanges(true);
  };

  const removeConversationStarter = (index: number) => {
    setFormData(prev => ({
      ...prev,
      conversationStarters: prev.conversationStarters.filter((_, i) => i !== index)
    }));
    setHasChanges(true);
  };

  const updateConversationStarter = (index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      conversationStarters: prev.conversationStarters.map((s, i) => i === index ? value : s)
    }));
    setHasChanges(true);
  };

  const handleCreateAction = () => {
    if (!editingGpt) {
      toast({
        title: "Guarda primero",
        description: "Guarda el GPT antes de crear acciones",
        variant: "destructive"
      });
      return;
    }
    setEditingAction(null);
    setActionForm({ name: "", description: "", httpMethod: "GET", endpoint: "", authType: "none", authConfig: "", openApiSpec: "" });
    setShowActionEditor(true);
  };

  const saveAction = async () => {
    if (!editingGpt || !actionForm.name.trim() || !actionForm.endpoint.trim()) {
      toast({
        title: "Error",
        description: "Nombre y endpoint son requeridos",
        variant: "destructive"
      });
      return;
    }

    try {
      const payload = {
        ...actionForm,
        authConfig: actionForm.authConfig && actionForm.authType !== 'none'
          ? { token: actionForm.authConfig }
          : null,
      };

      if (editingAction) {
        const response = await apiFetch(`/api/gpts/${editingGpt.id}/actions/${editingAction.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (response.ok) {
          const updated = await response.json();
          setActions(prev => prev.map(a => a.id === updated.id ? updated : a));
          toast({ title: "Acción actualizada" });
        }
      } else {
        const response = await apiFetch(`/api/gpts/${editingGpt.id}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (response.ok) {
          const newAction = await response.json();
          setActions(prev => [newAction, ...prev]);
          toast({ title: "Acción creada" });
        }
      }
      setShowActionEditor(false);
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo guardar la acción",
        variant: "destructive"
      });
    }
  };

  const handleVisibilityChange = async (newVisibility: string) => {
    if (!savedGptData) return;
    const typedVisibility = newVisibility as "private" | "team" | "public";
    const previousVisibility = savedGptData.visibility as "private" | "team" | "public";

    syncFormData({ visibility: typedVisibility });
    setSavedGptData(prev => prev ? { ...prev, visibility: typedVisibility } : null);

    try {
      const response = await apiFetch(`/api/gpts/${savedGptData.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: newVisibility })
      });

      if (response.ok) {
        const updatedGpt = await response.json();
        setSavedGptData(updatedGpt);
        syncFormData({ visibility: updatedGpt.visibility });
      } else {
        syncFormData({ visibility: previousVisibility });
        setSavedGptData(prev => prev ? { ...prev, visibility: previousVisibility } : null);
      }
    } catch (error) {
      console.error("Error updating visibility:", error);
      syncFormData({ visibility: previousVisibility });
      setSavedGptData(prev => prev ? { ...prev, visibility: previousVisibility } : null);
    }
  };

  const handleCopyLink = () => {
    if (savedGptData) {
      navigator.clipboard.writeText(`${window.location.origin}/gpt/${savedGptData.slug}`);
      toast({ title: "Enlace copiado" });
    }
  };

  const handleViewGpt = () => {
    setShowUpdateModal(false);
    if (savedGptData) {
      onSave?.(savedGptData);
    }
  };

  // Instruction quality indicator
  const instructionQuality = (() => {
    const prompt = formData.systemPrompt.trim();
    if (!prompt) return { level: "empty", label: "Sin instrucciones", color: "text-neutral-400" };
    if (prompt.length < 50) return { level: "weak", label: "Instrucciones muy cortas", color: "text-red-500" };
    if (prompt.length < 200) return { level: "basic", label: "Instrucciones básicas", color: "text-amber-500" };
    if (prompt.length < 500) return { level: "good", label: "Buenas instrucciones", color: "text-neutral-600 dark:text-neutral-400" };
    return { level: "excellent", label: "Instrucciones completas", color: "text-black dark:text-white" };
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-screen h-screen max-w-none rounded-none p-0 gap-0 overflow-hidden bg-white dark:bg-black border-none" data-testid="gpt-builder-dialog">
        <DialogTitle className="sr-only">Configurar GPT</DialogTitle>
        <DialogDescription className="sr-only">Constructor de GPT personalizado</DialogDescription>
        <div className="flex flex-col h-full">
          {/* ─── Header ─── */}
          <header className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                className="h-8 w-8 text-neutral-500 hover:text-black dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900"
                data-testid="button-back"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 flex items-center justify-center overflow-hidden">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-lg">+</span>
                  )}
                </div>
                <div>
                  <h1 className="font-semibold text-sm text-black dark:text-white">{formData.name || "Nuevo GPT"}</h1>
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-black dark:bg-white"></span>
                    <span className="text-xs text-neutral-500">Activo</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {hasChanges && (
                <span className="text-xs text-neutral-400">Cambios sin guardar</span>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-neutral-500 hover:text-black dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900" data-testid="button-more-options">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-white dark:bg-neutral-950 border-neutral-200 dark:border-neutral-800">
                  <DropdownMenuItem onClick={() => {
                    if (editingGpt) {
                      navigator.clipboard.writeText(`${window.location.origin}/gpt/${editingGpt.slug}`);
                      toast({ title: "Enlace copiado" });
                    }
                  }}>
                    <LinkIcon className="h-4 w-4 mr-2" />
                    Copiar enlace
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Revertir...
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <History className="h-4 w-4 mr-2" />
                    Historial de las versiones
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDuplicateGpt}>
                    <Copy className="h-4 w-4 mr-2" />
                    Duplicar GPT
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDeleteGpt} className="text-red-600 dark:text-red-400">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Eliminar GPT
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="outline"
                size="sm"
                data-testid="button-share"
                className="border-neutral-300 dark:border-neutral-700 text-black dark:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900"
                onClick={() => {
                  if (editingGpt) {
                    setSavedGptData(editingGpt);
                    setShowUpdateModal(true);
                  } else {
                    toast({
                      title: "Guarda primero",
                      description: "Guarda el GPT antes de compartir",
                      variant: "destructive"
                    });
                  }
                }}
              >
                <LinkIcon className="h-4 w-4 mr-2" />
                Compartir
              </Button>

              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className="bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 disabled:opacity-40"
                data-testid="button-update"
              >
                {saving ? "Guardando..." : "Actualizar"}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                className="h-8 w-8 ml-1 text-neutral-400 hover:text-black dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900"
                aria-label="Cerrar configuración de GPT"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </header>

          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* ─── Left panel: Configuration ─── */}
            <div className="flex-1 flex flex-col min-h-0 border-r border-neutral-200 dark:border-neutral-800">
              <div className="flex justify-center gap-4 py-4 border-b border-neutral-200 dark:border-neutral-800">
                <button
                  onClick={() => setActiveTab("crear")}
                  className={cn(
                    "px-6 py-2 text-sm font-medium rounded-full transition-all",
                    activeTab === "crear"
                      ? "bg-black text-white dark:bg-white dark:text-black"
                      : "text-neutral-400 hover:text-black dark:hover:text-white"
                  )}
                  data-testid="tab-crear"
                >
                  Crear
                </button>
                <button
                  onClick={() => setActiveTab("configurar")}
                  className={cn(
                    "px-6 py-2 text-sm font-medium rounded-full transition-all",
                    activeTab === "configurar"
                      ? "bg-black text-white dark:bg-white dark:text-black"
                      : "text-neutral-400 hover:text-black dark:hover:text-white"
                  )}
                  data-testid="tab-configurar"
                >
                  Configurar
                </button>
              </div>

              <div className="flex-1 overflow-y-auto max-h-[calc(100vh-140px)]">
                <div className="p-6 max-w-2xl mx-auto space-y-6 pb-10">
                  {activeTab === "crear" ? (
                    <div className="flex flex-col h-[calc(100vh-220px)] border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden bg-white dark:bg-black">
                      <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        <div className="flex gap-3">
                          <div className="w-8 h-8 rounded-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 flex items-center justify-center flex-shrink-0">
                            <Wand2 className="h-4 w-4 text-neutral-600 dark:text-neutral-400" />
                          </div>
                          <div className="bg-neutral-50 dark:bg-neutral-950 p-3 rounded-xl rounded-tl-none max-w-[85%] text-sm text-neutral-700 dark:text-neutral-300 border border-neutral-100 dark:border-neutral-900">
                            Te ayudaré a crear y configurar tu GPT. Dime, ¿de qué trata y qué quieres que haga? Puedo generar las instrucciones automáticamente.
                          </div>
                        </div>
                      </div>
                      <div className="p-4 bg-neutral-50 dark:bg-neutral-950 border-t border-neutral-200 dark:border-neutral-800">
                        <div className="flex flex-col gap-2 relative">
                          <Textarea
                            placeholder="Describe tu GPT: qué tema maneja, cómo debe responder, qué limites tiene..."
                            className="min-h-[80px] max-h-[200px] resize-y pr-12 text-sm bg-white dark:bg-black border-neutral-200 dark:border-neutral-800 text-black dark:text-white placeholder:text-neutral-400"
                          />
                          <Button size="icon" className="absolute right-3 bottom-3 h-8 w-8 rounded-lg bg-black dark:bg-white text-white dark:text-black hover:bg-neutral-700 dark:hover:bg-neutral-300" aria-label="Enviar mensaje al builder">
                            <Send className="h-4 w-4" />
                          </Button>
                        </div>
                        <p className="text-xs text-center text-neutral-400 mt-2">
                          El Agent Builder generará instrucciones estructuradas basadas en tu descripción.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <Accordion type="single" collapsible className="w-full space-y-4" defaultValue="general">
                      {/* ─── 1. Identity ─── */}
                      <AccordionItem value="general" className="border border-neutral-200 dark:border-neutral-800 rounded-xl bg-white dark:bg-black px-4">
                        <AccordionTrigger className="hover:no-underline font-medium text-black dark:text-white">1. Identidad del Agente</AccordionTrigger>
                        <AccordionContent className="space-y-6 pt-2 pb-6">
                          <div className="flex justify-center mb-2">
                            <button
                              className="w-20 h-20 rounded-full border-2 border-dashed border-neutral-300 dark:border-neutral-700 flex items-center justify-center hover:border-black dark:hover:border-white transition-colors overflow-hidden relative group"
                              onClick={() => avatarInputRef.current?.click()}
                              data-testid="button-upload-avatar"
                            >
                              {avatarPreview ? (
                                <>
                                  <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                    <Upload className="h-5 w-5 text-white" />
                                  </div>
                                </>
                              ) : (
                                <Plus className="h-8 w-8 text-neutral-300 dark:text-neutral-600" />
                              )}
                            </button>
                            <input
                              ref={avatarInputRef}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={handleAvatarUpload}
                              aria-label="Subir avatar"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="name" className="text-black dark:text-white">Nombre</Label>
                            <Input
                              id="name"
                              placeholder="Ej: Asistente Analítico"
                              value={formData.name}
                              onChange={(e) => handleFormChange({ name: e.target.value, slug: generateSlug(e.target.value) })}
                              className="border-neutral-200 dark:border-neutral-800 bg-white dark:bg-black text-black dark:text-white focus-visible:ring-black dark:focus-visible:ring-white"
                              data-testid="input-gpt-name"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="description" className="text-black dark:text-white">Descripción</Label>
                            <Input
                              id="description"
                              placeholder="Añade una breve descripción sobre el objetivo principal"
                              value={formData.description}
                              onChange={(e) => handleFormChange({ description: e.target.value })}
                              className="border-neutral-200 dark:border-neutral-800 bg-white dark:bg-black text-black dark:text-white focus-visible:ring-black dark:focus-visible:ring-white"
                              data-testid="input-gpt-description"
                            />
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      {/* ─── 2. Instructions ─── */}
                      <AccordionItem value="instructions" className="border border-neutral-200 dark:border-neutral-800 rounded-xl bg-white dark:bg-black px-4">
                        <AccordionTrigger className="hover:no-underline font-medium text-black dark:text-white">2. Instrucciones y Comportamiento</AccordionTrigger>
                        <AccordionContent className="space-y-6 pt-2 pb-6">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label htmlFor="instructions" className="text-black dark:text-white">
                                System Prompt
                              </Label>
                              <div className="flex items-center gap-3">
                                <span className={cn("text-xs font-medium", instructionQuality.color)}>
                                  {instructionQuality.label}
                                </span>
                                <span className="text-xs text-neutral-400">{formData.systemPrompt.length}/8,000</span>
                              </div>
                            </div>

                            <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                              Define las instrucciones que gobiernan el comportamiento de tu GPT. Estas instrucciones tienen la <strong>máxima prioridad</strong> en cada conversación. El GPT siempre las seguirá, sin importar el tema que el usuario le pregunte.
                            </p>

                            {!formData.systemPrompt.trim() && formData.name.trim() && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleAutoGenerateInstructions}
                                className="w-full border-dashed border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white hover:border-black dark:hover:border-white"
                              >
                                <Wand2 className="h-4 w-4 mr-2" />
                                Generar instrucciones automáticamente para "{formData.name}"
                              </Button>
                            )}

                            <Textarea
                              id="instructions"
                              placeholder={`Ejemplo:\nEres "Asistente Legal". Tu función es ayudar al usuario con consultas legales básicas.\n\n## Rol\nResponde preguntas sobre derecho civil, laboral y mercantil.\n\n## Límites\n- No ofrezcas asesoramiento legal definitivo.\n- Recomienda siempre consultar a un abogado.`}
                              value={formData.systemPrompt}
                              onChange={(e) => handleFormChange({ systemPrompt: e.target.value })}
                              className="min-h-[240px] max-h-[500px] resize-y font-mono text-sm leading-relaxed bg-neutral-50 dark:bg-neutral-950 border-neutral-200 dark:border-neutral-800 text-black dark:text-white placeholder:text-neutral-400 focus-visible:ring-black dark:focus-visible:ring-white"
                              maxLength={8000}
                              data-testid="input-gpt-instructions"
                            />

                            {formData.systemPrompt.trim() && formData.systemPrompt.length < 100 && (
                              <div className="flex items-start gap-2 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800">
                                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                                <p className="text-xs text-neutral-600 dark:text-neutral-400">
                                  Instrucciones muy cortas pueden causar respuestas genéricas. Incluye: rol, comportamiento esperado, límites y formato de respuesta.
                                </p>
                              </div>
                            )}
                          </div>

                          <div className="space-y-3">
                            <Label className="text-black dark:text-white">Frases sugestivas de entrada</Label>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">
                              Sugerencias que el usuario verá al iniciar un chat con este GPT.
                            </p>
                            <div className="space-y-2">
                              {formData.conversationStarters.map((starter, index) => (
                                <div key={index} className="flex items-center gap-2 group">
                                  <Input
                                    placeholder="Ej: Analiza este reporte de gastos..."
                                    value={starter}
                                    onChange={(e) => updateConversationStarter(index, e.target.value)}
                                    className="bg-neutral-50 dark:bg-neutral-950 border-neutral-200 dark:border-neutral-800 text-black dark:text-white focus-visible:ring-black dark:focus-visible:ring-white"
                                    data-testid={`input-starter-${index}`}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeConversationStarter(index)}
                                    className="h-9 w-9 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-neutral-400 hover:text-black dark:hover:text-white"
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={addConversationStarter}
                              className="w-full border-dashed border-neutral-300 dark:border-neutral-700 text-neutral-500 hover:text-black dark:hover:text-white hover:border-black dark:hover:border-white"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Añadir frase de inicio
                            </Button>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center gap-1">
                              <Label className="text-black dark:text-white">Modelo Principal</Label>
                              <HelpCircle className="h-4 w-4 text-neutral-400" />
                            </div>
                            <Select
                              value={formData.recommendedModel || "none"}
                              onValueChange={(value) => handleFormChange({ recommendedModel: value === "none" ? "" : value })}
                            >
                              <SelectTrigger className="w-full bg-neutral-50 dark:bg-neutral-950 border-neutral-200 dark:border-neutral-800 text-black dark:text-white" data-testid="select-model">
                                <SelectValue placeholder="Dinámico (Determinado por la plataforma)" />
                              </SelectTrigger>
                              <SelectContent className="bg-white dark:bg-neutral-950 border-neutral-200 dark:border-neutral-800">
                                <SelectItem value="none">Dinámico (Determinado por la plataforma)</SelectItem>
                                {availableModels.map((model) => (
                                  <SelectItem key={model.id} value={model.modelId}>
                                    {model.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      {/* ─── 3. Knowledge Base (RAG) ─── */}
                      <AccordionItem value="knowledge" className="border border-neutral-200 dark:border-neutral-800 rounded-xl bg-white dark:bg-black px-4">
                        <AccordionTrigger className="hover:no-underline font-medium text-black dark:text-white flex items-center gap-2">
                          3. Base de Conocimiento (RAG)
                          <span className="ml-2 text-xs font-normal px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-900 text-neutral-500 border border-neutral-200 dark:border-neutral-800">
                            {knowledgeFiles.length}
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-4 pt-2 pb-6">
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 pb-3 border-b border-neutral-100 dark:border-neutral-900 leading-relaxed">
                            Sube archivos que serán indexados como embeddings vectoriales. El GPT buscará en estos documentos para contextualizar sus respuestas con información específica de tu dominio.
                          </p>

                          {knowledgeFiles.length > 0 && (
                            <div className="space-y-2 mb-4">
                              {knowledgeFiles.map((file) => (
                                <div key={file.id} className="flex items-center justify-between p-3 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-xl hover:border-black dark:hover:border-white transition-colors">
                                  <div className="flex items-center gap-3 overflow-hidden">
                                    <div className="p-2 bg-neutral-100 dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800">
                                      <FileText className="h-4 w-4 text-neutral-600 dark:text-neutral-400" />
                                    </div>
                                    <div className="flex flex-col overflow-hidden">
                                      <span className="text-sm font-medium text-black dark:text-white truncate" title={file.fileName}>{file.fileName}</span>
                                      <span className="text-xs text-neutral-500 flex items-center gap-1">
                                        {file.embeddingStatus === "completed" ? (
                                          <><CheckCircle2 className="h-3 w-3 text-black dark:text-white" /> Indexado en vector DB</>
                                        ) : file.embeddingStatus === "failed" ? (
                                          <><AlertCircle className="h-3 w-3 text-red-500" /> Error al indexar</>
                                        ) : (
                                          <>Procesando embeddings...</>
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeleteKnowledge(file.id)}
                                    className="h-8 w-8 text-neutral-400 hover:text-red-600 dark:hover:text-red-400 shrink-0"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}

                          {isHookUploading && (
                            <div className="space-y-2 mb-4 p-4 border border-neutral-200 dark:border-neutral-800 rounded-xl bg-neutral-50 dark:bg-neutral-950">
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-neutral-500 flex items-center gap-2">
                                  <Upload className="h-4 w-4 animate-pulse" />
                                  Subiendo archivo(s)...
                                </span>
                                <span className="font-medium text-black dark:text-white">{uploadProgress}%</span>
                              </div>
                              <div className="h-1.5 w-full bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-black dark:bg-white transition-all duration-300 ease-out rounded-full"
                                  style={{ width: `${uploadProgress}%` }}
                                />
                              </div>
                            </div>
                          )}

                          <Button
                            variant="outline"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading || isHookUploading}
                            className="w-full border-neutral-300 dark:border-neutral-700 text-black dark:text-white hover:bg-neutral-50 dark:hover:bg-neutral-950 hover:border-black dark:hover:border-white"
                            data-testid="button-upload-files"
                          >
                            <Upload className="h-4 w-4 mr-2" />
                            {uploading || isHookUploading ? "Ingestando en vector DB..." : "Añadir conocimiento (.pdf, .docx, .csv, .json, .txt)"}
                          </Button>
                          <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            className="hidden"
                            accept=".pdf,.txt,.docx,.xlsx,.csv,.json"
                            onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                            aria-label="Cargar archivos de conocimiento"
                          />
                        </AccordionContent>
                      </AccordionItem>

                      {/* ─── 4. Native Capabilities ─── */}
                      <AccordionItem value="capabilities" className="border border-neutral-200 dark:border-neutral-800 rounded-xl bg-white dark:bg-black px-4">
                        <AccordionTrigger className="hover:no-underline font-medium text-black dark:text-white">4. Habilidades Nativas</AccordionTrigger>
                        <AccordionContent className="pt-2 pb-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {[
                              { id: "webBrowsing", label: "Búsqueda en la web" },
                              { id: "canvas", label: "Lienzo Interactivo" },
                              { id: "imageGeneration", label: "Generación de imagen" },
                              { id: "codeInterpreter", label: "Intérprete de código" },
                              { id: "wordCreation", label: "Creación de Word" },
                              { id: "excelCreation", label: "Creación de Excel" },
                              { id: "pptCreation", label: "Creación de PowerPoint" },
                            ].map((cap) => (
                              <div key={cap.id} className="flex items-center space-x-3 p-3 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-xl hover:border-black dark:hover:border-white transition-colors">
                                <Checkbox
                                  id={cap.id}
                                  checked={(formData.capabilities as any)[cap.id]}
                                  onCheckedChange={(checked) =>
                                    handleFormChange({
                                      capabilities: { ...formData.capabilities, [cap.id]: !!checked }
                                    })
                                  }
                                  className="border-neutral-300 dark:border-neutral-700 data-[state=checked]:bg-black data-[state=checked]:border-black dark:data-[state=checked]:bg-white dark:data-[state=checked]:border-white"
                                />
                                <label htmlFor={cap.id} className="text-sm cursor-pointer select-none flex-1 text-neutral-700 dark:text-neutral-300">
                                  {cap.label}
                                </label>
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      {/* ─── 5. Actions & API ─── */}
                      <AccordionItem value="actions" className="border border-neutral-200 dark:border-neutral-800 rounded-xl bg-white dark:bg-black px-4">
                        <AccordionTrigger className="hover:no-underline font-medium text-black dark:text-white flex items-center gap-2">
                          5. Acciones y Conexiones API
                          <span className="ml-2 text-xs font-normal px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-900 text-neutral-500 border border-neutral-200 dark:border-neutral-800">
                            {actions.length}
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-4 pt-2 pb-6">
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 pb-3 border-b border-neutral-100 dark:border-neutral-900 leading-relaxed">
                            Vincula APIs web a tu GPT. El agente podrá ejecutar estas acciones durante la conversación cuando sean relevantes.
                          </p>

                          {actions.length > 0 && (
                            <div className="space-y-2 mb-4">
                              {actions.map((action) => (
                                <div key={action.id} className="flex items-center justify-between p-3 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-xl hover:border-black dark:hover:border-white transition-colors cursor-pointer" onClick={() => {
                                  setEditingAction(action);
                                  setActionForm({
                                    name: action.name,
                                    description: action.description || "",
                                    httpMethod: action.httpMethod || "GET",
                                    endpoint: action.endpoint ?? "",
                                    authType: action.authType ?? "none",
                                    authConfig: action.authConfig ? (action.authConfig as any).token : "",
                                    openApiSpec: (action as { openApiSpec?: unknown }).openApiSpec ? JSON.stringify((action as { openApiSpec?: unknown }).openApiSpec, null, 2) : ""
                                  });
                                  setShowActionEditor(true);
                                }}>
                                  <div className="flex items-center gap-3">
                                    <span className={cn(
                                      "text-[10px] font-bold tracking-wider px-2 py-1 rounded-md w-16 text-center border",
                                      action.httpMethod === "GET" ? "bg-neutral-100 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-800" :
                                        action.httpMethod === "POST" ? "bg-black dark:bg-white text-white dark:text-black border-black dark:border-white" :
                                          action.httpMethod === "DELETE" ? "bg-neutral-100 dark:bg-neutral-900 text-red-600 dark:text-red-400 border-neutral-200 dark:border-neutral-800" :
                                            "bg-neutral-100 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-800"
                                    )}>
                                      {action.httpMethod}
                                    </span>
                                    <div className="flex flex-col">
                                      <span className="text-sm font-medium text-black dark:text-white">{action.name}</span>
                                      <span className="text-xs text-neutral-500 truncate max-w-[200px]" title={action.endpoint || ""}>{action.endpoint}</span>
                                    </div>
                                  </div>
                                  <ChevronLeft className="h-4 w-4 text-neutral-400 rotate-180" />
                                </div>
                              ))}
                            </div>
                          )}

                          <Button
                            variant="outline"
                            onClick={handleCreateAction}
                            className="w-full border-neutral-300 dark:border-neutral-700 text-black dark:text-white hover:bg-neutral-50 dark:hover:bg-neutral-950 hover:border-black dark:hover:border-white"
                            data-testid="button-create-action"
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Añadir Conexión API / Endpoint
                          </Button>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}
                </div>
              </div>
            </div>

            {/* ─── Right panel: Preview ─── */}
            <div className="w-[400px] flex flex-col bg-neutral-50 dark:bg-neutral-950">
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
                <span className="text-sm font-medium text-black dark:text-white">Vista previa</span>
                <Select
                  value={previewModelId || (availableModels[0]?.modelId || "")}
                  onValueChange={setPreviewModelId}
                >
                  <SelectTrigger className="w-[180px] h-8 text-xs border-neutral-200 dark:border-neutral-800 bg-white dark:bg-black text-black dark:text-white">
                    <SelectValue placeholder="Seleccionar modelo" />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-neutral-950 border-neutral-200 dark:border-neutral-800">
                    {availableModels.map((model) => (
                      <SelectItem key={model.id} value={model.modelId}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center p-6">
                <div className="w-16 h-16 rounded-2xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 flex items-center justify-center mb-4 overflow-hidden">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl text-neutral-400">+</span>
                  )}
                </div>
                <p className="text-sm font-medium text-black dark:text-white mb-1">
                  {formData.name || "Tu GPT"}
                </p>
                <p className="text-xs text-center text-neutral-500 dark:text-neutral-400 max-w-xs">
                  {formData.description || "Vista previa de tu GPT"}
                </p>

                {/* Instruction status in preview */}
                {formData.systemPrompt.trim() && (
                  <div className="mt-6 w-full max-w-xs">
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-white dark:bg-black border border-neutral-200 dark:border-neutral-800">
                      <CheckCircle2 className="h-4 w-4 text-black dark:text-white flex-shrink-0" />
                      <p className="text-xs text-neutral-600 dark:text-neutral-400">
                        Instrucciones configuradas ({formData.systemPrompt.length} chars)
                      </p>
                    </div>
                    {knowledgeFiles.length > 0 && (
                      <div className="flex items-center gap-2 p-3 mt-2 rounded-xl bg-white dark:bg-black border border-neutral-200 dark:border-neutral-800">
                        <FileText className="h-4 w-4 text-black dark:text-white flex-shrink-0" />
                        <p className="text-xs text-neutral-600 dark:text-neutral-400">
                          {knowledgeFiles.length} documento(s) en RAG
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-neutral-200 dark:border-neutral-800">
                <div className="flex items-center gap-2 p-3 bg-white dark:bg-black rounded-full border border-neutral-200 dark:border-neutral-800">
                  <Plus className="h-5 w-5 text-neutral-400" />
                  <input
                    type="text"
                    placeholder="Pregunta lo que quieras"
                    value={previewMessage}
                    onChange={(e) => setPreviewMessage(e.target.value)}
                    className="flex-1 bg-transparent outline-none text-sm text-black dark:text-white placeholder:text-neutral-400"
                    data-testid="input-preview-message"
                    aria-label="Mensaje de vista previa"
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-neutral-400 hover:text-black dark:hover:text-white">
                    <Mic className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    className="h-8 w-8 rounded-full bg-black dark:bg-white text-white dark:text-black hover:bg-neutral-700 dark:hover:bg-neutral-300"
                    disabled={!previewMessage.trim()}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Action Editor Dialog ─── */}
        {showActionEditor && (
          <Dialog open={showActionEditor} onOpenChange={setShowActionEditor}>
            <DialogContent className="sm:max-w-[500px] bg-white dark:bg-black border-neutral-200 dark:border-neutral-800" data-testid="action-editor-dialog">
              <DialogHeader>
                <DialogTitle className="text-black dark:text-white">{editingAction ? "Editar acción" : "Nueva acción"}</DialogTitle>
                <VisuallyHidden>
                  <DialogDescription>Configura los detalles de la acción API</DialogDescription>
                </VisuallyHidden>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <Label htmlFor="action-name" className="text-black dark:text-white">Nombre</Label>
                  <Input
                    id="action-name"
                    placeholder="Ej: Consultar clima"
                    value={actionForm.name}
                    onChange={(e) => setActionForm(prev => ({ ...prev, name: e.target.value }))}
                    className="mt-1 border-neutral-200 dark:border-neutral-800 bg-white dark:bg-black text-black dark:text-white"
                    data-testid="input-action-name"
                  />
                </div>
                <div>
                  <Label htmlFor="action-description" className="text-black dark:text-white">Descripción</Label>
                  <Textarea
                    id="action-description"
                    placeholder="Describe lo que hace esta acción..."
                    value={actionForm.description}
                    onChange={(e) => setActionForm(prev => ({ ...prev, description: e.target.value }))}
                    className="mt-1 border-neutral-200 dark:border-neutral-800 bg-white dark:bg-black text-black dark:text-white"
                    data-testid="input-action-description"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-black dark:text-white">Método HTTP</Label>
                    <div className="flex gap-1 mt-1">
                      {["GET", "POST", "PUT", "DELETE"].map((method) => (
                        <Button
                          key={method}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setActionForm(prev => ({ ...prev, httpMethod: method }))}
                          className={cn(
                            "border-neutral-300 dark:border-neutral-700",
                            actionForm.httpMethod === method
                              ? "bg-black text-white dark:bg-white dark:text-black border-black dark:border-white"
                              : "text-neutral-600 dark:text-neutral-400 hover:border-black dark:hover:border-white"
                          )}
                        >
                          {method}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-black dark:text-white">Autenticación</Label>
                    <div className="flex gap-1 mt-1 mb-3">
                      {[{ value: "none", label: "Ninguna" }, { value: "api_key", label: "API Key" }, { value: "bearer", label: "Bearer" }].map((auth) => (
                        <Button
                          key={auth.value}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setActionForm(prev => ({ ...prev, authType: auth.value }))}
                          className={cn(
                            "border-neutral-300 dark:border-neutral-700",
                            actionForm.authType === auth.value
                              ? "bg-black text-white dark:bg-white dark:text-black border-black dark:border-white"
                              : "text-neutral-600 dark:text-neutral-400 hover:border-black dark:hover:border-white"
                          )}
                        >
                          {auth.label}
                        </Button>
                      ))}
                    </div>
                    {actionForm.authType !== "none" && (
                      <div className="space-y-1 animate-in fade-in slide-in-from-top-2">
                        <Label htmlFor="action-auth-config" className="text-xs text-neutral-500 flex items-center gap-1">
                          <Lock className="h-3 w-3" />
                          Token o API Key
                        </Label>
                        <Input
                          id="action-auth-config"
                          type="password"
                          placeholder={actionForm.authType === "bearer" ? "ey..." : "sk-..."}
                          value={actionForm.authConfig || ""}
                          onChange={(e) => setActionForm(prev => ({ ...prev, authConfig: e.target.value }))}
                          className="mt-1 font-mono text-xs border-neutral-200 dark:border-neutral-800 bg-white dark:bg-black text-black dark:text-white"
                          data-testid="input-action-auth-config"
                        />
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <Label htmlFor="action-endpoint" className="text-black dark:text-white">Endpoint URL</Label>
                  <Input
                    id="action-endpoint"
                    placeholder="https://api.example.com/endpoint"
                    value={actionForm.endpoint}
                    onChange={(e) => setActionForm(prev => ({ ...prev, endpoint: e.target.value }))}
                    className="mt-1 font-mono text-sm border-neutral-200 dark:border-neutral-800 bg-white dark:bg-black text-black dark:text-white"
                    data-testid="input-action-endpoint"
                  />
                </div>
                <div>
                  <Label htmlFor="action-openapi-spec" className="flex items-center justify-between text-black dark:text-white">
                    <span>Esquema OpenAPI (Opcional)</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = "application/json,.json,.yaml,.yml";
                        input.onchange = async (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0];
                          if (file) {
                            const text = await file.text();
                            setActionForm(prev => ({ ...prev, openApiSpec: text }));
                          }
                        };
                        input.click();
                      }}
                      className="h-6 text-xs px-2 text-neutral-500 hover:text-black dark:hover:text-white"
                    >
                      <Upload className="h-3 w-3 mr-1" /> Importar
                    </Button>
                  </Label>
                  <Textarea
                    id="action-openapi-spec"
                    placeholder="Pega aquí el JSON o YAML de tu esquema OpenAPI..."
                    value={actionForm.openApiSpec || ""}
                    onChange={(e) => setActionForm(prev => ({ ...prev, openApiSpec: e.target.value }))}
                    className="mt-1 font-mono text-xs h-32 border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-black dark:text-white"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setShowActionEditor(false)}
                    className="border-neutral-300 dark:border-neutral-700 text-black dark:text-white"
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={saveAction}
                    className="bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
                    data-testid="button-save-action"
                  >
                    {editingAction ? "Actualizar" : "Crear"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* ─── Update confirmation modal ─── */}
        {showUpdateModal && savedGptData && (
          <Dialog open={showUpdateModal} onOpenChange={setShowUpdateModal}>
            <DialogContent className="sm:max-w-[400px] bg-white dark:bg-black border-neutral-200 dark:border-neutral-800" data-testid="gpt-updated-modal">
              <DialogHeader className="flex flex-row items-center justify-between">
                <DialogTitle className="text-black dark:text-white">GPT actualizado</DialogTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowUpdateModal(false)}
                  className="h-6 w-6 rounded-full text-neutral-400 hover:text-black dark:hover:text-white"
                  data-testid="button-close-update-modal"
                >
                  <X className="h-4 w-4" />
                </Button>
              </DialogHeader>
              <VisuallyHidden>
                <DialogDescription>Tu GPT ha sido actualizado correctamente</DialogDescription>
              </VisuallyHidden>

              <div className="py-4">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 rounded-xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 flex items-center justify-center overflow-hidden">
                    {savedGptData.avatar ? (
                      <img src={savedGptData.avatar} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xl text-neutral-400">+</span>
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-black dark:text-white">{savedGptData.name}</h3>
                    <p className="text-sm text-neutral-500">Por {(savedGptData as { creatorUsername?: string }).creatorUsername || "ti"}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-medium text-black dark:text-white">Acceso</Label>

                  {[
                    { value: "private", label: "Privado", desc: "Solo tú puedes acceder", icon: Lock },
                    { value: "team", label: "Equipo", desc: "Miembros de tu equipo pueden acceder", icon: Users },
                    { value: "public", label: "Cualquiera con el enlace", desc: "Público con enlace", icon: LinkIcon },
                  ].map(({ value, label, desc, icon: Icon }) => (
                    <div
                      key={value}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                        formData.visibility === value
                          ? "border-black dark:border-white bg-neutral-50 dark:bg-neutral-950"
                          : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-600"
                      )}
                      onClick={() => handleVisibilityChange(value)}
                      data-testid={`visibility-${value}`}
                    >
                      <div className={cn(
                        "w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5",
                        formData.visibility === value ? "border-black dark:border-white" : "border-neutral-300 dark:border-neutral-700"
                      )}>
                        {formData.visibility === value && (
                          <div className="w-2.5 h-2.5 rounded-full bg-black dark:bg-white" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-neutral-600 dark:text-neutral-400" />
                          <span className="font-medium text-sm text-black dark:text-white">{label}</span>
                        </div>
                        <p className="text-xs text-neutral-500 mt-1">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 border-neutral-300 dark:border-neutral-700 text-black dark:text-white hover:bg-neutral-50 dark:hover:bg-neutral-950"
                  onClick={handleCopyLink}
                  data-testid="button-copy-link"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copiar enlace
                </Button>
                <Button
                  className="flex-1 bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
                  onClick={handleViewGpt}
                  data-testid="button-view-gpt"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Ver GPT
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
