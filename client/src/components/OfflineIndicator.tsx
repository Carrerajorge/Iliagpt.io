
import { useState, useEffect } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

export function OfflineIndicator() {
    const [isOnline, setIsOnline] = useState(true);
    const [showRestored, setShowRestored] = useState(false);

    useEffect(() => {
        // Initial check
        setIsOnline(navigator.onLine);

        const handleOnline = () => {
            setIsOnline(true);
            setShowRestored(true);
            setTimeout(() => setShowRestored(false), 3000);
        };

        const handleOffline = () => {
            setIsOnline(false);
            setShowRestored(false);
        };

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
        };
    }, []);

    if (isOnline && !showRestored) return null;

    return (
        <AnimatePresence>
            {(!isOnline || showRestored) && (
                <motion.div
                    initial={{ y: -50, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -50, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="fixed top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
                >
                    <div className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-full shadow-lg border text-sm font-medium backdrop-blur-md",
                        !isOnline
                            ? "bg-destructive/90 text-destructive-foreground border-destructive"
                            : "bg-green-500/90 text-white border-green-600"
                    )}>
                        {!isOnline ? (
                            <>
                                <WifiOff className="h-3.5 w-3.5" />
                                <span>Sin conexión</span>
                            </>
                        ) : (
                            <>
                                <Wifi className="h-3.5 w-3.5" />
                                <span>Conexión restaurada</span>
                            </>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
