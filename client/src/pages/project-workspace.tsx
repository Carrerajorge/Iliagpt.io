import { useLocation, useParams } from "wouter";
import { useState, useRef, useEffect, useCallback } from "react";
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
  Filter,
  FolderOpen,
  Zap,
  RefreshCw,
  ChevronDown,
  Mic,
  ArrowUp,
  Sparkles,
  Square,
  PanelLeft,
  CircleDot,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Terminal,
  Code2,
  Search,
  FileEdit,
  Wrench,
  Trash2,
  StopCircle,
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

interface ThreadSummary {
  id: string;
  title: string;
  status: string;
  messageCount: number;
  updatedAt: number;
  lastMessage?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
  isStreaming?: boolean;
}

interface ToolCallInfo {
  id: string;
  name: string;
  input: any;
  status: "running" | "success" | "error";
  result?: string;
  duration?: number;
}

const TOOL_ICONS: Record<string, any> = {
  bash: Terminal,
  run_code: Code2,
  web_search: Search,
  read_file: FileText,
  write_file: FileEdit,
  edit_file: FileEdit,
  list_files: FolderOpen,
  browse_and_act: Globe,
  fetch_url: Globe,
};

function ToolCallDisplay({ tool }: { tool: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[tool.name] || Wrench;

  return (
    <div
      className="my-1 rounded-lg border border-white/10 bg-white/[0.03] overflow-hidden cursor-pointer"
      onClick={() => setExpanded(!expanded)}
      data-testid={`tool-call-${tool.id}`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <Icon className="h-3.5 w-3.5 text-amber-500/70 shrink-0" />
        <span className="text-[12px] font-mono text-white/60 truncate flex-1">{tool.name}</span>
        {tool.status === "running" && <Loader2 className="h-3 w-3 text-amber-500 animate-spin shrink-0" />}
        {tool.status === "success" && <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />}
        {tool.status === "error" && <AlertCircle className="h-3 w-3 text-red-500 shrink-0" />}
        {tool.duration && (
          <span className="text-[10px] text-white/30">{(tool.duration / 1000).toFixed(1)}s</span>
        )}
        <ChevronDown className={`h-3 w-3 text-white/30 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </div>
      {expanded && (
        <div className="border-t border-white/5 px-3 py-2">
          {tool.input && (
            <div className="mb-2">
              <span className="text-[10px] text-white/30 uppercase tracking-wider">Input</span>
              <pre className="text-[11px] text-white/50 mt-1 overflow-x-auto whitespace-pre-wrap break-all max-h-[100px] overflow-y-auto">
                {typeof tool.input === "string" ? tool.input : JSON.stringify(tool.input, null, 2)}
              </pre>
            </div>
          )}
          {tool.result && (
            <div>
              <span className="text-[10px] text-white/30 uppercase tracking-wider">Output</span>
              <pre className="text-[11px] text-white/50 mt-1 overflow-x-auto whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto">
                {tool.result.substring(0, 2000)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end mb-3" data-testid={`message-user-${message.id}`}>
        <div className="max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 bg-amber-500/15 border border-amber-500/20">
          <p className="text-[13px] text-white/85 whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start mb-3" data-testid={`message-assistant-${message.id}`}>
      <div className="max-w-[90%]">
        {message.toolCalls?.map((tool) => (
          <ToolCallDisplay key={tool.id} tool={tool} />
        ))}
        {message.content && (
          <div className="rounded-2xl rounded-bl-md px-4 py-2.5 bg-white/[0.04] border border-white/5">
            <p className="text-[13px] text-white/75 whitespace-pre-wrap leading-relaxed">
              {message.content}
              {message.isStreaming && (
                <span className="inline-block w-1.5 h-4 bg-amber-500 ml-0.5 animate-pulse rounded-sm" />
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProjectWorkspace() {
  const [, setLocation] = useLocation();
  const params = useParams<{ type: string }>();
  const projectType = decodeURIComponent(params.type || "website").toLowerCase();
  const typeInfo = PROJECT_TYPE_MAP[projectType] || { label: projectType, icon: Globe, color: "text-blue-500" };

  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [thinkingStep, setThinkingStep] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const projectName = typeInfo.label.toUpperCase();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    fetchThreads();
  }, []);

  const fetchThreads = async () => {
    try {
      const res = await fetch("/api/workspace-agent/threads");
      const data = await res.json();
      if (data.success) setThreads(data.data);
    } catch {}
  };

  const loadThread = async (threadId: string) => {
    try {
      const res = await fetch(`/api/workspace-agent/threads/${threadId}`);
      const data = await res.json();
      if (data.success) {
        setActiveThreadId(threadId);
        setMessages(
          data.data.messages.map((m: any, i: number) => ({
            id: `${threadId}-${i}`,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
            toolCalls: m.toolCalls,
          }))
        );
      }
    } catch {}
  };

  const deleteThread = async (threadId: string) => {
    try {
      await fetch(`/api/workspace-agent/threads/${threadId}`, { method: "DELETE" });
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        setMessages([]);
      }
    } catch {}
  };

  const handleAutoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 150) + "px";
  };

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setThinkingStep(null);
  }, []);

  const sendMessage = useCallback(async () => {
    const text = prompt.trim();
    if (!text || isStreaming) return;

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setPrompt("");
    setIsStreaming(true);
    setThinkingStep("Conectando con el agente...");

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const assistantMsgId = `msg_${Date.now() + 1}`;
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      toolCalls: [],
      isStreaming: true,
    };
    setMessages((prev) => [...prev, assistantMsg]);

    const controller = new AbortController();
    abortRef.current = controller;
    let currentContent = "";

    try {
      const response = await fetch("/api/workspace-agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: activeThreadId,
          message: text,
          projectType,
          projectName: typeInfo.label,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let buffer = "";
      let currentToolCalls: ToolCallInfo[] = [];
      let receivedThreadId: string | null = null;

      let lastEventType = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            lastEventType = line.substring(7).trim();
            continue;
          }

          if (line.startsWith("data: ")) {
            const dataStr = line.substring(6);
            try {
              const data = JSON.parse(dataStr);
              const eventType = lastEventType || "";
              lastEventType = "";

              if (data.threadId && eventType === "thread_info") {
                receivedThreadId = data.threadId;
              }

              if (eventType === "chunk" && data.content) {
                currentContent += data.content;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: currentContent, isStreaming: true }
                      : m
                  )
                );
              }

              if (eventType === "thinking" && (data.step || data.message)) {
                setThinkingStep(data.message || data.step);
              }

              if (eventType === "brief" && data.brief?.objective) {
                setThinkingStep(data.brief.objective);
              }

              if ((eventType === "tool_call" || data.toolCall) && data.toolCall) {
                const tc = data.toolCall;
                const existing = currentToolCalls.find((t) => t.id === tc.id);
                if (existing) {
                  existing.status = tc.status || existing.status;
                  if (tc.result) existing.result = JSON.stringify(tc.result).substring(0, 2000);
                } else {
                  currentToolCalls = [
                    ...currentToolCalls,
                    {
                      id: tc.id || `tc_${Date.now()}`,
                      name: tc.name || "unknown",
                      input: tc.input,
                      status: tc.status || "running",
                    },
                  ];
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, toolCalls: [...currentToolCalls] }
                      : m
                  )
                );
                setThinkingStep(`Ejecutando ${tc.name || "herramienta"}...`);
              }

              if (eventType === "error" && data.message) {
                currentContent += `\n\nError: ${data.message}`;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: currentContent, isStreaming: true }
                      : m
                  )
                );
              }

              if (eventType === "clarification" && data.question) {
                currentContent += data.question;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: currentContent, isStreaming: true }
                      : m
                  )
                );
              }
            } catch {}
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? { ...m, isStreaming: false } : m
        )
      );

      if (receivedThreadId) {
        setActiveThreadId(receivedThreadId);
      }

      fetchThreads();
    } catch (err: any) {
      if (err.name === "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: currentContent + "\n\n[Generación detenida]", isStreaming: false }
              : m
          )
        );
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: `Error: ${err.message}`, isStreaming: false }
              : m
          )
        );
      }
    } finally {
      setIsStreaming(false);
      setThinkingStep(null);
      abortRef.current = null;
    }
  }, [prompt, isStreaming, activeThreadId, projectType, typeInfo.label]);

  const startNewThread = () => {
    setActiveThreadId(null);
    setMessages([]);
    setPrompt("");
    setThinkingStep(null);
  };

  const hasMessages = messages.length > 0;

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
          <button
            onClick={startNewThread}
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-white/10 text-sm text-white/80 transition-colors"
            data-testid="button-new-thread"
          >
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
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-white/5 mb-1">
            <FolderOpen className="h-3.5 w-3.5 text-white/50" />
            <span className="text-sm text-white/70 font-medium truncate">{projectName}</span>
          </div>

          <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
            {threads.length === 0 ? (
              <p className="text-[11px] text-white/30 mt-2 px-2">No hay hilos</p>
            ) : (
              threads.map((t) => (
                <div
                  key={t.id}
                  className={`group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                    activeThreadId === t.id ? "bg-amber-500/10 border border-amber-500/20" : "hover:bg-white/5"
                  }`}
                  onClick={() => loadThread(t.id)}
                  data-testid={`thread-item-${t.id}`}
                >
                  <FileText className="h-3 w-3 text-white/40 shrink-0" />
                  <span className="text-[12px] text-white/60 truncate flex-1">{t.title}</span>
                  <span className="text-[10px] text-white/25">{t.messageCount}</span>
                  <button
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/20 text-white/30 hover:text-red-400 transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteThread(t.id);
                    }}
                    data-testid={`delete-thread-${t.id}`}
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-end px-3 pb-3 overflow-hidden">
          {hasMessages ? (
            <div className="flex-1 overflow-y-auto mb-3 custom-scrollbar min-h-0" data-testid="messages-container">
              <div className="py-3 space-y-1">
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>
          ) : (
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
          )}

          {thinkingStep && (
            <div className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-lg bg-amber-500/5 border border-amber-500/10" data-testid="thinking-indicator">
              <Loader2 className="h-3 w-3 text-amber-500 animate-spin" />
              <span className="text-[11px] text-amber-500/80 truncate">{thinkingStep}</span>
            </div>
          )}

          <div className="rounded-2xl border border-amber-500/60 bg-[#1e1e30] overflow-hidden shadow-[0_0_15px_rgba(245,158,11,0.08)]">
            <div className="px-4 pt-3 pb-2">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={handleAutoResize}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Ask Codex anything, @ to add files, / for commands, $ for skills"
                className="w-full bg-transparent border-0 outline-none text-[14px] text-white/70 placeholder-white/35 resize-none min-h-[24px] max-h-[120px]"
                rows={1}
                disabled={isStreaming}
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
                {isStreaming ? (
                  <button
                    onClick={stopGeneration}
                    className="w-7 h-7 rounded-lg bg-red-500 hover:bg-red-400 text-white flex items-center justify-center transition-colors active:scale-95"
                    data-testid="button-stop"
                  >
                    <StopCircle className="h-4 w-4 stroke-[2.5]" />
                  </button>
                ) : (
                  <button
                    onClick={sendMessage}
                    disabled={!prompt.trim()}
                    className="w-7 h-7 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/30 disabled:cursor-not-allowed text-black flex items-center justify-center transition-colors active:scale-95"
                    style={{ touchAction: "manipulation" }}
                    data-testid="button-send"
                  >
                    <ArrowUp className="h-4 w-4 stroke-[2.5]" />
                  </button>
                )}
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
          <div className="flex items-center gap-1">
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white/10 text-white/90"
              data-testid="tab-preview"
            >
              <Globe className="h-3.5 w-3.5" />
              Preview
            </button>
            <button className="px-2 py-1.5 text-xs text-white/40 hover:text-white/60 transition-colors" data-testid="tab-add">
              +
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 rounded-md px-3 py-1 text-xs text-white font-medium transition-colors"
              data-testid="button-publish"
            >
              <Globe className="h-3 w-3" />
              Publish
            </button>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center">
          {hasMessages ? (
            <div className="text-center px-8">
              <Globe className="h-16 w-16 text-white/10 mx-auto mb-4" />
              <p className="text-sm text-white/30 mb-2">Preview se activará cuando el agente genere archivos</p>
              <p className="text-[11px] text-white/20">Los archivos creados aparecerán aquí como vista previa en vivo</p>
            </div>
          ) : (
            <div className="text-center px-8">
              <div className="w-20 h-20 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-center mx-auto mb-4">
                <Sparkles className="h-8 w-8 text-white/10" />
              </div>
              <p className="text-sm text-white/30 mb-1">Describe tu proyecto en el chat</p>
              <p className="text-[11px] text-white/20">El agente escribirá código y mostrará la vista previa aquí</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
