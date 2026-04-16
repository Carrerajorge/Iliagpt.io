// SourcesPanel — enhanced sources display for intelligence UI

import { memo, useCallback, useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  Globe,
  FileText,
  Database,
  Code,
  BookOpen,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Tag,
  BarChart3,
  TrendingUp,
} from "lucide-react"

export interface Source {
  id: string
  type: "web" | "document" | "memory" | "code" | "academic"
  title: string
  url?: string
  snippet: string
  relevanceScore: number
  credibilityScore?: number
  credibilityCategory?: "high" | "medium" | "low" | "unknown"
  publishedAt?: string
  author?: string
  citationIndex?: number
  verified?: boolean
  domain?: string
  thumbnailUrl?: string
  metadata?: Record<string, unknown>
}

export interface SourcesPanelProps {
  sources: Source[]
  citationMap?: Record<number, string>
  onCitationClick?: (citationIndex: number) => void
  onSourceExpand?: (sourceId: string) => void
  className?: string
  variant?: "sidebar" | "inline" | "sheet"
  isLoading?: boolean
}

const TYPE_CONFIG = {
  web: { icon: Globe, label: "Web", color: "text-blue-400" },
  document: { icon: FileText, label: "Documents", color: "text-yellow-400" },
  memory: { icon: Database, label: "Memory", color: "text-green-400" },
  code: { icon: Code, label: "Code", color: "text-orange-400" },
  academic: { icon: BookOpen, label: "Academic", color: "text-purple-400" },
} as const

type SortOption = "relevance" | "date" | "credibility"

function CredibilityIcon({ category }: { category?: Source["credibilityCategory"] }) {
  if (category === "high") return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
  if (category === "medium") return <AlertCircle className="h-3.5 w-3.5 text-yellow-400" />
  if (category === "low") return <XCircle className="h-3.5 w-3.5 text-red-400" />
  return <AlertCircle className="h-3.5 w-3.5 text-white/20" />
}

function RelevanceBar({ score }: { score: number }) {
  const color = score >= 0.7 ? "from-green-500 to-emerald-400" : score >= 0.4 ? "from-yellow-500 to-amber-400" : "from-red-500 to-orange-400"
  return (
    <div className="h-0.5 w-full rounded-full bg-white/10 overflow-hidden">
      <motion.div
        className={cn("h-full rounded-full bg-gradient-to-r", color)}
        initial={{ width: 0 }}
        animate={{ width: `${score * 100}%` }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />
    </div>
  )
}

function getDomainEmoji(domain?: string): string {
  if (!domain) return "🌐"
  if (domain.endsWith(".edu")) return "🎓"
  if (domain.endsWith(".gov")) return "🏛️"
  if (domain.includes("github")) return "🐙"
  if (domain.includes("arxiv") || domain.includes("pubmed")) return "📄"
  if (domain.includes("wikipedia")) return "📚"
  return "🌐"
}

const SkeletonCard = memo(() => (
  <div className="rounded-lg border border-white/5 bg-white/3 p-3 space-y-2 animate-pulse">
    <div className="flex gap-2 items-start">
      <div className="h-4 w-4 rounded bg-white/10" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-3/4 rounded bg-white/10" />
        <div className="h-2.5 w-1/2 rounded bg-white/5" />
      </div>
    </div>
    <div className="space-y-1">
      <div className="h-2 w-full rounded bg-white/5" />
      <div className="h-2 w-5/6 rounded bg-white/5" />
    </div>
    <div className="h-0.5 w-full rounded bg-white/10" />
  </div>
))
SkeletonCard.displayName = "SkeletonCard"

interface SourceCardProps {
  source: Source
  onCitationClick?: (index: number) => void
  onExpand?: (id: string) => void
}

const SourceCard = memo(({ source, onCitationClick, onExpand }: SourceCardProps) => {
  const [expanded, setExpanded] = useState(false)
  const typeConfig = TYPE_CONFIG[source.type]
  const Icon = typeConfig.icon

  const handleExpand = useCallback(() => {
    setExpanded((v) => !v)
    onExpand?.(source.id)
  }, [source.id, onExpand])

  const handleCitationClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (source.citationIndex !== undefined) {
      onCitationClick?.(source.citationIndex)
    }
  }, [source.citationIndex, onCitationClick])

  return (
    <motion.div
      layout
      className="rounded-lg border border-white/8 bg-white/3 hover:bg-white/5 transition-colors overflow-hidden"
    >
      <div className="p-3 cursor-pointer" onClick={handleExpand}>
        <div className="flex items-start gap-2 mb-1.5">
          <div className="mt-0.5 shrink-0">
            <Icon className={cn("h-3.5 w-3.5", typeConfig.color)} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-medium text-white/90 truncate leading-tight">{source.title}</span>
              {source.citationIndex !== undefined && (
                <button
                  onClick={handleCitationClick}
                  className="shrink-0 rounded px-1 text-[10px] font-bold text-blue-300 bg-blue-500/15 hover:bg-blue-500/25 transition-colors"
                >
                  [{source.citationIndex}]
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs">{getDomainEmoji(source.domain)}</span>
              {source.domain && <span className="text-xs text-white/35 truncate">{source.domain}</span>}
              {source.author && <span className="text-xs text-white/30">· {source.author}</span>}
              {source.publishedAt && <span className="text-xs text-white/25">· {source.publishedAt}</span>}
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-1">
            <CredibilityIcon category={source.credibilityCategory} />
            {expanded ? <ChevronUp className="h-3 w-3 text-white/25" /> : <ChevronDown className="h-3 w-3 text-white/25" />}
          </div>
        </div>

        <p className="text-xs text-white/55 line-clamp-2 mb-2">{source.snippet}</p>

        <div className="flex items-center gap-2">
          <RelevanceBar score={source.relevanceScore} />
          <span className="shrink-0 text-xs text-white/30">{Math.round(source.relevanceScore * 100)}%</span>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/5 px-3 py-2 space-y-2">
              <p className="text-xs text-white/60">{source.snippet}</p>
              {source.credibilityScore !== undefined && (
                <div className="flex items-center gap-2 text-xs text-white/40">
                  <span>Credibility</span>
                  <div className="flex-1 h-0.5 rounded bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-green-500/60 rounded"
                      style={{ width: `${source.credibilityScore * 100}%` }}
                    />
                  </div>
                  <span>{Math.round(source.credibilityScore * 100)}%</span>
                </div>
              )}
              {source.metadata && Object.keys(source.metadata).length > 0 && (
                <div className="space-y-0.5">
                  {Object.entries(source.metadata).slice(0, 4).map(([k, v]) => (
                    <div key={k} className="flex gap-2 text-xs">
                      <span className="text-white/25 capitalize w-20 shrink-0">{k}</span>
                      <span className="text-white/50 truncate">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
              {source.url && (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open source
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
})
SourceCard.displayName = "SourceCard"

interface SourceListProps {
  sources: Source[]
  onCitationClick?: (index: number) => void
  onSourceExpand?: (id: string) => void
}

const SourceList = memo(({ sources, onCitationClick, onSourceExpand }: SourceListProps) => {
  if (sources.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-white/25">
        <Globe className="h-8 w-8" />
        <span className="text-sm">No sources found</span>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <AnimatePresence initial={false}>
        {sources.map((source, idx) => (
          <motion.div
            key={source.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, delay: idx * 0.04 }}
          >
            <SourceCard source={source} onCitationClick={onCitationClick} onExpand={onSourceExpand} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
})
SourceList.displayName = "SourceList"

const SORT_ICONS: Record<SortOption, React.ComponentType<{ className?: string }>> = {
  relevance: BarChart3,
  date: Tag,
  credibility: TrendingUp,
}

const PanelContent = memo(({
  sources,
  isLoading,
  onCitationClick,
  onSourceExpand,
}: Pick<SourcesPanelProps, "sources" | "isLoading" | "onCitationClick" | "onSourceExpand">) => {
  const [sort, setSort] = useState<SortOption>("relevance")

  const sortedSources = useMemo(() => {
    const arr = [...sources]
    if (sort === "relevance") return arr.sort((a, b) => b.relevanceScore - a.relevanceScore)
    if (sort === "credibility") return arr.sort((a, b) => (b.credibilityScore ?? 0) - (a.credibilityScore ?? 0))
    if (sort === "date") return arr.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    return arr
  }, [sources, sort])

  const grouped = useMemo(() => {
    const groups: Partial<Record<Source["type"], Source[]>> = {}
    for (const src of sortedSources) {
      if (!groups[src.type]) groups[src.type] = []
      groups[src.type]!.push(src)
    }
    return groups
  }, [sortedSources])

  const types = Object.keys(grouped) as Source["type"][]

  if (isLoading) {
    return (
      <div className="space-y-1.5">
        {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        <span className="text-xs text-white/30 mr-1">Sort:</span>
        {(["relevance", "date", "credibility"] as SortOption[]).map((opt) => {
          const SortIcon = SORT_ICONS[opt]
          return (
            <button
              key={opt}
              onClick={() => setSort(opt)}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors capitalize",
                sort === opt ? "bg-white/10 text-white/80" : "text-white/30 hover:text-white/60"
              )}
            >
              <SortIcon className="h-2.5 w-2.5" />
              {opt}
            </button>
          )
        })}
      </div>

      {types.length > 1 ? (
        <Tabs defaultValue={types[0]} className="w-full">
          <TabsList className="w-full h-7 bg-white/5 p-0.5">
            {types.map((type) => {
              const cfg = TYPE_CONFIG[type]
              const TypeIcon = cfg.icon
              return (
                <TabsTrigger key={type} value={type} className="flex-1 h-6 text-xs gap-1">
                  <TypeIcon className={cn("h-3 w-3", cfg.color)} />
                  {cfg.label}
                  <span className="text-white/30">({grouped[type]!.length})</span>
                </TabsTrigger>
              )
            })}
          </TabsList>
          {types.map((type) => (
            <TabsContent key={type} value={type} className="mt-2">
              <SourceList
                sources={grouped[type]!}
                onCitationClick={onCitationClick}
                onSourceExpand={onSourceExpand}
              />
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <SourceList sources={sortedSources} onCitationClick={onCitationClick} onSourceExpand={onSourceExpand} />
      )}
    </div>
  )
})
PanelContent.displayName = "PanelContent"

export const SourcesPanel = memo(({
  sources,
  citationMap: _citationMap,
  onCitationClick,
  onSourceExpand,
  className,
  variant = "sidebar",
  isLoading = false,
}: SourcesPanelProps) => {
  const [sheetOpen, setSheetOpen] = useState(false)

  const header = (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-blue-400" />
        <span className="text-sm font-semibold text-white/80">Sources</span>
        {!isLoading && (
          <Badge variant="outline" className="border-white/10 text-white/40 text-xs h-4">
            {sources.length}
          </Badge>
        )}
      </div>
    </div>
  )

  if (variant === "sheet") {
    return (
      <>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setSheetOpen(true)}
          className="h-7 gap-1.5 text-xs text-white/60 hover:text-white/90"
        >
          <Globe className="h-3.5 w-3.5 text-blue-400" />
          Sources
          <Badge variant="outline" className="border-white/10 text-white/40 text-[10px] h-4 px-1">
            {sources.length}
          </Badge>
        </Button>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="right" className="w-80 bg-zinc-900 border-white/10">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 text-white/80">
                <Globe className="h-4 w-4 text-blue-400" />
                Sources
              </SheetTitle>
            </SheetHeader>
            <ScrollArea className="mt-4 h-[calc(100vh-80px)]">
              <PanelContent
                sources={sources}
                isLoading={isLoading}
                onCitationClick={onCitationClick}
                onSourceExpand={onSourceExpand}
              />
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </>
    )
  }

  if (variant === "inline") {
    return (
      <div className={cn("rounded-xl border border-white/8 bg-zinc-900/60 p-3", className)}>
        {header}
        <PanelContent
          sources={sources}
          isLoading={isLoading}
          onCitationClick={onCitationClick}
          onSourceExpand={onSourceExpand}
        />
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {header}
      <ScrollArea className="flex-1">
        <PanelContent
          sources={sources}
          isLoading={isLoading}
          onCitationClick={onCitationClick}
          onSourceExpand={onSourceExpand}
        />
      </ScrollArea>
    </div>
  )
})
SourcesPanel.displayName = "SourcesPanel"

export default SourcesPanel
