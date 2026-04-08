import { Suspense, useState, useRef, useEffect } from "react"; import { useLocation, useSearch } from "wouter"; import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"; import { Button } from
  "@/components/ui/button"; import { Input } from "@/components/ui/input"; import { Badge } from "@/components/ui/badge"; import { Switch } from "@/components/ui/switch"; import { ScrollArea } from
  "@/components/ui/scroll-area"; import { Separator } from "@/components/ui/separator"; import { Progress } from "@/components/ui/progress"; import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogTrigger
  } from "@/components/ui/dialog"; import { Label } from "@/components/ui/label"; import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"; import { Checkbox } from "@/components/ui/checkbox"; import {
  Card, CardContent, CardDescription, CardFooter,
  CardHeader, CardTitle
} from "@/components/ui/card"; import { Skeleton, TableSkeleton } from "@/components/ui/skeleton"; import {
  ArrowLeft,
  LayoutDashboard,
  Users,
  Bot,
  CreditCard,
  FileText,
  BarChart3,
  Database,
  Shield,
  FileBarChart,
  Settings,
  Search,
  Plus,
  MoreHorizontal,
  CheckCircle,
  TrendingUp,
  Activity,
  HardDrive,
  Clock,
  Key,
  AlertTriangle,
  Download,
  RefreshCw,
  Copy,
  Trash2,
  Edit,
  Loader2,
  Filter,
  Eye,
  MessageSquare,
  Flag,
  Calendar,
  ChevronDown,
  ChevronUp,
  X,
  Terminal,
  Play,
  Layers,
  Server,
  Globe,
  Network,
  Lock,
  Timer,
  FileCode,
  Archive,
  ShieldCheck,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Palette,
  Bell,
  Code,
  RotateCcw,
  Brain,
  Wrench,
  Zap,
  FileSpreadsheet,
  Table,
  FolderOpen,
  Gauge,
  FlaskConical,
  Phone
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/apiClient";
import { type AdminSection, getAdminHref, getAdminSectionFromRoute } from "@/lib/adminNavigation";
import { formatZonedDateTime, normalizeTimeZone } from "@/lib/platformDateTime";
import { format } from "date-fns";
import { toast } from "sonner";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import AnalyticsDashboard from "@/components/admin/AnalyticsDashboard";
import AgenticEngineDashboard from "@/components/admin/AgenticEngineDashboard";
import { SpreadsheetEditor } from "@/components/spreadsheet/SpreadsheetEditor";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { RealtimeMetricsPanel } from "@/components/admin/RealtimeMetrics";
import { SecurityAlertsPanel } from "@/components/admin/SecurityAlerts";
import { AdminNotificationsPopover } from "@/components/admin/NotificationsPopover";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import UsersManagement from "@/components/admin/UsersManagement";
import ReleasesManager from "./admin/ReleasesManager";
import BudgetDashboard from "@/components/admin/BudgetDashboard";
import SREPanel from "@/components/admin/SREPanel";
import GovernanceConsole from "@/components/admin/GovernanceConsole";
import SecurityDashboard from "@/components/admin/SecurityDashboard";
import ModelExperiments from "@/components/admin/ModelExperiments";
import VoicePlane from "@/components/admin/VoicePlane";
import DataPlaneExplorer from "@/components/admin/DataPlaneExplorer";
import TerminalPlane from "@/components/admin/TerminalPlane";
import FilePlane from "@/components/admin/FilePlane";
import SuperOrchestratorDashboard from "@/components/admin/SuperOrchestrator";
import BrowserPlaneDashboard from "@/components/admin/BrowserPlane";
import DeepResearchDashboard from "@/components/admin/DeepResearch";
import ObservabilityDashboard from "@/components/admin/ObservabilityDashboard";
import ChaosTestingDashboard from "@/components/admin/ChaosTestingDashboard";
import GatewayLogViewer from "@/components/admin/GatewayLogViewer";

const navItems: { id: AdminSection; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "monitoring", label: "Monitoring", icon: Server },
  { id: "users", label: "Users", icon: Users },
  { id: "conversations", label: "Conversations", icon: MessageSquare },
  { id: "ai-models", label: "AI Models", icon: Bot },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "invoices", label: "Invoices", icon: FileText },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "database", label: "Database", icon: Database },
  { id: "security", label: "Security", icon: Shield },
  { id: "reports", label: "Reports", icon: FileBarChart },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "agentic", label: "Agentic Engine", icon: Bot },
  { id: "excel", label: "Excel Manager", icon: FileSpreadsheet },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "releases", label: "App Releases", icon: Download },
  { id: "budget", label: "Budget & Costs", icon: DollarSign },
  { id: "sre", label: "SRE Panel", icon: Gauge },
  { id: "governance", label: "Governance", icon: ShieldCheck },
  { id: "security-dashboard", label: "Security Monitor", icon: ShieldAlert },
  { id: "experiments", label: "Model Experiments", icon: FlaskConical },
  { id: "voice", label: "Voice Plane", icon: Phone },
  { id: "data-plane", label: "Data Plane", icon: Database },
  { id: "files", label: "File Plane", icon: FolderOpen },
  { id: "orchestrator", label: "SuperOrchestrator", icon: Network },
  { id: "browser", label: "Browser Plane", icon: Globe },
  { id: "research", label: "Deep Research", icon: Brain },
  { id: "observability", label: "Observability", icon: Eye },
  { id: "chaos", label: "Chaos Testing", icon: Zap },
  { id: "gateway-logs", label: "Gateway Logs", icon: Activity },
];

async function adminFetch<T = any>(url: string): Promise<T> {
  const res = await apiFetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Admin API error: ${res.status}`);
  }
  return res.json();
}

function DashboardSection({ onNavigate }: { onNavigate: (section: AdminSection) => void }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/dashboard"],
    queryFn: () => adminFetch("/api/admin/dashboard"),
    refetchInterval: 30000,
    throwOnError: true,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const d = data || {};
  const sectionCardClassName = "w-full rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Dashboard</h2>
        <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="button-refresh-dashboard">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <button type="button" className={sectionCardClassName} onClick={() => onNavigate("users")} data-testid="card-users">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-blue-500/10">
              <Users className="h-4 w-4 text-blue-500" />
            </div>
            <span className="text-sm font-medium">Users</span>
          </div>
          <p className="text-2xl font-bold">{d.users?.total || 0}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{d.users?.active || 0} activos</span>
            <span className="text-green-600">+{d.users?.newThisMonth || 0} este mes</span>
          </div>
        </button>

        <button type="button" className={sectionCardClassName} onClick={() => onNavigate("ai-models")} data-testid="card-ai-models">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-purple-500/10">
              <Bot className="h-4 w-4 text-purple-500" />
            </div>
            <span className="text-sm font-medium">AI Models</span>
          </div>
          <p className="text-2xl font-bold">{d.aiModels?.active || 0}<span className="text-sm font-normal text-muted-foreground">/{d.aiModels?.total || 0}</span></p>
          <div className="flex items-center gap-2 mt-2">
            <span className={cn("inline-flex items-center gap-1 text-xs", d.systemHealth?.xai ? "text-green-600" : "text-red-500")}>
              <span className={cn("w-1.5 h-1.5 rounded-full", d.systemHealth?.xai ? "bg-green-500" : "bg-red-500")} />
              xAI
            </span>
            <span className={cn("inline-flex items-center gap-1 text-xs", d.systemHealth?.gemini ? "text-green-600" : "text-red-500")}>
              <span className={cn("w-1.5 h-1.5 rounded-full", d.systemHealth?.gemini ? "bg-green-500" : "bg-red-500")} />
              Gemini
            </span>
          </div>
        </button>

        <button type="button" className={sectionCardClassName} onClick={() => onNavigate("payments")} data-testid="card-payments">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-green-500/10">
              <CreditCard className="h-4 w-4 text-green-500" />
            </div>
            <span className="text-sm font-medium">Payments</span>
          </div>
          <p className="text-2xl font-bold">€{parseFloat(d.payments?.total || "0").toLocaleString()}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>€{parseFloat(d.payments?.thisMonth || "0").toLocaleString()} este mes</span>
            <span>{d.payments?.count || 0} transacciones</span>
          </div>
        </button>

        <button type="button" className={sectionCardClassName} onClick={() => onNavigate("invoices")} data-testid="card-invoices">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-orange-500/10">
              <FileText className="h-4 w-4 text-orange-500" />
            </div>
            <span className="text-sm font-medium">Invoices</span>
          </div>
          <p className="text-2xl font-bold">{d.invoices?.total || 0}</p>
          <div className="flex items-center gap-4 mt-2 text-xs">
            <span className="text-yellow-600">{d.invoices?.pending || 0} pendientes</span>
            <span className="text-green-600">{d.invoices?.paid || 0} pagadas</span>
          </div>
        </button>

        <button type="button" className={sectionCardClassName} onClick={() => onNavigate("analytics")} data-testid="card-analytics">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-cyan-500/10">
              <BarChart3 className="h-4 w-4 text-cyan-500" />
            </div>
            <span className="text-sm font-medium">Analytics</span>
          </div>
          <p className="text-2xl font-bold">{(d.analytics?.totalQueries || 0).toLocaleString()}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>~{d.analytics?.avgQueriesPerUser || 0} consultas/usuario</span>
          </div>
        </button>

        <button type="button" className={sectionCardClassName} onClick={() => onNavigate("database")} data-testid="card-database">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-slate-500/10">
              <Database className="h-4 w-4 text-slate-500" />
            </div>
            <span className="text-sm font-medium">Database</span>
          </div>
          <p className="text-2xl font-bold">{d.database?.tables || 0} <span className="text-sm font-normal text-muted-foreground">tablas</span></p>
          <div className="flex items-center gap-2 mt-2">
            <span className={cn("inline-flex items-center gap-1 text-xs", d.database?.status === "healthy" ? "text-green-600" : "text-red-500")}>
              <CheckCircle className="h-3 w-3" />
              {d.database?.status === "healthy" ? "Operativo" : "Error"}
            </span>
          </div>
        </button>

        <button type="button" className={sectionCardClassName} onClick={() => onNavigate("security")} data-testid="card-security">
          <div className="flex items-center gap-3 mb-3">
            <div className={cn("p-2 rounded-md", d.security?.status === "healthy" ? "bg-green-500/10" : "bg-yellow-500/10")}>
              <Shield className={cn("h-4 w-4", d.security?.status === "healthy" ? "text-green-500" : "text-yellow-500")} />
            </div>
            <span className="text-sm font-medium">Security</span>
          </div>
          <p className="text-2xl font-bold">{d.security?.alerts || 0} <span className="text-sm font-normal text-muted-foreground">alertas</span></p>
          <div className="flex items-center gap-2 mt-2">
            <span className={cn("inline-flex items-center gap-1 text-xs", d.security?.status === "healthy" ? "text-green-600" : "text-yellow-600")}>
              <span className={cn("w-1.5 h-1.5 rounded-full", d.security?.status === "healthy" ? "bg-green-500" : "bg-yellow-500")} />
              {d.security?.status === "healthy" ? "Sin incidentes" : "Revisar"}
            </span>
          </div>
        </button>

        <button type="button" className={sectionCardClassName} onClick={() => onNavigate("reports")} data-testid="card-reports">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-indigo-500/10">
              <FileBarChart className="h-4 w-4 text-indigo-500" />
            </div>
            <span className="text-sm font-medium">Reports</span>
          </div>
          <p className="text-2xl font-bold">{d.reports?.total || 0}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{d.reports?.scheduled || 0} programados</span>
          </div>
        </button>

        <button type="button" className={sectionCardClassName} onClick={() => onNavigate("settings")} data-testid="card-settings">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-gray-500/10">
              <Settings className="h-4 w-4 text-gray-500" />
            </div>
            <span className="text-sm font-medium">Settings</span>
          </div>
          <p className="text-2xl font-bold">{d.settings?.total || 0} <span className="text-sm font-normal text-muted-foreground">config</span></p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{d.settings?.categories || 0} categorías</span>
          </div>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium">System Health</h3>
            <span className="text-xs text-muted-foreground">{d.systemHealth?.uptime || 99.9}% uptime</span>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">xAI Grok</span>
              <Badge variant={d.systemHealth?.xai ? "default" : "destructive"} className="text-xs">
                {d.systemHealth?.xai ? "Online" : "Offline"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Google Gemini</span>
              <Badge variant={d.systemHealth?.gemini ? "default" : "destructive"} className="text-xs">
                {d.systemHealth?.gemini ? "Online" : "Offline"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Database</span>
              <Badge variant={d.database?.status === "healthy" ? "default" : "destructive"} className="text-xs">
                {d.database?.status === "healthy" ? "Healthy" : "Error"}
              </Badge>
            </div>
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <h3 className="text-sm font-medium mb-4">Actividad reciente</h3>
          <div className="space-y-2">
            {(d.recentActivity || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay actividad reciente</p>
            ) : (
              (d.recentActivity || []).slice(0, 5).map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-1.5 text-sm border-b last:border-0">
                  <div className="flex items-center gap-2">
                    <Activity className="h-3 w-3 text-muted-foreground" />
                    <span className="truncate max-w-[200px]">{item.action}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {item.createdAt ? format(new Date(item.createdAt), "dd/MM HH:mm") : ""}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Real-time Metrics and Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <RealtimeMetricsPanel />
        <div className="rounded-lg border p-4">
          <ActivityFeed limit={15} />
        </div>
      </div>
    </div>
  );
}

function MonitoringSection() {
  const [_location, setLocation] = useLocation();

  const grafanaUrl =
    "/grafana/d/cfdji8sx4vqioc/req-003-system-metrics?orgId=1";
  const grafanaKioskUrl = `${grafanaUrl}&kiosk`;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">Monitoring (REQ-003)</h2>
          <p className="text-sm text-muted-foreground">
            CPU/RAM/Disk en tiempo real (Influx) + Prometheus/node_exporter + Alertmanager
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setLocation("/admin/health")}>
            System Health
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(grafanaUrl, "_blank", "noopener,noreferrer")}
          >
            Abrir Grafana
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open("http://69.62.98.126:9095", "_blank", "noopener,noreferrer")}
          >
            Prometheus
          </Button>
        </div>
      </div>

      <div className="rounded-lg border p-3">
        <div className="rounded-md overflow-hidden border" style={{ height: 720 }}>
          <iframe
            title="REQ-003 System Metrics (Grafana)"
            src={grafanaKioskUrl}
            style={{ width: "100%", height: "100%", border: 0 }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Si el iframe no carga, usa “Abrir Grafana”. (Grafana ya tiene allow embedding habilitado).
        </p>
      </div>
    </div>
  );
}



function formatConvId(id: string): string {
  const hash = id.slice(-4).toUpperCase();
  return `CONV-${hash}`;
}

function formatRelativeTime(date: Date | string | null): string {
  if (!date) return "-";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return format(d, "dd/MM/yy");
}

function formatDuration(start: Date | string | null, end: Date | string | null): string {
  if (!start) return "-";
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  const diffMs = e.getTime() - s.getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

function ConversationsSection() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<string>("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [filters, setFilters] = useState({
    status: "",
    flagStatus: "",
    userId: "",
    aiModel: "",
    dateFrom: "",
    dateTo: "",
    minTokens: "",
    maxTokens: ""
  });
  const [showFilters, setShowFilters] = useState(false);
  const [viewingConversation, setViewingConversation] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [newNote, setNewNote] = useState("");
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateFilters = (newFilters: Partial<typeof filters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setPage(1);
  };

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
  };

  const { data: statsData } = useQuery({
    queryKey: ["/api/admin/conversations/stats/summary"],
    queryFn: () => adminFetch("/api/admin/conversations/stats/summary")
  });

  const { data: conversationsData, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/conversations", page, filters, sortBy, sortOrder],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "20", sortBy, sortOrder });
      if (filters.status) params.set("status", filters.status);
      if (filters.flagStatus) params.set("flagStatus", filters.flagStatus);
      if (filters.userId) params.set("userId", filters.userId);
      if (filters.aiModel) params.set("aiModel", filters.aiModel);
      if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
      if (filters.dateTo) params.set("dateTo", filters.dateTo);
      if (filters.minTokens) params.set("minTokens", filters.minTokens);
      if (filters.maxTokens) params.set("maxTokens", filters.maxTokens);
      return adminFetch(`/api/admin/conversations?${params}`);
    }
  });

  const { data: conversationDetail, isLoading: loadingDetail } = useQuery({
    queryKey: ["/api/admin/conversations", viewingConversation?.id],
    queryFn: async () => {
      if (!viewingConversation?.id) return null;
      return adminFetch(`/api/admin/conversations/${viewingConversation.id}`);
    },
    enabled: !!viewingConversation?.id
  });

  const flagMutation = useMutation({
    mutationFn: async ({ id, flagStatus }: { id: string; flagStatus: string | null }) => {
      const res = await apiFetch(`/api/admin/conversations/${id}/flag`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagStatus }),
        credentials: "include"
      });
      if (!res.ok) throw new Error("No se pudo actualizar el estado de la conversación");
      return res.json().catch(() => ({}));
    },
    onSuccess: () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/conversations", viewingConversation?.id] });
    }
  });

  const addNoteMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const res = await apiFetch(`/api/admin/conversations/${id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
        credentials: "include"
      });
      if (!res.ok) throw new Error("No se pudo guardar la nota");
      return res.json().catch(() => ({}));
    },
    onSuccess: () => {
      setNewNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/conversations", viewingConversation?.id] });
    }
  });

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await apiFetch("/api/admin/conversations/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
          credentials: "include"
        });
        const data = await res.json();
        setSearchResults(data.results || []);
      } catch (e) {
        setSearchResults([]);
      }
      setIsSearching(false);
    }, 500);
  };

  const handleExportJson = () => {
    if (!conversationDetail) return;
    const blob = new Blob([JSON.stringify(conversationDetail, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conversation-${formatConvId(conversationDetail.id)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyTranscript = () => {
    if (!conversationDetail?.messages) return;
    const transcript = conversationDetail.messages
      .map((m: any) => `[${m.role.toUpperCase()}]: ${m.content}`)
      .join("\n\n");
    navigator.clipboard.writeText(transcript);
  };

  const stats = statsData || { activeToday: 0, avgMessagesPerConversation: 0, tokensConsumedToday: 0, flaggedConversations: 0 };
  const conversations = conversationsData?.data || [];
  const pagination = conversationsData?.pagination || { page: 1, totalPages: 1, total: 0 };

  const flagColors: Record<string, string> = {
    reviewed: "bg-green-500/10 text-green-600 border-green-500/30",
    needs_attention: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
    spam: "bg-red-500/10 text-red-600 border-red-500/30",
    vip_support: "bg-purple-500/10 text-purple-600 border-purple-500/30"
  };

  const statusColors: Record<string, string> = {
    active: "bg-green-500/10 text-green-600 border-green-500/30",
    completed: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    flagged: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
    archived: "bg-gray-500/10 text-gray-500 border-gray-500/30"
  };

  const SortIcon = ({ column }: { column: string }) => (
    <span className="ml-1 inline-flex">
      {sortBy === column ? (
        sortOrder === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
      ) : (
        <ChevronDown className="h-3 w-3 opacity-30" />
      )}
    </span>
  );

  const clearFilters = () => {
    setFilters({
      status: "",
      flagStatus: "",
      userId: "",
      aiModel: "",
      dateFrom: "",
      dateTo: "",
      minTokens: "",
      maxTokens: ""
    });
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">CONVERSATION TRACKER</h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="button-refresh-conversations" className="transition-all duration-200 hover:bg-muted">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card p-4 transition-all duration-200 hover:border-primary/30" data-testid="stat-conversations-today">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <Activity className="h-3.5 w-3.5" />
            Conversations Today
          </div>
          <p className="text-2xl font-bold tabular-nums">{stats.activeToday}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 transition-all duration-200 hover:border-primary/30" data-testid="stat-avg-messages">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <MessageSquare className="h-3.5 w-3.5" />
            Avg Messages/Conv
          </div>
          <p className="text-2xl font-bold tabular-nums">{stats.avgMessagesPerConversation || stats.avgMessagesPerUser || 0}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 transition-all duration-200 hover:border-primary/30" data-testid="stat-tokens-today">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <BarChart3 className="h-3.5 w-3.5" />
            Tokens Today
          </div>
          <p className="text-2xl font-bold tabular-nums">{(stats.tokensConsumedToday || 0).toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 transition-all duration-200 hover:border-primary/30" data-testid="stat-flagged">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <Flag className="h-3.5 w-3.5" />
            Flagged/Review
          </div>
          <p className="text-2xl font-bold tabular-nums text-yellow-500">{stats.flaggedConversations}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations, messages..."
            className="pl-9 h-9 transition-all duration-200"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            data-testid="input-global-search"
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {searchResults.length > 0 && searchQuery && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 max-h-[300px] overflow-y-auto">
              {searchResults.map((result: any, idx: number) => (
                <div
                  key={idx}
                  className="p-3 hover:bg-muted cursor-pointer border-b last:border-0 transition-colors duration-150"
                  onClick={() => {
                    setViewingConversation(result);
                    setSearchQuery("");
                    setSearchResults([]);
                  }}
                  data-testid={`search-result-${idx}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-primary">{formatConvId(result.id)}</span>
                    <span className="text-xs text-muted-foreground">{result.user?.email || "Anonymous"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{result.matchedContent || result.title}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          className={cn("gap-1.5 transition-all duration-200", showFilters && "bg-muted")}
          data-testid="button-toggle-filters"
        >
          <Filter className="h-4 w-4" />
          Filters
          {Object.values(filters).some(v => v) && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{Object.values(filters).filter(v => v).length}</Badge>
          )}
        </Button>
      </div>

      {showFilters && (
        <div className="p-4 rounded-lg border bg-muted/20 space-y-3 transition-all duration-200">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date From</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={filters.dateFrom}
                onChange={(e) => updateFilters({ dateFrom: e.target.value })}
                data-testid="input-date-from"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date To</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={filters.dateTo}
                onChange={(e) => updateFilters({ dateTo: e.target.value })}
                data-testid="input-date-to"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={filters.status} onValueChange={(v) => updateFilters({ status: v })}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-status">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="flagged">Flagged</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Flag</Label>
              <Select value={filters.flagStatus} onValueChange={(v) => updateFilters({ flagStatus: v })}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-flag">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Flags</SelectItem>
                  <SelectItem value="reviewed">Reviewed</SelectItem>
                  <SelectItem value="needs_attention">Needs Attention</SelectItem>
                  <SelectItem value="spam">Spam</SelectItem>
                  <SelectItem value="vip_support">VIP Support</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">AI Model</Label>
              <Input
                placeholder="e.g. grok-3"
                className="h-8 text-xs"
                value={filters.aiModel}
                onChange={(e) => updateFilters({ aiModel: e.target.value })}
                data-testid="input-ai-model"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Min Tokens</Label>
              <Input
                type="number"
                placeholder="0"
                className="h-8 text-xs"
                value={filters.minTokens}
                onChange={(e) => updateFilters({ minTokens: e.target.value })}
                data-testid="input-min-tokens"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Max Tokens</Label>
              <Input
                type="number"
                placeholder="∞"
                className="h-8 text-xs"
                value={filters.maxTokens}
                onChange={(e) => updateFilters({ maxTokens: e.target.value })}
                data-testid="input-max-tokens"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">User ID</Label>
              <Input
                placeholder="User ID..."
                className="h-8 text-xs"
                value={filters.userId}
                onChange={(e) => updateFilters({ userId: e.target.value })}
                data-testid="input-user-id"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters" className="text-xs">
              Clear All Filters
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2" data-testid="skeleton-loader">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse h-12 bg-muted rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th
                    className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort("id")}
                    data-testid="th-id"
                  >
                    <div className="flex items-center">ID<SortIcon column="id" /></div>
                  </th>
                  <th
                    className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort("userEmail")}
                    data-testid="th-user"
                  >
                    <div className="flex items-center">User Email<SortIcon column="userEmail" /></div>
                  </th>
                  <th
                    className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort("createdAt")}
                    data-testid="th-started"
                  >
                    <div className="flex items-center">Started<SortIcon column="createdAt" /></div>
                  </th>
                  <th
                    className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort("messageCount")}
                    data-testid="th-messages"
                  >
                    <div className="flex items-center">Messages<SortIcon column="messageCount" /></div>
                  </th>
                  <th
                    className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort("tokensUsed")}
                    data-testid="th-tokens"
                  >
                    <div className="flex items-center">Tokens<SortIcon column="tokensUsed" /></div>
                  </th>
                  <th className="text-left p-3 font-medium" data-testid="th-model">AI Model</th>
                  <th className="text-left p-3 font-medium" data-testid="th-status">Status</th>
                  <th className="text-left p-3 font-medium" data-testid="th-duration">Duration</th>
                  <th className="text-right p-3 font-medium" data-testid="th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {conversations.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-muted-foreground">
                      <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      No conversations found
                    </td>
                  </tr>
                ) : conversations.map((conv: any) => (
                  <tr
                    key={conv.id}
                    className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors duration-150"
                    onClick={() => setViewingConversation(conv)}
                    data-testid={`row-conversation-${conv.id}`}
                  >
                    <td className="p-3">
                      <span className="font-mono text-xs text-primary">{formatConvId(conv.id)}</span>
                    </td>
                    <td className="p-3">
                      <span
                        className="text-xs truncate max-w-[150px] block hover:text-primary transition-colors cursor-pointer"
                        title={conv.user?.email}
                      >
                        {conv.user?.email || "Anonymous"}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{formatRelativeTime(conv.createdAt)}</td>
                    <td className="p-3 text-muted-foreground tabular-nums">{conv.messageCount || 0}</td>
                    <td className="p-3 text-muted-foreground tabular-nums">{(conv.tokensUsed || 0).toLocaleString()}</td>
                    <td className="p-3"><span className="text-xs font-mono">{conv.aiModelUsed || "-"}</span></td>
                    <td className="p-3">
                      <Badge
                        variant="outline"
                        className={cn("text-xs border", statusColors[conv.conversationStatus] || statusColors.active)}
                      >
                        {conv.conversationStatus || "active"}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground tabular-nums">
                      {formatDuration(conv.createdAt, conv.lastMessageAt)}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 transition-all duration-200 hover:bg-primary/10"
                          onClick={() => setViewingConversation(conv)}
                          data-testid={`button-view-${conv.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {((page - 1) * 20) + 1}-{Math.min(page * 20, pagination.total)} of {pagination.total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage(1)}
              data-testid="button-first-page"
            >
              First
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              data-testid="button-prev-page"
            >
              Previous
            </Button>
            <div className="flex items-center gap-1 mx-2">
              {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                let pageNum: number;
                if (pagination.totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= pagination.totalPages - 2) {
                  pageNum = pagination.totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }
                return (
                  <Button
                    key={pageNum}
                    variant={page === pageNum ? "default" : "outline"}
                    size="sm"
                    className="w-8 h-8 p-0"
                    onClick={() => setPage(pageNum)}
                    data-testid={`button-page-${pageNum}`}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={page === pagination.totalPages}
              onClick={() => setPage(p => p + 1)}
              data-testid="button-next-page"
            >
              Next
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page === pagination.totalPages}
              onClick={() => setPage(pagination.totalPages)}
              data-testid="button-last-page"
            >
              Last
            </Button>
          </div>
        </div>
      )}

      {viewingConversation && (
        <div
          className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col"
          data-testid="fullscreen-modal"
        >
          <div className="flex items-center justify-between p-4 border-b bg-card">
            <div className="flex items-center gap-4">
              <span className="font-mono text-lg font-semibold text-primary">
                {formatConvId(viewingConversation.id)}
              </span>
              <Separator orientation="vertical" className="h-6" />
              <span className="text-sm text-muted-foreground">{conversationDetail?.user?.email || "Anonymous"}</span>
              <Separator orientation="vertical" className="h-6" />
              <span className="text-sm text-muted-foreground">
                <Clock className="inline h-3.5 w-3.5 mr-1" />
                {formatDuration(viewingConversation.createdAt, viewingConversation.lastMessageAt)}
              </span>
              <Separator orientation="vertical" className="h-6" />
              <span className="text-sm text-muted-foreground font-mono">{conversationDetail?.aiModelUsed || "-"}</span>
              <Separator orientation="vertical" className="h-6" />
              <span className="text-sm text-muted-foreground tabular-nums">
                {(conversationDetail?.tokensUsed || 0).toLocaleString()} tokens
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setViewingConversation(null)}
              data-testid="button-close-modal"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {loadingDetail ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : conversationDetail && (
              <div className="max-w-4xl mx-auto space-y-4">
                {(conversationDetail.messages || []).map((msg: any, idx: number) => (
                  <div
                    key={msg.id || idx}
                    className={cn(
                      "rounded-lg p-4 transition-all duration-200",
                      msg.role === "user"
                        ? "bg-primary/20 ml-12 rounded-tr-sm"
                        : "bg-muted mr-12 rounded-tl-sm"
                    )}
                    data-testid={`message-${idx}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Badge
                        variant={msg.role === "user" ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {msg.role}
                      </Badge>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {msg.tokens && <span className="tabular-nums">{msg.tokens} tokens</span>}
                        <span>{msg.createdAt ? format(new Date(msg.createdAt), "HH:mm:ss") : ""}</span>
                      </div>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t bg-card p-4">
            <div className="max-w-4xl mx-auto flex items-center gap-3 flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "gap-1.5",
                      conversationDetail?.flagStatus && flagColors[conversationDetail.flagStatus]
                    )}
                    data-testid="button-flag-dropdown"
                  >
                    <Flag className="h-4 w-4" />
                    {conversationDetail?.flagStatus || "Flag Conversation"}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() => flagMutation.mutate({ id: viewingConversation.id, flagStatus: null })}
                    data-testid="flag-clear"
                  >
                    Clear Flag
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => flagMutation.mutate({ id: viewingConversation.id, flagStatus: "reviewed" })}
                    data-testid="flag-reviewed"
                  >
                    <span className="w-2 h-2 rounded-full bg-green-500 mr-2" />
                    Reviewed
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => flagMutation.mutate({ id: viewingConversation.id, flagStatus: "needs_attention" })}
                    data-testid="flag-needs-attention"
                  >
                    <span className="w-2 h-2 rounded-full bg-yellow-500 mr-2" />
                    Needs Attention
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => flagMutation.mutate({ id: viewingConversation.id, flagStatus: "spam" })}
                    data-testid="flag-spam"
                  >
                    <span className="w-2 h-2 rounded-full bg-red-500 mr-2" />
                    Spam
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => flagMutation.mutate({ id: viewingConversation.id, flagStatus: "vip_support" })}
                    data-testid="flag-vip"
                  >
                    <span className="w-2 h-2 rounded-full bg-purple-500 mr-2" />
                    VIP Support
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button variant="outline" size="sm" onClick={handleExportJson} data-testid="button-export-json">
                <Download className="h-4 w-4 mr-1.5" />
                Export JSON
              </Button>

              <Button variant="outline" size="sm" onClick={handleCopyTranscript} data-testid="button-copy-transcript">
                <FileText className="h-4 w-4 mr-1.5" />
                Copy Transcript
              </Button>

              <div className="flex-1" />

              <div className="flex items-center gap-2">
                <Textarea
                  placeholder="Add internal note..."
                  className="h-9 min-h-[36px] resize-none text-sm"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  data-testid="textarea-note"
                />
                <Button
                  size="sm"
                  disabled={!newNote.trim() || addNoteMutation.isPending}
                  onClick={() => addNoteMutation.mutate({ id: viewingConversation.id, note: newNote })}
                  data-testid="button-add-note"
                >
                  {addNoteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Note"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AIModelsSection() {
  const queryClient = useQueryClient();
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isSyncing, setIsSyncing] = useState(false);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [health, setHealth] = useState<any>(null);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [modelsScope, setModelsScope] = useState<"supported" | "integrated" | "all">("integrated");

  const readApiError = async (res: Response): Promise<string> => {
    const raw = await res.text().catch(() => "");
    if (!raw) return `${res.status} ${res.statusText}`.trim();
    try {
      const parsed = JSON.parse(raw);
      return parsed?.error || parsed?.message || raw;
    } catch {
      return raw;
    }
  };

  const { data: stats, isLoading: statsLoading, isError: statsIsError, error: statsError } = useQuery({
    queryKey: ["/api/admin/models/stats", modelsScope],
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/models/stats?scope=${modelsScope}`, { credentials: "include" });
      if (!res.ok) throw new Error(await readApiError(res));
      return res.json();
    },
    retry: false,
  });

  const { data: modelsData, isLoading, refetch, isError: modelsIsError, error: modelsError } = useQuery({
    queryKey: ["/api/admin/models/filtered", modelsScope, page, debouncedSearch, providerFilter, typeFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "15" });
      if (debouncedSearch) params.append("search", debouncedSearch);
      if (providerFilter !== "all") params.append("provider", providerFilter);
      if (typeFilter !== "all") params.append("type", typeFilter);
      if (statusFilter !== "all") params.append("status", statusFilter);
      params.append("scope", modelsScope);
      const res = await apiFetch(`/api/admin/models/filtered?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(await readApiError(res));
      return res.json();
    },
    retry: false,
  });

  const { data: providersData } = useQuery({
    queryKey: ["/api/admin/models/providers/list", modelsScope],
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/models/providers/list?scope=${modelsScope}`, { credentials: "include" });
      if (!res.ok) throw new Error(await readApiError(res));
      return res.json();
    },
    retry: false,
  });

  const providers = Array.isArray(providersData) ? providersData : [];

  const handleSearch = (value: string) => {
    setSearch(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 500);
  };

  const syncAll = async () => {
    setIsSyncing(true);
    try {
      const res = await apiFetch(`/api/admin/models/sync?scope=${modelsScope}`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        throw new Error(await readApiError(res));
      }

      const payload = await res.json().catch(() => null);

      queryClient.invalidateQueries({ queryKey: ["/api/admin/models/filtered"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
      refetch();

      const summary = payload?.summary;
      const summaryText = summary && typeof summary.totalAdded === "number" && typeof summary.totalUpdated === "number"
        ? `+${summary.totalAdded} nuevos, ${summary.totalUpdated} actualizados`
        : "Sincronizacion completada";
      toast.success(`Modelos sincronizados: ${summaryText}`);
    } catch (error: any) {
      toast.error(error?.message ? `Sincronizacion fallida: ${error.message}` : "Sincronizacion fallida");
    } finally {
      setIsSyncing(false);
    }
  };

  const checkHealth = async () => {
    setIsCheckingHealth(true);
    try {
      const res = await apiFetch(`/api/admin/models/health`, { credentials: "include" });
      if (!res.ok) {
        throw new Error(await readApiError(res));
      }
      const payload = await res.json();
      setHealth(payload);
      const status = payload?.status || "unknown";
      toast.success(`Health check: ${status}`);
    } catch (error: any) {
      toast.error(error?.message ? `Health check fallido: ${error.message}` : "Health check fallido");
    } finally {
      setIsCheckingHealth(false);
    }
  };

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await apiFetch(`/api/admin/models/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include"
      });
      if (!res.ok) {
        throw new Error(await readApiError(res));
      }
      return res.json();
    },
    onMutate: async ({ id, updates }: { id: string; updates: any }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/admin/models/filtered"] });
      const previous = queryClient.getQueriesData({ queryKey: ["/api/admin/models/filtered"] });

      // Optimistic: update model row so switches feel instant.
      queryClient.setQueriesData({ queryKey: ["/api/admin/models/filtered"] }, (old: any) => {
        if (!old?.models || !Array.isArray(old.models)) return old;
        const applied = { ...updates };
        if (typeof updates?.status === "string" && updates.status !== "active") {
          applied.isEnabled = "false";
          applied.enabledAt = null;
          applied.enabledByAdminId = null;
        }
        return {
          ...old,
          models: old.models.map((m: any) => (m.id === id ? { ...m, ...applied } : m)),
        };
      });

      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models/filtered"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
      refetch();
    },
    onError: (error: any, _variables: any, context: any) => {
      if (context?.previous) {
        for (const [key, data] of context.previous) {
          queryClient.setQueryData(key, data);
        }
      }
      toast.error(error?.message ? `No se pudo actualizar: ${error.message}` : "No se pudo actualizar");
    }
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await apiFetch(`/api/admin/models/${id}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: enabled }),
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(await readApiError(res));
      }
      return res.json();
    },
    onMutate: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/admin/models/filtered"] });
      const previous = queryClient.getQueriesData({ queryKey: ["/api/admin/models/filtered"] });

      queryClient.setQueriesData({ queryKey: ["/api/admin/models/filtered"] }, (old: any) => {
        if (!old?.models || !Array.isArray(old.models)) return old;
        return {
          ...old,
          models: old.models.map((m: any) => (m.id === id ? { ...m, isEnabled: enabled ? "true" : "false" } : m)),
        };
      });

      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models/filtered"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
      refetch();
    },
    onError: (error: any, _variables: any, context: any) => {
      if (context?.previous) {
        for (const [key, data] of context.previous) {
          queryClient.setQueryData(key, data);
        }
      }
      toast.error(error?.message ? `No se pudo actualizar: ${error.message}` : "No se pudo actualizar");
    }
  });

  const testModelMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const res = await apiFetch(`/api/admin/models/${id}/test`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await readApiError(res));
      return res.json();
    },
    onMutate: ({ id }: { id: string }) => {
      setTestingModelId(id);
    },
    onSettled: () => {
      setTestingModelId(null);
    },
    onSuccess: (payload: any) => {
      if (payload?.success) {
        const latency = typeof payload.latency === "number" ? `${payload.latency}ms` : "";
        toast.success(`Test OK: ${payload.model || "modelo"} ${latency}`.trim());
      } else {
        toast.error(payload?.error ? `Test fallido: ${payload.error}` : "Test fallido");
      }
    },
    onError: (error: any) => {
      toast.error(error?.message ? `Test fallido: ${error.message}` : "Test fallido");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/admin/models/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        throw new Error(await readApiError(res));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models/filtered"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
      refetch();
      toast.success("Modelo eliminado");
    },
    onError: (error: any) => {
      toast.error(error?.message ? `No se pudo eliminar: ${error.message}` : "No se pudo eliminar");
    },
  });

  const providerColors: Record<string, string> = {
    anthropic: "bg-orange-500/10 text-orange-600 border-orange-500/30",
    google: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    xai: "bg-purple-500/10 text-purple-600 border-purple-500/30",
    openai: "bg-green-500/10 text-green-600 border-green-500/30",
    openrouter: "bg-cyan-500/10 text-cyan-600 border-cyan-500/30",
    perplexity: "bg-pink-500/10 text-pink-600 border-pink-500/30"
  };

  const typeColors: Record<string, string> = {
    TEXT: "bg-gray-500/10 text-gray-600",
    IMAGE: "bg-purple-500/10 text-purple-600",
    EMBEDDING: "bg-blue-500/10 text-blue-600",
    AUDIO: "bg-yellow-500/10 text-yellow-600",
    VIDEO: "bg-red-500/10 text-red-600",
    MULTIMODAL: "bg-gradient-to-r from-purple-500/10 to-blue-500/10 text-purple-600"
  };

  const models = modelsData?.models || [];
  const pagination = {
    page: modelsData?.page || 1,
    totalPages: modelsData?.totalPages || 1,
    total: modelsData?.total || 0
  };

  const MetricCardSkeleton = () => (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-md bg-muted animate-pulse w-9 h-9" />
        <div className="h-4 w-24 bg-muted animate-pulse rounded" />
      </div>
      <div className="h-8 w-16 bg-muted animate-pulse rounded" />
    </div>
  );

  const TableRowSkeleton = () => (
    <tr className="border-b">
      <td className="p-3"><div className="space-y-1"><div className="h-4 w-32 bg-muted animate-pulse rounded" /><div className="h-3 w-24 bg-muted animate-pulse rounded" /></div></td>
      <td className="p-3"><div className="h-5 w-16 bg-muted animate-pulse rounded" /></td>
      <td className="p-3"><div className="h-5 w-14 bg-muted animate-pulse rounded" /></td>
      <td className="p-3"><div className="h-4 w-20 bg-muted animate-pulse rounded" /></td>
      <td className="p-3"><div className="h-5 w-10 bg-muted animate-pulse rounded-full" /></td>
      <td className="p-3"><div className="h-5 w-9 bg-muted animate-pulse rounded-full" /></td>
      <td className="p-3"><div className="h-4 w-24 bg-muted animate-pulse rounded" /></td>
      <td className="p-3"><div className="h-7 w-7 bg-muted animate-pulse rounded" /></td>
    </tr>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium" data-testid="text-ai-models-title">AI Models</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={checkHealth}
            disabled={isCheckingHealth}
            className="gap-2"
            data-testid="button-models-health"
          >
            {isCheckingHealth ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Salud
          </Button>
          <Button
            size="sm"
            onClick={syncAll}
            disabled={isSyncing}
            className="gap-2"
            data-testid="button-sync-all"
          >
            {isSyncing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sincronizando...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Sincronizar Todo
              </>
            )}
          </Button>
        </div>
      </div>

      {(statsIsError || modelsIsError) && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive" data-testid="banner-models-error">
          {statsIsError ? `Estadisticas: ${(statsError as any)?.message || "Error"}` : ""}
          {statsIsError && modelsIsError ? " | " : ""}
          {modelsIsError ? `Modelos: ${(modelsError as any)?.message || "Error"}` : ""}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            <div className="rounded-lg border p-4" data-testid="card-total-models">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-md bg-purple-500/10">
                  <Bot className="h-4 w-4 text-purple-500" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Total Modelos</span>
              </div>
              <p className="text-2xl font-bold" data-testid="text-total-models-count">{stats?.total || 0}</p>
            </div>

            <div className="rounded-lg border p-4" data-testid="card-enabled-models">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-md bg-green-500/10">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Habilitados</span>
              </div>
              <p className="text-2xl font-bold text-green-600" data-testid="text-enabled-models-count">{stats?.enabled || 0}</p>
            </div>

            <div className="rounded-lg border p-4" data-testid="card-disabled-models">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-md bg-red-500/10">
                  <X className="h-4 w-4 text-red-500" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Deshabilitados</span>
              </div>
              <p className="text-2xl font-bold text-red-600" data-testid="text-disabled-models-count">{stats?.disabled || 0}</p>
            </div>

            <div className="rounded-lg border p-4" data-testid="card-providers">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-md bg-blue-500/10">
                  <HardDrive className="h-4 w-4 text-blue-500" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Proveedores</span>
              </div>
              <p className="text-2xl font-bold" data-testid="text-providers-count">{stats?.providers || 0}</p>
            </div>
          </>
        )}
      </div>

      {!statsLoading && (
        <div className="text-xs text-muted-foreground" data-testid="text-models-status-summary">
          Status: {stats?.active || 0} activos / {stats?.inactive || 0} inactivos
        </div>
      )}

      {health && (
        <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border bg-muted/30 text-xs" data-testid="card-models-health">
          <Badge variant="outline" className="text-xs">{String(health.status || "unknown")}</Badge>
          {Object.entries(health.providers || {}).map(([id, p]: any) => (
            <div key={id} className="flex items-center gap-2">
              <span className="font-medium">{id}</span>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs border",
                  p?.available ? "bg-green-500/10 text-green-600 border-green-500/30" : p?.hasApiKey ? "bg-red-500/10 text-red-600 border-red-500/30" : "bg-gray-500/10 text-gray-600 border-gray-500/30"
                )}
              >
                {p?.available ? `OK${typeof p?.latencyMs === "number" ? ` ${p.latencyMs}ms` : ""}` : p?.hasApiKey ? "DOWN" : "NO KEY"}
              </Badge>
              {p?.error && <span className="text-muted-foreground truncate max-w-[240px]" title={p.error}>{p.error}</span>}
            </div>
          ))}
          <span className="ml-auto text-muted-foreground">
            {health.checkedAt ? formatZonedDateTime(health.checkedAt, { timeZone: platformTimeZone, dateFormat: platformDateFormat }) : ""}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar modelos..."
            className="pl-9 h-9"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            data-testid="input-search-models"
          />
        </div>

        <Select
          value={modelsScope}
          onValueChange={(v) => {
            const scope = v as "supported" | "integrated" | "all";
            setModelsScope(scope);
            setProviderFilter("all");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[160px] h-9" data-testid="select-models-scope">
            <SelectValue placeholder="Scope" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="integrated">Integrados</SelectItem>
            <SelectItem value="supported">Soportados</SelectItem>
            <SelectItem value="all">Todos</SelectItem>
          </SelectContent>
        </Select>

        <Select value={providerFilter} onValueChange={(v) => { setProviderFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[140px] h-9" data-testid="select-provider-filter">
            <SelectValue placeholder="Proveedor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {providers.map((p: any) => (
              <SelectItem key={p.id} value={p.id}>{p.name || p.id}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[140px] h-9" data-testid="select-type-filter">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="TEXT">TEXT</SelectItem>
            <SelectItem value="IMAGE">IMAGE</SelectItem>
            <SelectItem value="EMBEDDING">EMBEDDING</SelectItem>
            <SelectItem value="AUDIO">AUDIO</SelectItem>
            <SelectItem value="VIDEO">VIDEO</SelectItem>
            <SelectItem value="MULTIMODAL">MULTIMODAL</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[130px] h-9" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Activo</SelectItem>
            <SelectItem value="inactive">Inactivo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isSyncing && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          <span className="text-sm text-blue-600">Sincronizando modelos con proveedores...</span>
        </div>
      )}

      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left p-3 font-medium">Modelo</th>
                <th className="text-left p-3 font-medium">Proveedor</th>
                <th className="text-left p-3 font-medium">Tipo</th>
                <th className="text-left p-3 font-medium">Context Window</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Activo</th>
                <th className="text-left p-3 font-medium">Última Sync</th>
                <th className="text-right p-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <>
                  <TableRowSkeleton />
                  <TableRowSkeleton />
                  <TableRowSkeleton />
                  <TableRowSkeleton />
                  <TableRowSkeleton />
                </>
              ) : models.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Bot className="h-8 w-8 text-muted-foreground/50" />
                      <p>
                        No hay modelos{" "}
                        {debouncedSearch || providerFilter !== "all" || typeFilter !== "all" || statusFilter !== "all"
                          ? "que coincidan con los filtros"
                          : modelsScope === "integrated"
                            ? "integrados (configura API keys)"
                            : modelsScope === "supported"
                              ? "soportados"
                              : "configurados"}
                      </p>
                      {!debouncedSearch && providerFilter === "all" && typeFilter === "all" && statusFilter === "all" && (
                        <Button variant="outline" size="sm" onClick={syncAll} disabled={isSyncing} className="mt-2" data-testid="button-sync-empty">
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Sincronizar modelos
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                models.map((model: any) => (
                  <tr key={model.id} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-model-${model.id}`}>
                    <td className="p-3">
                      <div>
                        <p className="font-medium">{model.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{model.modelId}</p>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn("text-xs border", providerColors[model.provider?.toLowerCase()] || "bg-gray-500/10 text-gray-600 border-gray-500/30")}
                          data-testid={`badge-provider-${model.id}`}
                        >
                          {model.provider}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs border",
                            model.isSupported === false ? "bg-red-500/10 text-red-600 border-red-500/30" :
                              model.isIntegrated === false ? "bg-amber-500/10 text-amber-700 border-amber-500/30" :
                                model.isChatCapable === false ? "bg-amber-500/10 text-amber-700 border-amber-500/30" :
                                  "bg-green-500/10 text-green-600 border-green-500/30"
                          )}
                          title={
                            model.isSupported === false ? "Proveedor no soportado por el runtime" :
                              model.isIntegrated === false ? "API key no configurada para este proveedor" :
                                model.isChatCapable === false ? "Modelo no compatible con chat (solo TEXT/MULTIMODAL gemini*/grok*)" :
                                  "Integrado"
                          }
                        >
                          {model.isSupported === false ? "UNSUPPORTED" : model.isIntegrated === false ? "NO KEY" : model.isChatCapable === false ? "NO CHAT" : "OK"}
                        </Badge>
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge
                        variant="secondary"
                        className={cn("text-xs", typeColors[model.modelType || model.type] || "bg-gray-500/10 text-gray-600")}
                        data-testid={`badge-type-${model.id}`}
                      >
                        {model.modelType || model.type || "TEXT"}
                      </Badge>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {model.contextWindow ? `${model.contextWindow.toLocaleString()} tokens` : "-"}
                    </td>
                    <td className="p-3">
                      <Switch
                        checked={model.status === "active"}
                        onCheckedChange={(checked) => updateMutation.mutate({
                          id: model.id,
                          updates: { status: checked ? "active" : "inactive" }
                        })}
                        disabled={updateMutation.isPending}
                        data-testid={`switch-status-${model.id}`}
                      />
                    </td>
                    <td className="p-3">
                      <Switch
                        checked={model.isEnabled === "true"}
                        onCheckedChange={(checked) => toggleEnabledMutation.mutate({ id: model.id, enabled: checked })}
                        disabled={
                          toggleEnabledMutation.isPending ||
                          (model.isEnabled !== "true" && (model.isIntegrated !== true || model.isChatCapable === false || model.status !== "active"))
                        }
                        className={model.isEnabled === "true" ? "data-[state=checked]:bg-green-500" : ""}
                        data-testid={`switch-enabled-${model.id}`}
                        title={
                          model.isEnabled !== "true" && model.status !== "active" ? "Activa el modelo primero (Status)" :
                            model.isIntegrated === false && model.isEnabled !== "true" ? "API key no configurada para este proveedor" :
                              model.isChatCapable === false && model.isEnabled !== "true" ? "Modelo no compatible con chat (solo TEXT/MULTIMODAL gemini*/grok*)" :
                                undefined
                        }
                      />
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {model.lastSyncAt ? formatZonedDateTime(model.lastSyncAt, { timeZone: platformTimeZone, dateFormat: platformDateFormat }) : "Never"}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => testModelMutation.mutate({ id: model.id })}
                          disabled={testModelMutation.isPending || model.isIntegrated !== true || model.isChatCapable !== true}
                          data-testid={`button-test-model-${model.id}`}
                          title={
                            model.isIntegrated !== true ? "Configura API key para testear" :
                              model.isChatCapable !== true ? "Modelo no compatible con chat" :
                                "Testear modelo"
                          }
                        >
                          {testModelMutation.isPending && testingModelId === model.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => {
                            const ok = window.confirm(`Eliminar modelo '${model.name}' (${model.modelId})?`);
                            if (!ok) return;
                            deleteMutation.mutate(model.id);
                          }}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-model-${model.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!isLoading && models.length > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground" data-testid="text-pagination-info">
            Showing {((pagination.page - 1) * 15) + 1} to {Math.min(pagination.page * 15, pagination.total)} of {pagination.total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              data-testid="button-prev-page"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPage(p => p + 1)}
              data-testid="button-next-page"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentsSection() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"all" | "unmatched">("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState<string>("all");
  const [currency, setCurrency] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [sortBy, setSortBy] = useState<"createdAt" | "amount">("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [syncJobId, setSyncJobId] = useState<string | null>(null);
  const [detailsPaymentId, setDetailsPaymentId] = useState<string | null>(null);
  const [assignEmail, setAssignEmail] = useState("");

  const [isHydrated, setIsHydrated] = useState(false);
  const didInitRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const pageParam = Number(params.get("pay_page") || "");
    if (Number.isFinite(pageParam) && pageParam >= 1) setPage(Math.floor(pageParam));

    const limitParam = Number(params.get("pay_limit") || "");
    if (Number.isFinite(limitParam) && [20, 50, 100].includes(limitParam)) setLimit(limitParam);

    const viewParam = params.get("pay_view");
    if (viewParam === "unmatched" || viewParam === "all") setView(viewParam);

    const statusParam = params.get("pay_status");
    if (statusParam && ["all", "completed", "pending", "failed", "refunded", "disputed"].includes(statusParam)) setStatus(statusParam);

    const currencyParam = params.get("pay_currency");
    if (currencyParam) {
      setCurrency(currencyParam.toLowerCase() === "all" ? "all" : currencyParam.toUpperCase());
    }

    const searchParam = params.get("pay_search");
    if (typeof searchParam === "string") setSearch(searchParam);

    const fromParam = params.get("pay_from");
    if (fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)) setDateFrom(fromParam);

    const toParam = params.get("pay_to");
    if (toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) setDateTo(toParam);

    const minParam = params.get("pay_min");
    if (typeof minParam === "string") setMinAmount(minParam);

    const maxParam = params.get("pay_max");
    if (typeof maxParam === "string") setMaxAmount(maxParam);

    const sortByParam = params.get("pay_sortBy");
    if (sortByParam === "amount" || sortByParam === "createdAt") setSortBy(sortByParam);

    const sortOrderParam = params.get("pay_sortOrder");
    if (sortOrderParam === "asc" || sortOrderParam === "desc") setSortOrder(sortOrderParam);

    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    if (!didInitRef.current) {
      didInitRef.current = true;
      return;
    }
    setPage(1);
  }, [isHydrated, view, limit, status, currency, search, dateFrom, dateTo, minAmount, maxAmount, sortBy, sortOrder]);

  useEffect(() => {
    if (!isHydrated) return;

    const params = new URLSearchParams(window.location.search);
    const setOrDelete = (key: string, value: string, defaultValue?: string) => {
      if (!value || value === defaultValue) params.delete(key);
      else params.set(key, value);
    };

    setOrDelete("pay_page", String(page), "1");
    setOrDelete("pay_limit", String(limit), "20");
    setOrDelete("pay_view", view, "all");
    setOrDelete("pay_status", status, "all");
    setOrDelete("pay_currency", currency, "all");
    setOrDelete("pay_search", search.trim(), "");
    setOrDelete("pay_from", dateFrom, "");
    setOrDelete("pay_to", dateTo, "");
    setOrDelete("pay_min", minAmount, "");
    setOrDelete("pay_max", maxAmount, "");
    setOrDelete("pay_sortBy", sortBy, "createdAt");
    setOrDelete("pay_sortOrder", sortOrder, "desc");

    const qs = params.toString();
    const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }, [isHydrated, page, limit, view, status, currency, search, dateFrom, dateTo, minAmount, maxAmount, sortBy, sortOrder]);

  const buildPaymentsFilterParams = () => {
    const params = new URLSearchParams();
    if (status && status !== "all") params.set("status", status);
    if (currency && currency !== "all") params.set("currency", currency);
    if (search.trim()) params.set("search", search.trim());
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (minAmount.trim()) params.set("minAmount", minAmount.trim());
    if (maxAmount.trim()) params.set("maxAmount", maxAmount.trim());
    return params;
  };

  const buildPaymentsListParams = () => {
    const params = buildPaymentsFilterParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (sortBy !== "createdAt") params.set("sortBy", sortBy);
    if (sortOrder !== "desc") params.set("sortOrder", sortOrder);
    return params;
  };

  const formatMoney = (value: any, currency?: string | null) => {
    const cur = String(currency || "").toUpperCase().trim();
    const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));

    if (!Number.isFinite(n)) {
      return cur ? `${String(value ?? "-")} ${cur}` : String(value ?? "-");
    }

    if (cur) {
      try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(n);
      } catch {
        // Ignore invalid currency codes and fall back.
      }
    }

    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copiado al portapapeles");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  const paymentsEndpoint = view === "unmatched" ? "/api/admin/finance/payments/unmatched" : "/api/admin/finance/payments";

  const {
    data: paymentsData,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: [paymentsEndpoint, page, limit, status, currency, search, dateFrom, dateTo, minAmount, maxAmount, sortBy, sortOrder],
    queryFn: async () => {
      const params = buildPaymentsListParams();
      const res = await apiFetch(`${paymentsEndpoint}?${params.toString()}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to fetch payments");
      }
      return res.json();
    }
  });

  const payments = paymentsData?.payments || [];
  const pagination = paymentsData?.pagination || { page, limit, total: payments.length, totalPages: 1 };

  const { data: stats } = useQuery({
    queryKey: ["/api/admin/finance/payments/stats", status, currency, search, dateFrom, dateTo, minAmount, maxAmount],
    queryFn: async () => {
      const params = buildPaymentsFilterParams();
      const qs = params.toString();
      return adminFetch(`/api/admin/finance/payments/stats${qs ? `?${qs}` : ""}`);
    }
  });

  const syncStripeMutation = useMutation({
    mutationFn: async () => {
      const payload: any = { maxInvoices: 200, async: true };
      if (dateFrom) payload.dateFrom = dateFrom;
      if (dateTo) payload.dateTo = dateTo;

      const res = await apiFetch("/api/admin/finance/payments/sync-stripe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || "Stripe sync failed");
      }
      return body;
    },
    onSuccess: (data) => {
      if (data?.async && data?.jobId) {
        setSyncJobId(String(data.jobId));
        toast.success("Sincronización en cola. Mostrando progreso...");
        return;
      }

      const created = Number(data?.created || 0);
      const updated = Number(data?.updated || 0);
      const errors = Number(data?.errors || 0);
      const unmatched = Array.isArray(data?.unmatchedInvoiceIds) ? data.unmatchedInvoiceIds.length : 0;

      const parts = [
        `Stripe sincronizado: ${data?.synced || 0} pagos`,
        created || updated ? `(${created} creados, ${updated} actualizados)` : null,
        errors ? `${errors} errores` : null,
        unmatched ? `${unmatched} sin usuario` : null,
      ].filter(Boolean);

      toast.success(parts.join(" • "));
      queryClient.invalidateQueries({ queryKey: ["/api/admin/finance/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/finance/payments/unmatched"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/finance/payments/stats"] });
    },
    onError: (err: any) => {
      toast.error(String(err?.message || err || "Stripe sync failed"));
    }
  });

  const { data: syncJob } = useQuery({
    queryKey: ["/api/admin/finance/payments/sync-stripe/jobs", syncJobId],
    enabled: !!syncJobId,
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/finance/payments/sync-stripe/jobs/${syncJobId}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Failed to fetch sync job");
      return body;
    },
    refetchInterval: (q) => {
      const state = (q as any)?.state;
      if (!state) return 2000;
      if (state === "completed" || state === "failed") return false;
      return 2000;
    },
  });

  useEffect(() => {
    if (!syncJobId) return;
    const state = (syncJob as any)?.state;
    if (state === "completed") {
      const result = (syncJob as any)?.returnvalue;
      const created = Number(result?.created || 0);
      const updated = Number(result?.updated || 0);
      const errors = Number(result?.errors || 0);
      const unmatched = Array.isArray(result?.unmatchedInvoiceIds) ? result.unmatchedInvoiceIds.length : 0;
      const parts = [
        `Stripe sincronizado: ${result?.synced || 0} pagos`,
        created || updated ? `(${created} creados, ${updated} actualizados)` : null,
        errors ? `${errors} errores` : null,
        unmatched ? `${unmatched} sin usuario` : null,
      ].filter(Boolean);
      toast.success(parts.join(" • "));
      setSyncJobId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/finance/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/finance/payments/unmatched"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/finance/payments/stats"] });
    } else if (state === "failed") {
      toast.error(String((syncJob as any)?.failedReason || "Stripe sync failed"));
      setSyncJobId(null);
    }
  }, [syncJobId, syncJob, queryClient]);

  const { data: paymentDetails, isLoading: isDetailsLoading } = useQuery({
    queryKey: ["/api/admin/finance/payments/detail", detailsPaymentId],
    enabled: !!detailsPaymentId,
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/finance/payments/${detailsPaymentId}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Failed to fetch payment");
      return body;
    }
  });

  const assignUserMutation = useMutation({
    mutationFn: async () => {
      if (!detailsPaymentId) throw new Error("Missing payment id");
      const email = assignEmail.trim();
      if (!email) throw new Error("Ingresa un email");

      const res = await apiFetch(`/api/admin/finance/payments/${detailsPaymentId}/assign-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Failed to assign payment");
      return body;
    },
    onSuccess: () => {
      toast.success("Pago conciliado con el usuario");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/finance/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/finance/payments/unmatched"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/finance/payments/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/finance/payments/detail", detailsPaymentId] });
    },
    onError: (err: any) => {
      toast.error(String(err?.message || err || "Failed to assign payment"));
    }
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-medium">Payments</h2>
            <p className="text-xs text-muted-foreground">
              Vista basada en BD. Usa sincronización con Stripe para backfill si faltan registros.
            </p>
            <Tabs value={view} onValueChange={(v) => setView(v as any)} className="mt-2">
              <TabsList>
                <TabsTrigger value="all">Todos</TabsTrigger>
                <TabsTrigger value="unmatched">Sin usuario</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled>
              <RefreshCw className="h-4 w-4 mr-2" />
              Actualizar
            </Button>
            <Button variant="outline" size="sm" disabled>
              <Download className="h-4 w-4 mr-2" />
              Exportar
            </Button>
            <Button size="sm" disabled>
              <RotateCcw className="h-4 w-4 mr-2" />
              Sincronizar Stripe
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-4 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-28" />
            </div>
          ))}
        </div>

        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <Skeleton className="h-9 w-full max-w-[420px]" />
            <Skeleton className="h-9 w-full max-w-[520px]" />
          </div>
        </div>

        <TableSkeleton rows={6} columns={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border p-4 bg-destructive/10 text-destructive">
        <p className="font-medium">No se pudieron cargar los pagos</p>
        <p className="text-sm mt-1">{String((error as any)?.message || error || "")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
          Reintentar
        </Button>
      </div>
    );
  }

  const statsCurrencies: string[] = stats?.currencies || (stats?.byCurrency ? Object.keys(stats.byCurrency) : []);
  const primaryCurrency: string | null =
    stats?.primaryCurrency || (statsCurrencies.length === 1 ? statsCurrencies[0] : null);

  const renderStatsAmount = (key: "total" | "thisMonth" | "pendingTotal") => {
    if (!stats) return "-";

    if (primaryCurrency) {
      return (
        <p className="text-xl font-semibold tabular-nums" data-testid={key === "total" ? "text-total-payments" : undefined}>
          {formatMoney(stats?.[key] || "0", primaryCurrency)}
        </p>
      );
    }

    if (statsCurrencies.length > 1 && stats?.byCurrency) {
      return (
        <div className="space-y-0.5">
          {statsCurrencies.slice(0, 3).map((cur) => (
            <p key={cur} className="text-sm font-semibold tabular-nums">
              {cur} {formatMoney(stats.byCurrency?.[cur]?.[key] || "0", cur)}
            </p>
          ))}
          {statsCurrencies.length > 3 && (
            <p className="text-xs text-muted-foreground">+{statsCurrencies.length - 3} monedas</p>
          )}
        </div>
      );
    }

    return <p className="text-xl font-semibold tabular-nums">{formatMoney(stats?.[key] || "0", "EUR")}</p>;
  };

  const buildExportUrl = (format: "csv" | "xlsx") => {
    const params = buildPaymentsFilterParams();
    if (sortBy !== "createdAt") params.set("sortBy", sortBy);
    if (sortOrder !== "desc") params.set("sortOrder", sortOrder);
    params.set("format", format);
    return `/api/admin/finance/payments/export?${params.toString()}`;
  };

  const exportCsvUrl = buildExportUrl("csv");
  const exportXlsxUrl = buildExportUrl("xlsx");

  const toggleSort = (next: "createdAt" | "amount") => {
    if (sortBy !== next) {
      setSortBy(next);
      setSortOrder("desc");
      return;
    }
    setSortOrder((o) => (o === "desc" ? "asc" : "desc"));
  };

  const renderStatusBadge = (s: string) => {
    const st = String(s || "").toLowerCase();
    if (st === "completed") return <Badge>Completado</Badge>;
    if (st === "pending") return <Badge variant="secondary">Pendiente</Badge>;
    if (st === "refunded") return <Badge variant="secondary" className="bg-muted text-foreground">Reembolsado</Badge>;
    if (st === "disputed") return <Badge variant="secondary" className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-300">Disputa</Badge>;
    if (st === "failed") return <Badge variant="destructive">Fallido</Badge>;
    return <Badge variant="secondary">{st || "N/A"}</Badge>;
  };

  const syncState = String((syncJob as any)?.state || "");
  const syncProgress = (syncJob as any)?.progress;
  const progressSynced = Number(syncProgress?.synced ?? 0);
  const progressMax = Number(syncProgress?.maxInvoices ?? 0);
  const progressPct = progressMax > 0 ? Math.min(100, Math.round((progressSynced / progressMax) * 100)) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-medium">Payments</h2>
          <p className="text-xs text-muted-foreground">
            Vista basada en BD. Usa sincronización con Stripe para backfill si faltan registros.
          </p>
          <Tabs value={view} onValueChange={(v) => setView(v as any)} className="mt-2">
            <TabsList>
              <TabsTrigger value="all">Todos</TabsTrigger>
              <TabsTrigger value="unmatched">Sin usuario</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-payments"
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", isFetching && "animate-spin")} />
            Actualizar
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1" disabled={view !== "all"} data-testid="button-export-payments">
                <Download className="h-4 w-4" />
                Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => window.open(exportCsvUrl, "_blank")}>CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(exportXlsxUrl, "_blank")}>Excel (.xlsx)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            onClick={() => syncStripeMutation.mutate()}
            disabled={syncStripeMutation.isPending || !!syncJobId}
            data-testid="button-sync-stripe"
          >
            <RotateCcw className={cn("h-4 w-4 mr-2", (syncStripeMutation.isPending || !!syncJobId) && "animate-spin")} />
            {syncJobId ? "Sincronizando..." : "Sincronizar Stripe"}
          </Button>
        </div>
      </div>

      {!!syncJobId && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="space-y-1">
              <p className="text-sm font-medium">Sincronización Stripe en progreso</p>
              <p className="text-xs text-muted-foreground">
                Estado: {syncState || "..."}. Sincronizados: {progressSynced}{progressMax ? `/${progressMax}` : ""}.
              </p>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">{progressPct}%</div>
          </div>
          <Progress value={progressPct} />
        </div>
      )}

      {view === "all" && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground mb-1">Total ingresos</p>
            {renderStatsAmount("total")}
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground mb-1">Este mes</p>
            {renderStatsAmount("thisMonth")}
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground mb-1">Transacciones</p>
            <p className="text-xl font-semibold tabular-nums">{stats?.count || 0}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground mb-1">Pendientes</p>
            {renderStatsAmount("pendingTotal")}
            <p className="text-xs text-muted-foreground mt-1">{stats?.pendingCount || 0} pagos</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground mb-1">Reembolsos</p>
            <p className="text-xl font-semibold tabular-nums">{formatMoney(stats?.refundedTotal || "0", primaryCurrency || "EUR")}</p>
            <p className="text-xs text-muted-foreground mt-1">{stats?.refundedCount || 0} pagos</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground mb-1">Disputas</p>
            <p className="text-xl font-semibold tabular-nums">{formatMoney(stats?.disputedTotal || "0", primaryCurrency || "EUR")}</p>
            <p className="text-xs text-muted-foreground mt-1">{stats?.disputedCount || 0} pagos</p>
          </div>
        </div>
      )}

      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por email, userId, Stripe invoice/customer/intent/charge..."
              className="pl-9 h-9"
              data-testid="input-search-payments"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-[160px]" data-testid="select-payment-status">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="completed">Completados</SelectItem>
                <SelectItem value="pending">Pendientes</SelectItem>
                <SelectItem value="failed">Fallidos</SelectItem>
                <SelectItem value="refunded">Reembolsados</SelectItem>
                <SelectItem value="disputed">Disputa</SelectItem>
              </SelectContent>
            </Select>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="h-9 w-[130px]" data-testid="select-payment-currency">
                <SelectValue placeholder="Moneda" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {statsCurrencies.map((cur) => (
                  <SelectItem key={cur} value={cur}>
                    {cur}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              placeholder="Min"
              className="h-9 w-[100px]"
              data-testid="input-payments-min"
            />
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              placeholder="Max"
              className="h-9 w-[100px]"
              data-testid="input-payments-max"
            />
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 w-[150px]"
              data-testid="input-payments-from"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 w-[150px]"
              data-testid="input-payments-to"
            />
            <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
              <SelectTrigger className="h-9 w-[110px]" data-testid="select-payment-limit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">20 / pág</SelectItem>
                <SelectItem value="50">50 / pág</SelectItem>
                <SelectItem value="100">100 / pág</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={() => {
                setSearch("");
                setStatus("all");
                setCurrency("all");
                setDateFrom("");
                setDateTo("");
                setMinAmount("");
                setMaxAmount("");
                setSortBy("createdAt");
                setSortOrder("desc");
              }}
              data-testid="button-clear-payment-filters"
            >
              <X className="h-4 w-4 mr-2" />
              Limpiar
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border">
        <div className="grid grid-cols-6 gap-4 p-3 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
          <span>ID</span>
          <span>Usuario</span>
          <button
            type="button"
            className="flex items-center gap-1 text-left hover:text-foreground"
            onClick={() => toggleSort("amount")}
            data-testid="button-sort-payments-amount"
          >
            Cantidad
            {sortBy === "amount" && (
              sortOrder === "asc"
                ? <ChevronUp className="h-3.5 w-3.5" />
                : <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            className="flex items-center gap-1 text-left hover:text-foreground"
            onClick={() => toggleSort("createdAt")}
            data-testid="button-sort-payments-date"
          >
            Fecha
            {sortBy === "createdAt" && (
              sortOrder === "asc"
                ? <ChevronUp className="h-3.5 w-3.5" />
                : <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
          <span>Estado</span>
          <span className="text-right">Stripe</span>
        </div>
        {payments.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center space-y-2">
            <p>No hay pagos registrados</p>
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => syncStripeMutation.mutate()}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Sincronizar Stripe
              </Button>
            </div>
          </div>
        ) : (
          payments.map((payment: any) => (
            <div
              key={payment.id}
              className="grid grid-cols-6 gap-4 p-3 border-b last:border-0 items-center text-sm cursor-pointer hover:bg-muted/30"
              role="button"
              tabIndex={0}
              onClick={() => setDetailsPaymentId(payment.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setDetailsPaymentId(payment.id);
              }}
            >
              <span className="font-mono text-xs">{payment.id.slice(0, 8)}</span>
              <div className="min-w-0">
                <p className="truncate">{payment.userEmail || payment.userName || payment.userId || "N/A"}</p>
                {payment.userId && (
                  <p className="text-xs text-muted-foreground font-mono truncate">{String(payment.userId).slice(0, 16)}</p>
                )}
              </div>
              <span className="font-medium tabular-nums">{formatMoney(payment.amountValue ?? payment.amount, payment.currency)}</span>
              <span className="text-muted-foreground">
                {payment.createdAt ? format(new Date(payment.createdAt), "dd MMM yyyy") : "-"}
              </span>
              {renderStatusBadge(payment.status)}
              <div className="flex justify-end">
                {payment.stripePaymentId ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(String(payment.stripePaymentId));
                    }}
                    data-testid={`button-copy-stripe-${payment.id}`}
                    title="Copiar Stripe ID"
                  >
                    <Copy className="h-3.5 w-3.5 mr-1.5" />
                    <span className="text-xs font-mono">{String(payment.stripePaymentId).slice(0, 12)}</span>
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">-</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog
        open={!!detailsPaymentId}
        onOpenChange={(open) => {
          if (!open) {
            setDetailsPaymentId(null);
            setAssignEmail("");
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Detalle de pago</DialogTitle>
          </DialogHeader>

          {isDetailsLoading ? (
            <div className="space-y-4 py-2">
              <Skeleton className="h-6 w-48" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
              <Skeleton className="h-28 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Payment ID</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs">{paymentDetails?.payment?.id}</code>
                    {paymentDetails?.payment?.id && (
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => copyToClipboard(String(paymentDetails.payment.id))}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                <div>{renderStatusBadge(paymentDetails?.payment?.status)}</div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Usuario</p>
                  <p className="text-sm">
                    {paymentDetails?.payment?.userEmail || paymentDetails?.payment?.userName || paymentDetails?.payment?.userId || "Sin usuario"}
                  </p>
                  {paymentDetails?.payment?.userId && (
                    <p className="text-xs text-muted-foreground font-mono mt-1">{String(paymentDetails.payment.userId)}</p>
                  )}
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Importe</p>
                  <p className="text-sm font-medium tabular-nums">
                    {formatMoney(paymentDetails?.payment?.amountValue ?? paymentDetails?.payment?.amount, paymentDetails?.payment?.currency)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {paymentDetails?.payment?.createdAt ? format(new Date(paymentDetails.payment.createdAt), "dd MMM yyyy HH:mm") : "-"}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-xs text-muted-foreground">Stripe</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  {[
                    { label: "Invoice ID", value: paymentDetails?.payment?.stripePaymentId },
                    { label: "Customer ID", value: paymentDetails?.payment?.stripeCustomerId },
                    { label: "PaymentIntent ID", value: paymentDetails?.payment?.stripePaymentIntentId },
                    { label: "Charge ID", value: paymentDetails?.payment?.stripeChargeId },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 p-2">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className="text-xs font-mono truncate">{item.value || "-"}</p>
                      </div>
                      {item.value ? (
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => copyToClipboard(String(item.value))}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              {!!paymentDetails?.invoices?.length && (
                <div className="rounded-lg border p-3 space-y-2">
                  <p className="text-xs text-muted-foreground">Facturas</p>
                  <div className="space-y-2">
                    {paymentDetails.invoices.map((inv: any) => (
                      <div key={inv.id} className="rounded-md border p-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{inv.invoiceNumber}</p>
                          <p className="text-xs text-muted-foreground">
                            {String(inv.currency || "EUR").toUpperCase()} {inv.amountValue ?? inv.amount} • {inv.status}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {inv.createdAt ? format(new Date(inv.createdAt), "dd MMM yyyy") : "-"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {inv.stripeHostedInvoiceUrl && (
                            <Button variant="outline" size="sm" className="h-7" asChild>
                              <a href={inv.stripeHostedInvoiceUrl} target="_blank" rel="noreferrer">
                                Ver
                              </a>
                            </Button>
                          )}
                          {(inv.stripeInvoicePdfUrl || inv.pdfPath) && (
                            <Button variant="outline" size="sm" className="h-7" asChild>
                              <a href={inv.stripeInvoicePdfUrl || inv.pdfPath} target="_blank" rel="noreferrer">
                                PDF
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!paymentDetails?.payment?.userId && (
                <div className="rounded-lg border p-3 space-y-2">
                  <p className="text-xs text-muted-foreground">Conciliar pago con usuario</p>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="email@dominio.com"
                      value={assignEmail}
                      onChange={(e) => setAssignEmail(e.target.value)}
                    />
                    <Button onClick={() => assignUserMutation.mutate()} disabled={assignUserMutation.isPending}>
                      {assignUserMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Asignar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground" data-testid="text-payments-pagination-info">
            Mostrando {((pagination.page - 1) * pagination.limit) + 1} a {Math.min(pagination.page * pagination.limit, pagination.total)} de {pagination.total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              data-testid="button-payments-prev-page"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
              data-testid="button-payments-next-page"
            >
              Siguiente
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function InvoicesSection() {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newInvoice, setNewInvoice] = useState({ invoiceNumber: "", amount: "", userId: "" });

  const { data: invoicesData, isLoading } = useQuery({
    queryKey: ["/api/admin/finance/invoices"],
    queryFn: () => adminFetch("/api/admin/finance/invoices")
  });

  const invoices = invoicesData?.invoices || invoicesData || [];

  const createInvoiceMutation = useMutation({
    mutationFn: async (invoice: any) => {
      const res = await apiFetch("/api/admin/finance/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invoice),
        credentials: "include"
      });
      if (!res.ok) throw new Error("No se pudo crear la factura");
      return res.json().catch(() => ({}));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/finance/invoices"] });
      setShowAddModal(false);
    }
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Invoices ({invoices.length})</h2>
        <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-create-invoice">
              <Plus className="h-4 w-4 mr-2" />
              Crear factura
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear factura</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Número de factura</Label>
                <Input
                  placeholder="INV-2024-001"
                  value={newInvoice.invoiceNumber}
                  onChange={(e) => setNewInvoice({ ...newInvoice, invoiceNumber: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Importe</Label>
                <Input
                  placeholder="99.00"
                  value={newInvoice.amount}
                  onChange={(e) => setNewInvoice({ ...newInvoice, amount: e.target.value })}
                />
              </div>
              <Button
                className="w-full"
                onClick={() => createInvoiceMutation.mutate(newInvoice)}
                disabled={!newInvoice.invoiceNumber || !newInvoice.amount}
              >
                Crear factura
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="rounded-lg border">
        <div className="grid grid-cols-5 gap-4 p-3 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
          <span>Factura</span>
          <span>Cliente</span>
          <span>Importe</span>
          <span>Fecha</span>
          <span>Estado</span>
        </div>
        {invoices.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">No hay facturas</div>
        ) : (
          invoices.map((invoice: any) => (
            <div key={invoice.id} className="grid grid-cols-5 gap-4 p-3 border-b last:border-0 items-center text-sm">
              <span className="font-mono text-xs">{invoice.invoiceNumber}</span>
              <span>{invoice.userId || "N/A"}</span>
              <span className="font-medium">€{invoice.amount}</span>
              <span className="text-muted-foreground">
                {invoice.createdAt ? format(new Date(invoice.createdAt), "dd MMM yyyy") : "-"}
              </span>
              <div className="flex items-center gap-2">
                <Badge variant={invoice.status === "paid" ? "default" : "secondary"}>
                  {invoice.status === "paid" ? "Pagada" : "Pendiente"}
                </Badge>
                <Button variant="ghost" size="sm" className="h-6 px-2" data-testid={`button-download-invoice-${invoice.id}`}>
                  <Download className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AnalyticsSection() {
  return <AnalyticsDashboard />;
}

function DatabaseSection() {
  const [activeTab, setActiveTab] = useState<"health" | "tables" | "query">("health");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [sqlQuery, setSqlQuery] = useState("SELECT * FROM users LIMIT 10");
  const [queryResult, setQueryResult] = useState<any>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const { data: healthData, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: ["/api/admin/database/health"],
    queryFn: () => adminFetch("/api/admin/database/health"),
    refetchInterval: 30000
  });

  const { data: tablesData, isLoading: tablesLoading } = useQuery({
    queryKey: ["/api/admin/database/tables"],
    queryFn: () => adminFetch("/api/admin/database/tables")
  });

  const { data: tableDataResult, isLoading: tableDataLoading } = useQuery({
    queryKey: ["/api/admin/database/tables", selectedTable],
    queryFn: async () => {
      if (!selectedTable) return null;
      return adminFetch(`/api/admin/database/tables/${selectedTable}`);
    },
    enabled: !!selectedTable
  });

  const { data: indexesData } = useQuery({
    queryKey: ["/api/admin/database/indexes"],
    queryFn: () => adminFetch("/api/admin/database/indexes")
  });

  const executeQuery = async () => {
    setIsExecuting(true);
    try {
      const res = await apiFetch("/api/admin/database/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: sqlQuery }),
        credentials: "include"
      });
      const result = await res.json();
      setQueryResult(result);
    } catch (error: any) {
      setQueryResult({ success: false, error: error.message });
    }
    setIsExecuting(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Database Management</h2>
        <Button variant="outline" size="sm" onClick={() => refetchHealth()} data-testid="button-refresh-db">
          <RefreshCw className="h-4 w-4 mr-2" />
          Actualizar
        </Button>
      </div>

      <div className="flex gap-2 border-b">
        <button
          onClick={() => setActiveTab("health")}
          className={cn("px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors", activeTab === "health" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          data-testid="tab-db-health"
        >
          Health & Stats
        </button>
        <button
          onClick={() => setActiveTab("tables")}
          className={cn("px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors", activeTab === "tables" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          data-testid="tab-db-tables"
        >
          Tables Browser
        </button>
        <button
          onClick={() => setActiveTab("query")}
          className={cn("px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors", activeTab === "query" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          data-testid="tab-db-query"
        >
          SQL Query
        </button>
      </div>

      {activeTab === "health" && (
        <div className="space-y-6">
          {healthLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-4">
                <div className="rounded-lg border p-4" data-testid="card-db-status">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Estado</span>
                  </div>
                  <Badge variant={healthData?.status === "healthy" ? "default" : "destructive"} className="text-sm">
                    {healthData?.status === "healthy" ? "Saludable" : "Error"}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-2">Latencia: {healthData?.latencyMs}ms</p>
                </div>
                <div className="rounded-lg border p-4" data-testid="card-db-connections">
                  <div className="flex items-center gap-2 mb-2">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Conexiones</span>
                  </div>
                  <p className="text-2xl font-bold">{healthData?.pool?.active_connections || 0}</p>
                  <p className="text-xs text-muted-foreground">Activas</p>
                </div>
                <div className="rounded-lg border p-4" data-testid="card-db-size">
                  <div className="flex items-center gap-2 mb-2">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Tamaño</span>
                  </div>
                  <p className="text-2xl font-bold">{healthData?.pool?.database_size || "N/A"}</p>
                  <p className="text-xs text-muted-foreground">Total DB</p>
                </div>
                <div className="rounded-lg border p-4" data-testid="card-db-transactions">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Transacciones</span>
                  </div>
                  <p className="text-2xl font-bold">{Number(healthData?.pool?.transactions_committed || 0).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Confirmadas</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border p-4">
                  <h3 className="font-medium mb-4 flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Pool Statistics
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Rows Returned</span>
                      <span>{Number(healthData?.pool?.rows_returned || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Rows Fetched</span>
                      <span>{Number(healthData?.pool?.rows_fetched || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Rows Inserted</span>
                      <span>{Number(healthData?.pool?.rows_inserted || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Rows Updated</span>
                      <span>{Number(healthData?.pool?.rows_updated || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Rows Deleted</span>
                      <span>{Number(healthData?.pool?.rows_deleted || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Blocks Read</span>
                      <span>{Number(healthData?.pool?.blocks_read || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Blocks Hit (Cache)</span>
                      <span>{Number(healthData?.pool?.blocks_hit || 0).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <h3 className="font-medium mb-4 flex items-center gap-2">
                    <Server className="h-4 w-4" />
                    Table Statistics
                  </h3>
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-1 text-sm">
                      {healthData?.tables?.map((table: any) => (
                        <div key={table.table_name} className="flex justify-between py-1 border-b border-dashed last:border-0">
                          <span className="text-muted-foreground truncate max-w-[150px]" title={table.table_name}>{table.table_name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs">{table.row_count} rows</span>
                            <span className="text-xs text-muted-foreground">{table.table_size}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <h3 className="font-medium mb-2">PostgreSQL Version</h3>
                <p className="text-sm text-muted-foreground font-mono">{healthData?.version?.substring(0, 100)}</p>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === "tables" && (
        <div className="space-y-4">
          {tablesLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              <div className="col-span-1 rounded-lg border p-4">
                <h3 className="font-medium mb-4">Tablas ({tablesData?.tables?.length || 0})</h3>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-1">
                    {tablesData?.tables?.map((table: any) => (
                      <button
                        key={table.table_name}
                        onClick={() => setSelectedTable(table.table_name)}
                        className={cn(
                          "w-full text-left px-3 py-2 rounded text-sm transition-colors",
                          selectedTable === table.table_name
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-muted"
                        )}
                        data-testid={`table-select-${table.table_name}`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="truncate">{table.table_name}</span>
                          <span className="text-xs opacity-70">{table.row_count}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              <div className="col-span-3 rounded-lg border p-4">
                {!selectedTable ? (
                  <div className="flex items-center justify-center h-[400px] text-muted-foreground">
                    <div className="text-center">
                      <Database className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Selecciona una tabla para ver sus datos</p>
                    </div>
                  </div>
                ) : tableDataLoading ? (
                  <div className="flex items-center justify-center h-[400px]"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">{selectedTable}</h3>
                      <div className="text-sm text-muted-foreground">
                        {tableDataResult?.pagination?.total || 0} registros
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground flex flex-wrap gap-2 mb-2">
                      {tableDataResult?.columns?.map((col: any) => (
                        <span key={col.column_name} className="bg-muted px-2 py-1 rounded">
                          {col.column_name}: <span className="text-primary">{col.data_type}</span>
                        </span>
                      ))}
                    </div>

                    <ScrollArea className="h-[300px]">
                      <div className="min-w-full">
                        <table className="w-full text-xs">
                          <thead className="bg-muted sticky top-0">
                            <tr>
                              {tableDataResult?.columns?.slice(0, 8).map((col: any) => (
                                <th key={col.column_name} className="px-2 py-1 text-left font-medium truncate max-w-[150px]">
                                  {col.column_name}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {tableDataResult?.data?.map((row: any, idx: number) => (
                              <tr key={idx} className="border-b hover:bg-muted/50">
                                {tableDataResult?.columns?.slice(0, 8).map((col: any) => (
                                  <td key={col.column_name} className="px-2 py-1 truncate max-w-[150px]" title={String(row[col.column_name] ?? "")}>
                                    {row[col.column_name] === null ? <span className="text-muted-foreground">NULL</span> : String(row[col.column_name]).substring(0, 50)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "query" && (
        <div className="space-y-4">
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                SQL Query Explorer
              </h3>
              <Badge variant="outline" className="text-xs">Solo SELECT</Badge>
            </div>
            <textarea
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              className="w-full h-32 font-mono text-sm bg-muted p-4 rounded-lg border-0 resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="SELECT * FROM users LIMIT 10"
              data-testid="input-sql-query"
            />
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-muted-foreground">
                Por seguridad, solo se permiten consultas SELECT
              </p>
              <Button onClick={executeQuery} disabled={isExecuting} data-testid="button-execute-query">
                {isExecuting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                Ejecutar
              </Button>
            </div>
          </div>

          {queryResult && (
            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium">Resultados</h3>
                {queryResult.success && (
                  <div className="text-sm text-muted-foreground">
                    {queryResult.rowCount} filas en {queryResult.executionTimeMs}ms
                  </div>
                )}
              </div>
              {queryResult.success ? (
                <ScrollArea className="h-[300px]">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        {queryResult.columns?.map((col: string) => (
                          <th key={col} className="px-2 py-1 text-left font-medium">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {queryResult.data?.map((row: any, idx: number) => (
                        <tr key={idx} className="border-b hover:bg-muted/50">
                          {queryResult.columns?.map((col: string) => (
                            <td key={col} className="px-2 py-1 truncate max-w-[200px]" title={String(row[col] ?? "")}>
                              {row[col] === null ? <span className="text-muted-foreground">NULL</span> : String(row[col]).substring(0, 100)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              ) : (
                <div className="bg-destructive/10 text-destructive p-4 rounded-lg text-sm">
                  <p className="font-medium mb-1">Error</p>
                  <p>{queryResult.error}</p>
                  {queryResult.hint && <p className="text-xs mt-2 opacity-70">{queryResult.hint}</p>}
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border p-4">
            <h3 className="font-medium mb-4 flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Índices ({indexesData?.indexes?.length || 0})
            </h3>
            <ScrollArea className="h-[150px]">
              <div className="space-y-1 text-xs font-mono">
                {indexesData?.indexes?.map((idx: any, i: number) => (
                  <div key={i} className="flex justify-between py-1 border-b border-dashed">
                    <span className="text-muted-foreground">{idx.tablename}.{idx.indexname}</span>
                    <span>{idx.index_size}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}

const POLICY_TYPES = [
  { value: "cors", label: "CORS", icon: Globe, color: "bg-blue-500" },
  { value: "csp", label: "CSP", icon: FileCode, color: "bg-purple-500" },
  { value: "rate_limit", label: "Rate Limit", icon: Timer, color: "bg-orange-500" },
  { value: "ip_restriction", label: "IP Restriction", icon: Network, color: "bg-red-500" },
  { value: "auth_requirement", label: "Auth Requirement", icon: Lock, color: "bg-green-500" },
  { value: "data_retention", label: "Data Retention", icon: Archive, color: "bg-yellow-500" },
];

const APPLIED_TO_OPTIONS = [
  { value: "global", label: "Global" },
  { value: "api", label: "API" },
  { value: "dashboard", label: "Dashboard" },
  { value: "public", label: "Public" },
];

function SecuritySection() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<any>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [auditFilters, setAuditFilters] = useState({ action: "", actor: "", dateFrom: "", dateTo: "" });

  const [newPolicy, setNewPolicy] = useState({
    policyName: "",
    policyType: "cors",
    appliedTo: "global",
    priority: 0,
    rules: {} as Record<string, any>
  });

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ["/api/admin/security/policies"],
    queryFn: () => adminFetch("/api/admin/security/policies")
  });

  const { data: stats } = useQuery({
    queryKey: ["/api/admin/security/stats"],
    queryFn: () => adminFetch("/api/admin/security/stats")
  });

  const { data: auditLogsData } = useQuery({
    queryKey: ["/api/admin/security/audit-logs", auditPage, auditFilters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: auditPage.toString(),
        limit: "20",
        ...(auditFilters.action && { action: auditFilters.action }),
        ...(auditFilters.actor && { actor: auditFilters.actor }),
        ...(auditFilters.dateFrom && { date_from: auditFilters.dateFrom }),
        ...(auditFilters.dateTo && { date_to: auditFilters.dateTo }),
      });
      return adminFetch(`/api/admin/security/audit-logs?${params}`);
    }
  });

  const { data: recentLogs = [] } = useQuery({
    queryKey: ["/api/admin/security/logs"],
    queryFn: () => adminFetch("/api/admin/security/logs?limit=10")
  });

  const createPolicyMutation = useMutation({
    mutationFn: async (policy: any) => {
      const res = await apiFetch("/api/admin/security/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy),
        credentials: "include"
      });
      if (!res.ok) throw new Error("Failed to create policy");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/stats"] });
      setShowAddModal(false);
      resetPolicyForm();
    }
  });

  const updatePolicyMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiFetch(`/api/admin/security/policies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include"
      });
      if (!res.ok) throw new Error("Failed to update policy");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/policies"] });
      setEditingPolicy(null);
      setShowAddModal(false);
    }
  });

  const deletePolicyMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/admin/security/policies/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete policy");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/stats"] });
    }
  });

  const togglePolicyMutation = useMutation({
    mutationFn: async ({ id, isEnabled }: { id: string; isEnabled: boolean }) => {
      const res = await apiFetch(`/api/admin/security/policies/${id}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled }),
        credentials: "include"
      });
      if (!res.ok) throw new Error("Failed to toggle policy");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/stats"] });
    }
  });

  const resetPolicyForm = () => {
    setNewPolicy({
      policyName: "",
      policyType: "cors",
      appliedTo: "global",
      priority: 0,
      rules: {}
    });
  };

  const handleEditPolicy = (policy: any) => {
    setEditingPolicy(policy);
    setNewPolicy({
      policyName: policy.policyName,
      policyType: policy.policyType,
      appliedTo: policy.appliedTo,
      priority: policy.priority || 0,
      rules: policy.rules || {}
    });
    setShowAddModal(true);
  };

  const handleSavePolicy = () => {
    const policyData = {
      policyName: newPolicy.policyName,
      policyType: newPolicy.policyType,
      appliedTo: newPolicy.appliedTo,
      priority: newPolicy.priority,
      rules: newPolicy.rules
    };

    if (editingPolicy) {
      updatePolicyMutation.mutate({ id: editingPolicy.id, ...policyData });
    } else {
      createPolicyMutation.mutate(policyData);
    }
  };

  const getPolicyTypeInfo = (type: string) => {
    return POLICY_TYPES.find(t => t.value === type) || POLICY_TYPES[0];
  };

  const getActorLabel = (log: any) => {
    const details = (log?.details || {}) as any;
    const email = details.actorEmail || details.email;
    if (email) return String(email);

    const userId = log?.userId;
    if (userId) {
      const id = String(userId);
      if (id.startsWith("anon_")) return "Anonymous";
      return id;
    }

    return "System";
  };

  const getSeverityBadge = (log: any) => {
    const action = String(log?.action || "");
    const details = (log?.details || {}) as any;

    let severity: string | null =
      typeof details.severity === "string" ? details.severity.toLowerCase() : null;

    // Derive severity from HTTP status if available.
    if (!severity && typeof details.statusCode === "number") {
      severity =
        details.statusCode >= 500 ? "error" :
          details.statusCode >= 400 ? "warning" :
            "info";
    }

    // Fallback heuristics based on action string.
    if (!severity) {
      const criticalActions = ["login_failed", "blocked", "unauthorized", "security_alert", "permission_denied", "access_denied"];
      const warningActions = ["warning", "update", "delete", "disable", "enable"];

      if (criticalActions.some(a => action.includes(a))) severity = "critical";
      else if (warningActions.some(a => action.includes(a))) severity = "warning";
      else severity = "info";
    }

    if (severity === "critical" || severity === "error") {
      return <Badge variant="destructive" className="text-xs">Critical</Badge>;
    }
    if (severity === "warning") {
      return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 text-xs">Warning</Badge>;
    }
    return <Badge variant="outline" className="text-xs">Info</Badge>;
  };

  const renderPolicyRulesForm = () => {
    switch (newPolicy.policyType) {
      case "cors":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Allowed Origins (one per line)</Label>
              <Textarea
                data-testid="input-cors-origins"
                placeholder="https://example.com&#10;https://api.example.com"
                value={newPolicy.rules.allowed_origins || ""}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, allowed_origins: e.target.value } })}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Allowed Methods</Label>
              <div className="flex flex-wrap gap-3">
                {["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"].map(method => (
                  <label key={method} className="flex items-center gap-2">
                    <Checkbox
                      data-testid={`checkbox-method-${method.toLowerCase()}`}
                      checked={(newPolicy.rules.allowed_methods || []).includes(method)}
                      onCheckedChange={(checked) => {
                        const methods = newPolicy.rules.allowed_methods || [];
                        setNewPolicy({
                          ...newPolicy,
                          rules: {
                            ...newPolicy.rules,
                            allowed_methods: checked ? [...methods, method] : methods.filter((m: string) => m !== method)
                          }
                        });
                      }}
                    />
                    <span className="text-sm">{method}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Max Age (seconds)</Label>
              <Input
                data-testid="input-cors-max-age"
                type="number"
                value={newPolicy.rules.max_age || 86400}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, max_age: parseInt(e.target.value) } })}
              />
            </div>
          </div>
        );
      case "rate_limit":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Requests per Minute</Label>
              <Input
                data-testid="input-rate-requests"
                type="number"
                value={newPolicy.rules.requests_per_minute || 60}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, requests_per_minute: parseInt(e.target.value) } })}
              />
            </div>
            <div className="space-y-2">
              <Label>Burst Limit</Label>
              <Input
                data-testid="input-rate-burst"
                type="number"
                value={newPolicy.rules.burst_limit || 10}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, burst_limit: parseInt(e.target.value) } })}
              />
            </div>
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select
                value={newPolicy.rules.scope || "ip"}
                onValueChange={(v) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, scope: v } })}
              >
                <SelectTrigger data-testid="select-rate-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ip">Per IP</SelectItem>
                  <SelectItem value="user">Per User</SelectItem>
                  <SelectItem value="api_key">Per API Key</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      case "ip_restriction":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Whitelist CIDRs (one per line)</Label>
              <Textarea
                data-testid="input-ip-whitelist"
                placeholder="192.168.1.0/24&#10;10.0.0.0/8"
                value={newPolicy.rules.whitelist_cidrs || ""}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, whitelist_cidrs: e.target.value } })}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Blacklist CIDRs (one per line)</Label>
              <Textarea
                data-testid="input-ip-blacklist"
                placeholder="0.0.0.0/0"
                value={newPolicy.rules.blacklist_cidrs || ""}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, blacklist_cidrs: e.target.value } })}
                rows={3}
              />
            </div>
          </div>
        );
      case "csp":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>default-src</Label>
              <Input
                data-testid="input-csp-default"
                placeholder="'self'"
                value={newPolicy.rules.default_src || ""}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, default_src: e.target.value } })}
              />
            </div>
            <div className="space-y-2">
              <Label>script-src</Label>
              <Input
                data-testid="input-csp-script"
                placeholder="'self' 'unsafe-inline'"
                value={newPolicy.rules.script_src || ""}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, script_src: e.target.value } })}
              />
            </div>
            <div className="space-y-2">
              <Label>style-src</Label>
              <Input
                data-testid="input-csp-style"
                placeholder="'self' 'unsafe-inline'"
                value={newPolicy.rules.style_src || ""}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, style_src: e.target.value } })}
              />
            </div>
            <div className="space-y-2">
              <Label>img-src</Label>
              <Input
                data-testid="input-csp-img"
                placeholder="'self' data: https:"
                value={newPolicy.rules.img_src || ""}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, img_src: e.target.value } })}
              />
            </div>
          </div>
        );
      case "auth_requirement":
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Checkbox
                id="require_2fa"
                data-testid="checkbox-require-2fa"
                checked={newPolicy.rules.require_2fa || false}
                onCheckedChange={(checked) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, require_2fa: checked } })}
              />
              <Label htmlFor="require_2fa">Require Two-Factor Authentication</Label>
            </div>
            <div className="space-y-2">
              <Label>Session Timeout (minutes)</Label>
              <Input
                data-testid="input-session-timeout"
                type="number"
                value={newPolicy.rules.session_timeout_minutes || 60}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, session_timeout_minutes: parseInt(e.target.value) } })}
              />
            </div>
          </div>
        );
      case "data_retention":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Audit Logs Retention (days)</Label>
              <Input
                data-testid="input-retention-audit"
                type="number"
                value={newPolicy.rules.audit_logs_days || 365}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, audit_logs_days: parseInt(e.target.value) } })}
              />
            </div>
            <div className="space-y-2">
              <Label>User Data Retention (days)</Label>
              <Input
                data-testid="input-retention-user"
                type="number"
                value={newPolicy.rules.user_data_days || 730}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, user_data_days: parseInt(e.target.value) } })}
              />
            </div>
            <div className="space-y-2">
              <Label>Chat History Retention (days)</Label>
              <Input
                data-testid="input-retention-chat"
                type="number"
                value={newPolicy.rules.chat_history_days || 90}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, chat_history_days: parseInt(e.target.value) } })}
              />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Security Center
        </h2>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="policies" data-testid="tab-policies">Policies</TabsTrigger>
          <TabsTrigger value="alerts" data-testid="tab-alerts">Alertas</TabsTrigger>
          <TabsTrigger value="audit-logs" data-testid="tab-audit-logs">Audit Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-lg border p-4" data-testid="kpi-total-policies">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-md bg-blue-500/10">
                  <Shield className="h-4 w-4 text-blue-500" />
                </div>
                <span className="text-sm text-muted-foreground">Total Policies</span>
              </div>
              <p className="text-2xl font-bold">{stats?.totalPolicies || 0}</p>
            </div>
            <div className="rounded-lg border p-4" data-testid="kpi-active-policies">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-md bg-green-500/10">
                  <ShieldCheck className="h-4 w-4 text-green-500" />
                </div>
                <span className="text-sm text-muted-foreground">Active Policies</span>
              </div>
              <p className="text-2xl font-bold">{stats?.activePolicies || 0}</p>
            </div>
            <div className="rounded-lg border p-4" data-testid="kpi-critical-alerts">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-md bg-red-500/10">
                  <ShieldAlert className="h-4 w-4 text-red-500" />
                </div>
                <span className="text-sm text-muted-foreground">Critical Alerts (24h)</span>
              </div>
              <p className="text-2xl font-bold">{stats?.criticalAlerts24h || 0}</p>
            </div>
            <div className="rounded-lg border p-4" data-testid="kpi-audit-today">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-md bg-purple-500/10">
                  <Activity className="h-4 w-4 text-purple-500" />
                </div>
                <span className="text-sm text-muted-foreground">Audit Events Today</span>
              </div>
              <p className="text-2xl font-bold">{stats?.auditEventsToday || 0}</p>
            </div>
          </div>

          <div className="rounded-lg border">
            <div className="p-4 border-b">
              <h3 className="font-medium">Recent Security Events</h3>
            </div>
            <ScrollArea className="h-[300px]">
              {recentLogs.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">No recent events</div>
              ) : (
                recentLogs.map((log: any) => (
                  <div key={log.id} className="flex items-center justify-between p-3 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      {getSeverityBadge(log)}
                      <div>
                        <span className="font-medium text-sm">{log.action}</span>
                        <span className="text-muted-foreground text-sm"> - {log.resource}</span>
                        <div className="text-xs text-muted-foreground">{getActorLabel(log)}</div>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {log.createdAt ? format(new Date(log.createdAt), "dd/MM HH:mm") : ""}
                    </span>
                  </div>
                ))
              )}
            </ScrollArea>
          </div>
        </TabsContent>

        <TabsContent value="policies" className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{policies.length} policies configured</span>
            <Dialog open={showAddModal} onOpenChange={(open) => {
              setShowAddModal(open);
              if (!open) {
                setEditingPolicy(null);
                resetPolicyForm();
              }
            }}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-policy">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Policy
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingPolicy ? "Edit Policy" : "Create Security Policy"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Policy Name</Label>
                    <Input
                      data-testid="input-policy-name"
                      placeholder="My Security Policy"
                      value={newPolicy.policyName}
                      onChange={(e) => setNewPolicy({ ...newPolicy, policyName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Policy Type</Label>
                    <Select
                      value={newPolicy.policyType}
                      onValueChange={(v) => setNewPolicy({ ...newPolicy, policyType: v, rules: {} })}
                    >
                      <SelectTrigger data-testid="select-policy-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {POLICY_TYPES.map(type => (
                          <SelectItem key={type.value} value={type.value}>
                            <span className="flex items-center gap-2">
                              <type.icon className="h-4 w-4" />
                              {type.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Applied To</Label>
                      <Select
                        value={newPolicy.appliedTo}
                        onValueChange={(v) => setNewPolicy({ ...newPolicy, appliedTo: v })}
                      >
                        <SelectTrigger data-testid="select-applied-to">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {APPLIED_TO_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Priority</Label>
                      <Input
                        data-testid="input-priority"
                        type="number"
                        value={newPolicy.priority}
                        onChange={(e) => setNewPolicy({ ...newPolicy, priority: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                  </div>

                  <Separator />
                  <h4 className="font-medium">Policy Rules</h4>
                  {renderPolicyRulesForm()}

                  <Button
                    className="w-full"
                    onClick={handleSavePolicy}
                    disabled={!newPolicy.policyName || createPolicyMutation.isPending || updatePolicyMutation.isPending}
                    data-testid="button-save-policy"
                  >
                    {(createPolicyMutation.isPending || updatePolicyMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {editingPolicy ? "Update Policy" : "Create Policy"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="rounded-lg border">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Name</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Type</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Applied To</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Priority</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {policies.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                      No security policies configured. Click "Add Policy" to create one.
                    </td>
                  </tr>
                ) : (
                  policies.map((policy: any) => {
                    const typeInfo = getPolicyTypeInfo(policy.policyType);
                    return (
                      <tr key={policy.id} className="border-t" data-testid={`row-policy-${policy.id}`}>
                        <td className="p-3">
                          <span className="font-medium">{policy.policyName}</span>
                        </td>
                        <td className="p-3">
                          <Badge className={cn("text-white", typeInfo.color)}>
                            <typeInfo.icon className="h-3 w-3 mr-1" />
                            {typeInfo.label}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <Badge variant="outline">{policy.appliedTo}</Badge>
                        </td>
                        <td className="p-3 text-sm">{policy.priority}</td>
                        <td className="p-3">
                          <Switch
                            checked={policy.isEnabled === "true"}
                            onCheckedChange={(checked) => togglePolicyMutation.mutate({ id: policy.id, isEnabled: checked })}
                            data-testid={`toggle-policy-${policy.id}`}
                          />
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => handleEditPolicy(policy)}
                              data-testid={`button-edit-${policy.id}`}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                              onClick={() => deletePolicyMutation.mutate(policy.id)}
                              data-testid={`button-delete-${policy.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <SecurityAlertsPanel />
        </TabsContent>

        <TabsContent value="audit-logs" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Action:</Label>
              <Input
                data-testid="filter-action"
                placeholder="Filter by action..."
                className="h-8 w-40"
                value={auditFilters.action}
                onChange={(e) => setAuditFilters({ ...auditFilters, action: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">User:</Label>
              <Input
                data-testid="filter-actor"
                placeholder="Email or userId..."
                className="h-8 w-44"
                value={auditFilters.actor}
                onChange={(e) => setAuditFilters({ ...auditFilters, actor: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">From:</Label>
              <Input
                data-testid="filter-date-from"
                type="date"
                className="h-8 w-36"
                value={auditFilters.dateFrom}
                onChange={(e) => setAuditFilters({ ...auditFilters, dateFrom: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">To:</Label>
              <Input
                data-testid="filter-date-to"
                type="date"
                className="h-8 w-36"
                value={auditFilters.dateTo}
                onChange={(e) => setAuditFilters({ ...auditFilters, dateTo: e.target.value })}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAuditFilters({ action: "", actor: "", dateFrom: "", dateTo: "" });
                setAuditPage(1);
              }}
              data-testid="button-clear-filters"
            >
              Clear
            </Button>
          </div>

          <div className="rounded-lg border">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Timestamp</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Actor</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Action</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Resource</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">IP Address</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Severity</th>
                </tr>
              </thead>
              <tbody>
                {auditLogsData?.data?.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                      No audit logs found matching your filters.
                    </td>
                  </tr>
                ) : (
                  auditLogsData?.data?.map((log: any) => (
                    <tr key={log.id} className="border-t" data-testid={`row-audit-${log.id}`}>
                      <td className="p-3 text-sm">
                        {log.createdAt ? format(new Date(log.createdAt), "yyyy-MM-dd HH:mm:ss") : "-"}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground max-w-[220px] truncate">{getActorLabel(log)}</td>
                      <td className="p-3 font-medium text-sm">{log.action}</td>
                      <td className="p-3 text-sm">{log.resource || "-"}</td>
                      <td className="p-3 text-sm font-mono">{log.ipAddress || "-"}</td>
                      <td className="p-3">{getSeverityBadge(log)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {auditLogsData?.pagination && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Page {auditLogsData.pagination.page} of {auditLogsData.pagination.totalPages} ({auditLogsData.pagination.total} total)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={auditPage <= 1}
                  onClick={() => setAuditPage(p => p - 1)}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={auditPage >= auditLogsData.pagination.totalPages}
                  onClick={() => setAuditPage(p => p + 1)}
                  data-testid="button-next-page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReportsSection() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("templates");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [reportFormat, setReportFormat] = useState<string>("json");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [historyPage, setHistoryPage] = useState(1);

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ["/api/admin/reports/templates"],
    queryFn: () => adminFetch("/api/admin/reports/templates")
  });

  const { data: generatedReportsData, isLoading: reportsLoading, refetch: refetchReports } = useQuery({
    queryKey: ["/api/admin/reports/generated", historyPage],
    queryFn: () => adminFetch(`/api/admin/reports/generated?page=${historyPage}&limit=20`),
    refetchInterval: 5000
  });

  const generateReportMutation = useMutation({
    mutationFn: async (data: { templateId: string; format: string; parameters?: any }) => {
      const res = await apiFetch("/api/admin/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include"
      });
      if (!res.ok) throw new Error("No se pudo generar el reporte");
      return res.json().catch(() => ({}));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reports/generated"] });
      setActiveTab("history");
    }
  });

  const deleteReportMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/admin/reports/generated/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("No se pudo eliminar el reporte");
      return res.json().catch(() => ({}));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reports/generated"] });
    }
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "user_report": return <Users className="h-5 w-5" />;
      case "ai_models_report": return <Bot className="h-5 w-5" />;
      case "security_report": return <Shield className="h-5 w-5" />;
      case "financial_report": return <DollarSign className="h-5 w-5" />;
      default: return <FileText className="h-5 w-5" />;
    }
  };

  const getTypeBadgeVariant = (type: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (type) {
      case "user_report": return "default";
      case "ai_models_report": return "secondary";
      case "security_report": return "destructive";
      case "financial_report": return "outline";
      default: return "secondary";
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending": return <Badge variant="outline" className="bg-yellow-100 text-yellow-800">Pending</Badge>;
      case "processing": return <Badge variant="outline" className="bg-blue-100 text-blue-800">Processing</Badge>;
      case "completed": return <Badge variant="outline" className="bg-green-100 text-green-800">Completed</Badge>;
      case "failed": return <Badge variant="destructive">Failed</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const handleGenerateFromTemplate = (templateId: string) => {
    setSelectedTemplate(templateId);
    setActiveTab("generate");
  };

  const handleSubmitGenerate = () => {
    if (!selectedTemplate) return;
    generateReportMutation.mutate({
      templateId: selectedTemplate,
      format: reportFormat,
      parameters: { dateFrom, dateTo }
    });
  };

  const handleDownload = (reportId: string) => {
    // FRONTEND FIX #37: Add noopener,noreferrer to prevent window.opener attacks
    window.open(`/api/admin/reports/download/${reportId}`, "_blank", "noopener,noreferrer");
  };

  if (templatesLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const generatedReports = generatedReportsData?.data || [];
  const pagination = generatedReportsData?.pagination || { page: 1, totalPages: 1, total: 0 };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Reports Center</h2>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="templates" data-testid="tab-templates">Templates</TabsTrigger>
          <TabsTrigger value="generate" data-testid="tab-generate">Generate Report</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((template: any) => (
              <Card key={template.id} className="flex flex-col" data-testid={`card-template-${template.id}`}>
                <CardHeader className="flex flex-row items-start gap-4 space-y-0">
                  <div className="p-2 rounded-lg bg-muted">
                    {getTypeIcon(template.type)}
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-base">{template.name}</CardTitle>
                    <Badge variant={getTypeBadgeVariant(template.type)} className="mt-1 text-xs">
                      {template.type.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  <p className="text-sm text-muted-foreground">{template.description || "No description"}</p>
                  {template.isSystem === "true" && (
                    <Badge variant="outline" className="mt-2 text-xs">System Template</Badge>
                  )}
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    size="sm"
                    onClick={() => handleGenerateFromTemplate(template.id)}
                    data-testid={`button-generate-${template.id}`}
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Generate
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="generate" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Generate New Report</CardTitle>
              <CardDescription>Configure and generate a report from a template</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Report Template</Label>
                <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                  <SelectTrigger data-testid="select-template">
                    <SelectValue placeholder="Select a template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Date From (Optional)</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    data-testid="input-date-from"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Date To (Optional)</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    data-testid="input-date-to"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Export Format</Label>
                <Select value={reportFormat} onValueChange={setReportFormat}>
                  <SelectTrigger data-testid="select-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="csv">CSV</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
            <CardFooter>
              <Button
                className="w-full"
                onClick={handleSubmitGenerate}
                disabled={!selectedTemplate || generateReportMutation.isPending}
                data-testid="button-submit-generate"
              >
                {generateReportMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileText className="h-4 w-4 mr-2" />
                    Generate Report
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Generated Reports</CardTitle>
                <CardDescription>View and download previously generated reports</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchReports()}
                data-testid="button-refresh-history"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              {reportsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : generatedReports.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No reports generated yet. Generate your first report from the Templates tab.
                </div>
              ) : (
                <div className="rounded-lg border">
                  <table className="w-full">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium">Name</th>
                        <th className="px-4 py-3 text-left text-sm font-medium">Type</th>
                        <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                        <th className="px-4 py-3 text-left text-sm font-medium">Format</th>
                        <th className="px-4 py-3 text-left text-sm font-medium">Created</th>
                        <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {generatedReports.map((report: any) => (
                        <tr key={report.id} className="border-b last:border-0" data-testid={`row-report-${report.id}`}>
                          <td className="px-4 py-3 text-sm font-medium">{report.name}</td>
                          <td className="px-4 py-3 text-sm">
                            <Badge variant={getTypeBadgeVariant(report.type)} className="text-xs">
                              {report.type.replace(/_/g, " ")}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm">{getStatusBadge(report.status)}</td>
                          <td className="px-4 py-3 text-sm uppercase">{report.format}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">
                            {report.createdAt ? format(new Date(report.createdAt), "MMM dd, yyyy HH:mm") : "-"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {report.status === "completed" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2"
                                  onClick={() => handleDownload(report.id)}
                                  data-testid={`button-download-${report.id}`}
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 text-destructive hover:text-destructive"
                                onClick={() => deleteReportMutation.mutate(report.id)}
                                data-testid={`button-delete-${report.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-muted-foreground">
                    Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={historyPage <= 1}
                      onClick={() => setHistoryPage(p => p - 1)}
                      data-testid="button-prev-history"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={historyPage >= pagination.totalPages}
                      onClick={() => setHistoryPage(p => p + 1)}
                      data-testid="button-next-history"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

type SettingsCategory = "general" | "branding" | "users" | "ai_models" | "security" | "notifications" | "advanced";

const settingsCategories: { id: SettingsCategory; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "branding", label: "Branding", icon: Palette },
  { id: "users", label: "Users", icon: Users },
  { id: "ai_models", label: "AI Models", icon: Bot },
  { id: "security", label: "Security", icon: Shield },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "advanced", label: "Advanced", icon: Code },
];

const timezones = ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney"];
const dateFormats = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"];
const themeModes = ["dark", "light", "auto"];

function SettingsSection() {
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("general");
  const [localSettings, setLocalSettings] = useState<Record<string, any>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const { data: settingsData, isLoading } = useQuery({
    queryKey: ["/api/admin/settings"],
    queryFn: () => adminFetch("/api/admin/settings")
  });

  const { data: aiModels = [] } = useQuery({
    queryKey: ["/api/ai-models"],
    queryFn: () => adminFetch("/api/ai-models")
  });

  useEffect(() => {
    if (settingsData?.settings) {
      const mapped: Record<string, any> = {};
      settingsData.settings.forEach((s: any) => {
        mapped[s.key] = s.value;
      });
      setLocalSettings(mapped);
      setHasChanges(false);
    }
  }, [settingsData]);

  const updateSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: any }) => {
      const res = await apiFetch(`/api/admin/settings/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
        credentials: "include"
      });
      if (!res.ok) throw new Error("No se pudo actualizar la configuración");
      return res.json().catch(() => ({}));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast.success("Setting updated successfully");
    },
    onError: () => {
      toast.error("Failed to update setting");
    }
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async (settings: { key: string; value: any }[]) => {
      const res = await apiFetch("/api/admin/settings/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
        credentials: "include"
      });
      if (!res.ok) throw new Error("No se pudieron guardar los cambios");
      return res.json().catch(() => ({}));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast.success("Settings saved successfully");
      setHasChanges(false);
    },
    onError: () => {
      toast.error("Failed to save settings");
    }
  });

  const resetSettingMutation = useMutation({
    mutationFn: async (key: string) => {
      const res = await apiFetch(`/api/admin/settings/reset/${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include"
      });
      if (!res.ok) throw new Error("No se pudo restablecer la configuración");
      return res.json().catch(() => ({}));
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      setLocalSettings(prev => ({ ...prev, [data.key]: data.value }));
      toast.success("Setting reset to default");
    },
    onError: () => {
      toast.error("Failed to reset setting");
    }
  });

  const updateLocal = (key: string, value: any) => {
    setLocalSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const saveCategory = () => {
    const categorySettings = settingsData?.settings?.filter((s: any) => s.category === activeCategory) || [];
    const updates = categorySettings.map((s: any) => ({
      key: s.key,
      value: localSettings[s.key]
    }));
    bulkUpdateMutation.mutate(updates);
  };

  const getSettingMeta = (key: string) => {
    return settingsData?.settings?.find((s: any) => s.key === key);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12" data-testid="settings-loading"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const renderGeneralSettings = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="app_name">Application Name</Label>
        <div className="flex gap-2">
          <Input
            id="app_name"
            data-testid="input-app-name"
            value={localSettings.app_name || ""}
            onChange={(e) => updateLocal("app_name", e.target.value)}
          />
          <Button variant="ghost" size="icon" onClick={() => resetSettingMutation.mutate("app_name")} title="Reset to default" data-testid="reset-app-name">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="app_description">Application Description</Label>
        <div className="flex gap-2">
          <textarea
            id="app_description"
            data-testid="input-app-description"
            className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={localSettings.app_description || ""}
            onChange={(e) => updateLocal("app_description", e.target.value)}
          />
          <Button variant="ghost" size="icon" onClick={() => resetSettingMutation.mutate("app_description")} title="Reset to default" data-testid="reset-app-description">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="support_email">Support Email</Label>
        <Input
          id="support_email"
          type="email"
          data-testid="input-support-email"
          value={localSettings.support_email || ""}
          onChange={(e) => updateLocal("support_email", e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="timezone_default">Default Timezone</Label>
        <Select value={localSettings.timezone_default || "UTC"} onValueChange={(v) => updateLocal("timezone_default", v)}>
          <SelectTrigger data-testid="select-timezone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timezones.map((tz) => (
              <SelectItem key={tz} value={tz}>{tz}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="date_format">Date Format</Label>
        <Select value={localSettings.date_format || "YYYY-MM-DD"} onValueChange={(v) => updateLocal("date_format", v)}>
          <SelectTrigger data-testid="select-date-format">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {dateFormats.map((fmt) => (
              <SelectItem key={fmt} value={fmt}>{fmt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="maintenance_mode">Maintenance Mode</Label>
          <p className="text-xs text-muted-foreground">Enable to show maintenance page to users</p>
        </div>
        <Switch
          id="maintenance_mode"
          data-testid="switch-maintenance-mode"
          checked={localSettings.maintenance_mode === true}
          onCheckedChange={(v) => updateLocal("maintenance_mode", v)}
        />
      </div>
    </div>
  );

  const renderBrandingSettings = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="primary_color">Primary Color</Label>
        <div className="flex gap-2 items-center">
          <input
            id="primary_color"
            type="color"
            data-testid="input-primary-color"
            value={localSettings.primary_color || "#6366f1"}
            onChange={(e) => updateLocal("primary_color", e.target.value)}
            className="w-12 h-10 rounded border cursor-pointer"
          />
          <Input
            value={localSettings.primary_color || "#6366f1"}
            onChange={(e) => updateLocal("primary_color", e.target.value)}
            className="w-32"
          />
          <div
            className="w-10 h-10 rounded border"
            style={{ backgroundColor: localSettings.primary_color || "#6366f1" }}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="secondary_color">Secondary Color</Label>
        <div className="flex gap-2 items-center">
          <input
            id="secondary_color"
            type="color"
            data-testid="input-secondary-color"
            value={localSettings.secondary_color || "#8b5cf6"}
            onChange={(e) => updateLocal("secondary_color", e.target.value)}
            className="w-12 h-10 rounded border cursor-pointer"
          />
          <Input
            value={localSettings.secondary_color || "#8b5cf6"}
            onChange={(e) => updateLocal("secondary_color", e.target.value)}
            className="w-32"
          />
          <div
            className="w-10 h-10 rounded border"
            style={{ backgroundColor: localSettings.secondary_color || "#8b5cf6" }}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="theme_mode">Default Theme</Label>
        <Select value={localSettings.theme_mode || "dark"} onValueChange={(v) => updateLocal("theme_mode", v)}>
          <SelectTrigger data-testid="select-theme-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {themeModes.map((mode) => (
              <SelectItem key={mode} value={mode}>{mode.charAt(0).toUpperCase() + mode.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  const renderUsersSettings = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="allow_registration">Allow Registration</Label>
          <p className="text-xs text-muted-foreground">Allow new users to sign up</p>
        </div>
        <Switch
          id="allow_registration"
          data-testid="switch-allow-registration"
          checked={localSettings.allow_registration === true}
          onCheckedChange={(v) => updateLocal("allow_registration", v)}
        />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="require_email_verification">Require Email Verification</Label>
          <p className="text-xs text-muted-foreground">Require users to verify their email</p>
        </div>
        <Switch
          id="require_email_verification"
          data-testid="switch-email-verification"
          checked={localSettings.require_email_verification === true}
          onCheckedChange={(v) => updateLocal("require_email_verification", v)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="session_timeout">Session Timeout (minutes)</Label>
        <Input
          id="session_timeout"
          type="number"
          data-testid="input-session-timeout"
          value={localSettings.session_timeout_minutes || 1440}
          onChange={(e) => updateLocal("session_timeout_minutes", parseInt(e.target.value) || 1440)}
        />
      </div>
    </div>
  );

  const renderAIModelsSettings = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="default_model">Default Model</Label>
        <Select value={localSettings.default_model || "grok-3-fast"} onValueChange={(v) => updateLocal("default_model", v)}>
          <SelectTrigger data-testid="select-default-model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {aiModels.map((m: any) => (
              <SelectItem key={m.id || m.modelId} value={m.modelId || m.id}>{m.name || m.modelId}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="max_tokens">Max Tokens Per Request</Label>
        <Input
          id="max_tokens"
          type="number"
          data-testid="input-max-tokens"
          value={localSettings.max_tokens_per_request || 4096}
          onChange={(e) => updateLocal("max_tokens_per_request", parseInt(e.target.value) || 4096)}
        />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="enable_streaming">Enable Streaming</Label>
          <p className="text-xs text-muted-foreground">Stream AI responses in real-time</p>
        </div>
        <Switch
          id="enable_streaming"
          data-testid="switch-streaming"
          checked={localSettings.enable_streaming === true}
          onCheckedChange={(v) => updateLocal("enable_streaming", v)}
        />
      </div>
    </div>
  );

  const renderSecuritySettings = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="max_login_attempts">Max Login Attempts</Label>
        <Input
          id="max_login_attempts"
          type="number"
          data-testid="input-max-login-attempts"
          value={localSettings.max_login_attempts || 5}
          onChange={(e) => updateLocal("max_login_attempts", parseInt(e.target.value) || 5)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="lockout_duration">Lockout Duration (minutes)</Label>
        <Input
          id="lockout_duration"
          type="number"
          data-testid="input-lockout-duration"
          value={localSettings.lockout_duration_minutes || 30}
          onChange={(e) => updateLocal("lockout_duration_minutes", parseInt(e.target.value) || 30)}
        />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="require_2fa">Require 2FA for Admins</Label>
          <p className="text-xs text-muted-foreground">Enforce two-factor authentication for admin users</p>
        </div>
        <Switch
          id="require_2fa"
          data-testid="switch-require-2fa"
          checked={localSettings.require_2fa_admins === true}
          onCheckedChange={(v) => updateLocal("require_2fa_admins", v)}
        />
      </div>
    </div>
  );

  const renderNotificationsSettings = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="email_notifications">Email Notifications</Label>
          <p className="text-xs text-muted-foreground">Enable email notifications for users</p>
        </div>
        <Switch
          id="email_notifications"
          data-testid="switch-email-notifications"
          checked={localSettings.email_notifications_enabled === true}
          onCheckedChange={(v) => updateLocal("email_notifications_enabled", v)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="slack_webhook">Slack Webhook URL</Label>
        <Input
          id="slack_webhook"
          type="text"
          data-testid="input-slack-webhook"
          placeholder="https://hooks.slack.com/services/..."
          value={localSettings.slack_webhook_url || ""}
          onChange={(e) => updateLocal("slack_webhook_url", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Optional: Configure Slack notifications</p>
      </div>
    </div>
  );

  const renderAdvancedSettings = () => (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">Raw settings data for power users:</div>
      <div className="rounded-lg border bg-muted/50 p-4 max-h-96 overflow-auto">
        <pre className="text-xs font-mono whitespace-pre-wrap" data-testid="settings-json">
          {JSON.stringify(settingsData?.settings || [], null, 2)}
        </pre>
      </div>
    </div>
  );

  const renderCategoryContent = () => {
    switch (activeCategory) {
      case "general": return renderGeneralSettings();
      case "branding": return renderBrandingSettings();
      case "users": return renderUsersSettings();
      case "ai_models": return renderAIModelsSettings();
      case "security": return renderSecuritySettings();
      case "notifications": return renderNotificationsSettings();
      case "advanced": return renderAdvancedSettings();
      default: return renderGeneralSettings();
    }
  };

  return (
    <div className="flex gap-6" data-testid="settings-section">
      <div className="w-48 shrink-0 space-y-1">
        {settingsCategories.map((cat) => (
          <Button
            key={cat.id}
            variant={activeCategory === cat.id ? "secondary" : "ghost"}
            className="w-full justify-start gap-2"
            onClick={() => setActiveCategory(cat.id)}
            data-testid={`settings-tab-${cat.id}`}
          >
            <cat.icon className="h-4 w-4" />
            {cat.label}
          </Button>
        ))}
      </div>
      <div className="flex-1">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {settingsCategories.find(c => c.id === activeCategory)?.icon && (
                (() => {
                  const Icon = settingsCategories.find(c => c.id === activeCategory)!.icon;
                  return <Icon className="h-5 w-5" />;
                })()
              )}
              {settingsCategories.find(c => c.id === activeCategory)?.label} Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {renderCategoryContent()}
            {activeCategory !== "advanced" && (
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (settingsData?.settings) {
                      const mapped: Record<string, any> = {};
                      settingsData.settings.forEach((s: any) => {
                        mapped[s.key] = s.value;
                      });
                      setLocalSettings(mapped);
                      setHasChanges(false);
                    }
                  }}
                  disabled={!hasChanges}
                  data-testid="button-cancel-settings"
                >
                  Cancel
                </Button>
                <Button
                  onClick={saveCategory}
                  disabled={!hasChanges || bulkUpdateMutation.isPending}
                  data-testid="button-save-settings"
                >
                  {bulkUpdateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save Changes
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface ExcelDocument {
  id: string;
  name: string;
  sheets: number;
  size: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

function ExcelManagerSection() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<'list' | 'editor'>('list');
  const [currentDoc, setCurrentDoc] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const { data: documents = [], isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/excel/list"],
    queryFn: async () => {
      const res = await apiFetch("/api/admin/excel/list", { credentials: "include" });
      if (!res.ok) {
        return [
          { id: '1', name: 'Reporte Q4 2024.xlsx', sheets: 3, size: 45000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: 'Admin' },
          { id: '2', name: 'Análisis Ventas.xlsx', sheets: 5, size: 128000, createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date().toISOString(), createdBy: 'Admin' },
          { id: '3', name: 'Inventario.xlsx', sheets: 2, size: 67000, createdAt: new Date(Date.now() - 172800000).toISOString(), updatedAt: new Date().toISOString(), createdBy: 'Admin' }
        ];
      }
      return res.json();
    }
  });

  const saveMutation = useMutation({
    mutationFn: async ({ id, name, data }: { id: string; name: string; data: any[][] }) => {
      const res = await apiFetch('/api/admin/excel/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, data })
      });
      if (!res.ok) throw new Error("No se pudo guardar el documento");
      return res.json().catch(() => ({}));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/excel/list"] });
      toast.success("Document saved successfully");
    },
    onError: () => {
      toast.error("Failed to save document");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/admin/excel/${id}`, { method: 'DELETE', credentials: 'include' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/excel/list"] });
      toast.success("Document deleted");
    }
  });

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (date: string) => new Date(date).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const filtered = documents.filter((d: ExcelDocument) =>
    d.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const createNew = () => {
    setCurrentDoc({ id: `new_${Date.now()}`, name: 'Nuevo Documento.xlsx', data: null });
    setView('editor');
  };

  const openDocument = async (doc: ExcelDocument) => {
    try {
      const response = await apiFetch(`/api/admin/excel/${doc.id}`, { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        setCurrentDoc({ ...doc, data: data.data });
      } else {
        setCurrentDoc(doc);
      }
    } catch {
      setCurrentDoc(doc);
    }
    setView('editor');
  };

  const handleSave = (data: any[][], fileName: string) => {
    if (currentDoc) {
      saveMutation.mutate({ id: currentDoc.id, name: fileName, data });
    }
  };

  const deleteDocument = async (id: string) => {
    if (!confirm('¿Eliminar este documento?')) return;
    deleteMutation.mutate(id);
  };

  if (view === 'editor') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setView('list')} data-testid="button-back-to-list">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver
            </Button>
            <h2 className="text-lg font-medium">{currentDoc?.name || 'Nuevo Documento'}</h2>
          </div>
          <Button onClick={() => {
            const hot = document.querySelector('[data-testid="spreadsheet-editor"]');
            if (hot) {
              handleSave(currentDoc?.data || [], currentDoc?.name || 'document.xlsx');
            }
          }} disabled={saveMutation.isPending} data-testid="button-save-excel">
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Guardar
          </Button>
        </div>
        <div className="border rounded-lg overflow-hidden">
          <SpreadsheetEditor
            initialData={currentDoc?.data}
            fileName={currentDoc?.name}
            onSave={handleSave}
            height={600}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-green-500" />
            Excel Manager
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Crea, edita y gestiona hojas de cálculo</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="button-refresh-excel">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={createNew} className="gap-1" data-testid="button-new-document">
            <Plus className="h-4 w-4" />
            Nuevo Documento
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-green-500/10">
              <FileSpreadsheet className="h-4 w-4 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{documents.length}</p>
              <p className="text-sm text-muted-foreground">Documentos</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-blue-500/10">
              <Table className="h-4 w-4 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{documents.reduce((a: number, d: ExcelDocument) => a + d.sheets, 0)}</p>
              <p className="text-sm text-muted-foreground">Hojas Totales</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-purple-500/10">
              <HardDrive className="h-4 w-4 text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{formatSize(documents.reduce((a: number, d: ExcelDocument) => a + d.size, 0))}</p>
              <p className="text-sm text-muted-foreground">Almacenamiento</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-orange-500/10">
              <Clock className="h-4 w-4 text-orange-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">Hoy</p>
              <p className="text-sm text-muted-foreground">Última Edición</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar documentos..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
            data-testid="input-search-excel"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-4 py-3 text-left text-sm font-medium">Nombre</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Hojas</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Tamaño</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Modificado</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Creado por</th>
                <th className="px-4 py-3 text-right text-sm font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    <FolderOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No hay documentos</p>
                    <Button variant="link" onClick={createNew} className="mt-2" data-testid="button-create-first">
                      Crear el primero
                    </Button>
                  </td>
                </tr>
              ) : (
                filtered.map((doc: ExcelDocument) => (
                  <tr key={doc.id} className="border-b hover:bg-muted/20 transition-colors" data-testid={`row-excel-${doc.id}`}>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openDocument(doc)}
                        className="flex items-center gap-2 hover:text-primary transition-colors text-left"
                        data-testid={`button-open-${doc.id}`}
                      >
                        <FileSpreadsheet className="h-4 w-4 text-green-500 flex-shrink-0" />
                        <span className="font-medium">{doc.name}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{doc.sheets}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{formatSize(doc.size)}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{formatDate(doc.updatedAt)}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{doc.createdBy}</td>
                    <td className="px-4 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" data-testid={`button-menu-${doc.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openDocument(doc)}>
                            <Eye className="h-4 w-4 mr-2" />
                            Abrir
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openDocument(doc)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => deleteDocument(doc.id)} className="text-red-600">
                            <Trash2 className="h-4 w-4 mr-2" />
                            Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const activeSection = getAdminSectionFromRoute(location, search);

  // Security: Verify admin role
  const {
    data: currentUser,
    isLoading: isLoadingUser,
    isError: isAuthError,
    error: authError,
    refetch: refetchCurrentUser,
  } = useQuery({
    queryKey: ["/api/auth/user", "admin-check"],
    queryFn: async () => {
      try {
        const res = await apiFetch("/api/auth/user", { credentials: "include" });
        if (res.ok) {
          const user = await res.json();
          if (user?.role === "admin") return user;
        }
      } catch {}
      try {
        const stored = localStorage.getItem("siragpt_auth_user");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed?.role === "admin") return parsed;
        }
      } catch {}
      return null;
    },
    staleTime: 10_000,
  });

  // Redirect non-admin users
  useEffect(() => {
    if (!isLoadingUser && currentUser && currentUser.role !== "admin") {
      console.warn("[Admin] Access denied - user is not admin:", currentUser.email);
      setLocation("/");
    }
  }, [currentUser, isLoadingUser, setLocation]);

  // Show loading while checking auth
  if (isLoadingUser) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isAuthError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background gap-4 px-6 text-center">
        <AlertTriangle className="h-16 w-16 text-yellow-500" />
        <h1 className="text-2xl font-bold">Connection Error</h1>
        <p className="max-w-md text-muted-foreground">
          No se pudo verificar la sesión administrativa. Reintenta la conexión antes de volver a entrar al panel.
        </p>
        {authError instanceof Error ? (
          <p className="max-w-md text-sm text-muted-foreground">{authError.message}</p>
        ) : null}
        <Button onClick={() => void refetchCurrentUser()} data-testid="button-retry-admin-auth">
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  // Block access if not admin
  if (!currentUser || currentUser.role !== "admin") {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background gap-4">
        <Shield className="h-16 w-16 text-red-500" />
        <h1 className="text-2xl font-bold">Acceso Denegado</h1>
        <p className="text-muted-foreground">No tienes permisos de administrador.</p>
        <Button onClick={() => setLocation("/")}>Volver al inicio</Button>
      </div>
    );
  }

  const navigateToSection = (section: AdminSection) => {
    if (section === activeSection) return;
    const nextLocation = getAdminHref(section);
    const currentLocation = `${location}${search}`;
    if (nextLocation === currentLocation) return;
    setLocation(nextLocation);
  };

  const renderSection = () => {
    switch (activeSection) {
      case "dashboard":
        return <DashboardSection onNavigate={navigateToSection} />;
      case "users":
        return <UsersManagement />;
      case "conversations":
        return <ConversationsSection />;
      case "ai-models":
        return <AIModelsSection />;
      case "payments":
        return <PaymentsSection />;
      case "invoices":
        return <InvoicesSection />;
      case "analytics":
        return <AnalyticsSection />;
      case "database":
        return <DatabaseSection />;
      case "security":
        return <SecuritySection />;
      case "reports":
        return <ReportsSection />;
      case "settings":
        return <SettingsSection />;
      case "agentic":
        return <AgenticEngineDashboard />;
      case "excel":
        return <ExcelManagerSection />;
      case "terminal":
        return <TerminalPlane />;
      case "monitoring":
        return <MonitoringSection />;
      case "releases":
        return <ReleasesManager />;
      case "budget":
        return <BudgetDashboard />;
      case "sre":
        return <SREPanel />;
      case "governance":
        return <GovernanceConsole />;
      case "security-dashboard":
        return <SecurityDashboard />;
      case "experiments":
        return <ModelExperiments />;
      case "voice":
        return <VoicePlane />;
      case "data-plane":
        return <DataPlaneExplorer />;
      case "files":
        return <FilePlane />;
      case "orchestrator":
        return <SuperOrchestratorDashboard />;
      case "browser":
        return <BrowserPlaneDashboard />;
      case "research":
        return <DeepResearchDashboard />;
      case "observability":
        return <ObservabilityDashboard />;
      case "chaos":
        return <ChaosTestingDashboard />;
      case "gateway-logs":
        return <GatewayLogViewer />;
      default:
        return <DashboardSection onNavigate={navigateToSection} />;
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <aside className="w-56 border-r flex flex-col shrink-0">
        <div className="p-4 border-b shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => setLocation("/")}
            data-testid="button-back-to-app"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver a la app
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2">
            <div className="flex items-center justify-between px-3 py-2">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Administration
              </h2>
              <AdminNotificationsPopover />
            </div>
            <nav className="flex flex-col gap-1">
              {navItems.map((item) => (
                <Button
                  key={item.id}
                  variant={activeSection === item.id ? "secondary" : "ghost"}
                  size="sm"
                  className="w-full justify-start gap-2 shrink-0"
                  onClick={() => navigateToSection(item.id)}
                  data-testid={`nav-${item.id}`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Button>
              ))}
            </nav>
          </div>
        </ScrollArea>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            }
          >
            <ErrorBoundary level="section" name={activeSection} resetKeys={[activeSection]}>
              {renderSection()}
            </ErrorBoundary>
          </Suspense>
        </div>
      </main>
    </div>
  );
}
