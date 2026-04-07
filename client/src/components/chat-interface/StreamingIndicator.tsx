/**
 * Streaming Indicator Component
 * Shows AI thinking/responding state
 */

import React from 'react';
import { motion } from 'framer-motion';
import { X, Brain, Sparkles, TimerReset, RefreshCcw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { StreamingIndicatorProps, isAiBusyState, isAiSendingState, isAiStreamingState } from './types';

function formatElapsed(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
}

export function StreamingIndicator({
    aiState,
    streamingContent,
    onCancel,
    uiPhase,
    aiProcessSteps = []
}: StreamingIndicatorProps) {
    const isBusy = isAiBusyState(aiState) || uiPhase === 'thinking';
    const [now, setNow] = React.useState(() => Date.now());

    React.useEffect(() => {
        if (!['queued', 'reconnecting', 'recovering'].includes(aiState)) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [aiState]);

    if (!isBusy) return null;

    const queueStep = aiProcessSteps.find((step) => step.id === 'conversation-queue' || step.title === 'En cola');
    const reconnectStep = aiProcessSteps.find((step) => step.id === 'stream-reconnect');
    const recoverStep = aiProcessSteps.find((step) => step.id === 'stream-recover');
    const isQueued = aiState === 'queued';
    const isReconnecting = aiState === 'reconnecting' || Boolean(reconnectStep);
    const isRecovering = aiState === 'recovering' || Boolean(recoverStep);
    const isSending = (isAiSendingState(aiState) || uiPhase === 'thinking') && !isQueued && !isReconnecting && !isRecovering;
    const isResponding = isAiStreamingState(aiState);
    const isAgentWorking = aiState === 'agent_working';

    const activeResilienceStep = isRecovering ? recoverStep : reconnectStep;
    const elapsedLabel =
        (isQueued ? queueStep?.startedAt : activeResilienceStep?.startedAt)
            ? formatElapsed(now - Number(isQueued ? queueStep?.startedAt : activeResilienceStep?.startedAt))
            : null;

    const statusTitle = isAgentWorking
        ? 'Trabajando...'
        : isQueued
            ? 'En cola...'
            : isRecovering
                ? 'Recuperando respuesta...'
                : isReconnecting
                    ? 'Reconectando...'
                    : isSending
                        ? 'Enviando...'
                        : 'Respondiendo...';

    const statusDescription = isQueued
        ? [
            typeof queueStep?.queuePosition === 'number' ? `Turno ${queueStep.queuePosition}` : null,
            elapsedLabel ? `esperando ${elapsedLabel}` : null,
            typeof queueStep?.retryAfterSeconds === 'number' ? `reintento sugerido en ${queueStep.retryAfterSeconds}s` : null,
          ].filter(Boolean).join(' · ') || 'Esperando turno para responder'
        : isRecovering || isReconnecting
            ? [
                activeResilienceStep?.description || null,
                elapsedLabel ? `desde hace ${elapsedLabel}` : null,
                typeof activeResilienceStep?.retryAfterSeconds === 'number' && activeResilienceStep.retryAfterSeconds > 0
                    ? `siguiente intento en ${activeResilienceStep.retryAfterSeconds}s`
                    : null,
              ].filter(Boolean).join(' · ') || 'Manteniendo viva la respuesta'
            : isResponding && streamingContent
                ? `${streamingContent.length} caracteres generados`
                : queueStep?.description || null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-3 px-4 py-3 bg-muted/50 rounded-lg border"
        >
            <div className={cn(
                "flex items-center justify-center w-8 h-8 rounded-full",
                isQueued
                    ? "bg-amber-500/20"
                    : isRecovering
                        ? "bg-emerald-500/20"
                        : isReconnecting
                            ? "bg-sky-500/20"
                            : isSending || isAgentWorking
                                ? "bg-blue-500/20"
                                : "bg-green-500/20"
            )}>
                {isQueued ? (
                    <TimerReset className="w-4 h-4 text-amber-500 animate-pulse" />
                ) : isRecovering ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-500 animate-pulse" />
                ) : isReconnecting ? (
                    <RefreshCcw className="w-4 h-4 text-sky-500 animate-spin" />
                ) : isSending || isAgentWorking ? (
                    <Brain className="w-4 h-4 text-blue-500 animate-pulse" />
                ) : (
                    <Sparkles className="w-4 h-4 text-green-500" />
                )}
            </div>

            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{statusTitle}</p>
                {statusDescription && (
                    <p className="text-xs text-muted-foreground truncate">{statusDescription}</p>
                )}
            </div>

            <div className="flex items-center gap-1">
                <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ repeat: Infinity, duration: 1 }}
                    className="w-2 h-2 bg-primary rounded-full"
                />
                <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                    className="w-2 h-2 bg-primary rounded-full"
                />
                <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ repeat: Infinity, duration: 1, delay: 0.4 }}
                    className="w-2 h-2 bg-primary rounded-full"
                />
            </div>

            <Button
                variant="ghost"
                size="icon"
                onClick={onCancel}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
                <X className="w-4 h-4" />
            </Button>
        </motion.div>
    );
}
