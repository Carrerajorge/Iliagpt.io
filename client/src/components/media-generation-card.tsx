import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clapperboard, Sparkles, Square } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MediaGenerationProgress {
  stage: "selecting" | "generating" | "fallback" | "processing" | "done";
  provider?: string;
  model?: string;
  modelLabel?: string;
  attempt?: number;
}

interface MediaGenerationCardProps {
  kind?: "image" | "video";
  prompt?: string;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  progress?: MediaGenerationProgress | null;
  onStop?: () => void;
  className?: string;
}

const ASPECT_CLASS: Record<NonNullable<MediaGenerationCardProps["aspectRatio"]>, string> = {
  "1:1": "aspect-square",
  "16:9": "aspect-video",
  "9:16": "aspect-[9/16]",
  "4:3": "aspect-[4/3]",
  "3:4": "aspect-[3/4]",
};

const FLAVOR_MESSAGES: Record<"image" | "video", string[]> = {
  image: [
    "Componiendo la escena…",
    "Iluminando los detalles…",
    "Refinando texturas y color…",
    "Ajustando la composición…",
  ],
  video: [
    "Planificando las escenas…",
    "Componiendo los fotogramas…",
    "Sincronizando el movimiento…",
    "Renderizando la secuencia…",
  ],
};

const PARTICLES = [
  { left: "14%", top: "26%", size: 5, delay: 0, color: "hsl(258 90% 66% / 0.9)", driftX: "10px" },
  { left: "78%", top: "20%", size: 4, delay: 0.9, color: "hsl(199 95% 60% / 0.9)", driftX: "-8px" },
  { left: "66%", top: "64%", size: 6, delay: 1.7, color: "hsl(330 85% 65% / 0.85)", driftX: "9px" },
  { left: "24%", top: "70%", size: 4, delay: 2.4, color: "hsl(45 95% 60% / 0.9)", driftX: "-7px" },
  { left: "48%", top: "16%", size: 3, delay: 3.1, color: "hsl(258 90% 66% / 0.7)", driftX: "6px" },
  { left: "86%", top: "46%", size: 3, delay: 3.9, color: "hsl(199 95% 60% / 0.7)", driftX: "-9px" },
];

function stageMessage(
  kind: "image" | "video",
  progress: MediaGenerationProgress | null | undefined,
  flavorIndex: number,
): string {
  const noun = kind === "video" ? "video" : "imagen";
  switch (progress?.stage) {
    case "selecting":
      return "Eligiendo el mejor modelo disponible…";
    case "fallback":
      return progress.modelLabel
        ? `Reintentando con ${progress.modelLabel}…`
        : "Probando con otro modelo…";
    case "processing":
      return "Aplicando los últimos retoques…";
    case "generating":
    default:
      if (flavorIndex === 0) return `Creando tu ${noun}…`;
      return FLAVOR_MESSAGES[kind][(flavorIndex - 1) % FLAVOR_MESSAGES[kind].length];
  }
}

/**
 * Animated placeholder shown while an image/video is being generated:
 * aurora canvas, particles, light sweep, live stage text and stop control.
 */
export function MediaGenerationCard({
  kind = "image",
  prompt,
  aspectRatio = "1:1",
  progress,
  onStop,
  className,
}: MediaGenerationCardProps) {
  const [flavorIndex, setFlavorIndex] = useState(0);

  // Rotate flavor copy while we sit in "generating" so the card feels alive
  // even when the provider emits no intermediate events.
  useEffect(() => {
    if (progress?.stage && progress.stage !== "generating") {
      setFlavorIndex(0);
      return;
    }
    const timer = setInterval(() => setFlavorIndex((index) => index + 1), 2600);
    return () => clearInterval(timer);
  }, [progress?.stage]);

  const message = stageMessage(kind, progress, flavorIndex);
  const Icon = kind === "video" ? Clapperboard : Sparkles;
  const title = kind === "video" ? "Generando video" : "Generando imagen";

  const modelChip = progress?.modelLabel || progress?.model;

  const particles = useMemo(() => PARTICLES, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className={cn("media-gen-card", className)}
      data-testid="media-generation-card"
    >
      <div className="media-gen-aurora" aria-hidden />

      <div className={cn("relative", ASPECT_CLASS[aspectRatio])}>
        <div className="media-gen-grid" aria-hidden />
        <div className="media-gen-sweep" aria-hidden />
        {particles.map((particle, index) => (
          <span
            key={index}
            className="media-gen-particle"
            aria-hidden
            style={{
              left: particle.left,
              top: particle.top,
              width: particle.size,
              height: particle.size,
              background: particle.color,
              animationDelay: `${particle.delay}s`,
              ["--drift-x" as string]: particle.driftX,
            }}
          />
        ))}

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="relative flex h-16 w-16 items-center justify-center">
            <span className="media-gen-ring" aria-hidden />
            <span className="media-gen-ring" aria-hidden />
            <div className="media-gen-icon-glow relative flex h-12 w-12 items-center justify-center rounded-2xl bg-background/80 backdrop-blur-sm">
              <Icon className="h-5 w-5 text-foreground" />
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <AnimatePresence mode="wait">
              <motion.p
                key={message}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25 }}
                className="text-xs text-muted-foreground"
              >
                {message}
              </motion.p>
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-1.5" aria-hidden>
            <span className="media-gen-dot" />
            <span className="media-gen-dot" />
            <span className="media-gen-dot" />
          </div>
        </div>

        {onStop && (
          <motion.button
            type="button"
            onClick={onStop}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background shadow-lg"
            title="Detener generación"
            aria-label="Detener generación"
            data-testid="media-generation-stop"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </motion.button>
        )}
      </div>

      <div className="space-y-2 px-4 pb-3.5 pt-3">
        <div className="media-gen-progressbar" aria-hidden />
        <div className="flex items-center justify-between gap-2">
          {prompt ? (
            <p className="truncate text-[11px] text-muted-foreground/80" title={prompt}>
              {prompt}
            </p>
          ) : (
            <span />
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="rounded-full border border-border/70 bg-background/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {aspectRatio}
            </span>
            {modelChip && (
              <AnimatePresence mode="wait">
                <motion.span
                  key={modelChip}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="max-w-[140px] truncate rounded-full border border-border/70 bg-background/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                  title={modelChip}
                >
                  {modelChip}
                </motion.span>
              </AnimatePresence>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

interface GeneratedMediaRevealProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * One-shot reveal for freshly generated media: blur-up + spring scale with a
 * single light sweep. Wrap the final <img>/<video> (or ArtifactViewer) once.
 */
export function GeneratedMediaReveal({ children, className }: GeneratedMediaRevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, filter: "blur(14px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      transition={{ type: "spring", stiffness: 200, damping: 24, mass: 0.9 }}
      className={cn("relative overflow-hidden rounded-2xl", className)}
    >
      {children}
      <span className="media-gen-reveal-flash" aria-hidden />
    </motion.div>
  );
}
