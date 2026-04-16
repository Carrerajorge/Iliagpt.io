import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useMCPServers,
  useMCPTools,
  useMCPStats,
  useConnectMCPServer,
  useDisconnectMCPServer,
  useTestMCPTool,
  type MCPServer,
  type MCPTool,
} from "@/hooks/use-mcp-manager";
import {
  Plug,
  Plus,
  Trash2,
  Play,
  Server,
  Wrench,
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Wifi,
  WifiOff,
  Code,
} from "lucide-react";
import { useLocation } from "wouter";

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  connected: { color: "text-green-500", icon: <Wifi className="h-3 w-3" />, label: "Connected" },
  disconnected: { color: "text-red-500", icon: <WifiOff className="h-3 w-3" />, label: "Disconnected" },
  error: { color: "text-red-500", icon: <XCircle className="h-3 w-3" />, label: "Error" },
  discovering: { color: "text-amber-500", icon: <RefreshCw className="h-3 w-3 animate-spin" />, label: "Discovering" },
  discovered: { color: "text-blue-500", icon: <CheckCircle2 className="h-3 w-3" />, label: "Discovered" },
};

function MCPManagerPage() {
  const [, setLocation] = useLocation();
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showTestDialog, setShowTestDialog] = useState<MCPTool | null>(null);
  const [testParams, setTestParams] = useState("{}");
  const [newServer, setNewServer] = useState({
    name: "",
    transport: "sse",
    url: "",
    command: "",
    args: "",
  });

  const { data: serversData, isLoading: loadingServers } = useMCPServers();
  const { data: toolsData, isLoading: loadingTools } = useMCPTools(selectedServerId ?? undefined);
  const { data: stats } = useMCPStats();
  const connectServer = useConnectMCPServer();
  const disconnectServer = useDisconnectMCPServer();
  const testTool = useTestMCPTool();

  const servers = serversData?.servers ?? [];
  const tools = toolsData?.tools ?? [];

  const handleConnect = async () => {
    if (!newServer.name) return;

    await connectServer.mutateAsync({
      name: newServer.name,
      transport: newServer.transport,
      url: newServer.transport === "sse" ? newServer.url : undefined,
      command: newServer.transport === "stdio" ? newServer.command : undefined,
      args: newServer.transport === "stdio" && newServer.args
        ? newServer.args.split(" ").filter(Boolean)
        : undefined,
    });

    setShowAddDialog(false);
    setNewServer({ name: "", transport: "sse", url: "", command: "", args: "" });
  };

  const handleTestTool = async () => {
    if (!showTestDialog) return;
    try {
      const params = JSON.parse(testParams);
      await testTool.mutateAsync({ toolId: showTestDialog.id, params });
    } catch { /* JSON parse error handled by UI */ }
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Left Panel - Servers */}
      <div className="w-80 border-r border-border flex flex-col bg-card">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2 mb-3">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Plug className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">MCP Manager</h1>
          </div>
          <Button className="w-full" size="sm" onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Server
          </Button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="p-3 border-b border-border">
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-muted/50 rounded-lg p-2 text-center">
                <p className="text-lg font-bold">{stats.totalServers}</p>
                <p className="text-[10px] text-muted-foreground">Servers</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-2 text-center">
                <p className="text-lg font-bold">{stats.totalTools}</p>
                <p className="text-[10px] text-muted-foreground">Tools</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-2 text-center">
                <p className="text-lg font-bold">{stats.activeTools}</p>
                <p className="text-[10px] text-muted-foreground">Active</p>
              </div>
            </div>
          </div>
        )}

        {/* Server List */}
        <div className="flex-1 overflow-y-auto">
          {loadingServers ? (
            <div className="flex justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : servers.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Server className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No MCP servers connected</p>
              <p className="text-xs text-muted-foreground mt-1">
                Add a server to start discovering tools
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {servers.map((server) => {
                const statusConfig = STATUS_CONFIG[server.status] || STATUS_CONFIG.disconnected;
                return (
                  <button
                    key={server.id}
                    className={`w-full text-left p-3 rounded-lg transition-colors text-sm ${
                      selectedServerId === server.id
                        ? "bg-primary/10 border border-primary/30"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => setSelectedServerId(server.id)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium truncate">{server.name}</span>
                      <span className={`flex items-center gap-1 text-xs ${statusConfig.color}`}>
                        {statusConfig.icon}
                        {statusConfig.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px] h-4">
                        {server.transport}
                      </Badge>
                      <span>{server.toolCount} tools</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Tools */}
      <div className="flex-1 flex flex-col">
        {/* Tools Header */}
        <div className="p-4 border-b border-border bg-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">
                {selectedServerId
                  ? `Tools - ${servers.find((s) => s.id === selectedServerId)?.name ?? "Server"}`
                  : "All Tools"}
              </h2>
              <Badge variant="secondary" className="text-xs">
                {tools.length} tools
              </Badge>
            </div>
            {selectedServerId && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  disconnectServer.mutate(selectedServerId);
                  setSelectedServerId(null);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Disconnect
              </Button>
            )}
          </div>
        </div>

        {/* Tools List */}
        <div className="flex-1 overflow-y-auto p-4">
          {loadingTools ? (
            <div className="flex justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : tools.length === 0 ? (
            <div className="text-center py-16">
              <Wrench className="h-16 w-16 text-muted-foreground/20 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">
                {selectedServerId ? "No Tools Found" : "Select a Server"}
              </h2>
              <p className="text-muted-foreground text-sm">
                {selectedServerId
                  ? "This server hasn't registered any tools yet."
                  : "Select a server from the left panel to view its tools."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {tools.map((tool) => (
                <Card key={tool.id} className="hover:border-primary/30 transition-colors">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-sm font-mono">{tool.name}</CardTitle>
                        {tool.serverName && (
                          <p className="text-xs text-muted-foreground">{tool.serverName}</p>
                        )}
                      </div>
                      <Badge
                        variant={tool.status === "active" ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {tool.status}
                      </Badge>
                    </div>
                    {tool.description && (
                      <CardDescription className="text-xs line-clamp-2">
                        {tool.description}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        {tool.usageCount > 0 && <span>{tool.usageCount} uses</span>}
                        {tool.reliabilityScore != null && (
                          <span>{(tool.reliabilityScore * 100).toFixed(0)}% reliable</span>
                        )}
                        {tool.avgLatencyMs != null && <span>{tool.avgLatencyMs.toFixed(0)}ms avg</span>}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setShowTestDialog(tool);
                          setTestParams("{}");
                        }}
                      >
                        <Play className="h-3 w-3 mr-1" />
                        Test
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add Server Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Connect MCP Server</DialogTitle>
            <DialogDescription>
              Add an external MCP server to discover and use its tools.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Server Name</label>
              <Input
                placeholder="My MCP Server"
                value={newServer.name}
                onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Transport</label>
              <Select
                value={newServer.transport}
                onValueChange={(v) => setNewServer({ ...newServer, transport: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sse">HTTP/SSE (Remote)</SelectItem>
                  <SelectItem value="stdio">Stdio (Local Process)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {newServer.transport === "sse" ? (
              <div>
                <label className="text-sm font-medium mb-1 block">Server URL</label>
                <Input
                  placeholder="http://localhost:3001/mcp"
                  value={newServer.url}
                  onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="text-sm font-medium mb-1 block">Command</label>
                  <Input
                    placeholder="npx"
                    value={newServer.command}
                    onChange={(e) => setNewServer({ ...newServer, command: e.target.value })}
                    className="font-mono"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Arguments</label>
                  <Input
                    placeholder="-y @modelcontextprotocol/server-filesystem /path"
                    value={newServer.args}
                    onChange={(e) => setNewServer({ ...newServer, args: e.target.value })}
                    className="font-mono"
                  />
                </div>
              </>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleConnect}
                disabled={!newServer.name || connectServer.isPending}
              >
                {connectServer.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plug className="h-4 w-4 mr-2" />
                )}
                Connect
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Test Tool Dialog */}
      <Dialog open={!!showTestDialog} onOpenChange={() => setShowTestDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">Test: {showTestDialog?.name}</DialogTitle>
            <DialogDescription>{showTestDialog?.description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {showTestDialog?.inputSchema && (
              <div>
                <label className="text-sm font-medium mb-1 block">Input Schema</label>
                <pre className="bg-muted rounded-md p-3 text-xs overflow-auto max-h-32 font-mono">
                  {JSON.stringify(showTestDialog.inputSchema, null, 2)}
                </pre>
              </div>
            )}

            <div>
              <label className="text-sm font-medium mb-1 block">Parameters (JSON)</label>
              <textarea
                value={testParams}
                onChange={(e) => setTestParams(e.target.value)}
                className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y"
                placeholder='{"key": "value"}'
              />
            </div>

            {testTool.data && (
              <div>
                <label className="text-sm font-medium mb-1 block">Result</label>
                <pre className="bg-muted rounded-md p-3 text-xs overflow-auto max-h-48 font-mono">
                  {JSON.stringify(testTool.data, null, 2)}
                </pre>
              </div>
            )}

            {testTool.error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                {testTool.error instanceof Error ? testTool.error.message : "Test failed"}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowTestDialog(null)}>
                Close
              </Button>
              <Button onClick={handleTestTool} disabled={testTool.isPending}>
                {testTool.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Run Test
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default MCPManagerPage;
