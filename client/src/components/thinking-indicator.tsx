import { memo, useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  Search,
  Database,
  Code,
  FileSpreadsheet,
  FileText,
  Presentation,
  Globe,
  FileSearch,
  BrainCircuit,
  Sparkles,
  Zap,
  Clock
} from "lucide-react";

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
  intent?: string;
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

const phaseNarrations: Record<ThinkingPhase, string[]> = {
  connecting: [
    "Conectando con el orquestador...",
    "Iniciando sesión segura...",
    "Sincronizando contexto..."
  ],
  searching: [
    "Desglosando tu solicitud...",
    "Identificando palabras clave...",
    "Consultando índice semántico...",
    "Analizando intención..."
  ],
  analyzing: [
    "Evaluando restricciones...",
    "Revisando historial de conversación...",
    "Detectando herramientas necesarias...",
    "Validando permisos de ejecución..."
  ],
  processing: [
    "Procesando lógica central...",
    "Optimizando estrategia...",
    "Ejecutando razonamiento paso a paso...",
    "Contrastando hipótesis..."
  ],
  generating: [
    "Estructurando respuesta...",
    "Redactando borrador inicial...",
    "Aplicando formato...",
    "Sintetizando conclusiones..."
  ],
  responding: [
    "Finalizando detalles...",
    "Pulido final...",
    "Verificando calidad..."
  ],
  finalizing: [
    "Listo para enviar.",
    "Completado."
  ]
};

// 20+ New Context-Aware Messages mapped to Intents
export const intentNarrations: Record<string, string[]> = {
  research: [
    "Consultando fuentes académicas...",
    "Contrastando referencias cruzadas...",
    "Filtrando por relevancia y fecha...",
    "Extrayendo citas clave...",
    "Sintetizando hallazgos múltiples...",
    "Verificando credibilidad de fuentes..."
  ],
  data_analysis: [
    "Cargando dataset en memoria...",
    "Limpiando valores atípicos...",
    "Calculando estadísticas descriptivas...",
    "Generando visualizaciones...",
    "Detectando correlaciones ocultas...",
    "Validando integridad de datos..."
  ],
  code_generation: [
    "Analizando arquitectura del proyecto...",
    "Verificando compatibilidad de librerías...",
    "Escribiendo código modular...",
    "Ejecutando análisis estático...",
    "Optimizando rendimiento...",
    "Revisando seguridad del código..."
  ],
  spreadsheet_creation: [
    "Diseñando estructura de hojas...",
    "Creando fórmulas dinámicas...",
    "Aplicando formato condicional...",
    "Validando referencias cruzadas...",
    "Generando tablas pivote...",
    "Optimizando para impresión..."
  ],
  document_generation: [
    "Estructurando esquema del documento...",
    "Redactando secciones clave...",
    "Ajustando tono y estilo...",
    "Insertando elementos gráficos...",
    "Revisando coherencia narrativa...",
    "Aplicando estilos corporativos..."
  ],
  presentation_creation: [
    "Diseñando flujo narrativo...",
    "Seleccionando paleta de colores...",
    "Generando slides impactantes...",
    "Sintetizando puntos clave...",
    "Optimizando legibilidad...",
    "Añadiendo notas del orador..."
  ],
  web_automation: [
    "Iniciando navegador headless...",
    "Navegando al destino...",
    "Interactuando con el DOM...",
    "Esperando carga asíncrona...",
    "Extrayendo datos estructurados...",
    "Gestionando cookies y sesiones..."
  ],
  document_analysis: [
    "Escaneando contenido del archivo...",
    "Extrayendo texto y metadatos...",
    "Indexando para búsqueda vectorial...",
    "Identificando entidades clave...",
    "Resumiendo puntos principales...",
    "Cruzando con base de conocimiento..."
  ]
};

const phaseDurations: Record<ThinkingPhase, number> = {
  connecting: 800,
  searching: 3500,
  analyzing: 2500,
  processing: 2000,
  generating: 1500,
  responding: 2000,
  finalizing: 1000
};

// Helper to get icon for intent
const getIntentIcon = (intent?: string) => {
  switch (intent) {
    case 'research': return Search;
    case 'data_analysis': return Database;
    case 'code_generation': return Code;
    case 'spreadsheet_creation': return FileSpreadsheet;
    case 'document_generation': return FileText;
    case 'presentation_creation': return Presentation;
    case 'web_automation': return Globe;
    case 'document_analysis': return FileSearch;
    default: return BrainCircuit;
  }
};

// Maximum time (ms) the PhaseNarrator can be mounted before self-destructing.
// Acts as an absolute safety net if all stream timeout mechanisms fail.
const MAX_NARRATOR_LIFETIME_MS = 90_000;

export const PhaseNarrator = memo(function PhaseNarrator({
  phase,
  message,
  className,
  autoProgress = true,
  intent,
  onTimeout
}: {
  phase?: ThinkingPhase;
  message?: string;
  className?: string;
  autoProgress?: boolean;
  intent?: string;
  onTimeout?: () => void;
}) {
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const currentPhaseIndexRef = useRef(0);
  const [currentNarration, setCurrentNarration] = useState("");
  const [selfDestructed, setSelfDestructed] = useState(false);
  const narrationIndex = useRef(0);
  const phaseStartTime = useRef(Date.now());
  const animationFrame = useRef<number | null>(null);

  // Feature: Deep Work/Long Running logic — use ref to avoid re-triggering effects
  const [isDeepWork, setIsDeepWork] = useState(false);
  const isDeepWorkRef = useRef(false);
  const elapsedTimeRef = useRef(0);

  // Safety self-destruct: if mounted for too long, hide and notify parent
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;
  useEffect(() => {
    const timer = setTimeout(() => {
      setSelfDestructed(true);
      onTimeoutRef.current?.();
    }, MAX_NARRATOR_LIFETIME_MS);
    return () => clearTimeout(timer);
  }, []);

  if (selfDestructed) return null;

  const currentPhase = phase || phaseSequence[currentPhaseIndex];

  // Logic to determine narrations — use stable references from constant objects
  const isIntentActive = !!(intent && intentNarrations[intent] && (currentPhase === 'searching' || currentPhase === 'processing' || currentPhase === 'analyzing'));
  const narrations = isIntentActive
    ? intentNarrations[intent!]
    : (phaseNarrations[currentPhase] || phaseNarrations.searching);

  // Feature: Dynamic Icon
  const Icon = isDeepWork ? Zap : (isIntentActive ? getIntentIcon(intent) : (currentPhase === 'connecting' ? Sparkles : Loader2));

  // Cycle narrations — NO isDeepWork in deps to prevent re-trigger loops
  useEffect(() => {
    if (message) {
      setCurrentNarration(message);
      return;
    }

    // Reset when phase or intent changes
    setCurrentNarration(narrations[0]);
    narrationIndex.current = 0;
    elapsedTimeRef.current = 0;
    isDeepWorkRef.current = false;
    setIsDeepWork(false);

    const startTime = Date.now();

    const narrationInterval = setInterval(() => {
      narrationIndex.current = (narrationIndex.current + 1) % narrations.length;
      setCurrentNarration(narrations[narrationIndex.current]);

      // Feature: Deep Work detection — read/write ref, only setState once
      const totalElapsed = Date.now() - startTime;
      if (totalElapsed > 8000 && !isDeepWorkRef.current) {
        isDeepWorkRef.current = true;
        setIsDeepWork(true);
      }
    }, 1800);

    return () => clearInterval(narrationInterval);
  }, [currentPhase, message, narrations]);

  // Handle Phase auto-progression — use refs to avoid deps on state
  useEffect(() => {
    if (!autoProgress || phase) return;

    currentPhaseIndexRef.current = 0;
    phaseStartTime.current = Date.now();

    const progressPhase = () => {
      const elapsed = Date.now() - phaseStartTime.current;
      const idx = currentPhaseIndexRef.current;
      const currentPhaseDuration = phaseDurations[phaseSequence[idx]];

      if (elapsed >= currentPhaseDuration && idx < phaseSequence.length - 2) {
        currentPhaseIndexRef.current = idx + 1;
        setCurrentPhaseIndex(idx + 1);
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
  }, [autoProgress, phase]);

  return (
    <div className={cn("phase-narrator-wrapper flex items-center gap-2.5", className)}>
      <div className="relative flex items-center justify-center w-5 h-5 shrink-0">
        <motion.div
          animate={{
            scale: [1, 1.3, 1],
            opacity: [0.3, 0.7, 0.3],
          }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className={cn(
            "absolute inset-0 rounded-full blur-[3px]",
            isDeepWork ? "bg-amber-500/40" : "bg-[#A5A0FF]/40"
          )}
        />
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1, rotate: isDeepWork ? 0 : 360 }}
          transition={{
            rotate: { duration: 3, repeat: Infinity, ease: "linear" },
            scale: { duration: 0.3 }
          }}
          className={cn(
            "relative flex items-center justify-center w-4 h-4 rounded-full",
            isDeepWork ? "text-amber-500" : "text-[#A5A0FF]"
          )}
        >
          <Icon className={cn("w-4 h-4 shadow-[#A5A0FF]/20 drop-shadow-sm", isDeepWork && "animate-pulse")} />
        </motion.div>
      </div>

      <div className="relative overflow-hidden h-6 flex items-center min-w-[200px]">
        <AnimatePresence mode="wait">
          <motion.span
            key={currentNarration + (isDeepWork ? 'deep' : 'normal')}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className={cn(
              "phase-narrator-text text-sm font-medium truncate",
              isDeepWork && "text-amber-500 font-semibold"
            )}
          >
            {currentNarration}
          </motion.span>
        </AnimatePresence>
      </div>

      <style>{`
        .phase-narrator-text {
          background: linear-gradient(
            90deg,
            rgb(120, 120, 120) 0%,
            rgb(120, 120, 120) 35%,
            #A5A0FF 45%,
            #C4C0FF 50%,
            #A5A0FF 55%,
            rgb(120, 120, 120) 65%,
            rgb(120, 120, 120) 100%
          );
          background-size: 300% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: lightning-flash 2s linear infinite;
        }
        
        .dark .phase-narrator-text {
          background: linear-gradient(
            90deg,
            rgb(180, 180, 180) 0%,
            rgb(180, 180, 180) 35%,
            #A5A0FF 45%,
            #D8D5FF 50%,
            #A5A0FF 55%,
            rgb(180, 180, 180) 65%,
            rgb(180, 180, 180) 100%
          );
          background-size: 300% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        @keyframes lightning-flash {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
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
  intent
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
        <PhaseNarrator phase={effectivePhase} message={message} autoProgress={!effectivePhase} intent={intent} />
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <PhaseNarrator phase={effectivePhase} message={message} autoProgress={!effectivePhase} intent={intent} />
      </span>
    );
  }

  if (variant === "minimal") {
    return (
      <div className={cn("flex items-center gap-2 py-2", className)}>
        <PhaseNarrator phase={effectivePhase} message={message} autoProgress={!effectivePhase} intent={intent} />
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-3 py-2", className)}>
      <PhaseNarrator phase={effectivePhase} message={message} autoProgress={!effectivePhase} intent={intent} />
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
