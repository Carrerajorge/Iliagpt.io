import { memo } from "react";
import { cn } from "@/lib/utils";
import { Volume2, VolumeX, Pause, Play } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useTextToSpeech } from "@/hooks/use-voice";

interface TextToSpeechButtonProps {
  text: string;
  className?: string;
  disabled?: boolean;
  language?: string;
  variant?: "icon" | "full";
}

export const TextToSpeechButton = memo(function TextToSpeechButton({
  text,
  className,
  disabled = false,
  language = "es-ES",
  variant = "icon",
}: TextToSpeechButtonProps) {
  const {
    isSpeaking,
    isSupported,
    speak,
    stop,
    pause,
    resume,
  } = useTextToSpeech({ language });

  if (!isSupported) {
    return null;
  }

  const handleClick = () => {
    if (isSpeaking) {
      stop();
    } else {
      speak(text);
    }
  };

  if (variant === "icon") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleClick}
        disabled={disabled || !text}
        className={cn(
          "h-7 w-7 rounded-full",
          isSpeaking && "text-primary",
          className
        )}
        title={isSpeaking ? "Detener lectura" : "Leer en voz alta"}
      >
        <AnimatePresence mode="wait">
          {isSpeaking ? (
            <motion.div
              key="speaking"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
            >
              <VolumeX className="w-4 h-4" />
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
            >
              <Volume2 className="w-4 h-4" />
            </motion.div>
          )}
        </AnimatePresence>
      </Button>
    );
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        type="button"
        variant={isSpeaking ? "default" : "outline"}
        size="sm"
        onClick={handleClick}
        disabled={disabled || !text}
        className="gap-1.5"
      >
        {isSpeaking ? (
          <>
            <VolumeX className="w-3.5 h-3.5" />
            Detener
          </>
        ) : (
          <>
            <Volume2 className="w-3.5 h-3.5" />
            Escuchar
          </>
        )}
      </Button>

      {isSpeaking && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={pause}
            className="h-8 w-8"
            title="Pausar"
          >
            <Pause className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={resume}
            className="h-8 w-8"
            title="Continuar"
          >
            <Play className="w-3.5 h-3.5" />
          </Button>
        </>
      )}
    </div>
  );
});

interface SpeakingIndicatorProps {
  isSpeaking: boolean;
  className?: string;
}

export const SpeakingIndicator = memo(function SpeakingIndicator({
  isSpeaking,
  className,
}: SpeakingIndicatorProps) {
  if (!isSpeaking) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={cn("flex items-center gap-1", className)}
    >
      <Volume2 className="w-3 h-3 text-primary" />
      <span className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-0.5 bg-primary rounded-full"
            animate={{
              height: [4, 10, 4],
            }}
            transition={{
              duration: 0.4,
              repeat: Infinity,
              delay: i * 0.1,
            }}
          />
        ))}
      </span>
    </motion.div>
  );
});

export default TextToSpeechButton;
