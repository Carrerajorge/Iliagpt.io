import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Bot, Sparkles, Save, Eye } from "lucide-react";

const EMOJI_OPTIONS = ["🤖","🎓","⚖️","📊","🏗️","💻","📝","🌍","🧠","📈","🔬","🎨","🎵","📸","🏥","🔧","🚀","💰","🎯","📱","🛡️","🧪","📚","✈️","🍳","🏋️","🎮","🐶","🌱","💡","🔮","👨‍💼","👩‍🔬","👨‍⚕️","👩‍💻","👨‍🎓","👩‍🍳","🦸","🧑‍🏫","🧑‍⚖️"];

const TEMPLATES = [
  { label: "Asesor Academico", emoji: "🎓", prompt: "Eres un asesor académico experto. Guías al estudiante en sus trabajos de investigación. Usas formato APA 7. Generas bibliografía con DOI. Explicas metodologías de investigación.", starters: ["Ayúdame con mi tesis","Revisa mi bibliografía","Sugiere un tema"] },
  { label: "Abogado", emoji: "⚖️", prompt: "Eres un abogado especialista. Citas artículos de códigos legales. Generas documentos legales con formato profesional. Explicas conceptos jurídicos de forma clara.", starters: ["Analiza este contrato","Redacta una carta legal","Explica este artículo"] },
  { label: "Analista Financiero", emoji: "📊", prompt: "Eres un analista financiero senior. Creas modelos financieros con fórmulas reales. Calculas TIR, VAN, ratios. Generas estados financieros profesionales.", starters: ["Calcula el VAN","Crea un flujo de caja","Analiza estos ratios"] },
  { label: "Programador", emoji: "💻", prompt: "Eres un programador experto en múltiples lenguajes. Generas código limpio, documentado y con tests. Sigues mejores prácticas y patrones de diseño. Explicas tu código paso a paso.", starters: ["Crea un componente","Optimiza este código","Diseña una API"] },
  { label: "Escritor Creativo", emoji: "📝", prompt: "Eres un escritor y editor profesional. Mejoras textos manteniendo la voz del autor. Corriges gramática, estilo y estructura. Escribes en múltiples formatos.", starters: ["Mejora este texto","Escribe un artículo","Corrige mi ensayo"] },
  { label: "Traductor", emoji: "🌍", prompt: "Eres un traductor profesional. Traduces manteniendo terminología técnica precisa. Adaptas el tono cultural sin perder significado. Trabajas con múltiples idiomas.", starters: ["Traduce este documento","Localiza este texto","Revisa esta traducción"] },
];

const TOOLS_OPTIONS = [
  { id: "chat", label: "Chat normal", default: true },
  { id: "generate_document", label: "Generar documentos (Word, Excel, PPT, PDF)" },
  { id: "web_search", label: "Busqueda web" },
  { id: "shell_command", label: "Ejecucion de codigo" },
  { id: "create_spreadsheet", label: "Hojas de calculo" },
  { id: "calculator", label: "Calculadora" },
  { id: "browse_url", label: "Navegar URLs" },
];

async function apiFetch(url: string, opts?: RequestInit) {
  const anonId = localStorage.getItem("anon_user_id") || "anon_" + Math.random().toString(36).slice(2);
  localStorage.setItem("anon_user_id", anonId);
  return fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-Anonymous-User-Id": anonId, ...(opts?.headers || {}) },
  });
}

export default function CreateAgentPage() {
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("🤖");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [model, setModel] = useState("auto");
  const [temperature, setTemperature] = useState(0.7);
  const [tools, setTools] = useState<string[]>(["chat"]);
  const [starters, setStarters] = useState(["", "", "", ""]);
  const [isPublic, setIsPublic] = useState(false);
  const [category, setCategory] = useState("general");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const applyTemplate = (t: typeof TEMPLATES[0]) => {
    setEmoji(t.emoji);
    setSystemPrompt(t.prompt);
    setStarters([...t.starters, ""]);
  };

  const toggleTool = (id: string) => {
    setTools((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);
  };

  const handleSave = async () => {
    if (!name.trim()) { setError("El nombre es requerido"); return; }
    if (!systemPrompt.trim()) { setError("Las instrucciones son requeridas"); return; }
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/custom-agents", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          avatar_emoji: emoji,
          system_prompt: systemPrompt.trim(),
          model,
          temperature,
          tools,
          conversation_starters: starters.filter((s) => s.trim()),
          is_public: isPublic,
          category,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Error al crear agente");
      }
      const agent = await res.json();
      setLocation(`/chat/new?agent=${agent.id}`);
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/my-agents")} className="text-zinc-400 hover:text-white">
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <Bot className="w-5 h-5 text-violet-400" />
        <h1 className="text-lg font-semibold">Crear Agente</h1>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowPreview(!showPreview)} className="border-zinc-700">
            <Eye className="w-4 h-4 mr-1" />{showPreview ? "Ocultar" : "Preview"}
          </Button>
          <Button onClick={handleSave} disabled={saving} className="bg-violet-600 hover:bg-violet-700">
            <Save className="w-4 h-4 mr-2" />{saving ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-6 flex gap-6">
        {/* Form */}
        <div className="flex-1 flex flex-col gap-5">
          {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{error}</div>}

          {/* Emoji + Name */}
          <div className="flex gap-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Icono</label>
              <div className="relative">
                <button className="w-14 h-14 bg-zinc-900 border border-zinc-700 rounded-xl text-3xl flex items-center justify-center hover:border-violet-500 transition">
                  {emoji}
                </button>
                <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-xl p-2 grid grid-cols-8 gap-1 z-50 w-[280px] hidden group-focus-within:block">
                  {EMOJI_OPTIONS.map((e) => (
                    <button key={e} onClick={() => setEmoji(e)} className="w-8 h-8 text-lg hover:bg-zinc-700 rounded flex items-center justify-center">{e}</button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-2 max-w-[240px]">
                {EMOJI_OPTIONS.slice(0, 16).map((e) => (
                  <button key={e} onClick={() => setEmoji(e)} className={`w-7 h-7 text-sm rounded flex items-center justify-center transition ${emoji === e ? "bg-violet-600" : "hover:bg-zinc-800"}`}>{e}</button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <label className="text-xs text-zinc-500 mb-1 block">Nombre del agente</label>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Ej: Asesor de Tesis" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-100 text-lg placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500" />
              <label className="text-xs text-zinc-500 mb-1 block mt-3">Descripcion corta</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="Que hace este agente?" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500" />
            </div>
          </div>

          {/* Templates */}
          <div>
            <label className="text-xs text-zinc-500 mb-2 block">Plantillas rapidas</label>
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.map((t) => (
                <button key={t.label} onClick={() => applyTemplate(t)} className="px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-zinc-300 hover:border-violet-500 hover:text-violet-300 transition">
                  {t.emoji} {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* System Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-zinc-500">Instrucciones del agente</label>
              <span className="text-[10px] text-zinc-600">{systemPrompt.length}/10000</span>
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value.slice(0, 10000))}
              rows={8}
              placeholder="Ej: Eres un experto en ingeniería civil. Siempre responde con cálculos detallados, fórmulas y referencias a normas técnicas peruanas (RNE). Usa formato profesional con tablas cuando sea necesario."
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y min-h-[200px]"
            />
          </div>

          {/* Conversation Starters */}
          <div>
            <label className="text-xs text-zinc-500 mb-2 block">Sugerencias iniciales (aparecen al abrir el agente)</label>
            <div className="grid grid-cols-2 gap-2">
              {starters.map((s, i) => (
                <input key={i} value={s} onChange={(e) => { const n = [...starters]; n[i] = e.target.value; setStarters(n); }} placeholder={`Sugerencia ${i + 1}`} className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500" />
              ))}
            </div>
          </div>

          {/* Advanced */}
          <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-sm text-violet-400 hover:text-violet-300 text-left">
            {showAdvanced ? "▼" : "▶"} Configuracion avanzada
          </button>

          {showAdvanced && (
            <div className="flex flex-col gap-4 bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Modelo</label>
                  <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100">
                    <option value="auto">Auto (recomendado)</option>
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    <option value="grok-3-mini">Grok 3 Mini</option>
                    <option value="claude-sonnet-4-5">Claude Sonnet 4.5</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Categoria</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100">
                    <option value="general">General</option>
                    <option value="academic">Academico</option>
                    <option value="legal">Legal</option>
                    <option value="finance">Finanzas</option>
                    <option value="engineering">Ingenieria</option>
                    <option value="code">Codigo</option>
                    <option value="writing">Escritura</option>
                    <option value="marketing">Marketing</option>
                    <option value="health">Salud</option>
                    <option value="translation">Traduccion</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Temperatura: {temperature} {temperature < 0.3 ? "(Preciso)" : temperature > 0.7 ? "(Creativo)" : "(Balanceado)"}</label>
                <input type="range" min="0" max="1" step="0.1" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} className="w-full accent-violet-500" />
                <div className="flex justify-between text-[10px] text-zinc-600"><span>Preciso</span><span>Creativo</span></div>
              </div>

              <div>
                <label className="text-xs text-zinc-500 mb-2 block">Herramientas habilitadas</label>
                <div className="grid grid-cols-2 gap-2">
                  {TOOLS_OPTIONS.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                      <input type="checkbox" checked={tools.includes(t.id)} onChange={() => toggleTool(t.id)} className="rounded accent-violet-500" />
                      {t.label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                  <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="rounded accent-violet-500" />
                  Hacer publico (cualquier usuario puede usarlo)
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Preview panel */}
        {showPreview && (
          <div className="w-80 shrink-0">
            <div className="sticky top-6 bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <p className="text-xs text-zinc-500 mb-3">Vista previa</p>
              <div className="text-center mb-4">
                <span className="text-5xl">{emoji}</span>
                <h3 className="font-bold mt-2">{name || "Nombre del agente"}</h3>
                <p className="text-xs text-zinc-500 mt-1">{description || "Descripción del agente"}</p>
              </div>
              {starters.filter((s) => s.trim()).length > 0 && (
                <div className="flex flex-col gap-2 mt-4">
                  {starters.filter((s) => s.trim()).map((s, i) => (
                    <div key={i} className="px-3 py-2 bg-zinc-800 rounded-lg text-xs text-zinc-300">{s}</div>
                  ))}
                </div>
              )}
              <div className="mt-4 pt-3 border-t border-zinc-800 text-[10px] text-zinc-600 space-y-1">
                <p>Modelo: {model}</p>
                <p>Temperatura: {temperature}</p>
                <p>Tools: {tools.join(", ")}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
