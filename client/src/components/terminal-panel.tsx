import { useState, useRef, useEffect, useCallback, KeyboardEvent } from "react"; 
import { useTerminalSession, TerminalLine } from "@/hooks/use-terminal-session";

export function TerminalPanel() {
  const {
    state,
    startLocalSession,
    startRemoteSession,
    startRemoteSessionFromTarget,
    remoteTargets,
    fetchRemoteTargets,
    createRemoteTarget,
    deleteRemoteTarget,
    executeCommand,
    executeScript,
    closeSession,
    clearOutput,
    getSystemInfo,
    listProcesses,
    killProcess,
    fileOperation,
  } = useTerminalSession();

  const [inputValue, setInputValue] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showSystemInfo, setShowSystemInfo] = useState(false);
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [showProcesses, setShowProcesses] = useState(false);
  const [processes, setProcesses] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"terminal" | "scripts" | "files">("terminal");
  const [scriptLanguage, setScriptLanguage] = useState("python");
  const [scriptCode, setScriptCode] = useState("");

  const [remoteHost, setRemoteHost] = useState(""); const [remotePort, setRemotePort] = useState("22"); const [remoteUsername, setRemoteUsername] = useState(""); const [remoteAuthType, 
  setRemoteAuthType] = useState<"password" | "private_key">("password"); const [remoteSecret, setRemoteSecret] = useState(""); const [remotePassphrase, setRemotePassphrase] = useState(""); const 
  [remoteNotes, setRemoteNotes] = useState(""); const [remoteError, setRemoteError] = useState<string | null>(null); const [remoteMessage, setRemoteMessage] = useState<string | null>(null); const 
  [remoteLoading, setRemoteLoading] = useState(false); const [isSavingTarget, setIsSavingTarget] = useState(false);

  // Execution options
  const [shell, setShell] = useState<"bash" | "zsh" | "powershell" | "sh" | "cmd">("bash");
  const [isInteractive, setIsInteractive] = useState(false);
  const [useDocker, setUseDocker] = useState(false);
  const [dockerImage, setDockerImage] = useState("node:20-alpine");
  const [pendingConfirmation, setPendingConfirmation] = useState<{ command: string; reason?: string } | null>(null);

  // ===== Files UI style hardening (fix global CSS overriding text color) =====
const filesBtn =
  "px-2 py-1 rounded border border-white/10 hover:border-white/20 disabled:opacity-50 " +
  "!text-gray-200 !bg-gray-800/40 hover:!bg-gray-700/50";

const filesBtnPrimary =
  "px-3 py-1 rounded border border-white/10 hover:border-white/20 disabled:opacity-50 " +
  "!text-gray-100 !bg-gray-800 hover:!bg-gray-700";

const filesInput =
  "w-full px-2 py-1 rounded border border-white/10 !bg-gray-900/60 " +
  "!text-gray-200 placeholder:!text-gray-500 outline-none";


  // Files tab state
  const [filePath, setFilePath] = useState<string>("."); 
  const [fileListing, setFileListing] = useState<
    Array<{ name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean }>
  >([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState<string>("");
  const [filesError, setFilesError] = useState<string | null>(null);

  // ===== REQ-001: Files Navigation (UX) =====
const [filesPathHistory, setFilesPathHistory] = useState<string[]>(["."]);
const [filesHistoryIndex, setFilesHistoryIndex] = useState<number>(0);

const filePathRef = useRef(filePath);
useEffect(() => { filePathRef.current = filePath; }, [filePath]);

const filesHistoryIndexRef = useRef(filesHistoryIndex);
useEffect(() => { filesHistoryIndexRef.current = filesHistoryIndex; }, [filesHistoryIndex]);

const normalizeFsPath = useCallback(
  (raw: string) => (raw || ".").replace(/\\+/g, "/").replace(/\/+/g, "/"),
  []
);

const getParentFsPath = useCallback(
  (p: string) => {
    const norm = normalizeFsPath(p || ".");
    if (norm === "." || norm === "./") return ".";
    const cleaned = norm.replace(/^\.\//, "");
    const parts = cleaned.split("/").filter(Boolean);
    parts.pop();
    return parts.length === 0 ? "." : "./" + parts.join("/");
  },
  [normalizeFsPath]
);  

  const terminalRef = useRef<HTMLDivElement>(null);

  const isRemoteSession = state.sessionType === "remote";
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRemoteSession && activeTab !== "terminal") {
      setActiveTab("terminal");
    }
  }, [isRemoteSession, activeTab]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [state.lines]);

  // Auto-focus input
  useEffect(() => {
    if (state.status === "active" && inputRef.current && !pendingConfirmation) {
      inputRef.current.focus();
    }
  }, [state.status, pendingConfirmation]);

  // Load saved remote targets once
  useEffect(() => {
    fetchRemoteTargets();
  }, [fetchRemoteTargets]);

  useEffect(() => {
    if (!remoteMessage) return;
    const timer = setTimeout(() => setRemoteMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [remoteMessage]);

  const handleStartLocalSession = useCallback(async () => {
    await startLocalSession();
  }, [startLocalSession]);

  const handleManualRemoteConnect = useCallback(async () => {
    setRemoteError(null);
    if (!remoteHost.trim() || !remoteUsername.trim() || !remoteSecret.trim()) {
      setRemoteError("Host, username, and secret are required");
      return;
    }

    setRemoteLoading(true);
    try {
      await startRemoteSession({
        host: remoteHost.trim(),
        port: parseInt(remotePort, 10) || 22,
        username: remoteUsername.trim(),
        password: remoteAuthType === "password" ? remoteSecret : undefined,
        privateKey: remoteAuthType === "private_key" ? remoteSecret : undefined,
        passphrase: remoteAuthType === "private_key" && remotePassphrase.trim() ? remotePassphrase.trim() : undefined,
      });
      setRemoteSecret("");
      setRemotePassphrase("");
      setRemoteError(null);
      setRemoteMessage("Remote session started");
    } catch (error: any) {
      setRemoteError(error.message || "Failed to start remote session");
      setRemoteMessage(null);
    } finally {
      setRemoteLoading(false);
    }
  }, [remoteHost, remotePort, remoteUsername, remoteSecret, remoteAuthType, remotePassphrase, startRemoteSession]);

  const handleSaveRemoteTarget = useCallback(async () => {
    setRemoteError(null);
    if (!remoteHost.trim() || !remoteUsername.trim() || !remoteSecret.trim()) {
      setRemoteError("All fields are required to save a target");
      return;
    }

    setIsSavingTarget(true);
    try {
      await createRemoteTarget({
        name: remoteHost.trim(),
        host: remoteHost.trim(),
        port: parseInt(remotePort, 10) || 22,
        username: remoteUsername.trim(),
        authType: remoteAuthType,
        secret: remoteSecret,
        notes: remoteNotes.trim() || undefined,
      });
      setRemoteNotes("");
      setRemoteSecret("");
      setRemotePassphrase("");
      setRemoteError(null);
      setRemoteMessage("Target guardado");
    } catch (error: any) {
      setRemoteError(error.message || "Failed to save target");
      setRemoteMessage(null);
    } finally {
      setIsSavingTarget(false);
    }
  }, [remoteHost, remotePort, remoteUsername, remoteSecret, remoteAuthType, remoteNotes, createRemoteTarget]);

  const handleConnectTarget = useCallback(async (targetId: string) => {
    setRemoteError(null);
    setRemoteLoading(true);
    try {
      await startRemoteSessionFromTarget(targetId);
      const target = remoteTargets.find((t) => t.id === targetId);
      setRemoteError(null);
      setRemoteMessage(target ? `Conectado a ${target.name}` : "Remote session started");
    } catch (error: any) {
      setRemoteError(error.message || "Failed to connect to remote target");
      setRemoteMessage(null);
    } finally {
      setRemoteLoading(false);
    }
  }, [startRemoteSessionFromTarget, remoteTargets]);

  const handleDeleteTarget = useCallback(async (targetId: string) => {
    const shouldDelete = window.confirm("Delete this remote target?");
    if (!shouldDelete) return;
    try {
      await deleteRemoteTarget(targetId);
      setRemoteMessage("Target eliminado");
    } catch (error: any) {
      setRemoteError(error.message || "Failed to delete target");
      setRemoteMessage(null);
    }
  }, [deleteRemoteTarget]);
 
  const loadFileListing = useCallback(
    async (pathToLoad: string, mode: "push" | "history" = "push") => {
      if (isRemoteSession) {
        setFilesError("File explorer is only available for local sessions");
        setFileListing([]);
        return;
      }
      if (!state.sessionId) {
        setFilesError("Start a session to browse files");
        return;
      }

      const normalized = normalizeFsPath(pathToLoad || ".");
      setIsLoadingFiles(true);
      setFilesError(null);

      const prevPath = filePathRef.current;

      try {
        const result = await fileOperation({ type: "list", path: normalized });

        if (!result?.success) throw new Error(result?.error || "Failed to list files");

        setFileListing(result.data || []);
        setFilePath(normalized);
        setSelectedFile(null);
        setSelectedFileContent("");

        // history push SOLO si corresponde
        if (mode === "push" && normalized !== prevPath) {
          setFilesPathHistory((prev) => {
            const idx = filesHistoryIndexRef.current;
            const trimmed = prev.slice(0, idx + 1);
            return [...trimmed, normalized];
          });
          setFilesHistoryIndex((i) => i + 1);
        }
      } catch (e: any) {
        setFilesError(e?.message || "Failed to list files");
        setFileListing([]);
        setFilePath(prevPath); // vuelve para evitar “parpadeo”
      } finally {
        setIsLoadingFiles(false);
      }
    },
    [fileOperation, state.sessionId, isRemoteSession, normalizeFsPath]
  );

  const handleOpenFile = useCallback(async (name: string) => {
    if (isRemoteSession) return;
    if (!state.sessionId) return;

    const normalized = `${filePath}/${name}`.replace(/\\+/g, "/");
    try {
      const result = await fileOperation({ type: "read", path: normalized });
      if (!result?.success) {
        throw new Error(result?.error || "Failed to read file");
      }
      setSelectedFile(normalized);
      setSelectedFileContent(result.data || "");
    } catch (error: any) {
      setFilesError(error.message || "Failed to open file");
      setSelectedFile(normalized);
      setSelectedFileContent("");
    }
  }, [fileOperation, state.sessionId, filePath, isRemoteSession]);

  useEffect(() => {
    if (state.status !== "active" || !state.sessionId) {
      setFileListing([]);
      setFilePath(".");
      setSelectedFile(null);
      setSelectedFileContent("");
      return;
    }
    if (isRemoteSession) {
      setFileListing([]);
      setSelectedFile(null);
      setSelectedFileContent("");
      return;
    }
    setFilesPathHistory(["."]);
    setFilesHistoryIndex(0);
    loadFileListing(".");
  }, [state.status, state.sessionId, isRemoteSession, loadFileListing]);

  const handleExecuteCommand = useCallback(async (overrideCmd?: string, confirm: boolean = false) => {
    const cmd = overrideCmd || inputValue.trim();
    if (!cmd) return;

    if (!overrideCmd) {
      setCommandHistory((prev) => [...prev, cmd]);
      setHistoryIndex(-1);
      setInputValue("");
    }

    // Handle built-in commands
    if (cmd === "clear" || cmd === "cls") {
      clearOutput();
      return;
    }

    if (cmd === "exit") {
      await closeSession();
      return;
    }

    if (!isRemoteSession && cmd === "sysinfo") {
      const info = await getSystemInfo();
      if (info) {
        setSystemInfo(info);
        setShowSystemInfo(true);
      }
      return;
    }

    if (!isRemoteSession && (cmd === "ps" || cmd === "processes")) {
      const data = await listProcesses();
      if (data?.processes) {
        setProcesses(data.processes);
        setShowProcesses(true);
      }
      return;
    }

    const result: any = await executeCommand(cmd, {
      shell,
      interactive: isInteractive,
      inDocker: useDocker,
      dockerImage: useDocker ? dockerImage : undefined,
      confirmDangerous: confirm,
    });

    if (result && result.requiresConfirmation) {
      setPendingConfirmation({ command: cmd, reason: result.reason });
    } else if (pendingConfirmation) {
      setPendingConfirmation(null);
    }

  }, [inputValue, executeCommand, clearOutput, closeSession, getSystemInfo, listProcesses, shell, isInteractive, useDocker, dockerImage, pendingConfirmation, isRemoteSession]);

  const confirmDangerousCommand = useCallback(() => {
    if (pendingConfirmation) {
      handleExecuteCommand(pendingConfirmation.command, true);
    }
  }, [pendingConfirmation, handleExecuteCommand]);

  const cancelDangerousCommand = useCallback(() => {
    if (pendingConfirmation) {
      setPendingConfirmation(null);
    }
  }, [pendingConfirmation]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleExecuteCommand();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setInputValue(commandHistory[commandHistory.length - 1 - newIndex] || "");
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInputValue(commandHistory[commandHistory.length - 1 - newIndex] || "");
      } else {
        setHistoryIndex(-1);
        setInputValue("");
      }
    } else if (e.key === "c" && e.ctrlKey) {
      setInputValue("");
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      clearOutput();
    }
  }, [handleExecuteCommand, commandHistory, historyIndex, clearOutput]);

  const handleRunScript = useCallback(async () => {
    if (!scriptCode.trim() || isRemoteSession) return;
    await executeScript(scriptLanguage, scriptCode, { shell });
  }, [executeScript, scriptLanguage, scriptCode, shell, isRemoteSession]);

  const handleKillProcess = useCallback(async (pid: number) => {
    await killProcess(pid);
    const data = await listProcesses();
    if (data?.processes) {
      setProcesses(data.processes);
    }
  }, [killProcess, listProcesses]);

  const getLineColor = (type: TerminalLine["type"]): string => {
    switch (type) {
      case "input": return "text-cyan-400";
      case "stdout": return "text-gray-200";
      case "stderr": return "text-red-400";
      case "system": return "text-yellow-400";
      case "error": return "text-red-500 font-bold";
      default: return "text-gray-300";
    }
  };

  if (state.status === "idle" || state.status === "error") {
    return (
      <div className="h-full w-full bg-gray-950 p-6 overflow-y-auto">
        <div className="max-w-5xl mx-auto space-y-8">
          <div className="text-center space-y-2">
            <div className="text-4xl">{">"}_</div>
            <h2 className="text-2xl font-bold text-white">Terminal Control</h2>
            <p className="text-gray-400">
              Ejecuta comandos locales o conecta tus servidores vía SSH directo desde el panel.
            </p>
            {state.error && <p className="text-red-400 text-sm">{state.error}</p>}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 flex flex-col gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Sesión local</h3>
                <p className="text-sm text-gray-400">
                  Ejecuta comandos dentro del contenedor del servidor de Iliagpt. Usa PTY, Docker y el explorador de archivos.
                </p>
              </div>
              <button
                onClick={handleStartLocalSession}
                className="px-5 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
              >
                Iniciar sesión local
              </button>
              <ul className="text-xs text-gray-500 space-y-1">
                <li>• Acceso completo al filesystem del contenedor.</li>
                <li>• Scripts pre-armados en pestaña Scripts.</li>
                <li>• Explorer de archivos y gestor de procesos.</li>
              </ul>
            </div>

            <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white">SSH / Sesiones remotas</h3>
                <p className="text-sm text-gray-400">
                  Conecta servidores externos (VPS, bare metal, etc.). Las credenciales se cifran con REMOTE_SHELL_SECRET.
                </p>
              </div>

              {remoteError && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/40 rounded px-3 py-2">
                  {remoteError}
                </div>
              )}
              {remoteMessage && (
                <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded px-3 py-2">
                  {remoteMessage}
                </div>
              )}

              <div className="grid gap-3 text-left">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    value={remoteHost}
                    onChange={(e) => setRemoteHost(e.target.value)}
                    placeholder="Host o IP"
                    className="px-3 py-2 rounded border border-gray-700 bg-gray-900 text-sm text-gray-100 outline-none"
                    spellCheck={false}
                  />
                  <input
                    value={remoteUsername}
                    onChange={(e) => setRemoteUsername(e.target.value)}
                    placeholder="Usuario"
                    className="px-3 py-2 rounded border border-gray-700 bg-gray-900 text-sm text-gray-100 outline-none"
                    spellCheck={false}
                  />
                  <input
                    value={remotePort}
                    onChange={(e) => setRemotePort(e.target.value)}
                    placeholder="Puerto"
                    className="px-3 py-2 rounded border border-gray-700 bg-gray-900 text-sm text-gray-100 outline-none"
                  />
                  <select
                    value={remoteAuthType}
                    onChange={(e) => setRemoteAuthType(e.target.value as any)}
                    className="px-3 py-2 rounded border border-gray-700 bg-gray-900 text-sm text-gray-100 outline-none"
                  >
                    <option value="password">Contraseña</option>
                    <option value="private_key">Clave privada</option>
                  </select>
                </div>

                {remoteAuthType === "password" ? (
                  <input
                    type="password"
                    value={remoteSecret}
                    onChange={(e) => setRemoteSecret(e.target.value)}
                    placeholder="Contraseña"
                    className="px-3 py-2 rounded border border-gray-700 bg-gray-900 text-sm text-gray-100 outline-none"
                  />
                ) : (
                  <textarea
                    value={remoteSecret}
                    onChange={(e) => setRemoteSecret(e.target.value)}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    className="px-3 py-2 h-28 rounded border border-gray-700 bg-gray-900 text-sm text-gray-100 outline-none"
                    spellCheck={false}
                  />
                )}

                {remoteAuthType === "private_key" && (
                  <input
                    type="password"
                    value={remotePassphrase}
                    onChange={(e) => setRemotePassphrase(e.target.value)}
                    placeholder="Passphrase (opcional)"
                    className="px-3 py-2 rounded border border-gray-700 bg-gray-900 text-sm text-gray-100 outline-none"
                  />
                )}

                <textarea
                  value={remoteNotes}
                  onChange={(e) => setRemoteNotes(e.target.value)}
                  placeholder="Notas (se guardan junto al target opcionalmente)"
                  className="px-3 py-2 rounded border border-gray-700 bg-gray-900 text-sm text-gray-100 outline-none"
                  rows={2}
                  spellCheck={false}
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleManualRemoteConnect}
                  disabled={remoteLoading}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900/50 text-white transition-colors"
                >
                  {remoteLoading ? "Conectando..." : "Conectar ahora"}
                </button>
                <button
                  onClick={handleSaveRemoteTarget}
                  disabled={isSavingTarget}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 hover:bg-gray-700 disabled:opacity-60 text-white transition-colors"
                >
                  {isSavingTarget ? "Guardando..." : "Guardar target"}
                </button>
              </div>

              <div className="border-t border-gray-800 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-200">Targets guardados</h4>
                  <button
                    onClick={fetchRemoteTargets}
                    className="text-xs text-gray-400 hover:text-white"
                  >
                    Refrescar
                  </button>
                </div>
                {remoteTargets.length === 0 ? (
                  <p className="text-xs text-gray-500">Aún no hay targets guardados.</p>
                ) : (
                  <div className="space-y-3 max-h-52 overflow-y-auto pr-1">
                    {remoteTargets.map((target) => (
                      <div key={target.id} className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm text-white font-semibold">{target.name}</p>
                            <p className="text-xs text-gray-400">
                              {target.username}@{target.host}
                              {target.port ? `:${target.port}` : ""}
                            </p>
                            {target.notes && (
                              <p className="text-xs text-gray-500 mt-1">{target.notes}</p>
                            )}
                            {target.lastConnectedAt && (
                              <p className="text-[10px] text-gray-600 mt-1">
                                Último uso: {new Date(target.lastConnectedAt).toLocaleString()}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col gap-2">
                            <button
                              onClick={() => handleConnectTarget(target.id)}
                              disabled={remoteLoading}
                              className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white"
                            >
                              Conectar
                            </button>
                            <button
                              onClick={() => handleDeleteTarget(target.id)}
                              className="px-3 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-200"
                            >
                              Borrar
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full bg-gray-950 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500 cursor-pointer" onClick={closeSession} title="Close" />
            <div className="w-3 h-3 rounded-full bg-yellow-500 cursor-pointer" onClick={clearOutput} title="Clear" />
            <div className="w-3 h-3 rounded-full bg-green-500" />
          </div>
          <div className="flex flex-col">
            <span className="text-gray-400 text-sm font-mono">
              {state.cwd || "~"}
            </span>
            {isRemoteSession && state.remoteContext && (
              <span className="text-[11px] text-purple-300 bg-purple-500/10 border border-purple-500/30 rounded px-1 py-0.5 mt-1">
                Remote · {state.remoteContext.name || state.remoteContext.host} ({state.remoteContext.username}@{state.remoteContext.host})
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Options Toggles */}
          {activeTab === "terminal" && (
            <div className="flex items-center gap-2 mr-2 border-r border-gray-700 pr-2">
              {/* Shell Selector */}
              <div className="flex items-center gap-1 text-[10px] text-gray-400">
                <span className="uppercase">Shell:</span>
                <select
                  value={shell}
                  onChange={(e) => setShell(e.target.value as any)}
                  className="bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-[10px] text-gray-200 outline-none"
                >
                  <option value="bash">bash</option>
                  <option value="zsh">zsh</option>
                  <option value="powershell">powershell</option>
                  <option value="sh">sh</option>
                  <option value="cmd">cmd</option>
                </select>
              </div>
              <button
                onClick={() => setIsInteractive(!isInteractive)}
                className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                  isInteractive
                    ? "bg-purple-900/50 border-purple-500 text-purple-300"
                    : "bg-gray-800 border-gray-600 text-gray-400"
                }`}
                title="Interactive Mode (PTY)"
              >
                PTY
              </button>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setUseDocker(!useDocker)}
                  className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                    useDocker
                      ? "bg-blue-900/50 border-blue-500 text-blue-300"
                      : "bg-gray-800 border-gray-600 text-gray-400"
                  }`}
                  title="Run in Docker Container"
                >
                  Docker
                </button>
                {useDocker && (
                  <input
                    type="text"
                    value={dockerImage}
                    onChange={(e) => setDockerImage(e.target.value)}
                    className="w-24 bg-gray-800 text-gray-300 text-[10px] px-1 py-0.5 rounded border border-gray-600 outline-none"
                    placeholder="Image"
                  />
                )}
              </div>
            </div>
          )}

          {/* Tab Switcher */}
          {(["terminal", "scripts", "files"] as const).map((tab) => {
            const disabled = isRemoteSession && tab !== "terminal";
            return (
              <button
                key={tab}
                onClick={() => !disabled && setActiveTab(tab)}
                disabled={disabled}
                className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                  activeTab === tab
                    ? "bg-blue-600 text-white"
                    : disabled
                      ? "bg-gray-800 text-gray-600 cursor-not-allowed"
                      : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Terminal Tab */}
      {activeTab === "terminal" && (
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Output */}
          <div
            ref={terminalRef}
            className="flex-1 overflow-y-auto p-4 font-mono text-sm leading-relaxed"
            onClick={() => inputRef.current?.focus()}
          >
            {state.lines.map((line) => (
              <div key={line.id} className={`${getLineColor(line.type)} whitespace-pre-wrap break-all`}>
                {line.content}
              </div>
            ))}
            {state.isExecuting && (
              <div className="text-yellow-400 animate-pulse">Running...</div>
            )}
          </div>

          {/* Input */}
          <div className="flex items-center px-4 py-3 bg-gray-900 border-t border-gray-800">
            <span className="text-green-400 font-mono text-sm mr-2">$</span>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={state.isExecuting ? "Waiting for command to finish..." : "Type a command..."}
              disabled={state.isExecuting}
              className="flex-1 bg-transparent text-gray-200 font-mono text-sm outline-none placeholder-gray-600 disabled:opacity-50"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
      )}

      {/* Scripts Tab */}
      {activeTab === "scripts" && (
        isRemoteSession ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
            Las herramientas de scripts sólo están disponibles en sesiones locales.
          </div>
        ) : (
          <div className="flex flex-col flex-1 p-4 overflow-hidden">
            <div className="flex items-center gap-3 mb-3">
              <select
                value={scriptLanguage}
                onChange={(e) => setScriptLanguage(e.target.value)}
                className="px-3 py-1.5 bg-gray-800 text-gray-200 rounded border border-gray-700 text-sm"
              >
                <option value="python">Python</option>
                <option value="javascript">JavaScript</option>
                <option value="typescript">TypeScript</option>
                <option value="bash">Bash</option>
                <option value="ruby">Ruby</option>
                <option value="go">Go</option>
                <option value="php">PHP</option>
              </select>
              <button
                onClick={handleRunScript}
                disabled={state.isExecuting || !scriptCode.trim() || isRemoteSession}
                className="px-4 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 text-white rounded text-sm font-medium transition-colors"
              >
                Run Script
              </button>
            </div>
            <textarea
              value={scriptCode}
              onChange={(e) => setScriptCode(e.target.value)}
              placeholder={`Enter your ${scriptLanguage} code here...`}
              className="flex-1 p-3 bg-gray-900 text-gray-200 font-mono text-sm rounded border border-gray-700 resize-none outline-none focus:border-blue-500"
              spellCheck={false}
            />
          </div>
        )
      )}

      {/* Files Tab */}
      {activeTab === "files" && (
        isRemoteSession ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
            El explorador de archivos sólo está disponible en sesiones locales.
          </div>
        ) : (
          <div className="flex flex-1 p-4 gap-4 overflow-hidden">
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 font-mono">Path:</span>
                  <input
                    value={filePath}
                    onChange={(e) => setFilePath(e.target.value)}
                    onBlur={() => void loadFileListing(filePath || ".")}
                    className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs !text-gray-200 w-64 outline-none placeholder:!text-gray-500"
                    spellCheck={false}
                  />
                  <button
                    onClick={() => void loadFileListing(filePath || ".")}
                    className={filesBtnPrimary}
                  >
                    Refresh
                  </button>
                </div>
              </div>
		{/* Toolbar Files (REQ-001) */}
		<div className="flex flex-col gap-2 mb-3">
		  <div className="flex items-center gap-2">
		    <button
		      className={filesBtn}
		      onClick={() => {
		        if (filesHistoryIndex <= 0) return;
		        const next = filesHistoryIndex - 1;
		        setFilesHistoryIndex(next);
		        void loadFileListing(filesPathHistory[next], "history");
		      }}
		      disabled={filesHistoryIndex <= 0 || isLoadingFiles}
		    >
		      ⬅
		    </button>

		    <button
		      className={filesBtn}
		      onClick={() => {
		        if (filesHistoryIndex >= filesPathHistory.length - 1) return;
		        const next = filesHistoryIndex + 1;
		        setFilesHistoryIndex(next);
		        void loadFileListing(filesPathHistory[next], "history");
		      }}
		      disabled={filesHistoryIndex >= filesPathHistory.length - 1 || isLoadingFiles}
		    >
		      ➡
		    </button>

		    <button
		      className={filesBtn}
		      onClick={() => void loadFileListing(getParentFsPath(filePath))}
		      disabled={isLoadingFiles || filePath === "."}
		    >
		      ⬆ Subir
		    </button>

		    <div className="text-xs opacity-80 !text-gray-300">Ruta: {filePath}</div>
		  </div>

		  <div className="flex items-center gap-2">
		    <input
		      className={filesInput}
		      value={filePath}
		      onChange={(e) => setFilePath(e.target.value)}
		      onKeyDown={(e) => {
		        if (e.key === "Enter") void loadFileListing(filePath || ".");
		      }}
                      placeholder="Pega una ruta (ej: ./server o /server)"
                      disabled={isLoadingFiles}
		    />
		    <button
		      className={filesBtnPrimary}
		      onClick={() => void loadFileListing(filePath || ".")}
		      disabled={isLoadingFiles}
		    >
		      Ir
		    </button>
		  </div>
		</div> 

              <div className="flex-1 overflow-y-auto border border-gray-800 rounded bg-gray-900">
                {isLoadingFiles && (
                  <div className="p-2 text-xs text-gray-400">Loading...</div>
                )}
                {filesError && !isLoadingFiles && (
                  <div className="p-2 text-xs text-red-400">{filesError}</div>
                )}
                {!isLoadingFiles && !filesError && (
                  <table className="w-full text-xs font-mono"> <thead className="bg-gray-800 text-gray-300">
                      <tr>
                        <th className="text-left px-2 py-1 w-6">T</th>
                        <th className="text-left px-2 py-1">Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fileListing.map((entry) => ( <tr
                          key={entry.name}
                          className="hover:bg-gray-800 cursor-pointer"
                          onClick={() => {
                            if (entry.isDirectory) {
                              void loadFileListing(normalizeFsPath(`${filePath}/${entry.name}`));
                            } else {
                              void handleOpenFile(entry.name);
                            } 
                          }}
                        >
                          <td className="px-2 py-1 text-center text-gray-400">
                            {entry.isDirectory ? "d" : entry.isSymlink ? "l" : "-"}
                          </td>
                          <td className="px-2 py-1 text-cyan-300">{entry.name}</td>
                        </tr>
                      ))}
                      {fileListing.length === 0 && !isLoadingFiles && !filesError && (
                        <tr>
                          <td colSpan={2} className="px-2 py-2 text-center text-gray-500">
                            Directory is empty
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="w-1/2 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400 font-mono">
                  {selectedFile ? `File: ${selectedFile}` : "Select a file to preview"}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto border border-gray-800 rounded bg-gray-900 p-2">
                <pre className="text-xs text-gray-200 whitespace-pre-wrap break-all font-mono">
                  {selectedFileContent || (selectedFile ? "(empty file)" : "")}
                </pre>
              </div>
            </div>
          </div>
        )
      )}

      {/* System Info Modal */}
      {showSystemInfo && systemInfo && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">System Information</h3>
              <button onClick={() => setShowSystemInfo(false)} className="text-gray-400 hover:text-white">
                Close
              </button>
            </div>
            <div className="space-y-4 text-sm font-mono">
              <div>
                <h4 className="text-yellow-400 font-bold mb-1">OS</h4>
                <p className="text-gray-300">
                  {systemInfo.os?.platform} {systemInfo.os?.release} ({systemInfo.os?.arch})
                </p>
                <p className="text-gray-400">Hostname: {systemInfo.os?.hostname}</p>
              </div>
              <div>
                <h4 className="text-yellow-400 font-bold mb-1">CPU</h4>
                <p className="text-gray-300">{systemInfo.cpu?.model}</p>
                <p className="text-gray-400">{systemInfo.cpu?.cores} cores @ {systemInfo.cpu?.speed} MHz</p>
              </div>
              <div>
                <h4 className="text-yellow-400 font-bold mb-1">Memory</h4>
                <p className="text-gray-300">
                  {Math.round(systemInfo.memory?.used / 1024 / 1024 / 1024 * 100) / 100} GB /
                  {" "}{Math.round(systemInfo.memory?.total / 1024 / 1024 / 1024 * 100) / 100} GB
                  ({systemInfo.memory?.usagePercent}%)
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Process Manager Modal */}
      {showProcesses && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-lg p-6 max-w-3xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Running Processes</h3>
              <button onClick={() => setShowProcesses(false)} className="text-gray-400 hover:text-white">
                Close
              </button>
            </div>
            <table className="w-full text-sm font-mono">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="text-left py-1 pr-4">PID</th>
                  <th className="text-left py-1 pr-4">Name</th>
                  <th className="text-right py-1 pr-4">CPU%</th>
                  <th className="text-right py-1 pr-4">MEM%</th>
                  <th className="text-center py-1">Action</th>
                </tr>
              </thead>
              <tbody>
                {processes.slice(0, 30).map((proc) => (
                  <tr key={proc.pid} className="text-gray-300 border-b border-gray-800 hover:bg-gray-800">
                    <td className="py-1 pr-4">{proc.pid}</td>
                    <td className="py-1 pr-4 truncate max-w-[200px]">{proc.name}</td>
                    <td className="py-1 pr-4 text-right">{proc.cpu}</td>
                    <td className="py-1 pr-4 text-right">{proc.memory}</td>
                    <td className="py-1 text-center">
                      <button
                        onClick={() => handleKillProcess(proc.pid)}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        Kill
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
