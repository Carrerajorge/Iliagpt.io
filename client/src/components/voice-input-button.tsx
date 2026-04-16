import { memo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useSpeechToText } from "@/hooks/use-voice";

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  onListeningChange?: (isListening: boolean) => void;
  className?: string;
  disabled?: boolean;
  language?: string;
}

export const VoiceInputButton = memo(function VoiceInputButton({
  onTranscript,
  onListeningChange,
  className,
  disabled = false,
  language = "es-ES",
}: VoiceInputButtonProps) {
  const {
    isListening,
    isSupported,
    transcript,
    startListening,
    stopListening,
  } = useSpeechToText({
    language,
    continuous: true,
    onResult: (text, isFinal) => {
      if (isFinal && text.trim()) {
        onTranscript(text.trim());
      }
    },
  });

  useEffect(() => {
    onListeningChange?.(isListening);
  }, [isListening, onListeningChange]);

  if (!isSupported) {
    return null;
  }

  const handleClick = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  return (
    <div className={cn("relative", className)}>
      <Button
        type="button"
        variant={isListening ? "default" : "ghost"}
        size="icon"
        onClick={handleClick}
        disabled={disabled}
        className={cn(
          "h-9 w-9 rounded-full transition-all",
          isListening && "bg-red-500 hover:bg-red-600 text-white"
        )}
        title={isListening ? "Detener grabación" : "Hablar"}
      >
        <AnimatePresence mode="wait">
          {isListening ? (
            <motion.div
              key="listening"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
            >
              <MicOff className="w-4 h-4" />
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
            >
              <Mic className="w-4 h-4" />
            </motion.div>
          )}
        </AnimatePresence>
      </Button>

      <AnimatePresence>
        {isListening && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute -top-1 -right-1"
          >
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

interface VoiceInputPanelProps {
  isListening: boolean;
  transcript: string;
  onStop: () => void;
  onClear: () => void;
  className?: string;
}

export const VoiceInputPanel = memo(function VoiceInputPanel({
  isListening,
  transcript,
  onStop,
  onClear,
  className,
}: VoiceInputPanelProps) {
  if (!isListening && !transcript) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className={cn(
        "p-3 rounded-lg border bg-card",
        "flex items-center gap-3",
        className
      )}
    >
      {isListening && (
        <div className="flex items-center gap-2">
          <span className="flex gap-0.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <motion.span
                key={i}
                className="w-1 bg-red-500 rounded-full"
                animate={{
                  height: [8, 16, 8],
                }}
                transition={{
                  duration: 0.5,
                  repeat: Infinity,
                  delay: i * 0.1,
                }}
              />
            ))}
          </span>
          <span className="text-sm text-muted-foreground">Escuchando...</span>
        </div>
      )}

      {transcript && (
        <p className="flex-1 text-sm truncate">{transcript}</p>
      )}

      <div className="flex items-center gap-1">
        {isListening && (
          <Button
            variant="outline"
            size="sm"
            onClick={onStop}
          >
            Detener
          </Button>
        )}
        {transcript && !isListening && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
          >
            Limpiar
          </Button>
        )}
      </div>
    </motion.div>
  );
});

export default VoiceInputButton;
