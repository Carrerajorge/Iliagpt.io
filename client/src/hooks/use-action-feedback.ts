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

import { toast } from "sonner";
import { useCallback } from "react";

interface FeedbackMessages {
    loading?: string;
    success?: string;
    error?: string;
}

export function useActionFeedback() {
    const success = useCallback((message: string, description?: string) => {
        toast.success(message, { description, duration: 3000 });
    }, []);

    const error = useCallback((message: string, description?: string) => {
        toast.error(message, { description, duration: 5000 });
    }, []);

    const info = useCallback((message: string, description?: string) => {
        toast.info(message, { description, duration: 4000 });
    }, []);

    const warning = useCallback((message: string, description?: string) => {
        toast.warning(message, { description, duration: 5000 });
    }, []);

    const loading = useCallback((message: string) => {
        const id = toast.loading(message);
        return String(id);
    }, []);

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

        const loadingId = toast.loading(loadingMsg);

        try {
            const result = await action();
            toast.dismiss(loadingId);
            toast.success(successMsg);
            return result;
        } catch (err) {
            toast.dismiss(loadingId);
            toast.error(errorMsg, {
                description: err instanceof Error ? err.message : undefined,
                duration: 5000,
            });
            return null;
        }
    }, []);

    /**
     * Quick feedback for copy actions
     */
    const copied = useCallback((what = "Texto") => {
        toast.success(`${what} copiado al portapapeles`);
    }, []);

    /**
     * Quick feedback for save actions
     */
    const saved = useCallback((what = "Cambios") => {
        toast.success(`${what} guardados ✓`);
    }, []);

    /**
     * Quick feedback for delete actions
     */
    const deleted = useCallback((what = "Elemento") => {
        toast.success(`${what} eliminado`);
    }, []);

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
