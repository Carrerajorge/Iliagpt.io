/**
 * Reasoning Chain Components - ILIAGPT PRO 3.0
 * 
 * Visual display of agent thinking process:
 * [Thinking] → [Planning] → [Executing] → [Verifying]
 */

import { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Brain,
    Lightbulb,
    Cog,
    CheckCircle,
    AlertCircle,
    ChevronDown,
    ChevronRight,
    Loader2,
    Sparkles,
    Search,
    Code,
    FileText
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ReasoningStepStatus = "pending" | "thinking" | "done" | "error";
export type ReasoningStepType = "thinking" | "planning" | "searching" | "coding" | "verifying";

export interface ReasoningStep {
    id: string;
    type: ReasoningStepType;
    title: string;
    content?: string;
    status: ReasoningStepStatus;
    duration?: number; // ms
    substeps?: ReasoningSubstep[];
}

export interface ReasoningSubstep {
    id: string;
    text: string;
    status: ReasoningStepStatus;
}

interface ThinkingCardProps {
    step: ReasoningStep;
    isExpanded?: boolean;
    onToggle?: () => void;
}

const stepIcons: Record<ReasoningStepType, React.ReactNode> = {
    thinking: <Brain className="w-4 h-4" />,
    planning: <Lightbulb className="w-4 h-4" />,
    searching: <Search className="w-4 h-4" />,
    coding: <Code className="w-4 h-4" />,
    verifying: <CheckCircle className="w-4 h-4" />,
};

const stepColors: Record<ReasoningStepType, string> = {
    thinking: "from-purple-500 to-indigo-500",
    planning: "from-amber-500 to-orange-500",
    searching: "from-cyan-500 to-blue-500",
    coding: "from-emerald-500 to-teal-500",
    verifying: "from-green-500 to-emerald-500",
};

const statusIcons: Record<ReasoningStepStatus, React.ReactNode> = {
    pending: <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />,
    thinking: <Loader2 className="w-4 h-4 animate-spin text-blue-500" />,
    done: <CheckCircle className="w-4 h-4 text-green-500" />,
    error: <AlertCircle className="w-4 h-4 text-red-500" />,
};

/**
 * Individual thinking step card
 */
export const ThinkingCard = memo(function ThinkingCard({
    step,
    isExpanded = false,
    onToggle,
}: ThinkingCardProps) {
    const hasContent = step.content || (step.substeps && step.substeps.length > 0);
    const isActive = step.status === "thinking";

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                "group relative rounded-xl border transition-all duration-300",
                isActive
                    ? "border-blue-500/30 bg-blue-500/5 shadow-lg shadow-blue-500/10"
                    : "border-border/50 bg-card/50 hover:bg-card/80"
            )}
        >
            {/* Gradient accent line */}
            <div
                className={cn(
                    "absolute left-0 top-0 bottom-0 w-1 rounded-l-xl bg-gradient-to-b opacity-60",
                    stepColors[step.type]
                )}
            />

            <button
                onClick={onToggle}
                disabled={!hasContent}
                className={cn(
                    "w-full flex items-center gap-3 p-3 text-left",
                    hasContent && "cursor-pointer"
                )}
            >
                {/* Step Icon */}
                <div className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br",
                    stepColors[step.type],
                    "text-white shadow-sm"
                )}>
                    {stepIcons[step.type]}
                </div>

                {/* Title & Status */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{step.title}</span>
                        {step.duration && step.status === "done" && (
                            <span className="text-xs text-muted-foreground">
                                {(step.duration / 1000).toFixed(1)}s
                            </span>
                        )}
                    </div>
                    {isActive && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="text-xs text-blue-500 flex items-center gap-1 mt-0.5"
                        >
                            <Sparkles className="w-3 h-3" />
                            Procesando...
                        </motion.div>
                    )}
                </div>

                {/* Status Icon */}
                <div className="flex items-center gap-2">
                    {statusIcons[step.status]}
                    {hasContent && (
                        <motion.div
                            animate={{ rotate: isExpanded ? 180 : 0 }}
                            transition={{ duration: 0.2 }}
                        >
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        </motion.div>
                    )}
                </div>
            </button>

            {/* Expandable Content */}
            <AnimatePresence>
                {isExpanded && hasContent && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="px-4 pb-3 pt-1 border-t border-border/30 ml-11">
                            {step.content && (
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                    {step.content}
                                </p>
                            )}
                            {step.substeps && step.substeps.length > 0 && (
                                <div className="space-y-1.5 mt-2">
                                    {step.substeps.map((substep) => (
                                        <div
                                            key={substep.id}
                                            className="flex items-center gap-2 text-sm"
                                        >
                                            {statusIcons[substep.status]}
                                            <span className={cn(
                                                substep.status === "done" && "text-muted-foreground line-through"
                                            )}>
                                                {substep.text}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
});

/**
 * Container for multiple reasoning steps
 */
interface ReasoningChainProps {
    steps: ReasoningStep[];
    className?: string;
}

export const ReasoningChain = memo(function ReasoningChain({
    steps,
    className,
}: ReasoningChainProps) {
    const [expandedId, setExpandedId] = useState<string | null>(null);

    if (steps.length === 0) return null;

    return (
        <div className={cn("space-y-2", className)}>
            <div className="flex items-center gap-2 px-1 mb-3">
                <Brain className="w-4 h-4 text-purple-500" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Proceso de razonamiento
                </span>
            </div>

            {steps.map((step, index) => (
                <div key={step.id} className="relative">
                    {/* Connection line */}
                    {index < steps.length - 1 && (
                        <div className="absolute left-[18px] top-[44px] bottom-[-8px] w-0.5 bg-gradient-to-b from-border to-transparent" />
                    )}

                    <ThinkingCard
                        step={step}
                        isExpanded={expandedId === step.id}
                        onToggle={() => setExpandedId(
                            expandedId === step.id ? null : step.id
                        )}
                    />
                </div>
            ))}
        </div>
    );
});

/**
 * Compact inline thinking indicator
 */
export function ThinkingIndicator({ text = "Pensando..." }: { text?: string }) {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 text-sm text-muted-foreground"
        >
            <div className="relative">
                <Brain className="w-4 h-4 text-purple-500" />
                <motion.div
                    className="absolute inset-0 rounded-full bg-purple-500/20"
                    animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity }}
                />
            </div>
            <span>{text}</span>
            <motion.span
                animate={{ opacity: [0, 1, 0] }}
                transition={{ duration: 1.5, repeat: Infinity }}
            >
                ...
            </motion.span>
        </motion.div>
    );
}

export default ReasoningChain;
