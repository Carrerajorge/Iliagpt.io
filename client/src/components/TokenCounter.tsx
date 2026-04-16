/**
 * Token Counter Component
 * Real-time token and cost estimation
 */

import React, { useMemo } from 'react';
import { Coins, DollarSign, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';

// Model pricing (per 1M tokens)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
    'llama3-8b': { input: 0.00, output: 0.00 },
    'mistral': { input: 0.00, output: 0.00 },
    'grok-3': { input: 3.00, output: 15.00 },
    'grok-3-fast': { input: 5.00, output: 15.00 },
    'grok-3-mini': { input: 0.30, output: 0.50 },
    'grok-3-mini-fast': { input: 0.60, output: 4.00 },
    'grok-2-vision': { input: 2.00, output: 10.00 },
    'gemini-2.5-pro': { input: 1.25, output: 10.00 },
    'claude-3.5-sonnet': { input: 3.00, output: 15.00 },
};

// Simple tokenizer estimation (approx 4 chars per token for Spanish/English)
function estimateTokens(text: string): number {
    if (!text) return 0;
    // More accurate estimation considering code, numbers, and special chars
    const words = text.split(/\s+/).length;
    const chars = text.length;
    return Math.ceil(Math.max(words * 1.3, chars / 4));
}

interface TokenCounterProps {
    text: string;
    model?: string;
    showCost?: boolean;
    className?: string;
    variant?: 'default' | 'compact' | 'detailed';
}

export function TokenCounter({
    text,
    model = 'grok-3-fast',
    showCost = true,
    className,
    variant = 'default',
}: TokenCounterProps) {
    const tokens = useMemo(() => estimateTokens(text), [text]);

    const pricing = MODEL_PRICING[model] || MODEL_PRICING['grok-3-fast'];
    const cost = (tokens / 1_000_000) * pricing.input;

    const formatTokens = (count: number): string => {
        if (count >= 1000) {
            return `${(count / 1000).toFixed(1)}k`;
        }
        return count.toString();
    };

    const formatCost = (amount: number): string => {
        if (amount < 0.001) {
            return '<$0.001';
        }
        return `$${amount.toFixed(4)}`;
    };

    if (variant === 'compact') {
        return (
            <span className={cn("text-xs text-muted-foreground", className)}>
                {formatTokens(tokens)} tokens
            </span>
        );
    }

    if (variant === 'detailed') {
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className={cn(
                            "flex items-center gap-3 px-3 py-1.5 rounded-md bg-muted/50 text-sm",
                            className
                        )}>
                            <div className="flex items-center gap-1">
                                <Coins className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>{formatTokens(tokens)}</span>
                            </div>
                            {showCost && (
                                <div className="flex items-center gap-1">
                                    <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span>{formatCost(cost)}</span>
                                </div>
                            )}
                            <Info className="h-3 w-3 text-muted-foreground" />
                        </div>
                    </TooltipTrigger>
                    <TooltipContent>
                        <div className="space-y-1 text-xs">
                            <p><strong>Modelo:</strong> {model}</p>
                            <p><strong>Tokens estimados:</strong> {tokens.toLocaleString()}</p>
                            <p><strong>Precio input:</strong> ${pricing.input}/1M tokens</p>
                            <p><strong>Precio output:</strong> ${pricing.output}/1M tokens</p>
                            <p><strong>Costo estimado:</strong> {formatCost(cost)}</p>
                        </div>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    }

    // Default variant
    return (
        <div className={cn(
            "flex items-center gap-2 text-xs text-muted-foreground",
            className
        )}>
            <span>{formatTokens(tokens)} tokens</span>
            {showCost && cost > 0 && (
                <>
                    <span>•</span>
                    <span>{formatCost(cost)}</span>
                </>
            )}
        </div>
    );
}

/**
 * Token progress bar for context limits
 */
interface TokenProgressProps {
    used: number;
    limit: number;
    className?: string;
}

export function TokenProgress({ used, limit, className }: TokenProgressProps) {
    const percentage = Math.min((used / limit) * 100, 100);

    const getColor = () => {
        if (percentage >= 90) return 'bg-red-500';
        if (percentage >= 75) return 'bg-yellow-500';
        return 'bg-green-500';
    };

    return (
        <div className={cn("space-y-1", className)}>
            <div className="flex justify-between text-xs text-muted-foreground">
                <span>{used.toLocaleString()} / {limit.toLocaleString()} tokens</span>
                <span>{percentage.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                    className={cn("h-full transition-all duration-300", getColor())}
                    style={{ width: `${percentage}%` }}
                />
            </div>
        </div>
    );
}

/**
 * Hook for tracking conversation tokens
 */
import { useState, useCallback } from 'react';

interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export function useTokenTracking(model: string = 'grok-3-fast') {
    const [messages, setMessages] = useState<Message[]>([]);

    const totalTokens = useMemo(() => {
        return messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
    }, [messages]);

    const pricing = MODEL_PRICING[model] || MODEL_PRICING['grok-3-fast'];

    const inputTokens = useMemo(() => {
        return messages
            .filter(m => m.role === 'user' || m.role === 'system')
            .reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
    }, [messages]);

    const outputTokens = useMemo(() => {
        return messages
            .filter(m => m.role === 'assistant')
            .reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
    }, [messages]);

    const totalCost = useMemo(() => {
        const inputCost = (inputTokens / 1_000_000) * pricing.input;
        const outputCost = (outputTokens / 1_000_000) * pricing.output;
        return inputCost + outputCost;
    }, [inputTokens, outputTokens, pricing]);

    const addMessage = useCallback((message: Message) => {
        setMessages(prev => [...prev, message]);
    }, []);

    const clearMessages = useCallback(() => {
        setMessages([]);
    }, []);

    return {
        messages,
        totalTokens,
        inputTokens,
        outputTokens,
        totalCost,
        addMessage,
        clearMessages,
        estimateTokens,
    };
}
