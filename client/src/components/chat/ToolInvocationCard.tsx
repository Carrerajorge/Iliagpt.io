import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Loader2,
    CheckCircle2,
    XCircle,
    ChevronDown,
    ChevronUp,
    ShieldAlert,
    Play,
    TerminalSquare,
    Globe,
    Mail,
    Calendar,
    HardDrive,
    MessageSquare,
    Github,
    Database,
    FileText,
    FileEdit,
    FolderOpen,
    Link,
    Search,
    BarChart3,
    Brain,
    BookOpen,
    Clock,
    Copy,
    Check,
    ExternalLink,
    Code2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
    streamingOutput?: string;
    statusMessage?: string;
    startedAt?: number;
}

function useElapsedTime(isRunning: boolean, startedAt?: number) {
    const [elapsed, setElapsed] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (isRunning) {
            const start = startedAt || Date.now();
            setElapsed(Math.floor((Date.now() - start) / 1000));
            intervalRef.current = setInterval(() => {
                setElapsed(Math.floor((Date.now() - start) / 1000));
            }, 1000);
        } else {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        }
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [isRunning, startedAt]);

    return elapsed;
}

function formatElapsed(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
}

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;

function RichOutputRenderer({ output, toolName }: { output: any; toolName: string }) {
    const [copied, setCopied] = useState(false);
    const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
    const lowerTool = toolName.toLowerCase();
    const isBashLike = lowerTool.includes("shell") || lowerTool.includes("bash") || lowerTool.includes("exec");
    const isWebTool = lowerTool.includes("web") || lowerTool.includes("fetch") || lowerTool.includes("browse") || lowerTool.includes("search");

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }, [text]);

    const urls = useMemo(() => {
        if (!isWebTool) return [];
        const matches = text.match(URL_REGEX);
        return matches ? [...new Set(matches)] : [];
    }, [text, isWebTool]);

    const renderTextWithLinks = useCallback((content: string) => {
        const parts = content.split(URL_REGEX);
        const matches = content.match(URL_REGEX) || [];
        const result: React.ReactNode[] = [];
        parts.forEach((part, i) => {
            result.push(part);
            if (matches[i]) {
                result.push(
                    <a
                        key={`link-${i}`}
                        href={matches[i]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:text-blue-600 underline underline-offset-2 decoration-blue-400/50 hover:decoration-blue-500 inline-flex items-center gap-0.5"
                        data-testid={`link-tool-output-${i}`}
                    >
                        {matches[i].length > 60 ? matches[i].substring(0, 57) + "..." : matches[i]}
                        <ExternalLink className="h-2.5 w-2.5 inline-block" />
                    </a>
                );
            }
        });
        return result;
    }, []);

    return (
        <div className="space-y-1.5 mt-1">
            <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                    Resultado (Output)
                </div>
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted/50"
                    data-testid="button-copy-output"
                >
                    {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copiado" : "Copiar"}
                </button>
            </div>
            <div
                className={cn(
                    "rounded-lg border text-xs overflow-auto max-h-72 custom-scrollbar",
                    isBashLike
                        ? "bg-zinc-950 border-zinc-800 text-green-400 font-mono p-3"
                        : "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-900/40 text-foreground font-mono p-2.5"
                )}
                data-testid="text-tool-output"
            >
                {isBashLike ? (
                    <div className="whitespace-pre-wrap break-words">
                        <span className="text-zinc-500 select-none">$ </span>
                        {renderTextWithLinks(text)}
                    </div>
                ) : (
                    <div className="whitespace-pre-wrap break-words">
                        {renderTextWithLinks(text)}
                    </div>
                )}
            </div>
            {isWebTool && urls.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                    {urls.slice(0, 5).map((url, i) => (
                        <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-800/40 text-[10px] text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                            data-testid={`link-source-${i}`}
                        >
                            <Globe className="h-2.5 w-2.5" />
                            {new URL(url).hostname}
                            <ExternalLink className="h-2 w-2" />
                        </a>
                    ))}
                </div>
            )}
        </div>
    );
}

function StreamingBashOutput({ content }: { content: string }) {
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, [content]);

    return (
        <div className="space-y-1.5 mt-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-500 dark:text-blue-400 uppercase tracking-wider">
                <TerminalSquare className="h-3 w-3" />
                Salida en Vivo
            </div>
            <div
                className="rounded-lg bg-zinc-950 border border-zinc-800 p-3 text-xs text-green-400 font-mono overflow-auto max-h-48 custom-scrollbar whitespace-pre-wrap"
                data-testid="text-streaming-output"
            >
                {content}
                <span className="inline-block w-1.5 h-3.5 bg-green-400 animate-pulse ml-0.5 align-text-bottom" />
                <div ref={endRef} />
            </div>
        </div>
    );
}

export function ToolInvocationCard({
    toolName,
    status,
    input,
    output,
    error,
    onConfirm,
    onDeny,
    isConfirming,
    streamingOutput,
    statusMessage,
    startedAt
}: ToolInvocationCardProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const elapsed = useElapsedTime(status === "running", startedAt);

    const getToolConfig = (name: string) => {
        const lowerName = name.toLowerCase();
        if (lowerName.includes("gmail")) return { icon: <Mail className="h-4 w-4" />, color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/20" };
        if (lowerName.includes("calendar")) return { icon: <Calendar className="h-4 w-4" />, color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" };
        if (lowerName.includes("drive")) return { icon: <HardDrive className="h-4 w-4" />, color: "text-green-500", bg: "bg-green-500/10", border: "border-green-500/20" };
        if (lowerName.includes("slack")) return { icon: <MessageSquare className="h-4 w-4" />, color: "text-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/20" };
        if (lowerName.includes("github")) return { icon: <Github className="h-4 w-4" />, color: "text-zinc-700 dark:text-zinc-300", bg: "bg-zinc-500/10", border: "border-zinc-500/20" };
        if (lowerName.includes("notion")) return { icon: <img src="https://upload.wikimedia.org/wikipedia/commons/4/45/Notion_app_logo.png" className="w-4 h-4 object-contain opacity-80" alt="Notion" />, color: "text-zinc-800 dark:text-zinc-200", bg: "bg-zinc-500/10", border: "border-zinc-500/20" };
        if (lowerName.includes("hubspot")) return { icon: <Database className="h-4 w-4" />, color: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/20" };
        if (lowerName.includes("web_search") || lowerName === "search") return { icon: <Search className="h-4 w-4" />, color: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/20" };
        if (lowerName.includes("web_fetch") || lowerName.includes("fetch_url")) return { icon: <Link className="h-4 w-4" />, color: "text-cyan-500", bg: "bg-cyan-500/10", border: "border-cyan-500/20" };
        if (lowerName.includes("shell") || lowerName.includes("bash")) return { icon: <TerminalSquare className="h-4 w-4" />, color: "text-zinc-500", bg: "bg-zinc-500/10", border: "border-zinc-500/20" };
        if (lowerName.includes("read_file")) return { icon: <FileText className="h-4 w-4" />, color: "text-sky-500", bg: "bg-sky-500/10", border: "border-sky-500/20" };
        if (lowerName.includes("write_file")) return { icon: <FileText className="h-4 w-4" />, color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" };
        if (lowerName.includes("edit_file")) return { icon: <FileEdit className="h-4 w-4" />, color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" };
        if (lowerName.includes("list_files")) return { icon: <FolderOpen className="h-4 w-4" />, color: "text-violet-500", bg: "bg-violet-500/10", border: "border-violet-500/20" };
        if (lowerName.includes("rag_index") || lowerName.includes("rag_search")) return { icon: <BookOpen className="h-4 w-4" />, color: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20" };
        if (lowerName.includes("analyze_data")) return { icon: <BarChart3 className="h-4 w-4" />, color: "text-teal-500", bg: "bg-teal-500/10", border: "border-teal-500/20" };
        if (lowerName.includes("browse")) return { icon: <Globe className="h-4 w-4" />, color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" };
        if (lowerName.includes("code") || lowerName.includes("python") || lowerName.includes("node")) return { icon: <Code2 className="h-4 w-4" />, color: "text-yellow-500", bg: "bg-yellow-500/10", border: "border-yellow-500/20" };
        if (lowerName.includes("process")) return { icon: <TerminalSquare className="h-4 w-4" />, color: "text-pink-500", bg: "bg-pink-500/10", border: "border-pink-500/20" };
        if (lowerName.includes("search") || lowerName.includes("web")) return { icon: <Globe className="h-4 w-4" />, color: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/20" };

        return { icon: <Play className="h-4 w-4" />, color: "text-[#A7A3FF]", bg: "bg-[#A7A3FF]/10", border: "border-[#A7A3FF]/20" };
    };

    const config = getToolConfig(toolName);

    const getStatusDisplay = () => {
        switch (status) {
            case "running":
                return (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-blue-500 dark:text-blue-400">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>{statusMessage || "Ejecutando..."}</span>
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground ml-1 tabular-nums">
                            <Clock className="h-2.5 w-2.5" />
                            {formatElapsed(elapsed)}
                        </span>
                    </div>
                );
            case "succeeded":
                return (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-500 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        Completado
                        {elapsed > 0 && (
                            <span className="text-[10px] text-muted-foreground ml-1">({formatElapsed(elapsed)})</span>
                        )}
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
            data-testid={`card-tool-${toolName}`}
        >
            <div
                className={cn(
                    "flex items-center justify-between p-3 cursor-pointer select-none",
                    "hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                )}
                onClick={() => setIsExpanded(!isExpanded)}
                data-testid={`button-expand-tool-${toolName}`}
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
                                data-testid="button-deny-tool"
                            >
                                Cancelar
                            </Button>
                            <Button
                                size="sm"
                                onClick={onConfirm}
                                disabled={isConfirming}
                                className="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded-full px-4 shadow-md shadow-amber-500/20"
                                data-testid="button-confirm-tool"
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
                                        args={input}
                                        title=""
                                        defaultExpanded={true}
                                        className="bg-background/60 shadow-inner border-black/5 dark:border-white/5"
                                    />
                                </div>
                            )}

                            {status === "running" && streamingOutput && (
                                <StreamingBashOutput content={streamingOutput} />
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
                                <RichOutputRenderer output={output} toolName={toolName} />
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
