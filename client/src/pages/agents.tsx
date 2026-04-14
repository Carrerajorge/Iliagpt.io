import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Plus, Bot, Search, Star, Users, ChevronLeft, Trash2, Copy, Edit, MessageSquare } from "lucide-react";

interface CustomAgent {
  id: number;
  user_id: string;
  name: string;
  description: string;
  avatar_emoji: string;
  system_prompt: string;
  model: string;
  temperature: number;
  tools: string[];
  conversation_starters: string[];
  is_public: boolean;
  usage_count: number;
  category: string;
}

const CATEGORIES = [
  { value: "all", label: "Todos" },
  { value: "academic", label: "Academico" },
  { value: "legal", label: "Legal" },
  { value: "finance", label: "Finanzas" },
  { value: "engineering", label: "Ingenieria" },
  { value: "code", label: "Codigo" },
  { value: "writing", label: "Escritura" },
  { value: "translation", label: "Traduccion" },
  { value: "health", label: "Salud" },
  { value: "marketing", label: "Marketing" },
  { value: "general", label: "General" },
];

async function apiFetch(url: string, opts?: RequestInit) {
  const anonId = localStorage.getItem("anon_user_id") || "anon_" + Math.random().toString(36).slice(2);
  localStorage.setItem("anon_user_id", anonId);
  return fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-Anonymous-User-Id": anonId,
      ...(opts?.headers || {}),
    },
  });
}

export default function AgentsPage() {
  const [, setLocation] = useLocation();
  const [agents, setAgents] = useState<CustomAgent[]>([]);
  const [publicAgents, setPublicAgents] = useState<CustomAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"mine" | "explore">("mine");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const [myRes, pubRes] = await Promise.all([
        apiFetch("/api/custom-agents"),
        apiFetch("/api/custom-agents/explore"),
      ]);
      if (myRes.ok) setAgents(await myRes.json());
      if (pubRes.ok) setPublicAgents(await pubRes.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  const handleDelete = async (id: number) => {
    if (!confirm("Eliminar este agente?")) return;
    await apiFetch(`/api/custom-agents/${id}`, { method: "DELETE" });
    loadAgents();
  };

  const handleDuplicate = async (id: number) => {
    const res = await apiFetch(`/api/custom-agents/${id}/duplicate`, { method: "POST" });
    if (res.ok) {
      setTab("mine");
      loadAgents();
    }
  };

  const handleChat = async (id: number) => {
    await apiFetch(`/api/custom-agents/${id}/use`, { method: "POST" });
    setLocation(`/chat/new?agent=${id}`);
  };

  const displayAgents = tab === "mine" ? agents : publicAgents;
  const filtered = displayAgents.filter((a) => {
    const matchesSearch = !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.description?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = category === "all" || a.category === category;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/")} className="text-zinc-400 hover:text-white">
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <Bot className="w-6 h-6 text-violet-400" />
        <h1 className="text-xl font-bold">Agentes</h1>
        <div className="ml-auto">
          <Button onClick={() => setLocation("/my-agents/create")} className="bg-violet-600 hover:bg-violet-700">
            <Plus className="w-4 h-4 mr-2" />Crear agente
          </Button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setTab("mine")}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition ${tab === "mine" ? "bg-violet-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
          >
            <Bot className="w-4 h-4 inline mr-2" />Mis Agentes ({agents.length})
          </button>
          <button
            onClick={() => setTab("explore")}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition ${tab === "explore" ? "bg-violet-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
          >
            <Star className="w-4 h-4 inline mr-2" />Explorar
          </button>
        </div>

        {/* Search + Filter */}
        <div className="flex gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar agentes..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100"
          >
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="text-center py-20 text-zinc-500">Cargando agentes...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Bot className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-500">{tab === "mine" ? "No tienes agentes aun" : "No se encontraron agentes"}</p>
            {tab === "mine" && (
              <Button onClick={() => setLocation("/my-agents/create")} className="mt-4 bg-violet-600 hover:bg-violet-700">
                <Plus className="w-4 h-4 mr-2" />Crear tu primer agente
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((agent) => (
              <div
                key={agent.id}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-violet-500/50 transition-all group cursor-pointer"
                onClick={() => handleChat(agent.id)}
              >
                <div className="flex items-start gap-3 mb-3">
                  <span className="text-3xl">{agent.avatar_emoji}</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-zinc-100 truncate">{agent.name}</h3>
                    <p className="text-xs text-zinc-500 line-clamp-2 mt-1">{agent.description}</p>
                  </div>
                </div>

                {agent.conversation_starters?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {agent.conversation_starters.slice(0, 2).map((s, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 bg-zinc-800 rounded-full text-zinc-400 truncate max-w-[150px]">{s}</span>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between mt-auto pt-3 border-t border-zinc-800">
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Users className="w-3 h-3" />
                    <span>{agent.usage_count} usos</span>
                    {agent.is_public && <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-[10px]">Publico</span>}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition" onClick={(e) => e.stopPropagation()}>
                    {tab === "explore" && (
                      <button onClick={() => handleDuplicate(agent.id)} className="p-1.5 hover:bg-zinc-700 rounded" title="Duplicar">
                        <Copy className="w-3.5 h-3.5 text-zinc-400" />
                      </button>
                    )}
                    {tab === "mine" && agent.user_id !== "system" && (
                      <>
                        <button onClick={() => setLocation(`/my-agents/${agent.id}/edit`)} className="p-1.5 hover:bg-zinc-700 rounded" title="Editar">
                          <Edit className="w-3.5 h-3.5 text-zinc-400" />
                        </button>
                        <button onClick={() => handleDelete(agent.id)} className="p-1.5 hover:bg-red-900/50 rounded" title="Eliminar">
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </>
                    )}
                    <button onClick={() => handleChat(agent.id)} className="p-1.5 hover:bg-violet-900/50 rounded" title="Chatear">
                      <MessageSquare className="w-3.5 h-3.5 text-violet-400" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
