import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Globe, Plus, X, Navigation, Camera, Play, Loader2,
  Monitor, Clock, Activity, AlertTriangle, RefreshCw, Trash2
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const statusColors: Record<string, string> = {
  active: "bg-green-500",
  idle: "bg-yellow-500",
  navigating: "bg-blue-500",
  error: "bg-red-500",
  closed: "bg-gray-400",
  loading: "bg-blue-400",
};

function SessionStatusBadge({ status }: { status: string }) {
  return (
    <Badge className={`${statusColors[status] || "bg-gray-500"} text-white text-xs`} data-testid={`badge-session-status-${status}`}>
      {status}
    </Badge>
  );
}

export default function BrowserPlane() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("sessions");
  const [newSessionUrl, setNewSessionUrl] = useState("https://");
  const [navigateUrl, setNavigateUrl] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [actionType, setActionType] = useState("click");
  const [actionSelector, setActionSelector] = useState("");
  const [actionValue, setActionValue] = useState("");

  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ["/api/browser/sessions"],
    refetchInterval: 5000,
  });

  const { data: statsData } = useQuery({
    queryKey: ["/api/browser/stats"],
    refetchInterval: 10000,
  });

  const { data: screenshotData, isLoading: screenshotLoading } = useQuery({
    queryKey: ["/api/browser/sessions", selectedSessionId, "detail"],
    queryFn: async () => {
      if (!selectedSessionId) return null;
      const res = await apiRequest("GET", `/api/browser/sessions/${selectedSessionId}`);
      return res.json();
    },
    enabled: !!selectedSessionId,
    refetchInterval: 15000,
  });

  const createSessionMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/browser/sessions", { url });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/browser/sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/browser/stats"] });
      setNewSessionUrl("https://");
    },
  });

  const navigateMutation = useMutation({
    mutationFn: async ({ sessionId, url }: { sessionId: string; url: string }) => {
      const res = await apiRequest("POST", `/api/browser/sessions/${sessionId}/navigate`, { url });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/browser/sessions"] });
      setNavigateUrl("");
    },
  });

  const closeSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await apiRequest("DELETE", `/api/browser/sessions/${sessionId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/browser/sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/browser/stats"] });
      if (selectedSessionId) {
        setSelectedSessionId(null);
      }
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ sessionId, action }: { sessionId: string; action: { type: string; selector?: string; value?: string } }) => {
      const payload = { action: action.type, selector: action.selector, text: action.value };
      const res = await apiRequest("POST", `/api/browser/sessions/${sessionId}/action`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/browser/sessions"] });
    },
  });

  const sessions: any[] = (sessionsData as any)?.sessions || [];
  const stats: any = (statsData as any) || {};

  return (
    <div className="space-y-6" data-testid="browser-plane-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2" data-testid="text-title">
            <Globe className="h-6 w-6" />
            Browser Plane
          </h2>
          <p className="text-muted-foreground text-sm mt-1">Manage browser sessions, navigate pages, execute actions</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/browser/sessions"] });
            queryClient.invalidateQueries({ queryKey: ["/api/browser/stats"] });
          }}
          data-testid="button-refresh"
        >
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Monitor className="h-4 w-4 text-blue-400" />
              <span className="text-xs text-muted-foreground">Active Sessions</span>
            </div>
            <div className="text-2xl font-bold" data-testid="stat-active-sessions">{stats.activeSessions || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Navigation className="h-4 w-4 text-green-400" />
              <span className="text-xs text-muted-foreground">Listed Sessions</span>
            </div>
            <div className="text-2xl font-bold" data-testid="stat-listed-sessions">{sessions.length}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-list">
          <TabsTrigger value="sessions" data-testid="tab-sessions">Sessions</TabsTrigger>
          <TabsTrigger value="screenshot" data-testid="tab-screenshot">Screenshot Preview</TabsTrigger>
          <TabsTrigger value="actions" data-testid="tab-actions">Actions</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  Create New Session
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input
                  placeholder="https://example.com"
                  value={newSessionUrl}
                  onChange={(e) => setNewSessionUrl(e.target.value)}
                  data-testid="input-new-session-url"
                />
                <Button
                  onClick={() => createSessionMutation.mutate(newSessionUrl)}
                  disabled={!newSessionUrl.trim() || createSessionMutation.isPending}
                  data-testid="button-create-session"
                >
                  {createSessionMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Plus className="h-4 w-4 mr-1" />
                  )}
                  Create
                </Button>
              </div>
              {createSessionMutation.isError && (
                <p className="text-sm text-red-500 mt-2" data-testid="text-create-error">
                  {(createSessionMutation.error as Error)?.message}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Monitor className="h-4 w-4" />
                Active Sessions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sessionsLoading ? (
                <div className="flex items-center justify-center py-8" data-testid="sessions-loading">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : sessions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-no-sessions">
                  <Monitor className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No active browser sessions</p>
                </div>
              ) : (
                <Table data-testid="table-sessions">
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>URL</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.map((session: any) => (
                      <TableRow
                        key={session.id}
                        className={`cursor-pointer ${selectedSessionId === session.id ? "bg-muted/50" : ""}`}
                        onClick={() => setSelectedSessionId(session.id)}
                        data-testid={`row-session-${session.id}`}
                      >
                        <TableCell className="font-mono text-xs" data-testid={`text-session-id-${session.id}`}>
                          {session.id.slice(0, 8)}...
                        </TableCell>
                        <TableCell className="text-xs max-w-48 truncate" data-testid={`text-session-url-${session.id}`}>
                          {session.url || "—"}
                        </TableCell>
                        <TableCell>
                          <SessionStatusBadge status={session.status} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground" data-testid={`text-session-created-${session.id}`}>
                          <Clock className="h-3 w-3 inline mr-1" />
                          {session.createdAt ? new Date(session.createdAt).toLocaleTimeString() : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedSessionId(session.id);
                                setActiveTab("screenshot");
                              }}
                              data-testid={`button-screenshot-${session.id}`}
                            >
                              <Camera className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                closeSessionMutation.mutate(session.id);
                              }}
                              disabled={closeSessionMutation.isPending}
                              data-testid={`button-close-session-${session.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {selectedSessionId && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Navigation className="h-4 w-4" />
                  Navigate Session
                  <Badge variant="outline" className="ml-2 text-xs font-mono">{selectedSessionId.slice(0, 8)}...</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    placeholder="https://example.com/page"
                    value={navigateUrl}
                    onChange={(e) => setNavigateUrl(e.target.value)}
                    data-testid="input-navigate-url"
                  />
                  <Button
                    onClick={() => navigateMutation.mutate({ sessionId: selectedSessionId, url: navigateUrl })}
                    disabled={!navigateUrl.trim() || navigateMutation.isPending}
                    data-testid="button-navigate"
                  >
                    {navigateMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Navigation className="h-4 w-4 mr-1" />
                    )}
                    Navigate
                  </Button>
                </div>
                {navigateMutation.isError && (
                  <p className="text-sm text-red-500 mt-2" data-testid="text-navigate-error">
                    {(navigateMutation.error as Error)?.message}
                  </p>
                )}
                {navigateMutation.isSuccess && (
                  <p className="text-sm text-green-500 mt-2" data-testid="text-navigate-success">Navigation successful</p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="screenshot">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Camera className="h-4 w-4" />
                Screenshot Preview
                {selectedSessionId && (
                  <Badge variant="outline" className="ml-2 text-xs font-mono">{selectedSessionId.slice(0, 8)}...</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedSessionId ? (
                <div className="text-center py-12 text-muted-foreground text-sm" data-testid="text-no-session-selected">
                  <Camera className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Select a session from the Sessions tab to view its screenshot</p>
                </div>
              ) : screenshotLoading ? (
                <div className="flex items-center justify-center py-12" data-testid="screenshot-loading">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : screenshotData?.screenshot ? (
                <div className="space-y-3" data-testid="screenshot-preview">
                  <div className="border border-border rounded-lg overflow-hidden">
                    <img
                      src={screenshotData.screenshot.startsWith("data:") ? screenshotData.screenshot : `data:image/png;base64,${screenshotData.screenshot}`}
                      alt="Browser screenshot"
                      className="w-full h-auto"
                      data-testid="img-screenshot"
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Session: {selectedSessionId.slice(0, 12)}...</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/browser/sessions", selectedSessionId, "detail"] })}
                      data-testid="button-refresh-screenshot"
                    >
                      <RefreshCw className="h-3 w-3 mr-1" /> Refresh
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground text-sm" data-testid="text-no-screenshot">
                  <Camera className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No screenshot available for this session</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="actions">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Play className="h-4 w-4" />
                Execute Action
                {selectedSessionId && (
                  <Badge variant="outline" className="ml-2 text-xs font-mono">{selectedSessionId.slice(0, 8)}...</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedSessionId ? (
                <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-select-session-action">
                  <Play className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Select a session from the Sessions tab to execute actions</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Action Type</label>
                      <Select value={actionType} onValueChange={setActionType} data-testid="select-action-type">
                        <SelectTrigger data-testid="select-trigger-action-type">
                          <SelectValue placeholder="Select action" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="click" data-testid="select-item-click">Click</SelectItem>
                          <SelectItem value="type" data-testid="select-item-type">Type</SelectItem>
                          <SelectItem value="scroll" data-testid="select-item-scroll">Scroll</SelectItem>
                          <SelectItem value="hover" data-testid="select-item-hover">Hover</SelectItem>
                          <SelectItem value="screenshot" data-testid="select-item-screenshot">Screenshot</SelectItem>
                          <SelectItem value="wait" data-testid="select-item-wait">Wait</SelectItem>
                          <SelectItem value="evaluate" data-testid="select-item-evaluate">Evaluate JS</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Selector</label>
                      <Input
                        placeholder="#element or .class"
                        value={actionSelector}
                        onChange={(e) => setActionSelector(e.target.value)}
                        data-testid="input-action-selector"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Value</label>
                      <Input
                        placeholder="Value (optional)"
                        value={actionValue}
                        onChange={(e) => setActionValue(e.target.value)}
                        data-testid="input-action-value"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setActionSelector("");
                        setActionValue("");
                      }}
                      data-testid="button-clear-action"
                    >
                      <X className="h-3 w-3 mr-1" /> Clear
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        const action: any = { type: actionType };
                        if (actionSelector) action.selector = actionSelector;
                        if (actionValue) action.value = actionValue;
                        actionMutation.mutate({ sessionId: selectedSessionId, action });
                      }}
                      disabled={actionMutation.isPending}
                      data-testid="button-execute-action"
                    >
                      {actionMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <Play className="h-4 w-4 mr-1" />
                      )}
                      Execute
                    </Button>
                  </div>
                  {actionMutation.isError && (
                    <p className="text-sm text-red-500" data-testid="text-action-error">
                      {(actionMutation.error as Error)?.message}
                    </p>
                  )}
                  {actionMutation.isSuccess && (
                    <div className="p-3 bg-muted/50 rounded-lg" data-testid="text-action-result">
                      <p className="text-xs font-medium mb-1">Action Result:</p>
                      <pre className="text-xs font-mono overflow-auto max-h-32 whitespace-pre-wrap">
                        {JSON.stringify(actionMutation.data, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
