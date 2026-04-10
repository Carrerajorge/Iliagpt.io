import { Switch, Route, useLocation, useParams, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, useState, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { ModelAvailabilityProvider } from "@/contexts/ModelAvailabilityContext";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { SearchModal } from "@/components/search-modal";
import { ToolCatalog } from "@/components/tool-catalog";
import { BackgroundNotificationContainer } from "@/components/background-notification";
import { CommandPalette } from "@/components/command-palette";
import { useChats } from "@/hooks/use-chats";
import { KeyboardShortcutsModal } from "@/components/modals/KeyboardShortcutsModal";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { SkipLink } from "@/lib/accessibility";
import { trackWorkspaceEvent } from "@/lib/analytics";
import { Loader2 } from "lucide-react";

const lazyWithRetry = <T extends React.ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>
) =>
  lazy(async () => {
    try {
      return await componentImport();
    } catch (error) {
      if (typeof window !== "undefined") {
        const isChunkLoadFailed = error instanceof Error &&
          (/Failed to fetch dynamically imported module/i.test(error.message) ||
            /Importing a module script failed/i.test(error.message) ||
            /Unable to load/i.test(error.message));
        if (isChunkLoadFailed) {
          // Evitar bucles infinitos
          if (!sessionStorage.getItem('chunk-reload')) {
            sessionStorage.setItem('chunk-reload', 'true');
            window.location.reload();
            return { default: (() => <PageLoader />) as unknown as T };
          }
        }
      }
      throw error;
    }
  });

const Home = lazyWithRetry(() => import("@/pages/home"));
const ProjectWorkspace = lazyWithRetry(() => import("@/pages/project-workspace"));
const OpenClawPage = lazyWithRetry(() => import("@/pages/openclaw"));
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { PlatformSettingsProvider, usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { isAdminUser } from "@/lib/admin";
const MaintenancePage = lazyWithRetry(() => import("@/pages/maintenance"));
const LandingPage = lazyWithRetry(() => import("@/pages/landing"));
import type { ComponentType } from "react";

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const isLocalDevHost = () => {
  if (typeof window === "undefined") return false;
  if (import.meta.env.DEV) return true;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  const private172 = host.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (private172) {
    const second = Number(private172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
};

function RootRoute(props: any) {
  const { isReady, isAuthenticated } = useAuth();
  const [location] = useLocation();
  
  if (!isReady) return <PageLoader />;
  
  // Local experiments can run from chat without forcing login on localhost.
  if (!(isAuthenticated || isLocalDevHost())) return <LandingPage />;
  
  // If viewing a chat or creating new chat, show the chat interface
  if (location.startsWith("/chat")) return <Home />;
  
  // Default: redirect to chat
  return <Home />;
}

// Wouter passes RouteComponentProps to route components; pages typically ignore them.
// Keep this permissive so protected routes type-check cleanly.
function requireAuth(Component: ComponentType<any>) {
  return function ProtectedRoute(props: any) {
    const { isReady, isAuthenticated } = useAuth();
    const [, setLocation] = useLocation();

    useEffect(() => {
      if (!isReady) return;
      if (!isAuthenticated) setLocation("/login");
    }, [isReady, isAuthenticated, setLocation]);

    if (!isReady) return <PageLoader />;
    if (!isAuthenticated) return <PageLoader />;
    return <Component {...props} />;
  };
}
function WorkspaceAnalyticsTracker() {
  const [location] = useLocation();
  const { user, isReady } = useAuth();
  const lastLocationRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isReady || !user) return;
    if (lastLocationRef.current === location) return;
    lastLocationRef.current = location;
    void trackWorkspaceEvent({
      eventType: "page_view",
      page: location,
      metadata: { path: location },
    });
  }, [location, user, isReady]);

  return null;
}

function ChatPageRedirect() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (params.id) {
      window.dispatchEvent(new CustomEvent("select-chat", { detail: { chatId: params.id } }));
      setLocation("/");
    }
  }, [params.id, setLocation]);

  return <Home />;
}

const LoginPage = lazyWithRetry(() => import("@/pages/login"));
const LoginApprovePage = lazyWithRetry(() => import("@/pages/login-approve"));
const SignupPage = lazyWithRetry(() => import("@/pages/signup"));
const NotFound = lazyWithRetry(() => import("@/pages/not-found"));

const ProfilePage = lazyWithRetry(() => import("@/pages/profile"));
const BillingPage = lazyWithRetry(() => import("@/pages/billing"));
const SettingsPage = lazyWithRetry(() => import("@/pages/settings"));
const PrivacyPage = lazyWithRetry(() => import("@/pages/privacy"));
const PrivacyPolicyPage = lazyWithRetry(() => import("@/pages/privacy-policy"));
const TermsPage = lazyWithRetry(() => import("@/pages/terms"));
const AdminPage = lazyWithRetry(() => import("@/pages/admin"));
const SystemHealthPage = lazyWithRetry(() => import("@/pages/admin/SystemHealth"));
const WorkspaceSettingsPage = lazyWithRetry(() => import("@/pages/workspace-settings"));
const WorkspacePage = lazyWithRetry(() => import("@/pages/workspace"));
const SkillsPage = lazyWithRetry(() => import("@/pages/skills"));
const CodexPage = lazyWithRetry(() => import("@/pages/codex"));
const SpreadsheetAnalyzerPage = lazyWithRetry(() => import("@/pages/SpreadsheetAnalyzer"));
const MonitoringDashboard = lazyWithRetry(() => import("@/pages/MonitoringDashboard"));
const AboutPage = lazyWithRetry(() => import("@/pages/about"));
const LearnPage = lazyWithRetry(() => import("@/pages/learn"));
const PricingPage = lazyWithRetry(() => import("@/pages/pricing"));
const BusinessPage = lazyWithRetry(() => import("@/pages/business"));
const DownloadPage = lazyWithRetry(() => import("@/pages/download"));
const PowerPage = lazyWithRetry(() => import("@/pages/power"));
const OfficeEngineDemoPage = lazyWithRetry(() => import("@/pages/office-engine-demo"));
const MemoryPage = lazyWithRetry(() => import("@/pages/memory"));
const MemoriesPage = lazyWithRetry(() => import("@/pages/memories"));
const InstructionsPage = lazyWithRetry(() => import("@/pages/instructions"));
const IliaAdsPage = lazyWithRetry(() => import("@/pages/ilia-ads"));
const RunReplayPage = lazyWithRetry(() => import("@/pages/agent/RunReplayPage"));
const OrchestrationDAGPage = lazyWithRetry(() => import("@/pages/agent/OrchestrationDAGPage"));
const KnowledgeGraphPage = lazyWithRetry(() => import("@/pages/knowledge-graph"));
const BackgroundAgentsPage = lazyWithRetry(() => import("@/pages/background-agents"));
const MCPManagerPage = lazyWithRetry(() => import("@/pages/mcp-manager"));

const ProtectedProfilePage = requireAuth(ProfilePage);
const ProtectedBillingPage = requireAuth(BillingPage);
const ProtectedSettingsPage = requireAuth(SettingsPage);
const ProtectedPrivacyPage = requireAuth(PrivacyPage);
const ProtectedAdminPage = requireAuth(AdminPage);
const ProtectedSystemHealthPage = requireAuth(SystemHealthPage);
const ProtectedWorkspaceSettingsPage = requireAuth(WorkspaceSettingsPage);
const ProtectedWorkspacePage = requireAuth(WorkspacePage);
const ProtectedSkillsPage = requireAuth(SkillsPage);
const ProtectedCodexPage = requireAuth(CodexPage);
const ProtectedMemoryPage = requireAuth(MemoryPage);
const ProtectedMemoriesPage = requireAuth(MemoriesPage);
const ProtectedInstructionsPage = requireAuth(InstructionsPage);
const ProtectedIliaAdsPage = requireAuth(IliaAdsPage);
const ProtectedSpreadsheetAnalyzerPage = requireAuth(SpreadsheetAnalyzerPage);
const ProtectedMonitoringDashboard = requireAuth(MonitoringDashboard);
const ProtectedRunReplayPage = requireAuth(RunReplayPage);
const ProtectedOrchestrationDAGPage = requireAuth(OrchestrationDAGPage);
const ProtectedKnowledgeGraphPage = requireAuth(KnowledgeGraphPage);
const ProtectedBackgroundAgentsPage = requireAuth(BackgroundAgentsPage);
const ProtectedMCPManagerPage = requireAuth(MCPManagerPage);

function SearchModalWithChats(props: Omit<React.ComponentProps<typeof SearchModal>, 'chats'>) {
  const { chats } = useChats();
  return <SearchModal {...props} chats={chats} />;
}

function CommandPaletteWithChats(props: Omit<React.ComponentProps<typeof CommandPalette>, 'chats'>) {
  const { chats } = useChats();
  return <CommandPalette {...props} chats={chats} />;
}

function GlobalKeyboardShortcuts() {
  const [, setLocation] = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [toolCatalogOpen, setToolCatalogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const { settings } = useSettingsContext();

  const handleNewChat = useCallback(() => {
    setLocation("/chat/new");
    void trackWorkspaceEvent({
      eventType: "action",
      action: "new_chat_requested",
      metadata: { source: "shortcut" },
    });
  }, [setLocation]);

  const handleOpenSearch = useCallback(() => {
    setCommandPaletteOpen(true);
    void trackWorkspaceEvent({
      eventType: "action",
      action: "command_palette_opened",
      metadata: { source: "shortcut" },
    });
  }, []);

  const handleOpenToolCatalog = useCallback(() => {
    setToolCatalogOpen(true);
    void trackWorkspaceEvent({
      eventType: "action",
      action: "tool_catalog_opened",
      metadata: { source: "shortcut" },
    });
  }, []);

  const handleCloseDialogs = useCallback(() => {
    setSearchOpen(false);
    setToolCatalogOpen(false);
    setCommandPaletteOpen(false);
    setShortcutsModalOpen(false);
    window.dispatchEvent(new CustomEvent("close-all-dialogs"));
    void trackWorkspaceEvent({
      eventType: "action",
      action: "dialogs_closed",
      metadata: { source: "shortcut" },
    });
  }, []);

  const handleOpenShortcuts = useCallback(() => {
    setShortcutsModalOpen(true);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setLocation("/settings");
    void trackWorkspaceEvent({
      eventType: "action",
      action: "settings_opened",
      metadata: { source: "shortcut" },
    });
  }, [setLocation]);

  const handleSelectChat = useCallback((chatId: string) => {
    setSearchOpen(false);
    setCommandPaletteOpen(false);
    setLocation(`/chat/${chatId}`);
    window.dispatchEvent(new CustomEvent("select-chat", { detail: { chatId } }));
  }, [setLocation]);

  const handleSelectTool = useCallback((tool: { name: string; description: string }) => {
    window.dispatchEvent(new CustomEvent("tool-selected", { detail: { tool } }));
  }, []);

  const handleToggleShortcuts = useCallback(() => {
    setShortcutsModalOpen(prev => !prev);
  }, []);

  const shortcutsConfig = useMemo(() => [
    { key: "n", ctrl: true, action: handleNewChat, description: "Nuevo chat" },
    { key: "k", ctrl: true, action: handleOpenSearch, description: "Command Palette" },
    { key: "k", ctrl: true, shift: true, action: handleOpenToolCatalog, description: "Tool Catalog" },
    { key: "Escape", action: handleCloseDialogs, description: "Cerrar diálogo" },
    { key: ",", ctrl: true, action: handleOpenSettings, description: "Configuración" },
    { key: "/", ctrl: true, action: handleToggleShortcuts, description: "Atajos de teclado" },
  ], [handleNewChat, handleOpenSearch, handleOpenToolCatalog, handleCloseDialogs, handleOpenSettings, handleToggleShortcuts]);

  useKeyboardShortcuts(shortcutsConfig, { enabled: settings.keyboardShortcuts });

  return (
    <>
      {searchOpen && (
        <SearchModalWithChats
          open={searchOpen}
          onOpenChange={setSearchOpen}
          onSelectChat={handleSelectChat}
        />
      )}
      <ToolCatalog
        open={toolCatalogOpen}
        onOpenChange={setToolCatalogOpen}
        onSelectTool={handleSelectTool}
      />
      {commandPaletteOpen && (
        <CommandPaletteWithChats
          isOpen={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          onNewChat={handleNewChat}
          onOpenSettings={() => { setCommandPaletteOpen(false); setLocation("/settings"); }}
          onOpenShortcuts={handleOpenShortcuts}
          onSelectChat={handleSelectChat}
        />
      )}
      <KeyboardShortcutsModal
        isOpen={shortcutsModalOpen}
        onClose={() => setShortcutsModalOpen(false)}
      />
    </>
  );
}

import { GlobalErrorBoundary } from "@/components/global-error-boundary";
import { ErrorBoundary } from "@/components/error-boundary";

function Router() {
  const HOME_ROUTE_REGEX = /^\/(?:chat(?:\/[^/]+)?)?\/?$/;
  return (
    <GlobalErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <main id="main-content" className="flex-1 outline-none" tabIndex={-1}>
          <Switch>
            <Route path={HOME_ROUTE_REGEX} component={RootRoute} />
            <Route path="/project/:type" component={ProjectWorkspace} />
            <Route path="/welcome">{() => import.meta.env.DEV ? <RootRoute /> : <LandingPage />}</Route>
            <Route path="/login" component={LoginPage} />
            <Route path="/login/approve" component={LoginApprovePage} />
            <Route path="/signup" component={SignupPage} />
            <Route path="/profile" component={ProtectedProfilePage} />
            <Route path="/billing" component={ProtectedBillingPage} />
            <Route path="/settings" component={ProtectedSettingsPage} />
            <Route path="/privacy" component={ProtectedPrivacyPage} />
            <Route path="/privacy-policy" component={PrivacyPolicyPage} />
            <Route path="/terms" component={TermsPage} />
            <Route path="/admin/health" component={ProtectedSystemHealthPage} />
            <Route path="/admin/:section?" component={ProtectedAdminPage} />
            <Route path="/workspace-settings" component={ProtectedWorkspaceSettingsPage} />
            <Route path="/workspace" component={ProtectedWorkspacePage} />
            <Route path="/skills" component={ProtectedSkillsPage} />
            <Route path="/codex" component={ProtectedCodexPage} />
            <Route path="/memory" component={ProtectedMemoryPage} />
            <Route path="/memories" component={ProtectedMemoriesPage} />
            <Route path="/instructions" component={ProtectedInstructionsPage} />
            <Route path="/knowledge-graph" component={ProtectedKnowledgeGraphPage} />
            <Route path="/background-agents" component={ProtectedBackgroundAgentsPage} />
            <Route path="/mcp-manager" component={ProtectedMCPManagerPage} />
            <Route path="/ads" component={ProtectedIliaAdsPage} />
            <Route path="/spreadsheet-analyzer" component={ProtectedSpreadsheetAnalyzerPage} />
            <Route path="/monitoring" component={ProtectedMonitoringDashboard} />
            <Route path="/agent/replay/:runId" component={ProtectedRunReplayPage} />
            <Route path="/agent/dag/:runId" component={ProtectedOrchestrationDAGPage} />
            <Route path="/openclaw" component={OpenClawPage} />
            <Route path="/about" component={AboutPage} />
            <Route path="/learn" component={LearnPage} />
            <Route path="/pricing" component={PricingPage} />
            <Route path="/business" component={BusinessPage} />
            <Route path="/download" component={DownloadPage} />
            <Route path="/power" component={PowerPage} />
            <Route path="/office-engine-demo" component={OfficeEngineDemoPage} />
            <Route component={NotFound} />
          </Switch>
        </main>
      </Suspense>
    </GlobalErrorBoundary>
  );
}

function AppContent() {
  const [location] = useLocation();
  const { settings: platformSettings, isLoading: platformLoading } = usePlatformSettings();
  const { user } = useAuth();

  const publicMaintenanceRoutePrefixes = [
    "/welcome",
    "/login",
    "/signup",
    "/terms",
    "/privacy-policy",
    "/about",
    "/learn",
    "/pricing",
    "/business",
    "/download",
    "/power",
  ];
  const allowDuringMaintenance =
    location === "/" || publicMaintenanceRoutePrefixes.some((route) => location.startsWith(route));

  if (!platformLoading && platformSettings.maintenance_mode && !isAdminUser(user) && !allowDuringMaintenance) {
    return (
      <Suspense fallback={<PageLoader />}>
        <MaintenancePage />
      </Suspense>
    );
  }

  return (
    <ErrorBoundary section="chat" onError={(error, errorInfo) => {
      console.error("[AppContent] Error boundary caught:", error, errorInfo);
    }}>
      <SkipLink />
      <OfflineIndicator />
      {/* AuthCallbackHandler removed, moved to AuthProvider */}
      <GlobalKeyboardShortcuts />
      <WorkspaceAnalyticsTracker />
      <Toaster
        position="bottom-right"
        richColors
        closeButton
      />
      <Router />
      <ArtifactPanel />
      <BackgroundNotificationContainer onNavigateToChat={() => { }} />
    </ErrorBoundary>
  );
}

import { OverlayHUD } from "./components/overlay/OverlayHUD";
import { ArtifactPanel } from "./components/artifact-panel";

function App() {
  const isOverlayMode = typeof window !== 'undefined' && window.location.search.includes('mode=overlay');

  if (isOverlayMode) {
    return <OverlayHUD />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <PlatformSettingsProvider>
        <AuthProvider>
          <SettingsProvider>
            <ModelAvailabilityProvider>
              <TooltipProvider>
                <WouterRouter>
                  <AppContent />
                </WouterRouter>
              </TooltipProvider>
            </ModelAvailabilityProvider>
          </SettingsProvider>
        </AuthProvider>
      </PlatformSettingsProvider>
    </QueryClientProvider>
  );
}

export default App;
