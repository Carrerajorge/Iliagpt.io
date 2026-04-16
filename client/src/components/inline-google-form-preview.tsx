import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { 
  Loader2, ExternalLink, CheckCircle2, Copy, Check, 
  User, LogOut, ClipboardList, AlertCircle, FileText,
  ChevronDown, ChevronUp, RefreshCw
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

export interface FormQuestion {
  id: string;
  title: string;
  type: "text" | "paragraph" | "multiple_choice" | "checkbox" | "dropdown";
  options?: string[];
  required: boolean;
}

export interface InlineFormPreviewProps {
  prompt: string;
  fileContext?: Array<{ name: string; content: string; type: string }>;
  onComplete?: (message: string, formUrl?: string) => void;
  autoStart?: boolean;
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

export function InlineGoogleFormPreview({ 
  prompt: initialPrompt,
  fileContext,
  onComplete,
  autoStart = true
}: InlineFormPreviewProps) {
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
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

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
          if (data.connected && autoStart && initialPrompt.trim()) {
            setStatus("idle");
            setTimeout(() => createForm(), 500);
          } else {
            setStatus(data.connected ? "idle" : "not_connected");
          }
        }
      } else {
        setStatus("needs_login");
      }
    } catch (err) {
      console.error("Error checking connection:", err);
      setStatus("needs_login");
    }
  }, [autoStart, initialPrompt]);

  useEffect(() => {
    checkConnectionStatus();
  }, [checkConnectionStatus]);

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
    const promptToUse = prompt.trim() || initialPrompt.trim();
    if (!promptToUse) {
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

      let fullPrompt = promptToUse;
      if (fileContext && fileContext.length > 0) {
        fullPrompt += "\n\n--- Contexto de archivos adjuntos ---\n";
        fileContext.forEach(file => {
          fullPrompt += `\nArchivo: ${file.name}\nContenido:\n${file.content.slice(0, 2000)}${file.content.length > 2000 ? '...' : ''}\n`;
        });
      }

      const res = await fetch("/api/integrations/google/forms/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ 
          prompt: fullPrompt,
          title: formTitle.trim() || undefined
        })
      });

      clearInterval(progressInterval);

      if (!res.ok) {
        const errData = await res.json();
        const errorMessage = errData.details 
          ? `${errData.error}: ${errData.details}`
          : errData.error || "Error al crear el formulario";
        throw new Error(errorMessage);
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

  const GoogleFormsLogo = ({ className = "h-6 w-6" }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M7.5 3C6.12 3 5 4.12 5 5.5v13C5 19.88 6.12 21 7.5 21h9c1.38 0 2.5-1.12 2.5-2.5v-13C19 4.12 17.88 3 16.5 3h-9z" fill="#673AB7"/>
      <circle cx="9" cy="9" r="1.5" fill="white"/>
      <rect x="12" y="8" width="5" height="2" rx="1" fill="white"/>
      <circle cx="9" cy="13" r="1.5" fill="white"/>
      <rect x="12" y="12" width="5" height="2" rx="1" fill="white"/>
      <circle cx="9" cy="17" r="1.5" fill="white"/>
      <rect x="12" y="16" width="5" height="2" rx="1" fill="white"/>
    </svg>
  );

  const displayedQuestions = showAllQuestions ? questions : questions.slice(0, 5);
  const hasMoreQuestions = questions.length > 5;

  if (status === "loading") {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-white dark:from-purple-900/20 dark:to-gray-900 p-6"
      >
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 text-purple-600 animate-spin" />
          <span className="text-sm text-muted-foreground">Verificando conexión con Google Forms...</span>
        </div>
      </motion.div>
    );
  }

  if (status === "needs_login") {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-amber-200 dark:border-amber-800 bg-gradient-to-br from-amber-50 to-white dark:from-amber-900/20 dark:to-gray-900 p-6"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
            <User className="h-6 w-6 text-amber-600" />
          </div>
          <div className="flex-1">
            <h4 className="font-medium">Inicia sesión primero</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Para crear formularios en Google Forms, necesitas iniciar sesión
            </p>
          </div>
          <Button 
            onClick={() => window.location.href = "/login"}
            className="bg-amber-600 hover:bg-amber-700 text-white"
            size="sm"
          >
            Iniciar Sesión
          </Button>
        </div>
      </motion.div>
    );
  }

  if (status === "not_connected") {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-white dark:from-purple-900/20 dark:to-gray-900 p-6"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
            <GoogleFormsLogo className="h-7 w-7" />
          </div>
          <div className="flex-1">
            <h4 className="font-medium">Conecta tu cuenta de Google</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Conecta tu cuenta para crear formularios directamente en tu Google Drive
            </p>
          </div>
          <Button 
            onClick={handleConnect}
            className="bg-purple-600 hover:bg-purple-700 text-white"
            size="sm"
          >
            Conectar Google
          </Button>
        </div>
      </motion.div>
    );
  }

  if (status === "idle" || status === "error") {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-white dark:from-purple-900/20 dark:to-gray-900 p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-600 flex items-center justify-center">
              <GoogleFormsLogo className="h-6 w-6" />
            </div>
            <div>
              <h4 className="font-medium">Crear Formulario</h4>
              {connection.connected && (
                <p className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {connection.displayName || connection.email}
                </p>
              )}
            </div>
          </div>
          {connection.connected && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleDisconnect}
              className="text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-3">
            <Textarea
              placeholder="Describe tu formulario..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="resize-none"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                Cancelar
              </Button>
              <Button 
                size="sm"
                onClick={createForm}
                disabled={!prompt.trim()}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                <ClipboardList className="h-4 w-4 mr-2" />
                Crear
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-white/50 dark:bg-gray-800/50 border border-purple-100 dark:border-purple-900">
              <p className="text-sm">{prompt || initialPrompt}</p>
            </div>
            
            {fileContext && fileContext.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {fileContext.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-100 dark:bg-purple-900/30 text-xs">
                    <FileText className="h-3 w-3" />
                    <span>{file.name}</span>
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
                  <div className="flex-1">
                    <p className="text-red-700 dark:text-red-300 text-sm font-medium">No se pudo crear el formulario</p>
                    <p className="text-red-600 dark:text-red-400 text-xs mt-1">{error}</p>
                  </div>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => { setError(null); createForm(); }}
                  className="mt-2 w-full text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Reintentar
                </Button>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                Editar
              </Button>
              <Button 
                size="sm"
                onClick={createForm}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                <ClipboardList className="h-4 w-4 mr-2" />
                Crear Formulario
              </Button>
            </div>
          </div>
        )}
      </motion.div>
    );
  }

  if (status === "generating") {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-white dark:from-purple-900/20 dark:to-gray-900 p-6"
      >
        <div className="flex flex-col items-center py-6 space-y-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <Loader2 className="h-8 w-8 text-purple-600 animate-spin" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white dark:bg-gray-800 border-2 border-purple-600 flex items-center justify-center text-xs font-bold text-purple-600">
              {progress}%
            </div>
          </div>
          
          <div className="text-center">
            <h4 className="font-medium">Creando tu formulario...</h4>
            <p className="text-sm text-muted-foreground mt-1">
              {progress < 30 && "Analizando tu descripción..."}
              {progress >= 30 && progress < 50 && "Generando preguntas con IA..."}
              {progress >= 50 && progress < 70 && "Creando formulario en Google..."}
              {progress >= 70 && progress < 90 && "Agregando preguntas..."}
              {progress >= 90 && "Finalizando..."}
            </p>
          </div>

          <div className="w-full max-w-xs">
            <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-purple-600"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  if (status === "success") {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-white dark:from-purple-900/20 dark:to-gray-900 overflow-hidden"
      >
        <div className="p-3 bg-purple-100/50 dark:bg-purple-900/30 border-b border-purple-200 dark:border-purple-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GoogleFormsLogo className="h-5 w-5" />
            <span className="text-sm font-medium">Vista previa del formulario</span>
          </div>
          {formUrls.responderUrl && (
            <Button
              variant="ghost"
              size="sm"
              // FRONTEND FIX #32: Add noopener,noreferrer to prevent window.opener attacks
              onClick={() => window.open(formUrls.responderUrl, "_blank", "noopener,noreferrer")}
              className="h-7 px-2 text-xs"
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Abrir
            </Button>
          )}
        </div>

        {formUrls.responderUrl && (
          <div className="border-b border-purple-100 dark:border-purple-900">
            <iframe
              src={formUrls.responderUrl}
              className="w-full h-48 border-0"
              title="Vista previa del formulario"
            />
          </div>
        )}

        <div className="p-4 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <h4 className="font-medium">{formTitle}</h4>
              {formDescription && <p className="text-sm text-muted-foreground mt-0.5">{formDescription}</p>}
            </div>
          </div>

          {questions.length > 0 && (
            <div className="border rounded-lg p-3 bg-white/50 dark:bg-gray-800/50 space-y-2">
              <h5 className="text-sm font-medium text-muted-foreground">Preguntas incluidas:</h5>
              <div className="space-y-1.5">
                {displayedQuestions.map((q, idx) => (
                  <div key={q.id} className="flex items-start gap-2 text-sm">
                    <span className="text-muted-foreground min-w-[20px]">{idx + 1}.</span>
                    <span className="flex-1">{q.title}</span>
                    {q.required && <span className="text-red-500">*</span>}
                  </div>
                ))}
              </div>
              {hasMoreQuestions && (
                <button
                  onClick={() => setShowAllQuestions(!showAllQuestions)}
                  className="text-sm text-purple-600 hover:text-purple-700 flex items-center gap-1 mt-2"
                >
                  {showAllQuestions ? (
                    <>
                      <ChevronUp className="h-4 w-4" />
                      Mostrar menos
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4" />
                      +{questions.length - 5} preguntas más...
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {formUrls.editUrl && (
              <Button 
                // FRONTEND FIX #33: Add noopener,noreferrer to prevent window.opener attacks
                onClick={() => window.open(formUrls.editUrl, "_blank", "noopener,noreferrer")}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
                size="sm"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Editar en Google Forms
              </Button>
            )}
            <Button 
              variant="outline" 
              onClick={copyFormTemplate}
              size="sm"
              className="flex-1"
            >
              {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
              {copied ? "Copiado" : "Copiar plantilla"}
            </Button>
          </div>

          <div className="flex items-center justify-center pt-2 border-t border-purple-100 dark:border-purple-900">
            <a 
              href={formUrls.editUrl || "https://docs.google.com/forms"} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <GoogleFormsLogo className="h-4 w-4" />
              <span>Continuar editando en Google Forms</span>
            </a>
          </div>
        </div>
      </motion.div>
    );
  }

  return null;
}
