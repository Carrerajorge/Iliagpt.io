import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  Plus,
  MoreHorizontal,
  CheckCircle,
  Activity,
  Download,
  Trash2,
  Edit,
  Loader2,
  Filter,
  Eye,
  AlertTriangle,
  Shield,
  ShieldAlert,
  Timer,
  UserCog,
  Ban,
  ShieldCheck,
  CreditCard,
  UserX,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/apiClient";
import { format } from "date-fns";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isEnabledFlag = (value: unknown) => value === true || value === "true";

const formatOptionalLimit = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString()
    : "Sin limite";

const parseLimitInput = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

/** Returns Tailwind classes for plan badge coloring. */
function planBadgeClasses(plan: string | null | undefined): string {
  switch ((plan || "free").toLowerCase()) {
    case "pro":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
    case "enterprise":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
    case "free":
    default:
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  }
}

/** Returns a colored status dot element based on user status. */
function StatusDot({ status }: { status: string | null | undefined }) {
  const s = (status || "active").toLowerCase();
  let color = "bg-gray-400"; // inactive / default
  if (s === "active") color = "bg-green-500";
  else if (s === "suspended" || s === "blocked") color = "bg-yellow-500";
  else if (s === "banned") color = "bg-red-500";
  return <span className={cn("inline-block h-2 w-2 rounded-full shrink-0", color)} />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function UsersManagement() {
  const queryClient = useQueryClient();

  // ----- Local state -----
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingUser, setEditingUser] = useState<any>(null);
  const [viewingUser, setViewingUser] = useState<any>(null);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ plan: "", status: "", role: "", authProvider: "" });
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" }>({
    key: "createdAt",
    direction: "desc",
  });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [newUser, setNewUser] = useState({ email: "", password: "", plan: "free", role: "user" });

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);

  // Daily limit prompt
  const [dailyLimitTarget, setDailyLimitTarget] = useState<any>(null);
  const [dailyLimitInputVal, setDailyLimitInputVal] = useState("");
  const [dailyLimitOutputVal, setDailyLimitOutputVal] = useState("");

  // ----- Debounced search -----
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Reset page on filter / sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filters.plan, filters.status, filters.role, filters.authProvider, sortConfig.key, sortConfig.direction]);

  // ----- Main users query -----
  const { data: usersResponse, isLoading, isFetching } = useQuery({
    queryKey: [
      "/api/admin/users",
      currentPage,
      itemsPerPage,
      searchQuery,
      filters.plan,
      filters.status,
      filters.role,
      filters.authProvider,
      sortConfig.key,
      sortConfig.direction,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(currentPage),
        limit: String(itemsPerPage),
        sortBy: sortConfig.key,
        sortOrder: sortConfig.direction,
      });
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (filters.plan) params.set("plan", filters.plan);
      if (filters.status) params.set("status", filters.status);
      if (filters.role) params.set("role", filters.role);
      if (filters.authProvider) params.set("authProvider", filters.authProvider);

      const res = await apiFetch(`/api/admin/users?${params.toString()}`, { credentials: "include" });
      if (!res.ok) {
        throw new Error("No se pudieron cargar los usuarios");
      }
      return res.json();
    },
    placeholderData: (previousData) => previousData,
  });

  const users = Array.isArray(usersResponse?.users) ? usersResponse.users : [];
  const pagination = usersResponse?.pagination || {
    page: currentPage,
    limit: itemsPerPage,
    total: users.length,
    totalPages: users.length > 0 ? 1 : 0,
    hasNext: false,
    hasPrev: currentPage > 1,
  };
  const summary = usersResponse?.summary || {
    totalUsers: typeof pagination.total === "number" ? pagination.total : users.length,
    anonymousUsers: 0,
    suspendedAnonymousUsers: 0,
    usersWithoutEmail: 0,
    verifiedUsers: 0,
    usersWithDailyLimits: 0,
    usersAtDailyLimit: 0,
    usersActiveToday: 0,
  };

  // Guard: clamp current page to valid range
  useEffect(() => {
    if (pagination.totalPages === 0 && currentPage !== 1) {
      setCurrentPage(1);
      return;
    }
    if (pagination.totalPages > 0 && currentPage > pagination.totalPages) {
      setCurrentPage(pagination.totalPages);
    }
  }, [currentPage, pagination.totalPages]);

  // ----- Token report for viewing user -----
  const { data: viewingUserTokenReport, isLoading: isLoadingViewingUserTokenReport } = useQuery({
    queryKey: ["/api/admin/users", viewingUser?.id, "token-report"],
    enabled: !!viewingUser?.id,
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/users/${viewingUser.id}/token-report`, { credentials: "include" });
      if (!res.ok) {
        throw new Error("No se pudo cargar el reporte de tokens");
      }
      return res.json();
    },
  });

  // ----- Mutations -----

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await apiFetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "No se pudo actualizar el usuario");
      }
      return res.json();
    },
    onSuccess: (updatedUser) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      if (updatedUser?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users", updatedUser.id, "token-report"] });
        setEditingUser((current: any) => (current?.id === updatedUser.id ? updatedUser : current));
        setViewingUser((current: any) => (current?.id === updatedUser.id ? { ...current, ...updatedUser } : current));
      }
    },
    onError: (error: any) => {
      toast.error(error?.message || "No se pudo actualizar el usuario");
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/admin/users/${id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast.success("User deleted successfully");
    },
    onError: (error: any) => {
      toast.error(error?.message || "Failed to delete user");
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (userData: { email: string; password: string; plan: string; role: string }) => {
      const res = await apiFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userData),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Error al crear usuario");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setShowAddUserModal(false);
      setNewUser({ email: "", password: "", plan: "free", role: "user" });
      toast.success("User created successfully");
    },
    onError: (error: any) => {
      toast.error(error?.message || "Failed to create user");
    },
  });

  const blockUserMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/admin/users/${id}/block`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "Failed to block user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast.success("User blocked");
    },
    onError: (error: any) => {
      toast.error(error?.message || "Failed to block user");
    },
  });

  const unblockUserMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/admin/users/${id}/unblock`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "Failed to unblock user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast.success("User unblocked");
    },
    onError: (error: any) => {
      toast.error(error?.message || "Failed to unblock user");
    },
  });

  // ----- Handlers -----

  const handleExport = (exportFormat: "csv" | "json") => {
    const params = new URLSearchParams({
      format: exportFormat,
      page: "1",
      limit: "2000",
      sortBy: sortConfig.key,
      sortOrder: sortConfig.direction,
    });
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    if (filters.plan) params.set("plan", filters.plan);
    if (filters.status) params.set("status", filters.status);
    if (filters.role) params.set("role", filters.role);
    if (filters.authProvider) params.set("authProvider", filters.authProvider);
    window.open(`/api/admin/users/export?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  const totalUsers = typeof summary.totalUsers === "number" ? summary.totalUsers : users.length;
  const totalPages = Math.max(1, pagination.totalPages || 1);

  const handleSort = (key: string) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const isBlocked = (user: any) => {
    const s = (user.status || "").toLowerCase();
    return s === "suspended" || s === "blocked";
  };

  const handleSetDailyLimit = (user: any) => {
    setDailyLimitTarget(user);
    setDailyLimitInputVal(user.dailyInputTokensLimit != null ? String(user.dailyInputTokensLimit) : "");
    setDailyLimitOutputVal(user.dailyOutputTokensLimit != null ? String(user.dailyOutputTokensLimit) : "");
  };

  const handleSaveDailyLimit = () => {
    if (!dailyLimitTarget) return;
    updateUserMutation.mutate({
      id: dailyLimitTarget.id,
      updates: {
        dailyInputTokensLimit: parseLimitInput(dailyLimitInputVal),
        dailyOutputTokensLimit: parseLimitInput(dailyLimitOutputVal),
      },
    });
    setDailyLimitTarget(null);
  };

  // ----- Loading state -----
  if (isLoading && !usersResponse) {
    return <TableSkeleton rows={8} columns={11} />;
  }

  return (
    <div className="space-y-4">
      {/* ---------- Header: title + export + add user ---------- */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-medium">Users ({totalUsers.toLocaleString()})</h2>
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1" data-testid="button-export-users">
                <Download className="h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleExport("csv")}>Export CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("json")}>Export JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={showAddUserModal} onOpenChange={setShowAddUserModal}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1" data-testid="button-add-user">
                <Plus className="h-4 w-4" />
                Add User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New User</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    placeholder="user@example.com"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    data-testid="input-new-user-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    placeholder="--------"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    data-testid="input-new-user-password"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Plan</Label>
                    <Select value={newUser.plan} onValueChange={(value) => setNewUser({ ...newUser, plan: value })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="free">Free</SelectItem>
                        <SelectItem value="pro">Pro</SelectItem>
                        <SelectItem value="enterprise">Enterprise</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select value={newUser.role} onValueChange={(value) => setNewUser({ ...newUser, role: value })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="api_only">API Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => createUserMutation.mutate(newUser)}
                  disabled={!newUser.email || !newUser.password || createUserMutation.isPending}
                  data-testid="button-submit-new-user"
                >
                  {createUserMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create User"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ---------- Search + filter toggle ---------- */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            className="pl-9 h-9"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            data-testid="input-search-users"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="gap-1">
          <Filter className="h-4 w-4" />
          Filters
        </Button>
      </div>

      {/* ---------- Filter row ---------- */}
      {showFilters && (
        <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
          <Select value={filters.plan} onValueChange={(v) => setFilters({ ...filters, plan: v })}>
            <SelectTrigger className="w-[130px] h-8">
              <SelectValue placeholder="Plan" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Plans</SelectItem>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
              <SelectItem value="enterprise">Enterprise</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
            <SelectTrigger className="w-[140px] h-8">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="pending_verification">Pending</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.role} onValueChange={(v) => setFilters({ ...filters, role: v })}>
            <SelectTrigger className="w-[130px] h-8">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Roles</SelectItem>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="editor">Editor</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
              <SelectItem value="api_only">API Only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.authProvider} onValueChange={(v) => setFilters({ ...filters, authProvider: v })}>
            <SelectTrigger className="w-[140px] h-8">
              <SelectValue placeholder="Auth" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Auth</SelectItem>
              <SelectItem value="google">Google</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="anonymous">Anonymous</SelectItem>
              <SelectItem value="sso">SSO</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => setFilters({ plan: "", status: "", role: "", authProvider: "" })}>
            Clear
          </Button>
        </div>
      )}

      {/* ---------- Security overview banner ---------- */}
      {(() => {
        if (summary.totalUsers === 0) return null;
        return (
          <div className="flex items-center gap-4 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5">
            <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0" />
            <div className="flex-1 text-sm space-y-1">
              <p className="font-medium text-yellow-700 dark:text-yellow-400">Security Overview</p>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span data-testid="text-anon-count">
                  Anonymous: <strong className="text-yellow-600">{summary.anonymousUsers.toLocaleString()}</strong> ({summary.suspendedAnonymousUsers.toLocaleString()} suspended)
                </span>
                <span data-testid="text-no-email-count">
                  No email: <strong className="text-red-500">{summary.usersWithoutEmail.toLocaleString()}</strong>
                </span>
                <span>
                  Verified: <strong className="text-green-500">{summary.verifiedUsers.toLocaleString()}</strong>
                </span>
                <span>
                  Page rows: <strong>{users.length.toLocaleString()}</strong>
                </span>
                <span>
                  Filtered total: <strong>{totalUsers.toLocaleString()}</strong>
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ---------- Stats cards ---------- */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Daily Limits</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{summary.usersWithDailyLimits.toLocaleString()}</p>
            </div>
            <Timer className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Usuarios con control diario configurado.</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">At Limit</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-red-500">{summary.usersAtDailyLimit.toLocaleString()}</p>
            </div>
            <ShieldAlert className="h-5 w-5 text-red-500" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Usuarios que ya agotaron su limite diario.</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Active Today</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{summary.usersActiveToday.toLocaleString()}</p>
            </div>
            <Activity className="h-5 w-5 text-blue-500" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Usuarios con consumo efectivo de tokens hoy.</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Verified</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{summary.verifiedUsers.toLocaleString()}</p>
            </div>
            <CheckCircle className="h-5 w-5 text-green-500" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Cuentas verificadas dentro del conjunto filtrado.</p>
        </div>
      </div>

      {/* ---------- Users table ---------- */}
      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70" onClick={() => handleSort("email")}>
                  <div className="flex items-center gap-1">
                    User {sortConfig.key === "email" && (sortConfig.direction === "asc" ? "\u2191" : "\u2193")}
                  </div>
                </th>
                <th className="text-left p-3 font-medium">Plan</th>
                <th className="text-left p-3 font-medium">Role</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70" onClick={() => handleSort("queryCount")}>
                  <div className="flex items-center gap-1">
                    Queries {sortConfig.key === "queryCount" && (sortConfig.direction === "asc" ? "\u2191" : "\u2193")}
                  </div>
                </th>
                <th className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70" onClick={() => handleSort("tokensConsumed")}>
                  <div className="flex items-center gap-1">
                    Tokens {sortConfig.key === "tokensConsumed" && (sortConfig.direction === "asc" ? "\u2191" : "\u2193")}
                  </div>
                </th>
                <th className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70" onClick={() => handleSort("openclawTokensConsumed")}>
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    <span className="text-red-500">{"\uD83E\uDD9E"}</span> OpenClaw
                    {sortConfig.key === "openclawTokensConsumed" && (sortConfig.direction === "asc" ? " \u2191" : " \u2193")}
                  </div>
                </th>
                <th className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70" onClick={() => handleSort("dailyTokensUsed")}>
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    Today {sortConfig.key === "dailyTokensUsed" && (sortConfig.direction === "asc" ? "\u2191" : "\u2193")}
                  </div>
                </th>
                <th className="text-left p-3 font-medium">Auth</th>
                <th className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70" onClick={() => handleSort("createdAt")}>
                  <div className="flex items-center gap-1">
                    Created {sortConfig.key === "createdAt" && (sortConfig.direction === "asc" ? "\u2191" : "\u2193")}
                  </div>
                </th>
                <th className="text-right p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-4 text-center text-muted-foreground">
                    No users found
                  </td>
                </tr>
              ) : (
                users.map((user: any) => (
                  <tr key={user.id} className="border-b last:border-0 hover:bg-muted/30">
                    {/* User cell */}
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium",
                            user.authProvider === "anonymous" ? "bg-red-500/10 text-red-500" : "bg-primary/10"
                          )}
                        >
                          {user.authProvider === "anonymous" ? (
                            <ShieldAlert className="h-4 w-4" />
                          ) : (
                            (user.fullName || user.email || "?")[0].toUpperCase()
                          )}
                        </div>
                        <div>
                          <p className={cn("font-medium truncate max-w-[150px]", user.authProvider === "anonymous" && "text-red-500")}>
                            {user.fullName || user.username || user.email?.split("@")[0] || "-"}
                          </p>
                          <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                            {user.email || <span className="text-red-400 italic">no email</span>}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Plan cell - with colored badge */}
                    <td className="p-3">
                      <Badge variant="secondary" className={cn("text-xs border-0", planBadgeClasses(user.plan))}>
                        {user.plan || "free"}
                      </Badge>
                    </td>

                    {/* Role cell */}
                    <td className="p-3">
                      <Badge variant="outline" className="text-xs">
                        {user.role || "user"}
                      </Badge>
                    </td>

                    {/* Status cell - with colored dot */}
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        <StatusDot status={user.status} />
                        <Badge
                          variant={user.status === "active" ? "default" : user.status === "suspended" ? "destructive" : "outline"}
                          className="text-xs"
                        >
                          {user.status || "active"}
                        </Badge>
                      </div>
                    </td>

                    {/* Queries cell */}
                    <td className="p-3 text-muted-foreground">{(user.queryCount || 0).toLocaleString()}</td>

                    {/* Tokens cell */}
                    <td className="p-3 text-muted-foreground">{(user.tokensConsumed || 0).toLocaleString()}</td>

                    {/* OpenClaw tokens cell */}
                    <td className="p-3 text-muted-foreground">
                      <span className={user.openclawTokensConsumed > 0 ? "text-red-500 font-medium" : ""}>
                        {(user.openclawTokensConsumed || 0).toLocaleString()}
                      </span>
                    </td>

                    {/* Daily tokens cell */}
                    <td className="p-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium tabular-nums">{(user.dailyTotalTokensUsed || 0).toLocaleString()}</p>
                        <p className="text-[11px] text-muted-foreground">
                          In {(user.dailyInputTokensUsed || 0).toLocaleString()} / Out {(user.dailyOutputTokensUsed || 0).toLocaleString()}
                        </p>
                        {(user.dailyInputTokensLimit !== null && user.dailyInputTokensLimit !== undefined) ||
                        (user.dailyOutputTokensLimit !== null && user.dailyOutputTokensLimit !== undefined) ? (
                          <Badge variant={user.dailyLimitReached ? "destructive" : "secondary"} className="text-[10px]">
                            {user.dailyLimitReached ? "Limit reached" : "Tracked"}
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">No daily limit</span>
                        )}
                      </div>
                    </td>

                    {/* Auth cell */}
                    <td className="p-3">
                      <div className="flex items-center gap-1">
                        <Badge
                          variant={user.authProvider === "anonymous" ? "destructive" : user.authProvider === "google" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {user.authProvider || "email"}
                        </Badge>
                        {isEnabledFlag(user.emailVerified) && <CheckCircle className="h-3 w-3 text-green-500" />}
                        {isEnabledFlag(user.is2faEnabled) && <Shield className="h-3 w-3 text-blue-500" />}
                      </div>
                    </td>

                    {/* Created date cell */}
                    <td className="p-3 text-xs text-muted-foreground">
                      {user.createdAt ? format(new Date(user.createdAt), "dd/MM/yy") : "-"}
                    </td>

                    {/* Actions cell - dropdown menu */}
                    <td className="p-3">
                      <div className="flex justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" data-testid={`button-actions-user-${user.id}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            {/* View Profile */}
                            <DropdownMenuItem onClick={() => setViewingUser(user)} data-testid={`button-view-user-${user.id}`}>
                              <Eye className="h-4 w-4 mr-2" />
                              View Profile
                            </DropdownMenuItem>

                            {/* Change Plan submenu */}
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>
                                <CreditCard className="h-4 w-4 mr-2" />
                                Change Plan
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                <DropdownMenuItem
                                  onClick={() => updateUserMutation.mutate({ id: user.id, updates: { plan: "free" } })}
                                  disabled={(user.plan || "free") === "free"}
                                >
                                  <span className={cn("mr-2 inline-block h-2 w-2 rounded-full", "bg-gray-400")} />
                                  Free
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => updateUserMutation.mutate({ id: user.id, updates: { plan: "pro" } })}
                                  disabled={user.plan === "pro"}
                                >
                                  <span className={cn("mr-2 inline-block h-2 w-2 rounded-full", "bg-blue-500")} />
                                  Pro
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => updateUserMutation.mutate({ id: user.id, updates: { plan: "enterprise" } })}
                                  disabled={user.plan === "enterprise"}
                                >
                                  <span className={cn("mr-2 inline-block h-2 w-2 rounded-full", "bg-amber-500")} />
                                  Enterprise
                                </DropdownMenuItem>
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>

                            {/* Change Role submenu */}
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>
                                <UserCog className="h-4 w-4 mr-2" />
                                Change Role
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                <DropdownMenuItem
                                  onClick={() => updateUserMutation.mutate({ id: user.id, updates: { role: "user" } })}
                                  disabled={(user.role || "user") === "user"}
                                >
                                  <User className="h-4 w-4 mr-2" />
                                  User
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => updateUserMutation.mutate({ id: user.id, updates: { role: "viewer" } })}
                                  disabled={user.role === "viewer"}
                                >
                                  <Eye className="h-4 w-4 mr-2" />
                                  Viewer
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => updateUserMutation.mutate({ id: user.id, updates: { role: "editor" } })}
                                  disabled={user.role === "editor"}
                                >
                                  <Edit className="h-4 w-4 mr-2" />
                                  Editor
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => updateUserMutation.mutate({ id: user.id, updates: { role: "admin" } })}
                                  disabled={user.role === "admin"}
                                >
                                  <ShieldCheck className="h-4 w-4 mr-2" />
                                  Admin
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => updateUserMutation.mutate({ id: user.id, updates: { role: "api_only" } })}
                                  disabled={user.role === "api_only"}
                                >
                                  <Shield className="h-4 w-4 mr-2" />
                                  API Only
                                </DropdownMenuItem>
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>

                            {/* Set Daily Limit */}
                            <DropdownMenuItem onClick={() => handleSetDailyLimit(user)}>
                              <Timer className="h-4 w-4 mr-2" />
                              Set Daily Limit
                            </DropdownMenuItem>

                            <DropdownMenuSeparator />

                            {/* Block / Unblock */}
                            {isBlocked(user) ? (
                              <DropdownMenuItem onClick={() => unblockUserMutation.mutate(user.id)}>
                                <ShieldCheck className="h-4 w-4 mr-2" />
                                Unblock User
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => blockUserMutation.mutate(user.id)}>
                                <Ban className="h-4 w-4 mr-2" />
                                Block User
                              </DropdownMenuItem>
                            )}

                            <DropdownMenuSeparator />

                            {/* Edit (opens edit modal) */}
                            <DropdownMenuItem onClick={() => setEditingUser(user)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Edit User
                            </DropdownMenuItem>

                            {/* Delete with confirmation */}
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() =>
                                setDeleteTarget({
                                  id: user.id,
                                  label: user.email || user.fullName || user.username || user.id,
                                })
                              }
                              data-testid={`button-delete-user-${user.id}`}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete User
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- Pagination ---------- */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {users.length === 0 ? 0 : ((pagination.page || currentPage) - 1) * (pagination.limit || itemsPerPage) + 1}
            {" "}-{" "}
            {Math.min((pagination.page || currentPage) * (pagination.limit || itemsPerPage), totalUsers)}
            {" "}of {totalUsers.toLocaleString()}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={!pagination.hasPrev} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={!pagination.hasNext} onClick={() => setCurrentPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* ---------- View user dialog ---------- */}
      <Dialog open={!!viewingUser} onOpenChange={() => setViewingUser(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>User Details</DialogTitle>
          </DialogHeader>
          {viewingUser && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">ID:</span> <span className="font-mono text-xs">{viewingUser.id}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Email:</span> {viewingUser.email || "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">Full Name:</span>{" "}
                  {viewingUser.fullName || `${viewingUser.firstName || ""} ${viewingUser.lastName || ""}`.trim() || "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">Plan:</span>{" "}
                  <Badge variant="secondary" className={cn("border-0", planBadgeClasses(viewingUser.plan))}>
                    {viewingUser.plan || "free"}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Role:</span> <Badge variant="outline">{viewingUser.role || "user"}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <div className="inline-flex items-center gap-1.5">
                    <StatusDot status={viewingUser.status} />
                    <Badge variant={viewingUser.status === "active" ? "default" : "outline"}>
                      {viewingUser.status || "active"}
                    </Badge>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Queries:</span> {(viewingUser.queryCount || 0).toLocaleString()}
                </div>
                <div>
                  <span className="text-muted-foreground">Tokens Used:</span> {(viewingUser.tokensConsumed || 0).toLocaleString()} /{" "}
                  {(viewingUser.tokensLimit || 100000).toLocaleString()}
                </div>
                <div>
                  <span className="text-muted-foreground">OpenClaw Tokens:</span>{" "}
                  <span className="text-red-500 font-medium">{(viewingUser.openclawTokensConsumed || 0).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Credits:</span> {(viewingUser.creditsBalance || 0).toLocaleString()}
                </div>
                <div>
                  <span className="text-muted-foreground">Auth Provider:</span> {viewingUser.authProvider || "email"}
                </div>
                <div>
                  <span className="text-muted-foreground">Email Verified:</span> {isEnabledFlag(viewingUser.emailVerified) ? "Yes" : "No"}
                </div>
                <div>
                  <span className="text-muted-foreground">2FA Enabled:</span> {isEnabledFlag(viewingUser.is2faEnabled) ? "Yes" : "No"}
                </div>
                <div>
                  <span className="text-muted-foreground">Last IP:</span> {viewingUser.lastIp || "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">Country:</span> {viewingUser.countryCode || "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">Last Login:</span>{" "}
                  {viewingUser.lastLoginAt ? format(new Date(viewingUser.lastLoginAt), "dd/MM/yyyy HH:mm") : "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">Created:</span>{" "}
                  {viewingUser.createdAt ? format(new Date(viewingUser.createdAt), "dd/MM/yyyy HH:mm") : "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">Referral Code:</span> {viewingUser.referralCode || "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">Referred By:</span> {viewingUser.referredBy || "-"}
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Tags:</span>{" "}
                  {viewingUser.tags?.length
                    ? viewingUser.tags.map((t: string) => (
                        <Badge key={t} variant="secondary" className="mr-1">
                          {t}
                        </Badge>
                      ))
                    : "-"}
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Internal Notes:</span>{" "}
                  <p className="mt-1 text-xs">{viewingUser.internalNotes || "-"}</p>
                </div>
              </div>

              {/* Token report section */}
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Control Diario de Tokens</p>
                    <p className="text-xs text-muted-foreground">Entrada, salida y consumo reciente del usuario.</p>
                  </div>
                  {viewingUserTokenReport?.today && (
                    <Badge variant={viewingUserTokenReport.today.withinLimits ? "secondary" : "destructive"}>
                      {viewingUserTokenReport.today.withinLimits ? "Dentro del limite" : "Limite alcanzado"}
                    </Badge>
                  )}
                </div>

                {isLoadingViewingUserTokenReport ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando reporte de tokens...
                  </div>
                ) : viewingUserTokenReport?.today ? (
                  <>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="rounded-md border p-3">
                        <p className="text-xs text-muted-foreground">Input hoy</p>
                        <p className="text-lg font-semibold tabular-nums">
                          {viewingUserTokenReport.today.inputTokensUsed.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Limite: {formatOptionalLimit(viewingUserTokenReport.today.inputTokensLimit)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Restante: {formatOptionalLimit(viewingUserTokenReport.today.inputTokensRemaining)}
                        </p>
                      </div>
                      <div className="rounded-md border p-3">
                        <p className="text-xs text-muted-foreground">Output hoy</p>
                        <p className="text-lg font-semibold tabular-nums">
                          {viewingUserTokenReport.today.outputTokensUsed.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Limite: {formatOptionalLimit(viewingUserTokenReport.today.outputTokensLimit)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Restante: {formatOptionalLimit(viewingUserTokenReport.today.outputTokensRemaining)}
                        </p>
                      </div>
                      <div className="rounded-md border p-3">
                        <p className="text-xs text-muted-foreground">Total hoy</p>
                        <p className="text-lg font-semibold tabular-nums">
                          {viewingUserTokenReport.today.totalTokensUsed.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Lifetime: {(viewingUserTokenReport.lifetime?.totalTokensUsed || 0).toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Reset:{" "}
                          {viewingUserTokenReport.today.resetAt
                            ? format(new Date(viewingUserTokenReport.today.resetAt), "dd/MM/yyyy HH:mm")
                            : "-"}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium">Ultimos 7 dias</p>
                      <div className="rounded-md border overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/40">
                            <tr>
                              <th className="p-2 text-left font-medium">Dia</th>
                              <th className="p-2 text-right font-medium">Requests</th>
                              <th className="p-2 text-right font-medium">Input</th>
                              <th className="p-2 text-right font-medium">Output</th>
                              <th className="p-2 text-right font-medium">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {viewingUserTokenReport.dailyHistory?.map((entry: any) => (
                              <tr key={entry.day} className="border-t">
                                <td className="p-2">{entry.day}</td>
                                <td className="p-2 text-right tabular-nums">{(entry.requestCount || 0).toLocaleString()}</td>
                                <td className="p-2 text-right tabular-nums">{(entry.inputTokens || 0).toLocaleString()}</td>
                                <td className="p-2 text-right tabular-nums">{(entry.outputTokens || 0).toLocaleString()}</td>
                                <td className="p-2 text-right tabular-nums font-medium">{(entry.totalTokens || 0).toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No hay reporte diario disponible.</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------- Edit user dialog ---------- */}
      <Dialog open={!!editingUser} onOpenChange={() => setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          {editingUser && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Plan</Label>
                  <Select
                    defaultValue={editingUser.plan || "free"}
                    onValueChange={(value) => updateUserMutation.mutate({ id: editingUser.id, updates: { plan: value } })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Free</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select
                    defaultValue={editingUser.role || "user"}
                    onValueChange={(value) => updateUserMutation.mutate({ id: editingUser.id, updates: { role: value } })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="api_only">API Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  defaultValue={editingUser.status || "active"}
                  onValueChange={(value) => updateUserMutation.mutate({ id: editingUser.id, updates: { status: value } })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                    <SelectItem value="pending_verification">Pending Verification</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tokens Limit</Label>
                <Input
                  type="number"
                  defaultValue={editingUser.tokensLimit || 100000}
                  onBlur={(e) => {
                    const parsed = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(parsed) && parsed >= 0) {
                      updateUserMutation.mutate({ id: editingUser.id, updates: { tokensLimit: parsed } });
                    }
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Daily Input Limit</Label>
                  <Input
                    type="number"
                    placeholder="Sin limite"
                    defaultValue={editingUser.dailyInputTokensLimit ?? ""}
                    onBlur={(e) =>
                      updateUserMutation.mutate({
                        id: editingUser.id,
                        updates: { dailyInputTokensLimit: parseLimitInput(e.target.value) },
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">Vacio = sin limite diario de entrada.</p>
                </div>
                <div className="space-y-2">
                  <Label>Daily Output Limit</Label>
                  <Input
                    type="number"
                    placeholder="Sin limite"
                    defaultValue={editingUser.dailyOutputTokensLimit ?? ""}
                    onBlur={(e) =>
                      updateUserMutation.mutate({
                        id: editingUser.id,
                        updates: { dailyOutputTokensLimit: parseLimitInput(e.target.value) },
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">Vacio = sin limite diario de salida.</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Internal Notes</Label>
                <Textarea
                  defaultValue={editingUser.internalNotes || ""}
                  onBlur={(e) => updateUserMutation.mutate({ id: editingUser.id, updates: { internalNotes: e.target.value } })}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------- Delete confirmation dialog ---------- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete <strong>{deleteTarget?.label}</strong>? This action cannot be undone. All user data, conversations, and settings will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  deleteUserMutation.mutate(deleteTarget.id);
                  setDeleteTarget(null);
                }
              }}
            >
              {deleteUserMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------- Set Daily Limit dialog ---------- */}
      <Dialog open={!!dailyLimitTarget} onOpenChange={(open) => { if (!open) setDailyLimitTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Daily Token Limits</DialogTitle>
          </DialogHeader>
          {dailyLimitTarget && (
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                Configure daily input and output token limits for{" "}
                <strong>{dailyLimitTarget.email || dailyLimitTarget.fullName || dailyLimitTarget.id}</strong>.
                Leave empty for unlimited.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Daily Input Limit</Label>
                  <Input
                    type="number"
                    placeholder="Sin limite"
                    value={dailyLimitInputVal}
                    onChange={(e) => setDailyLimitInputVal(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Daily Output Limit</Label>
                  <Input
                    type="number"
                    placeholder="Sin limite"
                    value={dailyLimitOutputVal}
                    onChange={(e) => setDailyLimitOutputVal(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDailyLimitTarget(null)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveDailyLimit} disabled={updateUserMutation.isPending}>
                  {updateUserMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Limits"
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
