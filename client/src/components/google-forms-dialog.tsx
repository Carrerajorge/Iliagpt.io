import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, ExternalLink, CheckCircle2, ClipboardList, Copy, Check, Link2, LogOut, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface GoogleFormsDialogProps {
  open: boolean;
  onClose: () => void;
  initialPrompt?: string;
  onComplete?: (message: string, formUrl?: string) => void;
}

interface FormQuestion {
  id: string;
  title: string;
  type: "text" | "paragraph" | "multiple_choice" | "checkbox" | "dropdown";
  options?: string[];
  required: boolean;
}

interface ConnectionStatus {
  connected: boolean;
  email?: string;
  displayName?: string;
  needsLogin?: boolean;
}

type Status = "loading" | "needs_login" | "not_connected" | "idle" | "generating" | "success" | "error";

const questionTypeLabels: Record<string, string> = {
  text: "Respuesta corta",
  paragraph: "Párrafo",
  multiple_choice: "Opción múltiple",
  checkbox: "Casillas de verificación",
  dropdown: "Lista desplegable"
};

export function GoogleFormsDialog({ 
  open, 
  onClose, 
  initialPrompt = "",
  onComplete 
}: GoogleFormsDialogProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<FormQuestion[]>([]);
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);
  const [connection, setConnection] = useState<ConnectionStatus>({ connected: false });
  const [formUrls, setFormUrls] = useState<{ responderUrl?: string; editUrl?: string }>({});

  const checkConnectionStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/google/forms/status", {
        credentials: "include"
      });
      if (res.ok) {
        const data = await res.json();
        if (data.message === "Usuario no autenticado") {
          setConnection({ connected: false, needsLogin: true });
          setStatus("needs_login");
        } else {
          setConnection({
            connected: data.connected,
            email: data.email,
            displayName: data.displayName
          });
          setStatus(data.connected ? "idle" : "not_connected");
        }
      } else {
        setStatus("needs_login");
      }
    } catch (err) {
      console.error("Error checking connection:", err);
      setStatus("needs_login");
    }
  }, []);

  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt);
      setFormTitle("");
      setFormDescription("");
      setError(null);
      setQuestions([]);
      setProgress(0);
      setCopied(false);
      setFormUrls({});
      checkConnectionStatus();
    }
  }, [open, initialPrompt, checkConnectionStatus]);

  const handleConnect = () => {
    window.location.href = "/api/integrations/google/forms/connect";
  };

  const handleDisconnect = async () => {
    try {
      const res = await fetch("/api/integrations/google/forms/disconnect", {
        method: "POST",
        credentials: "include"
      });
      if (res.ok) {
        setConnection({ connected: false });
        setStatus("not_connected");
      }
    } catch (err) {
      console.error("Error disconnecting:", err);
    }
  };

  const createForm = async () => {
    if (!prompt.trim()) {
      setError("Por favor describe el formulario que quieres crear");
      return;
    }

    setStatus("generating");
    setError(null);
    setProgress(10);

    try {
      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + 5, 90));
      }, 800);

      const res = await fetch("/api/integrations/google/forms/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ 
          prompt: prompt.trim(),
          title: formTitle.trim() || undefined
        })
      });

      clearInterval(progressInterval);

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || errData.details || "Error al crear el formulario");
      }

      const data = await res.json();
      
      setProgress(100);
      setFormTitle(data.title || "Formulario");
      setFormDescription(data.description || "");
      setQuestions(data.questions || []);
      setFormUrls({
        responderUrl: data.responderUrl,
        editUrl: data.editUrl
      });
      setStatus("success");
      
      if (onComplete) {
        onComplete(
          `Se creó el formulario "${data.title}" en tu cuenta de Google con ${data.questions?.length || 0} preguntas.`,
          data.responderUrl
        );
      }
    } catch (err: any) {
      setError(err.message || "Error al crear el formulario");
      setStatus("error");
      setProgress(0);
    }
  };

  const copyFormTemplate = () => {
    const template = `FORMULARIO: ${formTitle}\n${formDescription ? `Descripción: ${formDescription}\n` : ""}\n` +
      questions.map((q, idx) => {
        let text = `${idx + 1}. ${q.title}${q.required ? " *" : ""}\n   Tipo: ${questionTypeLabels[q.type] || q.type}`;
        if (q.options && q.options.length > 0) {
          text += `\n   Opciones:\n${q.options.map(o => `   - ${o}`).join("\n")}`;
        }
        return text;
      }).join("\n\n");
    
    navigator.clipboard.writeText(template);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const GoogleFormsLogo = () => (
    <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none">
      <path d="M7.5 3C6.12 3 5 4.12 5 5.5v13C5 19.88 6.12 21 7.5 21h9c1.38 0 2.5-1.12 2.5-2.5v-13C19 4.12 17.88 3 16.5 3h-9z" fill="#673AB7"/>
      <circle cx="9" cy="9" r="1.5" fill="white"/>
      <rect x="12" y="8" width="5" height="2" rx="1" fill="white"/>
      <circle cx="9" cy="13" r="1.5" fill="white"/>
      <rect x="12" y="12" width="5" height="2" rx="1" fill="white"/>
      <circle cx="9" cy="17" r="1.5" fill="white"/>
      <rect x="12" y="16" width="5" height="2" rx="1" fill="white"/>
    </svg>
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="google-forms-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-purple-600">
              <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="none">
                <path d="M7.5 3C6.12 3 5 4.12 5 5.5v13C5 19.88 6.12 21 7.5 21h9c1.38 0 2.5-1.12 2.5-2.5v-13C19 4.12 17.88 3 16.5 3h-9z" fill="currentColor"/>
                <circle cx="9" cy="9" r="1.5" fill="#673AB7"/>
                <rect x="12" y="8" width="5" height="2" rx="1" fill="#673AB7"/>
                <circle cx="9" cy="13" r="1.5" fill="#673AB7"/>
                <rect x="12" y="12" width="5" height="2" rx="1" fill="#673AB7"/>
                <circle cx="9" cy="17" r="1.5" fill="#673AB7"/>
                <rect x="12" y="16" width="5" height="2" rx="1" fill="#673AB7"/>
              </svg>
            </div>
            <span>Google Forms</span>
          </DialogTitle>
          <DialogDescription>
            {connection.connected 
              ? "Crea formularios directamente en tu cuenta de Google"
              : "Conecta tu cuenta de Google para crear formularios"}
          </DialogDescription>
        </DialogHeader>

        {status === "loading" ? (
          <div className="py-12 flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 text-purple-600 animate-spin" />
            <p className="mt-4 text-muted-foreground">Verificando conexión...</p>
          </div>
        ) : status === "needs_login" ? (
          <div className="py-8 flex flex-col items-center justify-center space-y-6">
            <div className="w-20 h-20 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <User className="h-10 w-10 text-amber-600" />
            </div>
            
            <div className="text-center space-y-2">
              <h3 className="font-semibold text-lg">Inicia sesión primero</h3>
              <p className="text-muted-foreground text-sm max-w-sm">
                Para conectar Google Forms, primero necesitas iniciar sesión en IliaGPT
              </p>
            </div>

            <Button 
              onClick={() => window.location.href = "/login"}
              className="bg-purple-600 hover:bg-purple-700 text-white px-8"
              data-testid="button-go-to-login"
            >
              Iniciar Sesión
            </Button>

            <Button variant="ghost" onClick={onClose} data-testid="button-cancel-login">
              Cancelar
            </Button>
          </div>
        ) : status === "not_connected" ? (
          <div className="py-8 flex flex-col items-center justify-center space-y-6">
            <div className="w-20 h-20 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <GoogleFormsLogo />
            </div>
            
            <div className="text-center space-y-2">
              <h3 className="font-semibold text-lg">Conecta tu cuenta de Google</h3>
              <p className="text-muted-foreground text-sm max-w-sm">
                Para crear formularios en tu Google Drive, necesitas iniciar sesión con tu cuenta de Google
              </p>
            </div>

            <Button 
              onClick={handleConnect}
              className="bg-purple-600 hover:bg-purple-700 text-white px-8"
              data-testid="button-connect-google"
            >
              <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Conectar con Google
            </Button>

            <Button variant="ghost" onClick={onClose} data-testid="button-cancel-connect">
              Cancelar
            </Button>
          </div>
        ) : status === "idle" || status === "error" ? (
          <div className="space-y-4 py-4">
            {connection.connected && (
              <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="text-sm font-medium text-green-700 dark:text-green-300">
                      Conectado como {connection.displayName || connection.email}
                    </p>
                    {connection.email && connection.displayName && (
                      <p className="text-xs text-green-600 dark:text-green-400">{connection.email}</p>
                    )}
                  </div>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={handleDisconnect}
                  className="text-green-700 hover:text-green-800 hover:bg-green-100 dark:text-green-300 dark:hover:bg-green-900/40"
                  data-testid="button-disconnect-google"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Título del formulario (opcional)</label>
              <Input
                placeholder="Ej: Encuesta de satisfacción del cliente"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                data-testid="input-form-title"
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Describe tu formulario</label>
              <Textarea
                placeholder="Ej: Crea un formulario para recopilar feedback de clientes con preguntas sobre satisfacción general, calidad del producto, atención al cliente, y sugerencias de mejora..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                className="resize-none"
                data-testid="textarea-form-description"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} data-testid="button-cancel-form">
                Cancelar
              </Button>
              <Button 
                onClick={createForm}
                className="bg-purple-600 hover:bg-purple-700 text-white"
                disabled={!prompt.trim()}
                data-testid="button-create-form"
              >
                <ClipboardList className="h-4 w-4 mr-2" />
                Crear Formulario
              </Button>
            </div>
          </div>
        ) : status === "generating" ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-6">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <Loader2 className="h-10 w-10 text-purple-600 animate-spin" />
              </div>
              <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-white dark:bg-gray-800 border-2 border-purple-600 flex items-center justify-center text-xs font-bold text-purple-600">
                {progress}%
              </div>
            </div>
            
            <div className="text-center space-y-2">
              <h3 className="font-semibold text-lg">Creando tu formulario...</h3>
              <p className="text-muted-foreground text-sm max-w-sm">
                Estamos generando y creando el formulario en tu cuenta de Google
              </p>
            </div>

            <div className="w-full max-w-xs">
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-purple-600 transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
              {progress < 30 && <span>Analizando tu descripción...</span>}
              {progress >= 30 && progress < 50 && <span>Generando preguntas con IA...</span>}
              {progress >= 50 && progress < 70 && <span>Creando formulario en Google...</span>}
              {progress >= 70 && progress < 90 && <span>Agregando preguntas...</span>}
              {progress >= 90 && <span>Finalizando...</span>}
            </div>
          </div>
        ) : status === "success" ? (
          <div className="py-6 space-y-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">¡Formulario creado!</h3>
                <p className="text-muted-foreground text-sm mt-1">{formTitle}</p>
                {formDescription && <p className="text-muted-foreground text-xs mt-1">{formDescription}</p>}
              </div>
            </div>

            {formUrls.responderUrl && (
              <div className="border rounded-lg overflow-hidden bg-white dark:bg-gray-900">
                <div className="p-2 bg-gray-50 dark:bg-gray-800 border-b flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Vista previa del formulario</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    // FRONTEND FIX #30: Add noopener,noreferrer
                    onClick={() => window.open(formUrls.responderUrl, "_blank", "noopener,noreferrer")}
                    className="h-6 px-2 text-xs"
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Abrir
                  </Button>
                </div>
                <iframe
                  src={formUrls.responderUrl}
                  className="w-full h-64 border-0"
                  title="Vista previa del formulario"
                  data-testid="iframe-form-preview"
                />
              </div>
            )}

            {questions.length > 0 && (
              <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                <h4 className="font-medium text-sm">Preguntas incluidas:</h4>
                <div className="space-y-2">
                  {questions.slice(0, 5).map((q, idx) => (
                    <div key={q.id} className="flex items-start gap-2 text-sm">
                      <span className="text-muted-foreground">{idx + 1}.</span>
                      <span>{q.title}</span>
                      {q.required && <span className="text-red-500">*</span>}
                    </div>
                  ))}
                  {questions.length > 5 && (
                    <p className="text-sm text-muted-foreground">
                      +{questions.length - 5} preguntas más...
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              {formUrls.editUrl && (
                <Button
                  // FRONTEND FIX #31: Add noopener,noreferrer
                  onClick={() => window.open(formUrls.editUrl, "_blank", "noopener,noreferrer")}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
                  data-testid="button-edit-in-google"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Editar en Google Forms
                </Button>
              )}
              <Button 
                variant="outline" 
                onClick={copyFormTemplate}
                className="flex-1"
                data-testid="button-copy-template"
              >
                {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {copied ? "Copiado" : "Copiar plantilla"}
              </Button>
            </div>

            <div className="flex items-center justify-center gap-4 pt-4 border-t">
              <a 
                href={formUrls.editUrl || "https://docs.google.com/forms"} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                data-testid="link-google-forms-logo"
              >
                <GoogleFormsLogo />
                <span>Continuar editando en Google Forms</span>
              </a>
            </div>

            <div className="text-center">
              <Button variant="ghost" onClick={onClose} data-testid="button-close-success">
                Cerrar
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
