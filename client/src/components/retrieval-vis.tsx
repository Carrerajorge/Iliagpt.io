
import { memo } from "react";
import { motion } from "framer-motion";
import { Search, Database, Layers, CheckCircle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type RetrievalStepStatus = "pending" | "active" | "complete" | "error";

export interface RetrievalStep {
    id: string;
    label: string;
    status: RetrievalStepStatus;
    detail?: string;
}

interface RetrievalVisProps {
    steps: RetrievalStep[];
    className?: string;
}

export const RetrievalVis = memo(function RetrievalVis({ steps, className }: RetrievalVisProps) {
    if (!steps || steps.length === 0) return null;

    return (
        <div className={cn("flex flex-col gap-2 p-3 bg-card/40 rounded-lg border border-border/50", className)}>
            <div className="flex items-center gap-2 mb-1">
                <Database className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Retrieval Pipeline
                </span>
            </div>

            <div className="flex flex-col gap-3 relative">
                {/* Connector Line */}
                <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-border/50" />

                {steps.map((step, idx) => {
                    const isActive = step.status === "active";
                    const isComplete = step.status === "complete";
                    const isError = step.status === "error";

                    return (
                        <motion.div
                            key={step.id}
                            initial={{ opacity: 0, x: -5 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="relative z-10 flex items-start gap-3"
                        >
                            <div className={cn(
                                "w-6 h-6 rounded-full flex items-center justify-center border text-[10px] font-bold transition-colors",
                                isActive ? "bg-blue-500 border-blue-600 text-white shadow-md shadow-blue-500/20" :
                                    isComplete ? "bg-green-500 border-green-600 text-white" :
                                        isError ? "bg-red-500 border-red-600 text-white" :
                                            "bg-background border-border text-muted-foreground"
                            )}>
                                {isComplete ? <CheckCircle className="w-3 h-3" /> :
                                    isActive ? <div className="w-2 h-2 bg-white rounded-full animate-pulse" /> :
                                        idx + 1}
                            </div>

                            <div className="flex-1 pt-0.5">
                                <div className={cn(
                                    "text-sm font-medium leading-none mb-1 flex items-center justify-between",
                                    isActive ? "text-primary" : "text-muted-foreground"
                                )}>
                                    {step.label}
                                    {isActive && <span className="text-[10px] text-blue-500 animate-pulse">Processing...</span>}
                                </div>
                                {step.detail && (
                                    <div className="text-xs text-muted-foreground/80 font-mono bg-muted/30 px-2 py-1 rounded w-fit mt-1">
                                        {step.detail}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    );
                })}
            </div>
        </div>
    );
});
