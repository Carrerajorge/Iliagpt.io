/**
 * CodexChat — Main Codex VC coding agent interface.
 *
 * 3-panel layout: FileTree (left) | Chat+Steps (center) | Editor/Preview (right)
 *
 * Wires: multi-tab editor, modified-file tracking, file actions,
 * preview console/errors, and read-only editor state while agent runs.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Send, FolderTree, Eye, Terminal, Play, Square,
  ChevronRight, FileCode, CheckCircle2, XCircle, Clock, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/apiClient";
import { FileTree, type FileEntry, type FileActions } from "./FileTree";
import { CodeEditor, type EditorTab } from "./CodeEditor";
import { PreviewPanel, type ConsoleEntry } from "./PreviewPanel";

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

/** Backend returns flat {name, relativePath, type, size}. Convert to nested tree for FileTree. */
interface FlatFileEntry {
  name: string;
  relativePath: string;
  type: "file" | "directory";
  size?: number;
}

function buildFileTree(flat: FlatFileEntry[]): FileEntry[] {
  const root: FileEntry[] = [];
  const dirMap = new Map<string, FileEntry>();

  const sorted = [...flat].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  for (const entry of sorted) {
    const node: FileEntry = {
      name: entry.name,
      path: entry.relativePath,
      type: entry.type,
      size: entry.size,
      children: entry.type === "directory" ? [] : undefined,
    };

    if (entry.type === "directory") {
      dirMap.set(entry.relativePath, node);
    }

    const parentPath = entry.relativePath.includes("/")
      ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf("/"))
      : "";

    if (parentPath && dirMap.has(parentPath)) {
      dirMap.get(parentPath)!.children!.push(node);
    } else {
      root.push(node);
    }
  }

  return root;
}

// ---------------------------------------------------------------------------
// Open-file tab state helper
// ---------------------------------------------------------------------------

interface OpenFile {
  path: string;
  content: string;
  originalContent?: string; // content at last save/load — for diff
  isDirty: boolean;
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
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState("");
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; description: string; icon: string }>>([]);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [modifiedPaths, setModifiedPaths] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeFile = openFiles.find(f => f.path === activeFilePath) || null;

  // Load templates on mount
  useEffect(() => {
    apiFetch("/api/codex/templates").then(r => r.json()).then(d => setTemplates(d.templates || [])).catch(() => {});
    apiFetch("/api/codex").then(r => r.json()).then(d => setSessions(d.sessions || [])).catch(() => {});
  }, []);

  // Auto-scroll steps
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  // Track modified files from agent steps
  useEffect(() => {
    const newModified = new Set(modifiedPaths);
    for (const step of steps) {
      if (step.type === "file_write" && step.status === "done" && step.description) {
        // Try to extract file path from description
        const match = step.description.match(/(?:write|create|update|modify)\s+(.+?)(?:\s|$)/i);
        if (match) newModified.add(match[1]);
      }
    }
    if (newModified.size !== modifiedPaths.size) {
      setModifiedPaths(newModified);
    }
  }, [steps]);

  const loadFiles = useCallback(async (sessionId: string) => {
    try {
      const r = await apiFetch(`/api/codex/${sessionId}/files`);
      const d = await r.json();
      setFiles(buildFileTree(d.files || []));
    } catch { /* ignore */ }
  }, []);

  const openFile = useCallback(async (sessionId: string, path: string) => {
    // If already open, just switch to it
    const existing = openFiles.find(f => f.path === path);
    if (existing) {
      setActiveFilePath(path);
      return;
    }
    try {
      const r = await apiFetch(`/api/codex/${sessionId}/file?path=${encodeURIComponent(path)}`);
      const d = await r.json();
      const content = d.content || "";
      setOpenFiles(prev => [...prev, { path, content, originalContent: content, isDirty: false }]);
      setActiveFilePath(path);
    } catch { /* ignore */ }
  }, [openFiles]);

  const closeFile = useCallback((path: string) => {
    setOpenFiles(prev => prev.filter(f => f.path !== path));
    if (activeFilePath === path) {
      setActiveFilePath(prev => {
        const remaining = openFiles.filter(f => f.path !== path);
        return remaining.length > 0 ? remaining[remaining.length - 1].path : null;
      });
    }
  }, [activeFilePath, openFiles]);

  const handleFileSave = useCallback(async (content: string) => {
    if (!activeSession || !activeFilePath) return;
    await apiFetch(`/api/codex/${activeSession.id}/file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: activeFilePath, content }),
    });
    setOpenFiles(prev =>
      prev.map(f => f.path === activeFilePath ? { ...f, content, originalContent: content, isDirty: false } : f),
    );
    setModifiedPaths(prev => {
      const next = new Set(prev);
      next.delete(activeFilePath);
      return next;
    });
  }, [activeSession, activeFilePath]);

  // File actions for FileTree
  const fileActions: FileActions = {
    onCreateFile: useCallback(async (parentPath: string) => {
      if (!activeSession) return;
      const name = window.prompt("New file name:", "untitled.ts");
      if (!name) return;
      const fullPath = parentPath ? `${parentPath}/${name}` : name;
      try {
        await apiFetch(`/api/codex/${activeSession.id}/file`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: fullPath, content: "" }),
        });
        await loadFiles(activeSession.id);
        openFile(activeSession.id, fullPath);
      } catch { /* ignore */ }
    }, [activeSession, loadFiles, openFile]),

    onCreateFolder: useCallback(async (parentPath: string) => {
      if (!activeSession) return;
      const name = window.prompt("New folder name:", "new-folder");
      if (!name) return;
      const fullPath = parentPath ? `${parentPath}/${name}` : name;
      try {
        // Create folder by writing a .gitkeep file inside it
        await apiFetch(`/api/codex/${activeSession.id}/file`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: `${fullPath}/.gitkeep`, content: "" }),
        });
        await loadFiles(activeSession.id);
      } catch { /* ignore */ }
    }, [activeSession, loadFiles]),

    onRename: useCallback(async (path: string) => {
      if (!activeSession) return;
      const currentName = path.split("/").pop() || path;
      const newName = window.prompt("Rename to:", currentName);
      if (!newName || newName === currentName) return;
      const parentDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      const newPath = parentDir ? `${parentDir}/${newName}` : newName;
      try {
        // Read current content, write to new path, delete old
        const r = await apiFetch(`/api/codex/${activeSession.id}/file?path=${encodeURIComponent(path)}`);
        const d = await r.json();
        await apiFetch(`/api/codex/${activeSession.id}/file`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: newPath, content: d.content || "" }),
        });
        await apiFetch(`/api/codex/${activeSession.id}/file?path=${encodeURIComponent(path)}`, {
          method: "DELETE",
        });
        await loadFiles(activeSession.id);
        // Update open file if it was renamed
        setOpenFiles(prev => prev.map(f => f.path === path ? { ...f, path: newPath } : f));
        if (activeFilePath === path) setActiveFilePath(newPath);
      } catch { /* ignore */ }
    }, [activeSession, loadFiles, activeFilePath]),

    onDelete: useCallback(async (path: string) => {
      if (!activeSession) return;
      if (!window.confirm(`Delete "${path}"?`)) return;
      try {
        await apiFetch(`/api/codex/${activeSession.id}/file?path=${encodeURIComponent(path)}`, {
          method: "DELETE",
        });
        await loadFiles(activeSession.id);
        closeFile(path);
      } catch { /* ignore */ }
    }, [activeSession, loadFiles, closeFile]),
  };

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
    setModifiedPaths(new Set());
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

  const resumeSession = useCallback(async (session: CodexSession) => {
    setActiveSession(session);
    setSteps(session.steps || []);
    setOpenFiles([]);
    setActiveFilePath(null);
    setConsoleEntries([]);
    setModifiedPaths(new Set());
    await loadFiles(session.id);
  }, [loadFiles]);

  const runTerminalCommand = useCallback(async (command: string) => {
    if (!activeSession) return;
    setTerminalOutput(prev => prev + `$ ${command}\n`);
    try {
      const r = await apiFetch(`/api/codex/${activeSession.id}/terminal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const d = await r.json();
      setTerminalOutput(prev => prev + (d.stdout || "") + (d.stderr || "") + "\n");
    } catch (err: any) {
      setTerminalOutput(prev => prev + `Error: ${err.message}\n`);
    }
  }, [activeSession]);

  const handleConsoleEntry = useCallback((entry: ConsoleEntry) => {
    setConsoleEntries(prev => [...prev.slice(-199), entry]);
  }, []);

  // Build tabs array from openFiles
  const editorTabs: EditorTab[] = openFiles.map(f => ({
    path: f.path,
    content: f.content,
    isDirty: f.isDirty,
  }));

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
          {sessions.length > 0 && (
            <div className="mb-8">
              <h3 className="text-lg font-medium mb-3">Recent sessions</h3>
              <div className="flex flex-wrap gap-2">
                {sessions.map(s => (
                  <button
                    key={s.id}
                    onClick={() => resumeSession(s)}
                    className="px-3 py-2 rounded-lg border hover:border-primary hover:bg-primary/5 text-left text-sm transition-colors"
                  >
                    <div className="font-medium">{s.projectName}</div>
                    <div className="text-xs text-muted-foreground">{s.framework}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
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
  const consoleErrorCount = consoleEntries.filter(e => e.level === "error").length;

  return (
    <div className="flex h-full">
      {/* Left: File Tree */}
      <div className="w-60 border-r flex flex-col">
        <div className="p-3 border-b font-medium text-sm flex items-center gap-2">
          <FolderTree className="h-4 w-4" />
          <span className="truncate">{activeSession.projectName}</span>
          {isRunning && (
            <Badge variant="outline" className="text-[10px] gap-1 ml-auto shrink-0">
              <Loader2 className="h-3 w-3 animate-spin" /> Running
            </Badge>
          )}
        </div>
        <ScrollArea className="flex-1">
          <FileTree
            files={files}
            selectedPath={activeFilePath || undefined}
            onSelect={(path) => openFile(activeSession.id, path)}
            modifiedPaths={modifiedPaths}
            actions={isRunning ? undefined : fileActions}
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

        {/* Terminal */}
        {showTerminal && (
          <div className="border-t max-h-48 flex flex-col">
            <div className="flex items-center justify-between px-3 py-1 bg-muted/30 border-b">
              <span className="text-xs font-medium flex items-center gap-1"><Terminal className="h-3 w-3" /> Terminal</span>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setTerminalOutput("")}>
                <XCircle className="h-3 w-3" />
              </Button>
            </div>
            <pre className="flex-1 overflow-auto p-2 text-xs font-mono bg-gray-950 text-green-400 whitespace-pre-wrap">
              {terminalOutput || "No output yet. Send a command below."}
            </pre>
          </div>
        )}

        {/* Input */}
        <div className="border-t p-3 flex gap-2">
          {isRunning && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 mr-1">
              <Lock className="h-3 w-3" />
            </div>
          )}
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={showTerminal ? "Enter a terminal command..." : "Add authentication, change colors, fix a bug..."}
            onKeyDown={e => {
              if (e.key === "Enter" && !isRunning) {
                if (showTerminal && input.trim()) {
                  runTerminalCommand(input.trim());
                  setInput("");
                } else {
                  handleSubmit();
                }
              }
            }}
            disabled={isRunning}
          />
          <Button onClick={handleSubmit} disabled={isRunning || !input.trim()} size="icon">
            {isRunning ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          </Button>
          <Button
            variant={showPreview ? "secondary" : "outline"}
            size="icon"
            onClick={() => setShowPreview(!showPreview)}
            className="relative"
          >
            <Eye className="h-4 w-4" />
            {consoleErrorCount > 0 && !showPreview && (
              <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-red-500 text-[9px] text-white flex items-center justify-center">
                {consoleErrorCount > 9 ? "!" : consoleErrorCount}
              </span>
            )}
          </Button>
          <Button variant={showTerminal ? "secondary" : "outline"} size="icon" onClick={() => setShowTerminal(!showTerminal)}>
            <Terminal className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Right: Code Editor or Preview */}
      {(activeFile || showPreview) && (
        <div className="w-[45%] border-l flex flex-col">
          {showPreview ? (
            <PreviewPanel
              sessionId={activeSession.id}
              consoleEntries={consoleEntries}
              onConsoleEntry={handleConsoleEntry}
            />
          ) : activeFile ? (
            <CodeEditor
              path={activeFile.path}
              content={activeFile.content}
              readOnly={isRunning}
              onSave={handleFileSave}
              tabs={editorTabs}
              onTabSelect={setActiveFilePath}
              onTabClose={closeFile}
              originalContent={activeFile.originalContent}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

export default CodexChat;
