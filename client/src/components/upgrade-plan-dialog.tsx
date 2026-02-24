import { useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Sparkles, MessageSquare, Image, Brain, Clock, Target, Zap, Users, Shield, FileText, Video, Code, Star, Infinity, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface UpgradePlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type PlanTab = "personal" | "empresa";

// Plan to price ID mapping (will be fetched from backend)
const PLAN_PRICE_IDS: Record<string, string> = {
  go: "price_go_monthly",
  plus: "price_plus_monthly", 
  pro: "price_pro_monthly",
  business: "price_business_monthly",
};

export function UpgradePlanDialog({ open, onOpenChange }: UpgradePlanDialogProps) {
  const [activeTab, setActiveTab] = useState<PlanTab>("personal");
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const { toast } = useToast();

  const handleSubscribe = async (planName: string) => {
    const planKey = planName.toLowerCase();
    setLoadingPlan(planKey);
    
    try {
      // First, get the actual price IDs from the backend
      const priceResponse = await apiFetch("/api/stripe/price-ids");
      const priceData = await priceResponse.json();
      
      const priceIdKey = PLAN_PRICE_IDS[planKey];
      const priceId = priceData.priceMapping?.[priceIdKey];
      
      if (!priceId) {
        // If no price found, try to create products first
        toast({
          title: "Configurando pagos...",
          description: "Preparando el sistema de pagos, intenta de nuevo en unos segundos.",
        });
        
        // Trigger product creation (admin-only, opt-in on server)
        const seedRes = await apiFetch("/api/stripe/create-products", { method: "POST" });
        const seedData = await seedRes.json().catch(() => null);
        if (!seedRes.ok) {
          if (seedRes.status === 404) {
            toast({
              title: "Inicialización deshabilitada",
              description:
                "El servidor tiene deshabilitada la inicialización de productos. Habilita ALLOW_STRIPE_PRODUCT_SEEDING=true para usar esta función.",
              variant: "destructive",
            });
          } else if (seedRes.status === 403) {
            toast({
              title: "Acceso restringido",
              description: "Solo administradores pueden inicializar productos de Stripe.",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Error",
              description: seedData?.error || "No se pudo inicializar productos de Stripe.",
              variant: "destructive",
            });
          }
          return;
        }

        toast({
          title: "Productos listos",
          description: "Stripe fue inicializado. Intenta suscribirte de nuevo.",
        });
        return;
      }
      
      // Create checkout session
      const checkoutResponse = await apiFetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      
      const checkoutData = await checkoutResponse.json();
      
      if (checkoutData.error) {
        toast({
          title: "Error",
          description: checkoutData.error,
          variant: "destructive",
        });
        return;
      }
      
      if (checkoutData.url) {
        window.location.href = checkoutData.url;
      }
    } catch (error) {
      console.error("Subscription error:", error);
      toast({
        title: "Error",
        description: "No se pudo procesar la suscripción. Intenta de nuevo.",
        variant: "destructive",
      });
    } finally {
      setLoadingPlan(null);
    }
  };

  const personalPlans = [
    {
      name: "Gratis",
      price: 0,
      description: "Mira lo que la IA puede hacer",
      buttonText: "Tu plan actual",
      buttonVariant: "outline" as const,
      isCurrentPlan: true,
      features: [
        { icon: Sparkles, text: "Obtén explicaciones sencillas" },
        { icon: MessageSquare, text: "Mantén chats breves para preguntas frecuentes" },
        { icon: Image, text: "Prueba la generación de imágenes" },
        { icon: Brain, text: "Guardar memoria y contexto limitados" },
      ]
    },
    {
      name: "Go",
      price: 5,
      badge: "NUEVO",
      description: "Logra más con una IA más avanzada",
      buttonText: "Mejorar el plan a Go",
      buttonVariant: "default" as const,
      highlight: true,
      buttonColor: "bg-purple-600 hover:bg-purple-700",
      features: [
        { icon: Target, text: "Explora a fondo preguntas más complejas" },
        { icon: Clock, text: "Chatea más tiempo y carga más contenido" },
        { icon: Image, text: "Crea imágenes realistas para tus proyectos" },
        { icon: Brain, text: "Almacena más contexto y obtén respuestas más inteligentes" },
        { icon: Zap, text: "Obtén ayuda con la planificación y las tareas" },
        { icon: Star, text: "Explora proyectos, tareas y GPT personalizados" },
      ],
      footerNote: "Solo disponible en algunas regiones. Se aplican límites"
    },
    {
      name: "Plus",
      price: 10,
      description: "Descubre toda la experiencia",
      buttonText: "Obtener Plus",
      buttonVariant: "default" as const,
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
      footerNote: "Se aplican límites"
    },
    {
      name: "Pro",
      price: 200,
      description: "Maximiza tu productividad",
      buttonText: "Obtener Pro",
      buttonVariant: "default" as const,
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
      footerNote: "Ilimitado, sujeto a medidas de protección contra abusos. Obtener más información"
    },
  ];

  const empresaPlans = [
    {
      name: "Gratis",
      price: 0,
      description: "Mira lo que la IA puede hacer",
      buttonText: "Tu plan actual",
      buttonVariant: "outline" as const,
      isCurrentPlan: true,
      features: [
        { icon: Sparkles, text: "Obtén explicaciones sencillas" },
        { icon: MessageSquare, text: "Mantén chats breves para preguntas frecuentes" },
        { icon: Image, text: "Prueba la generación de imágenes" },
        { icon: Brain, text: "Guardar memoria y contexto limitados" },
      ]
    },
    {
      name: "Business",
      price: 25,
      badge: "RECOMENDADO",
      description: "Mejora la productividad con la IA para equipos",
      buttonText: "Obtener Business",
      buttonVariant: "default" as const,
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
      ]
    },
  ];

  const plans = activeTab === "personal" ? personalPlans : empresaPlans;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] max-h-[90vh] overflow-y-auto p-0">
        <VisuallyHidden>
          <DialogTitle>Mejora tu plan</DialogTitle>
          <DialogDescription>Compara y selecciona el plan que mejor se adapte a tus necesidades</DialogDescription>
        </VisuallyHidden>
        <div className="sticky top-0 bg-background z-10 p-6 pb-4 border-b">
          <div className="flex justify-between items-start">
            <div></div>
            <h2 className="text-2xl font-semibold text-center">Mejora tu plan</h2>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => onOpenChange(false)}
              className="h-8 w-8"
              data-testid="button-close-upgrade"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="flex justify-center mt-4">
            <div className="inline-flex bg-muted rounded-full p-1">
              <button
                className={cn(
                  "px-4 py-1.5 text-sm font-medium rounded-full transition-colors",
                  activeTab === "personal" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setActiveTab("personal")}
                data-testid="tab-personal"
              >
                Personal
              </button>
              <button
                className={cn(
                  "px-4 py-1.5 text-sm font-medium rounded-full transition-colors",
                  activeTab === "empresa" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setActiveTab("empresa")}
                data-testid="tab-empresa"
              >
                Empresa
              </button>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className={cn(
            "grid gap-4",
            activeTab === "personal" ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-4" : "grid-cols-1 md:grid-cols-2"
          )}>
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={cn(
                  "rounded-xl border p-6 flex flex-col",
                  plan.highlight && "border-primary/50 shadow-lg"
                )}
                data-testid={`plan-card-${plan.name.toLowerCase()}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-xl font-semibold">{plan.name}</h3>
                  {plan.badge && (
                    <Badge variant="secondary" className={cn(
                      "text-xs",
                      plan.badge === "NUEVO" && "bg-green-100 text-green-700",
                      plan.badge === "RECOMENDADO" && "bg-primary/10 text-primary"
                    )}>
                      {plan.badge}
                    </Badge>
                  )}
                </div>
                
                <div className="flex items-baseline gap-0.5 mb-2">
                  <span className="text-sm">$</span>
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-sm text-muted-foreground">USD / mes</span>
                </div>
                
                <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>
                
                <Button
                  variant={plan.buttonVariant}
                  className={cn(
                    "w-full mb-6",
                    (plan as any).buttonColor ? (plan as any).buttonColor : plan.highlight && "bg-primary hover:bg-primary/90"
                  )}
                  disabled={plan.isCurrentPlan || loadingPlan === plan.name.toLowerCase()}
                  onClick={() => !plan.isCurrentPlan && handleSubscribe(plan.name)}
                  data-testid={`button-${plan.name.toLowerCase()}`}
                >
                  {loadingPlan === plan.name.toLowerCase() ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    plan.buttonText
                  )}
                </Button>
                
                <div className="space-y-3 flex-1">
                  {plan.features.map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-sm">
                      <feature.icon className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                      <span>{feature.text}</span>
                    </div>
                  ))}
                </div>

                {(plan as any).footerNote && (
                  <p className="text-xs text-muted-foreground mt-4 pt-4 border-t">
                    {((plan as any).footerNote as string).includes("Obtener más información") ? (
                      <>
                        {((plan as any).footerNote as string).replace("Obtener más información", "")}
                        <button className="underline hover:text-foreground">Obtener más información</button>
                      </>
                    ) : ((plan as any).footerNote as string).includes("Se aplican límites") ? (
                      <>
                        {((plan as any).footerNote as string).replace("Se aplican límites", "")}
                        <button className="underline hover:text-foreground">Se aplican límites</button>
                      </>
                    ) : (
                      (plan as any).footerNote
                    )}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
