import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, Zap, Crown, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface UpgradePromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  queryCount: number;
}

export function UpgradePromptModal({
  isOpen,
  onClose,
  onUpgrade,
  queryCount,
}: UpgradePromptModalProps) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md"
          >
            <div className="relative bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 border border-purple-500/30 rounded-2xl p-6 shadow-2xl shadow-purple-500/20">
              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Decorative gradient orb */}
              <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-40 h-40 bg-purple-500/30 rounded-full blur-3xl pointer-events-none" />

              {/* Icon */}
              <div className="flex justify-center mb-4">
                <motion.div
                  animate={{ rotate: [0, 10, -10, 0] }}
                  transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                  className="relative"
                >
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/40">
                    <Crown className="w-8 h-8 text-white" />
                  </div>
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="absolute -top-1 -right-1"
                  >
                    <Sparkles className="w-5 h-5 text-yellow-400" />
                  </motion.div>
                </motion.div>
              </div>

              {/* Title */}
              <h2 className="text-2xl font-bold text-center text-white mb-2">
                ¡Mejora tu experiencia!
              </h2>

              {/* Subtitle */}
              <p className="text-center text-gray-300 mb-6">
                Has realizado <span className="font-semibold text-purple-400">{queryCount} consultas</span>. 
                Desbloquea todo el potencial de iliagpt con un plan premium.
              </p>

              {/* Benefits */}
              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-3 text-gray-200">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                    <Zap className="w-4 h-4 text-purple-400" />
                  </div>
                  <span>Respuestas más rápidas y detalladas</span>
                </div>
                <div className="flex items-center gap-3 text-gray-200">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-blue-400" />
                  </div>
                  <span>Acceso a modelos avanzados de IA</span>
                </div>
                <div className="flex items-center gap-3 text-gray-200">
                  <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
                    <Crown className="w-4 h-4 text-green-400" />
                  </div>
                  <span>Sin límites de consultas</span>
                </div>
              </div>

              {/* CTA Buttons */}
              <div className="flex flex-col gap-3">
                <Button
                  onClick={onUpgrade}
                  className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold py-6 rounded-xl shadow-lg shadow-purple-500/30 transition-all hover:shadow-purple-500/50"
                >
                  <span>Mejorar plan desde $5/mes</span>
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-gray-200 text-sm transition-colors"
                >
                  Continuar con plan gratuito
                </button>
              </div>

              {/* Bottom decoration */}
              <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-60 h-20 bg-pink-500/20 rounded-full blur-3xl pointer-events-none" />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Hook to manage upgrade prompt state
export function useUpgradePrompt(userPlan: string | undefined, userRole?: string | null) {
  const [showPrompt, setShowPrompt] = React.useState(false);
  const [queryCount, setQueryCount] = React.useState(0);
  const [lastPromptQuery, setLastPromptQuery] = React.useState(0);
  
  const role = (userRole || "").trim().toLowerCase();
  const isAdmin = role === "admin" || role === "superadmin";
  const isFreeUser = !isAdmin && (!userPlan || userPlan === "free");
  
  // Increment query count and check if should show prompt
  const incrementQuery = React.useCallback(() => {
    if (!isFreeUser) return;
    
    setQueryCount(prev => {
      const newCount = prev + 1;
      
      // Show prompt at query 3, then every 5 queries (8, 13, 18, etc.)
      const shouldShow = 
        (newCount === 3) || 
        (newCount > 3 && (newCount - 3) % 5 === 0 && newCount !== lastPromptQuery);
      
      if (shouldShow) {
        // Delay the prompt slightly so it doesn't interrupt the response
        setTimeout(() => {
          setShowPrompt(true);
          setLastPromptQuery(newCount);
        }, 2000);
      }
      
      return newCount;
    });
  }, [isFreeUser, lastPromptQuery]);
  
  const closePrompt = React.useCallback(() => {
    setShowPrompt(false);
  }, []);
  
  return {
    showPrompt,
    queryCount,
    incrementQuery,
    closePrompt,
    isFreeUser,
  };
}
