import React from "react";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Sparkles } from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface VerificationBadgeProps {
    verified: boolean;
    attempts?: number;
    className?: string;
}

export function VerificationBadge({ verified, attempts, className }: VerificationBadgeProps) {
    if (!verified) return null;

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Badge
                        variant="outline"
                        className={`gap-1 bg-green-50 text-green-700 border-green-200 hover:bg-green-100 ${className || ''}`}
                    >
                        <ShieldCheck className="w-3 h-3" />
                        <span className="text-[10px] font-medium">Verificado</span>
                        {attempts && attempts > 1 && (
                            <span className="ml-[1px] text-[9px] opacity-80">(Auto-corrected)</span>
                        )}
                    </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                    <div className="flex flex-col gap-1">
                        <p className="font-semibold flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-yellow-500" />
                            Respuesta Validada
                        </p>
                        <p className="text-muted-foreground">
                            El agente verificó y corrigió esta respuesta automáticamente {attempts && attempts > 1 ? `(${attempts} intentos)` : ''}.
                        </p>
                    </div>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
