import { useLocation, useParams } from "wouter";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Play,
  Share2,
  Maximize2,
  Monitor,
  Smartphone,
  Tablet,
  Code,
  Eye,
  RotateCcw,
  Loader2,
  Sparkles,
  Send,
  Paperclip,
  Globe,
  Palette,
  LayoutGrid,
  BarChart3,
  Presentation,
  Box,
  FileText,
  Table2,
  Plus,
  Settings,
  Pencil,
  ChevronDown,
  Blocks,
  Search,
  MoreHorizontal,
  Layers,
  Square,
} from "lucide-react";

const PROJECT_TYPE_MAP: Record<string, { label: string; icon: any; color: string; badge: string }> = {
  "animación": { label: "Animación", icon: Play, color: "text-red-500", badge: "Animation" },
  animation: { label: "Animación", icon: Play, color: "text-red-500", badge: "Animation" },
  "sitio web": { label: "Sitio Web", icon: Globe, color: "text-blue-500", badge: "Website" },
  website: { label: "Website", icon: Globe, color: "text-blue-500", badge: "Website" },
  "móvil": { label: "Móvil", icon: Smartphone, color: "text-purple-500", badge: "Mobile" },
  mobile: { label: "Mobile", icon: Smartphone, color: "text-purple-500", badge: "Mobile" },
  "diseño": { label: "Diseño", icon: Palette, color: "text-pink-500", badge: "Design" },
  design: { label: "Design", icon: Palette, color: "text-pink-500", badge: "Design" },
  slides: { label: "Slides", icon: Presentation, color: "text-teal-500", badge: "Slides" },
  "data viz": { label: "Data Viz", icon: BarChart3, color: "text-emerald-500", badge: "Data Viz" },
  "data visualization": { label: "Data Visualization", icon: BarChart3, color: "text-emerald-500", badge: "Data Viz" },
  "3d game": { label: "3D Game", icon: Box, color: "text-indigo-500", badge: "3D Game" },
  dashboard: { label: "Dashboard", icon: LayoutGrid, color: "text-orange-500", badge: "Dashboard" },
  documento: { label: "Documento", icon: FileText, color: "text-slate-500", badge: "Document" },
  document: { label: "Document", icon: FileText, color: "text-slate-500", badge: "Document" },
  "hoja de cálculo": { label: "Hoja de Cálculo", icon: Table2, color: "text-green-500", badge: "Spreadsheet" },
  spreadsheet: { label: "Spreadsheet", icon: Table2, color: "text-green-500", badge: "Spreadsheet" },
};

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export default function ProjectWorkspace() {
  const [, setLocation] = useLocation();
  const params = useParams<{ type: string }>();
  const projectType = decodeURIComponent(params.type || "website").toLowerCase();
  const typeInfo = PROJECT_TYPE_MAP[projectType] || { label: projectType, icon: Globe, color: "text-blue-500", badge: "Project" };
  const TypeIcon = typeInfo.icon;

  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasContent, setHasContent] = useState(false);
  const [activeTab, setActiveTab] = useState<"preview" | "tools">("preview");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSendPrompt = () => {
    if (!prompt.trim() || isGenerating) return;
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: prompt,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setPrompt("");
    setIsGenerating(true);

    setTimeout(() => {
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Voy a construir tu ${typeInfo.label.toLowerCase()}. Esto es lo que estoy creando:\n\n• Estructura principal del proyecto\n• Componentes de interfaz\n• Estilos y diseño responsive\n• Lógica de interacción\n\nDéjame configurar la app y preparar el entorno primero.`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setIsGenerating(false);
      setHasContent(true);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }, 2000);
  };

  const handleAutoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 150) + "px";
  };

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-[#0f0f15] overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        <div className="w-[320px] shrink-0 flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f0f15]">
          <div className="h-11 border-b border-slate-200 dark:border-slate-800 flex items-center px-3 shrink-0">
            <button
              onClick={() => setLocation("/")}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition-colors"
              data-testid="button-back-workspace"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="truncate max-w-[180px]">{typeInfo.label} project</span>
            </button>
            <div className="ml-auto flex items-center gap-1">
              <button className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400" data-testid="button-chat-history">
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400" data-testid="button-chat-settings">
                <Settings className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 && !isGenerating ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-100 to-blue-100 dark:from-violet-900/30 dark:to-blue-900/30 flex items-center justify-center mb-4">
                  <TypeIcon className={`h-7 w-7 ${typeInfo.color}`} />
                </div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nuevo proyecto: {typeInfo.label}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Describe lo que quieres crear
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                    {msg.role === "user" && (
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-medium">
                          {typeInfo.badge}
                        </span>
                      </div>
                    )}
                    <div
                      className={`max-w-[90%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                        msg.role === "user"
                          ? "bg-blue-50 dark:bg-blue-950/40 text-slate-800 dark:text-slate-200 border border-blue-100 dark:border-blue-900/40"
                          : "text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {msg.content.split("\n").map((line, i) => (
                        <p key={i} className={line === "" ? "h-2" : ""}>
                          {line}
                        </p>
                      ))}
                    </div>
                    <span className="text-[10px] text-slate-400 mt-1 px-1">
                      {msg.role === "user" ? "Ahora" : "Ahora"}
                    </span>
                  </div>
                ))}
                {isGenerating && (
                  <div className="flex items-start gap-2">
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <Blocks className="h-4 w-4 text-violet-500" />
                        <span className="text-xs font-medium">Trabajando...</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 p-3 shrink-0 bg-white dark:bg-[#0f0f15]">
            <div className="flex items-end gap-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2">
              <button className="shrink-0 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 self-end" data-testid="button-attach">
                <Plus className="h-4 w-4" />
              </button>
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={handleAutoResize}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendPrompt();
                  }
                }}
                placeholder="Make, test, iterate..."
                className="flex-1 bg-transparent border-0 outline-none text-sm text-slate-700 dark:text-slate-300 placeholder-slate-400 resize-none min-h-[24px] max-h-[150px] py-1"
                rows={1}
                data-testid="input-workspace-prompt"
              />
              <div className="flex items-center gap-1 shrink-0 self-end">
                <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Plan</span>
                <button className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400">
                  <Settings className="h-3.5 w-3.5" />
                </button>
                <button className="p-1 rounded bg-slate-800 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-200">
                  <Square className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col bg-slate-50 dark:bg-[#111118] overflow-hidden">
          <div className="h-11 border-b border-slate-200 dark:border-slate-800 flex items-center px-2 shrink-0 bg-white dark:bg-[#0f0f15]">
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setActiveTab("preview")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  activeTab === "preview"
                    ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white"
                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
                data-testid="tab-preview"
              >
                <Eye className="h-3.5 w-3.5" />
                Preview
              </button>
              <button className="px-2 py-1.5 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                +
              </button>
              <button
                onClick={() => setActiveTab("tools")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  activeTab === "tools"
                    ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white"
                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
                data-testid="tab-tools"
              >
                Tools & files
              </button>
            </div>

            <div className="ml-auto flex items-center gap-1">
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-md px-2 py-1 gap-1.5 mr-2">
                <Layers className="h-3 w-3 text-slate-400" />
                <span className="text-[11px] text-slate-500 dark:text-slate-400">Canvas</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">•</span>
                <TypeIcon className={`h-3 w-3 ${typeInfo.color}`} />
                <span className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">{typeInfo.label}</span>
                <ChevronDown className="h-3 w-3 text-slate-400" />
              </div>

              <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-md overflow-hidden mr-1">
                <button className="px-1.5 py-1 text-slate-500 hover:text-slate-700">
                  <ArrowLeft className="h-3 w-3" />
                </button>
                <button className="px-1.5 py-1 text-slate-500 hover:text-slate-700">
                  <ArrowLeft className="h-3 w-3 rotate-180" />
                </button>
              </div>

              <div className="flex items-center text-[11px] text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-md px-2 py-1 gap-1">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-full border border-slate-300 dark:border-slate-600" />
                  .replit.dev /
                </span>
              </div>

              <button className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 ml-1" data-testid="button-edit-url">
                <Pencil className="h-3 w-3" />
              </button>
              <button className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400" data-testid="button-responsive">
                <Monitor className="h-3 w-3" />
              </button>
              <button className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400" data-testid="button-refresh-preview">
                <RotateCcw className="h-3 w-3" />
              </button>

              <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1" />

              <button className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400" data-testid="button-search">
                <Search className="h-3.5 w-3.5" />
              </button>
              <Button variant="ghost" size="sm" className="h-7 text-[11px] text-slate-500 gap-1" data-testid="button-invite">
                Invite
              </Button>
              <Button
                size="sm"
                className="h-7 text-[11px] gap-1 bg-green-600 hover:bg-green-700 text-white"
                data-testid="button-publish"
              >
                <Globe className="h-3 w-3" />
                Publish
              </Button>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center p-6 overflow-hidden">
            {hasContent ? (
              <div className="w-full h-full bg-white dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="w-full h-full">
                  <div className="w-full h-10 bg-slate-100 dark:bg-slate-900 rounded-t-lg animate-pulse" />
                  <div className="p-6 space-y-4">
                    <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded w-3/4 animate-pulse" />
                    <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/2 animate-pulse" />
                    <div className="h-48 bg-slate-100 dark:bg-slate-900 rounded-lg mt-6 animate-pulse" />
                    <div className="flex gap-3 mt-6">
                      <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded w-24 animate-pulse" />
                      <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded w-32 animate-pulse" />
                    </div>
                    <div className="h-4 bg-slate-100 dark:bg-slate-900 rounded w-full mt-4 animate-pulse" />
                    <div className="flex gap-4 mt-6">
                      <div className="h-32 bg-slate-100 dark:bg-slate-900 rounded-lg flex-1 animate-pulse" />
                      <div className="h-32 bg-slate-100 dark:bg-slate-900 rounded-lg flex-1 animate-pulse" />
                    </div>
                  </div>
                </div>

                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-6 py-5 shadow-lg text-center pointer-events-auto">
                    <Blocks className="h-8 w-8 text-violet-500 mx-auto mb-2" />
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Invite collaborators in real-time</p>
                  </div>
                </div>
              </div>
            ) : isGenerating ? (
              <div className="w-full h-full bg-white dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-center">
                <div className="text-center">
                  <Loader2 className="h-10 w-10 text-violet-500 mx-auto mb-3 animate-spin" />
                  <p className="text-sm text-slate-600 dark:text-slate-400">Generando tu {typeInfo.label.toLowerCase()}...</p>
                </div>
              </div>
            ) : (
              <div className="w-full h-full bg-white dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-center">
                <div className="text-center max-w-sm px-6">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-100 to-blue-100 dark:from-violet-900/30 dark:to-blue-900/30 flex items-center justify-center mx-auto mb-4">
                    <TypeIcon className={`h-8 w-8 ${typeInfo.color}`} />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-2">
                    {typeInfo.label}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Describe lo que quieres crear en el chat y el agente lo construirá
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
