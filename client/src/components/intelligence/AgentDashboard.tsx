// AgentDashboard — real-time monitoring dashboard for active AI agents

import { memo, useCallback, useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  AlertCircle,
  Play,
  Pause,
  X,
  ChevronDown,
  ChevronUp,
  Cpu,
  DollarSign,
  Activity,
  Database,
  List,
} from "lucide-react"

export interface AgentTask {
  id: string
  name: string
  status: "idle" | "planning" | "executing" | "waiting" | "complete" | "failed" | "cancelled"
  model?: string
  currentStep?: string
  steps: Array<{
    id: string
    name: string
    type: string
    status: "pending" | "active" | "complete" | "failed"
    startedAt?: Date
    completedAt?: Date
    tool?: string
    toolInput?: string
    toolOutput?: string
  }>
  progress: number
  tokensUsed: number
  costUsd: number
  budgetUsd?: number
  startedAt?: Date
  completedAt?: Date
  memory?: Array<{ key: string; value: string; importance: number }>
  toolLog?: Array<{ tool: string; input: string; output: string; durationMs: number; timestamp: Date }>
  error?: string
}

export interface AgentDashboardProps {
  agents: AgentTask[]
  onCancel?: (agentId: string) => void
  onPause?: (agentId: string) => void
  onResume?: (agentId: string) => void
  className?: string
}

const STATUS_CONFIG = {
  idle: { label: "Idle", color: "text-white/40", bg: "bg-white/5", border: "border-white/10", dot: "bg-white/30" },
  planning: { label: "Planning", color: "text-blue-300", bg: "bg-blue-500/10", border: "border-blue-500/20", dot: "bg-blue-400" },
  executing: { label: "Executing", color: "text-green-300", bg: "bg-green-500/10", border: "border-green-500/20", dot: "bg-green-400" },
  waiting: { label: "Waiting", color: "text-yellow-300", bg: "bg-yellow-500/10", border: "border-yellow-500/20", dot: "bg-yellow-400" },
  complete: { label: "Complete", color: "text-green-300", bg: "bg-green-500/10", border: "border-green-500/20", dot: "bg-green-500" },
  failed: { label: "Failed", color: "text-red-300", bg: "bg-red-500/10", border: "border-red-500/20", dot: "bg-red-500" },
  cancelled: { label: "Cancelled", color: "text-white/30", bg: "bg-white/5", border: "border-white/10", dot: "bg-white/20" },
} as const

function formatDuration(start?: Date, end?: Date): string {
  if (!start) return "—"
  const ms = (end ?? new Date()).getTime() - start.getTime()
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(2)}¢`
  return `$${usd.toFixed(4)}`
}

function getBudgetColor(used: number, budget: number): string {
  const pct = used / budget
  if (pct < 0.5) return "bg-green-500"
  if (pct < 0.8) return "bg-yellow-500"
  return "bg-red-500"
}

interface StatusBadgeProps {
  status: AgentTask["status"]
}

const StatusBadge = memo(({ status }: StatusBadgeProps) => {
  const cfg = STATUS_CONFIG[status]
  const isPulsing = status === "planning" || status === "executing"

  return (
    <div className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5", cfg.bg, cfg.border)}>
      <div className="relative h-1.5 w-1.5">
        <div className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
        {isPulsing && (
          <motion.div
            className={cn("absolute inset-0 rounded-full", cfg.dot)}
            animate={{ scale: [1, 2, 1], opacity: [0.8, 0, 0.8] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
        )}
      </div>
      <span className={cn("text-xs font-medium", cfg.color)}>{cfg.label}</span>
    </div>
  )
})
StatusBadge.displayName = "StatusBadge"

interface MiniTimelineProps {
  steps: AgentTask["steps"]
}

const MiniTimeline = memo(({ steps }: MiniTimelineProps) => {
  if (!steps.length) return null

  return (
    <div className="flex items-center gap-1">
      {steps.map((step, idx) => {
        const isLast = idx === steps.length - 1
        const dotColor = step.status === "complete" ? "bg-green-500"
          : step.status === "failed" ? "bg-red-500"
          : step.status === "active" ? "bg-blue-400"
          : "bg-white/15"

        return (
          <div key={step.id} className="flex items-center gap-1">
            <div
              className={cn("relative h-2 w-2 rounded-full", dotColor)}
              title={step.name}
            >
              {step.status === "active" && (
                <motion.div
                  className="absolute inset-0 rounded-full bg-blue-400"
                  animate={{ scale: [1, 1.8, 1], opacity: [0.8, 0, 0.8] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              )}
            </div>
            {!isLast && <div className="h-px w-3 bg-white/10" />}
          </div>
        )
      })}
    </div>
  )
})
MiniTimeline.displayName = "MiniTimeline"

interface ToolLogEntryProps {
  entry: NonNullable<AgentTask["toolLog"]>[number]
}

const ToolLogEntry = memo(({ entry }: ToolLogEntryProps) => {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded border border-white/5 bg-white/2">
      <button
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <Zap className="h-3 w-3 text-yellow-400 shrink-0" />
        <span className="flex-1 text-xs font-medium text-white/80 truncate">{entry.tool}</span>
        <span className="text-xs text-white/30 shrink-0">{entry.durationMs}ms</span>
        {expanded ? <ChevronUp className="h-3 w-3 text-white/25" /> : <ChevronDown className="h-3 w-3 text-white/25" />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/5 px-2.5 py-2 space-y-1.5">
              <div>
                <span className="text-[10px] text-white/30 uppercase tracking-wide">Input</span>
                <pre className="mt-0.5 text-[10px] text-white/55 font-mono whitespace-pre-wrap break-all max-h-16 overflow-y-auto">{entry.input}</pre>
              </div>
              <div>
                <span className="text-[10px] text-white/30 uppercase tracking-wide">Output</span>
                <pre className="mt-0.5 text-[10px] text-green-300/60 font-mono whitespace-pre-wrap break-all max-h-16 overflow-y-auto">{entry.output}</pre>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
ToolLogEntry.displayName = "ToolLogEntry"

interface AgentCardProps {
  agent: AgentTask
  onCancel?: (id: string) => void
  onPause?: (id: string) => void
  onResume?: (id: string) => void
}

const AgentCard = memo(({ agent, onCancel, onPause, onResume }: AgentCardProps) => {
  const [section, setSection] = useState<"steps" | "tools" | "memory" | null>("steps")

  const isActive = agent.status === "executing" || agent.status === "planning"
  const canPause = isActive && onPause
  const canResume = agent.status === "waiting" && onResume
  const canCancel = (isActive || agent.status === "waiting") && onCancel

  const budgetPct = agent.budgetUsd ? (agent.costUsd / agent.budgetUsd) * 100 : null
  const budgetColor = agent.budgetUsd ? getBudgetColor(agent.costUsd, agent.budgetUsd) : "bg-blue-500"

  const toggleSection = useCallback((s: typeof section) => {
    setSection((cur) => (cur === s ? null : s))
  }, [])

  return (
    <Card className="bg-zinc-900/80 border-white/8 overflow-hidden">
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm font-semibold text-white/90 truncate">{agent.name}</CardTitle>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StatusBadge status={agent.status} />
              {agent.model && (
                <Badge variant="outline" className="border-white/10 text-white/35 text-[10px] h-4 px-1.5">
                  <Cpu className="mr-1 h-2.5 w-2.5" />
                  {agent.model}
                </Badge>
              )}
              <span className="text-xs text-white/30">
                <Clock className="mr-0.5 h-2.5 w-2.5 inline" />
                {formatDuration(agent.startedAt, agent.completedAt)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {canPause && (
              <Button size="sm" variant="ghost" onClick={() => onPause!(agent.id)}
                className="h-6 w-6 p-0 text-yellow-400 hover:bg-yellow-500/15">
                <Pause className="h-3.5 w-3.5" />
              </Button>
            )}
            {canResume && (
              <Button size="sm" variant="ghost" onClick={() => onResume!(agent.id)}
                className="h-6 w-6 p-0 text-green-400 hover:bg-green-500/15">
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
            {canCancel && (
              <Button size="sm" variant="ghost" onClick={() => onCancel!(agent.id)}
                className="h-6 w-6 p-0 text-red-400 hover:bg-red-500/15">
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-3 pb-3 space-y-2.5">
        {agent.currentStep && (
          <p className="text-xs text-white/50 truncate">
            <Activity className="inline mr-1 h-3 w-3 text-blue-400" />
            {agent.currentStep}
          </p>
        )}

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-white/40">
            <span>Progress</span>
            <span>{agent.progress}%</span>
          </div>
          <div className="relative h-1.5 rounded-full bg-white/8 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500"
              initial={{ width: 0 }}
              animate={{ width: `${agent.progress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          {agent.steps.length > 0 && <MiniTimeline steps={agent.steps} />}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-xs text-white/40">
            <DollarSign className="h-3 w-3" />
            {agent.budgetUsd ? (
              <span>
                {formatCost(agent.costUsd)}
                <span className="text-white/25"> / {formatCost(agent.budgetUsd)}</span>
              </span>
            ) : (
              <span>{formatCost(agent.costUsd)}</span>
            )}
          </div>
          {agent.budgetUsd && (
            <div className="flex-1 h-1 rounded-full bg-white/8 overflow-hidden">
              <motion.div
                className={cn("h-full rounded-full", budgetColor)}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(budgetPct ?? 0, 100)}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
          )}
          <span className="text-xs text-white/25">{(agent.tokensUsed / 1000).toFixed(1)}k tok</span>
        </div>

        {agent.error && (
          <div className="rounded bg-red-500/10 border border-red-500/20 px-2.5 py-1.5 flex gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">{agent.error}</p>
          </div>
        )}

        <div className="flex gap-1 border-t border-white/5 pt-2">
          {[
            { key: "steps" as const, icon: List, label: "Steps", count: agent.steps.length },
            { key: "tools" as const, icon: Zap, label: "Tools", count: agent.toolLog?.length ?? 0 },
            { key: "memory" as const, icon: Database, label: "Memory", count: agent.memory?.length ?? 0 },
          ].map(({ key, icon: Icon, label, count }) => (
            <button
              key={key}
              onClick={() => toggleSection(key)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1 rounded py-1 text-xs transition-colors",
                section === key ? "bg-white/8 text-white/70" : "text-white/30 hover:text-white/55"
              )}
            >
              <Icon className="h-3 w-3" />
              {label}
              {count > 0 && <span className="text-white/25">({count})</span>}
            </button>
          ))}
        </div>

        <AnimatePresence>
          {section === "steps" && agent.steps.length > 0 && (
            <motion.div
              key="steps"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="space-y-1">
                {agent.steps.map((step) => {
                  const statusColor = step.status === "complete" ? "text-green-400"
                    : step.status === "failed" ? "text-red-400"
                    : step.status === "active" ? "text-blue-400"
                    : "text-white/25"
                  const StatusIcon = step.status === "complete" ? CheckCircle2
                    : step.status === "failed" ? XCircle
                    : step.status === "active" ? Activity
                    : Clock

                  return (
                    <div key={step.id} className="flex items-center gap-2 text-xs">
                      <StatusIcon className={cn("h-3 w-3 shrink-0", statusColor)} />
                      <span className={cn("flex-1 truncate", step.status === "active" ? "text-white/80" : "text-white/45")}>
                        {step.name}
                      </span>
                      {step.startedAt && (
                        <span className="text-white/25 shrink-0">
                          {formatDuration(step.startedAt, step.completedAt)}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )}

          {section === "tools" && (
            <motion.div
              key="tools"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              {agent.toolLog && agent.toolLog.length > 0 ? (
                <div className="space-y-1">
                  {agent.toolLog.map((entry, idx) => (
                    <ToolLogEntry key={idx} entry={entry} />
                  ))}
                </div>
              ) : (
                <p className="text-center text-xs text-white/25 py-3">No tool calls yet</p>
              )}
            </motion.div>
          )}

          {section === "memory" && (
            <motion.div
              key="memory"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              {agent.memory && agent.memory.length > 0 ? (
                <div className="space-y-1.5">
                  {agent.memory.map((mem) => (
                    <div key={mem.key} className="space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium text-white/50 uppercase tracking-wide truncate">{mem.key}</span>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          <div className="w-10 h-1 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full bg-purple-400/60 rounded-full" style={{ width: `${mem.importance * 100}%` }} />
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-white/60 truncate">{mem.value}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-xs text-white/25 py-3">No memories stored</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  )
})
AgentCard.displayName = "AgentCard"

const EmptyState = memo(() => (
  <div className="flex flex-col items-center gap-3 py-12 text-white/25">
    <motion.div
      animate={{ y: [0, -4, 0] }}
      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
    >
      <Cpu className="h-10 w-10" />
    </motion.div>
    <div className="text-center">
      <p className="text-sm font-medium text-white/40">No active agents</p>
      <p className="text-xs mt-1 text-white/25">Agents will appear here when running</p>
    </div>
  </div>
))
EmptyState.displayName = "EmptyState"

export const AgentDashboard = memo(({
  agents,
  onCancel,
  onPause,
  onResume,
  className,
}: AgentDashboardProps) => {
  const activeAgents = useMemo(() =>
    agents.filter((a) => ["planning", "executing", "waiting", "idle"].includes(a.status)),
    [agents]
  )
  const completedAgents = useMemo(() =>
    agents.filter((a) => ["complete", "failed", "cancelled"].includes(a.status)),
    [agents]
  )

  const renderAgentList = useCallback((list: AgentTask[]) => {
    if (!list.length) return <EmptyState />
    return (
      <ScrollArea className="h-full">
        <div className="space-y-2 pr-1">
          <AnimatePresence initial={false}>
            {list.map((agent) => (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12, scale: 0.97 }}
                transition={{ duration: 0.25 }}
              >
                <AgentCard agent={agent} onCancel={onCancel} onPause={onPause} onResume={onResume} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </ScrollArea>
    )
  }, [onCancel, onPause, onResume])

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2 px-1">
        <Cpu className="h-4 w-4 text-purple-400" />
        <span className="text-sm font-semibold text-white/80">Agent Dashboard</span>
        {activeAgents.length > 0 && (
          <motion.div
            className="h-1.5 w-1.5 rounded-full bg-green-400"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
        )}
      </div>

      <Tabs defaultValue="active" className="flex-1">
        <TabsList className="w-full h-7 bg-white/5 p-0.5">
          <TabsTrigger value="active" className="flex-1 h-6 text-xs">
            Active
            {activeAgents.length > 0 && (
              <Badge className="ml-1 h-4 w-4 p-0 flex items-center justify-center bg-blue-500/30 text-blue-300 text-[10px]">
                {activeAgents.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="completed" className="flex-1 h-6 text-xs">
            Done
            {completedAgents.length > 0 && (
              <span className="ml-1 text-white/30">({completedAgents.length})</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="all" className="flex-1 h-6 text-xs">
            All
            <span className="ml-1 text-white/30">({agents.length})</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="mt-2 h-full">
          {renderAgentList(activeAgents)}
        </TabsContent>
        <TabsContent value="completed" className="mt-2">
          {renderAgentList(completedAgents)}
        </TabsContent>
        <TabsContent value="all" className="mt-2">
          {renderAgentList(agents)}
        </TabsContent>
      </Tabs>
    </div>
  )
})
AgentDashboard.displayName = "AgentDashboard"

export default AgentDashboard
