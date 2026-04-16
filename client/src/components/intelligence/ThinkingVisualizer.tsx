// ThinkingVisualizer — animated real-time AI reasoning process display

import { memo, useCallback, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Brain,
  Globe,
  Database,
  Code,
  Lightbulb,
  Zap,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Play,
  Pause,
  AlertCircle,
  MessageSquare,
} from "lucide-react"

export interface ThinkingStep {
  id: string
  type: "reasoning" | "tool_call" | "source_lookup" | "memory_access" | "code_exec" | "synthesis"
  label: string
  description?: string
  status: "pending" | "active" | "complete" | "failed"
  startedAt?: number
  completedAt?: number
  confidence?: number
  data?: {
    tool?: string
    input?: string
    output?: string
    url?: string
    query?: string
    result?: string
  }
  children?: ThinkingStep[]
}

export interface ThinkingVisualizerProps {
  steps: ThinkingStep[]
  isActive: boolean
  onPause?: () => void
  onResume?: () => void
  onRedirect?: (stepId: string, instruction: string) => void
  className?: string
  variant?: "compact" | "full" | "timeline"
}

const STEP_CONFIGS = {
  reasoning: { icon: Brain, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/30", label: "Reasoning" },
  tool_call: { icon: Zap, color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30", label: "Tool Call" },
  source_lookup: { icon: Globe, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30", label: "Source Lookup" },
  memory_access: { icon: Database, color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/30", label: "Memory" },
  code_exec: { icon: Code, color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30", label: "Code Exec" },
  synthesis: { icon: Lightbulb, color: "text-pink-400", bg: "bg-pink-500/10", border: "border-pink-500/30", label: "Synthesis" },
} as const

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return "bg-green-500"
  if (confidence >= 0.5) return "bg-yellow-500"
  return "bg-red-500"
}

function formatDuration(startedAt: number, completedAt?: number): string {
  const end = completedAt ?? Date.now()
  const ms = end - startedAt
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

interface StepIconProps {
  type: ThinkingStep["type"]
  status: ThinkingStep["status"]
  size?: "sm" | "md"
}

const StepIcon = memo(({ type, status, size = "md" }: StepIconProps) => {
  const config = STEP_CONFIGS[type]
  const Icon = config.icon
  const iconSize = size === "sm" ? "h-3 w-3" : "h-4 w-4"

  if (status === "complete") return <CheckCircle2 className={cn(iconSize, "text-green-400")} />
  if (status === "failed") return <XCircle className={cn(iconSize, "text-red-400")} />
  if (status === "active") {
    return (
      <motion.div
        animate={{ scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
      >
        <Icon className={cn(iconSize, config.color)} />
      </motion.div>
    )
  }
  return <Icon className={cn(iconSize, config.color, status === "pending" ? "opacity-40" : "")} />
})
StepIcon.displayName = "StepIcon"

interface RedirectInputProps {
  stepId: string
  onRedirect: (stepId: string, instruction: string) => void
  onClose: () => void
}

const RedirectInput = memo(({ stepId, onRedirect, onClose }: RedirectInputProps) => {
  const [value, setValue] = useState("")

  const handleSubmit = useCallback(() => {
    if (value.trim()) {
      onRedirect(stepId, value.trim())
      setValue("")
      onClose()
    }
  }, [value, stepId, onRedirect, onClose])

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="mt-2 flex gap-2"
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        placeholder="Redirect thinking..."
        className="flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
      />
      <Button size="sm" variant="ghost" onClick={handleSubmit} className="h-6 px-2 text-xs text-purple-400 hover:text-purple-300">
        Send
      </Button>
      <Button size="sm" variant="ghost" onClick={onClose} className="h-6 px-2 text-xs">
        ✕
      </Button>
    </motion.div>
  )
})
RedirectInput.displayName = "RedirectInput"

interface FullStepCardProps {
  step: ThinkingStep
  depth?: number
  onRedirect?: (stepId: string, instruction: string) => void
}

const FullStepCard = memo(({ step, depth = 0, onRedirect }: FullStepCardProps) => {
  const [expanded, setExpanded] = useState(step.status === "active")
  const [showRedirect, setShowRedirect] = useState(false)
  const config = STEP_CONFIGS[step.type]

  const hasData = step.data && Object.values(step.data).some(Boolean)

  const handleRedirectClose = useCallback(() => setShowRedirect(false), [])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ duration: 0.2 }}
      className={cn("rounded-lg border", config.border, config.bg, depth > 0 ? "ml-4" : "")}
    >
      <div
        className="flex cursor-pointer items-center gap-2 px-3 py-2"
        onClick={() => (hasData || step.children?.length) && setExpanded((v) => !v)}
      >
        <StepIcon type={step.type} status={step.status} />
        <span className="flex-1 text-sm font-medium text-white/90">{step.label}</span>

        {step.confidence !== undefined && (
          <div className="flex items-center gap-1">
            <div className={cn("h-2 w-2 rounded-full", getConfidenceColor(step.confidence))} />
            <span className="text-xs text-white/50">{Math.round(step.confidence * 100)}%</span>
          </div>
        )}

        {step.startedAt && (
          <Badge variant="outline" className="border-white/10 text-white/40 text-xs">
            <Clock className="mr-1 h-2.5 w-2.5" />
            {formatDuration(step.startedAt, step.completedAt)}
          </Badge>
        )}

        {step.status === "active" && onRedirect && (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => { e.stopPropagation(); setShowRedirect((v) => !v) }}
            className="h-6 px-2 text-xs text-purple-300 hover:bg-purple-500/20"
          >
            <MessageSquare className="mr-1 h-3 w-3" />
            Redirect
          </Button>
        )}

        {(hasData || step.children?.length) ? (
          expanded ? <ChevronUp className="h-3.5 w-3.5 text-white/30" /> : <ChevronDown className="h-3.5 w-3.5 text-white/30" />
        ) : null}
      </div>

      {step.description && (
        <p className="px-3 pb-1 text-xs text-white/50">{step.description}</p>
      )}

      <AnimatePresence>
        {showRedirect && onRedirect && (
          <div className="px-3 pb-2">
            <RedirectInput stepId={step.id} onRedirect={onRedirect} onClose={handleRedirectClose} />
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {expanded && hasData && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/5 px-3 py-2 space-y-1">
              {step.data?.tool && (
                <div className="flex gap-2 text-xs">
                  <span className="text-white/30 w-12 shrink-0">Tool</span>
                  <code className="text-yellow-300/80">{step.data.tool}</code>
                </div>
              )}
              {step.data?.query && (
                <div className="flex gap-2 text-xs">
                  <span className="text-white/30 w-12 shrink-0">Query</span>
                  <span className="text-white/70">{step.data.query}</span>
                </div>
              )}
              {step.data?.url && (
                <div className="flex gap-2 text-xs">
                  <span className="text-white/30 w-12 shrink-0">URL</span>
                  <a href={step.data.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline truncate">
                    {step.data.url}
                  </a>
                </div>
              )}
              {step.data?.input && (
                <div className="flex gap-2 text-xs">
                  <span className="text-white/30 w-12 shrink-0">Input</span>
                  <pre className="text-white/60 whitespace-pre-wrap break-all font-mono text-[10px] max-h-20 overflow-y-auto">{step.data.input}</pre>
                </div>
              )}
              {step.data?.output && (
                <div className="flex gap-2 text-xs">
                  <span className="text-white/30 w-12 shrink-0">Output</span>
                  <pre className="text-green-300/70 whitespace-pre-wrap break-all font-mono text-[10px] max-h-20 overflow-y-auto">{step.data.output}</pre>
                </div>
              )}
              {step.data?.result && (
                <div className="flex gap-2 text-xs">
                  <span className="text-white/30 w-12 shrink-0">Result</span>
                  <pre className="text-white/60 whitespace-pre-wrap break-all font-mono text-[10px] max-h-20 overflow-y-auto">{step.data.result}</pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {expanded && step.children && step.children.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="space-y-1 p-2 pt-0 overflow-hidden"
          >
            {step.children.map((child) => (
              <FullStepCard key={child.id} step={child} depth={depth + 1} onRedirect={onRedirect} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
})
FullStepCard.displayName = "FullStepCard"

const CompactVariant = memo(({ steps, isActive, onPause, onResume }: Pick<ThinkingVisualizerProps, "steps" | "isActive" | "onPause" | "onResume">) => {
  const activeStep = steps.find((s) => s.status === "active")
  const displayStep = activeStep ?? steps[steps.length - 1]

  if (!displayStep) return null

  const config = STEP_CONFIGS[displayStep.type]
  const Icon = config.icon

  return (
    <motion.div
      layout
      className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5", config.border, config.bg)}
    >
      <motion.div
        animate={isActive ? { scale: [1, 1.15, 1], opacity: [1, 0.6, 1] } : {}}
        transition={{ duration: 1.0, repeat: Infinity }}
      >
        <Icon className={cn("h-3.5 w-3.5", config.color)} />
      </motion.div>
      <span className="text-xs font-medium text-white/80">{displayStep.label}</span>
      {isActive && (
        <motion.div className="flex gap-0.5">
          {[0, 0.2, 0.4].map((delay) => (
            <motion.span
              key={delay}
              className="h-1 w-1 rounded-full bg-white/40"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 0.8, repeat: Infinity, delay }}
            />
          ))}
        </motion.div>
      )}
      {isActive && onPause && (
        <button onClick={onPause} className="ml-1 text-white/40 hover:text-white/70">
          <Pause className="h-3 w-3" />
        </button>
      )}
      {!isActive && onResume && (
        <button onClick={onResume} className="ml-1 text-white/40 hover:text-white/70">
          <Play className="h-3 w-3" />
        </button>
      )}
    </motion.div>
  )
})
CompactVariant.displayName = "CompactVariant"

const TimelineVariant = memo(({ steps, onRedirect }: Pick<ThinkingVisualizerProps, "steps" | "onRedirect">) => {
  return (
    <div className="relative space-y-0">
      {steps.map((step, idx) => {
        const config = STEP_CONFIGS[step.type]
        const isLast = idx === steps.length - 1

        return (
          <div key={step.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full border", config.border, config.bg)}>
                <StepIcon type={step.type} status={step.status} size="sm" />
              </div>
              {!isLast && (
                <motion.div
                  className="w-px flex-1 bg-white/10 my-0.5"
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: 0.3, delay: idx * 0.05 }}
                  style={{ transformOrigin: "top" }}
                />
              )}
            </div>
            <div className="pb-3 flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-medium text-white/90">{step.label}</span>
                {step.startedAt && (
                  <span className="text-xs text-white/30">{formatDuration(step.startedAt, step.completedAt)}</span>
                )}
                {step.confidence !== undefined && (
                  <div className={cn("h-1.5 w-1.5 rounded-full", getConfidenceColor(step.confidence))} />
                )}
              </div>
              {step.description && <p className="text-xs text-white/50">{step.description}</p>}
              {step.status === "active" && onRedirect && (
                <Button size="sm" variant="ghost" className="mt-1 h-5 px-2 text-xs text-purple-300 hover:bg-purple-500/20">
                  <MessageSquare className="mr-1 h-2.5 w-2.5" />
                  Redirect
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
})
TimelineVariant.displayName = "TimelineVariant"

const FullVariant = memo(({ steps, isActive, onPause, onResume, onRedirect }: ThinkingVisualizerProps) => {
  const activeCount = steps.filter((s) => s.status === "active").length
  const completedCount = steps.filter((s) => s.status === "complete").length

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-white/60 uppercase tracking-wider">Thinking</span>
          {isActive && (
            <motion.div
              className="h-1.5 w-1.5 rounded-full bg-green-400"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/30">{completedCount}/{steps.length} steps</span>
          {isActive && onPause && (
            <Button size="sm" variant="ghost" onClick={onPause} className="h-6 px-2 text-xs text-white/50 hover:text-white/80">
              <Pause className="mr-1 h-3 w-3" />
              Pause
            </Button>
          )}
          {!isActive && onResume && (
            <Button size="sm" variant="ghost" onClick={onResume} className="h-6 px-2 text-xs text-white/50 hover:text-white/80">
              <Play className="mr-1 h-3 w-3" />
              Resume
            </Button>
          )}
        </div>
      </div>

      {activeCount > 0 && (
        <div className="h-0.5 w-full rounded-full bg-white/5 overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-purple-500 to-pink-500"
            initial={{ width: "0%" }}
            animate={{ width: `${(completedCount / Math.max(steps.length, 1)) * 100}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      )}

      <ScrollArea className="max-h-80">
        <div className="space-y-1.5 pr-2">
          <AnimatePresence initial={false}>
            {steps.map((step) => (
              <FullStepCard key={step.id} step={step} onRedirect={onRedirect} />
            ))}
          </AnimatePresence>

          {steps.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-6 text-white/30">
              <AlertCircle className="h-8 w-8" />
              <span className="text-sm">No thinking steps yet</span>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
})
FullVariant.displayName = "FullVariant"

export const ThinkingVisualizer = memo(({
  steps,
  isActive,
  onPause,
  onResume,
  onRedirect,
  className,
  variant = "full",
}: ThinkingVisualizerProps) => {
  return (
    <div className={cn("font-sans", className)}>
      {variant === "compact" && (
        <CompactVariant steps={steps} isActive={isActive} onPause={onPause} onResume={onResume} />
      )}
      {variant === "full" && (
        <FullVariant steps={steps} isActive={isActive} onPause={onPause} onResume={onResume} onRedirect={onRedirect} />
      )}
      {variant === "timeline" && (
        <TimelineVariant steps={steps} onRedirect={onRedirect} />
      )}
    </div>
  )
})
ThinkingVisualizer.displayName = "ThinkingVisualizer"

export default ThinkingVisualizer
