import { memo, useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

type ThinkingPhase = 
  | "connecting"
  | "searching" 
  | "analyzing" 
  | "processing"
  | "generating"
  | "responding"
  | "finalizing";

interface ThinkingIndicatorProps {
  phase?: ThinkingPhase;
  message?: string;
  className?: string;
  variant?: "minimal" | "detailed" | "inline" | "phase-narrator";
  isSearching?: boolean;
  userQuery?: string;
}

const phaseSequence: ThinkingPhase[] = [
  "connecting",
  "searching",
  "analyzing", 
  "processing",
  "generating",
  "responding",
  "finalizing"
];

function extractKeywords(query: string): string {
  if (!query || query.length < 3) return "";
  const words = query.trim().split(/\s+/).filter(w => w.length > 3);
  if (words.length === 0) return query.slice(0, 30);
  const keywords = words.slice(0, 3).join(" ");
  return keywords.length > 40 ? keywords.slice(0, 37) + "…" : keywords;
}

function generateContextualNarration(phase: ThinkingPhase, userQuery?: string): string {
  const keywords = userQuery ? extractKeywords(userQuery) : "";
  const hasContext = keywords.length > 0;
  
  switch (phase) {
    case "connecting":
      return hasContext ? `Preparando: "${keywords}"` : "Preparando respuesta";
    case "searching":
      return hasContext ? `Buscando sobre ${keywords}` : "Analizando consulta";
    case "analyzing":
      return hasContext ? `Analizando: ${keywords}` : "Evaluando contexto";
    case "processing":
      return hasContext ? `Procesando: ${keywords}` : "Organizando información";
    case "generating":
      return hasContext ? `Generando respuesta sobre ${keywords}` : "Estructurando respuesta";
    case "responding":
      return "Escribiendo respuesta";
    case "finalizing":
      return "Finalizando";
    default:
      return "Procesando";
  }
}

const phaseDurations: Record<ThinkingPhase, number> = {
  connecting: 600,
  searching: 2800,
  analyzing: 2200,
  processing: 1800,
  generating: 1400,
  responding: 1600,
  finalizing: 800
};

export const PhaseNarrator = memo(function PhaseNarrator({
  phase,
  message,
  className,
  autoProgress = true,
  userQuery
}: {
  phase?: ThinkingPhase;
  message?: string;
  className?: string;
  autoProgress?: boolean;
  userQuery?: string;
}) {
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const [currentNarration, setCurrentNarration] = useState("");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const phaseStartTime = useRef(Date.now());
  const animationFrame = useRef<number | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const lastNarration = useRef<string>("");

  const currentPhase = phase || phaseSequence[currentPhaseIndex];

  const updateNarration = useCallback((newNarration: string, immediate = false) => {
    if (newNarration === lastNarration.current) return;
    
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    const doUpdate = () => {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentNarration(newNarration);
        lastNarration.current = newNarration;
        setIsTransitioning(false);
      }, 80);
    };

    if (immediate) {
      doUpdate();
    } else {
      debounceTimer.current = setTimeout(doUpdate, 150);
    }
  }, []);

  useEffect(() => {
    if (message) {
      updateNarration(message, true);
      return;
    }

    const narration = generateContextualNarration(currentPhase, userQuery);
    updateNarration(narration, true);
  }, [currentPhase, message, userQuery, updateNarration]);

  useEffect(() => {
    if (!autoProgress || phase) return;

    phaseStartTime.current = Date.now();
    
    const progressPhase = () => {
      const elapsed = Date.now() - phaseStartTime.current;
      const currentPhaseDuration = phaseDurations[phaseSequence[currentPhaseIndex]];
      
      if (elapsed >= currentPhaseDuration && currentPhaseIndex < phaseSequence.length - 2) {
        setCurrentPhaseIndex(prev => prev + 1);
        phaseStartTime.current = Date.now();
      }
      
      animationFrame.current = requestAnimationFrame(progressPhase);
    };
    
    animationFrame.current = requestAnimationFrame(progressPhase);
    
    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, [autoProgress, phase, currentPhaseIndex]);

  useEffect(() => {
    setCurrentPhaseIndex(0);
    phaseStartTime.current = Date.now();
    
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  return (
    <div className={cn("phase-narrator-v2", className)}>
      <div className="phase-narrator-container">
        <span 
          className={cn(
            "phase-narrator-text",
            isTransitioning && "transitioning"
          )}
        >
          {currentNarration}
        </span>
        <div className="phase-lightning-bar" />
      </div>

      <style>{`
        .phase-narrator-v2 {
          position: relative;
          display: inline-block;
        }
        
        .phase-narrator-container {
          position: relative;
          overflow: hidden;
          padding: 2px 0;
        }
        
        .phase-narrator-text {
          font-size: 0.875rem;
          font-weight: 500;
          letter-spacing: -0.01em;
          color: rgb(100, 100, 110);
          display: inline-block;
          transition: opacity 80ms ease-out, transform 80ms ease-out;
        }
        
        .dark .phase-narrator-text {
          color: rgb(160, 160, 175);
        }
        
        .phase-narrator-text.transitioning {
          opacity: 0;
          transform: translateY(-2px);
        }
        
        .phase-lightning-bar {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            transparent 20%,
            rgb(30, 64, 175) 35%,
            rgb(59, 130, 246) 45%,
            rgb(96, 165, 250) 50%,
            rgb(59, 130, 246) 55%,
            rgb(30, 64, 175) 65%,
            transparent 80%,
            transparent 100%
          );
          background-size: 200% 100%;
          animation: lightning-sweep 1.2s ease-in-out infinite;
          opacity: 0.9;
          border-radius: 1px;
        }
        
        .dark .phase-lightning-bar {
          background: linear-gradient(
            90deg,
            transparent 0%,
            transparent 20%,
            rgb(37, 99, 235) 35%,
            rgb(96, 165, 250) 45%,
            rgb(147, 197, 253) 50%,
            rgb(96, 165, 250) 55%,
            rgb(37, 99, 235) 65%,
            transparent 80%,
            transparent 100%
          );
          background-size: 200% 100%;
          opacity: 0.85;
        }
        
        @keyframes lightning-sweep {
          0% {
            background-position: 100% 0;
            opacity: 0;
          }
          10% {
            opacity: 0.9;
          }
          90% {
            opacity: 0.9;
          }
          100% {
            background-position: -100% 0;
            opacity: 0;
          }
        }
        
        @media (prefers-reduced-motion: reduce) {
          .phase-narrator-text {
            transition: none;
          }
          .phase-lightning-bar {
            animation: none;
            opacity: 0.4;
            background: rgb(59, 130, 246);
          }
        }
      `}</style>
    </div>
  );
});

export const ThinkingIndicator = memo(function ThinkingIndicator({
  phase,
  message,
  className,
  variant = "phase-narrator",
  isSearching = false,
  userQuery,
}: ThinkingIndicatorProps) {

  const effectivePhase = isSearching ? "searching" : phase;

  if (variant === "phase-narrator") {
    return (
      <div 
        className={cn(
          "inline-flex items-center py-2",
          className
        )}
        data-testid="thinking-indicator"
      >
        <PhaseNarrator 
          phase={effectivePhase} 
          message={message} 
          autoProgress={!effectivePhase}
          userQuery={userQuery}
        />
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <PhaseNarrator 
          phase={effectivePhase} 
          message={message} 
          autoProgress={!effectivePhase}
          userQuery={userQuery}
        />
      </span>
    );
  }

  if (variant === "minimal") {
    return (
      <div className={cn("flex items-center gap-2 py-2", className)}>
        <PhaseNarrator 
          phase={effectivePhase} 
          message={message} 
          autoProgress={!effectivePhase}
          userQuery={userQuery}
        />
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-3 py-2", className)}>
      <PhaseNarrator 
        phase={effectivePhase} 
        message={message} 
        autoProgress={!effectivePhase}
        userQuery={userQuery}
      />
    </div>
  );
});

interface ThinkingDotsProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

export const ThinkingDots = memo(function ThinkingDots({
  className,
  size = "md",
}: ThinkingDotsProps) {
  const sizeClasses = {
    sm: "w-1 h-1",
    md: "w-1.5 h-1.5",
    lg: "w-2 h-2",
  };

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "rounded-full bg-current animate-bounce",
            sizeClasses[size]
          )}
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
});

export default ThinkingIndicator;
