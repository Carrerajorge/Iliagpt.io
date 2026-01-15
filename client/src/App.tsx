import { Switch, Route, useLocation, useParams } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { ModelAvailabilityProvider } from "@/contexts/ModelAvailabilityContext";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useChats } from "@/hooks/use-chats";
import { SearchModal } from "@/components/search-modal";
import { ToolCatalog } from "@/components/tool-catalog";
import Home from "@/pages/home";
import { Loader2 } from "lucide-react";
import { initializeStreamingInfrastructure } from "@/hooks/use-routed-streaming";

initializeStreamingInfrastructure();

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

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
import LoginPage from "@/pages/login";
import SignupPage from "@/pages/signup";
import LandingPage from "@/pages/landing";
import NotFound from "@/pages/not-found";

const ProfilePage = lazy(() => import("@/pages/profile"));
const BillingPage = lazy(() => import("@/pages/billing"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const PrivacyPage = lazy(() => import("@/pages/privacy"));
const AdminPage = lazy(() => import("@/pages/admin"));
const SystemHealthPage = lazy(() => import("@/pages/admin/SystemHealth"));
const WorkspaceSettingsPage = lazy(() => import("@/pages/workspace-settings"));
const WorkspacePage = lazy(() => import("@/pages/workspace"));
const SkillsPage = lazy(() => import("@/pages/skills"));
const SpreadsheetAnalyzerPage = lazy(() => import("@/pages/SpreadsheetAnalyzer"));
const MonitoringDashboard = lazy(() => import("@/pages/MonitoringDashboard"));

function AuthCallbackHandler() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "success") {
      fetch("/api/auth/user", { credentials: "include" })
        .then(res => res.ok ? res.json() : null)
        .then(user => {
          if (user) {
            localStorage.setItem("siragpt_auth_user", JSON.stringify(user));
            queryClient.setQueryData(["/api/auth/user"], user);
          }
          queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        })
        .catch(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  return null;
}

function GlobalKeyboardShortcuts() {
  const [, setLocation] = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [toolCatalogOpen, setToolCatalogOpen] = useState(false);
  const { chats } = useChats();

  const handleNewChat = useCallback(() => {
    setLocation("/");
    window.dispatchEvent(new CustomEvent("new-chat-requested"));
  }, [setLocation]);

  const handleOpenSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);

  const handleOpenToolCatalog = useCallback(() => {
    setToolCatalogOpen(true);
  }, []);

  const handleCloseDialogs = useCallback(() => {
    setSearchOpen(false);
    setToolCatalogOpen(false);
    window.dispatchEvent(new CustomEvent("close-all-dialogs"));
  }, []);

  const handleOpenSettings = useCallback(() => {
    setLocation("/settings");
  }, [setLocation]);

  const handleSelectChat = useCallback((chatId: string) => {
    setSearchOpen(false);
    window.dispatchEvent(new CustomEvent("select-chat", { detail: { chatId } }));
  }, []);

  const handleSelectTool = useCallback((tool: { name: string; description: string }) => {
    window.dispatchEvent(new CustomEvent("tool-selected", { detail: { tool } }));
  }, []);

  useKeyboardShortcuts([
    { key: "n", ctrl: true, action: handleNewChat, description: "Nuevo chat" },
    { key: "k", ctrl: true, action: handleOpenSearch, description: "Búsqueda rápida" },
    { key: "k", ctrl: true, shift: true, action: handleOpenToolCatalog, description: "Tool Catalog" },
    { key: "Escape", action: handleCloseDialogs, description: "Cerrar diálogo" },
    { key: ",", ctrl: true, action: handleOpenSettings, description: "Configuración" },
  ]);

  return (
    <>
      <SearchModal
        open={searchOpen}
        onOpenChange={setSearchOpen}
        chats={chats}
        onSelectChat={handleSelectChat}
      />
      <ToolCatalog
        open={toolCatalogOpen}
        onOpenChange={setToolCatalogOpen}
        onSelectTool={handleSelectTool}
      />
    </>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/chat/:id" component={ChatPageRedirect} />
        <Route path="/welcome" component={LandingPage} />
        <Route path="/login" component={LoginPage} />
        <Route path="/signup" component={SignupPage} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/billing" component={BillingPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/admin" component={AdminPage} />
        <Route path="/admin/health" component={SystemHealthPage} />
        <Route path="/workspace-settings" component={WorkspaceSettingsPage} />
        <Route path="/workspace" component={WorkspacePage} />
        <Route path="/skills" component={SkillsPage} />
        <Route path="/spreadsheet-analyzer" component={SpreadsheetAnalyzerPage} />
        <Route path="/monitoring" component={MonitoringDashboard} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <ModelAvailabilityProvider>
          <TooltipProvider>
            <AuthCallbackHandler />
            <GlobalKeyboardShortcuts />
            <Toaster />
            <SonnerToaster 
              position="bottom-right" 
              richColors 
              closeButton
              toastOptions={{
                classNames: {
                  toast: 'text-sm',
                  actionButton: 'text-xs font-medium',
                }
              }}
            />
            <Router />
          </TooltipProvider>
        </ModelAvailabilityProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}

export default App;
