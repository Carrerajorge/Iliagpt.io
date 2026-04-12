import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  FileText,
  Lock,
  Shield,
  UserCheck,
  Database,
  Globe,
  Clock,
  Mail,
} from "lucide-react";

const highlights = [
  {
    icon: Shield,
    title: "Protección de datos",
    description:
      "Aplicamos cifrado de extremo a extremo y medidas técnicas avanzadas para proteger tu información en todo momento.",
  },
  {
    icon: UserCheck,
    title: "Control total",
    description:
      "Puedes exportar, modificar o eliminar tus datos en cualquier momento desde tu panel de privacidad.",
  },
  {
    icon: Lock,
    title: "Transparencia total",
    description:
      "Detallamos exactamente qué datos recopilamos, cómo los usamos y con quién los compartimos.",
  },
];

const sections = [
  {
    icon: Database,
    title: "1. Datos que recopilamos",
    items: [
      {
        subtitle: "Datos de cuenta",
        body: "Nombre, dirección de correo electrónico y foto de perfil proporcionados durante el registro mediante Google, Microsoft o Auth0.",
      },
      {
        subtitle: "Datos de uso",
        body: "Información sobre cómo interactúas con la plataforma: frecuencia de uso, funciones utilizadas, duración de sesiones y preferencias de configuración.",
      },
      {
        subtitle: "Contenido generado",
        body: "Conversaciones, documentos, memorias y archivos que creas dentro de la plataforma. Este contenido es privado y solo accesible por ti.",
      },
      {
        subtitle: "Datos técnicos",
        body: "Dirección IP, tipo de navegador, sistema operativo, identificadores de dispositivo y datos de rendimiento para garantizar la estabilidad del servicio.",
      },
    ],
  },
  {
    icon: Globe,
    title: "2. Cómo usamos la información",
    items: [
      {
        subtitle: "Operación del servicio",
        body: "Procesamos tus datos para proporcionar, mantener y mejorar las funcionalidades de la plataforma.",
      },
      {
        subtitle: "Personalización",
        body: "Utilizamos tus preferencias y patrones de uso para adaptar la experiencia a tus necesidades.",
      },
      {
        subtitle: "Seguridad",
        body: "Analizamos patrones de acceso para detectar y prevenir actividades fraudulentas o no autorizadas.",
      },
      {
        subtitle: "Comunicaciones",
        body: "Podemos enviarte notificaciones sobre actualizaciones del servicio, cambios en términos o alertas de seguridad.",
      },
    ],
  },
  {
    icon: UserCheck,
    title: "3. Tus derechos (GDPR/RGPD)",
    items: [
      {
        subtitle: "Derecho de acceso",
        body: "Puedes solicitar una copia completa de todos tus datos personales en cualquier momento desde la sección de Privacidad.",
      },
      {
        subtitle: "Derecho de rectificación",
        body: "Puedes modificar o corregir tus datos personales desde tu perfil de usuario.",
      },
      {
        subtitle: "Derecho de supresión",
        body: "Puedes solicitar la eliminación completa de tu cuenta y todos los datos asociados. Esta acción es irreversible.",
      },
      {
        subtitle: "Derecho a la portabilidad",
        body: "Puedes exportar todos tus datos en formato estructurado (JSON) para transferirlos a otro servicio.",
      },
      {
        subtitle: "Derecho de oposición",
        body: "Puedes desactivar el seguimiento de análisis y la compartición de datos de uso desde tu configuración de privacidad.",
      },
    ],
  },
  {
    icon: Lock,
    title: "4. Seguridad de los datos",
    items: [
      {
        subtitle: "Cifrado",
        body: "Todos los datos se transmiten mediante TLS 1.3 y se almacenan con cifrado AES-256 en reposo.",
      },
      {
        subtitle: "Acceso restringido",
        body: "El acceso a los datos de usuario está estrictamente limitado al personal autorizado y se audita de forma continua.",
      },
      {
        subtitle: "Infraestructura",
        body: "Utilizamos proveedores de infraestructura con certificaciones SOC 2 e ISO 27001 para el alojamiento de datos.",
      },
    ],
  },
  {
    icon: Globe,
    title: "5. Compartir información con terceros",
    items: [
      {
        subtitle: "Proveedores de IA",
        body: "Las conversaciones se procesan a través de proveedores de modelos de lenguaje (OpenAI, Anthropic, Google) para generar respuestas. No compartimos datos identificables.",
      },
      {
        subtitle: "Servicios esenciales",
        body: "Utilizamos servicios de autenticación, alojamiento y análisis necesarios para operar la plataforma.",
      },
      {
        subtitle: "Requerimientos legales",
        body: "Solo compartimos datos cuando lo exige la ley o una orden judicial válida.",
      },
    ],
  },
  {
    icon: Clock,
    title: "6. Retención de datos",
    items: [
      {
        subtitle: "Datos activos",
        body: "Conservamos tus datos mientras tu cuenta esté activa y sean necesarios para prestar el servicio.",
      },
      {
        subtitle: "Tras la eliminación",
        body: "Después de solicitar la eliminación de tu cuenta, los datos se eliminan en un plazo máximo de 30 días de nuestros sistemas activos y 90 días de las copias de seguridad.",
      },
      {
        subtitle: "Registros de auditoría",
        body: "Los registros de consentimiento y auditoría se conservan durante el período legalmente requerido para cumplir con obligaciones regulatorias.",
      },
    ],
  },
  {
    icon: Mail,
    title: "7. Actualizaciones y contacto",
    items: [
      {
        subtitle: "Cambios en la política",
        body: "Te notificaremos cualquier cambio material en esta política con al menos 30 días de antelación antes de su entrada en vigor.",
      },
      {
        subtitle: "Contacto",
        body: "Para cualquier consulta sobre privacidad, puedes contactarnos a través de la plataforma o enviando un correo a privacy@iliagpt.io.",
      },
    ],
  },
];

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 md:px-8 h-16 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Link href="/">
          <Button
            variant="ghost"
            className="rounded-full gap-2"
          >
            <ChevronLeft className="h-4 w-4" />
            Volver
          </Button>
        </Link>
        <span className="font-semibold">Politica de privacidad</span>
        <div className="w-20" />
      </header>

      <main className="flex-1 px-4 py-12 overflow-y-auto">
        <div className="w-full max-w-4xl mx-auto space-y-10">
          {/* Hero */}
          <section className="text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted border text-xs font-semibold text-muted-foreground mb-5">
              <FileText className="h-3 w-3" />
              <span>Privacidad</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
              Cómo cuidamos tu información
            </h1>
            <p className="text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Esta politica detalla los datos que recopilamos, cómo los
              utilizamos y las medidas que aplicamos para protegerlos.
              Cumplimos con el Reglamento General de Protección de Datos
              (GDPR/RGPD).
            </p>
            <p className="text-xs text-muted-foreground mt-4">
              Última actualización: 12 de abril de 2026
            </p>
          </section>

          {/* Highlights */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {highlights.map((item) => (
              <div
                key={item.title}
                className="p-6 rounded-2xl border bg-card shadow-sm hover:shadow-md transition-shadow duration-300"
              >
                <div className="w-10 h-10 rounded-xl border bg-muted flex items-center justify-center mb-4">
                  <item.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold mb-2">
                  {item.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>

          {/* Detailed Sections */}
          <section className="rounded-2xl border bg-card p-8 md:p-10 space-y-8">
            <h2 className="text-2xl font-extrabold tracking-tight">
              Detalle de la politica
            </h2>
            <div className="space-y-8">
              {sections.map((section) => (
                <div key={section.title} className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <section.icon className="h-4 w-4" />
                    </div>
                    <h3 className="text-lg font-semibold">
                      {section.title}
                    </h3>
                  </div>
                  <div className="ml-11 space-y-3">
                    {section.items.map((item) => (
                      <div key={item.subtitle}>
                        <p className="text-sm font-medium">
                          {item.subtitle}
                        </p>
                        <p className="text-sm text-muted-foreground leading-relaxed mt-0.5">
                          {item.body}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <p className="text-xs text-muted-foreground text-center">
            Si tienes preguntas sobre esta politica, contacta a{" "}
            <span className="font-medium">privacy@iliagpt.io</span>.
          </p>
        </div>
      </main>

      <footer className="py-6 text-center border-t">
        <p className="text-muted-foreground text-sm">
          &copy; 2026 iliagpt. Todos los derechos reservados.
        </p>
      </footer>
    </div>
  );
}
