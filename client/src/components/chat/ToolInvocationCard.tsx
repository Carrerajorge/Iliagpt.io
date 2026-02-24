import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Loader2,
    CheckCircle2,
    XCircle,
    ChevronDown,
    ChevronUpload,
    ShieldAlert,
    Play,
    TerminalSquare,
    Globe,
    Mail,
    Calendar,
    HardDrive,
    MessageSquare,
    Github,
    Database
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { JsonArgumentsViewer } from "./JsonArgumentsViewer";

export type ToolStatus = "running" | "succeeded" | "failed" | "requires_confirmation";

export interface ToolInvocationCardProps {
    toolName: string;
    status: ToolStatus;
    input?: any;
    output?: any;
    error?: string;
    onConfirm?: () => void;
    onDeny?: () => void;
    isConfirming?: boolean;
}

export function ToolInvocationCard({
    toolName,
    status,
    input,
    output,
    error,
    onConfirm,
    onDeny,
    isConfirming
}: ToolInvocationCardProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    // Map tool names to nice icons and colors
    const getToolConfig = (name: string) => {
        const lowerName = name.toLowerCase();
        if (lowerName.includes("gmail")) return { icon: <Mail className="h-4 w-4" />, color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/20" };
        if (lowerName.includes("calendar")) return { icon: <Calendar className="h-4 w-4" />, color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" };
        if (lowerName.includes("drive")) return { icon: <HardDrive className="h-4 w-4" />, color: "text-green-500", bg: "bg-green-500/10", border: "border-green-500/20" };
        if (lowerName.includes("slack")) return { icon: <MessageSquare className="h-4 w-4" />, color: "text-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/20" };
        if (lowerName.includes("github")) return { icon: <Github className="h-4 w-4" />, color: "text-zinc-700 dark:text-zinc-300", bg: "bg-zinc-500/10", border: "border-zinc-500/20" };
        if (lowerName.includes("notion")) return { icon: <img src="https://upload.wikimedia.org/wikipedia/commons/4/45/Notion_app_logo.png" className="w-4 h-4 object-contain opacity-80" alt="Notion" />, color: "text-zinc-800 dark:text-zinc-200", bg: "bg-zinc-500/10", border: "border-zinc-500/20" };
        if (lowerName.includes("hubspot")) return { icon: <Database className="h-4 w-4" />, color: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/20" };
        if (lowerName.includes("search") || lowerName.includes("web")) return { icon: <Globe className="h-4 w-4" />, color: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/20" };
        if (lowerName.includes("shell") || lowerName.includes("bash")) return { icon: <TerminalSquare className="h-4 w-4" />, color: "text-zinc-500", bg: "bg-zinc-500/10", border: "border-zinc-500/20" };

        // Default Lavanda
        return { icon: <Play className="h-4 w-4" />, color: "text-[#A7A3FF]", bg: "bg-[#A7A3FF]/10", border: "border-[#A7A3FF]/20" };
    };

    const config = getToolConfig(toolName);

    const getStatusDisplay = () => {
        switch (status) {
            case "running":
                return (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-blue-500 dark:text-blue-400">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Ejecutando...
                    </div>
                );
            case "succeeded":
                return (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-500 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        Completado
                    </div>
                );
            case "failed":
                return (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-rose-500 dark:text-rose-400">
                        <XCircle className="h-3 w-3" />
                        Error
                    </div>
                );
            case "requires_confirmation":
                return (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-amber-500 dark:text-amber-400">
                        <ShieldAlert className="h-3 w-3 animate-pulse" />
                        Requiere Confirmación
                    </div>
                );
        }
    };

    const formatToolName = (name: string) => {
        return name.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                "w-full rounded-xl border backdrop-blur-md overflow-hidden transition-all duration-300 shadow-sm",
                "bg-white/40 dark:bg-black/20",
                status === "running" ? "border-blue-200/50 dark:border-blue-500/30 shadow-blue-500/5" :
                    status === "succeeded" ? "border-emerald-200/50 dark:border-emerald-500/30" :
                        status === "failed" ? "border-rose-200/50 dark:border-rose-500/30 bg-rose-50/30 dark:bg-rose-950/20" :
                            status === "requires_confirmation" ? "border-amber-300/50 dark:border-amber-500/40 shadow-amber-500/10 bg-amber-50/40 dark:bg-amber-950/20" :
                                config.border
            )}
        >
            <div
                className={cn(
                    "flex items-center justify-between p-3 cursor-pointer select-none",
                    "hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                )}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    <div className={cn("p-2 rounded-lg flex items-center justify-center", config.bg, config.color)}>
                        {config.icon}
                    </div>
                    <div>
                        <div className="font-medium text-sm text-foreground flex items-center gap-2">
                            {formatToolName(toolName)}
                        </div>
                        {getStatusDisplay()}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {status === "requires_confirmation" && (
                        <div className="flex items-center gap-2 mr-2" onClick={e => e.stopPropagation()}>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={onDeny}
                                disabled={isConfirming}
                                className="h-7 text-xs border-amber-200 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-900/50 rounded-full px-3"
                            >
                                Cancelar
                            </Button>
                            <Button
                                size="sm"
                                onClick={onConfirm}
                                disabled={isConfirming}
                                className="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded-full px-4 shadow-md shadow-amber-500/20"
                            >
                                {isConfirming ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                                Permitir
                            </Button>
                        </div>
                    )}
                    <div className="text-muted-foreground transition-transform duration-200">
                        {isExpanded ? <ChevronDown className="h-4 w-4 rotate-180" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                </div>
            </div>

            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="overflow-hidden"
                    >
                        <div className="p-3 pt-0 border-t border-border/50 bg-black/5 dark:bg-white/5 flex flex-col gap-3">
                            {input && Object.keys(input).length > 0 && (
                                <div className="space-y-1.5 mt-2">
                                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Parámetros (Input)</div>
                                    <JsonArgumentsViewer
                                        args={Math.random() > 0 ? input : input /* forcing type */}
                                        title=""
                                        defaultExpanded={true}
                                        className="bg-background/60 shadow-inner border-black/5 dark:border-white/5"
                                    />
                                </div>
                            )}

                            {status === "failed" && error && (
                                <div className="space-y-1.5 mt-1">
                                    <div className="text-xs font-semibold text-rose-500 uppercase tracking-wider">Error Details</div>
                                    <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 font-mono whitespace-pre-wrap">
                                        {error}
                                    </div>
                                </div>
                            )}

                            {status === "succeeded" && output && (
                                <div className="space-y-1.5 mt-1">
                                    <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Resultado (Output)</div>
                                    <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40 text-xs text-foreground font-mono overflow-auto max-h-60 custom-scrollbar whitespace-pre-wrap">
                                        {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
                                    </div>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
