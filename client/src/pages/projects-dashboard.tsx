import { useLocation } from "wouter";
import { useChats } from "@/hooks/use-chats";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Plus,
  ArrowRight,
  ArrowLeft,
  Globe,
  Smartphone,
  Palette,
  LayoutGrid,
  BarChart3,
  MessageSquare,
  Clock,
  ChevronRight,
  Play,
  Presentation,
  Box,
  FileText,
  Table2,
} from "lucide-react";
import { useState } from "react";

export default function ProjectsDashboard() {
  const [, setLocation] = useLocation();
  const { chats } = useChats();
  const { user } = useAuth();
  const [newProjectDesc, setNewProjectDesc] = useState("");

  const userName = user?.firstName || user?.email?.split("@")[0] || "Usuario";
  const recentChats = chats.slice(0, 6);

  const quickStartOptions = [
    { icon: Play, label: "Animación", color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800" },
    { icon: Globe, label: "Sitio Web", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800" },
    { icon: Smartphone, label: "Móvil", color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800" },
    { icon: Palette, label: "Diseño", color: "text-pink-600 dark:text-pink-400", bg: "bg-pink-50 dark:bg-pink-950/40 border-pink-200 dark:border-pink-800" },
    { icon: Presentation, label: "Slides", color: "text-teal-600 dark:text-teal-400", bg: "bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800" },
    { icon: BarChart3, label: "Data Viz", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800" },
    { icon: Box, label: "3D Game", color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800" },
    { icon: LayoutGrid, label: "Dashboard", color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800" },
    { icon: FileText, label: "Documento", color: "text-slate-600 dark:text-slate-400", bg: "bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-slate-700" },
    { icon: Table2, label: "Hoja de Cálculo", color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800" },
  ];

  const examplePrompts = [
    "Crear una presentación de resultados trimestrales",
    "Prototipar flujo de checkout",
    "Dashboard de analíticas para startup",
  ];

  const handleStartNewChat = () => {
    setLocation("/chat/new");
  };

  const handleSelectChat = (chatId: string) => {
    setLocation(`/chat/${chatId}`);
  };

  const formatTimeAgo = (date: string | Date | undefined) => {
    if (!date) return "";
    const now = new Date();
    const d = new Date(date);
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Ahora";
    if (diffMins < 60) return `Hace ${diffMins} min`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `Hace ${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `Hace ${diffDays}d`;
    return d.toLocaleDateString("es");
  };

  return (
    <div className="min-h-screen bg-[#f5f5f0] dark:bg-[#0a0a0f]">
      <div className="max-w-5xl mx-auto px-6 pt-4">
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2 text-sm font-medium border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={() => setLocation("/chat/new")}
          data-testid="button-back-to-chat"
        >
          <ArrowLeft className="h-4 w-4" />
          Atrás
        </Button>
      </div>
      <main className="max-w-5xl mx-auto px-6">
        <div className="pt-8 pb-8 text-center">
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-2" data-testid="text-welcome">
            Hola {userName}, ¿qué quieres crear?
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Describe tu idea y el agente la hará realidad
          </p>
        </div>

        <div className="max-w-2xl mx-auto mb-10">
          <div className="relative flex items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden">
            <Plus className="h-4 w-4 text-slate-400 ml-4 shrink-0" />
            <Input
              placeholder="Describe tu idea, el Agente la hará realidad..."
              value={newProjectDesc}
              onChange={(e) => setNewProjectDesc(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleStartNewChat()}
              className="h-12 text-sm border-0 shadow-none focus-visible:ring-0 bg-transparent"
              data-testid="input-new-project"
            />
            <Button
              onClick={handleStartNewChat}
              size="sm"
              className="mr-2 h-8 px-4 bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 text-white text-xs font-medium rounded-lg shrink-0"
              data-testid="button-create-project"
            >
              Plan
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 mb-2 max-w-3xl mx-auto">
          {quickStartOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.label}
                onClick={handleStartNewChat}
                className={`flex flex-col items-center justify-center gap-2 w-[100px] py-4 rounded-xl border ${option.bg} transition-all hover:shadow-md hover:scale-[1.02] active:scale-[0.97] active:shadow-sm select-none`}
                style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                data-testid={`quick-start-${option.label.toLowerCase()}`}
              >
                <Icon className={`h-5 w-5 ${option.color} pointer-events-none`} />
                <span className={`text-[11px] font-medium ${option.color} pointer-events-none leading-tight text-center`}>{option.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-center gap-2 mb-12 mt-4">
          <span className="text-[11px] text-slate-400">Prueba un ejemplo</span>
          {examplePrompts.map((prompt) => (
            <button
              key={prompt}
              onClick={() => { setNewProjectDesc(prompt); }}
              className="text-[11px] px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              data-testid={`example-prompt-${prompt.substring(0, 10)}`}
            >
              {prompt}
            </button>
          ))}
        </div>

        {recentChats.length > 0 && (
          <div className="pb-12">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white" data-testid="text-recent-projects">
                Tus proyectos recientes
              </h2>
              <button
                className="text-xs text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1"
                onClick={handleStartNewChat}
                data-testid="button-view-all"
              >
                Ver todos
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {recentChats.map((chat) => (
                <div
                  key={chat.id}
                  onClick={() => handleSelectChat(chat.id)}
                  className="group cursor-pointer bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 hover:shadow-lg hover:border-violet-300 dark:hover:border-violet-700 transition-all"
                  data-testid={`project-card-${chat.id}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-100 to-blue-100 dark:from-violet-900/40 dark:to-blue-900/40 flex items-center justify-center shrink-0">
                      <MessageSquare className="h-4 w-4 text-violet-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-sm text-slate-900 dark:text-white truncate mb-1">
                        {chat.title}
                      </h3>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-500">
                        <Clock className="h-3 w-3" />
                        <span>{formatTimeAgo(chat.updatedAt || chat.createdAt)}</span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-600 group-hover:text-violet-500 transition-colors shrink-0 mt-1" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {recentChats.length === 0 && (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="h-7 w-7 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">
              No tienes proyectos aún
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              Crea tu primer proyecto describiendo tu idea arriba
            </p>
            <Button
              onClick={handleStartNewChat}
              className="bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 text-white"
              data-testid="button-create-first-project"
            >
              <Plus className="h-4 w-4 mr-2" />
              Crear proyecto
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
