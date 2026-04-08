/**
 * CodexChat — Main Codex VC coding agent interface.
 *
 * 3-panel layout: FileTree (left) | Chat+Steps (center) | Preview (right)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, FolderTree, Eye, Terminal, Play, Square, ChevronRight, FileCode, CheckCircle2, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/apiClient";
import { FileTree, type FileEntry } from "./FileTree";
import { CodeEditor } from "./CodeEditor";
import { PreviewPanel } from "./PreviewPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CodexStep {
  id: string;
  type: "plan" | "file_write" | "file_read" | "terminal" | "install" | "preview" | "fix";
  description: string;
  status: "pending" | "running" | "done" | "error";
  output?: string;
  error?: string;
  timestamp: number;
}

interface CodexSession {
  id: string;
  projectName: string;
  workspace: string;
  framework: string;
  status: string;
  steps: CodexStep[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CodexChat() {
  const [sessions, setSessions] = useState<CodexSession[]>([]);
  const [activeSession, setActiveSession] = useState<CodexSession | null>(null);
  const [input, setInput] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<CodexStep[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState("");
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; description: string; icon: string }>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load templates on mount
  useEffect(() => {
    apiFetch("/api/codex/templates").then(r => r.json()).then(d => setTemplates(d.templates || [])).catch(() => {});
    apiFetch("/api/codex").then(r => r.json()).then(d => setSessions(d.sessions || [])).catch(() => {});
  }, []);

  // Auto-scroll steps
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  const loadFiles = useCallback(async (sessionId: string) => {
    try {
      const r = await apiFetch(`/api/codex/${sessionId}/files`);
      const d = await r.json();
      setFiles(d.files || []);
    } catch { /* ignore */ }
  }, []);

  const openFile = useCallback(async (sessionId: string, path: string) => {
    try {
      const r = await apiFetch(`/api/codex/${sessionId}/file?path=${encodeURIComponent(path)}`);
      const d = await r.json();
      setSelectedFile({ path, content: d.content || "" });
    } catch { /* ignore */ }
  }, []);

  const createProject = async (templateId?: string) => {
    if (!input.trim() && !templateId) return;
    setIsCreating(true);
    try {
      const r = await apiFetch("/api/codex/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: input.trim().split(" ").slice(0, 3).join("-").toLowerCase() || "my-project",
          instruction: input.trim() || "Create a basic project",
          templateId,
        }),
      });
      const d = await r.json();
      if (d.session) {
        setActiveSession(d.session);
        setSessions(prev => [d.session, ...prev]);
        await loadFiles(d.session.id);
        await sendInstruction(d.session.id, input.trim() || "Set up the project");
      }
    } catch (err: any) {
      console.error("Create failed:", err);
    } finally {
      setIsCreating(false);
      setInput("");
    }
  };

  const sendInstruction = async (sessionId: string, instruction: string) => {
    setIsRunning(true);
    setSteps([]);
    try {
      const r = await fetch(`/api/codex/${sessionId}/instruction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
        credentials: "include",
      });

      if (!r.body) throw new Error("No response body");
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.id) {
                setSteps(prev => {
                  const exists = prev.find(s => s.id === data.id);
                  if (exists) return prev.map(s => s.id === data.id ? data : s);
                  return [...prev, data];
                });
              }
            } catch { /* skip non-JSON */ }
          }
        }
      }

      await loadFiles(sessionId);
    } catch (err: any) {
      console.error("Instruction failed:", err);
    } finally {
      setIsRunning(false);
    }
  };

  const handleSubmit = () => {
    if (!input.trim()) return;
    if (activeSession) {
      sendInstruction(activeSession.id, input.trim());
      setInput("");
    } else {
      createProject();
    }
  };

  const stepIcon = (step: CodexStep) => {
    if (step.status === "running") return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    if (step.status === "done") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (step.status === "error") return <XCircle className="h-4 w-4 text-red-500" />;
    return <Clock className="h-4 w-4 text-gray-400" />;
  };

  // No active session — show templates
  if (!activeSession) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b p-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <FileCode className="h-5 w-5" />
            Codex VC
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Create software from natural language</p>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <h3 className="text-lg font-medium mb-4">Start with a template</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
            {templates.map(t => (
              <button
                key={t.id}
                onClick={() => { setInput(`Create a ${t.name} project`); createProject(t.id); }}
                className="p-4 rounded-lg border hover:border-primary hover:bg-primary/5 text-left transition-colors"
              >
                <div className="text-2xl mb-2">{t.icon}</div>
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground mt-1">{t.description}</div>
              </button>
            ))}
          </div>
          <h3 className="text-lg font-medium mb-4">Or describe what you want</h3>
          <div className="flex gap-2 max-w-xl">
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Build a todo app with React and local storage..."
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
            />
            <Button onClick={handleSubmit} disabled={isCreating || !input.trim()}>
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Active session — 3-panel layout
  return (
    <div className="flex h-full">
      {/* Left: File Tree */}
      <div className="w-60 border-r flex flex-col">
        <div className="p-3 border-b font-medium text-sm flex items-center gap-2">
          <FolderTree className="h-4 w-4" />
          {activeSession.projectName}
        </div>
        <ScrollArea className="flex-1">
          <FileTree
            files={files}
            selectedPath={selectedFile?.path}
            onSelect={(path) => openFile(activeSession.id, path)}
          />
        </ScrollArea>
      </div>

      {/* Center: Chat + Steps */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-auto p-4 space-y-2">
          {steps.map(step => (
            <div key={step.id} className={cn(
              "flex items-start gap-2 p-2 rounded-lg text-sm",
              step.status === "error" && "bg-red-50 dark:bg-red-950/20",
              step.status === "running" && "bg-blue-50 dark:bg-blue-950/20",
            )}>
              {stepIcon(step)}
              <div className="flex-1 min-w-0">
                <div className="font-medium">{step.description}</div>
                {step.output && (
                  <pre className="mt-1 text-xs text-muted-foreground bg-muted p-2 rounded overflow-x-auto max-h-32">
                    {step.output.slice(0, 500)}
                  </pre>
                )}
                {step.error && (
                  <pre className="mt-1 text-xs text-red-600 bg-red-50 dark:bg-red-950/30 p-2 rounded overflow-x-auto max-h-32">
                    {step.error.slice(0, 500)}
                  </pre>
                )}
              </div>
              <Badge variant="outline" className="text-xs shrink-0">{step.type}</Badge>
            </div>
          ))}
          <div ref={scrollRef} />
        </div>

        {/* Input */}
        <div className="border-t p-3 flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Add authentication, change colors, fix a bug..."
            onKeyDown={e => e.key === "Enter" && !isRunning && handleSubmit()}
            disabled={isRunning}
          />
          <Button onClick={handleSubmit} disabled={isRunning || !input.trim()} size="icon">
            {isRunning ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="icon" onClick={() => setShowPreview(!showPreview)}>
            <Eye className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setShowTerminal(!showTerminal)}>
            <Terminal className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Right: Code Editor or Preview */}
      {(selectedFile || showPreview) && (
        <div className="w-[45%] border-l flex flex-col">
          {showPreview ? (
            <PreviewPanel sessionId={activeSession.id} />
          ) : selectedFile ? (
            <CodeEditor
              path={selectedFile.path}
              content={selectedFile.content}
              onSave={async (content) => {
                await apiFetch(`/api/codex/${activeSession.id}/file`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ path: selectedFile.path, content }),
                });
                setSelectedFile({ ...selectedFile, content });
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

export default CodexChat;
