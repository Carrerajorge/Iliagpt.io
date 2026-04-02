import { memo, useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { 
  X, 
  ChevronRight, 
  ChevronLeft, 
  MessageSquare, 
  Sparkles, 
  FileText,
  Globe,
  Settings,
  CheckCircle2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface TourStep {
  id: string;
  title: string;
  description: string;
  icon: typeof MessageSquare;
  highlight?: string;
  action?: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "¡Bienvenido a iliagpt!",
    description: "Tu asistente de IA para investigación, documentos y más. Te mostraremos lo básico en 30 segundos.",
    icon: Sparkles,
  },
  {
    id: "chat",
    title: "Chatea naturalmente",
    description: "Escribe cualquier pregunta o tarea. Puedo buscar información, analizar datos y crear documentos.",
    icon: MessageSquare,
    highlight: "[data-testid='chat-input']",
    action: "Prueba escribir: 'Busca artículos sobre inteligencia artificial'",
  },
  {
    id: "documents",
    title: "Genera documentos",
    description: "Puedo crear informes en Word, hojas de Excel y presentaciones automáticamente.",
    icon: FileText,
    action: "Pídeme: 'Crea un informe sobre...'",
  },
  {
    id: "search",
    title: "Búsqueda inteligente",
    description: "Busco en la web, artículos científicos y bases de datos para darte información actualizada.",
    icon: Globe,
    action: "Prueba: 'Investiga las últimas noticias de...'",
  },
  {
    id: "personalize",
    title: "Personaliza tu experiencia",
    description: "Aprendo tus preferencias para darte respuestas más útiles. ¡Estás listo para comenzar!",
    icon: Settings,
  },
];

interface OnboardingTourProps {
  isOpen: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

export const OnboardingTour = memo(function OnboardingTour({
  isOpen,
  onComplete,
  onSkip,
}: OnboardingTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  const step = TOUR_STEPS[currentStep];
  const progress = ((currentStep + 1) / TOUR_STEPS.length) * 100;
  const isLastStep = currentStep === TOUR_STEPS.length - 1;

  const goNext = useCallback(() => {
    if (isAnimating) return;
    
    if (isLastStep) {
      onComplete();
    } else {
      setIsAnimating(true);
      setCurrentStep(prev => prev + 1);
      setTimeout(() => setIsAnimating(false), 300);
    }
  }, [isLastStep, isAnimating, onComplete]);

  const goPrev = useCallback(() => {
    if (isAnimating || currentStep === 0) return;
    
    setIsAnimating(true);
    setCurrentStep(prev => prev - 1);
    setTimeout(() => setIsAnimating(false), 300);
  }, [currentStep, isAnimating]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      
      if (e.key === "ArrowRight" || e.key === "Enter") {
        goNext();
      } else if (e.key === "ArrowLeft") {
        goPrev();
      } else if (e.key === "Escape") {
        onSkip();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, goNext, goPrev, onSkip]);

  if (!isOpen) return null;

  const Icon = step.icon;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: "spring", duration: 0.5 }}
          className={cn(
            "relative w-full max-w-md",
            "bg-background rounded-2xl shadow-2xl",
            "border border-border overflow-hidden"
          )}
        >
          <div className="p-1">
            <Progress value={progress} className="h-1" />
          </div>

          <button
            onClick={onSkip}
            className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>

          <div className="p-6 pt-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-primary/10">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      Paso {currentStep + 1} de {TOUR_STEPS.length}
                    </span>
                    <h3 className="text-lg font-semibold">{step.title}</h3>
                  </div>
                </div>

                <p className="text-muted-foreground leading-relaxed">
                  {step.description}
                </p>

                {step.action && (
                  <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
                    <p className="text-sm text-primary font-medium">
                      💡 {step.action}
                    </p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="flex items-center justify-between p-4 border-t bg-muted/30">
            <Button
              variant="ghost"
              size="sm"
              onClick={goPrev}
              disabled={currentStep === 0}
              className="gap-1"
            >
              <ChevronLeft className="w-4 h-4" />
              Anterior
            </Button>

            <div className="flex gap-1">
              {TOUR_STEPS.map((_, index) => (
                <div
                  key={index}
                  className={cn(
                    "w-2 h-2 rounded-full transition-colors",
                    index === currentStep 
                      ? "bg-primary" 
                      : index < currentStep 
                        ? "bg-primary/50" 
                        : "bg-muted-foreground/30"
                  )}
                />
              ))}
            </div>

            <Button
              size="sm"
              onClick={goNext}
              className="gap-1"
            >
              {isLastStep ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Comenzar
                </>
              ) : (
                <>
                  Siguiente
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
});

export function useOnboardingTour() {
  const [showTour, setShowTour] = useState(false);
  const STORAGE_KEY = "iliagpt_onboarding_completed";

  useEffect(() => {
    const completed = localStorage.getItem(STORAGE_KEY);
    if (!completed) {
      const timer = setTimeout(() => setShowTour(true), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const completeTour = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "true");
    setShowTour(false);
  }, []);

  const skipTour = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "skipped");
    setShowTour(false);
  }, []);

  const resetTour = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setShowTour(true);
  }, []);

  return {
    showTour,
    completeTour,
    skipTour,
    resetTour,
  };
}

export default OnboardingTour;
