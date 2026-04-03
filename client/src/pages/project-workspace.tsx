import { useLocation, useParams } from "wouter";
import { useState, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Play,
  Smartphone,
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
  Filter,
  FolderOpen,
  Zap,
  RefreshCw,
  ChevronDown,
  Mic,
  ArrowUp,
  Sparkles,
  X,
  Square,
  PanelLeft,
  CircleDot,
} from "lucide-react";

const PROJECT_TYPE_MAP: Record<string, { label: string; icon: any; color: string }> = {
  "animación": { label: "Animación", icon: Play, color: "text-red-500" },
  animation: { label: "Animation", icon: Play, color: "text-red-500" },
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
  documento: { label: "Documento", icon: FileText, color: "text-slate-400" },
  document: { label: "Document", icon: FileText, color: "text-slate-400" },
  "hoja de cálculo": { label: "Hoja de Cálculo", icon: Table2, color: "text-green-500" },
  spreadsheet: { label: "Spreadsheet", icon: Table2, color: "text-green-500" },
};

export default function ProjectWorkspace() {
  const [, setLocation] = useLocation();
  const params = useParams<{ type: string }>();
  const projectType = decodeURIComponent(params.type || "website").toLowerCase();
  const typeInfo = PROJECT_TYPE_MAP[projectType] || { label: projectType, icon: Globe, color: "text-blue-500" };

  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const projectName = typeInfo.label.toUpperCase();

  const handleAutoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 150) + "px";
  };

  const suggestions = [
    { emoji: "🎮", text: "Build a classic Snake game in this repo." },
    { emoji: "📄", text: "Create a one-page $pdf that summarizes this app." },
    { emoji: "📝", text: "Create a plan to..." },
  ];

  return (
    <div className="h-screen flex bg-[#1a1a2e] text-white overflow-hidden">

      <div className="w-[420px] shrink-0 flex flex-col border-r border-white/10 bg-[#12121e]">

        <div className="h-10 flex items-center justify-between px-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <button className="p-0.5 rounded hover:bg-white/10 text-white/50" data-testid="button-toggle-sidebar">
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setLocation("/")} className="p-0.5 rounded hover:bg-white/10 text-white/50" data-testid="button-back-workspace">
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <button className="p-0.5 rounded hover:bg-white/10 text-white/50">
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-0.5 px-3 pt-3">
          <button className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-white/10 text-sm text-white/80 transition-colors" data-testid="button-new-thread">
            <Plus className="h-3.5 w-3.5" />
            <span>Nuevo hilo</span>
          </button>
          <button className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-white/10 text-sm text-white/80 transition-colors" data-testid="button-skills-apps">
            <Zap className="h-3.5 w-3.5" />
            <span>Habilidades y aplicaciones</span>
          </button>
          <button className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-white/10 text-sm text-white/80 transition-colors" data-testid="button-automations">
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Automatizaciones</span>
          </button>
        </div>

        <div className="mt-5 px-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-white/40 uppercase tracking-wider">Hilos</span>
            <div className="flex items-center gap-1">
              <button className="p-0.5 rounded hover:bg-white/10 text-white/30">
                <Filter className="h-3 w-3" />
              </button>
              <button className="p-0.5 rounded hover:bg-white/10 text-white/30">
                <FolderOpen className="h-3 w-3" />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-white/5">
            <FolderOpen className="h-3.5 w-3.5 text-white/50" />
            <span className="text-sm text-white/70 font-medium truncate">{projectName}</span>
          </div>
          <p className="text-[11px] text-white/30 mt-2 px-2">No hay hilos</p>
        </div>

        <div className="flex-1 flex flex-col justify-end px-3 pb-3 overflow-hidden">

          <div className="flex flex-col items-center mb-6">
            <div className="mb-4">
              <Sparkles className="h-10 w-10 text-white/25" />
            </div>
            <h2 className="text-xl font-semibold text-white/90 mb-0.5">Vamos a crear</h2>
            <div className="flex items-center gap-1.5">
              <span className="text-xl font-semibold text-white/35">{projectName}</span>
              <ChevronDown className="h-3.5 w-3.5 text-white/25" />
            </div>
          </div>

          <div className="rounded-2xl border border-amber-500/60 bg-[#1e1e30] overflow-hidden shadow-[0_0_15px_rgba(245,158,11,0.08)]">
            <div className="px-4 pt-3 pb-2">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={handleAutoResize}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                  }
                }}
                placeholder="Ask Codex anything, @ to add files, / for commands, $ for skills"
                className="w-full bg-transparent border-0 outline-none text-[14px] text-white/70 placeholder-white/35 resize-none min-h-[24px] max-h-[120px]"
                rows={1}
                data-testid="input-workspace-prompt"
              />
            </div>
            <div className="flex items-center justify-between px-3 pb-2.5">
              <div className="flex items-center gap-2.5">
                <button className="text-white/40 hover:text-white/60 transition-colors" data-testid="button-plus-attach">
                  <Plus className="h-4 w-4" />
                </button>
                <button className="flex items-center gap-1.5 text-[12px] text-white/50 hover:text-white/70 transition-colors">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <span>GPT-5.4</span>
                  <ChevronDown className="h-2.5 w-2.5" />
                </button>
                <button className="flex items-center gap-1 text-[12px] text-white/50 hover:text-white/70 transition-colors">
                  <span>Extra alto</span>
                  <ChevronDown className="h-2.5 w-2.5" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button className="text-white/40 hover:text-white/60 transition-colors" data-testid="button-mic">
                  <Mic className="h-4 w-4" />
                </button>
                <button
                  className="w-7 h-7 rounded-lg bg-amber-500 hover:bg-amber-400 text-black flex items-center justify-center transition-colors active:scale-95"
                  style={{ touchAction: "manipulation" }}
                  data-testid="button-send"
                >
                  <ArrowUp className="h-4 w-4 stroke-[2.5]" />
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mt-2.5 px-1">
            <div className="flex items-center gap-3">
              <button className="flex items-center gap-1.5 text-[11px] text-white/40 hover:text-white/60 transition-colors">
                <Square className="h-3 w-3" />
                <span>Local</span>
                <ChevronDown className="h-2.5 w-2.5" />
              </button>
              <button className="flex items-center gap-1.5 text-[11px] text-amber-500 hover:text-amber-400 transition-colors">
                <CircleDot className="h-3 w-3" />
                <span>Acceso completo</span>
                <ChevronDown className="h-2.5 w-2.5" />
              </button>
            </div>
            <button className="flex items-center gap-1.5 text-[11px] text-white/40 hover:text-white/60 transition-colors">
              <span>⑂</span>
              <span>deploy-temp</span>
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>

      </div>

      <div className="flex-1 flex flex-col bg-[#1a1a2e] overflow-hidden">
        <div className="h-10 flex items-center justify-between px-4 border-b border-white/10 shrink-0">
          <span className="text-sm font-medium text-white/80">Nuevo hilo</span>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-white/10 rounded-md px-2 py-1">
              <div className="w-4 h-4 rounded bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-[9px] font-bold">A</div>
              <ChevronDown className="h-3 w-3 text-white/50" />
            </div>
            <button className="flex items-center gap-1.5 bg-white/10 rounded-md px-3 py-1 text-xs text-white/80 hover:bg-white/15 transition-colors" data-testid="button-confirm">
              <Settings className="h-3 w-3" />
              <span>Confirmar</span>
              <ChevronDown className="h-3 w-3 text-white/50" />
            </button>
          </div>
        </div>

        <div className="flex-1" />
      </div>
    </div>
  );
}
