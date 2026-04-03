import { useLocation, useParams } from "wouter";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Play,
  Share2,
  Download,
  Settings,
  Maximize2,
  Monitor,
  Smartphone,
  Tablet,
  Code,
  Eye,
  Split,
  RotateCcw,
  ChevronDown,
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
} from "lucide-react";

const PROJECT_TYPE_MAP: Record<string, { label: string; icon: any; color: string }> = {
  animation: { label: "Animación", icon: Play, color: "text-red-500" },
  "sitio web": { label: "Sitio Web", icon: Globe, color: "text-blue-500" },
  website: { label: "Website", icon: Globe, color: "text-blue-500" },
  "móvil": { label: "Móvil", icon: Smartphone, color: "text-purple-500" },
  mobile: { label: "Mobile", icon: Smartphone, color: "text-purple-500" },
  "diseño": { label: "Diseño", icon: Palette, color: "text-pink-500" },
  design: { label: "Design", icon: Palette, color: "text-pink-500" },
  slides: { label: "Slides", icon: Presentation, color: "text-teal-500" },
  "data viz": { label: "Data Viz", icon: BarChart3, color: "text-emerald-500" },
  "data visualization": { label: "Data Visualization", icon: BarChart3, color: "text-emerald-500" },
  "3d game": { label: "3D Game", icon: Box, color: "text-indigo-500" },
  dashboard: { label: "Dashboard", icon: LayoutGrid, color: "text-orange-500" },
  documento: { label: "Documento", icon: FileText, color: "text-slate-500" },
  document: { label: "Document", icon: FileText, color: "text-slate-500" },
  "hoja de cálculo": { label: "Hoja de Cálculo", icon: Table2, color: "text-green-500" },
  spreadsheet: { label: "Spreadsheet", icon: Table2, color: "text-green-500" },
};

type ViewMode = "preview" | "code" | "split";
type DeviceMode = "desktop" | "tablet" | "mobile";

export default function ProjectWorkspace() {
  const [, setLocation] = useLocation();
  const params = useParams<{ type: string }>();
  const projectType = decodeURIComponent(params.type || "website").toLowerCase();
  const typeInfo = PROJECT_TYPE_MAP[projectType] || { label: projectType, icon: Globe, color: "text-blue-500" };
  const TypeIcon = typeInfo.icon;

  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("desktop");
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const deviceWidths: Record<DeviceMode, string> = {
    desktop: "w-full",
    tablet: "max-w-[768px]",
    mobile: "max-w-[375px]",
  };

  const handleSendPrompt = () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      setHasContent(true);
    }, 2000);
  };

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-[#0a0a0f] overflow-hidden">
      <header className="h-12 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-3 shrink-0 bg-white dark:bg-slate-950">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setLocation("/")}
            data-testid="button-back-workspace"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />
          <div className="flex items-center gap-1.5">
            <TypeIcon className={`h-4 w-4 ${typeInfo.color}`} />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300" data-testid="text-project-type">
              {typeInfo.label}
            </span>
          </div>
          <span className="text-xs text-slate-400 dark:text-slate-500">Nuevo proyecto</span>
        </div>

        <div className="flex items-center gap-1">
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-md p-0.5 mr-2">
            <button
              onClick={() => setViewMode("preview")}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-all ${viewMode === "preview" ? "bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
              data-testid="button-view-preview"
            >
              <Eye className="h-3 w-3" />
              Preview
            </button>
            <button
              onClick={() => setViewMode("code")}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-all ${viewMode === "code" ? "bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
              data-testid="button-view-code"
            >
              <Code className="h-3 w-3" />
              Code
            </button>
            <button
              onClick={() => setViewMode("split")}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-all ${viewMode === "split" ? "bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
              data-testid="button-view-split"
            >
              <Split className="h-3 w-3" />
              Split
            </button>
          </div>

          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-md p-0.5 mr-2">
            <button
              onClick={() => setDeviceMode("desktop")}
              className={`p-1 rounded transition-all ${deviceMode === "desktop" ? "bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white" : "text-slate-400 hover:text-slate-600"}`}
              data-testid="button-device-desktop"
            >
              <Monitor className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setDeviceMode("tablet")}
              className={`p-1 rounded transition-all ${deviceMode === "tablet" ? "bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white" : "text-slate-400 hover:text-slate-600"}`}
              data-testid="button-device-tablet"
            >
              <Tablet className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setDeviceMode("mobile")}
              className={`p-1 rounded transition-all ${deviceMode === "mobile" ? "bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white" : "text-slate-400 hover:text-slate-600"}`}
              data-testid="button-device-mobile"
            >
              <Smartphone className="h-3.5 w-3.5" />
            </button>
          </div>

          <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-refresh">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-fullscreen">
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>

          <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-1" />

          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" data-testid="button-share">
            <Share2 className="h-3.5 w-3.5" />
            Compartir
          </Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" data-testid="button-export">
            <Download className="h-3.5 w-3.5" />
            Exportar
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 text-white"
            data-testid="button-publish"
          >
            <Globe className="h-3.5 w-3.5" />
            Publicar
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col">
          {viewMode === "code" || viewMode === "split" ? (
            <div className={`${viewMode === "split" ? "w-1/2" : "w-full"} h-full bg-[#1e1e1e] flex items-center justify-center`}>
              <div className="text-center">
                <Code className="h-12 w-12 text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-slate-500">El código se generará aquí</p>
              </div>
            </div>
          ) : null}

          {viewMode === "preview" || viewMode === "split" ? (
            <div className={`${viewMode === "split" ? "w-1/2 border-l border-slate-200 dark:border-slate-800" : "w-full"} h-full flex flex-col`}>
              <div className="flex-1 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-center p-4">
                <div className={`${deviceWidths[deviceMode]} w-full h-full bg-white dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex items-center justify-center transition-all duration-300`}>
                  {hasContent ? (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="text-center">
                        <Sparkles className="h-10 w-10 text-violet-400 mx-auto mb-3 animate-pulse" />
                        <p className="text-sm text-slate-600 dark:text-slate-400">Contenido generado</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">La preview aparecerá aquí</p>
                      </div>
                    </div>
                  ) : isGenerating ? (
                    <div className="text-center">
                      <Loader2 className="h-10 w-10 text-violet-500 mx-auto mb-3 animate-spin" />
                      <p className="text-sm text-slate-600 dark:text-slate-400">Generando tu {typeInfo.label.toLowerCase()}...</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Esto puede tomar unos segundos</p>
                    </div>
                  ) : (
                    <div className="text-center max-w-sm px-6">
                      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-100 to-blue-100 dark:from-violet-900/30 dark:to-blue-900/30 flex items-center justify-center mx-auto mb-4">
                        <TypeIcon className={`h-8 w-8 ${typeInfo.color}`} />
                      </div>
                      <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-2">
                        {typeInfo.label}
                      </h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">
                        Describe lo que quieres crear y el agente lo construirá
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        Usa el chat de abajo para empezar
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 shrink-0">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2">
            <button className="shrink-0 p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-slate-400" data-testid="button-attach">
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendPrompt();
                }
              }}
              placeholder={`Describe tu ${typeInfo.label.toLowerCase()}... ej: "Crea un landing page moderno con sección hero y pricing"`}
              className="flex-1 bg-transparent border-0 outline-none text-sm text-slate-700 dark:text-slate-300 placeholder-slate-400 resize-none min-h-[24px] max-h-[120px] py-1.5"
              rows={1}
              data-testid="input-workspace-prompt"
            />
            <div className="flex items-center gap-1 shrink-0">
              <button className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-slate-400" data-testid="button-settings-prompt">
                <Settings className="h-4 w-4" />
              </button>
              <button
                onClick={handleSendPrompt}
                disabled={!prompt.trim() || isGenerating}
                className="p-2 rounded-lg bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-all active:scale-95"
                style={{ touchAction: 'manipulation' }}
                data-testid="button-send-prompt"
              >
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 mt-2">
            <span className="text-[10px] text-slate-400">Sugerencias:</span>
            {[
              "Landing page con hero",
              "Dashboard con gráficos",
              "Formulario de contacto",
            ].map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => setPrompt(suggestion)}
                className="text-[10px] px-2 py-1 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                data-testid={`suggestion-${suggestion.substring(0, 10)}`}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
