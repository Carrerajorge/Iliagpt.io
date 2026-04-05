// ConversationInsights — sidebar panel showing conversation analysis and metadata

import { memo, useCallback, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tag,
  Lightbulb,
  Target,
  CheckCircle2,
  List,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  User,
  Brain,
  Activity,
} from "lucide-react"

export interface ConversationTopic {
  label: string
  weight: number
  category?: string
}

export interface KeyFact {
  content: string
  confidence: number
  timestamp?: Date
  source?: "user" | "ai"
}

export interface ActionItem {
  id: string
  description: string
  priority: "high" | "medium" | "low"
  status: "pending" | "in_progress" | "done"
}

export interface ConversationInsightsProps {
  topics: ConversationTopic[]
  keyFacts: KeyFact[]
  decisions: string[]
  actionItems: ActionItem[]
  suggestedNextTopics: string[]
  qualityMetrics: {
    coherence: number
    depth: number
    clarity: number
    progressToGoal?: number
  }
  messageCount: number
  estimatedTokens: number
  className?: string
  onSuggestedTopicClick?: (topic: string) => void
  onActionItemStatusChange?: (id: string, status: ActionItem["status"]) => void
}

const CATEGORY_COLORS: Record<string, string> = {
  default: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  technical: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  business: "bg-green-500/20 text-green-300 border-green-500/30",
  personal: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  research: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  creative: "bg-orange-500/20 text-orange-300 border-orange-500/30",
}

function getCategoryColor(category?: string): string {
  return CATEGORY_COLORS[category ?? "default"] ?? CATEGORY_COLORS.default
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return "bg-green-500"
  if (confidence >= 0.5) return "bg-yellow-500"
  return "bg-red-500"
}

const PRIORITY_CONFIG = {
  high: { color: "text-red-300", bg: "bg-red-500/10", border: "border-red-500/20", dot: "bg-red-400" },
  medium: { color: "text-yellow-300", bg: "bg-yellow-500/10", border: "border-yellow-500/20", dot: "bg-yellow-400" },
  low: { color: "text-green-300", bg: "bg-green-500/10", border: "border-green-500/20", dot: "bg-green-400" },
}

const ACTION_STATUS_CYCLE: Record<ActionItem["status"], ActionItem["status"]> = {
  pending: "in_progress",
  in_progress: "done",
  done: "pending",
}

interface CollapsibleSectionProps {
  title: string
  icon: React.ComponentType<{ className?: string }>
  iconColor?: string
  children: React.ReactNode
  defaultOpen?: boolean
  count?: number
  empty?: boolean
}

const CollapsibleSection = memo(({
  title,
  icon: Icon,
  iconColor = "text-white/50",
  children,
  defaultOpen = true,
  count,
  empty = false,
}: CollapsibleSectionProps) => {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-white/5 last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 py-2 px-1 text-left hover:bg-white/3 rounded transition-colors"
      >
        <Icon className={cn("h-3.5 w-3.5 shrink-0", iconColor)} />
        <span className="flex-1 text-xs font-semibold text-white/65 uppercase tracking-wider">{title}</span>
        {count !== undefined && !empty && (
          <span className="text-xs text-white/25">{count}</span>
        )}
        {open ? <ChevronUp className="h-3 w-3 text-white/25" /> : <ChevronDown className="h-3 w-3 text-white/25" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pb-3 px-1">
              {empty ? (
                <p className="text-xs text-white/25 text-center py-2">Nothing here yet</p>
              ) : children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
CollapsibleSection.displayName = "CollapsibleSection"

interface MetricBarProps {
  label: string
  value: number
  color?: string
}

const MetricBar = memo(({ label, value, color = "from-blue-500 to-purple-500" }: MetricBarProps) => (
  <div className="space-y-1">
    <div className="flex justify-between text-xs">
      <span className="text-white/45">{label}</span>
      <span className="text-white/55 font-medium">{Math.round(value * 100)}%</span>
    </div>
    <div className="h-1 w-full rounded-full bg-white/8 overflow-hidden">
      <motion.div
        className={cn("h-full rounded-full bg-gradient-to-r", color)}
        initial={{ width: 0 }}
        animate={{ width: `${value * 100}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
    </div>
  </div>
))
MetricBar.displayName = "MetricBar"

interface TopicTagProps {
  topic: ConversationTopic
}

const TopicTag = memo(({ topic }: TopicTagProps) => {
  const fontSize = 10 + Math.round(topic.weight * 6)
  const colorClass = getCategoryColor(topic.category)

  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 font-medium cursor-default transition-colors hover:brightness-110",
        colorClass
      )}
      style={{ fontSize }}
    >
      {topic.label}
    </motion.span>
  )
})
TopicTag.displayName = "TopicTag"

export const ConversationInsights = memo(({
  topics,
  keyFacts,
  decisions,
  actionItems,
  suggestedNextTopics,
  qualityMetrics,
  messageCount,
  estimatedTokens,
  className,
  onSuggestedTopicClick,
  onActionItemStatusChange,
}: ConversationInsightsProps) => {
  const handleActionToggle = useCallback((item: ActionItem) => {
    const next = ACTION_STATUS_CYCLE[item.status]
    onActionItemStatusChange?.(item.id, next)
  }, [onActionItemStatusChange])

  const formatTokens = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

  return (
    <div className={cn("flex flex-col text-sm font-sans", className)}>
      {/* Stats bar */}
      <div className="flex items-center gap-3 px-1 py-2 border-b border-white/8">
        <div className="flex items-center gap-1 text-xs text-white/40">
          <MessageSquare className="h-3 w-3" />
          <span>{messageCount} msgs</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-white/40">
          <Brain className="h-3 w-3" />
          <span>{formatTokens(estimatedTokens)} tok</span>
        </div>
        <div className="flex-1" />
        {qualityMetrics.progressToGoal !== undefined && (
          <div className="flex items-center gap-1 text-xs">
            <Target className="h-3 w-3 text-purple-400" />
            <span className="text-white/50">{Math.round(qualityMetrics.progressToGoal * 100)}%</span>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-0 px-0.5">

          {/* Quality Metrics */}
          <CollapsibleSection
            title="Quality"
            icon={Activity}
            iconColor="text-blue-400"
            defaultOpen
            empty={false}
          >
            <div className="space-y-2.5">
              <MetricBar label="Coherence" value={qualityMetrics.coherence} color="from-blue-500 to-cyan-400" />
              <MetricBar label="Depth" value={qualityMetrics.depth} color="from-purple-500 to-violet-400" />
              <MetricBar label="Clarity" value={qualityMetrics.clarity} color="from-green-500 to-emerald-400" />
              {qualityMetrics.progressToGoal !== undefined && (
                <MetricBar label="Goal Progress" value={qualityMetrics.progressToGoal} color="from-yellow-500 to-orange-400" />
              )}
            </div>
          </CollapsibleSection>

          {/* Topics */}
          <CollapsibleSection
            title="Topics"
            icon={Tag}
            iconColor="text-purple-400"
            count={topics.length}
            empty={topics.length === 0}
          >
            <motion.div layout className="flex flex-wrap gap-1.5">
              {topics.map((topic) => (
                <TopicTag key={topic.label} topic={topic} />
              ))}
            </motion.div>
          </CollapsibleSection>

          {/* Key Facts */}
          <CollapsibleSection
            title="Key Facts"
            icon={Lightbulb}
            iconColor="text-yellow-400"
            count={keyFacts.length}
            empty={keyFacts.length === 0}
          >
            <ol className="space-y-2">
              {keyFacts.map((fact, idx) => (
                <motion.li
                  key={idx}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  className="flex gap-2"
                >
                  <span className="shrink-0 text-xs text-white/25 font-mono mt-0.5 w-4 text-right">{idx + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white/75 leading-relaxed">{fact.content}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", getConfidenceColor(fact.confidence))} />
                      <span className="text-[10px] text-white/25">{Math.round(fact.confidence * 100)}% confident</span>
                      {fact.source && (
                        <span className="text-[10px] text-white/20 flex items-center gap-0.5">
                          {fact.source === "user" ? <User className="h-2.5 w-2.5" /> : <Brain className="h-2.5 w-2.5" />}
                          {fact.source}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.li>
              ))}
            </ol>
          </CollapsibleSection>

          {/* Decisions */}
          <CollapsibleSection
            title="Decisions"
            icon={CheckCircle2}
            iconColor="text-green-400"
            count={decisions.length}
            empty={decisions.length === 0}
          >
            <ul className="space-y-1.5">
              {decisions.map((decision, idx) => (
                <motion.li
                  key={idx}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  className="flex gap-2 items-start"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" />
                  <span className="text-xs text-white/70 leading-relaxed">{decision}</span>
                </motion.li>
              ))}
            </ul>
          </CollapsibleSection>

          {/* Action Items */}
          <CollapsibleSection
            title="Action Items"
            icon={List}
            iconColor="text-orange-400"
            count={actionItems.length}
            empty={actionItems.length === 0}
          >
            <ul className="space-y-1.5">
              <AnimatePresence initial={false}>
                {actionItems.map((item) => {
                  const priConfig = PRIORITY_CONFIG[item.priority]
                  const isDone = item.status === "done"

                  return (
                    <motion.li
                      key={item.id}
                      layout
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className={cn(
                        "flex gap-2 items-start rounded-md border px-2 py-1.5 cursor-pointer transition-colors",
                        priConfig.border, priConfig.bg,
                        "hover:brightness-110"
                      )}
                      onClick={() => handleActionToggle(item)}
                    >
                      <div className={cn("mt-0.5 h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 transition-colors",
                        isDone ? "bg-green-500/30 border-green-500/50" : "border-white/20"
                      )}>
                        {isDone && <CheckCircle2 className="h-2.5 w-2.5 text-green-400" />}
                        {item.status === "in_progress" && (
                          <motion.div
                            className="h-2 w-2 rounded-full bg-blue-400"
                            animate={{ opacity: [1, 0.3, 1] }}
                            transition={{ duration: 0.8, repeat: Infinity }}
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "text-xs leading-relaxed transition-colors",
                          isDone ? "text-white/30 line-through" : "text-white/75"
                        )}>
                          {item.description}
                        </p>
                      </div>
                      <div className={cn("shrink-0 mt-0.5 h-1.5 w-1.5 rounded-full", priConfig.dot)} title={item.priority} />
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
          </CollapsibleSection>

          {/* Suggested Next Topics */}
          <CollapsibleSection
            title="Explore Next"
            icon={TrendingUp}
            iconColor="text-cyan-400"
            count={suggestedNextTopics.length}
            empty={suggestedNextTopics.length === 0}
          >
            <div className="flex flex-wrap gap-1.5">
              <AnimatePresence initial={false}>
                {suggestedNextTopics.map((topic, idx) => (
                  <motion.button
                    key={topic}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{ delay: idx * 0.05 }}
                    onClick={() => onSuggestedTopicClick?.(topic)}
                    className="inline-flex items-center gap-1 rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-500/40 transition-colors"
                  >
                    <TrendingUp className="h-2.5 w-2.5" />
                    {topic}
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          </CollapsibleSection>

        </div>
      </ScrollArea>
    </div>
  )
})
ConversationInsights.displayName = "ConversationInsights"

export default ConversationInsights
