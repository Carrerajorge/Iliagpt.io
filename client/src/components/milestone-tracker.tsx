/**
 * Progress Milestones - ILIAGPT PRO 3.0
 * 
 * Visual tracker for complex multi-step tasks.
 * Shows progress through milestones with animations.
 */

import { memo, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Check,
    Circle,
    Loader2,
    AlertCircle,
    Clock,
    ChevronRight,
    Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============== Types ==============

export interface Milestone {
    id: string;
    title: string;
    description?: string;
    status: "pending" | "active" | "completed" | "failed" | "skipped";
    progress?: number; // 0-100 for active milestone
    duration?: number; // ms
    agent?: string;
}

interface MilestoneTrackerProps {
    milestones: Milestone[];
    currentIndex?: number;
    variant?: "horizontal" | "vertical" | "compact";
    showDuration?: boolean;
    className?: string;
}

// ============== Icons ==============

function StatusIcon({ status, progress }: { status: Milestone["status"]; progress?: number }) {
    switch (status) {
        case "completed":
            return (
                <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="flex items-center justify-center w-6 h-6 rounded-full bg-green-500 text-white"
                >
                    <Check className="w-3.5 h-3.5" />
                </motion.div>
            );
        case "active":
            return (
                <div className="relative flex items-center justify-center w-6 h-6">
                    <svg className="w-6 h-6 -rotate-90">
                        <circle
                            cx="12"
                            cy="12"
                            r="10"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="text-primary/20"
                        />
                        <circle
                            cx="12"
                            cy="12"
                            r="10"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeDasharray={2 * Math.PI * 10}
                            strokeDashoffset={2 * Math.PI * 10 * (1 - (progress ?? 0) / 100)}
                            strokeLinecap="round"
                            className="text-primary transition-all duration-500"
                        />
                    </svg>
                    <Loader2 className="absolute w-3 h-3 text-primary animate-spin" />
                </div>
            );
        case "failed":
            return (
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-red-500 text-white">
                    <AlertCircle className="w-3.5 h-3.5" />
                </div>
            );
        case "skipped":
            return (
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted">
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
            );
        default:
            return (
                <div className="flex items-center justify-center w-6 h-6 rounded-full border-2 border-muted-foreground/30">
                    <Circle className="w-2 h-2 text-muted-foreground/30" />
                </div>
            );
    }
}

// ============== Horizontal Tracker ==============

function HorizontalTracker({ milestones, showDuration }: {
    milestones: Milestone[];
    showDuration?: boolean;
}) {
    const overallProgress = useMemo(() => {
        const completed = milestones.filter(m => m.status === "completed").length;
        return Math.round((completed / milestones.length) * 100);
    }, [milestones]);

    return (
        <div className="w-full">
            {/* Overall progress bar */}
            <div className="relative h-1 bg-muted rounded-full overflow-hidden mb-4">
                <motion.div
                    className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-500 to-purple-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${overallProgress}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                />
            </div>

            {/* Milestones */}
            <div className="flex items-start justify-between gap-2">
                {milestones.map((milestone, index) => (
                    <div
                        key={milestone.id}
                        className={cn(
                            "flex flex-col items-center flex-1 min-w-0",
                            index < milestones.length - 1 && "relative"
                        )}
                    >
                        <StatusIcon status={milestone.status} progress={milestone.progress} />

                        <span className={cn(
                            "mt-2 text-xs text-center truncate w-full",
                            milestone.status === "active" && "text-primary font-medium",
                            milestone.status === "completed" && "text-muted-foreground",
                            milestone.status === "pending" && "text-muted-foreground/60"
                        )}>
                            {milestone.title}
                        </span>

                        {showDuration && milestone.duration && (
                            <span className="text-[10px] text-muted-foreground mt-0.5">
                                {(milestone.duration / 1000).toFixed(1)}s
                            </span>
                        )}

                        {/* Connector line */}
                        {index < milestones.length - 1 && (
                            <div className="absolute top-3 left-[calc(50%+12px)] right-[calc(-50%+12px)] h-0.5 bg-muted">
                                <div
                                    className={cn(
                                        "h-full bg-green-500 transition-all duration-500",
                                        milestone.status === "completed" ? "w-full" : "w-0"
                                    )}
                                />
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ============== Vertical Tracker ==============

function VerticalTracker({ milestones, showDuration }: {
    milestones: Milestone[];
    showDuration?: boolean;
}) {
    return (
        <div className="space-y-0">
            {milestones.map((milestone, index) => (
                <div key={milestone.id} className="relative flex gap-3">
                    {/* Timeline */}
                    <div className="flex flex-col items-center">
                        <StatusIcon status={milestone.status} progress={milestone.progress} />
                        {index < milestones.length - 1 && (
                            <div className={cn(
                                "w-0.5 flex-1 min-h-[24px] my-1",
                                milestone.status === "completed" ? "bg-green-500" : "bg-muted"
                            )} />
                        )}
                    </div>

                    {/* Content */}
                    <div className={cn(
                        "flex-1 pb-4",
                        milestone.status === "active" && "text-foreground",
                        milestone.status !== "active" && "text-muted-foreground"
                    )}>
                        <div className="flex items-center gap-2">
                            <span className={cn(
                                "text-sm font-medium",
                                milestone.status === "active" && "text-primary"
                            )}>
                                {milestone.title}
                            </span>
                            {milestone.status === "active" && (
                                <Sparkles className="w-3 h-3 text-primary animate-pulse" />
                            )}
                        </div>

                        {milestone.description && (
                            <p className="text-xs mt-0.5 text-muted-foreground">
                                {milestone.description}
                            </p>
                        )}

                        {showDuration && milestone.duration && (
                            <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                                <Clock className="w-3 h-3" />
                                {(milestone.duration / 1000).toFixed(1)}s
                            </div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ============== Compact Tracker ==============

function CompactTracker({ milestones }: { milestones: Milestone[] }) {
    const completed = milestones.filter(m => m.status === "completed").length;
    const active = milestones.find(m => m.status === "active");

    return (
        <div className="flex items-center gap-2 text-sm">
            <div className="flex items-center gap-1 text-primary">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="font-medium">{active?.title || "Procesando..."}</span>
            </div>
            <span className="text-muted-foreground">
                ({completed}/{milestones.length})
            </span>
        </div>
    );
}

// ============== Main Component ==============

export const MilestoneTracker = memo(function MilestoneTracker({
    milestones,
    variant = "vertical",
    showDuration = false,
    className,
}: MilestoneTrackerProps) {
    if (milestones.length === 0) return null;

    return (
        <div className={cn("w-full", className)}>
            <AnimatePresence mode="wait">
                {variant === "horizontal" && (
                    <motion.div
                        key="horizontal"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                    >
                        <HorizontalTracker milestones={milestones} showDuration={showDuration} />
                    </motion.div>
                )}
                {variant === "vertical" && (
                    <motion.div
                        key="vertical"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                    >
                        <VerticalTracker milestones={milestones} showDuration={showDuration} />
                    </motion.div>
                )}
                {variant === "compact" && (
                    <motion.div
                        key="compact"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <CompactTracker milestones={milestones} />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});

export default MilestoneTracker;
