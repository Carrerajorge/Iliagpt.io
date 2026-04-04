import './_group.css';
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
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
  CheckCircle,
  TrendingUp,
  Activity,
  RefreshCw,
  Loader2,
  MessageSquare,
  Terminal,
  Download,
  Server,
  Globe,
  Network,
  Eye,
  Brain,
  Wrench,
  Zap,
  FileSpreadsheet,
  FolderOpen,
  Gauge,
  FlaskConical,
  Phone,
  DollarSign,
  ShieldCheck,
  ShieldAlert,
  Bell,
  Clock,
  HardDrive,
  AlertTriangle,
} from "lucide-react";

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

type AdminSection =
  | "dashboard" | "users" | "conversations" | "ai-models" | "payments"
  | "invoices" | "analytics" | "database" | "security" | "reports"
  | "settings" | "agentic" | "excel" | "terminal" | "monitoring"
  | "releases" | "budget" | "sre" | "governance" | "security-dashboard"
  | "experiments" | "voice" | "data-plane" | "files" | "orchestrator"
  | "browser" | "research" | "observability" | "chaos";

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
];

const mockDashboardData = {
  users: { total: 1247, active: 834, newThisMonth: 67 },
  aiModels: { active: 389, total: 412 },
  payments: { total: "24500.00", thisMonth: "8200.00", count: 342 },
  invoices: { total: 156, pending: 23, paid: 133 },
  analytics: { totalQueries: 184320, avgQueriesPerUser: 148 },
  database: { tables: 47, status: "healthy" },
  security: { alerts: 0, status: "healthy" },
  reports: { total: 12, scheduled: 4 },
  settings: { total: 38, categories: 8 },
  systemHealth: { xai: true, gemini: true, uptime: 99.97 },
  recentActivity: [
    { action: "Usuario admin@ilia.pe inició sesión", createdAt: "2026-04-04T20:30:00Z" },
    { action: "Modelo gemini-2.5-flash activado", createdAt: "2026-04-04T20:15:00Z" },
    { action: "Backup diario completado", createdAt: "2026-04-04T19:00:00Z" },
    { action: "3 nuevos usuarios registrados", createdAt: "2026-04-04T18:45:00Z" },
    { action: "Actualización de seguridad aplicada", createdAt: "2026-04-04T17:30:00Z" },
  ],
};

function DashboardSection() {
  const d = mockDashboardData;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Dashboard</h2>
        <Button variant="ghost" size="sm" data-testid="button-refresh-dashboard">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-users">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-blue-500/10">
              <Users className="h-4 w-4 text-blue-500" />
            </div>
            <span className="text-sm font-medium">Users</span>
          </div>
          <p className="text-2xl font-bold">{d.users.total}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{d.users.active} activos</span>
            <span className="text-green-600">+{d.users.newThisMonth} este mes</span>
          </div>
        </div>

        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-ai-models">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-purple-500/10">
              <Bot className="h-4 w-4 text-purple-500" />
            </div>
            <span className="text-sm font-medium">AI Models</span>
          </div>
          <p className="text-2xl font-bold">{d.aiModels.active}<span className="text-sm font-normal text-muted-foreground">/{d.aiModels.total}</span></p>
          <div className="flex items-center gap-2 mt-2">
            <span className="inline-flex items-center gap-1 text-xs text-green-600">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              xAI
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-green-600">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Gemini
            </span>
          </div>
        </div>

        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-payments">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-green-500/10">
              <CreditCard className="h-4 w-4 text-green-500" />
            </div>
            <span className="text-sm font-medium">Payments</span>
          </div>
          <p className="text-2xl font-bold">€{parseFloat(d.payments.total).toLocaleString()}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>€{parseFloat(d.payments.thisMonth).toLocaleString()} este mes</span>
            <span>{d.payments.count} transacciones</span>
          </div>
        </div>

        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-invoices">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-orange-500/10">
              <FileText className="h-4 w-4 text-orange-500" />
            </div>
            <span className="text-sm font-medium">Invoices</span>
          </div>
          <p className="text-2xl font-bold">{d.invoices.total}</p>
          <div className="flex items-center gap-4 mt-2 text-xs">
            <span className="text-yellow-600">{d.invoices.pending} pendientes</span>
            <span className="text-green-600">{d.invoices.paid} pagadas</span>
          </div>
        </div>

        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-analytics">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-cyan-500/10">
              <BarChart3 className="h-4 w-4 text-cyan-500" />
            </div>
            <span className="text-sm font-medium">Analytics</span>
          </div>
          <p className="text-2xl font-bold">{d.analytics.totalQueries.toLocaleString()}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>~{d.analytics.avgQueriesPerUser} consultas/usuario</span>
          </div>
        </div>

        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-database">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-slate-500/10">
              <Database className="h-4 w-4 text-slate-500" />
            </div>
            <span className="text-sm font-medium">Database</span>
          </div>
          <p className="text-2xl font-bold">{d.database.tables} <span className="text-sm font-normal text-muted-foreground">tablas</span></p>
          <div className="flex items-center gap-2 mt-2">
            <span className="inline-flex items-center gap-1 text-xs text-green-600">
              <CheckCircle className="h-3 w-3" />
              Operativo
            </span>
          </div>
        </div>

        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-security">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-green-500/10">
              <Shield className="h-4 w-4 text-green-500" />
            </div>
            <span className="text-sm font-medium">Security</span>
          </div>
          <p className="text-2xl font-bold">{d.security.alerts} <span className="text-sm font-normal text-muted-foreground">alertas</span></p>
          <div className="flex items-center gap-2 mt-2">
            <span className="inline-flex items-center gap-1 text-xs text-green-600">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Sin incidentes
            </span>
          </div>
        </div>

        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-reports">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-indigo-500/10">
              <FileBarChart className="h-4 w-4 text-indigo-500" />
            </div>
            <span className="text-sm font-medium">Reports</span>
          </div>
          <p className="text-2xl font-bold">{d.reports.total}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{d.reports.scheduled} programados</span>
          </div>
        </div>

        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-settings">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-gray-500/10">
              <Settings className="h-4 w-4 text-gray-500" />
            </div>
            <span className="text-sm font-medium">Settings</span>
          </div>
          <p className="text-2xl font-bold">{d.settings.total} <span className="text-sm font-normal text-muted-foreground">config</span></p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{d.settings.categories} categorías</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium">System Health</h3>
            <span className="text-xs text-muted-foreground">{d.systemHealth.uptime}% uptime</span>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">xAI Grok</span>
              <Badge variant="default" className="text-xs">Online</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Google Gemini</span>
              <Badge variant="default" className="text-xs">Online</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Database</span>
              <Badge variant="default" className="text-xs">Healthy</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">OpenRouter</span>
              <Badge variant="default" className="text-xs">Online</Badge>
            </div>
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <h3 className="text-sm font-medium mb-4">Actividad reciente</h3>
          <div className="space-y-2">
            {d.recentActivity.map((item, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 text-sm border-b last:border-0">
                <div className="flex items-center gap-2">
                  <Activity className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate max-w-[200px]">{item.action}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(item.createdAt).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-lg border p-4">
          <h3 className="text-sm font-medium mb-3">Token Usage (24h)</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Input tokens</span>
              <span>2.4M</span>
            </div>
            <Progress value={60} className="h-1.5" />
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Output tokens</span>
              <span>890K</span>
            </div>
            <Progress value={35} className="h-1.5" />
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Cost</span>
              <span className="font-medium">$4.23</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <h3 className="text-sm font-medium mb-3">Top Models (24h)</h3>
          <div className="space-y-2">
            {[
              { name: "gemini-2.5-flash", pct: 45 },
              { name: "grok-3-mini", pct: 25 },
              { name: "claude-sonnet-4", pct: 15 },
              { name: "deepseek-r1", pct: 10 },
              { name: "otros", pct: 5 },
            ].map((m) => (
              <div key={m.name} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-28 truncate">{m.name}</span>
                <Progress value={m.pct} className="h-1.5 flex-1" />
                <span className="text-xs w-8 text-right">{m.pct}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <h3 className="text-sm font-medium mb-3">Alerts</h3>
          <div className="space-y-2">
            <div className="flex items-start gap-2 p-2 rounded-md bg-yellow-500/5 border border-yellow-500/20">
              <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 mt-0.5" />
              <div>
                <p className="text-xs font-medium">Rate limit warning</p>
                <p className="text-[10px] text-muted-foreground">OpenRouter: 85% of hourly limit</p>
              </div>
            </div>
            <div className="flex items-start gap-2 p-2 rounded-md bg-green-500/5 border border-green-500/20">
              <CheckCircle className="h-3.5 w-3.5 text-green-500 mt-0.5" />
              <div>
                <p className="text-xs font-medium">All systems operational</p>
                <p className="text-[10px] text-muted-foreground">Last check: 2 min ago</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function UsersSection() {
  const mockUsers = [
    { id: 1, email: "admin@ilia.pe", username: "admin", role: "admin", plan: "enterprise", status: "active", lastLogin: "2026-04-04T20:30:00Z", queriesCount: 4521 },
    { id: 2, email: "maria@empresa.com", username: "maria_g", role: "user", plan: "pro", status: "active", lastLogin: "2026-04-04T19:15:00Z", queriesCount: 1230 },
    { id: 3, email: "carlos@startup.io", username: "carlos_dev", role: "user", plan: "free", status: "active", lastLogin: "2026-04-04T18:00:00Z", queriesCount: 567 },
    { id: 4, email: "ana@research.edu", username: "ana_inv", role: "user", plan: "pro", status: "inactive", lastLogin: "2026-03-28T10:00:00Z", queriesCount: 2100 },
    { id: 5, email: "luis@corp.pe", username: "luis_m", role: "user", plan: "enterprise", status: "active", lastLogin: "2026-04-04T17:30:00Z", queriesCount: 3400 },
    { id: 6, email: "sofia@tech.com", username: "sofia_t", role: "moderator", plan: "pro", status: "active", lastLogin: "2026-04-03T22:00:00Z", queriesCount: 890 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Users</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input className="h-9 w-64 rounded-md border bg-background pl-8 pr-3 text-sm" placeholder="Buscar usuarios..." />
          </div>
          <Button size="sm">Exportar</Button>
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 font-medium">Usuario</th>
              <th className="text-left p-3 font-medium">Rol</th>
              <th className="text-left p-3 font-medium">Plan</th>
              <th className="text-left p-3 font-medium">Estado</th>
              <th className="text-left p-3 font-medium">Consultas</th>
              <th className="text-left p-3 font-medium">Último acceso</th>
            </tr>
          </thead>
          <tbody>
            {mockUsers.map((u) => (
              <tr key={u.id} className="border-b hover:bg-muted/30 transition-colors">
                <td className="p-3">
                  <div>
                    <p className="font-medium">{u.username}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                </td>
                <td className="p-3"><Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-xs">{u.role}</Badge></td>
                <td className="p-3"><Badge variant="outline" className="text-xs capitalize">{u.plan}</Badge></td>
                <td className="p-3">
                  <span className={cn("inline-flex items-center gap-1 text-xs", u.status === "active" ? "text-green-600" : "text-muted-foreground")}>
                    <span className={cn("w-1.5 h-1.5 rounded-full", u.status === "active" ? "bg-green-500" : "bg-gray-400")} />
                    {u.status === "active" ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td className="p-3 text-muted-foreground">{u.queriesCount.toLocaleString()}</td>
                <td className="p-3 text-xs text-muted-foreground">{new Date(u.lastLogin).toLocaleDateString("es-PE")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlaceholderSection({ title, icon: Icon }: { title: string; icon: React.ElementType }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <Icon className="h-12 w-12 mb-4 opacity-20" />
      <h2 className="text-lg font-medium mb-1">{title}</h2>
      <p className="text-sm">Sección en desarrollo</p>
    </div>
  );
}

export function Current() {
  const [activeSection, setActiveSection] = useState<AdminSection>("dashboard");

  const renderSection = () => {
    switch (activeSection) {
      case "dashboard": return <DashboardSection />;
      case "users": return <UsersSection />;
      default: {
        const item = navItems.find(n => n.id === activeSection);
        return <PlaceholderSection title={item?.label || activeSection} icon={item?.icon || Settings} />;
      }
    }
  };

  return (
    <div className="flex h-screen bg-background text-foreground dark">
      <aside className="w-56 border-r flex flex-col shrink-0">
        <div className="p-4 border-b shrink-0">
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" data-testid="button-back-to-app">
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
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                <Bell className="h-3.5 w-3.5" />
              </Button>
            </div>
            <nav className="flex flex-col gap-1">
              {navItems.map((item) => (
                <Button
                  key={item.id}
                  variant={activeSection === item.id ? "secondary" : "ghost"}
                  size="sm"
                  className="w-full justify-start gap-2 shrink-0"
                  onClick={() => setActiveSection(item.id)}
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
          {renderSection()}
        </div>
      </main>
    </div>
  );
}
