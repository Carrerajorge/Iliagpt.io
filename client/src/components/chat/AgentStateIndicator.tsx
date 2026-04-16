import React, { useMemo } from 'react';
import { Loader2, Terminal, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
// Note: In a real app we'd share the Zod schema or type across monorepo, 
// for now we replicate the type or assume it is passed down.
// We'll define a local interface matching strict output from backend.

export type AgentStatus = 'thinking' | 'executing_tool' | 'parsing_document' | 'ready' | 'error';

interface AgentStateIndicatorProps {
    status: AgentStatus;
    message?: string;
    className?: string;
}

export function AgentStateIndicator({ status, message, className }: AgentStateIndicatorProps) {
    const config = useMemo(() => {
        switch (status) {
            case 'thinking':
                return {
                    icon: Loader2,
                    color: 'text-blue-500',
                    bg: 'bg-blue-500/10',
                    animate: true,
                    label: 'Thinking...'
                };
            case 'executing_tool':
                return {
                    icon: Terminal,
                    color: 'text-purple-500',
                    bg: 'bg-purple-500/10',
                    animate: false, // Pulse instead of spin
                    label: 'Using Tool'
                };
            case 'parsing_document':
                return {
                    icon: FileText,
                    color: 'text-orange-500',
                    bg: 'bg-orange-500/10',
                    animate: true,
                    label: 'Reading Document'
                };
            case 'error':
                return {
                    icon: AlertCircle,
                    color: 'text-red-500',
                    bg: 'bg-red-500/10',
                    animate: false,
                    label: 'Error'
                };
            case 'ready':
            default:
                return {
                    icon: CheckCircle2,
                    color: 'text-green-500',
                    bg: 'bg-green-500/10',
                    animate: false,
                    label: 'Ready'
                };
        }
    }, [status]);

    if (status === 'ready' && !message) return null;

    const Icon = config.icon;

    return (
        <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-300",
            config.color,
            config.bg,
            "border-transparent bg-opacity-50 backdrop-blur-sm",
            className
        )}>
            <Icon className={cn(
                "w-3.5 h-3.5",
                config.animate && "animate-spin"
            )} />
            <span className="truncate max-w-[200px]">
                {message || config.label}
            </span>
        </div>
    );
}
