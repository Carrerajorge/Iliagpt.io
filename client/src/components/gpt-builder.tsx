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
  ExternalLink
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

  // Sync form data without marking as changed (for server response hydration)
  const syncFormData = (updates: Partial<typeof formData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
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
        // Sync all formData with server response without marking dirty
        syncFormData({
          visibility: savedGpt.visibility || "private",
          name: savedGpt.name,
          slug: savedGpt.slug,
          description: savedGpt.description || "",
        });
        setHasChanges(false);
        // Show confirmation modal with visibility options
        // onSave is called when modal closes to prevent parent from closing builder
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
      toast({ title: `${uploadedCount} archivo(s) agregado(s)` });
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

    // Update immediately for UI responsiveness (without marking dirty)
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
        // Revert on error
        syncFormData({ visibility: previousVisibility });
        setSavedGptData(prev => prev ? { ...prev, visibility: previousVisibility } : null);
      }
    } catch (error) {
      console.error("Error updating visibility:", error);
      // Revert on error using captured previous value
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
    // onSave already called in handleSave, just close modal
    // If visibility was changed, notify parent with updated data
    if (savedGptData) {
      onSave?.(savedGptData);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-screen h-screen max-w-none rounded-none p-0 gap-0 overflow-hidden" data-testid="gpt-builder-dialog">
        <DialogTitle className="sr-only">Configurar GPT</DialogTitle>
        <DialogDescription className="sr-only">Constructor de GPT personalizado</DialogDescription>
        <div className="flex flex-col h-full bg-background">
          <header className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                className="h-8 w-8"
                data-testid="button-back"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-lg">🤖</span>
                  )}
                </div>
                <div>
                  <h1 className="font-semibold text-sm">{formData.name || "Nuevo GPT"}</h1>
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    <span className="text-xs text-muted-foreground">Activo</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {hasChanges && (
                <span className="text-sm text-muted-foreground">Actualizaciones pendientes</span>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-more-options">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
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
                  <DropdownMenuItem onClick={handleDeleteGpt} className="text-destructive">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Eliminar GPT
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="outline"
                size="sm"
                data-testid="button-share"
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
                className="bg-green-600 hover:bg-green-700"
                data-testid="button-update"
              >
                {saving ? "Guardando..." : "Actualizar"}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                className="h-8 w-8 ml-2 text-muted-foreground hover:bg-muted"
                aria-label="Cerrar configuración de GPT"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </header>

          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 flex flex-col min-h-0 border-r">
              <div className="flex justify-center gap-4 py-4 border-b">
                <button
                  onClick={() => setActiveTab("crear")}
                  className={cn(
                    "px-6 py-2 text-sm font-medium rounded-full transition-colors",
                    activeTab === "crear"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid="tab-crear"
                >
                  Crear
                </button>
                <button
                  onClick={() => setActiveTab("configurar")}
                  className={cn(
                    "px-6 py-2 text-sm font-medium rounded-full transition-colors",
                    activeTab === "configurar"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid="tab-configurar"
                >
                  Configurar
                </button>
              </div>

              <div className="flex-1 overflow-y-auto max-h-[calc(100vh-140px)]">
                <div className="p-6 max-w-2xl mx-auto space-y-6 pb-10">
                  {activeTab === "crear" ? (
                    <div className="flex flex-col h-[calc(100vh-220px)] border rounded-lg overflow-hidden bg-background">
                      <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        <div className="flex gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-sm">🤖</span>
                          </div>
                          <div className="bg-muted p-3 rounded-lg rounded-tl-none max-w-[85%] text-sm">
                            ¡Hola! Te ayudaré a crear y configurar tu GPT. Dime, ¿de qué trata y qué quieres que haga? Puedo actualizar su configuración en tiempo real según lo que hablemos.
                          </div>
                        </div>
                      </div>
                      <div className="p-4 bg-muted/30 border-t">
                        <div className="flex flex-col gap-2 relative">
                          <Textarea
                            placeholder="Escribe un mensaje al Agent Builder..."
                            className="min-h-[80px] max-h-[200px] resize-y pr-12 text-sm bg-background border-muted"
                          />
                          <Button size="icon" className="absolute right-3 bottom-3 h-8 w-8 rounded-lg bg-primary/90 hover:bg-primary transition-all shadow-sm" aria-label="Enviar mensaje al builder">
                            <Send className="h-4 w-4" />
                          </Button>
                        </div>
                        <p className="text-xs text-center text-muted-foreground mt-2">
                          El chat de Agent Builder está en desarrollo. Generará metadatos automáticamente guiando tus decisiones.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <Accordion type="single" collapsible className="w-full space-y-4" defaultValue="general">
                      <AccordionItem value="general" className="border rounded-lg bg-card px-4">
                        <AccordionTrigger className="hover:no-underline font-medium">1. Identidad del Agente</AccordionTrigger>
                        <AccordionContent className="space-y-6 pt-2 pb-6">
                          <div className="flex justify-center mb-2">
                            <button
                              className="w-20 h-20 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center hover:border-muted-foreground/50 transition-colors overflow-hidden relative group"
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
                                <Plus className="h-8 w-8 text-muted-foreground/50" />
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
                            <Label htmlFor="name">Nombre</Label>
                            <Input
                              id="name"
                              placeholder="Ej: Asistente Analítico"
                              value={formData.name}
                              onChange={(e) => handleFormChange({ name: e.target.value, slug: generateSlug(e.target.value) })}
                              data-testid="input-gpt-name"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="description">Descripción</Label>
                            <Input
                              id="description"
                              placeholder="Añade una breve descripción sobre el objetivo principal"
                              value={formData.description}
                              onChange={(e) => handleFormChange({ description: e.target.value })}
                              data-testid="input-gpt-description"
                            />
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="instructions" className="border rounded-lg bg-card px-4">
                        <AccordionTrigger className="hover:no-underline font-medium">2. Instrucciones y Comportamiento</AccordionTrigger>
                        <AccordionContent className="space-y-6 pt-2 pb-6">
                          <div className="space-y-2">
                            <Label htmlFor="instructions" className="flex justify-between">
                              <span>System Prompt</span>
                              <span className="text-xs font-normal text-muted-foreground">{formData.systemPrompt.length}/8,000</span>
                            </Label>
                            <Textarea
                              id="instructions"
                              placeholder="Define minuciosamente cómo actúa este GPT y sus límites operativos..."
                              value={formData.systemPrompt}
                              onChange={(e) => handleFormChange({ systemPrompt: e.target.value })}
                              className="min-h-[200px] max-h-[400px] resize-y font-mono text-sm leading-relaxed bg-muted/30"
                              maxLength={8000}
                              data-testid="input-gpt-instructions"
                            />
                          </div>

                          <div className="space-y-3">
                            <Label>Frases sugestivas de entrada (Conversation Starters)</Label>
                            <div className="space-y-2">
                              {formData.conversationStarters.map((starter, index) => (
                                <div key={index} className="flex items-center gap-2 group">
                                  <Input
                                    placeholder="Ej: Analiza este reporte de gastos..."
                                    value={starter}
                                    onChange={(e) => updateConversationStarter(index, e.target.value)}
                                    className="bg-muted/30"
                                    data-testid={`input-starter-${index}`}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeConversationStarter(index)}
                                    className="h-9 w-9 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
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
                              className="w-full text-muted-foreground border-dashed"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Añadir frase de inicio
                            </Button>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center gap-1">
                              <Label>Modelo Principal</Label>
                              <HelpCircle className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <Select
                              value={formData.recommendedModel || "none"}
                              onValueChange={(value) => handleFormChange({ recommendedModel: value === "none" ? "" : value })}
                            >
                              <SelectTrigger className="w-full bg-muted/30" data-testid="select-model">
                                <SelectValue placeholder="Modelo predeterminado delegado a la plataforma" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Dinámico (Determinado por la plataforma)</SelectItem>
                                <SelectItem value="gpt-4o">GPT-4o (Lógico avanzado)</SelectItem>
                                <SelectItem value="gpt-4o-mini">GPT-4o mini (Velocidad)</SelectItem>
                                <SelectItem value="gpt-o1">GPT-o1 (Razonamiento profundo)</SelectItem>
                                <SelectItem value="gpt-o3-mini">GPT-o3-mini</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="knowledge" className="border rounded-lg bg-card px-4">
                        <AccordionTrigger className="hover:no-underline font-medium flex items-center gap-2">
                          3. Base de Conocimiento (RAG)
                          <span className="ml-2 text-xs font-normal px-2 py-0.5 rounded-full bg-muted flex items-center justify-center">
                            {knowledgeFiles.length}
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-4 pt-2 pb-6">
                          <p className="text-xs text-muted-foreground pb-2 border-b">
                            Archivos indexados para ser usados como contexto externo incrustado en memoria vectorial.
                          </p>
                          {knowledgeFiles.length > 0 && (
                            <div className="space-y-2 mb-4">
                              {knowledgeFiles.map((file) => (
                                <div key={file.id} className="flex items-center justify-between p-3 bg-muted/40 border rounded-lg hover:border-primary/50 transition-colors">
                                  <div className="flex items-center gap-3 overflow-hidden">
                                    <div className="p-2 bg-primary/10 rounded-md text-primary">
                                      <FileText className="h-4 w-4" />
                                    </div>
                                    <div className="flex flex-col overflow-hidden">
                                      <span className="text-sm font-medium truncate" title={file.fileName}>{file.fileName}</span>
                                      <span className="text-xs text-muted-foreground">Vector Mapping {file.embeddingStatus === "completed" ? "✅" : "⏳"}</span>
                                    </div>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeleteKnowledge(file.id)}
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}

                          {isHookUploading && (
                            <div className="space-y-2 mb-4 p-4 border rounded-lg bg-muted/30">
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-muted-foreground flex items-center gap-2">
                                  <Upload className="h-4 w-4 animate-pulse" />
                                  Subiendo archivo(s)...
                                </span>
                                <span className="font-medium">{uploadProgress}%</span>
                              </div>
                              <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary transition-all duration-300 ease-out"
                                  style={{ width: `${uploadProgress}%` }}
                                />
                              </div>
                            </div>
                          )}

                          <Button
                            variant="secondary"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading || isHookUploading}
                            className="w-full"
                            data-testid="button-upload-files"
                          >
                            <Upload className="h-4 w-4 mr-2" />
                            {uploading || isHookUploading ? "Ingestando en vector db..." : "Añadir Conocimiento de Formatos (.pdf, .json, .csv)"}
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

                      <AccordionItem value="capabilities" className="border rounded-lg bg-card px-4">
                        <AccordionTrigger className="hover:no-underline font-medium">4. Habilidades Nativas</AccordionTrigger>
                        <AccordionContent className="pt-2 pb-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {[
                              { id: "webBrowsing", label: "Búsqueda en la web", icon: "🌐" },
                              { id: "canvas", label: "Lienzo Interactivo", icon: "🎨" },
                              { id: "imageGeneration", label: "Generación de imagen", icon: "🖼️" },
                              { id: "codeInterpreter", label: "Intérprete de código", icon: "💻" },
                              { id: "wordCreation", label: "Creación de Word", icon: "📝" },
                              { id: "excelCreation", label: "Creación de Excel", icon: "📊" },
                              { id: "pptCreation", label: "Creación de PowerPoint", icon: "🖥️" },
                            ].map((cap) => (
                              <div key={cap.id} className="flex items-start space-x-3 p-3 bg-muted/20 border rounded-lg hover:bg-muted/40 transition-colors">
                                <Checkbox
                                  id={cap.id}
                                  checked={(formData.capabilities as any)[cap.id]}
                                  onCheckedChange={(checked) =>
                                    handleFormChange({
                                      capabilities: { ...formData.capabilities, [cap.id]: !!checked }
                                    })
                                  }
                                  className="mt-0.5"
                                />
                                <label htmlFor={cap.id} className="text-sm cursor-pointer select-none flex-1 leading-snug">
                                  <span className="mr-2">{cap.icon}</span>
                                  {cap.label}
                                </label>
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="actions" className="border rounded-lg bg-card px-4">
                        <AccordionTrigger className="hover:no-underline font-medium flex items-center gap-2">
                          5. Acciones y Conexiones API
                          <span className="ml-2 text-xs font-normal px-2 py-0.5 rounded-full bg-muted flex items-center justify-center">
                            {actions.length}
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-4 pt-2 pb-6">
                          <p className="text-xs text-muted-foreground pb-2 border-b">
                            Vincula APIs web a tu GPT mediante peticiones JSON externalizadas y validadas por esquema.
                          </p>

                          {actions.length > 0 && (
                            <div className="space-y-2 mb-4">
                              {actions.map((action) => (
                                <div key={action.id} className="flex items-center justify-between p-3 bg-muted/40 border rounded-lg hover:border-primary/50 transition-colors cursor-pointer" onClick={() => {
                                  setEditingAction(action);
                                  setActionForm({
                                    name: action.name,
                                    description: action.description || "",
                                    httpMethod: action.httpMethod || "GET",
                                    endpoint: action.endpoint ?? "",
                                    authType: action.authType ?? "none",
                                    authConfig: action.authConfig ? (action.authConfig as any).token : "",
                                    openApiSpec: action.openApiSpec ? JSON.stringify(action.openApiSpec, null, 2) : ""
                                  });
                                  setShowActionEditor(true);
                                }}>
                                  <div className="flex items-center gap-3">
                                    <span className={cn(
                                      "text-[10px] font-bold tracking-wider px-2 py-1 rounded w-16 text-center shadow-sm",
                                      action.httpMethod === "GET" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" :
                                        action.httpMethod === "POST" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" :
                                          action.httpMethod === "DELETE" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" :
                                            "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400"
                                    )}>
                                      {action.httpMethod}
                                    </span>
                                    <div className="flex flex-col">
                                      <span className="text-sm font-medium">{action.name}</span>
                                      <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={action.endpoint || ""}>{action.endpoint}</span>
                                    </div>
                                  </div>
                                  <ChevronLeft className="h-4 w-4 text-muted-foreground rotate-180" />
                                </div>
                              ))}
                            </div>
                          )}

                          <Button
                            variant="secondary"
                            onClick={handleCreateAction}
                            className="w-full"
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

            <div className="w-[400px] flex flex-col bg-muted/20">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <span className="text-sm font-medium">Vista previa</span>
                <Select
                  value={previewModelId || (availableModels[0]?.modelId || "")}
                  onValueChange={setPreviewModelId}
                >
                  <SelectTrigger className="w-[160px] h-8 text-xs">
                    <SelectValue placeholder="Seleccionar modelo" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.map((model) => (
                      <SelectItem key={model.id} value={model.modelId}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center p-6">
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4 overflow-hidden">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl">🤖</span>
                  )}
                </div>
                <p className="text-sm text-center text-muted-foreground max-w-xs">
                  {formData.description || "Vista previa de tu GPT"}
                </p>
              </div>

              <div className="p-4 border-t">
                <div className="flex items-center gap-2 p-3 bg-background rounded-full border">
                  <Plus className="h-5 w-5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Pregunta lo que quieras"
                    value={previewMessage}
                    onChange={(e) => setPreviewMessage(e.target.value)}
                    className="flex-1 bg-transparent outline-none text-sm"
                    data-testid="input-preview-message"
                    aria-label="Mensaje de vista previa"
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Mic className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    disabled={!previewMessage.trim()}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {showActionEditor && (
          <Dialog open={showActionEditor} onOpenChange={setShowActionEditor}>
            <DialogContent className="sm:max-w-[500px]" data-testid="action-editor-dialog">
              <DialogHeader>
                <DialogTitle>{editingAction ? "Editar acción" : "Nueva acción"}</DialogTitle>
                <VisuallyHidden>
                  <DialogDescription>Configura los detalles de la acción API</DialogDescription>
                </VisuallyHidden>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <Label htmlFor="action-name">Nombre</Label>
                  <Input
                    id="action-name"
                    placeholder="Ej: Consultar clima"
                    value={actionForm.name}
                    onChange={(e) => setActionForm(prev => ({ ...prev, name: e.target.value }))}
                    className="mt-1"
                    data-testid="input-action-name"
                  />
                </div>
                <div>
                  <Label htmlFor="action-description">Descripción</Label>
                  <Textarea
                    id="action-description"
                    placeholder="Describe lo que hace esta acción..."
                    value={actionForm.description}
                    onChange={(e) => setActionForm(prev => ({ ...prev, description: e.target.value }))}
                    className="mt-1"
                    data-testid="input-action-description"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Método HTTP</Label>
                    <div className="flex gap-1 mt-1">
                      {["GET", "POST", "PUT", "DELETE"].map((method) => (
                        <Button
                          key={method}
                          type="button"
                          variant={actionForm.httpMethod === method ? "default" : "outline"}
                          size="sm"
                          onClick={() => setActionForm(prev => ({ ...prev, httpMethod: method }))}
                        >
                          {method}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Autenticación (Opcional)</Label>
                    <div className="flex gap-1 mt-1 mb-3">
                      {[{ value: "none", label: "Ninguna" }, { value: "api_key", label: "API Key" }, { value: "bearer", label: "Bearer Token" }].map((auth) => (
                        <Button
                          key={auth.value}
                          type="button"
                          variant={actionForm.authType === auth.value ? "default" : "outline"}
                          size="sm"
                          onClick={() => setActionForm(prev => ({ ...prev, authType: auth.value }))}
                        >
                          {auth.label}
                        </Button>
                      ))}
                    </div>
                    {actionForm.authType !== "none" && (
                      <div className="space-y-1 animate-in fade-in slide-in-from-top-2">
                        <Label htmlFor="action-auth-config" className="text-xs text-muted-foreground flex items-center gap-1">
                          <Lock className="h-3 w-3" />
                          Vault: Token o API Key
                        </Label>
                        <Input
                          id="action-auth-config"
                          type="password"
                          placeholder={actionForm.authType === "bearer" ? "ey..." : "sk-..."}
                          value={actionForm.authConfig || ""}
                          onChange={(e) => setActionForm(prev => ({ ...prev, authConfig: e.target.value }))}
                          className="mt-1 font-mono text-xs"
                          data-testid="input-action-auth-config"
                        />
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <Label htmlFor="action-endpoint">Endpoint URL</Label>
                  <Input
                    id="action-endpoint"
                    placeholder="https://api.example.com/endpoint"
                    value={actionForm.endpoint}
                    onChange={(e) => setActionForm(prev => ({ ...prev, endpoint: e.target.value }))}
                    className="mt-1 font-mono text-sm"
                    data-testid="input-action-endpoint"
                  />
                </div>
                <div>
                  <Label htmlFor="action-openapi-spec" className="flex items-center justify-between">
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
                      className="h-6 text-xs px-2"
                    >
                      <Upload className="h-3 w-3 mr-1" /> Importar Archivo
                    </Button>
                  </Label>
                  <Textarea
                    id="action-openapi-spec"
                    placeholder="Pega aquí el JSON o YAML de tu esquema OpenAPI para autoconfigurar las acciones..."
                    value={actionForm.openApiSpec || ""}
                    onChange={(e) => setActionForm(prev => ({ ...prev, openApiSpec: e.target.value }))}
                    className="mt-1 font-mono text-xs h-32"
                  />
                  {actionForm.openApiSpec && (
                    <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                      <FileText className="h-3 w-3" /> Esquema cargado. El GPT respetará esta estructura de petición/respuesta.
                    </p>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => setShowActionEditor(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={saveAction} data-testid="button-save-action">
                    {editingAction ? "Actualizar" : "Crear"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {showUpdateModal && savedGptData && (
          <Dialog open={showUpdateModal} onOpenChange={setShowUpdateModal}>
            <DialogContent className="sm:max-w-[400px]" data-testid="gpt-updated-modal">
              <DialogHeader className="flex flex-row items-center justify-between">
                <DialogTitle>GPT actualizado</DialogTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowUpdateModal(false)}
                  className="h-6 w-6 rounded-full"
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
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center overflow-hidden">
                    {savedGptData.avatar ? (
                      <img src={savedGptData.avatar} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-2xl">🤖</span>
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold">{savedGptData.name}</h3>
                    <p className="text-sm text-muted-foreground">Por {(savedGptData as { creatorUsername?: string }).creatorUsername || "ti"}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-medium">Acceso</Label>

                  <div
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                      formData.visibility === "private" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                    )}
                    onClick={() => handleVisibilityChange("private")}
                    data-testid="visibility-private"
                  >
                    <div className={cn(
                      "w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5",
                      formData.visibility === "private" ? "border-primary" : "border-muted-foreground"
                    )}>
                      {formData.visibility === "private" && (
                        <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Lock className="h-4 w-4" />
                        <span className="font-medium text-sm">Privado</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Solo tú puedes acceder</p>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                      formData.visibility === "team" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                    )}
                    onClick={() => handleVisibilityChange("team")}
                    data-testid="visibility-team"
                  >
                    <div className={cn(
                      "w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5",
                      formData.visibility === "team" ? "border-primary" : "border-muted-foreground"
                    )}>
                      {formData.visibility === "team" && (
                        <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        <span className="font-medium text-sm">Equipo</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Miembros de tu equipo pueden acceder</p>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                      formData.visibility === "public" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                    )}
                    onClick={() => handleVisibilityChange("public")}
                    data-testid="visibility-public"
                  >
                    <div className={cn(
                      "w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5",
                      formData.visibility === "public" ? "border-primary" : "border-muted-foreground"
                    )}>
                      {formData.visibility === "public" && (
                        <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <LinkIcon className="h-4 w-4" />
                        <span className="font-medium text-sm">Cualquiera que tenga el enlace</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Público con enlace</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleCopyLink}
                  data-testid="button-copy-link"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copiar enlace
                </Button>
                <Button
                  className="flex-1"
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
    </Dialog >
  );
}
