import React from 'react';
import { CheckCircle2, Loader2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { AiProcessStep } from './chat-interface/types';

interface ProductionProgressProps {
    steps: AiProcessStep[];
    className?: string;
}

export function ProductionProgress({ steps, className }: ProductionProgressProps) {
    if (!steps || steps.length === 0) return null;

    return (
        <div className={cn("w-full max-w-2xl bg-card/50 border rounded-xl p-4 shadow-sm backdrop-blur-sm", className)}>
            <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Estado de la solicitud
            </h3>
            <div className="space-y-3 relative">
                {/* Connector Line */}
                <div className="absolute left-[9px] top-2 bottom-4 w-px bg-border/50 -z-10" />

                {steps.map((step, idx) => (
                    <div key={step.id || idx} className="flex items-start gap-4">
                        <div className="mt-0.5 bg-background relative z-10">
                            {step.status === 'done' ? (
                                <CheckCircle2 className="h-5 w-5 text-green-500 fill-green-500/10" />
                            ) : step.status === 'active' ? (
                                <div className="relative">
                                    <div className="h-5 w-5 rounded-full border-2 border-primary/30" />
                                    <div className="absolute top-0 left-0 h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                                </div>
                            ) : (
                                <Circle className="h-5 w-5 text-muted-foreground/20 fill-background" />
                            )}
                        </div>
                        <div className="flex-1 space-y-1">
                            <p className={cn(
                                "text-sm font-medium leading-tight transition-colors",
                                step.status === 'active' ? "text-primary" :
                                    step.status === 'done' ? "text-foreground" : "text-muted-foreground"
                            )}>
                                {step.title || step.step || `Paso ${idx + 1}`}
                            </p>
                            {step.description && (step.status === 'active' || step.status === 'done') && (
                                <motion.p
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    className="text-xs text-muted-foreground leading-relaxed"
                                >
                                    {step.description}
                                </motion.p>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
