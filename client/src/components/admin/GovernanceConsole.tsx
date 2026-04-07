import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { apiFetchJson } from "@/lib/adminApi";
import { toast } from "sonner";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Eye,
  Rocket,
  FlaskConical,
  OctagonX,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Hash,
  User,
  FileText,
} from "lucide-react";

type GovernanceMode = "SAFE" | "SUPERVISED" | "AUTOPILOT" | "RESEARCH" | "EMERGENCY_STOP";

interface ModePermissions {
  allowedToolCategories: string[];
  maxRiskLevel: string;
  requiresHumanApproval: boolean;
  humanApprovalThreshold: string;
  allowExternalAPIs: boolean;
  allowFileSystem: boolean;
  allowNetworkAccess: boolean;
  allowCodeExecution: boolean;
  riskTolerance: number;
  maxConcurrentAgents: number;
  autoApproveTimeout: number | null;
}

interface ModeStatus {
  currentMode: GovernanceMode;
  permissions: ModePermissions;
  transitionHistory: Array<{
    from: GovernanceMode;
    to: GovernanceMode;
    changedBy: string;
    reason: string;
    timestamp: number;
  }>;
  validTransitions: GovernanceMode[];
}

interface ApprovalRequest {
  id: string;
  action: string;
  description: string;
  riskLevel: string;
  impact: string;
  reversibility: string;
  requestedBy: string;
  requestedAt: number;
  expiresAt: number;
  status: string;
  reviewedBy: string | null;
  reviewedAt: number | null;
  reviewNotes: string | null;
  metadata: Record<string, unknown>;
  escalationLevel: number;
}

interface AuditEntry {
  id: string;
  timestamp: number;
  action: string;
  actor: string;
  target: string;
  details: Record<string, unknown>;
  riskLevel: string;
  outcome: string;
  governanceMode: string;
  previousHash: string;
  hash: string;
  artifactHash: string | null;
  sequenceNumber: number;
}

interface IntegrityReport {
  valid: boolean;
  totalEntries: number;
  checkedEntries: number;
  brokenAt: number | null;
  brokenEntry: string | null;
  computedHashes: number;
}

const MODE_CONFIG: Record<GovernanceMode, { icon: React.ElementType; color: string; bg: string; description: string }> = {
  SAFE: { icon: ShieldCheck, color: "text-green-500", bg: "bg-green-500/10", description: "Read-only, no external access" },
  SUPERVISED: { icon: Eye, color: "text-blue-500", bg: "bg-blue-500/10", description: "Human approval for risky actions" },
  AUTOPILOT: { icon: Rocket, color: "text-orange-500", bg: "bg-orange-500/10", description: "Full autonomy, auto-approve" },
  RESEARCH: { icon: FlaskConical, color: "text-purple-500", bg: "bg-purple-500/10", description: "Browse & analyze, no writes" },
  EMERGENCY_STOP: { icon: OctagonX, color: "text-red-500", bg: "bg-red-500/10", description: "All actions blocked" },
};

const RISK_COLORS: Record<string, string> = {
  safe: "bg-green-500/10 text-green-600",
  moderate: "bg-yellow-500/10 text-yellow-600",
  dangerous: "bg-orange-500/10 text-orange-600",
  critical: "bg-red-500/10 text-red-600",
};

export default function GovernanceConsole() {
  const queryClient = useQueryClient();
  const [switchReason, setSwitchReason] = useState("");
  const [selectedMode, setSelectedMode] = useState<GovernanceMode | null>(null);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [auditFilter, setAuditFilter] = useState("");

  const { data: modeStatus, isLoading: modeLoading } = useQuery<ModeStatus>({
    queryKey: ["/api/governance/mode"],
    queryFn: () => apiFetchJson("/api/governance/mode"),
    refetchInterval: 5000,
    throwOnError: true,
  });

  const { data: approvalsData, isLoading: approvalsLoading } = useQuery({
    queryKey: ["/api/governance/approvals"],
    queryFn: () => apiFetchJson("/api/governance/approvals"),
    refetchInterval: 3000,
    throwOnError: true,
  });

  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ["/api/governance/audit"],
    queryFn: () => apiFetchJson("/api/governance/audit?limit=50"),
    refetchInterval: 10000,
    throwOnError: true,
  });

  const { data: integrityData } = useQuery<IntegrityReport>({
    queryKey: ["/api/governance/audit/integrity"],
    queryFn: () => apiFetchJson("/api/governance/audit/integrity"),
    refetchInterval: 30000,
    throwOnError: true,
  });

  const switchModeMutation = useMutation({
    mutationFn: async ({ mode, reason }: { mode: GovernanceMode; reason: string }) => {
      return apiFetchJson("/api/governance/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode, reason }),
      });
    },
    onSuccess: (data) => {
      toast.success(`Mode switched to ${data.status.currentMode}`);
      setSwitchReason("");
      setSelectedMode(null);
      queryClient.invalidateQueries({ queryKey: ["/api/governance/mode"] });
      queryClient.invalidateQueries({ queryKey: ["/api/governance/audit"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const decideMutation = useMutation({
    mutationFn: async ({ id, decision, notes }: { id: string; decision: "approved" | "denied"; notes: string }) => {
      return apiFetchJson(`/api/governance/approvals/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ decision, notes }),
      });
    },
    onSuccess: (_, vars) => {
      toast.success(`Request ${vars.decision}`);
      setDecisionNotes((prev) => { const n = { ...prev }; delete n[vars.id]; return n; });
      queryClient.invalidateQueries({ queryKey: ["/api/governance/approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/governance/audit"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const currentMode = modeStatus?.currentMode || "SUPERVISED";
  const permissions = modeStatus?.permissions;
  const validTransitions = modeStatus?.validTransitions || [];
  const pendingApprovals: ApprovalRequest[] = approvalsData?.pending || [];
  const stats = approvalsData?.stats || {};
  const auditEntries: AuditEntry[] = auditData?.entries || [];

  const filteredAudit = auditFilter
    ? auditEntries.filter((e) =>
        e.action.toLowerCase().includes(auditFilter.toLowerCase()) ||
        e.actor.toLowerCase().includes(auditFilter.toLowerCase()) ||
        e.riskLevel.toLowerCase().includes(auditFilter.toLowerCase())
      )
    : auditEntries;

  if (modeLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="governance-loading">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="governance-console">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium" data-testid="text-governance-title">Governance Console</h2>
          <p className="text-sm text-muted-foreground">Manage system governance modes, approval queue, and audit trail</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/governance/mode"] });
          queryClient.invalidateQueries({ queryKey: ["/api/governance/approvals"] });
          queryClient.invalidateQueries({ queryKey: ["/api/governance/audit"] });
        }} data-testid="button-refresh-governance">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Tabs defaultValue="modes" className="space-y-4">
        <TabsList data-testid="governance-tabs">
          <TabsTrigger value="modes" data-testid="tab-modes">
            <Shield className="h-4 w-4 mr-1" />
            Modes
          </TabsTrigger>
          <TabsTrigger value="approvals" data-testid="tab-approvals">
            <Clock className="h-4 w-4 mr-1" />
            Approvals
            {(stats.pendingCount || 0) > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">{stats.pendingCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">
            <FileText className="h-4 w-4 mr-1" />
            Audit Trail
          </TabsTrigger>
        </TabsList>

        <TabsContent value="modes" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {(Object.keys(MODE_CONFIG) as GovernanceMode[]).map((mode) => {
              const cfg = MODE_CONFIG[mode];
              const Icon = cfg.icon;
              const isCurrent = mode === currentMode;
              const canSwitch = validTransitions.includes(mode);
              return (
                <Card
                  key={mode}
                  className={cn(
                    "cursor-pointer transition-all",
                    isCurrent && "ring-2 ring-primary",
                    selectedMode === mode && !isCurrent && "ring-2 ring-muted-foreground/50"
                  )}
                  onClick={() => {
                    if (!isCurrent && canSwitch) setSelectedMode(mode);
                  }}
                  data-testid={`card-mode-${mode.toLowerCase()}`}
                >
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={cn("p-1.5 rounded-md", cfg.bg)}>
                        <Icon className={cn("h-4 w-4", cfg.color)} />
                      </div>
                      {isCurrent && <Badge variant="default" className="text-[10px] h-4">Active</Badge>}
                    </div>
                    <p className="text-sm font-semibold">{mode.replace("_", " ")}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{cfg.description}</p>
                    {!isCurrent && !canSwitch && (
                      <p className="text-[10px] text-red-500 mt-1">Transition not allowed</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {selectedMode && selectedMode !== currentMode && (
            <Card data-testid="card-mode-switch">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  Switch to {selectedMode.replace("_", " ")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  placeholder="Reason for mode change (required)..."
                  value={switchReason}
                  onChange={(e) => setSwitchReason(e.target.value)}
                  className="text-sm"
                  data-testid="input-switch-reason"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!switchReason.trim() || switchModeMutation.isPending}
                    onClick={() => switchModeMutation.mutate({ mode: selectedMode, reason: switchReason })}
                    data-testid="button-confirm-switch"
                    className={selectedMode === "EMERGENCY_STOP" ? "bg-red-600 hover:bg-red-700" : ""}
                  >
                    {switchModeMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                    Confirm Switch
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setSelectedMode(null); setSwitchReason(""); }} data-testid="button-cancel-switch">
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {permissions && (
            <Card data-testid="card-current-permissions">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Current Permissions — {currentMode}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={cn("w-2 h-2 rounded-full", permissions.allowExternalAPIs ? "bg-green-500" : "bg-red-500")} />
                    External APIs
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("w-2 h-2 rounded-full", permissions.allowFileSystem ? "bg-green-500" : "bg-red-500")} />
                    File System
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("w-2 h-2 rounded-full", permissions.allowNetworkAccess ? "bg-green-500" : "bg-red-500")} />
                    Network Access
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("w-2 h-2 rounded-full", permissions.allowCodeExecution ? "bg-green-500" : "bg-red-500")} />
                    Code Execution
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("w-2 h-2 rounded-full", permissions.requiresHumanApproval ? "bg-yellow-500" : "bg-green-500")} />
                    Human Approval: {permissions.requiresHumanApproval ? "Required" : "Not Required"}
                  </div>
                  <div>Max Risk: <Badge variant="outline" className={cn("text-[10px]", RISK_COLORS[permissions.maxRiskLevel])}>{permissions.maxRiskLevel}</Badge></div>
                  <div>Risk Tolerance: {(permissions.riskTolerance * 100).toFixed(0)}%</div>
                  <div>Max Agents: {permissions.maxConcurrentAgents}</div>
                </div>
                {permissions.allowedToolCategories.length > 0 && (
                  <div className="mt-3">
                    <span className="text-xs text-muted-foreground">Allowed Tools: </span>
                    {permissions.allowedToolCategories.map((cat) => (
                      <Badge key={cat} variant="secondary" className="text-[10px] mr-1 mb-1">{cat}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {(modeStatus?.transitionHistory || []).length > 0 && (
            <Card data-testid="card-transition-history">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Recent Transitions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {[...(modeStatus?.transitionHistory || [])].reverse().map((t, i) => (
                    <div key={i} className="flex items-center gap-3 text-xs py-1.5 border-b last:border-0">
                      <Badge variant="outline" className="text-[10px]">{t.from}</Badge>
                      <span>→</span>
                      <Badge variant="outline" className="text-[10px]">{t.to}</Badge>
                      <span className="text-muted-foreground flex-1 truncate">{t.reason}</span>
                      <span className="text-muted-foreground shrink-0">{new Date(t.timestamp).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="approvals" className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card data-testid="card-pending-count">
              <CardContent className="pt-3 pb-2">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-3.5 w-3.5 text-yellow-500" />
                  <span className="text-xs text-muted-foreground">Pending</span>
                </div>
                <p className="text-xl font-bold" data-testid="text-pending-count">{stats.pendingCount || 0}</p>
              </CardContent>
            </Card>
            <Card data-testid="card-approved-count">
              <CardContent className="pt-3 pb-2">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                  <span className="text-xs text-muted-foreground">Approved</span>
                </div>
                <p className="text-xl font-bold" data-testid="text-approved-count">{stats.recentApproved || 0}</p>
              </CardContent>
            </Card>
            <Card data-testid="card-denied-count">
              <CardContent className="pt-3 pb-2">
                <div className="flex items-center gap-2 mb-1">
                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                  <span className="text-xs text-muted-foreground">Denied</span>
                </div>
                <p className="text-xl font-bold" data-testid="text-denied-count">{stats.recentDenied || 0}</p>
              </CardContent>
            </Card>
            <Card data-testid="card-expired-count">
              <CardContent className="pt-3 pb-2">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
                  <span className="text-xs text-muted-foreground">Expired</span>
                </div>
                <p className="text-xl font-bold" data-testid="text-expired-count">{stats.recentExpired || 0}</p>
              </CardContent>
            </Card>
          </div>

          {pendingApprovals.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="text-no-pending">
                <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500/50" />
                No pending approval requests
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {pendingApprovals.map((req) => (
                <Card key={req.id} data-testid={`card-approval-${req.id}`}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm">{req.action}</span>
                          <Badge variant="outline" className={cn("text-[10px]", RISK_COLORS[req.riskLevel])}>{req.riskLevel}</Badge>
                          {req.status === "escalated" && <Badge variant="destructive" className="text-[10px]">Escalated L{req.escalationLevel}</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">{req.description}</p>
                        <div className="flex gap-4 mt-1 text-[11px] text-muted-foreground">
                          <span>By: {req.requestedBy}</span>
                          <span>Impact: {req.impact}</span>
                          <span>Reversibility: {req.reversibility}</span>
                          <span>Expires: {new Date(req.expiresAt).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <Input
                        placeholder="Notes (optional)..."
                        value={decisionNotes[req.id] || ""}
                        onChange={(e) => setDecisionNotes((prev) => ({ ...prev, [req.id]: e.target.value }))}
                        className="h-8 text-xs flex-1"
                        data-testid={`input-notes-${req.id}`}
                      />
                      <Button
                        size="sm"
                        className="h-8 bg-green-600 hover:bg-green-700"
                        disabled={decideMutation.isPending}
                        onClick={() => decideMutation.mutate({ id: req.id, decision: "approved", notes: decisionNotes[req.id] || "" })}
                        data-testid={`button-approve-${req.id}`}
                      >
                        <CheckCircle className="h-3.5 w-3.5 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-8"
                        disabled={decideMutation.isPending}
                        onClick={() => decideMutation.mutate({ id: req.id, decision: "denied", notes: decisionNotes[req.id] || "" })}
                        data-testid={`button-deny-${req.id}`}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1" />
                        Deny
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="audit" className="space-y-4">
          <div className="flex items-center gap-3">
            <Input
              placeholder="Filter by action, actor, or risk level..."
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value)}
              className="max-w-sm h-8 text-sm"
              data-testid="input-audit-filter"
            />
            <div className="flex items-center gap-2 ml-auto">
              {integrityData && (
                <Badge
                  variant={integrityData.valid ? "default" : "destructive"}
                  className="text-xs"
                  data-testid="badge-integrity"
                >
                  <Hash className="h-3 w-3 mr-1" />
                  {integrityData.valid ? "Chain Valid" : "Chain Broken"}
                  {integrityData.valid && ` (${integrityData.totalEntries} entries)`}
                </Badge>
              )}
            </div>
          </div>

          {auditLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filteredAudit.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="text-no-audit">
                No audit entries found
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
              {[...filteredAudit].reverse().map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 py-2 px-3 rounded-md border hover:bg-muted/50 text-xs"
                  data-testid={`row-audit-${entry.sequenceNumber}`}
                >
                  <span className="text-muted-foreground w-6 text-right shrink-0">#{entry.sequenceNumber}</span>
                  <Badge variant="outline" className={cn("text-[10px] shrink-0", RISK_COLORS[entry.riskLevel])}>{entry.riskLevel}</Badge>
                  <Badge variant={entry.outcome === "success" ? "default" : entry.outcome === "failure" ? "destructive" : "secondary"} className="text-[10px] shrink-0">{entry.outcome}</Badge>
                  <span className="font-mono text-[11px] shrink-0">{entry.action}</span>
                  <span className="text-muted-foreground truncate flex-1">
                    <User className="h-3 w-3 inline mr-0.5" />{entry.actor}
                  </span>
                  <span className="text-muted-foreground shrink-0">{new Date(entry.timestamp).toLocaleString()}</span>
                  <span className="font-mono text-[9px] text-muted-foreground shrink-0" title={entry.hash}>
                    {entry.hash.substring(0, 8)}...
                  </span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
