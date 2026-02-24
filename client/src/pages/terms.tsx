import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ChevronLeft, FileText, Scale, Shield, User } from "lucide-react";

const highlights = [
  {
    icon: User,
    title: "Cuenta y acceso",
    description: "Debes mantener tus credenciales seguras y eres responsable del uso de tu cuenta.",
  },
  {
    icon: Shield,
    title: "Uso responsable",
    description: "No se permite usar el servicio para actividades ilícitas, dañinas o abusivas.",
  },
  {
    icon: FileText,
    title: "Contenido y licencias",
    description: "Conservas tus derechos sobre tu contenido y nos concedes permiso para operarlo.",
  },
  {
    icon: AlertTriangle,
    title: "Limitaciones",
    description: "El servicio se ofrece tal cual. No garantizamos resultados ni disponibilidad total.",
  },
];

const sections = [
  {
    title: "Aceptación de los términos",
    body: "Al acceder a ILIAGPT o crear una cuenta, aceptas estos términos y cualquier política vinculada.",
  },
  {
    title: "Uso permitido",
    body: "Te comprometes a usar ILIAGPT de forma legal, ética y respetando la seguridad de otros usuarios.",
  },
  {
    title: "Propiedad intelectual",
    body: "ILIAGPT conserva sus marcas y tecnología. Tu contenido sigue siendo tuyo, sujeto a la licencia necesaria para prestar el servicio.",
  },
  {
    title: "Disponibilidad del servicio",
    body: "Podemos actualizar, suspender o cambiar funciones para mejorar la plataforma o cumplir requisitos legales.",
  },
  {
    title: "Responsabilidad",
    body: "No asumimos responsabilidad por pérdidas indirectas derivadas del uso del servicio.",
  },
  {
    title: "Cambios a estos términos",
    body: "Si actualizamos los términos, lo comunicaremos por los canales habituales antes de que entren en vigor.",
  },
];

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white text-zinc-900 flex flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 md:px-8 h-16 border-b border-black/10 bg-white/80 backdrop-blur-md">
        <Link href="/welcome">
          <Button variant="ghost" className="rounded-full text-zinc-700 hover:text-zinc-900 hover:bg-black/5 gap-2">
            <ChevronLeft className="h-4 w-4" />
            Volver
          </Button>
        </Link>
        <span className="font-semibold text-zinc-900">Términos</span>
        <div className="w-20" />
      </header>

      <main className="flex-1 px-4 py-12 overflow-y-auto">
        <div className="w-full max-w-4xl mx-auto space-y-10">
          <section className="text-center fade-in-up">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-50 border border-black/10 text-xs font-semibold text-zinc-700 mb-5">
              <Scale className="h-3 w-3" />
              <span>Términos de servicio</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-zinc-950 mb-4">
              Uso de ILIAGPT
            </h1>
            <p className="text-zinc-600 max-w-2xl mx-auto leading-relaxed">
              Estos términos describen las reglas básicas para usar ILIAGPT de forma segura y responsable.
            </p>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 fade-in-up fade-in-up-delay-1">
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
            <h2 className="text-2xl font-extrabold tracking-tight text-zinc-950">Detalle de los términos</h2>
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
            Si necesitas un texto legal específico, indícalo y lo integramos en este apartado.
          </p>
        </div>
      </main>

      <footer className="py-6 text-center border-t border-black/10 bg-white">
        <p className="text-zinc-500 text-sm">© 2026 ILIAGPT. Todos los derechos reservados.</p>
      </footer>
    </div>
  );
}
