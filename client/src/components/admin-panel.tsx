import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
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
  XCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  Activity,
  HardDrive,
  Lock,
  Key,
  AlertTriangle,
  Download,
  RefreshCw
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AdminPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type AdminSection = "dashboard" | "users" | "ai-models" | "payments" | "invoices" | "analytics" | "database" | "security" | "reports" | "settings";

const navItems: { id: AdminSection; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: Users },
  { id: "ai-models", label: "AI Models", icon: Bot },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "invoices", label: "Invoices", icon: FileText },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "database", label: "Database", icon: Database },
  { id: "security", label: "Security", icon: Shield },
  { id: "reports", label: "Reports", icon: FileBarChart },
  { id: "settings", label: "Settings", icon: Settings },
];

function DashboardSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium">Dashboard</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Usuarios</span>
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-semibold">1,247</p>
          <div className="flex items-center text-xs text-green-600">
            <TrendingUp className="h-3 w-3 mr-1" />
            +12% este mes
          </div>
        </div>
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Consultas/día</span>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-semibold">8,432</p>
          <div className="flex items-center text-xs text-green-600">
            <TrendingUp className="h-3 w-3 mr-1" />
            +8% vs ayer
          </div>
        </div>
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Ingresos</span>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-semibold">€24,500</p>
          <div className="flex items-center text-xs text-green-600">
            <TrendingUp className="h-3 w-3 mr-1" />
            +15% este mes
          </div>
        </div>
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Uptime</span>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </div>
          <p className="text-2xl font-semibold">99.9%</p>
          <span className="text-xs text-muted-foreground">Últimos 30 días</span>
        </div>
      </div>
      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-medium mb-4">Actividad reciente</h3>
        <div className="space-y-3">
          {[
            { action: "Nuevo usuario registrado", time: "Hace 2 min", type: "user" },
            { action: "Pago recibido - €99", time: "Hace 15 min", type: "payment" },
            { action: "Modelo GPT-4 actualizado", time: "Hace 1 hora", type: "model" },
            { action: "Backup completado", time: "Hace 3 horas", type: "system" },
          ].map((item, i) => (
            <div key={i} className="flex items-center justify-between py-2 text-sm">
              <span>{item.action}</span>
              <span className="text-xs text-muted-foreground">{item.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface AdminUser {
  id: string;
  email: string | null;
  name: string | null;
  lastName: string | null;
  plan: string | null;
  role: string | null;
  status: string | null;
  dailyRequestsUsed: number | null;
  dailyRequestsLimit: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: Date | null;
}

function UsersSection() {
  const [searchQuery, setSearchQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/users-list", { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error("Failed to fetch users:", error);
    } finally {
      setLoading(false);
    }
  };

  const updateUserPlan = async (userId: string, plan: string) => {
    try {
      setUpdatingUserId(userId);
      const response = await fetch(`/api/admin/user/${userId}/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plan })
      });
      if (response.ok) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, plan } : u));
      }
    } catch (error) {
      console.error("Failed to update user plan:", error);
    } finally {
      setUpdatingUserId(null);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const filteredUsers = users.filter(u =>
  (u.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email?.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const planOptions = ["free", "go", "plus", "pro"];
  const planColors: Record<string, string> = {
    free: "bg-gray-100 text-gray-700",
    go: "bg-purple-100 text-purple-700",
    plus: "bg-blue-100 text-blue-700",
    pro: "bg-green-100 text-green-700"
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Usuarios ({users.length})</h2>
        <Button size="sm" onClick={fetchUsers} data-testid="button-refresh-users">
          <RefreshCw className="h-4 w-4 mr-2" />
          Actualizar
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar usuarios..."
            className="pl-9 h-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-users"
          />
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-8">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-lg border">
          <div className="grid grid-cols-6 gap-4 p-3 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
            <span>Usuario</span>
            <span>Plan</span>
            <span>Estado</span>
            <span>Uso diario</span>
            <span>Suscripción</span>
            <span>Cambiar Plan</span>
          </div>
          {filteredUsers.map((user) => (
            <div key={user.id} className="grid grid-cols-6 gap-4 p-3 border-b last:border-0 items-center text-sm">
              <div>
                <p className="font-medium">{user.name || user.email?.split("@")[0] || "Usuario"}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email || "Sin email"}</p>
              </div>
              <Badge
                variant="secondary"
                className={cn("w-fit uppercase text-xs", planColors[user.plan || "free"])}
              >
                {user.plan || "free"}
              </Badge>
              <Badge variant={user.status === "active" ? "default" : "outline"} className="w-fit">
                {user.status === "active" ? "Activo" : user.status || "Pendiente"}
              </Badge>
              <span className="text-xs">
                {user.dailyRequestsLimit === -1 ? (
                  <span className="text-green-600">Ilimitado</span>
                ) : (
                  `${user.dailyRequestsUsed || 0} / ${user.dailyRequestsLimit || 3}`
                )}
              </span>
              <span className="text-xs">
                {user.stripeSubscriptionId ? (
                  <Badge variant="outline" className="bg-green-50 text-green-700 text-xs">Stripe</Badge>
                ) : (
                  <span className="text-muted-foreground">Manual</span>
                )}
              </span>
              <select
                className="h-8 px-2 text-xs border rounded-md bg-background disabled:opacity-50"
                value={user.plan || "free"}
                onChange={(e) => updateUserPlan(user.id, e.target.value)}
                disabled={updatingUserId === user.id}
                data-testid={`select-plan-${user.id}`}
                aria-label="Seleccionar plan de usuario"
                title="Seleccionar plan de usuario"
              >
                {planOptions.map(plan => (
                  <option key={plan} value={plan}>{plan.toUpperCase()}</option>
                ))}
              </select>
            </div>
          ))}
          {filteredUsers.length === 0 && (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No se encontraron usuarios
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ApiKeyStatus {
  provider: string;
  isValid: boolean | null;
  message?: string;
}

function AIModelsSection() {
  const [validating, setValidating] = useState(false);
  const [apiStatuses, setApiStatuses] = useState<Record<string, ApiKeyStatus>>({});

  // Test Model State
  const [testModel, setTestModel] = useState<{ name: string, provider: string } | null>(null);
  const [testPrompt, setTestPrompt] = useState("Hello, this is a test.");
  const [testResponse, setTestResponse] = useState("");
  const [isTesting, setIsTesting] = useState(false);

  const handleTestModel = async () => {
    if (!testModel) return;
    setIsTesting(true);
    setTestResponse("");
    try {
      // Logic to test model would go here
      await new Promise(resolve => setTimeout(resolve, 1500)); // Simulating
      setTestResponse(`Response from ${testModel.name}: This is a simulated response confirming the model is reachable and functioning correctly.`);
    } catch (e) {
      setTestResponse("Error testing model.");
    } finally {
      setIsTesting(false);
    }
  };

  const models = [
    { name: "GPT-4 Turbo", provider: "OpenAI", status: "active", usage: 78, cost: "€0.03/1K" },
    { name: "GPT-3.5", provider: "OpenAI", status: "active", usage: 45, cost: "€0.002/1K" },
    { name: "Grok-3", provider: "xAI", status: "active", usage: 92, cost: "€0.05/1K" },
    { name: "Claude 3", provider: "Anthropic", status: "inactive", usage: 0, cost: "€0.025/1K" },
    { name: "Gemini 1.5 Pro", provider: "Google", status: "active", usage: 60, cost: "€0.003/1K" },
  ];

  const validateApiKeys = async () => {
    setValidating(true);
    // Simulate API validation for now (will be replaced with real backend call)
    // In a real implementation, this would call /api/admin/validate-keys
    setTimeout(() => {
      setApiStatuses({
        OpenAI: { provider: "OpenAI", isValid: true, message: "Valid key" },
        xAI: { provider: "xAI", isValid: true, message: "Valid key" },
        Anthropic: { provider: "Anthropic", isValid: false, message: "Key missing or invalid" },
        Google: { provider: "Google", isValid: true, message: "Valid key" }
      });
      setValidating(false);
    }, 1500);
  };

  const getProviderStatus = (provider: string) => {
    return apiStatuses[provider];
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">AI Models</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={validateApiKeys} disabled={validating}>
            {validating ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />}
            Validar API Keys
          </Button>
          <Button size="sm" data-testid="button-add-model">
            <Plus className="h-4 w-4 mr-2" />
            Añadir modelo
          </Button>
        </div>
      </div>

      {Object.keys(apiStatuses).length > 0 && (
        <div className="grid grid-cols-4 gap-4 mb-4">
          {Object.entries(apiStatuses).map(([provider, status]) => (
            <div key={provider} className={cn("p-3 rounded-md border text-sm flex items-center justify-between",
              status.isValid ? "bg-green-500/10 border-green-500/20" : "bg-red-500/10 border-red-500/20")}>
              <span className="font-medium">{provider}</span>
              {status.isValid ?
                <CheckCircle className="h-4 w-4 text-green-500" /> :
                <XCircle className="h-4 w-4 text-red-500" />
              }
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4">
        {models.map((model, i) => {
          const providerStatus = getProviderStatus(model.provider);
          return (
            <div key={i} className="rounded-lg border p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Bot className="h-5 w-5" />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{model.name}</p>
                      {providerStatus && !providerStatus.isValid && (
                        <Badge variant="destructive" className="h-5 text-[10px] px-1">API Error</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{model.provider}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" className="h-8" onClick={() => setTestModel(model)}>
                    <Activity className="h-3 w-3 mr-2" />
                    Probar
                  </Button>
                  <span className="text-xs text-muted-foreground">{model.cost}</span>
                  <Switch checked={model.status === "active"} disabled={providerStatus?.isValid === false} />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Uso este mes</span>
                  <span>{model.usage}%</span>
                </div>
                <Progress value={model.usage} className="h-1.5" />
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={!!testModel} onOpenChange={(open) => !open && setTestModel(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Probar Modelo: {testModel?.name}</DialogTitle>
          <DialogDescription>
            Envía un prompt de prueba para verificar que el modelo responde correctamente.
          </DialogDescription>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Prompt del Sistema</label>
              <Input value={testPrompt} onChange={(e) => setTestPrompt(e.target.value)} />
            </div>
            {testResponse && (
              <div className="rounded-md bg-muted p-4 text-sm whitespace-pre-wrap">
                {testResponse}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setTestModel(null)}>Cerrar</Button>
            <Button onClick={handleTestModel} disabled={isTesting}>
              {isTesting ? "Probando..." : "Enviar Prueba"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaymentsSection() {
  const payments = [
    { id: "PAY-001", user: "Carlos García", amount: "€99.00", date: "15 Dic 2024", status: "completed" },
    { id: "PAY-002", user: "María López", amount: "€49.00", date: "14 Dic 2024", status: "completed" },
    { id: "PAY-003", user: "Juan Martínez", amount: "€19.00", date: "14 Dic 2024", status: "pending" },
    { id: "PAY-004", user: "Ana Rodríguez", amount: "€99.00", date: "13 Dic 2024", status: "completed" },
    { id: "PAY-005", user: "Pedro Sánchez", amount: "€19.00", date: "12 Dic 2024", status: "failed" },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium">Payments</h2>
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground mb-1">Ingresos del mes</p>
          <p className="text-xl font-semibold">€12,450</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground mb-1">Pagos pendientes</p>
          <p className="text-xl font-semibold">€380</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground mb-1">Tasa de éxito</p>
          <p className="text-xl font-semibold">98.2%</p>
        </div>
      </div>
      <div className="rounded-lg border">
        <div className="grid grid-cols-5 gap-4 p-3 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
          <span>ID</span>
          <span>Usuario</span>
          <span>Cantidad</span>
          <span>Fecha</span>
          <span>Estado</span>
        </div>
        {payments.map((payment) => (
          <div key={payment.id} className="grid grid-cols-5 gap-4 p-3 border-b last:border-0 items-center text-sm">
            <span className="font-mono text-xs">{payment.id}</span>
            <span>{payment.user}</span>
            <span className="font-medium">{payment.amount}</span>
            <span className="text-muted-foreground">{payment.date}</span>
            <Badge variant={payment.status === "completed" ? "default" : payment.status === "pending" ? "secondary" : "destructive"}>
              {payment.status === "completed" ? "Completado" : payment.status === "pending" ? "Pendiente" : "Fallido"}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function InvoicesSection() {
  const invoices = [
    { id: "INV-2024-001", client: "Empresa ABC", amount: "€2,970", date: "01 Dic 2024", status: "paid" },
    { id: "INV-2024-002", client: "Startup XYZ", amount: "€1,470", date: "01 Dic 2024", status: "paid" },
    { id: "INV-2024-003", client: "Corp 123", amount: "€990", date: "01 Dic 2024", status: "pending" },
    { id: "INV-2024-004", client: "Tech Solutions", amount: "€2,970", date: "01 Nov 2024", status: "paid" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Invoices</h2>
        <Button size="sm" data-testid="button-create-invoice">
          <Plus className="h-4 w-4 mr-2" />
          Crear factura
        </Button>
      </div>
      <div className="rounded-lg border">
        <div className="grid grid-cols-5 gap-4 p-3 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
          <span>Factura</span>
          <span>Cliente</span>
          <span>Importe</span>
          <span>Fecha</span>
          <span>Estado</span>
        </div>
        {invoices.map((invoice) => (
          <div key={invoice.id} className="grid grid-cols-5 gap-4 p-3 border-b last:border-0 items-center text-sm">
            <span className="font-mono text-xs">{invoice.id}</span>
            <span>{invoice.client}</span>
            <span className="font-medium">{invoice.amount}</span>
            <span className="text-muted-foreground">{invoice.date}</span>
            <div className="flex items-center gap-2">
              <Badge variant={invoice.status === "paid" ? "default" : "secondary"}>
                {invoice.status === "paid" ? "Pagada" : "Pendiente"}
              </Badge>
              <Button variant="ghost" size="sm" className="h-6 px-2">
                <Download className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium">Analytics</h2>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border p-4 space-y-4">
          <h3 className="text-sm font-medium">Consultas por día</h3>
          <div className="h-32 flex items-end justify-between gap-1">
            {[40, 65, 45, 80, 55, 90, 75].map((h, i) => (
              <div
                key={i}
                className="flex-1 bg-primary/20 rounded-t"
                style={{ "--bar-height": `${h}%` } as React.CSSProperties}
              >
                <div className="w-full h-[var(--bar-height)]" />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Lun</span>
            <span>Mar</span>
            <span>Mié</span>
            <span>Jue</span>
            <span>Vie</span>
            <span>Sáb</span>
            <span>Dom</span>
          </div>
        </div>
        <div className="rounded-lg border p-4 space-y-4">
          <h3 className="text-sm font-medium">Uso por modelo</h3>
          <div className="space-y-3">
            {[
              { name: "Grok-3", value: 45, color: "bg-blue-500" },
              { name: "GPT-4", value: 30, color: "bg-green-500" },
              { name: "GPT-3.5", value: 20, color: "bg-yellow-500" },
              { name: "Otros", value: 5, color: "bg-gray-400" },
            ].map((item) => (
              <div key={item.name} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span>{item.name}</span>
                  <span>{item.value}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden" style={{ "--prog-width": `${item.value}%` } as React.CSSProperties}>
                  <div
                    className={cn("h-full rounded-full w-[var(--prog-width)]", item.color)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-medium mb-4">Métricas clave</h3>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <p className="text-2xl font-semibold">2.3s</p>
            <p className="text-xs text-muted-foreground">Tiempo respuesta</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">94%</p>
            <p className="text-xs text-muted-foreground">Satisfacción</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">1.2M</p>
            <p className="text-xs text-muted-foreground">Tokens/día</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">€0.08</p>
            <p className="text-xs text-muted-foreground">Costo/consulta</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DatabaseSection() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Database</h2>
        <Button variant="outline" size="sm" data-testid="button-backup-db">
          <RefreshCw className="h-4 w-4 mr-2" />
          Backup
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 mb-2">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Almacenamiento</span>
          </div>
          <p className="text-xl font-semibold">24.5 GB</p>
          <Progress value={49} className="h-1.5 mt-2" />
          <p className="text-xs text-muted-foreground mt-1">de 50 GB</p>
        </div>
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Conexiones</span>
          </div>
          <p className="text-xl font-semibold">47 / 100</p>
          <Progress value={47} className="h-1.5 mt-2" />
        </div>
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Último backup</span>
          </div>
          <p className="text-xl font-semibold">Hoy</p>
          <p className="text-xs text-muted-foreground">03:00 AM</p>
        </div>
      </div>
      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-medium mb-4">Tablas principales</h3>
        <div className="space-y-2">
          {[
            { name: "users", rows: "1,247", size: "2.3 MB" },
            { name: "chats", rows: "45,892", size: "12.1 MB" },
            { name: "messages", rows: "234,567", size: "8.7 MB" },
            { name: "documents", rows: "8,234", size: "1.2 MB" },
          ].map((table) => (
            <div key={table.name} className="flex items-center justify-between py-2 text-sm">
              <span className="font-mono">{table.name}</span>
              <div className="flex items-center gap-6 text-muted-foreground">
                <span>{table.rows} filas</span>
                <span>{table.size}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SecuritySection() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium">Security</h2>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="h-5 w-5 text-green-500" />
            <span className="font-medium">Estado del sistema</span>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>SSL/TLS</span>
              <Badge variant="default">Activo</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Firewall</span>
              <Badge variant="default">Activo</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>2FA</span>
              <Badge variant="default">Habilitado</Badge>
            </div>
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 mb-4">
            <Key className="h-5 w-5" />
            <span className="font-medium">API Keys</span>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-mono text-xs">sk-****-1234</span>
              <Badge variant="secondary">Producción</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-mono text-xs">sk-****-5678</span>
              <Badge variant="outline">Desarrollo</Badge>
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full mt-3">
            <Plus className="h-3 w-3 mr-2" />
            Nueva API Key
          </Button>
        </div>
      </div>
      <div className="rounded-lg border p-4">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="h-5 w-5 text-yellow-500" />
          <span className="font-medium">Actividad reciente</span>
        </div>
        <div className="space-y-2">
          {[
            { event: "Login exitoso", user: "admin@empresa.com", ip: "192.168.1.1", time: "Hace 5 min" },
            { event: "API Key creada", user: "admin@empresa.com", ip: "192.168.1.1", time: "Hace 2 horas" },
            { event: "Intento fallido", user: "unknown", ip: "45.33.32.156", time: "Hace 1 día" },
          ].map((log, i) => (
            <div key={i} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span>{log.event}</span>
                <span className="text-muted-foreground ml-2">- {log.user}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{log.ip}</span>
                <span>{log.time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReportsSection() {
  const reports = [
    { name: "Informe mensual - Diciembre 2024", type: "Mensual", date: "01 Dic 2024", status: "ready" },
    { name: "Análisis de uso Q4 2024", type: "Trimestral", date: "01 Oct 2024", status: "ready" },
    { name: "Reporte de facturación", type: "Semanal", date: "15 Dic 2024", status: "generating" },
    { name: "Informe de seguridad", type: "Mensual", date: "01 Dic 2024", status: "ready" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Reports</h2>
        <Button size="sm" data-testid="button-generate-report">
          <Plus className="h-4 w-4 mr-2" />
          Generar reporte
        </Button>
      </div>
      <div className="rounded-lg border">
        {reports.map((report, i) => (
          <div key={i} className="flex items-center justify-between p-4 border-b last:border-0">
            <div>
              <p className="font-medium text-sm">{report.name}</p>
              <p className="text-xs text-muted-foreground">{report.type} - {report.date}</p>
            </div>
            <div className="flex items-center gap-2">
              {report.status === "ready" ? (
                <Button variant="outline" size="sm">
                  <Download className="h-3 w-3 mr-2" />
                  Descargar
                </Button>
              ) : (
                <Badge variant="secondary">
                  <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                  Generando
                </Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsSection() {
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [autoBackup, setAutoBackup] = useState(true);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium">Settings</h2>
      <div className="space-y-4">
        <div className="rounded-lg border p-4">
          <h3 className="text-sm font-medium mb-4">General</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Modo mantenimiento</p>
                <p className="text-xs text-muted-foreground">Desactiva el acceso público</p>
              </div>
              <Switch checked={maintenanceMode} onCheckedChange={setMaintenanceMode} />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Notificaciones por email</p>
                <p className="text-xs text-muted-foreground">Alertas del sistema</p>
              </div>
              <Switch checked={emailNotifications} onCheckedChange={setEmailNotifications} />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Backup automático</p>
                <p className="text-xs text-muted-foreground">Diario a las 03:00</p>
              </div>
              <Switch checked={autoBackup} onCheckedChange={setAutoBackup} />
            </div>
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <h3 className="text-sm font-medium mb-4">Límites</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Consultas por usuario/día</span>
                <span className="font-medium">100</span>
              </div>
              <Input type="number" defaultValue={100} className="h-8" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Tokens máximos por consulta</span>
                <span className="font-medium">4096</span>
              </div>
              <Input type="number" defaultValue={4096} className="h-8" />
            </div>
          </div>
        </div>
        <Button className="w-full" data-testid="button-save-settings">Guardar configuración</Button>
      </div>
    </div>
  );
}

export function AdminPanel({ open, onOpenChange }: AdminPanelProps) {
  const [activeSection, setActiveSection] = useState<AdminSection>("dashboard");

  const renderSection = () => {
    switch (activeSection) {
      case "dashboard": return <DashboardSection />;
      case "users": return <UsersSection />;
      case "ai-models": return <AIModelsSection />;
      case "payments": return <PaymentsSection />;
      case "invoices": return <InvoicesSection />;
      case "analytics": return <AnalyticsSection />;
      case "database": return <DatabaseSection />;
      case "security": return <SecuritySection />;
      case "reports": return <ReportsSection />;
      case "settings": return <SettingsSection />;
      default: return <DashboardSection />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[80vh] p-0 gap-0">
        <VisuallyHidden>
          <DialogTitle>Admin Panel</DialogTitle>
          <DialogDescription>Panel de administración del sistema</DialogDescription>
        </VisuallyHidden>
        <div className="flex h-full">
          <div className="w-48 border-r bg-muted/30 p-2">
            <div className="p-2 mb-2">
              <h2 className="font-semibold text-sm">Administration</h2>
            </div>
            <nav className="space-y-0.5">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors",
                    activeSection === item.id
                      ? "bg-background shadow-sm font-medium"
                      : "text-muted-foreground hover:bg-background/50"
                  )}
                  data-testid={`button-admin-nav-${item.id}`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-6">
                {renderSection()}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
