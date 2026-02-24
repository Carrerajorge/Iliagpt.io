import React, { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ThumbsUp, ThumbsDown, Flag, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface MessageFeedbackProps {
    messageId: string;
    conversationId?: string;
    className?: string;
    onFeedback?: (type: "positive" | "negative", messageId: string) => void;
}

export function MessageFeedback({
    messageId,
    conversationId,
    className,
    onFeedback
}: MessageFeedbackProps) {
    const [feedback, setFeedback] = useState<"positive" | "negative" | null>(null);
    const [copied, setCopied] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { toast } = useToast();

    const submitFeedback = useCallback(async (type: "positive" | "negative") => {
        if (feedback === type) return; // Already submitted this type

        setIsSubmitting(true);
        try {
            const response = await fetch("/api/feedback", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messageId,
                    conversationId,
                    feedbackType: type,
                    timestamp: new Date().toISOString()
                })
            });

            if (response.ok) {
                setFeedback(type);
                onFeedback?.(type, messageId);
                toast({
                    title: "¡Gracias por tu feedback!",
                    description: type === "positive"
                        ? "Nos alegra que te haya sido útil"
                        : "Trabajaremos para mejorar",
                    duration: 2000
                });
            }
        } catch (error) {
            console.error("Error submitting feedback:", error);
        } finally {
            setIsSubmitting(false);
        }
    }, [messageId, conversationId, feedback, onFeedback, toast]);

    const handleCopy = useCallback(async () => {
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        const text = messageElement?.textContent || "";

        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            toast({
                title: "¡Copiado!",
                duration: 1500
            });
        } catch (error) {
            console.error("Error copying:", error);
        }
    }, [messageId, toast]);

    return (
        <div className={cn(
            "flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity",
            className
        )}>
            {/* Copy button */}
            <button
                onClick={handleCopy}
                className={cn(
                    "p-1.5 rounded-md transition-colors",
                    "hover:bg-muted text-muted-foreground hover:text-foreground",
                    copied && "text-green-600"
                )}
                title="Copiar respuesta"
            >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>

            {/* Thumbs up */}
            <button
                onClick={() => submitFeedback("positive")}
                disabled={isSubmitting}
                className={cn(
                    "p-1.5 rounded-md transition-colors",
                    "hover:bg-muted text-muted-foreground hover:text-foreground",
                    feedback === "positive" && "text-green-600 bg-green-50 dark:bg-green-950/30"
                )}
                title="Respuesta útil"
            >
                <ThumbsUp className="w-4 h-4" />
            </button>

            {/* Thumbs down */}
            <button
                onClick={() => submitFeedback("negative")}
                disabled={isSubmitting}
                className={cn(
                    "p-1.5 rounded-md transition-colors",
                    "hover:bg-muted text-muted-foreground hover:text-foreground",
                    feedback === "negative" && "text-red-600 bg-red-50 dark:bg-red-950/30"
                )}
                title="Respuesta no útil"
            >
                <ThumbsDown className="w-4 h-4" />
            </button>
        </div>
    );
}

export default MessageFeedback;
