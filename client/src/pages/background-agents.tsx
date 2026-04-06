import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  useTriggers,
  useExecutions,
  useTriggerTemplates,
  useCreateTrigger,
  useToggleTrigger,
  useDeleteTrigger,
  useRunTrigger,
  type Trigger,
} from "@/hooks/use-background-agents";
import {
  Bot,
  Play,
  Pause,
  Trash2,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  Zap,
  ArrowLeft,
  RefreshCw,
  Calendar,
  Mail,
  FileText,
  Brain,
} from "lucide-react";
import { useLocation } from "wouter";

const KIND_LABELS: Record<string, string> = {
  cron: "Scheduled",
  webhook: "Webhook",
  one_shot: "One-time",
  file_watch: "File Watch",
  email: "Email",
  calendar: "Calendar",
  system_event: "System Event",
};

const KIND_ICONS: Record<string, React.ReactNode> = {
  cron: <Clock className="h-4 w-4" />,
  webhook: <Zap className="h-4 w-4" />,
  one_shot: <Play className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  calendar: <Calendar className="h-4 w-4" />,
};

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  "Daily Summary": <FileText className="h-5 w-5 text-blue-500" />,
  "Meeting Preparation": <Calendar className="h-5 w-5 text-green-500" />,
  "Email Monitor": <Mail className="h-5 w-5 text-amber-500" />,
  "Weekly Knowledge Review": <Brain className="h-5 w-5 text-purple-500" />,
};

function BackgroundAgentsPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("agents");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newTrigger, setNewTrigger] = useState({
    name: "",
    description: "",
    kind: "cron",
    cronExpression: "0 9 * * *",
    prompt: "",
  });

  const { data: triggersData, isLoading: loadingTriggers } = useTriggers();
  const { data: executionsData, isLoading: loadingExecutions } = useExecutions();
  const { data: templatesData } = useTriggerTemplates();
  const createTrigger = useCreateTrigger();
  const toggleTrigger = useToggleTrigger();
  const deleteTrigger = useDeleteTrigger();
  const runTrigger = useRunTrigger();

  const triggers = triggersData?.triggers ?? [];
  const executions = executionsData?.executions ?? [];
  const templates = templatesData?.templates ?? [];

  const handleCreate = async () => {
    if (!newTrigger.name || !newTrigger.prompt) return;

    await createTrigger.mutateAsync({
      name: newTrigger.name,
      description: newTrigger.description,
      kind: newTrigger.kind,
      config: {
        kind: newTrigger.kind,
        cron: newTrigger.kind === "cron" ? newTrigger.cronExpression : undefined,
      },
      action: { kind: "agent_chat", prompt: newTrigger.prompt },
    });

    setShowCreateDialog(false);
    setNewTrigger({ name: "", description: "", kind: "cron", cronExpression: "0 9 * * *", prompt: "" });
  };

  const handleUseTemplate = (template: any) => {
    setNewTrigger({
      name: template.name,
      description: template.description,
      kind: template.kind,
      cronExpression: template.config?.cron ?? "0 9 * * *",
      prompt: template.action?.prompt ?? "",
    });
    setShowCreateDialog(true);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Bot className="h-6 w-6 text-primary" />
              <div>
                <h1 className="text-xl font-semibold">Background Agents</h1>
                <p className="text-sm text-muted-foreground">
                  Autonomous agents that run on schedules or triggers
                </p>
              </div>
            </div>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Agent
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="agents">
              Active Agents ({triggers.length})
            </TabsTrigger>
            <TabsTrigger value="history">
              Execution History
            </TabsTrigger>
            <TabsTrigger value="templates">
              Templates
            </TabsTrigger>
          </TabsList>

          {/* Active Agents Tab */}
          <TabsContent value="agents">
            {loadingTriggers ? (
              <div className="flex justify-center py-12">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : triggers.length === 0 ? (
              <div className="text-center py-16">
                <Bot className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
                <h2 className="text-xl font-semibold mb-2">No Background Agents Yet</h2>
                <p className="text-muted-foreground text-sm mb-4">
                  Create agents that run automatically on schedules or in response to events.
                </p>
                <Button onClick={() => setActiveTab("templates")}>
                  Browse Templates
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {triggers.map((trigger) => (
                  <TriggerCard
                    key={trigger.id}
                    trigger={trigger}
                    onToggle={(active) => toggleTrigger.mutate({ id: trigger.id, active })}
                    onDelete={() => deleteTrigger.mutate(trigger.id)}
                    onRun={() => runTrigger.mutate(trigger.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Execution History Tab */}
          <TabsContent value="history">
            {loadingExecutions ? (
              <div className="flex justify-center py-12">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : executions.length === 0 ? (
              <div className="text-center py-16">
                <Clock className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
                <h2 className="text-xl font-semibold mb-2">No Executions Yet</h2>
                <p className="text-muted-foreground text-sm">
                  When your agents run, their execution history will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_120px_100px_80px_100px] gap-4 px-4 py-2 text-xs text-muted-foreground font-medium border-b">
                  <span>Trigger</span>
                  <span>Fired At</span>
                  <span>Status</span>
                  <span>Duration</span>
                  <span>Action</span>
                </div>
                {executions.map((exec) => (
                  <div
                    key={exec.id}
                    className="grid grid-cols-[1fr_120px_100px_80px_100px] gap-4 px-4 py-3 rounded-lg bg-card border text-sm items-center"
                  >
                    <span className="font-medium truncate">{exec.triggerName || exec.triggerId}</span>
                    <span className="text-muted-foreground text-xs">
                      {exec.firedAt ? new Date(exec.firedAt).toLocaleString() : "-"}
                    </span>
                    <Badge
                      variant={exec.status === "success" ? "default" : "destructive"}
                      className="text-xs w-fit"
                    >
                      {exec.status === "success" ? (
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                      ) : (
                        <XCircle className="h-3 w-3 mr-1" />
                      )}
                      {exec.status}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {exec.durationMs ? `${exec.durationMs}ms` : "-"}
                    </span>
                    <span className="text-xs text-muted-foreground">{exec.actionKind}</span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Templates Tab */}
          <TabsContent value="templates">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templates.map((template) => (
                <Card key={template.name} className="hover:border-primary/50 transition-colors">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-3">
                      {TEMPLATE_ICONS[template.name] || <Bot className="h-5 w-5 text-primary" />}
                      <div>
                        <CardTitle className="text-base">{template.name}</CardTitle>
                        <CardDescription className="text-xs">{template.description}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div className="flex gap-2">
                        <Badge variant="outline" className="text-xs">
                          {KIND_LABELS[template.kind] || template.kind}
                        </Badge>
                        {template.config?.cron && (
                          <Badge variant="secondary" className="text-xs font-mono">
                            {template.config.cron as string}
                          </Badge>
                        )}
                      </div>
                      <Button size="sm" onClick={() => handleUseTemplate(template)}>
                        Use Template
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Background Agent</DialogTitle>
            <DialogDescription>
              Set up an autonomous agent that runs on a schedule or trigger.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Name</label>
              <Input
                placeholder="My Agent"
                value={newTrigger.name}
                onChange={(e) => setNewTrigger({ ...newTrigger, name: e.target.value })}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Description</label>
              <Input
                placeholder="What does this agent do?"
                value={newTrigger.description}
                onChange={(e) => setNewTrigger({ ...newTrigger, description: e.target.value })}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Type</label>
              <Select value={newTrigger.kind} onValueChange={(v) => setNewTrigger({ ...newTrigger, kind: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cron">Scheduled (Cron)</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="one_shot">One-time</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {newTrigger.kind === "cron" && (
              <div>
                <label className="text-sm font-medium mb-1 block">Cron Expression</label>
                <Input
                  placeholder="0 9 * * *"
                  value={newTrigger.cronExpression}
                  onChange={(e) => setNewTrigger({ ...newTrigger, cronExpression: e.target.value })}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Examples: <code>0 9 * * *</code> (daily 9am), <code>0 */4 * * *</code> (every 4h),
                  <code> 0 10 * * 1</code> (Mon 10am)
                </p>
              </div>
            )}

            <div>
              <label className="text-sm font-medium mb-1 block">Agent Prompt</label>
              <textarea
                placeholder="What should the agent do when triggered?"
                value={newTrigger.prompt}
                onChange={(e) => setNewTrigger({ ...newTrigger, prompt: e.target.value })}
                className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!newTrigger.name || !newTrigger.prompt || createTrigger.isPending}
              >
                {createTrigger.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TriggerCard({
  trigger,
  onToggle,
  onDelete,
  onRun,
}: {
  trigger: Trigger;
  onToggle: (active: boolean) => void;
  onDelete: () => void;
  onRun: () => void;
}) {
  return (
    <Card className={`transition-colors ${trigger.isActive ? "" : "opacity-60"}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {KIND_ICONS[trigger.kind] || <Bot className="h-4 w-4" />}
            <CardTitle className="text-sm">{trigger.name}</CardTitle>
          </div>
          <Badge variant={trigger.isActive ? "default" : "secondary"} className="text-xs">
            {trigger.isActive ? "Active" : "Paused"}
          </Badge>
        </div>
        {trigger.description && (
          <CardDescription className="text-xs line-clamp-2">{trigger.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {trigger.lastRunAt
              ? `Last run: ${new Date(trigger.lastRunAt).toLocaleString()}`
              : "Never run"}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3 w-3" />
            {trigger.runCount} runs, {trigger.errorCount} errors
          </div>
          <div className="flex gap-1.5 pt-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onToggle(!trigger.isActive)}
            >
              {trigger.isActive ? <Pause className="h-3 w-3 mr-1" /> : <Play className="h-3 w-3 mr-1" />}
              {trigger.isActive ? "Pause" : "Resume"}
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onRun}>
              <Play className="h-3 w-3 mr-1" />
              Run Now
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs ml-auto" onClick={onDelete}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default BackgroundAgentsPage;
