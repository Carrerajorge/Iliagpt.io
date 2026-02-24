import { useState, useEffect, useMemo, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { 
  ArrowLeft, 
  Settings, 
  Users, 
  Key, 
  CreditCard, 
  Bot, 
  AppWindow, 
  UsersRound, 
  BarChart3, 
  ShieldCheck,
  Copy,
  Upload,
  AlertTriangle,
  Info,
  Search,
  Plus,
  MoreHorizontal,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { IliaGPTLogo } from "@/components/iliagpt-logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/apiClient";
import { trackWorkspaceEvent as trackAnalyticsEvent } from "@/lib/analytics";
import { isAdminUser } from "@/lib/admin";
import { formatPeriodEndEs, shouldShowWorkspaceDeactivationBanner } from "@/lib/billing";
import { formatCurrency as i18nFormatCurrency, formatDate as i18nFormatDate, formatNumber as i18nFormatNumber } from "@/lib/i18n";
import { useCloudLibrary } from "@/hooks/use-cloud-library";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { UpgradePlanDialog } from "@/components/upgrade-plan-dialog";
import { CreditAlertsDialog } from "@/components/credit-alerts-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IdentityAccessSection } from "@/components/workspace-settings/IdentityAccessSection";
import { WorkspaceGroupsSection } from "@/components/workspace-settings/WorkspaceGroupsSection";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

type WorkspaceSection = "general" | "members" | "permissions" | "billing" | "gpt" | "apps" | "groups" | "analytics" | "identity";

type AnalyticsMetricKey = "userMessages" | "chatsCreated" | "tokensUsed" | "pageViews" | "actions";

type AnalyticsMember = {
  userId: string;
  email: string | null;
  displayName: string;
  role: string | null;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  chatsCreated: number;
  userMessages: number;
  tokensUsed: number;
  pageViews: number;
  actions: number;
};

type AnalyticsOverview = {
  canViewAll: boolean;
  days: number;
  startDate: string;
  endDate: string;
  sessionsCount: number;
  topPages: Array<{ page: string; count: number }>;
  topActions: Array<{ action: string; count: number }>;
  totals: {
    members: number;
    activeMembers: number;
    chatsCreated: number;
    userMessages: number;
    tokensUsed: number;
    pageViews: number;
    actions: number;
  };
  byMember: AnalyticsMember[];
  activityByDay: Array<{
    date: string;
    chatsCreated: number;
    userMessages: number;
    tokensUsed: number;
    pageViews: number;
    actions: number;
  }>;
};

type WorkspaceRole = {
  id: string;
  roleKey: string;
  name: string;
  description: string | null;
  permissions: string[];
  isCustom: boolean;
  isEditable: boolean;
};

type PermissionDefinition = {
  id: string;
  label: string;
  category: string;
  description?: string;
};

const menuItems: { id: WorkspaceSection; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <Settings className="h-4 w-4" /> },
  { id: "members", label: "Miembros", icon: <Users className="h-4 w-4" /> },
  { id: "permissions", label: "Permisos y roles", icon: <Key className="h-4 w-4" /> },
  { id: "billing", label: "Facturación", icon: <CreditCard className="h-4 w-4" /> },
  { id: "gpt", label: "GPT", icon: <Bot className="h-4 w-4" /> },
  { id: "apps", label: "Aplicaciones", icon: <AppWindow className="h-4 w-4" /> },
  { id: "groups", label: "Grupos", icon: <UsersRound className="h-4 w-4" /> },
  { id: "analytics", label: "Análisis de usuario", icon: <BarChart3 className="h-4 w-4" /> },
  { id: "identity", label: "Identidad y acceso", icon: <ShieldCheck className="h-4 w-4" /> },
];

const analyticsMetricOptions: { value: AnalyticsMetricKey; label: string; color: string }[] = [
  { value: "userMessages", label: "Mensajes de usuario", color: "#2563eb" },
  { value: "chatsCreated", label: "Chats creados", color: "#0f766e" },
  { value: "tokensUsed", label: "Tokens usados", color: "#b45309" },
  { value: "pageViews", label: "Vistas de página", color: "#9333ea" },
  { value: "actions", label: "Acciones", color: "#dc2626" },
];

export default function WorkspaceSettingsPage() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("general");
  const { user } = useAuth();
  const isAdmin = isAdminUser(user as any);
  const [canManageWorkspace, setCanManageWorkspace] = useState(false);
  const [canManageRoles, setCanManageRoles] = useState(false);
  const [canManageBilling, setCanManageBilling] = useState(false);
  const { toast } = useToast();
  const userDisplayName = user?.fullName || user?.username || "Tu cuenta";
  const userEmail = user?.email || "";
  const userInitials =
    userDisplayName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0] || "")
      .join("")
      .toUpperCase() || "U";
  const [workspaceName, setWorkspaceName] = useState("");
  const [orgId, setOrgId] = useState<string>("");
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [logoFileUuid, setLogoFileUuid] = useState<string | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [membersFilter, setMembersFilter] = useState("");
  const [analyticsDays, setAnalyticsDays] = useState<7 | 30 | 90>(30);
  const [analyticsMetric, setAnalyticsMetric] = useState<AnalyticsMetricKey>("userMessages");
  const [analyticsData, setAnalyticsData] = useState<AnalyticsOverview | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [analyticsMemberFilter, setAnalyticsMemberFilter] = useState("");
  const [analyticsMemberSort, setAnalyticsMemberSort] = useState<"activity" | "messages" | "tokens" | "recent">("activity");
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [addCreditsOpen, setAddCreditsOpen] = useState(false);
  const [creditsTopupAmountUsd, setCreditsTopupAmountUsd] = useState<string>("5");
  const [creditsTopupSubmitting, setCreditsTopupSubmitting] = useState(false);
  const [roles, setRoles] = useState<WorkspaceRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [permissionsCatalog, setPermissionsCatalog] = useState<PermissionDefinition[]>([]);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [roleDialogMode, setRoleDialogMode] = useState<"create" | "edit">("create");
  const [roleEditingId, setRoleEditingId] = useState<string | null>(null);
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [roleSaving, setRoleSaving] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("team_member");
  const [inviteSending, setInviteSending] = useState(false);
  const [planSelectKey, setPlanSelectKey] = useState(0);
  const [billingTab, setBillingTab] = useState<"plan" | "invoices">("plan");
  const [creditsOffset, setCreditsOffset] = useState(0);
  const [creditsUsage, setCreditsUsage] = useState<{
    cycleStart: string;
    cycleEnd: string;
    plan: string;
    totalTokens: number;
    totalRequests: number;
    limitTokens: number | null;
    percentUsed: number | null;
    extraCredits?: number;
    extraCreditsNextExpiry?: string | null;
  } | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<
    {
      id: string;
      number: string | null;
      status: string | null;
      currency: string | null;
      amountDue: number;
      amountPaid: number;
      amountRemaining: number;
      subtotal: number | null;
      total: number | null;
      createdAt: string | null;
      periodStart: string | null;
      periodEnd: string | null;
      hostedInvoiceUrl: string | null;
      invoicePdf: string | null;
    }[]
  >([]);
  const [invoicesCursor, setInvoicesCursor] = useState<string | null>(null);
  const [invoicesHasMore, setInvoicesHasMore] = useState(false);
  const [invoicesLoaded, setInvoicesLoaded] = useState(false);

  const [billingStatus, setBillingStatus] = useState<{
    subscriptionStatus: string | null;
    subscriptionPeriodEnd: string | null;
    willDeactivate: boolean;
    plan?: string;
    monthsPaid?: number;
    extraCredits?: number;
  } | null>(null);

  const [membersLoading, setMembersLoading] = useState(false);
  const [members, setMembers] = useState<
    {
      id: string;
      email: string | null;
      fullName: string | null;
      firstName: string | null;
      lastName: string | null;
      profileImageUrl?: string | null;
      role: string | null;
      plan?: string | null;
      addedAt?: string | null;
      status?: string | null;
      createdAt: string | null;
      lastLoginAt: string | null;
    }[]
  >([]);
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [pendingInvitesLoading, setPendingInvitesLoading] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<
    {
      id: string;
      email: string;
      role: string;
      status: string;
      createdAt: string;
      lastSentAt: string | null;
      invitedByName?: string | null;
      invitedByEmail?: string | null;
    }[]
  >([]);

  const deactivationDateLabel = useMemo(() => {
    return formatPeriodEndEs(billingStatus?.subscriptionPeriodEnd ?? null);
  }, [billingStatus?.subscriptionPeriodEnd]);

  const showDeactivationBanner = useMemo(() => {
    return shouldShowWorkspaceDeactivationBanner({
      subscriptionStatus: billingStatus?.subscriptionStatus,
      subscriptionPeriodEnd: billingStatus?.subscriptionPeriodEnd,
    });
  }, [billingStatus?.subscriptionStatus, billingStatus?.subscriptionPeriodEnd]);

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const section = params.get("section") as WorkspaceSection | null;
    if (section && menuItems.some(item => item.id === section)) {
      setActiveSection(section);
    }
  }, [searchString]);

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const subscription = params.get("subscription");
    const credits = params.get("credits");

    if (!subscription && !credits) return;

    // Clear one-time Stripe return params to avoid duplicate toasts on refresh.
    params.delete("subscription");
    params.delete("credits");
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash || ""}`;
    window.history.replaceState({}, "", nextUrl);

    const refreshBilling = async () => {
      try {
        const res = await apiFetch("/api/billing/status");
        if (res.ok) {
          const data = await res.json();
          setBillingStatus(data);
        }
      } catch {
        // ignore
      }
    };

    const refreshCredits = async () => {
      try {
        setCreditsOffset(0);
        setCreditsLoading(true);
        const res = await apiFetch(`/api/billing/credits/usage?offset=0`);
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "No se pudo cargar el uso de créditos");
        setCreditsUsage(data);
      } catch (e: any) {
        toast({
          title: "Error",
          description: e?.message || "No se pudo cargar el uso de créditos.",
          variant: "destructive",
        });
      } finally {
        setCreditsLoading(false);
      }
    };

    if (subscription === "success") {
      toast({ title: "Suscripción activada", description: "Tu plan fue actualizado correctamente." });
      setActiveSection("billing");
      setBillingTab("plan");
      void refreshBilling();
      void refreshCredits();
      setInvoicesLoaded(false);
    } else if (subscription === "cancelled") {
      toast({ title: "Suscripción cancelada", description: "No se realizó ningún cargo." });
    }

    if (credits === "success") {
      toast({ title: "Créditos agregados", description: "La compra se registró correctamente." });
      setActiveSection("billing");
      setBillingTab("plan");
      void refreshBilling();
      void refreshCredits();
      setInvoicesLoaded(false);
    } else if (credits === "cancelled") {
      toast({ title: "Compra cancelada", description: "No se realizó ningún cargo." });
    }
  }, [searchString, toast]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await apiFetch("/api/billing/status");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setBillingStatus(data);
        }
      } catch {
        // ignore
      }
    })();

    (async () => {
      try {
        const res = await apiFetch("/api/workspace/me");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setOrgId(data.orgId || "");
        setWorkspaceId(data.workspaceId || "");
        setWorkspaceName(data.name || "");
        setLogoFileUuid(data.logoFileUuid || null);
        setMemberCount(typeof data.memberCount === "number" ? data.memberCount : null);
        setCanManageWorkspace(!!data.canManageWorkspace);
        setCanManageMembers(!!data.canManageMembers);
        setCanManageRoles(!!data.canManageRoles);
        setCanManageBilling(!!data.canManageBilling);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeSection !== "billing") return;

    let cancelled = false;
    setCreditsLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/billing/credits/usage?offset=${creditsOffset}`);
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error || "No se pudo cargar el uso de créditos");
        }
        if (!cancelled) setCreditsUsage(data);
      } catch (e: any) {
        if (!cancelled) {
          toast({
            title: "Error",
            description: e?.message || "No se pudo cargar el uso de créditos.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setCreditsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSection, creditsOffset, toast]);

  const trackWorkspaceEvent = useCallback(async (payload: {
    eventType: "page_view" | "action";
    page?: string;
    action?: string;
    metadata?: Record<string, any>;
  }) => {
    await trackAnalyticsEvent(payload);
  }, []);

  useEffect(() => {
    void trackWorkspaceEvent({
      eventType: "page_view",
      page: `workspace-settings/${activeSection}`,
      metadata: { section: activeSection },
    });
  }, [activeSection, trackWorkspaceEvent]);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const res = await apiFetch(`/api/workspace/analytics/overview?days=${analyticsDays}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "No se pudo cargar el análisis de usuario");
      }
      setAnalyticsData(data);
    } catch (e: any) {
      setAnalyticsError(e?.message || "No se pudo cargar el análisis de usuario");
    } finally {
      setAnalyticsLoading(false);
    }
  }, [analyticsDays]);

  useEffect(() => {
    if (activeSection !== "analytics") return;
    void loadAnalytics();
  }, [activeSection, loadAnalytics]);

  const formatNumber = (value: number | null | undefined) => {
    if (typeof value !== "number") return "—";
    return i18nFormatNumber(value);
  };

  const formatDateShort = (iso: string | null | undefined) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return i18nFormatDate(d, { month: "short", day: "numeric" });
  };

  const formatDateLong = (iso: string | null | undefined) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return i18nFormatDate(d, { year: "numeric", month: "short", day: "numeric" });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const { uploadFile, isUploading } = useCloudLibrary();

  const openStripePortal = async () => {
    if (!canManageBilling) {
      toast({
        title: "Permisos insuficientes",
        description: "Solo propietarios o administradores de facturación pueden gestionar la facturación.",
      });
      return;
    }
    try {
      const res = await apiFetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "No se pudo abrir el portal de facturación");
      }
      if (data?.url) window.location.href = data.url;
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "No se pudo abrir el portal de facturación.",
        variant: "destructive",
      });
    }
  };

  const loadInvoices = async (opts?: { reset?: boolean }) => {
    if (!canManageBilling) return;
    if (invoicesLoading) return;

    const reset = opts?.reset === true;
    setInvoicesError(null);
    setInvoicesLoading(true);
    try {
      const cursor = reset ? null : invoicesCursor;
      const url = cursor
        ? `/api/billing/invoices?limit=10&startingAfter=${encodeURIComponent(cursor)}`
        : `/api/billing/invoices?limit=10`;
      const res = await apiFetch(url);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "No se pudieron cargar las facturas");
      }

      const nextInvoices = Array.isArray(data?.invoices) ? data.invoices : [];

      setInvoices((prev) => (reset ? nextInvoices : [...prev, ...nextInvoices]));
      setInvoicesHasMore(!!data?.hasMore);
      setInvoicesCursor(data?.nextCursor || null);
      setInvoicesLoaded(true);
    } catch (e: any) {
      const msg = e?.message || "No se pudieron cargar las facturas.";
      setInvoicesError(msg);
      toast({
        title: "Error",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setInvoicesLoading(false);
    }
  };

  useEffect(() => {
    if (activeSection !== "billing") return;
    if (billingTab !== "invoices") return;
    if (!canManageBilling) return;
    if (invoicesLoaded) return;
    void loadInvoices({ reset: true });
  }, [activeSection, billingTab, canManageBilling, invoicesLoaded]);

  const formatCycleShort = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return i18nFormatDate(d, { month: "short", day: "numeric" });
  };

  const planLabel = (planRaw: string | null | undefined) => {
    const plan = String(planRaw || "free").toLowerCase().trim();
    switch (plan) {
      case "free":
        return "Gratis";
      case "go":
        return "Go";
      case "plus":
        return "Plus";
      case "pro":
        return "Pro";
      case "business":
        return "Business";
      case "enterprise":
        return "Enterprise";
      case "admin":
        return "Admin";
      default:
        return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : "Gratis";
    }
  };

  const planPriceUsd = (planRaw: string | null | undefined): number | null => {
    const plan = String(planRaw || "").toLowerCase().trim();
    switch (plan) {
      case "go":
        return 5;
      case "plus":
        return 10;
      case "business":
        return 25;
      case "pro":
        return 200;
      default:
        return null;
    }
  };

  const planLabelWithPrice = (planRaw: string | null | undefined): string => {
    const label = planLabel(planRaw);
    const price = planPriceUsd(planRaw);
    return price ? `${label} ($${price})` : label;
  };

  const formatMoney = (amountCents: number | null | undefined, currency: string | null | undefined) => {
    if (typeof amountCents !== "number") return "—";
    const cur = String(currency || "usd").toUpperCase();
    try {
      return i18nFormatCurrency(amountCents / 100, cur);
    } catch {
      return `${(amountCents / 100).toFixed(2)} ${cur}`;
    }
  };

  const invoiceStatusInfo = (statusRaw: string | null | undefined) => {
    const status = String(statusRaw || "").toLowerCase().trim();
    switch (status) {
      case "paid":
        return { label: "Pagada", className: "bg-green-100 text-green-700 hover:bg-green-100" };
      case "open":
        return { label: "Pendiente", className: "bg-amber-100 text-amber-800 hover:bg-amber-100" };
      case "draft":
        return { label: "Borrador", className: "bg-slate-100 text-slate-700 hover:bg-slate-100" };
      case "void":
        return { label: "Anulada", className: "bg-slate-100 text-slate-700 hover:bg-slate-100" };
      case "uncollectible":
        return { label: "Incobrable", className: "bg-red-100 text-red-700 hover:bg-red-100" };
      default:
        return { label: statusRaw ? String(statusRaw) : "—", className: "bg-slate-100 text-slate-700 hover:bg-slate-100" };
    }
  };

  const formatInvoiceDate = (iso: string | null | undefined) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return i18nFormatDate(d, { year: "numeric", month: "short", day: "numeric" });
  };

  const memberCountLabel = memberCount === null ? "—" : i18nFormatNumber(memberCount);
  const memberCountUnit = memberCount === 1 ? "miembro" : "miembros";
  const selectedMetric = useMemo(
    () => analyticsMetricOptions.find((metric) => metric.value === analyticsMetric) ?? analyticsMetricOptions[0],
    [analyticsMetric]
  );
  const currentUserId = user?.id ? String(user.id) : null;
  const analyticsMembers = useMemo(() => {
    const members = analyticsData?.byMember ?? [];
    const filterValue = analyticsMemberFilter.trim().toLowerCase();
    const filtered = filterValue
      ? members.filter((member) => {
          const name = String(member.displayName || "").toLowerCase();
          const email = String(member.email || "").toLowerCase();
          return name.includes(filterValue) || email.includes(filterValue);
        })
      : members;

    const scored = filtered.map((member) => ({
      member,
      activityScore: member.chatsCreated + member.userMessages + member.pageViews + member.actions,
      lastActiveAt: member.lastActiveAt || member.lastLoginAt || "",
    }));

    scored.sort((a, b) => {
      switch (analyticsMemberSort) {
        case "messages":
          return b.member.userMessages - a.member.userMessages;
        case "tokens":
          return b.member.tokensUsed - a.member.tokensUsed;
        case "recent":
          return new Date(b.lastActiveAt || 0).getTime() - new Date(a.lastActiveAt || 0).getTime();
        case "activity":
        default:
          return b.activityScore - a.activityScore;
      }
    });

    return scored.map((entry) => entry.member);
  }, [analyticsData?.byMember, analyticsMemberFilter, analyticsMemberSort]);
  const rolesByKey = useMemo(() => {
    return new Map(roles.map((role) => [role.roleKey, role]));
  }, [roles]);
  const roleOptions = useMemo<WorkspaceRole[]>(() => {
    if (roles.length > 0) return roles;
    return [
      {
        id: "team_member",
        roleKey: "team_member",
        name: "Miembro",
        description: null,
        permissions: [],
        isCustom: false,
        isEditable: false,
      },
      {
        id: "team_admin",
        roleKey: "team_admin",
        name: "Administrador",
        description: null,
        permissions: [],
        isCustom: false,
        isEditable: false,
      },
    ];
  }, [roles]);
  const permissionGroups = useMemo(() => {
    const grouped = new Map<string, PermissionDefinition[]>();
    for (const perm of permissionsCatalog) {
      const list = grouped.get(perm.category) || [];
      list.push(perm);
      grouped.set(perm.category, list);
    }
    return Array.from(grouped.entries());
  }, [permissionsCatalog]);
  const permissionLabelById = useMemo(() => {
    return new Map(permissionsCatalog.map((perm) => [perm.id, perm.label]));
  }, [permissionsCatalog]);

  const handleLogoUpload = async (file: File) => {
    // Client-side validations
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (file.size > 2 * 1024 * 1024) {
      alert("El logo no puede superar 2MB");
      return;
    }
    if (file.type && !allowed.includes(file.type)) {
      alert("Formato no permitido. Use PNG, JPG o WebP");
      return;
    }

    const saved = await uploadFile({
      file,
      metadata: {
        name: "Workspace Logo",
        description: "Logo del espacio de trabajo",
      },
    });

    setLogoFileUuid(saved.uuid);

    // Persist immediately
    setIsSavingWorkspace(true);
    try {
      const res = await apiFetch("/api/workspace/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoFileUuid: saved.uuid }),
      });
      if (res.ok) {
        const data = await res.json();
        setLogoFileUuid(data.logoFileUuid || null);
      }
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const handleSaveName = async () => {
    setIsSavingWorkspace(true);
    try {
      const res = await apiFetch("/api/workspace/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: workspaceName }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        alert(data?.error || "No se pudo guardar");
        return;
      }
      setWorkspaceName(data.name || workspaceName);
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const roleLabelEs = (roleRaw: string | null | undefined) => {
    const roleKey = String(roleRaw || "").toLowerCase().trim();
    const roleMatch = rolesByKey.get(roleKey);
    if (roleMatch?.isCustom) return roleMatch.name;
    switch (roleKey) {
      case "superadmin":
        return "Superadmin";
      case "admin":
        return "Admin del sistema";
      case "workspace_owner":
      case "owner":
      case "team_admin":
      case "workspace_admin":
        return "Administrador";
      case "billing_manager":
        return "Facturación";
      case "guest":
        return "Invitado";
      case "free":
        return "Usuario gratuito";
      case "pro":
        return "Usuario Pro";
      case "workspace_viewer":
        return "Lector";
      case "workspace_member":
      case "team_member":
      case "user":
      default:
        return "Miembro";
    }
  };

  const getMemberDisplayName = (member: { fullName?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null; }) => {
    const full = member.fullName?.trim();
    if (full) return full;
    const combined = `${member.firstName || ""} ${member.lastName || ""}`.trim();
    if (combined) return combined;
    return member.email || "Miembro";
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0] || "")
      .join("")
      .toUpperCase();
  };

  const loadMembers = async () => {
    if (membersLoading) return;
    setMembersLoading(true);
    try {
      const res = await apiFetch("/api/workspace/members");
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudieron cargar los miembros");
      setMembers(Array.isArray(data?.members) ? data.members : []);
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "No se pudieron cargar los miembros.",
        variant: "destructive",
      });
    } finally {
      setMembersLoading(false);
    }
  };

  const loadRoles = async () => {
    if (rolesLoading) return;
    setRolesLoading(true);
    try {
      const res = await apiFetch("/api/workspace/roles");
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudieron cargar los roles");
      const nextRoles = Array.isArray(data?.roles) ? data.roles : [];
      setRoles(nextRoles);
      setPermissionsCatalog(Array.isArray(data?.permissions) ? data.permissions : []);
      if (nextRoles.length > 0 && !nextRoles.find((r: WorkspaceRole) => r.roleKey === inviteRole)) {
        setInviteRole(nextRoles[0].roleKey);
      }
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "No se pudieron cargar los roles.",
        variant: "destructive",
      });
    } finally {
      setRolesLoading(false);
    }
  };

  const loadPendingInvites = async () => {
    if (!canManageMembers) return;
    if (pendingInvitesLoading) return;
    setPendingInvitesLoading(true);
    try {
      const res = await apiFetch("/api/workspace/invitations?status=pending");
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudieron cargar las invitaciones");
      setPendingInvites(Array.isArray(data?.invitations) ? data.invitations : []);
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "No se pudieron cargar las invitaciones.",
        variant: "destructive",
      });
    } finally {
      setPendingInvitesLoading(false);
    }
  };

  useEffect(() => {
    if (activeSection !== "members") return;
    void loadMembers();
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== "members") return;
    if (!canManageMembers) return;
    void loadPendingInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, canManageMembers]);

  useEffect(() => {
    if (activeSection !== "members" && activeSection !== "permissions") return;
    void loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  const inviteMember = async () => {
    const emails = inviteEmails
      .split(/[\s,;]+/g)
      .map((value) => value.trim())
      .filter(Boolean);
    if (emails.length === 0) return;
    if (!canManageMembers) {
      toast({
        title: "Permisos insuficientes",
        description: "Solo propietarios o administradores pueden invitar miembros.",
        variant: "destructive",
      });
      return;
    }
    setInviteSending(true);
    try {
      const res = await apiFetch("/api/workspace/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails, role: inviteRole, message: inviteMessage.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudo enviar la invitación");

      const results: Array<{ status?: string }> = Array.isArray(data?.results) ? data.results : [];
      const invitedCount = results.filter((r) => r.status === "invited").length;
      const failedCount = results.filter((r) => r.status && r.status !== "invited" && r.status !== "already_member").length;

      toast({
        title: invitedCount > 0 ? "Invitaciones enviadas" : "Invitación procesada",
        description:
          invitedCount > 0
            ? `${invitedCount} invitación(es) enviada(s)${failedCount ? ` · ${failedCount} con error` : ""}.`
            : "Sin nuevas invitaciones.",
      });

      setInviteEmails("");
      setInviteMessage("");
      if (!inviteRole) {
        setInviteRole("team_member");
      }
      setInviteOpen(false);
      await loadPendingInvites();
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "No se pudo enviar la invitación.",
        variant: "destructive",
      });
    } finally {
      setInviteSending(false);
    }
  };

  const updateMemberRole = async (memberId: string, role: string) => {
    if (!canManageMembers) return;
    try {
      const res = await apiFetch(`/api/workspace/members/${encodeURIComponent(memberId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudo actualizar el rol");
      toast({ title: "Rol actualizado" });
      await loadMembers();
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "No se pudo actualizar el rol.",
        variant: "destructive",
      });
    }
  };

  const resendInvite = async (inviteId: string) => {
    if (!canManageMembers) return;
    try {
      const res = await apiFetch(`/api/workspace/invitations/${encodeURIComponent(inviteId)}/resend`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudo reenviar");
      toast({
        title: "Invitación reenviada",
        description: process.env.NODE_ENV === "production" ? undefined : (data?.magicLinkUrl ? `Link (dev): ${data.magicLinkUrl}` : undefined),
      });
      await loadPendingInvites();
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "No se pudo reenviar la invitación.",
        variant: "destructive",
      });
    }
  };

  const revokeInvite = async (inviteId: string) => {
    if (!canManageMembers) return;
    try {
      const res = await apiFetch(`/api/workspace/invitations/${encodeURIComponent(inviteId)}/revoke`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudo revocar");
      toast({ title: "Invitación revocada" });
      await loadPendingInvites();
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "No se pudo revocar la invitación.",
        variant: "destructive",
      });
    }
  };

  const openCreateRoleDialog = () => {
    setRoleDialogMode("create");
    setRoleEditingId(null);
    setRoleName("");
    setRoleDescription("");
    setRolePermissions([]);
    setRoleDialogOpen(true);
  };

  const openEditRoleDialog = (role: WorkspaceRole) => {
    setRoleDialogMode("edit");
    setRoleEditingId(role.id);
    setRoleName(role.name);
    setRoleDescription(role.description || "");
    setRolePermissions(Array.isArray(role.permissions) ? role.permissions : []);
    setRoleDialogOpen(true);
  };

  const toggleRolePermission = (permId: string, checked: boolean) => {
    setRolePermissions((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(permId);
      } else {
        next.delete(permId);
      }
      return Array.from(next);
    });
  };

  const saveRole = async () => {
    if (!canManageRoles) return;
    if (!roleName.trim()) {
      toast({ title: "Nombre requerido", description: "Ingresa un nombre para el rol." });
      return;
    }
    setRoleSaving(true);
    try {
      const payload = {
        name: roleName.trim(),
        description: roleDescription.trim() || undefined,
        permissions: rolePermissions,
      };
      const endpoint =
        roleDialogMode === "edit" && roleEditingId
          ? `/api/workspace/roles/${encodeURIComponent(roleEditingId)}`
          : "/api/workspace/roles";
      const method = roleDialogMode === "edit" ? "PUT" : "POST";
      const res = await apiFetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudo guardar el rol");
      toast({ title: roleDialogMode === "edit" ? "Rol actualizado" : "Rol creado" });
      setRoleDialogOpen(false);
      await loadRoles();
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "No se pudo guardar el rol.",
        variant: "destructive",
      });
    } finally {
      setRoleSaving(false);
    }
  };

  const deleteRole = async (role: WorkspaceRole) => {
    if (!canManageRoles) return;
    const confirmed = window.confirm(`¿Eliminar el rol \"${role.name}\"? Los miembros asignados volverán a \"Miembro\".`);
    if (!confirmed) return;
    try {
      const res = await apiFetch(`/api/workspace/roles/${encodeURIComponent(role.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudo eliminar el rol");
      toast({ title: "Rol eliminado" });
      await loadRoles();
      await loadMembers();
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "No se pudo eliminar el rol.",
        variant: "destructive",
      });
    }
  };

  const startCreditsCheckout = async (amountUsd: number): Promise<boolean> => {
    if (!canManageBilling) {
      toast({
        title: "Permisos insuficientes",
        description: "Solo propietarios o administradores de facturación pueden comprar créditos.",
        variant: "destructive",
      });
      return false;
    }
    try {
      const res = await apiFetch("/api/billing/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsd }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudo iniciar el pago");
      if (data?.url) {
        window.location.href = data.url;
        return true;
      }
      throw new Error("No se pudo iniciar el pago");
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "No se pudo iniciar el pago.",
        variant: "destructive",
      });
      return false;
    }
  };

  const renderContent = () => {
    switch (activeSection) {
	      case "general":
	        return (
	          <div className="space-y-8">
	            <div>
	              <h1 className="text-2xl font-semibold">General</h1>
	              <p className="text-sm text-muted-foreground mt-1">
	                Personaliza el aspecto, el nombre, las instrucciones y más de tu espacio de trabajo.
	              </p>
	            </div>

	            {!canManageWorkspace && (
	              <div className="rounded-lg border bg-muted/30 p-4 flex items-start justify-between gap-4">
	                <div className="space-y-1">
	                  <p className="text-sm font-medium">Permisos insuficientes</p>
	                  <p className="text-sm text-muted-foreground">
	                    Solo propietarios o administradores del espacio de trabajo pueden cambiar el nombre o el logotipo.
	                  </p>
	                </div>
	              </div>
	            )}

	            <div className="space-y-6">
	              <h2 className="text-lg font-medium">Aspecto</h2>
	              
	              <div className="space-y-4">
	                <div className="flex items-center justify-between gap-3">
	                  <span className="text-sm">Nombre de espacio de trabajo</span>
	                  <div className="flex items-center gap-2">
	                    <Input
	                      value={workspaceName}
	                      onChange={(e) => setWorkspaceName(e.target.value)}
	                      disabled={!canManageWorkspace}
	                      className="w-72"
	                      data-testid="input-workspace-name"
	                      placeholder="Espacio de trabajo"
	                    />
	                    <Button
	                      variant="outline"
	                      size="sm"
	                      disabled={!canManageWorkspace || isSavingWorkspace || !workspaceName.trim()}
	                      onClick={handleSaveName}
	                      data-testid="button-save-workspace-name"
	                    >
	                      Guardar
	                    </Button>
	                  </div>
	                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1">
                    <span className="text-sm">Logotipo</span>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </div>
	                  <div className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center">
	                    <Upload className="h-7 w-7 text-muted-foreground mb-2" />
	                    <p className="text-sm text-muted-foreground">PNG/JPG/WebP, máx. 2MB</p>
	                    <div className="mt-2">
	                      <label
	                        className={cn(
	                          "text-sm cursor-pointer",
	                          canManageWorkspace ? "text-primary hover:underline" : "text-muted-foreground cursor-not-allowed"
	                        )}
	                        data-testid="button-browse-files"
	                      >
	                        <input
	                          type="file"
	                          className="hidden"
	                          accept="image/png,image/jpeg,image/webp"
	                          disabled={!canManageWorkspace || isUploading}
	                          onChange={(e) => {
	                            const f = e.target.files?.[0];
	                            if (f) handleLogoUpload(f);
	                            e.target.value = '';
	                          }}
	                        />
	                        {isUploading ? "Subiendo..." : "Explorar archivos"}
	                      </label>
	                    </div>
	                    {logoFileUuid && (
	                      <p className="mt-2 text-xs text-muted-foreground">Logo actualizado</p>
	                    )}
	                  </div>
	                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-6">
              <h2 className="text-lg font-medium">Detalles del espacio de trabajo</h2>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">ID de la organización</span>
                  <div className="flex items-center gap-2">
                    <code className="text-sm bg-muted px-3 py-1.5 rounded font-mono">{orgId}</code>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={() => copyToClipboard(orgId)}
                      data-testid="button-copy-org-id"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm">ID del espacio de trabajo</span>
                  <div className="flex items-center gap-2">
                    <code className="text-sm bg-muted px-3 py-1.5 rounded font-mono">{workspaceId}</code>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={() => copyToClipboard(workspaceId)}
                      data-testid="button-copy-workspace-id"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case "members": {
        const filterValue = membersFilter.trim().toLowerCase();
        const filteredMembers = members.filter((member) => {
          if (!filterValue) return true;
          const haystack = `${member.fullName || ""} ${member.firstName || ""} ${member.lastName || ""} ${member.email || ""}`.toLowerCase();
          return haystack.includes(filterValue);
        });

        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-semibold">Miembros</h1>
              <p className="text-sm text-muted-foreground">
                Empresa · {memberCountLabel} {memberCountUnit}
              </p>
            </div>

            <Tabs defaultValue="users" className="w-full">
              <TabsList className="bg-transparent border-b rounded-none w-full justify-start h-auto p-0 gap-6">
                <TabsTrigger 
                  value="users" 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-0 pb-2"
                  data-testid="tab-users"
                >
                  Usuarios
                </TabsTrigger>
                <TabsTrigger 
                  value="pending-invites" 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-0 pb-2"
                  data-testid="tab-pending-invites"
                >
                  Invitaciones pendientes
                </TabsTrigger>
                <TabsTrigger 
                  value="pending-requests" 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-0 pb-2"
                  data-testid="tab-pending-requests"
                >
                  Solicitudes pendientes
                </TabsTrigger>
              </TabsList>

              <TabsContent value="users" className="mt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
	                    <Input 
	                      placeholder="Filtrar por nombre" 
	                      className="pl-9 w-64"
	                      value={membersFilter}
	                      onChange={(e) => setMembersFilter(e.target.value)}
                      onBlur={() => {
                        const trimmed = membersFilter.trim();
                        if (!trimmed) return;
                        void trackWorkspaceEvent({
                          eventType: "action",
                          action: "members_filter",
                          metadata: { queryLength: trimmed.length },
                        });
                      }}
                      data-testid="input-filter-members"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      className="gap-2"
                      data-testid="button-invite-member"
                      onClick={() => {
                        void trackWorkspaceEvent({
                          eventType: "action",
                          action: "members_invite_clicked",
                        });
                        if (!canManageMembers) {
                          toast({
                            title: "Permisos insuficientes",
                            description: "Solo propietarios o administradores pueden invitar miembros.",
                            variant: "destructive",
                          });
                          return;
                        }
                        setInviteOpen(true);
                      }}
                      disabled={!canManageMembers}
                    >
                      <Plus className="h-4 w-4" />
                      Invitar a un miembro
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      data-testid="button-members-more"
                      onClick={() => {
                        void trackWorkspaceEvent({
                          eventType: "action",
                          action: "members_more_opened",
                        });
                      }}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

	                <div className="border rounded-lg">
	                  <div className="grid grid-cols-3 gap-4 px-4 py-3 border-b bg-muted/30 text-sm font-medium text-muted-foreground">
	                    <span>Nombre</span>
	                    <span>Tipo de cuenta</span>
	                    <span>Fecha agregada</span>
	                  </div>
                  {membersLoading ? (
                    <div className="px-4 py-8 text-sm text-muted-foreground text-center">Cargando miembros...</div>
                  ) : filteredMembers.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground text-center">
                      No se encontraron miembros con ese filtro.
                    </div>
                  ) : (
                    <div className="divide-y">
                      {filteredMembers.map((member) => {
                        const displayName = getMemberDisplayName(member);
                        const initials = getInitials(displayName);
                        const isSelf = String(member.id) === currentUserId;
                        const roleValue = member.role || "team_member";
                        const roleKeyLower = String(roleValue || "").toLowerCase().trim();
                        const isSystemAdminTarget = roleKeyLower === "admin" || roleKeyLower === "superadmin";
                        const canEditRole = canManageMembers && !isSelf && (!isSystemAdminTarget || isAdmin);

                        return (
                          <div key={member.id} className="grid grid-cols-3 gap-4 px-4 py-3 items-center">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-9 w-9">
                                <AvatarFallback className="bg-blue-100 text-blue-700 text-sm">{initials}</AvatarFallback>
                              </Avatar>
                              <div>
                                <span className="text-sm font-medium block">
                                  {displayName}
                                  {isSelf ? " (Tú)" : ""}
                                </span>
                                <span className="text-xs text-muted-foreground">{member.email || "—"}</span>
                              </div>
                            </div>
	                            <div className="space-y-0.5">
	                              <div className="flex items-center gap-2">
	                                {canEditRole ? (
	                                  <Select
	                                    value={roleValue}
	                                    onValueChange={(value) => void updateMemberRole(String(member.id), value)}
	                                  >
	                                    <SelectTrigger className="w-56" data-testid={`select-member-role-${member.id}`}>
	                                      <SelectValue />
	                                    </SelectTrigger>
	                                    <SelectContent>
	                                      {roleOptions.map((role) => (
	                                        <SelectItem key={role.roleKey} value={role.roleKey}>
	                                          {roleLabelEs(role.roleKey)}
	                                        </SelectItem>
	                                      ))}
	                                    </SelectContent>
	                                  </Select>
	                                ) : (
	                                  <span className="text-sm">{roleLabelEs(roleValue)}</span>
	                                )}
	                              </div>
	                              <span className="text-xs text-muted-foreground">
	                                Plan {planLabelWithPrice(member.plan)}
	                              </span>
	                            </div>
	                            <span className="text-sm">{formatDateShort(member.addedAt || member.createdAt)}</span>
	                          </div>
	                        );
	                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="pending-invites" className="mt-6">
                {!canManageMembers ? (
                  <p className="text-sm text-muted-foreground">No tienes permisos para ver invitaciones.</p>
                ) : pendingInvitesLoading ? (
                  <p className="text-sm text-muted-foreground">Cargando invitaciones...</p>
                ) : pendingInvites.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay invitaciones pendientes.</p>
                ) : (
                  <div className="border rounded-lg">
                    <div className="grid grid-cols-4 gap-4 px-4 py-3 border-b bg-muted/30 text-sm font-medium text-muted-foreground">
                      <span>Correo</span>
                      <span>Rol</span>
                      <span>Invitado por</span>
                      <span>Enviado</span>
                    </div>
                    {pendingInvites.map((inv) => (
                      <div key={inv.id} className="grid grid-cols-4 gap-4 px-4 py-3 items-center border-b last:border-b-0">
                        <div className="text-sm">
                          <div className="font-medium">{inv.email}</div>
                          <div className="text-xs text-muted-foreground">{inv.status}</div>
                        </div>
                        <span className="text-sm">{roleLabelEs(inv.role)}</span>
                        <span className="text-sm text-muted-foreground">{inv.invitedByName || inv.invitedByEmail || "—"}</span>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-muted-foreground">{formatDateShort(inv.lastSentAt || inv.createdAt)}</span>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void resendInvite(inv.id)}
                              data-testid={`button-resend-invite-${inv.id}`}
                            >
                              Reenviar
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void revokeInvite(inv.id)}
                              data-testid={`button-revoke-invite-${inv.id}`}
                            >
                              Revocar
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="pending-requests" className="mt-6">
                <p className="text-sm text-muted-foreground">No hay solicitudes pendientes.</p>
              </TabsContent>
            </Tabs>
          </div>
        );
      }

      case "permissions":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-semibold">Permisos y roles</h1>
              <p className="text-sm text-muted-foreground">
                Configura los permisos básicos para tu espacio de trabajo y personaliza el acceso con roles personalizados.
              </p>
            </div>

            <Tabs defaultValue="workspace" className="w-full">
              <TabsList className="bg-transparent border-b rounded-none w-full justify-start h-auto p-0">
                <TabsTrigger 
                  value="workspace" 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-0 pb-2"
                >
                  Espacio de trabajo
                </TabsTrigger>
              </TabsList>

              <TabsContent value="workspace" className="mt-6 space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">Roles del espacio de trabajo</h3>
                      <p className="text-xs text-muted-foreground">
                        Define roles personalizados y asigna permisos a tus colaboradores.
                      </p>
                    </div>
                    {canManageRoles ? (
                      <Button variant="outline" size="sm" onClick={openCreateRoleDialog}>
                        Crear rol
                      </Button>
                    ) : null}
                  </div>

                  {rolesLoading ? (
                    <p className="text-sm text-muted-foreground">Cargando roles...</p>
                  ) : roles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay roles configurados.</p>
                  ) : (
                    <div className="space-y-3">
                      {roles.map((role) => {
                        const labels = role.permissions.map((perm) => permissionLabelById.get(perm) || perm);
                        const visible = labels.slice(0, 4);
                        const extra = labels.length - visible.length;
                        return (
                          <div key={role.roleKey} className="border rounded-lg p-4 flex items-start justify-between gap-4">
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{roleLabelEs(role.roleKey)}</span>
                                <Badge variant={role.isCustom ? "default" : "secondary"} className="text-[10px] uppercase tracking-wide">
                                  {role.isCustom ? "Personalizado" : "Predeterminado"}
                                </Badge>
                              </div>
                              {role.description ? (
                                <p className="text-xs text-muted-foreground">{role.description}</p>
                              ) : null}
                              {labels.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {visible.map((label) => (
                                    <Badge key={label} variant="outline" className="text-[10px]">
                                      {label}
                                    </Badge>
                                  ))}
                                  {extra > 0 ? (
                                    <Badge variant="outline" className="text-[10px]">
                                      +{extra} permisos
                                    </Badge>
                                  ) : null}
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">Sin permisos asignados.</p>
                              )}
                            </div>
                            {role.isCustom && canManageRoles ? (
                              <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" onClick={() => openEditRoleDialog(role)}>
                                  Editar
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => deleteRole(role)}>
                                  Eliminar
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <Separator />

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder={`Buscar ${permissionsCatalog.length || 0} permisos`} 
                    className="pl-9 w-64"
                    data-testid="input-search-permissions"
                  />
                </div>

                <div className="space-y-8">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">Compartir</h3>
                      <Badge variant="secondary" className="text-xs">Enterprise</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Permitir que los miembros compartan un chat, canvas o un proyecto con...</span>
                      <Select defaultValue="members">
                        <SelectTrigger className="w-64" data-testid="select-share-permission">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="members">Solo miembros del espacio de trabajo</SelectItem>
                          <SelectItem value="anyone">Cualquier persona</SelectItem>
                          <SelectItem value="none">Nadie</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">Memoria</h3>
                      <Badge variant="secondary" className="text-xs">Enterprise</Badge>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Permitir a los miembros usar la memoria</span>
                        <span className="text-xs text-muted-foreground">
                          Administra si los miembros pueden activar la memoria. Esto permite que ILIAGPT se vuelva más útil recordando detalles y preferencias a través de los chats.{" "}
                          <button className="text-primary hover:underline">Obtener más información</button>
                        </span>
                      </div>
                      <Switch defaultChecked data-testid="switch-memory" />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Política de retención del chat</span>
                        <span className="text-xs text-muted-foreground">
                          Comunícate con el administrador de la cuenta para modificar esta configuración.
                        </span>
                      </div>
                      <span className="text-sm">Infinito</span>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">Canvas</h3>
                      <Badge variant="secondary" className="text-xs">Enterprise</Badge>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Ejecución del código del lienzo</span>
                        <span className="text-xs text-muted-foreground">
                          Permitir que los miembros ejecuten fragmentos de código dentro de Canvas.
                        </span>
                      </div>
                      <Switch defaultChecked data-testid="switch-canvas-code" />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Acceso a red del código en Canvas</span>
                        <span className="text-xs text-muted-foreground">
                          Permitir que los miembros ejecuten código con acceso a red dentro de Canvas.
                        </span>
                      </div>
                      <Switch defaultChecked data-testid="switch-canvas-network" />
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <h3 className="font-medium">ILIAGPT Record</h3>
                    <p className="text-xs text-muted-foreground">
                      Administra si los usuarios pueden usar ILIAGPT para grabar, transcribir y resumir audio de formato largo. Las grabaciones solo se usarán para fines de transcripción y no las almacenará.{" "}
                      <button className="text-primary hover:underline">Obtener más información</button>
                    </p>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm">Permitir que los miembros usen ILIAGPT Record</span>
                      <Switch defaultChecked data-testid="switch-record" />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Permitir que ILIAGPT consulte notas y transcripciones anteriores.</span>
                        <span className="text-xs text-muted-foreground">
                          Permitir que los miembros consulten notas y transcripciones anteriores en ILIAGPT Record.
                        </span>
                      </div>
                      <Switch defaultChecked data-testid="switch-record-notes" />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Permite que los miembros compartan su pantalla o video mientras usan el modo de voz.</span>
                        <span className="text-xs text-muted-foreground">
                          Permite que los miembros compartan su pantalla o video mientras usan el modo de voz.
                        </span>
                      </div>
                      <Switch defaultChecked data-testid="switch-screen-share" />
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">Código en macOS</h3>
                      <Badge variant="secondary" className="text-xs">Enterprise</Badge>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Permitir la edición de código en macOS</span>
                        <span className="text-xs text-muted-foreground">
                          Controla si los usuarios de este espacio de trabajo pueden permitir que ILIAGPT edite archivos de código al usar la aplicación de escritorio para macOS. Esto permite que ILIAGPT lea y edite el contenido de aplicaciones específicas en su escritorio para dar mejores respuestas.{" "}
                          <button className="text-primary hover:underline">Obtener más información</button>
                        </span>
                      </div>
                      <Switch data-testid="switch-macos-code" />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Permitir que los miembros vinculen Apple Intelligence</span>
                        <span className="text-xs text-muted-foreground">
                          Administra si los miembros pueden vincularse con Apple Intelligence.
                        </span>
                      </div>
                      <Switch defaultChecked data-testid="switch-apple-intelligence" />
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div>
                      <h3 className="font-medium">Modelos</h3>
                      <p className="text-xs text-muted-foreground">Administra el acceso de los miembros a los modelos</p>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Habilitar modelos adicionales</span>
                        <span className="text-xs text-muted-foreground">
                          Permite que los miembros usen modelos adicionales.
                        </span>
                      </div>
                      <Switch defaultChecked data-testid="switch-additional-models" />
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        );

	      case "billing":
	        const cycleStartLabel = creditsUsage?.cycleStart ? formatCycleShort(creditsUsage.cycleStart) : "—";
	        const cycleEndLabel = creditsUsage?.cycleEnd ? formatCycleShort(creditsUsage.cycleEnd) : "—";
	        const cycleLine = `${creditsOffset === 0 ? "Ciclo actual" : "Ciclo"}: ${cycleStartLabel} - ${cycleEndLabel}`;
	        const creditsUsed = creditsUsage?.totalTokens ?? 0;
	        const creditsLimit = creditsUsage?.limitTokens ?? null;
        const creditsPercent =
          typeof creditsUsage?.percentUsed === "number"
            ? Math.round(creditsUsage.percentUsed)
            : creditsLimit && creditsLimit > 0
              ? Math.round((creditsUsed / creditsLimit) * 100)
              : null;
	        const cycleEndMs = creditsUsage?.cycleEnd ? new Date(creditsUsage.cycleEnd).getTime() : null;
	        const daysToCycleEnd =
	          creditsOffset === 0 && cycleEndMs ? Math.max(0, Math.ceil((cycleEndMs - Date.now()) / (24 * 60 * 60 * 1000))) : null;
	        const effectivePlanRaw = creditsUsage?.plan || (user as any)?.subscriptionPlan || user?.plan || "free";
	        const effectivePlanKey = String(effectivePlanRaw || "free").toLowerCase().trim();
	        const PLAN_PRICES_USD: Record<string, number | null> = {
	          free: 0,
	          go: 5,
	          plus: 10,
	          pro: 200,
	          business: 25,
	          enterprise: null,
	          admin: null,
	        };
	        const priceUsd = PLAN_PRICES_USD[effectivePlanKey] ?? null;
	        return (
	          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-semibold">Facturación</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {creditsLoading ? "Cargando ciclo..." : cycleLine}
              </p>
            </div>

            {!canManageBilling && (
              <div className="rounded-lg border bg-muted/30 p-4 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Permisos insuficientes</p>
                  <p className="text-sm text-muted-foreground">
                    Solo propietarios o administradores de facturación pueden cambiar el plan, administrar facturación o configurar alertas.
                  </p>
                </div>
              </div>
            )}

            <Tabs
              value={billingTab}
              onValueChange={(value) => setBillingTab(value as "plan" | "invoices")}
              className="w-full"
            >
              <TabsList className="bg-transparent border-b rounded-none w-full justify-start h-auto p-0">
                <TabsTrigger 
                  value="plan" 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                  data-testid="tab-billing-plan"
                >
                  Plan
                </TabsTrigger>
                <TabsTrigger 
                  value="invoices" 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                  data-testid="tab-billing-invoices"
                >
                  Facturas
                </TabsTrigger>
              </TabsList>

              <TabsContent value="plan" className="mt-6 space-y-6">
                <div className="border rounded-lg p-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-lg">Plan {planLabel(creditsUsage?.plan || (user as any)?.subscriptionPlan || user?.plan)}</span>
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Mensualmente</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {billingStatus?.willDeactivate
                          ? `Se desactivará${deactivationDateLabel ? ` el ${deactivationDateLabel}` : ""}`
                          : billingStatus?.subscriptionStatus === "active"
                            ? `Activo${deactivationDateLabel ? ` · Renueva el ${deactivationDateLabel}` : ""}`
                            : "Sin suscripción activa"}
                        {typeof billingStatus?.monthsPaid === "number" && billingStatus.monthsPaid > 0
                          ? ` · ${billingStatus.monthsPaid} mes${billingStatus.monthsPaid === 1 ? "" : "es"} pagando`
                          : ""}
                      </p>
	                  </div>
	                    {canManageBilling ? (
	                      <Select
	                        key={planSelectKey}
	                        onValueChange={(value) => {
	                          // Re-mount to restore placeholder state
	                          setPlanSelectKey((k) => k + 1);
	                          if (value === "change") {
	                            setUpgradeOpen(true);
	                            return;
	                          }
	                          if (value === "cancel" || value === "reactivate") {
	                            void openStripePortal();
	                          }
	                        }}
	                      >
	                        <SelectTrigger className="w-auto gap-2" data-testid="select-manage-plan">
	                          <SelectValue placeholder="Administrar plan" />
	                        </SelectTrigger>
	                        <SelectContent>
	                          <SelectItem value="change">Cambiar plan</SelectItem>
	                          <SelectItem value="cancel">Cancelar plan</SelectItem>
	                          <SelectItem value="reactivate">Reactivar plan</SelectItem>
	                        </SelectContent>
	                      </Select>
	                    ) : (
	                      <Button variant="outline" disabled data-testid="button-manage-plan-disabled">
	                        Administrar plan
	                      </Button>
	                    )}
	                  </div>
                  
	                  <div className="pt-2">
	                    <div className="flex items-baseline">
	                      {priceUsd === null ? (
	                        <>
	                          <span className="text-4xl font-bold">—</span>
	                          <span className="text-muted-foreground ml-2">Precio personalizado</span>
	                        </>
	                      ) : (
	                        <>
	                          <span className="text-4xl font-bold">${priceUsd}</span>
	                          <span className="text-muted-foreground ml-1">/participante</span>
	                        </>
	                      )}
	                    </div>
	                  </div>
	                  
	                  <p className="text-sm text-muted-foreground">
	                    {typeof memberCount === "number"
	                      ? `${memberCount} participante${memberCount === 1 ? "" : "s"} en uso`
	                      : "Participantes en uso: —"}
	                  </p>
	                </div>

                <div className="border rounded-lg p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">Uso de créditos</h3>
                      <p className="text-sm text-muted-foreground">
                        {creditsLoading
                          ? "Cargando..."
                          : creditsOffset === 0
                            ? (daysToCycleEnd !== null ? `Próximo ciclo en ${daysToCycleEnd} día${daysToCycleEnd === 1 ? "" : "s"}` : "Próximo ciclo pronto")
                            : "Ciclo anterior"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-credits-menu">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
	                        </DropdownMenuTrigger>
	                        <DropdownMenuContent align="end">
	                          {canManageBilling ? (
	                            <>
	                              <DropdownMenuItem onSelect={() => setAlertsOpen(true)}>Configurar alertas</DropdownMenuItem>
	                              <DropdownMenuItem onSelect={() => setUpgradeOpen(true)}>Cambiar plan</DropdownMenuItem>
	                              <DropdownMenuItem onSelect={() => void openStripePortal()}>Administrar facturación</DropdownMenuItem>
	                            </>
	                          ) : (
	                            <DropdownMenuItem disabled>Sin permisos</DropdownMenuItem>
	                          )}
	                          {isAdmin && <DropdownMenuItem onSelect={() => setLocation("/admin")}>Abrir panel admin</DropdownMenuItem>}
	                        </DropdownMenuContent>
	                      </DropdownMenu>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        data-testid="button-credits-prev"
                        disabled={creditsLoading || creditsOffset <= -24}
                        onClick={() => setCreditsOffset((o) => Math.max(-24, o - 1))}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        data-testid="button-credits-next"
                        disabled={creditsLoading || creditsOffset >= 0}
                        onClick={() => setCreditsOffset((o) => Math.min(0, o + 1))}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  
                  <p className="text-sm">
                    <span className="font-semibold">{creditsUsed.toLocaleString()}</span>
                    {creditsLimit ? (
                      <span className="text-muted-foreground">
                        {" "}
                        / {creditsLimit.toLocaleString()} créditos usados{creditsPercent !== null ? ` (${creditsPercent}%)` : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground"> créditos usados</span>
                    )}
                  </p>

                  {(creditsUsage?.extraCredits ?? 0) > 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Créditos extra disponibles: <span className="font-semibold">{(creditsUsage?.extraCredits ?? 0).toLocaleString()}</span>
                      {creditsUsage?.extraCreditsNextExpiry ? ` · Vencen a partir del ${formatInvoiceDate(creditsUsage.extraCreditsNextExpiry)}` : ""}
                    </p>
                  ) : null}
                </div>

	                <div className="border rounded-lg p-6">
	                  <div className="flex items-center justify-between">
	                    <div className="space-y-1">
	                      <h3 className="font-semibold">Agregar más créditos</h3>
                      <p className="text-sm text-muted-foreground max-w-md">
                        Permite que tu equipo siga teniendo acceso incluso después de alcanzar los límites de su plan. Los créditos son válidos durante 12 meses.
	                      </p>
	                    </div>
	                    <Button
	                      variant="outline"
	                      data-testid="button-add-credits"
	                      onClick={() => {
	                        if (!canManageBilling) return;
	                        setAddCreditsOpen(true);
	                      }}
	                      disabled={!canManageBilling}
	                    >
	                      Agregar créditos
	                    </Button>
	                  </div>
	                </div>

                <Separator />

	                <div className="border rounded-lg p-6">
	                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <h3 className="font-semibold">Alertas de uso de créditos</h3>
                      <p className="text-sm text-muted-foreground">
                        Enviar alertas a los propietarios cuando estén por agotarse los créditos
	                      </p>
	                    </div>
	                    <Button
	                      variant="outline"
	                      data-testid="button-manage-alerts"
	                      onClick={() => {
	                        if (!canManageBilling) return;
	                        setAlertsOpen(true);
	                      }}
	                      disabled={!canManageBilling}
	                    >
	                      Administrar
	                    </Button>
	                  </div>
	                </div>
              </TabsContent>

              <TabsContent value="invoices" className="mt-6 space-y-4">
                {!canManageBilling ? (
                  <div className="border rounded-lg p-6">
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Solo propietarios o administradores de facturación pueden ver y descargar facturas.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div className="space-y-1">
                        <h3 className="font-semibold">Facturas</h3>
                        <p className="text-sm text-muted-foreground">Historial de facturación del espacio de trabajo.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void loadInvoices({ reset: true })}
                          disabled={invoicesLoading}
                          data-testid="button-refresh-invoices"
                        >
                          {invoicesLoading ? "Cargando..." : "Actualizar"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void openStripePortal()}
                          data-testid="button-open-billing-portal"
                        >
                          Ver en portal
                        </Button>
                      </div>
                    </div>

                    <div className="border rounded-lg overflow-hidden">
                      {invoicesLoading && invoices.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-10">Cargando facturas...</p>
                      ) : invoicesError ? (
                        <div className="p-6 space-y-3">
                          <p className="text-sm text-muted-foreground">{invoicesError}</p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void loadInvoices({ reset: true })}
                            disabled={invoicesLoading}
                            data-testid="button-retry-invoices"
                          >
                            Reintentar
                          </Button>
                        </div>
                      ) : invoices.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-10">No hay facturas disponibles.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                              <tr className="text-left text-muted-foreground">
                                <th className="px-4 py-3 font-medium">Fecha</th>
                                <th className="px-4 py-3 font-medium">Estado</th>
                                <th className="px-4 py-3 font-medium">Total</th>
                                <th className="px-4 py-3 font-medium">Periodo</th>
                                <th className="px-4 py-3 font-medium text-right">Acciones</th>
                              </tr>
                            </thead>
                            <tbody>
                              {invoices.map((inv) => {
                                const status = invoiceStatusInfo(inv.status);
                                const period =
                                  inv.periodStart && inv.periodEnd
                                    ? `${formatCycleShort(inv.periodStart)} - ${formatCycleShort(inv.periodEnd)}`
                                    : "—";
                                const total = typeof inv.total === "number" ? inv.total : inv.amountDue;
                                return (
                                  <tr key={inv.id} className="border-t">
                                    <td className="px-4 py-3">
                                      <div className="space-y-0.5">
                                        <div className="font-medium">{formatInvoiceDate(inv.createdAt)}</div>
                                        <div className="text-xs text-muted-foreground">{inv.number ? `#${inv.number}` : inv.id}</div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <Badge className={status.className}>{status.label}</Badge>
                                    </td>
                                    <td className="px-4 py-3 tabular-nums">{formatMoney(total, inv.currency)}</td>
                                    <td className="px-4 py-3 text-muted-foreground">{period}</td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center justify-end gap-2">
                                        {inv.hostedInvoiceUrl ? (
                                          <Button variant="outline" size="sm" asChild data-testid={`button-invoice-view-${inv.id}`}>
                                            <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                                              Ver
                                            </a>
                                          </Button>
                                        ) : (
                                          <Button variant="outline" size="sm" disabled>
                                            Ver
                                          </Button>
                                        )}
                                        {inv.invoicePdf ? (
                                          <Button variant="outline" size="sm" asChild data-testid={`button-invoice-pdf-${inv.id}`}>
                                            <a href={inv.invoicePdf} target="_blank" rel="noreferrer">
                                              PDF
                                            </a>
                                          </Button>
                                        ) : (
                                          <Button variant="outline" size="sm" disabled>
                                            PDF
                                          </Button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {invoicesHasMore && (
                      <div className="flex justify-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void loadInvoices()}
                          disabled={invoicesLoading || !invoicesCursor}
                          data-testid="button-load-more-invoices"
                        >
                          {invoicesLoading ? "Cargando..." : "Cargar más"}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </TabsContent>
            </Tabs>
          </div>
        );

      case "gpt":
        const gptItems = [
          { id: 1, name: "1.3 Discusiones de tesis. 2", constructor: "Jorge Carrera", actions: "—", access: "Enlace", chats: 508, created: "Jan 21", updated: "Dec 18", icon: "T20" },
          { id: 2, name: "REALIDAD PROBLEMATICA LOCAL", constructor: "Jorge Carrera", actions: "—", access: "Enlace", chats: 400, created: "Jan 21", updated: "Dec 18", icon: "T20" },
          { id: 3, name: "ANTECENTE DE TESIS", constructor: "Jorge Carrera", actions: "—", access: "Enlace", chats: 5779, created: "Jan 21", updated: "Dec 17", icon: "T20" },
          { id: 4, name: "REALIDAD PROBLEMATICA GLOBAL", constructor: "Jorge Carrera", actions: "—", access: "Enlace", chats: 669, created: "Jan 21", updated: "Dec 17", icon: "T20" },
          { id: 5, name: "BASES TEORICAS", constructor: "Jorge Carrera", actions: "—", access: "Enlace", chats: 821, created: "Jan 21", updated: "Dec 17", icon: "T20" },
          { id: 6, name: "TSP CAPÍTULO III. - Problema actual.", constructor: "Jorge Carrera", actions: "—", access: "Enlace", chats: 73, created: "Feb 5", updated: "Dec 17", icon: "doc" },
          { id: 7, name: "1.6. - Justificación", constructor: "Sin asignar", actions: "—", access: "Público", chats: 845, created: "Feb 20", updated: "Dec 17", icon: "doc" },
        ];
        return (
          <div className="space-y-8">
            <h1 className="text-2xl font-semibold">GPT</h1>

            <div className="space-y-4">
              <h2 className="font-medium">Terceros</h2>
              <p className="text-sm text-muted-foreground">
                Administra si los miembros pueden usar GPT creados fuera de tu espacio de trabajo.
              </p>
              <Select defaultValue="allow">
                <SelectTrigger className="w-40" data-testid="select-third-party">
                  <SelectValue placeholder="Permitir todo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">Permitir todo</SelectItem>
                  <SelectItem value="restrict">Restringir</SelectItem>
                  <SelectItem value="block">Bloquear</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4">
              <h2 className="font-medium">GPT</h2>
              
              <Tabs defaultValue="workspace" className="w-full">
                <div className="flex items-center justify-between">
                  <TabsList className="bg-transparent border-b rounded-none h-auto p-0">
                    <TabsTrigger 
                      value="workspace" 
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                      data-testid="tab-gpt-workspace"
                    >
                      Espacio de trabajo
                    </TabsTrigger>
                    <TabsTrigger 
                      value="unassigned" 
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                      data-testid="tab-gpt-unassigned"
                    >
                      Sin asignar
                    </TabsTrigger>
                  </TabsList>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-gpt-filter">
                      <Filter className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-gpt-search">
                      <Search className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <TabsContent value="workspace" className="mt-4">
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr className="text-left text-muted-foreground">
                          <th className="px-4 py-3 font-medium">Nombre</th>
                          <th className="px-4 py-3 font-medium">Constructor</th>
                          <th className="px-4 py-3 font-medium">Acciones personalizadas</th>
                          <th className="px-4 py-3 font-medium">Quién tiene acceso</th>
                          <th className="px-4 py-3 font-medium">Chats</th>
                          <th className="px-4 py-3 font-medium">Creado</th>
                          <th className="px-4 py-3 font-medium">Actualiz.</th>
                          <th className="px-4 py-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {gptItems.map((item) => (
                          <tr key={item.id} className="border-t hover:bg-muted/30">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className={cn(
                                  "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold",
                                  item.icon === "T20" ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-600"
                                )}>
                                  {item.icon === "T20" ? "T20" : "📄"}
                                </div>
                                <span className="font-medium text-primary hover:underline cursor-pointer">{item.name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{item.constructor}</td>
                            <td className="px-4 py-3 text-muted-foreground">{item.actions}</td>
                            <td className="px-4 py-3 text-muted-foreground">{item.access}</td>
                            <td className="px-4 py-3 text-muted-foreground">{item.chats}</td>
                            <td className="px-4 py-3 text-muted-foreground">{item.created}</td>
                            <td className="px-4 py-3 text-muted-foreground">{item.updated}</td>
                            <td className="px-4 py-3">
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-center gap-4 mt-4">
                    <Button variant="ghost" size="sm" data-testid="button-gpt-prev">Anterior</Button>
                    <span className="text-sm text-muted-foreground">Página 1</span>
                    <Button variant="ghost" size="sm" className="font-medium" data-testid="button-gpt-next">Siguiente</Button>
                  </div>
                </TabsContent>

                <TabsContent value="unassigned" className="mt-4">
                  <div className="border rounded-lg p-6">
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No hay GPTs sin asignar
                    </p>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h2 className="font-medium">Compartir</h2>
                <Badge variant="secondary" className="text-xs">Enterprise</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Los GPT se pueden compartir con...</span>
                <Select defaultValue="anyone">
                  <SelectTrigger className="w-48" data-testid="select-gpt-share">
                    <SelectValue placeholder="Cualquier persona" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anyone">Cualquier persona</SelectItem>
                    <SelectItem value="workspace">Solo espacio de trabajo</SelectItem>
                    <SelectItem value="restricted">Restringido</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <h2 className="font-medium">Acciones de GPT</h2>
              <p className="text-sm text-muted-foreground">
                Las acciones de GPT permiten que los GPT utilicen API de terceros para tareas como recuperar o modificar datos. Las acciones de GPT son definidas por los constructores de los GPT, por lo que puedes limitar los dominios que se pueden usar para los GPT creados en tu espacio de trabajo.
              </p>
              <div className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="allow-domains" 
                  defaultChecked 
                  className="h-4 w-4 rounded border-gray-300"
                  data-testid="checkbox-allow-domains"
                />
                <label htmlFor="allow-domains" className="text-sm">
                  Permitir todos los dominios para acciones de GPT
                </label>
                <Info className="h-3 w-3 text-muted-foreground" />
              </div>
            </div>
          </div>
        );

      case "apps":
        const appItems = [
          { id: 1, name: "Adobe Acrobat", description: "Trusted PDF editing tools", icon: "Ac", bgColor: "bg-red-600" },
          { id: 2, name: "Adobe Express", description: "Design flyers and invites", icon: "Ae", bgColor: "bg-gradient-to-br from-purple-500 to-pink-500" },
          { id: 3, name: "Adobe Photoshop", description: "Edit, stylize, refine images", icon: "Ps", bgColor: "bg-blue-600" },
          { id: 4, name: "Agentforce Sales", description: "Sales insights to close deals", icon: "⚡", bgColor: "bg-blue-500" },
          { id: 5, name: "Aha!", description: "Connect to sync Aha! product roadmaps and features for use in ChatGPT.", icon: "!", bgColor: "bg-blue-600" },
          { id: 6, name: "Airtable", description: "Add structured data to ChatGPT", icon: "📊", bgColor: "bg-blue-400" },
          { id: 7, name: "Alpaca", description: "Market data: stocks & crypto", icon: "🦙", bgColor: "bg-yellow-400" },
          { id: 8, name: "Apple Music", description: "Build playlists and find music", icon: "♪", bgColor: "bg-pink-500" },
          { id: 9, name: "Asana", description: "Convierte las tareas de Asana en actualizaciones y planes claros", icon: "◉", bgColor: "bg-orange-500" },
          { id: 10, name: "Atlassian Rovo", description: "Manage Jira and Confluence fast", icon: "A", bgColor: "bg-blue-600" },
          { id: 11, name: "Azure Boards", description: "Connect to sync Azure DevOps work items and repos for use in ChatGPT.", icon: "Az", bgColor: "bg-blue-500" },
          { id: 12, name: "Basecamp", description: "Connect to sync Basecamp projects and to-dos for use in ChatGPT.", icon: "⛺", bgColor: "bg-green-600" },
          { id: 13, name: "BioRender", description: "Science visuals on demand", icon: "🧬", bgColor: "bg-teal-500" },
          { id: 14, name: "Booking.com", description: "Search stays worldwide", icon: "B", bgColor: "bg-blue-700" },
          { id: 15, name: "Box", description: "Busca y consulta tus documentos", icon: "📦", bgColor: "bg-blue-500" },
          { id: 16, name: "Calendario de Outlook", description: "Consulta eventos y disponibilidad.", icon: "📅", bgColor: "bg-blue-600" },
          { id: 17, name: "Canva", description: "Search, create, edit designs", icon: "C", bgColor: "bg-cyan-500" },
          { id: 18, name: "Clay", description: "Find and engage prospects", icon: "🏺", bgColor: "bg-orange-400" },
          { id: 19, name: "ClickUp", description: "Connect to sync ClickUp tasks and docs for use in ChatGPT.", icon: "✓", bgColor: "bg-purple-600" },
          { id: 20, name: "Cloudinary", description: "Manage, modify, and host your images & videos", icon: "☁", bgColor: "bg-blue-500" },
          { id: 21, name: "Conductor", description: "Track brand sentiment in AI", icon: "C", bgColor: "bg-indigo-600" },
          { id: 22, name: "Contactos de Google", description: "Consulta detalles de contacto guardados.", icon: "👤", bgColor: "bg-blue-500" },
          { id: 23, name: "Correo electrónico de Outlook", description: "Busca y consulta tus correos electrónicos de Outlook.", icon: "✉", bgColor: "bg-blue-600" },
          { id: 24, name: "Coupler.io", description: "Unified business data access", icon: "⚡", bgColor: "bg-purple-500" },
          { id: 25, name: "Coursera", description: "Skill-building course videos", icon: "C", bgColor: "bg-blue-600" },
          { id: 26, name: "Coveo", description: "Search your enterprise content", icon: "C", bgColor: "bg-orange-500" },
          { id: 27, name: "Daloopa", description: "Financial KPIs with links", icon: "D", bgColor: "bg-blue-700" },
          { id: 28, name: "Dropbox", description: "Encuentra y accede a tus archivos almacenados.", icon: "📁", bgColor: "bg-blue-500" },
          { id: 29, name: "Egnyte", description: "Explore and analyze your content", icon: "E", bgColor: "bg-green-600" },
          { id: 30, name: "Figma", description: "Make diagrams, slides, assets", icon: "F", bgColor: "bg-purple-600" },
          { id: 31, name: "Fireflies", description: "Search meeting transcripts", icon: "🔥", bgColor: "bg-purple-500" },
          { id: 32, name: "GitHub", description: "Accede a repositorios, problemas y solicitudes de extracción.", icon: "🐙", bgColor: "bg-gray-800" },
          { id: 33, name: "GitLab Issues", description: "Connect to sync GitLab Issues and merge requests for use in ChatGPT.", icon: "🦊", bgColor: "bg-orange-600" },
          { id: 34, name: "Gmail", description: "Busca y consulta correos electrónicos en tu bandeja de entrada.", icon: "✉", bgColor: "bg-red-500" },
          { id: 35, name: "Google Drive", description: "Upload Google Drive files in messages sent to ChatGPT.", icon: "📁", bgColor: "bg-yellow-500", badge: "CARGAS DE ARCHIVOS" },
          { id: 36, name: "Google Calendar", description: "Consulta eventos y disponibilidad.", icon: "📅", bgColor: "bg-blue-500" },
          { id: 37, name: "Google Drive", description: "Busca y consulta archivos de tu Drive.", icon: "📁", bgColor: "bg-green-500", hasSync: true },
          { id: 38, name: "Help Scout", description: "Connect to sync Help Scout mailboxes and conversations for use in ChatGPT.", icon: "H", bgColor: "bg-blue-500" },
          { id: 39, name: "Hex", description: "Ask questions, run analyses", icon: "⬡", bgColor: "bg-purple-600" },
          { id: 40, name: "HighLevel", description: "Interact with your CRM business data", icon: "H", bgColor: "bg-blue-600" },
          { id: 41, name: "HubSpot", description: "Analiza datos de CRM y destaca insights", icon: "H", bgColor: "bg-orange-500" },
          { id: 42, name: "Hugging Face", description: "Inspect models, datasets, Spaces, and research", icon: "🤗", bgColor: "bg-yellow-400" },
          { id: 43, name: "Intercom", description: "Look up past user chats and tickets.", icon: "💬", bgColor: "bg-blue-500" },
          { id: 44, name: "Jam", description: "Screen record with context", icon: "🍇", bgColor: "bg-purple-600" },
          { id: 45, name: "Jotform", description: "Build forms, analyze responses", icon: "J", bgColor: "bg-orange-500" },
          { id: 46, name: "Klaviyo", description: "Marketing performance insights", icon: "K", bgColor: "bg-green-600" },
          { id: 47, name: "LSEG", description: "LSEG financial data access", icon: "L", bgColor: "bg-blue-700" },
          { id: 48, name: "Linear", description: "Busca y consulta incidencias y proyectos.", icon: "◇", bgColor: "bg-indigo-600" },
          { id: 49, name: "Lovable", description: "Build apps and websites", icon: "♥", bgColor: "bg-pink-500" },
          { id: 50, name: "Microsoft OneDrive (personal)", description: "Upload personal OneDrive files in messages sent to ChatGPT.", icon: "☁", bgColor: "bg-blue-500", badge: "CARGAS DE ARCHIVOS" },
          { id: 51, name: "Microsoft OneDrive (work/school)", description: "Upload SharePoint and OneDrive for Business files in messages sent to ChatGPT.", icon: "☁", bgColor: "bg-blue-600", badge: "CARGAS DE ARCHIVOS" },
          { id: 52, name: "Monday.com", description: "Manage work in monday.com", icon: "M", bgColor: "bg-red-500" },
          { id: 53, name: "Netlify", description: "Build and deploy on Netlify", icon: "N", bgColor: "bg-teal-500" },
          { id: 54, name: "Notion", description: "Busca y consulta tus páginas de Notion.", icon: "N", bgColor: "bg-gray-800" },
          { id: 55, name: "OpenTable", description: "Find restaurant reservations", icon: "🍽", bgColor: "bg-red-600" },
          { id: 56, name: "Pipedrive", description: "Connect to sync Pipedrive deals and contacts for use in ChatGPT.", icon: "P", bgColor: "bg-green-500" },
          { id: 57, name: "PitchBook", description: "Faster workflows with market intelligence", icon: "P", bgColor: "bg-blue-700" },
          { id: 58, name: "Replit", description: "Build web apps with AI", icon: "R", bgColor: "bg-orange-500" },
          { id: 59, name: "Semrush", description: "Site metrics and traffic data", icon: "S", bgColor: "bg-orange-600" },
          { id: 60, name: "SharePoint", description: "Busca y extrae datos de sitios compartidos y OneDrive.", icon: "S", bgColor: "bg-teal-600" },
          { id: 61, name: "Slack", description: "Consulta chats y mensajes.", icon: "S", bgColor: "bg-purple-600" },
          { id: 62, name: "Spaceship", description: "Search domain availability", icon: "🚀", bgColor: "bg-indigo-600" },
          { id: 63, name: "Stripe", description: "Payments and business tools", icon: "S", bgColor: "bg-purple-500" },
          { id: 64, name: "Teams", description: "Consulta chats y mensajes.", icon: "T", bgColor: "bg-purple-700" },
          { id: 65, name: "Teamwork.com", description: "Connect to sync Teamwork projects and tasks for use in ChatGPT.", icon: "T", bgColor: "bg-purple-500" },
          { id: 66, name: "Tripadvisor", description: "Book top-rated hotels", icon: "🦉", bgColor: "bg-green-500" },
          { id: 67, name: "Vercel", description: "Search docs and deploy apps", icon: "▲", bgColor: "bg-gray-800" },
          { id: 68, name: "Zoho", description: "Connect to sync Zoho CRM records and activities for use in ChatGPT.", icon: "Z", bgColor: "bg-red-600" },
          { id: 69, name: "Zoho Desk", description: "Connect to sync Zoho Desk tickets and customer conversations for use in ChatGPT.", icon: "Z", bgColor: "bg-green-600" },
          { id: 70, name: "Zoom", description: "Smart meeting insights from Zoom", icon: "Z", bgColor: "bg-blue-500" },
        ];
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-semibold">Aplicaciones</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Administra a qué aplicaciones pueden conectarse los usuarios de este espacio de trabajo.{" "}
                <button className="text-primary hover:underline">Obtener más información</button>
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Buscar" 
                  className="pl-9"
                  data-testid="input-apps-search"
                />
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="gap-2" data-testid="button-apps-filters">
                    <Filter className="h-4 w-4" />
                    Filtros
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0" align="end">
                  <div className="p-4 space-y-4">
                    <Collapsible defaultOpen>
                      <CollapsibleTrigger className="flex items-center justify-between w-full">
                        <span className="font-medium">Categorías</span>
                        <ChevronDown className="h-4 w-4 transition-transform duration-200 [&[data-state=open]]:rotate-180" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-3 space-y-2">
                        {["Diseño", "Empresa", "Herramientas del desarrollador", "Productividad", "Colaboración", "Finanzas"].map((cat) => (
                          <label key={cat} className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" className="h-4 w-4 rounded border-gray-300" />
                            <span className="text-sm">{cat}</span>
                          </label>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>

                    <Collapsible defaultOpen>
                      <CollapsibleTrigger className="flex items-center justify-between w-full">
                        <span className="font-medium">Funcionalidades</span>
                        <ChevronDown className="h-4 w-4 transition-transform duration-200 [&[data-state=open]]:rotate-180" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-3 space-y-2">
                        {["Búsqueda de archivos", "Cargas de archivos", "Sincronización", "Capacidad de escritura", "Interactiva"].map((func) => (
                          <label key={func} className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" className="h-4 w-4 rounded border-gray-300" />
                            <span className="text-sm">{func}</span>
                          </label>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>

                    <div className="pt-2 border-t">
                      <button className="text-sm text-muted-foreground hover:text-foreground w-full text-right">
                        Borrar todo
                      </button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <Button className="gap-2" data-testid="button-apps-create">
                <Plus className="h-4 w-4" />
                Crear
              </Button>
            </div>

            <Tabs defaultValue="enabled" className="w-full">
              <div className="flex items-center justify-between">
                <TabsList className="bg-transparent border-b rounded-none h-auto p-0">
                  <TabsTrigger 
                    value="enabled" 
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                    data-testid="tab-apps-enabled"
                  >
                    Enabled (70)
                  </TabsTrigger>
                  <TabsTrigger 
                    value="directory" 
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                    data-testid="tab-apps-directory"
                  >
                    Directorio
                  </TabsTrigger>
                  <TabsTrigger 
                    value="drafts" 
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                    data-testid="tab-apps-drafts"
                  >
                    Drafts (0)
                  </TabsTrigger>
                </TabsList>
                <button className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1" data-testid="button-explore-directory">
                  Explorar directorio
                  <span className="text-xs">↗</span>
                </button>
              </div>

              <TabsContent value="enabled" className="mt-4">
                <div className="border rounded-lg overflow-hidden">
                  <div className="flex items-center px-4 py-3 bg-muted/50 border-b">
                    <input type="checkbox" className="h-4 w-4 rounded border-gray-300 mr-4" data-testid="checkbox-apps-all" />
                    <button className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
                      Nombre
                      <ChevronDown className="h-3 w-3 rotate-180" />
                    </button>
                  </div>
                  <div className="divide-y">
                    {appItems.map((app: any) => (
                      <div key={app.id} className="flex items-center px-4 py-3 hover:bg-muted/30">
                        <input type="checkbox" className="h-4 w-4 rounded border-gray-300 mr-4" data-testid={`checkbox-app-${app.id}`} />
                        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold mr-4", app.bgColor)}>
                          {app.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{app.name}</p>
                            {app.badge && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{app.badge}</Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground truncate">{app.description}</p>
                          {app.hasSync && (
                            <button className="text-xs text-primary hover:underline mt-1">Habilitar sincronización</button>
                          )}
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="directory" className="mt-4">
                <div className="border rounded-lg p-6">
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Explora el directorio de aplicaciones disponibles
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="drafts" className="mt-4">
                <div className="border rounded-lg p-6">
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No hay borradores de aplicaciones
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        );

      case "groups":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-semibold">Grupos</h1>
              <p className="text-sm text-muted-foreground">
                Administra los grupos de tu espacio de trabajo.
              </p>
            </div>

            <WorkspaceGroupsSection canManage={canManageMembers} />
          </div>
        );

      case "analytics": {
        const totals = analyticsData?.totals;
        const activityData = analyticsData?.activityByDay ?? [];
        const members = analyticsMembers;
        const hasRawMembers = (analyticsData?.byMember ?? []).length > 0;
        const sessionsCount = analyticsData?.sessionsCount ?? 0;
        const topPages = analyticsData?.topPages ?? [];
        const topActions = analyticsData?.topActions ?? [];
        const periodLabel = analyticsData
          ? `${formatDateShort(analyticsData.startDate)} - ${formatDateShort(analyticsData.endDate)}`
          : `Últimos ${analyticsDays} días`;

        return (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-2xl font-semibold">Análisis de usuario</h1>
                <p className="text-sm text-muted-foreground">
                  Visualiza estadísticas y análisis de uso del equipo.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={String(analyticsDays)}
                  onValueChange={(value) => {
                    const nextDays = Number(value);
                    if (![7, 30, 90].includes(nextDays)) return;
                    setAnalyticsDays(nextDays as 7 | 30 | 90);
                    void trackWorkspaceEvent({
                      eventType: "action",
                      action: "analytics_period_change",
                      metadata: { days: nextDays },
                    });
                  }}
                >
                  <SelectTrigger className="w-36" data-testid="select-analytics-days">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Últimos 7 días</SelectItem>
                    <SelectItem value="30">Últimos 30 días</SelectItem>
                    <SelectItem value="90">Últimos 90 días</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  disabled={analyticsLoading}
                  onClick={() => {
                    void loadAnalytics();
                    void trackWorkspaceEvent({ eventType: "action", action: "analytics_refresh" });
                  }}
                  data-testid="button-analytics-refresh"
                >
                  {analyticsLoading ? "Actualizando..." : "Actualizar"}
                </Button>
              </div>
            </div>

            {!analyticsData?.canViewAll && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                Solo puedes ver tu propia actividad. Para ver al equipo completo, solicita acceso de administrador.
              </div>
            )}

            {analyticsError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {analyticsError}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Miembros totales</CardDescription>
                  <CardTitle className="text-2xl">{formatNumber(totals?.members)}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">{periodLabel}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Miembros activos</CardDescription>
                  <CardTitle className="text-2xl">{formatNumber(totals?.activeMembers)}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">{periodLabel}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Sesiones únicas</CardDescription>
                  <CardTitle className="text-2xl">{formatNumber(sessionsCount)}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">{periodLabel}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Chats creados</CardDescription>
                  <CardTitle className="text-2xl">{formatNumber(totals?.chatsCreated)}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">{periodLabel}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Mensajes de usuario</CardDescription>
                  <CardTitle className="text-2xl">{formatNumber(totals?.userMessages)}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">{periodLabel}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Tokens usados</CardDescription>
                  <CardTitle className="text-2xl">{formatNumber(totals?.tokensUsed)}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">{periodLabel}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Vistas de página</CardDescription>
                  <CardTitle className="text-2xl">{formatNumber(totals?.pageViews)}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">{periodLabel}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Acciones registradas</CardDescription>
                  <CardTitle className="text-2xl">{formatNumber(totals?.actions)}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">{periodLabel}</CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Actividad diaria</CardTitle>
                  <CardDescription>Selecciona una métrica para revisar la evolución.</CardDescription>
                </div>
                <Select
                  value={analyticsMetric}
                  onValueChange={(value) => {
                    setAnalyticsMetric(value as AnalyticsMetricKey);
                    void trackWorkspaceEvent({
                      eventType: "action",
                      action: "analytics_metric_change",
                      metadata: { metric: value },
                    });
                  }}
                >
                  <SelectTrigger className="w-52" data-testid="select-analytics-metric">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {analyticsMetricOptions.map((metric) => (
                      <SelectItem key={metric.value} value={metric.value}>
                        {metric.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                {analyticsLoading && !analyticsData ? (
                  <div className="space-y-3">
                    <Skeleton className="h-6 w-32" />
                    <Skeleton className="h-56 w-full" />
                  </div>
                ) : activityData.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-8 text-center">
                    No hay actividad registrada en este periodo.
                  </div>
                ) : (
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={activityData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(value) => formatDateShort(String(value))}
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                        />
                        <YAxis
                          tickFormatter={(value) => formatNumber(Number(value))}
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                        />
                        <Tooltip
                          formatter={(value) => [formatNumber(Number(value)), selectedMetric.label]}
                          labelFormatter={(label) => formatDateLong(String(label))}
                        />
                        <Line
                          type="monotone"
                          dataKey={selectedMetric.value}
                          stroke={selectedMetric.color}
                          strokeWidth={2.5}
                          dot={{ r: 2 }}
                          activeDot={{ r: 4 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Top páginas</CardTitle>
                  <CardDescription>Las rutas más visitadas en el periodo.</CardDescription>
                </CardHeader>
                <CardContent>
                  {analyticsLoading && !analyticsData ? (
                    <div className="space-y-3">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-4 w-52" />
                      <Skeleton className="h-4 w-44" />
                    </div>
                  ) : topPages.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Sin datos de páginas visitadas.</div>
                  ) : (
                    <div className="space-y-2">
                      {topPages.map((page) => (
                        <div key={page.page} className="flex items-center justify-between text-sm">
                          <span className="truncate max-w-[70%]">{page.page}</span>
                          <span className="text-muted-foreground">{formatNumber(page.count)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Top acciones</CardTitle>
                  <CardDescription>Acciones más comunes del equipo.</CardDescription>
                </CardHeader>
                <CardContent>
                  {analyticsLoading && !analyticsData ? (
                    <div className="space-y-3">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-4 w-52" />
                      <Skeleton className="h-4 w-44" />
                    </div>
                  ) : topActions.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Sin acciones registradas.</div>
                  ) : (
                    <div className="space-y-2">
                      {topActions.map((action) => (
                        <div key={action.action} className="flex items-center justify-between text-sm">
                          <span className="truncate max-w-[70%]">{action.action}</span>
                          <span className="text-muted-foreground">{formatNumber(action.count)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="space-y-3">
                <div>
                  <CardTitle>Miembros</CardTitle>
                  <CardDescription>Detalle de uso por miembro en el periodo seleccionado.</CardDescription>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar miembro"
                      className="pl-9 w-64"
                      value={analyticsMemberFilter}
                      onChange={(e) => setAnalyticsMemberFilter(e.target.value)}
                      onBlur={() => {
                        const trimmed = analyticsMemberFilter.trim();
                        if (!trimmed) return;
                        void trackWorkspaceEvent({
                          eventType: "action",
                          action: "analytics_member_filter",
                          metadata: { queryLength: trimmed.length },
                        });
                      }}
                      data-testid="input-analytics-member-filter"
                    />
                  </div>
                  <Select
                    value={analyticsMemberSort}
                    onValueChange={(value) => {
                      setAnalyticsMemberSort(value as "activity" | "messages" | "tokens" | "recent");
                      void trackWorkspaceEvent({
                        eventType: "action",
                        action: "analytics_member_sort",
                        metadata: { sort: value },
                      });
                    }}
                  >
                    <SelectTrigger className="w-48" data-testid="select-analytics-member-sort">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="activity">Ordenar por actividad</SelectItem>
                      <SelectItem value="messages">Ordenar por mensajes</SelectItem>
                      <SelectItem value="tokens">Ordenar por tokens</SelectItem>
                      <SelectItem value="recent">Ordenar por reciente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {analyticsLoading && !analyticsData ? (
                  <div className="space-y-3">
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="h-32 w-full" />
                  </div>
                ) : members.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">
                    {hasRawMembers
                      ? "No se encontraron miembros con ese filtro."
                      : "No hay miembros con actividad registrada."}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Miembro</TableHead>
                        <TableHead>Rol</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Chats</TableHead>
                        <TableHead>Mensajes</TableHead>
                        <TableHead>Tokens</TableHead>
                        <TableHead>Vistas</TableHead>
                        <TableHead>Acciones</TableHead>
                        <TableHead>Última actividad</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((member) => {
                        const isActive =
                          member.chatsCreated > 0 ||
                          member.userMessages > 0 ||
                          member.pageViews > 0 ||
                          member.actions > 0;
                        const displayName = member.displayName || "—";
                        const displayEmail = member.email || "—";
                        const lastActive = member.lastActiveAt || member.lastLoginAt;
                        return (
                          <TableRow key={member.userId}>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-medium text-sm">
                                  {displayName}
                                  {currentUserId && currentUserId === member.userId ? " (Tú)" : ""}
                                </span>
                                <span className="text-xs text-muted-foreground">{displayEmail}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                                {member.role || "member"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={isActive ? "success" : "outline"}>{isActive ? "Activo" : "Inactivo"}</Badge>
                            </TableCell>
                            <TableCell>{formatNumber(member.chatsCreated)}</TableCell>
                            <TableCell>{formatNumber(member.userMessages)}</TableCell>
                            <TableCell>{formatNumber(member.tokensUsed)}</TableCell>
                            <TableCell>{formatNumber(member.pageViews)}</TableCell>
                            <TableCell>{formatNumber(member.actions)}</TableCell>
                            <TableCell>{formatDateLong(lastActive)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        );
      }

      case "identity":
        return (
          <IdentityAccessSection isAdmin={isAdmin} />
        );

      default:
        return null;
    }
  };

  const CREDITS_PER_USD = 100_000;
  const topupAmountNumber = Number(creditsTopupAmountUsd);
  const topupAmountIsInt = Number.isFinite(topupAmountNumber) && Number.isInteger(topupAmountNumber);
  const topupAmountValid =
    topupAmountIsInt && topupAmountNumber >= 5 && topupAmountNumber <= 5000 && topupAmountNumber % 5 === 0;
  const topupCreditsPreview = topupAmountValid ? topupAmountNumber * CREDITS_PER_USD : null;

  let topupAmountError: string | null = null;
  if (addCreditsOpen) {
    if (!creditsTopupAmountUsd.trim()) topupAmountError = "Ingresa un monto.";
    else if (!Number.isFinite(topupAmountNumber)) topupAmountError = "Monto inválido.";
    else if (!topupAmountIsInt) topupAmountError = "Debe ser un número entero.";
    else if (topupAmountNumber < 5) topupAmountError = "El mínimo es $5.";
    else if (topupAmountNumber > 5000) topupAmountError = "El máximo es $5000.";
    else if (topupAmountNumber % 5 !== 0) topupAmountError = "Debe ser múltiplo de $5.";
  }

  return (
    <div className="min-h-screen bg-background">
      <UpgradePlanDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      <CreditAlertsDialog open={alertsOpen} onOpenChange={setAlertsOpen} />
      <Dialog
        open={addCreditsOpen}
        onOpenChange={(open) => {
          setAddCreditsOpen(open);
          if (open) {
            setCreditsTopupAmountUsd("5");
            setCreditsTopupSubmitting(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar créditos</DialogTitle>
            <DialogDescription>
              El mínimo es $5 y debe ser múltiplo de $5. Los créditos son válidos durante 12 meses.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="credits-amount">Monto (USD)</Label>
              <Input
                id="credits-amount"
                inputMode="numeric"
                type="number"
                min={5}
                step={5}
                max={5000}
                value={creditsTopupAmountUsd}
                disabled={creditsTopupSubmitting}
                onChange={(e) => setCreditsTopupAmountUsd(e.target.value)}
              />
              {topupAmountError ? <p className="text-xs text-destructive">{topupAmountError}</p> : null}
              {topupCreditsPreview !== null ? (
                <p className="text-xs text-muted-foreground">
                  Recibirás aproximadamente <span className="font-medium">{topupCreditsPreview.toLocaleString()}</span>{" "}
                  créditos.
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {[5, 10, 25, 50].map((amt) => (
                <Button
                  key={amt}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={creditsTopupSubmitting}
                  onClick={() => setCreditsTopupAmountUsd(String(amt))}
                >
                  ${amt}
                </Button>
              ))}
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setAddCreditsOpen(false)} disabled={creditsTopupSubmitting}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                if (!topupAmountValid) return;
                setCreditsTopupSubmitting(true);
                const ok = await startCreditsCheckout(topupAmountNumber);
                setCreditsTopupSubmitting(false);
                if (ok) setAddCreditsOpen(false);
              }}
              disabled={!topupAmountValid || creditsTopupSubmitting}
            >
              {creditsTopupSubmitting ? "Redirigiendo..." : "Continuar a pago"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Invitar miembros</DialogTitle>
            <DialogDescription>
              Agrega uno o varios correos separados por coma, espacio o salto de línea.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-emails">Correos</Label>
              <Textarea
                id="invite-emails"
                placeholder="ana@empresa.com, juan@empresa.com"
                value={inviteEmails}
                onChange={(e) => setInviteEmails(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Rol asignado</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((role) => (
                    <SelectItem key={role.roleKey} value={role.roleKey}>
                      {roleLabelEs(role.roleKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-message">Mensaje (opcional)</Label>
              <Textarea
                id="invite-message"
                placeholder="Añade un mensaje para tus colaboradores..."
                value={inviteMessage}
                onChange={(e) => setInviteMessage(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void inviteMember()} disabled={inviteSending || !inviteEmails.trim()}>
              {inviteSending ? "Enviando..." : "Enviar invitaciones"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{roleDialogMode === "edit" ? "Editar rol" : "Crear rol"}</DialogTitle>
            <DialogDescription>
              Define los permisos que tendrán los colaboradores con este rol.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role-name">Nombre del rol</Label>
              <Input
                id="role-name"
                placeholder="Ej: Analista, Editor, Operaciones"
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-description">Descripción</Label>
              <Textarea
                id="role-description"
                placeholder="Describe el alcance del rol (opcional)"
                value={roleDescription}
                onChange={(e) => setRoleDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Permisos</Label>
              <div className="border rounded-lg p-4 max-h-72 overflow-auto space-y-4">
                {permissionGroups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay permisos disponibles.</p>
                ) : (
                  permissionGroups.map(([category, perms]) => (
                    <div key={category} className="space-y-2">
                      <p className="text-sm font-medium">{category}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {perms.map((perm) => (
                          <label key={perm.id} className="flex items-start gap-2 text-sm">
                            <Checkbox
                              checked={rolePermissions.includes(perm.id)}
                              onCheckedChange={(checked) => toggleRolePermission(perm.id, checked === true)}
                            />
                            <span>{perm.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setRoleDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void saveRole()} disabled={roleSaving || !roleName.trim()}>
              {roleSaving ? "Guardando..." : "Guardar rol"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Self-serve workspace settings: no "contact admin" modal. */}
      {showDeactivationBanner && (
        <div className="flex justify-end px-6 py-3">
          <div className="inline-flex items-center gap-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <div className="text-sm">
              <span className="font-medium">Este espacio de trabajo se desactivará.</span>
              <span className="text-muted-foreground ml-1">
                Tendrás acceso al espacio de trabajo hasta que finalice el ciclo de facturación{deactivationDateLabel ? ` el ${deactivationDateLabel}.` : "."}
              </span>
            </div>
	              {canManageBilling ? (
	                <Button
	                  variant="outline"
	                  size="sm"
	                  className="ml-2 flex-shrink-0"
	                  data-testid="button-reactivate"
	                  onClick={() => void openStripePortal()}
	                >
	                  Reactivar
	                </Button>
	              ) : null}
          </div>
        </div>
      )}

      <div className="flex">
        <div className="w-64 border-r min-h-[calc(100vh-49px)] p-4">
          <button 
            onClick={() => setLocation("/")}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
            data-testid="button-back-to-chat"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver al chat
          </button>

          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <IliaGPTLogo size={24} />
            </div>
            <span className="text-sm font-medium truncate">Espacio de trabajo de Jor...</span>
          </div>

          <nav className="space-y-1">
            {menuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors",
                  activeSection === item.id 
                    ? "bg-muted font-medium" 
                    : "hover:bg-muted/50 text-muted-foreground"
                )}
                data-testid={`workspace-menu-${item.id}`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex-1 p-8 max-w-3xl">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
