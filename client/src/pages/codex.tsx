import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Code, ChevronLeft, Layers, Sparkles } from "lucide-react";

export default function CodexPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-4 py-4 md:px-8">
        <Button variant="ghost" className="gap-2" onClick={() => setLocation("/")}>
          <ChevronLeft className="h-4 w-4" />
          Volver
        </Button>
        <div className="flex items-center gap-2">
          <Code className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold">Codex</span>
        </div>
        <div className="w-20" />
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 md:px-8">
        <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Code className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Codex</h1>
              <p className="text-sm text-muted-foreground">
                Centro dedicado para flujos de trabajo avanzados, desarrollo asistido y automatización.
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Desde aquí podrás habilitar experiencias completas similares a entornos como Replit o Antigravity,
            integrando herramientas, agentes y flujos personalizados para proyectos técnicos y de producto.
          </p>
          <div className="flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              <Layers className="h-3.5 w-3.5" />
              Automatización integral
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Experiencia tipo Codex
            </span>
          </div>
          <Button className="w-fit" onClick={() => setLocation("/settings")}>
            Configurar integraciones
          </Button>
        </section>
      </main>
    </div>
  );
}
