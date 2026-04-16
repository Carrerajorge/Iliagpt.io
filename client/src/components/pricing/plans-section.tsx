import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Brain,
  CheckCircle2,
  Clock,
  Code,
  FileText,
  Image,
  Infinity,
  Loader2,
  MessageSquare,
  Shield,
  Sparkles,
  Star,
  Target,
  Users,
  Video,
  Zap,
} from "lucide-react";

type PlanTab = "personal" | "empresa";

type ButtonVariant = "default" | "outline" | "secondary" | "ghost" | "destructive" | null | undefined;

type PlanFeature = {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
};

type PlanCard = {
  name: string;
  price: number;
  description: string;
  buttonText: string;
  buttonVariant: ButtonVariant;
  badge?: string;
  highlight?: boolean;
  isCurrentPlan?: boolean;
  footerNote?: string;
  features: PlanFeature[];
};

const PERSONAL_PLANS: PlanCard[] = [
  {
    name: "Gratis",
    price: 0,
    description: "Mira lo que la IA puede hacer",
    buttonText: "Empezar",
    buttonVariant: "outline",
    features: [
      { icon: Sparkles, text: "Obtén explicaciones sencillas" },
      { icon: MessageSquare, text: "Mantén chats breves para preguntas frecuentes" },
      { icon: Image, text: "Prueba la generación de imágenes" },
      { icon: Brain, text: "Guardar memoria y contexto limitados" },
    ],
  },
  {
    name: "Go",
    price: 5,
    badge: "NUEVO",
    description: "Logra más con una IA más avanzada",
    buttonText: "Mejorar el plan a Go",
    buttonVariant: "default",
    highlight: true,
    features: [
      { icon: Target, text: "Explora a fondo preguntas más complejas" },
      { icon: Clock, text: "Chatea más tiempo y carga más contenido" },
      { icon: Image, text: "Crea imágenes realistas para tus proyectos" },
      { icon: Brain, text: "Almacena más contexto y obtén respuestas más inteligentes" },
      { icon: Zap, text: "Obtén ayuda con la planificación y las tareas" },
      { icon: Star, text: "Explora proyectos, tareas y GPT personalizados" },
    ],
    footerNote: "Solo disponible en algunas regiones. Se aplican límites",
  },
  {
    name: "Plus",
    price: 10,
    description: "Descubre toda la experiencia",
    buttonText: "Obtener Plus",
    buttonVariant: "outline",
    features: [
      { icon: Sparkles, text: "Resuelve problemas complejos" },
      { icon: MessageSquare, text: "Ten largas charlas en varias sesiones" },
      { icon: Image, text: "Cree más imágenes, más rápido" },
      { icon: Brain, text: "Recuerda objetivos y conversaciones pasadas" },
      { icon: Target, text: "Planifica viajes y tareas con el modo Agente" },
      { icon: FileText, text: "Organiza proyectos y GPT personalizados" },
      { icon: Video, text: "Produce y comparte videos en Sora" },
      { icon: Code, text: "Escribe código y crea aplicaciones con Codex" },
    ],
    footerNote: "Se aplican límites",
  },
  {
    name: "Pro",
    price: 200,
    description: "Maximiza tu productividad",
    buttonText: "Obtener Pro",
    buttonVariant: "outline",
    features: [
      { icon: Star, text: "Domina tareas y temas avanzados" },
      { icon: Infinity, text: "Trabaja en proyectos grandes con mensajes ilimitados" },
      { icon: Image, text: "Crea imágenes de alta calidad a cualquier escala" },
      { icon: Brain, text: "Mantén todo el contexto con la memoria máxima" },
      { icon: Zap, text: "Ejecuta investigaciones y planifica tareas con agentes" },
      { icon: Target, text: "Adapta tus proyectos y automatiza flujos de trabajo" },
      { icon: Video, text: "Supera tus límites con la creación de videos en Sora" },
      { icon: Code, text: "Implementa código más rápido con Codex" },
      { icon: Star, text: "Obtén acceso anticipado a características experimentales" },
    ],
    footerNote: "Ilimitado, sujeto a medidas de protección contra abusos. Obtener más información",
  },
];

const EMPRESA_PLANS: PlanCard[] = [
  {
    name: "Gratis",
    price: 0,
    description: "Mira lo que la IA puede hacer",
    buttonText: "Empezar",
    buttonVariant: "outline",
    features: [
      { icon: Sparkles, text: "Obtén explicaciones sencillas" },
      { icon: MessageSquare, text: "Mantén chats breves para preguntas frecuentes" },
      { icon: Image, text: "Prueba la generación de imágenes" },
      { icon: Brain, text: "Guardar memoria y contexto limitados" },
    ],
  },
  {
    name: "Business",
    price: 25,
    badge: "RECOMENDADO",
    description: "Mejora la productividad con la IA para equipos",
    buttonText: "Obtener Business",
    buttonVariant: "default",
    highlight: true,
    features: [
      { icon: CheckCircle2, text: "Realiza un análisis profesional" },
      { icon: Infinity, text: "Obtén mensajes ilimitados con GPT-5" },
      { icon: Image, text: "Produce imágenes, videos, presentaciones y más" },
      { icon: Shield, text: "Protege tu espacio con SSO, MFA y más" },
      { icon: Shield, text: "Protege la privacidad; los datos nunca se usan para fines de entrenamiento" },
      { icon: Users, text: "Comparte proyectos y GPT personalizados" },
      { icon: FileText, text: "Se integra con SharePoint y otras herramientas" },
      { icon: Target, text: "Simplifica la facturación y administración de usuarios" },
      { icon: MessageSquare, text: "Captura notas de reuniones con transcripción" },
    ],
  },
];

function PlanBadge({
  label,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { label: string }) {
  const normalized = label.trim().toUpperCase();
  const isRecommended = normalized === "RECOMENDADO";
  const isNew = normalized === "NUEVO";

  return (
    <span
      {...props}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide",
        isRecommended
          ? "border-foreground/10 bg-foreground text-background"
          : isNew
            ? "border-[hsl(var(--future-b,195_95%_35%)/0.25)] bg-[hsl(var(--future-b,195_95%_35%)/0.08)] text-[hsl(var(--future-b,195_95%_35%))]"
            : "border-border bg-background text-muted-foreground",
        className,
      )}
    >
      {label}
    </span>
  );
}

export function PricingPlansSection(props: {
  /** If true, shows tab switcher (Personal/Empresa). Defaults true. */
  showTabs?: boolean;
  /** Called when user clicks a plan CTA. */
  onSelectPlan: (planName: string, tab: PlanTab) => void;
  /** Provide current plan name to disable its CTA and show "Tu plan actual". */
  currentPlanName?: string;
  /** External loading state by plan name (lowercase). */
  loadingPlanName?: string | null;
  /** Override initial tab */
  defaultTab?: PlanTab;
}) {
  const {
    showTabs = true,
    onSelectPlan,
    currentPlanName,
    loadingPlanName = null,
    defaultTab = "personal",
  } = props;

  const [activeTab, setActiveTab] = useState<PlanTab>(defaultTab);

  const plans = useMemo(() => {
    return activeTab === "personal" ? PERSONAL_PLANS : EMPRESA_PLANS;
  }, [activeTab]);

  const normalizedCurrent = (currentPlanName || "").toLowerCase();

  return (
    <div>
      {showTabs && (
        <div className="flex justify-center mt-4">
          <div className="inline-flex items-center rounded-full border border-border bg-muted/60 p-1">
            <button
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                activeTab === "personal"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setActiveTab("personal")}
              data-testid="tab-personal"
              type="button"
              aria-pressed={activeTab === "personal"}
            >
              Personal
            </button>
            <button
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                activeTab === "empresa"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setActiveTab("empresa")}
              data-testid="tab-empresa"
              type="button"
              aria-pressed={activeTab === "empresa"}
            >
              Empresa
            </button>
          </div>
        </div>
      )}

      <div className="p-6">
        <div
          className={cn(
            "grid gap-5",
            activeTab === "personal" ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-4" : "grid-cols-1 md:grid-cols-2",
          )}
        >
          {plans.map((plan) => {
            const planKey = plan.name.toLowerCase();
            const isCurrent = normalizedCurrent && planKey === normalizedCurrent;
            const isLoading = loadingPlanName === planKey;

            return (
              <div
                key={`${activeTab}:${plan.name}`}
                className={cn(
                  "rounded-2xl border border-border p-6 flex flex-col bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-md",
                  plan.highlight &&
                    "bg-muted/20 ring-1 ring-[hsl(var(--future-b,195_95%_35%)/0.18)] shadow-md",
                )}
                data-testid={`plan-card-${plan.name.toLowerCase()}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <h3 className={cn("text-lg font-semibold tracking-tight", plan.highlight && "text-future-gradient")}>
                    {plan.name}
                  </h3>
                  {plan.badge && (
                    <PlanBadge label={plan.badge} data-testid={`badge-${plan.badge.toLowerCase()}`} />
                  )}
                </div>

                <div className="flex items-baseline gap-0.5 mb-2">
                  <span className="text-sm">$</span>
                  <span
                    className={cn(
                      "text-4xl font-semibold tracking-tight tabular-nums",
                      plan.highlight && "text-future-gradient",
                    )}
                  >
                    {plan.price}
                  </span>
                  <span className="text-sm text-muted-foreground">USD / mes</span>
                </div>

                <p className="text-sm text-muted-foreground mb-4 min-h-[2.5rem] md:min-h-[3rem]">
                  {plan.description}
                </p>

                <Button
                  variant={plan.buttonVariant}
                  className={cn(
                    "w-full mb-6",
                    plan.buttonVariant === "outline" && "hover:bg-accent/60",
                    plan.buttonVariant === "default" && "hover:bg-primary/90 hover:border-primary/90",
                    plan.highlight && plan.buttonVariant === "default" && "shadow-sm",
                  )}
                  disabled={isCurrent || isLoading}
                  onClick={() => !isCurrent && onSelectPlan(plan.name, activeTab)}
                  data-testid={`button-${plan.name.toLowerCase()}`}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Procesando...
                    </>
                  ) : isCurrent ? (
                    "Tu plan actual"
                  ) : (
                    plan.buttonText
                  )}
                </Button>

                <div className="space-y-3 flex-1">
                  {plan.features.map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-sm">
                      <feature.icon className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-foreground/80 leading-snug">{feature.text}</span>
                    </div>
                  ))}
                </div>

                {plan.footerNote && (
                  <p className="text-xs text-muted-foreground mt-4 pt-4 border-t border-border">
                    {plan.footerNote.includes("Obtener más información") ? (
                      <>
                        {plan.footerNote.replace("Obtener más información", "")}
                        <button
                          type="button"
                          className="underline underline-offset-4 decoration-muted-foreground/40 hover:text-foreground"
                        >
                          Obtener más información
                        </button>
                      </>
                    ) : plan.footerNote.includes("Se aplican límites") ? (
                      <>
                        {plan.footerNote.replace("Se aplican límites", "")}
                        <button
                          type="button"
                          className="underline underline-offset-4 decoration-muted-foreground/40 hover:text-foreground"
                        >
                          Se aplican límites
                        </button>
                      </>
                    ) : (
                      plan.footerNote
                    )}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
