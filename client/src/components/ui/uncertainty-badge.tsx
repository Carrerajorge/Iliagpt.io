import React from 'react';
import { AlertTriangle, AlertCircle, HelpCircle } from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

interface UncertaintyBadgeProps {
    confidence: ConfidenceLevel;
    reason?: string;
    className?: string;
}

export function UncertaintyBadge({ confidence, reason, className }: UncertaintyBadgeProps) {
    if (confidence === 'high') return null;

    const config = {
        medium: {
            icon: HelpCircle,
            color: 'text-yellow-600 dark:text-yellow-400',
            bg: 'bg-yellow-500/10 border-yellow-500/20',
            label: 'Certeza Media',
            defaultReason: 'La respuesta podría no ser completa o exacta.'
        },
        low: {
            icon: AlertTriangle,
            color: 'text-orange-600 dark:text-orange-400',
            bg: 'bg-orange-500/10 border-orange-500/20',
            label: 'Certeza Baja',
            defaultReason: 'La información no ha podido ser verificada completamente.'
        }
    };

    const { icon: Icon, color, bg, label, defaultReason } = config[confidence];
    const tooltipText = reason || defaultReason;

    return (
        <TooltipProvider>
            <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                    <div
                        className={cn(
                            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-medium cursor-help transition-colors select-none",
                            bg,
                            color,
                            className
                        )}
                        role="status"
                        aria-label={`${label}: ${tooltipText}`}
                    >
                        <Icon className="h-3.5 w-3.5" />
                        <span>{label}</span>
                    </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                    <p>{tooltipText}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
