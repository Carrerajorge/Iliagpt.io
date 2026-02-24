import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Terminal, Shield, Cpu, Zap } from "lucide-react";

const VALUES = [
    {
        icon: Terminal,
        title: "Control Absoluto",
        desc: "Tu computadora bajo tu mando. El agente ejecuta acciones directamente en tu sistema.",
    },
    {
        icon: Shield,
        title: "Ejecución Local Segura",
        desc: "Arquitectura On-Premise. Tus datos, archivos locales y scripts nunca abandonan tu máquina.",
    },
    {
        icon: Cpu,
        title: "Ingeniería Autónoma",
        desc: "Desarrollamos verdaderos 'Agentes Operativos' capaces de razonar, planificar y ejecutar.",
    },
] as const;

export default function AboutPage() {
    const [, setLocation] = useLocation();

    return (
        <div className="min-h-screen bg-white text-zinc-950 flex flex-col">
            {/* Subtle paper-like lighting (still white) */}
            <div
                aria-hidden="true"
                className="pointer-events-none fixed inset-0 bg-[radial-gradient(900px_circle_at_20%_15%,rgba(0,0,0,0.035),transparent_55%),radial-gradient(700px_circle_at_85%_0%,rgba(0,0,0,0.02),transparent_50%),radial-gradient(900px_circle_at_80%_85%,rgba(0,0,0,0.02),transparent_55%)]"
            />

            {/* Header */}
            <header className="sticky top-0 z-20 flex items-center justify-between px-4 md:px-8 h-16 border-b border-zinc-200/80 bg-white/80 backdrop-blur">
                <Button
                    variant="ghost"
                    className="gap-2 text-zinc-900 hover:text-zinc-950 hover:bg-zinc-100"
                    onClick={() => setLocation("/welcome")}
                >
                    <ChevronLeft className="h-4 w-4" />
                    Volver
                </Button>
                <span className="text-sm font-semibold text-zinc-950">Sobre Nosotros</span>
                <div className="w-20" /> {/* Spacer for balance */}
            </header>

            {/* Main Content */}
            <main className="relative z-10 flex-1 px-4 py-14 md:py-16">
                <div className="mx-auto w-full max-w-5xl space-y-16">
                    {/* Hero */}
                    <section className="text-center fade-in-up">
                        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700">
                            <span
                                className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-sky-500 to-fuchsia-500"
                                aria-hidden="true"
                            />
                            Nuestra Misión
                        </div>

                        <h1 className="mt-6 text-4xl md:text-6xl font-black tracking-tight text-zinc-950 leading-[1.05]">
                            Evolucionando el{" "}
                            <br className="hidden md:block" />
                            <span className="relative inline-block">
                                <span className="relative z-10 bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent">
                                    Agente Operativo Local
                                </span>
                                <span
                                    aria-hidden="true"
                                    className="absolute inset-x-0 bottom-1.5 md:bottom-2 h-3 md:h-4 rounded bg-gradient-to-r from-sky-100 via-violet-100 to-fuchsia-100 -z-10"
                                />
                            </span>
                        </h1>

                        <p className="mt-6 text-base md:text-lg text-zinc-700 max-w-2xl mx-auto leading-relaxed">
                            No queríamos hacer otro chat pasivo de IA. Hemos construido el primer sistema inteligente diseñado desde cero para
                            conectar, operar y automatizar directamente el núcleo de tu sistema operativo con privacidad absoluta.
                        </p>

                        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                            <Button
                                onClick={() => setLocation("/signup")}
                                className="rounded-full border border-zinc-900 bg-white text-zinc-950 hover:bg-zinc-950 hover:text-white transition-colors font-semibold px-8"
                            >
                                Únete al viaje
                            </Button>
                            <Button
                                asChild
                                variant="ghost"
                                className="rounded-full text-violet-700 hover:text-violet-800 hover:bg-violet-50 px-8"
                            >
                                <a href="#historia">Conocer más</a>
                            </Button>
                        </div>
                    </section>

                    {/* Values */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 fade-in-up fade-in-up-delay-1">
                        {VALUES.map((item, i) => (
                            <div
                                key={i}
                                className="group rounded-2xl border border-zinc-200 bg-white p-6 shadow-[0_1px_0_rgba(0,0,0,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-400 hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)]"
                            >
                                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-gradient-to-br from-sky-50 via-violet-50 to-fuchsia-50 text-violet-700">
                                    <item.icon className="h-5 w-5" aria-hidden="true" />
                                </div>
                                <h3 className="text-lg font-bold text-zinc-950 transition-colors group-hover:text-violet-700">
                                    {item.title}
                                </h3>
                                <p className="mt-2 text-sm text-zinc-600 leading-relaxed">{item.desc}</p>
                            </div>
                        ))}
                    </div>

                    {/* Story */}
                    <section
                        id="historia"
                        className="scroll-mt-24 rounded-3xl border border-zinc-200 bg-zinc-50 p-8 md:p-12 fade-in-up fade-in-up-delay-2"
                    >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
                            <div className="space-y-4">
                                <h2 className="text-3xl md:text-4xl font-black tracking-tight text-zinc-950">
                                    Nuestra{" "}
                                    <span className="bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent">
                                        Revolución
                                    </span>
                                </h2>
                                <p className="text-zinc-700 leading-relaxed">
                                    Nacimos frustrados por las IAs que solo responden texto en la web, aisladas de donde ocurre el trabajo real.
                                    <br />
                                    <br />
                                    Es por eso que diseñamos ILIAGPT: Un Agente con protocolo MCP que abre una terminal invisible, lee tus sistemas de archivos y
                                    toma el timón cuando se lo pides para resolver problemas complejos de ingeniería y automatización.
                                    <span className="font-semibold text-violet-700"> IA que realmente "hace" el trabajo.</span>
                                </p>

                                <div className="pt-2 flex flex-wrap gap-3">
                                    <Button
                                        onClick={() => setLocation("/signup")}
                                        className="rounded-full border border-zinc-900 bg-white text-zinc-950 hover:bg-zinc-950 hover:text-white transition-colors font-semibold px-8"
                                    >
                                        Únete al viaje
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        className="rounded-full text-violet-700 hover:text-violet-800 hover:bg-violet-50 px-8"
                                        onClick={() => setLocation("/welcome")}
                                    >
                                        Explorar
                                    </Button>
                                </div>
                            </div>

                            <div className="mx-auto w-full max-w-md">
                                <div className="relative aspect-square rounded-3xl border border-zinc-200 bg-black p-8 overflow-hidden shadow-2xl">
                                    <div className="absolute inset-0 bg-gradient-to-br from-violet-900/40 via-transparent to-sky-900/40 opacity-80" />
                                    <div className="relative h-full flex flex-col justify-between items-center text-center">

                                        {/* Advanced SVG Iconography */}
                                        <svg className="w-full h-full max-h-[200px]" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            {/* Microchip Hub */}
                                            <rect x="60" y="60" width="80" height="80" rx="16" stroke="#A5A0FF" strokeWidth="4" fill="#0A0A0A" />
                                            <rect x="75" y="75" width="50" height="50" rx="8" fill="#A5A0FF" opacity="0.2" />
                                            <circle cx="100" cy="100" r="10" fill="#A5A0FF" className="animate-pulse" />

                                            {/* Neural Connections */}
                                            <path d="M100 20 L100 60" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" strokeDasharray="4 4" className="animate-pulse" />
                                            <path d="M100 180 L100 140" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" strokeDasharray="4 4" className="animate-pulse" />
                                            <path d="M20 100 L60 100" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" strokeDasharray="4 4" className="animate-pulse" />
                                            <path d="M180 100 L140 100" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" strokeDasharray="4 4" className="animate-pulse" />

                                            {/* Peripheral Nodes */}
                                            <circle cx="100" cy="20" r="6" fill="#8D88E6" />
                                            <circle cx="100" cy="180" r="6" fill="#8D88E6" />
                                            <circle cx="20" cy="100" r="6" fill="#8D88E6" />
                                            <circle cx="180" cy="100" r="6" fill="#8D88E6" />
                                        </svg>

                                        <div>
                                            <p className="mt-3 text-3xl md:text-4xl font-black tracking-tight text-white mb-2">
                                                <span className="bg-gradient-to-r from-sky-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                                                    Agent OS
                                                </span>
                                            </p>
                                            <p className="mt-2 text-sm text-zinc-300">
                                                Interconexión Total de Sistemas.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </main>

            {/* Footer */}
            <footer className="relative z-10 py-8 text-center border-t border-zinc-200 bg-white">
                <p className="text-zinc-500 text-sm">
                    © {new Date().getFullYear()} ILIAGPT. Todos los derechos reservados.
                </p>
            </footer>
        </div>
    );
}
