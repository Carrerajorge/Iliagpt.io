import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, BookOpen, Image, Code, Lightbulb, ArrowRight, PlayCircle } from "lucide-react";

export default function LearnPage() {
    const [, setLocation] = useLocation();

    const tutorials = [
        {
            title: "Primeros Pasos",
            desc: "Domina lo básico de ILIAGPT en menos de 5 minutos.",
            icon: BookOpen,
        },
        {
            title: "Ingeniería de Prompts",
            desc: "Aprende a escribir instrucciones precisas para resultados perfectos.",
            icon: Code,
        },
        {
            title: "Generación de Imágenes",
            desc: "Guía completa para crear arte digital impresionante.",
            icon: Image,
        },
        {
            title: "Casos de Uso Pro",
            desc: "Estrategias avanzadas para productividad y negocio.",
            icon: Lightbulb,
        }
    ];

    return (
        <div className="min-h-screen paper-grid flex flex-col">
            {/* Header */}
            <header className="relative z-10 flex items-center justify-between px-4 md:px-8 h-16 border-b border-border bg-background/80 backdrop-blur-sm">
                <Link href="/welcome">
                    <Button variant="ghost" className="rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 gap-2">
                        <ChevronLeft className="h-4 w-4" />
                        Volver
                    </Button>
                </Link>
                <span className="font-semibold text-foreground">Centro de aprendizaje</span>
                <div className="w-20" />
            </header>

            {/* Main Content */}
            <main className="relative z-0 flex-1 flex flex-col items-center px-4 py-12 overflow-y-auto">
                <div className="w-full max-w-5xl space-y-12">

                    {/* Hero Section */}
                    <section className="text-center fade-in-up">
                        <h1 className="text-4xl md:text-5xl font-semibold mb-4 text-foreground tracking-tight">
                            Aprende a{" "}
                            <span className="inline-flex items-center px-2 py-1 rounded-xl bg-muted text-foreground">
                                crear mejor
                            </span>
                        </h1>
                        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                            Descubre tutoriales, guías y trucos para sacar el máximo partido a tu asistente de IA.
                        </p>
                    </section>

                    {/* Featured Video Card - Large */}
                    <div className="rounded-3xl border border-border bg-card shadow-sm overflow-hidden fade-in-up fade-in-up-delay-1">
                        <div className="relative aspect-video bg-muted overflow-hidden flex items-center justify-center">
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background/90 z-10" />
                            <img
                                src="https://images.unsplash.com/photo-1620712943543-bcc4688e7485?q=80&w=1200&auto=format&fit=crop"
                                alt="AI Learning"
                                className="absolute inset-0 w-full h-full object-cover opacity-70 grayscale"
                            />
                            <div className="absolute inset-0 z-20 flex items-center justify-center">
                                <div className="rounded-full bg-background/90 border border-border p-4 shadow-sm">
                                    <PlayCircle className="h-12 w-12 text-foreground" />
                                </div>
                            </div>
                        </div>
                        <div className="p-6">
                            <span className="inline-flex items-center rounded-full border border-border bg-muted/30 px-3 py-1 text-xs font-semibold tracking-wide text-foreground">
                                VIDEO DESTACADO
                            </span>
                            <h3 className="mt-3 text-2xl font-semibold text-foreground">Introducción a ILIAGPT</h3>
                            <p className="mt-1 text-muted-foreground">Un recorrido completo por las funcionalidades principales.</p>
                        </div>
                    </div>

                    {/* Tutorials Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 fade-in-up fade-in-up-delay-2">
                        {tutorials.map((item, i) => (
                            <div
                                key={i}
                                className="p-6 rounded-2xl border border-border bg-card shadow-sm hover:bg-muted/20 transition-colors duration-200 group cursor-pointer"
                            >
                                <div className="flex items-start gap-4">
                                    <div className="p-3 rounded-xl bg-muted/30 text-foreground border border-border">
                                        <item.icon className="h-6 w-6" />
                                    </div>
                                    <div className="flex-1">
                                        <h4 className="text-lg font-semibold text-foreground mb-2 transition-colors">{item.title}</h4>
                                        <p className="text-sm text-muted-foreground leading-relaxed mb-4">{item.desc}</p>
                                        <div className="flex items-center text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                                            <span>Leer guía</span>
                                            <ArrowRight className="h-3 w-3 ml-2 group-hover:translate-x-1 transition-transform" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                </div>
            </main>

            {/* CTA Footer */}
            <section className="relative z-10 py-16 px-4 text-center border-t border-border bg-background/70 backdrop-blur-sm">
                <h2 className="text-2xl font-semibold tracking-tight text-foreground mb-4">¿Listo para empezar?</h2>
                <Button
                    onClick={() => setLocation("/signup")}
                    className="rounded-full px-8 py-6 text-lg"
                >
                    Crear cuenta gratis
                </Button>
            </section>
        </div>
    );
}
