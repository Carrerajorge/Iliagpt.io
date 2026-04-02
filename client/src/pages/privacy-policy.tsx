import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, FileText, Lock, Shield, UserCheck } from "lucide-react";

const highlights = [
  {
    icon: Shield,
    title: "Protección de datos",
    description: "Aplicamos medidas técnicas y organizativas para proteger tu información.",
  },
  {
    icon: UserCheck,
    title: "Control del usuario",
    description: "Puedes administrar preferencias, exportar datos y ajustar tu historial.",
  },
  {
    icon: Lock,
    title: "Transparencia",
    description: "Explicamos qué datos usamos y con qué propósito dentro de la plataforma.",
  },
];

const sections = [
  {
    title: "Datos que recopilamos",
    body: "Podemos recopilar datos de cuenta, uso de la aplicación y contenido que compartes con iliagpt.",
  },
  {
    title: "Cómo usamos la información",
    body: "Usamos los datos para operar el servicio, mejorar la experiencia, asegurar la plataforma y brindar soporte.",
  },
  {
    title: "Compartir información",
    body: "Solo compartimos datos con proveedores necesarios para operar el servicio o cuando lo exige la ley.",
  },
  {
    title: "Tus opciones",
    body: "Puedes ajustar tus preferencias de privacidad, descargar datos o solicitar la eliminación de tu cuenta.",
  },
  {
    title: "Retención",
    body: "Conservamos la información mientras sea necesaria para prestar el servicio y cumplir obligaciones legales.",
  },
  {
    title: "Actualizaciones",
    body: "Si actualizamos esta política, lo comunicaremos antes de su entrada en vigor.",
  },
];

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white text-zinc-900 flex flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 md:px-8 h-16 border-b border-black/10 bg-white/80 backdrop-blur-md">
        <Link href="/welcome">
          <Button variant="ghost" className="rounded-full text-zinc-700 hover:text-zinc-900 hover:bg-black/5 gap-2">
            <ChevronLeft className="h-4 w-4" />
            Volver
          </Button>
        </Link>
        <span className="font-semibold text-zinc-900">Política de privacidad</span>
        <div className="w-20" />
      </header>

      <main className="flex-1 px-4 py-12 overflow-y-auto">
        <div className="w-full max-w-4xl mx-auto space-y-10">
          <section className="text-center fade-in-up">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-50 border border-black/10 text-xs font-semibold text-zinc-700 mb-5">
              <FileText className="h-3 w-3" />
              <span>Privacidad</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-zinc-950 mb-4">
              Cómo cuidamos tu información
            </h1>
            <p className="text-zinc-600 max-w-2xl mx-auto leading-relaxed">
              Esta política resume los datos que tratamos y las medidas que aplicamos para protegerlos.
            </p>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 fade-in-up fade-in-up-delay-1">
            {highlights.map((item) => (
              <div
                key={item.title}
                className="p-6 rounded-2xl border border-black/10 bg-white shadow-sm hover:shadow-md hover:border-black/20 transition-all duration-300"
              >
                <div className="w-10 h-10 rounded-xl border border-black/10 bg-zinc-50 flex items-center justify-center mb-4 text-zinc-900">
                  <item.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold text-zinc-950 mb-2">{item.title}</h3>
                <p className="text-sm text-zinc-600 leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>

          <section className="rounded-3xl border border-black/10 bg-zinc-50 p-8 md:p-10 space-y-6 fade-in-up fade-in-up-delay-2">
            <h2 className="text-2xl font-extrabold tracking-tight text-zinc-950">Detalle de la política</h2>
            <div className="grid gap-5">
              {sections.map((section) => (
                <div key={section.title} className="space-y-2">
                  <h3 className="text-lg font-semibold text-zinc-950">{section.title}</h3>
                  <p className="text-sm text-zinc-600 leading-relaxed">{section.body}</p>
                </div>
              ))}
            </div>
          </section>

          <p className="text-xs text-zinc-500 text-center">
            Si tienes una política legal específica, envíala y la reemplazamos en esta página.
          </p>
        </div>
      </main>

      <footer className="py-6 text-center border-t border-black/10 bg-white">
        <p className="text-zinc-500 text-sm">© 2026 iliagpt. Todos los derechos reservados.</p>
      </footer>
    </div>
  );
}
