import { useState, useRef, useCallback, useEffect } from "react";
import { apiFetch } from "@/lib/apiClient";

interface BrowserTab {
  id: string;
  url: string;
  title: string;
  active: boolean;
}

interface BrowserSessionState {
  sessionId: string | null;
  status: "idle" | "connecting" | "active" | "closed" | "error";
  profileId: string;
  tabs: BrowserTab[];
  screenshot: string | null;
  currentUrl: string;
  isLoading: boolean;
  error: string | null;
  networkLogs: any[];
  actionLog: string[];
}

const BROWSER_PROFILES = [
  { id: "chrome-desktop", name: "Chrome Desktop", icon: "C", browser: "chromium" },
  { id: "firefox-desktop", name: "Firefox Desktop", icon: "F", browser: "firefox" },
  { id: "safari-desktop", name: "Safari Desktop", icon: "S", browser: "webkit" },
  { id: "mobile-iphone", name: "iPhone Safari", icon: "i", browser: "webkit" },
  { id: "mobile-android", name: "Android Chrome", icon: "A", browser: "chromium" },
];

const initialState: BrowserSessionState = {
  sessionId: null,
  status: "idle",
  profileId: "chrome-desktop",
  tabs: [],
  screenshot: null,
  currentUrl: "",
  isLoading: false,
  error: null,
  networkLogs: [],
  actionLog: [],
};

export function BrowserControlPanel() {
  const [state, setState] = useState<BrowserSessionState>(initialState);
  const [urlInput, setUrlInput] = useState("");
  const [selectorInput, setSelectorInput] = useState("");
  const [typeText, setTypeText] = useState("");
  const [goalInput, setGoalInput] = useState("");
  const [extractDesc, setExtractDesc] = useState("");
  const [activePanel, setActivePanel] = useState<"actions" | "network" | "auto" | "extract">("actions");
  const screenshotInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const addLog = useCallback((message: string) => {
    setState((prev) => ({
      ...prev,
      actionLog: [...prev.actionLog, `[${new Date().toLocaleTimeString()}] ${message}`],
    }));
  }, []);

  const fetchScreenshot = useCallback(async (sessionId: string) => {
    try {
      const res = await apiFetch(`/api/browser-control/sessions/${sessionId}/screenshot`);
      if (res.ok) {
        const { screenshot } = await res.json();
        setState((prev) => prev.sessionId === sessionId ? { ...prev, screenshot } : prev);
      }
    } catch {
      // Ignore
    }
  }, []);

  const fetchTabs = useCallback(async (sessionId: string) => {
    try {
      const res = await apiFetch(`/api/browser-control/sessions/${sessionId}/tabs`);
      if (res.ok) {
        const { tabs } = await res.json();
        setState((prev) => prev.sessionId === sessionId ? { ...prev, tabs } : prev);
      }
    } catch {
      // Ignore
    }
  }, []);

  // Start screenshot polling
  const startPolling = useCallback((sessionId: string) => {
    if (screenshotInterval.current) clearInterval(screenshotInterval.current);
    fetchScreenshot(sessionId);
    screenshotInterval.current = setInterval(() => {
      fetchScreenshot(sessionId);
    }, 2000);
  }, [fetchScreenshot]);

  const stopPolling = useCallback(() => {
    if (screenshotInterval.current) {
      clearInterval(screenshotInterval.current);
      screenshotInterval.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  /** Create a new browser session */
  const createSession = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, status: "connecting", isLoading: true }));

      const res = await apiFetch("/api/browser-control/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: state.profileId }),
      });

      if (!res.ok) throw new Error((await res.json()).error);
      const { sessionId } = await res.json();

      setState((prev) => ({
        ...prev,
        sessionId,
        status: "active",
        isLoading: false,
        actionLog: [`[${new Date().toLocaleTimeString()}] Session started with profile: ${state.profileId}`],
      }));

      startPolling(sessionId);
      fetchTabs(sessionId);
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        status: "error",
        isLoading: false,
        error: error.message,
      }));
    }
  }, [state.profileId, startPolling, fetchTabs]);

  /** Close session */
  const closeSession = useCallback(async () => {
    if (!state.sessionId) return;
    stopPolling();
    try {
      await apiFetch(`/api/browser-control/sessions/${state.sessionId}`, { method: "DELETE" });
    } catch {
      // Ignore
    }
    setState(initialState);
  }, [state.sessionId, stopPolling]);

  /** Navigate to URL */
  const navigate = useCallback(async () => {
    if (!state.sessionId || !urlInput.trim()) return;
    setState((prev) => ({ ...prev, isLoading: true }));
    addLog(`Navigating to: ${urlInput}`);

    try {
      const res = await apiFetch(`/api/browser-control/sessions/${state.sessionId}/navigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput }),
      });
      const result = await res.json();
      setState((prev) => ({
        ...prev,
        currentUrl: result.url || urlInput,
        isLoading: false,
      }));
      addLog(`Navigated to: ${result.url || urlInput} (status: ${result.status})`);
      fetchScreenshot(state.sessionId!);
      fetchTabs(state.sessionId!);
    } catch (error: any) {
      addLog(`Navigation error: ${error.message}`);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [state.sessionId, urlInput, addLog, fetchScreenshot, fetchTabs]);

  /** Click on element */
  const clickElement = useCallback(async () => {
    if (!state.sessionId || !selectorInput.trim()) return;
    addLog(`Clicking: ${selectorInput}`);

    try {
      const res = await apiFetch(`/api/browser-control/sessions/${state.sessionId}/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selector: selectorInput }),
      });
      const result = await res.json();
      addLog(result.success ? `Clicked: ${selectorInput}` : `Click failed: ${result.error}`);
      fetchScreenshot(state.sessionId!);
    } catch (error: any) {
      addLog(`Click error: ${error.message}`);
    }
  }, [state.sessionId, selectorInput, addLog, fetchScreenshot]);

  /** Type text */
  const typeInElement = useCallback(async () => {
    if (!state.sessionId || !selectorInput.trim() || !typeText) return;
    addLog(`Typing in: ${selectorInput}`);

    try {
      const res = await apiFetch(`/api/browser-control/sessions/${state.sessionId}/type`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selector: selectorInput, text: typeText, clear: true }),
      });
      const result = await res.json();
      addLog(result.success ? `Typed text in: ${selectorInput}` : `Type failed: ${result.error}`);
      fetchScreenshot(state.sessionId!);
    } catch (error: any) {
      addLog(`Type error: ${error.message}`);
    }
  }, [state.sessionId, selectorInput, typeText, addLog, fetchScreenshot]);

  /** Scroll page */
  const scrollPage = useCallback(async (direction: "up" | "down") => {
    if (!state.sessionId) return;
    try {
      await apiFetch(`/api/browser-control/sessions/${state.sessionId}/scroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, amount: 500 }),
      });
      addLog(`Scrolled ${direction}`);
      fetchScreenshot(state.sessionId!);
    } catch (error: any) {
      addLog(`Scroll error: ${error.message}`);
    }
  }, [state.sessionId, addLog, fetchScreenshot]);

  /** Navigation controls */
  const goBack = useCallback(async () => {
    if (!state.sessionId) return;
    try {
      await apiFetch(`/api/browser-control/sessions/${state.sessionId}/back`, { method: "POST" });
      addLog("Navigated back");
      fetchScreenshot(state.sessionId!);
    } catch (error: any) {
      addLog(`Back error: ${error.message}`);
    }
  }, [state.sessionId, addLog, fetchScreenshot]);

  const goForward = useCallback(async () => {
    if (!state.sessionId) return;
    try {
      await apiFetch(`/api/browser-control/sessions/${state.sessionId}/forward`, { method: "POST" });
      addLog("Navigated forward");
      fetchScreenshot(state.sessionId!);
    } catch (error: any) {
      addLog(`Forward error: ${error.message}`);
    }
  }, [state.sessionId, addLog, fetchScreenshot]);

  const reload = useCallback(async () => {
    if (!state.sessionId) return;
    try {
      await apiFetch(`/api/browser-control/sessions/${state.sessionId}/reload`, { method: "POST" });
      addLog("Page reloaded");
      fetchScreenshot(state.sessionId!);
    } catch (error: any) {
      addLog(`Reload error: ${error.message}`);
    }
  }, [state.sessionId, addLog, fetchScreenshot]);

  /** New tab */
  const newTab = useCallback(async (url?: string) => {
    if (!state.sessionId) return;
    try {
      await apiFetch(`/api/browser-control/sessions/${state.sessionId}/tabs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      addLog(`New tab opened${url ? `: ${url}` : ""}`);
      fetchTabs(state.sessionId!);
    } catch (error: any) {
      addLog(`New tab error: ${error.message}`);
    }
  }, [state.sessionId, addLog, fetchTabs]);

  /** Fetch network logs */
  const fetchNetworkLogs = useCallback(async () => {
    if (!state.sessionId) return;
    try {
      const res = await apiFetch(`/api/browser-control/sessions/${state.sessionId}/network`);
      const { logs } = await res.json();
      setState((prev) => ({ ...prev, networkLogs: logs || [] }));
    } catch {
      // Ignore
    }
  }, [state.sessionId]);

  /** Auto-navigate with LLM */
  const autoNavigate = useCallback(async () => {
    if (!state.sessionId || !goalInput.trim()) return;
    setState((prev) => ({ ...prev, isLoading: true }));
    addLog(`Starting autonomous navigation: "${goalInput}"`);

    try {
      const res = await apiFetch(`/api/browser-control/sessions/${state.sessionId}/auto-navigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goalInput, maxSteps: 15 }),
      });
      const result = await res.json();

      for (const step of result.steps || []) {
        addLog(`  Step: ${step}`);
      }

      addLog(result.success ? "Autonomous navigation completed successfully" : "Autonomous navigation did not fully succeed");
      setState((prev) => ({ ...prev, isLoading: false }));
      fetchScreenshot(state.sessionId!);
    } catch (error: any) {
      addLog(`Auto-navigate error: ${error.message}`);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [state.sessionId, goalInput, addLog, fetchScreenshot]);

  /** Extract data */
  const extractData = useCallback(async () => {
    if (!state.sessionId || !extractDesc.trim()) return;
    setState((prev) => ({ ...prev, isLoading: true }));
    addLog(`Extracting data: "${extractDesc}"`);

    try {
      const res = await apiFetch(`/api/browser-control/sessions/${state.sessionId}/extract-structured`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: extractDesc }),
      });
      const { data } = await res.json();
      addLog(`Extracted data: ${JSON.stringify(data, null, 2)}`);
      setState((prev) => ({ ...prev, isLoading: false }));
    } catch (error: any) {
      addLog(`Extract error: ${error.message}`);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [state.sessionId, extractDesc, addLog]);

  // ============================================
  // RENDER
  // ============================================

  if (state.status === "idle" || state.status === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-950 p-8 rounded-lg">
        <div className="text-center space-y-6 max-w-lg">
          <div className="text-4xl mb-2">Browser Control</div>
          <p className="text-gray-400">
            Control any browser with multi-tab management, DOM interaction,
            data extraction, network interception, and LLM-powered autonomous navigation.
          </p>

          {state.error && (
            <p className="text-red-400 text-sm">{state.error}</p>
          )}

          {/* Browser Profile Selection */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {BROWSER_PROFILES.map((profile) => (
              <button
                key={profile.id}
                onClick={() => setState((prev) => ({ ...prev, profileId: profile.id }))}
                className={`flex flex-col items-center p-3 rounded-lg border transition-colors ${
                  state.profileId === profile.id
                    ? "border-blue-500 bg-blue-500/10 text-white"
                    : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-500"
                }`}
              >
                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-800 text-lg font-bold mb-2">
                  {profile.icon}
                </div>
                <span className="text-xs">{profile.name}</span>
              </button>
            ))}
          </div>

          <button
            onClick={createSession}
            className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            Launch Browser
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-950 rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-800">
        {/* Nav buttons */}
        <button onClick={goBack} className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700" title="Back">
          {"<"}
        </button>
        <button onClick={goForward} className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700" title="Forward">
          {">"}
        </button>
        <button onClick={reload} className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700" title="Reload">
          R
        </button>

        {/* URL bar */}
        <div className="flex-1 flex items-center gap-2">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && navigate()}
            placeholder="Enter URL..."
            className="flex-1 px-3 py-1.5 bg-gray-800 text-gray-200 text-sm rounded border border-gray-700 outline-none focus:border-blue-500"
          />
          <button
            onClick={navigate}
            disabled={state.isLoading}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white text-sm rounded transition-colors"
          >
            Go
          </button>
        </div>

        {/* Tab controls */}
        <button onClick={() => newTab()} className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700" title="New Tab">
          +
        </button>
        <button onClick={closeSession} className="p-1.5 text-red-400 hover:text-red-300 rounded hover:bg-gray-700" title="Close Session">
          X
        </button>
      </div>

      {/* Tabs bar */}
      {state.tabs.length > 0 && (
        <div className="flex items-center gap-1 px-3 py-1 bg-gray-900/50 border-b border-gray-800 overflow-x-auto">
          {state.tabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex items-center gap-2 px-3 py-1 text-xs rounded cursor-pointer transition-colors max-w-[200px] ${
                tab.active ? "bg-gray-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
              onClick={async () => {
                if (!state.sessionId) return;
                await apiFetch(`/api/browser-control/sessions/${state.sessionId}/tabs/${tab.id}/activate`, { method: "POST" });
                fetchTabs(state.sessionId);
                fetchScreenshot(state.sessionId);
              }}
            >
              <span className="truncate">{tab.title || tab.url || "New Tab"}</span>
            </div>
          ))}
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Browser viewport */}
        <div className="flex-1 relative bg-white overflow-hidden">
          {state.screenshot ? (
            <img
              src={state.screenshot}
              alt="Browser view"
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              {state.isLoading ? "Loading..." : "Navigate to a URL to see the page"}
            </div>
          )}
          {state.isLoading && (
            <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500 animate-pulse" />
          )}
        </div>

        {/* Side panel */}
        <div className="w-80 flex flex-col bg-gray-900 border-l border-gray-800 overflow-hidden">
          {/* Panel tabs */}
          <div className="flex border-b border-gray-800">
            {(["actions", "auto", "extract", "network"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActivePanel(tab);
                  if (tab === "network") fetchNetworkLogs();
                }}
                className={`flex-1 px-2 py-2 text-xs font-medium transition-colors ${
                  activePanel === tab
                    ? "text-blue-400 border-b-2 border-blue-400"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {/* Actions Panel */}
            {activePanel === "actions" && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">CSS Selector</label>
                  <input
                    type="text"
                    value={selectorInput}
                    onChange={(e) => setSelectorInput(e.target.value)}
                    placeholder="#submit-btn, .login-form input"
                    className="w-full px-2 py-1.5 bg-gray-800 text-gray-200 text-sm rounded border border-gray-700 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={clickElement}
                    disabled={!selectorInput.trim()}
                    className="flex-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 text-white text-xs rounded"
                  >
                    Click
                  </button>
                  <button
                    onClick={() => scrollPage("up")}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded"
                  >
                    Scroll Up
                  </button>
                  <button
                    onClick={() => scrollPage("down")}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded"
                  >
                    Scroll Down
                  </button>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Text to Type</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={typeText}
                      onChange={(e) => setTypeText(e.target.value)}
                      placeholder="Text to enter..."
                      className="flex-1 px-2 py-1.5 bg-gray-800 text-gray-200 text-sm rounded border border-gray-700 outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={typeInElement}
                      disabled={!selectorInput.trim() || !typeText}
                      className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white text-xs rounded"
                    >
                      Type
                    </button>
                  </div>
                </div>

                {/* Action Log */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Action Log</label>
                  <div className="bg-gray-800 rounded p-2 max-h-60 overflow-y-auto">
                    {state.actionLog.length === 0 ? (
                      <p className="text-gray-500 text-xs">No actions yet</p>
                    ) : (
                      state.actionLog.map((log, i) => (
                        <div key={i} className="text-xs text-gray-300 font-mono py-0.5 whitespace-pre-wrap break-all">
                          {log}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Auto Navigation Panel */}
            {activePanel === "auto" && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Navigation Goal</label>
                  <textarea
                    value={goalInput}
                    onChange={(e) => setGoalInput(e.target.value)}
                    placeholder="Describe what you want to accomplish, e.g.: 'Go to Google, search for AI news, and extract the top 5 results'"
                    className="w-full px-2 py-1.5 bg-gray-800 text-gray-200 text-sm rounded border border-gray-700 outline-none focus:border-blue-500 resize-none h-24"
                  />
                </div>
                <button
                  onClick={autoNavigate}
                  disabled={state.isLoading || !goalInput.trim()}
                  className="w-full px-3 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-700 text-white text-sm rounded font-medium transition-colors"
                >
                  {state.isLoading ? "Navigating..." : "Start Autonomous Navigation"}
                </button>
                <p className="text-xs text-gray-500">
                  The AI agent will analyze the page and perform actions
                  step-by-step to achieve your goal.
                </p>
              </div>
            )}

            {/* Extract Panel */}
            {activePanel === "extract" && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">What to Extract</label>
                  <textarea
                    value={extractDesc}
                    onChange={(e) => setExtractDesc(e.target.value)}
                    placeholder="Describe the data you want, e.g.: 'Extract all product names, prices, and ratings from this page'"
                    className="w-full px-2 py-1.5 bg-gray-800 text-gray-200 text-sm rounded border border-gray-700 outline-none focus:border-blue-500 resize-none h-24"
                  />
                </div>
                <button
                  onClick={extractData}
                  disabled={state.isLoading || !extractDesc.trim()}
                  className="w-full px-3 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-700 text-white text-sm rounded font-medium transition-colors"
                >
                  {state.isLoading ? "Extracting..." : "Extract Data"}
                </button>
              </div>
            )}

            {/* Network Panel */}
            {activePanel === "network" && (
              <div className="space-y-2">
                <button
                  onClick={fetchNetworkLogs}
                  className="w-full px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded"
                >
                  Refresh Logs
                </button>
                <div className="space-y-1">
                  {state.networkLogs.length === 0 ? (
                    <p className="text-gray-500 text-xs">No network requests captured</p>
                  ) : (
                    state.networkLogs.slice(-50).map((log, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs font-mono py-0.5 border-b border-gray-800">
                        <span className={`font-bold ${
                          log.method === "GET" ? "text-green-400" :
                          log.method === "POST" ? "text-blue-400" :
                          log.method === "PUT" ? "text-yellow-400" :
                          log.method === "DELETE" ? "text-red-400" : "text-gray-400"
                        }`}>
                          {log.method}
                        </span>
                        <span className="text-gray-300 truncate flex-1" title={log.url}>
                          {new URL(log.url).pathname}
                        </span>
                        {log.status && (
                          <span className={`${log.status < 400 ? "text-green-400" : "text-red-400"}`}>
                            {log.status}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
