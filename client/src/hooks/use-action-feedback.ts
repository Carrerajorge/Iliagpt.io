/**
 * Unified Action Feedback Hook
 * 
 * Provides consistent toast notifications for common actions:
 * - Success: green checkmark with message
 * - Error: red X with message  
 * - Loading: spinner with message (auto-dismisses on complete)
 * - Info: neutral info message
 * 
 * Usage:
 * const feedback = useActionFeedback();
 * 
 * // Simple success
 * feedback.success("Archivo guardado");
 * 
 * // With async action
 * await feedback.withLoading(
 *   async () => await saveFile(),
 *   { loading: "Guardando...", success: "Guardado ✓", error: "Error al guardar" }
 * );
 */

import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Info, Loader2, AlertTriangle } from "lucide-react";
import { useCallback } from "react";

interface FeedbackMessages {
    loading?: string;
    success?: string;
    error?: string;
}

export function useActionFeedback() {
    const { toast, dismiss } = useToast();

    const success = useCallback((message: string, description?: string) => {
        toast({
            title: message,
            description,
            duration: 3000,
            className: "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800",
        });
    }, [toast]);

    const error = useCallback((message: string, description?: string) => {
        toast({
            title: message,
            description,
            variant: "destructive",
            duration: 5000,
        });
    }, [toast]);

    const info = useCallback((message: string, description?: string) => {
        toast({
            title: message,
            description,
            duration: 4000,
        });
    }, [toast]);

    const warning = useCallback((message: string, description?: string) => {
        toast({
            title: message,
            description,
            duration: 5000,
            className: "bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800",
        });
    }, [toast]);

    const loading = useCallback((message: string) => {
        const { id } = toast({
            title: message,
            duration: Infinity,
            className: "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800",
        });
        return id;
    }, [toast]);

    /**
     * Wrap an async action with loading/success/error feedback
     */
    const withLoading = useCallback(async <T,>(
        action: () => Promise<T>,
        messages: FeedbackMessages = {}
    ): Promise<T | null> => {
        const {
            loading: loadingMsg = "Procesando...",
            success: successMsg = "Completado ✓",
            error: errorMsg = "Error al procesar"
        } = messages;

        const loadingId = loading(loadingMsg);

        try {
            const result = await action();
            dismiss(loadingId);
            success(successMsg);
            return result;
        } catch (err) {
            dismiss(loadingId);
            error(errorMsg, err instanceof Error ? err.message : undefined);
            return null;
        }
    }, [loading, success, error, dismiss]);

    /**
     * Quick feedback for copy actions
     */
    const copied = useCallback((what = "Texto") => {
        success(`${what} copiado al portapapeles`);
    }, [success]);

    /**
     * Quick feedback for save actions
     */
    const saved = useCallback((what = "Cambios") => {
        success(`${what} guardados ✓`);
    }, [success]);

    /**
     * Quick feedback for delete actions
     */
    const deleted = useCallback((what = "Elemento") => {
        success(`${what} eliminado`);
    }, [success]);

    return {
        success,
        error,
        info,
        warning,
        loading,
        withLoading,
        // Quick shortcuts
        copied,
        saved,
        deleted,
    };
}

export default useActionFeedback;
