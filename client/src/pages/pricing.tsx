import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { PricingPlansSection } from "@/components/pricing/plans-section";
import { ChevronLeft, Sparkles } from "lucide-react";

export default function PricingPage() {
  const [, setLocation] = useLocation();

  // Plans are rendered via <PricingPlansSection /> to match the in-app upgrade dialog.

  return (
    <div className="min-h-screen marketing-force-light marketing-paper flex flex-col relative">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 md:px-8 h-16 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Link href="/welcome">
          <Button variant="ghost" className="gap-2 text-muted-foreground hover:text-foreground hover:bg-accent/60">
            <ChevronLeft className="h-4 w-4" />
            Volver
          </Button>
        </Link>
        <span className="font-medium tracking-tight text-foreground">Precios</span>
        <div className="w-20" />
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center px-4 py-10 md:py-14">
        <div className="w-full max-w-6xl space-y-12">
          {/* Hero Section */}
          <section className="text-center fade-in-up">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted/50 border border-border text-xs font-medium text-foreground/80 mb-6">
              <Sparkles className="h-3.5 w-3.5 text-future-accent" />
              <span className="text-future-gradient">Planes flexibles</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-semibold mb-6 text-foreground leading-tight tracking-tight">
              Obtén el{" "}
              <span className="text-future-gradient">
                Control Total
              </span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Desbloquea control remoto de terminal proxy, scripts personalizados,
              automatización de archivos locales y flujos de trabajo autónomos.
            </p>
          </section>

          {/* Plans (match in-app upgrade dialog) */}
          <div className="fade-in-up fade-in-up-delay-1">
            <PricingPlansSection
              onSelectPlan={() => setLocation("/signup")}
              showTabs
            />
          </div>

          {/* FAQ Section */}
          <section className="rounded-3xl border border-border bg-card p-8 md:p-12 fade-in-up fade-in-up-delay-2">
            <h2 className="text-2xl font-semibold text-foreground mb-8 text-center tracking-tight">
              Preguntas frecuentes
            </h2>
            <div className="grid md:grid-cols-2 gap-8">
              {[
                { q: "¿Puedo cambiar de plan?", a: "Sí, puedes actualizar o degradar tu plan en cualquier momento desde tu configuración." },
                { q: "¿Hay contratos?", a: "No, todos los planes son mensuales y puedes cancelar cuando quieras." },
                { q: "¿Qué métodos de pago aceptan?", a: "Visa, Mastercard, American Express, PayPal y transferencia bancaria para Enterprise." },
                { q: "¿Ofrecen descuentos para estudiantes?", a: "Sí, 50% de descuento en Pro con verificación educativa." }
              ].map((faq, i) => (
                <div key={i} className="space-y-2">
                  <h4 className="text-sm font-medium text-foreground">{faq.q}</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
