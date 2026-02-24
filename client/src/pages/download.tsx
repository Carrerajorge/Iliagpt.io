import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Download, Apple, Monitor, Terminal, Check, ExternalLink, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

import packageJson from "../../../package.json";

const GITHUB_RELEASE_URL = "https://github.com/Carrerajorge/Hola/releases/latest";
const FALLBACK_VERSION = `v${packageJson.version}`;

type AppRelease = {
  id: string;
  platform: string;
  version: string;
  size: string;
  requirements: string;
  available: string;
  fileName: string;
  downloadUrl: string;
  note: string | null;
  isActive: string;
};

export default function DownloadPage() {
  const [, setLocation] = useLocation();

  const { data: releases, isLoading } = useQuery<AppRelease[]>({
    queryKey: ["/api/public/releases"],
  });

  const getIconForPlatform = (platform: string) => {
    const p = platform.toLowerCase();
    if (p.includes("mac")) return Apple;
    if (p.includes("win")) return Monitor;
    return Terminal;
  };

  const features = [
    "Conectado directamente al panel administrativo de ILIAGPT",
    "Auto-actualizaciones automáticas via GitHub Releases",
    "Control nativo del sistema operativo (teclado, ratón, pantalla)",
    "Overlay HUD transparente para monitorear el agente",
    "Tray icon con acceso rápido a todas las funciones",
    "Firmas y artefactos oficiales verificables",
    "Canal de versiones transparente con SHA-512",
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col relative">
      <header className="sticky top-0 z-10 flex items-center justify-between px-4 md:px-8 h-16 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-sm">
        <Button asChild variant="ghost" className="gap-2 text-zinc-300 hover:text-white hover:bg-zinc-800">
          <Link href="/welcome">
            <ChevronLeft className="h-4 w-4" />
            Volver
          </Link>
        </Button>
        <span className="font-semibold text-zinc-100">Descargas Oficiales</span>
        <div className="w-20" />
      </header>

      <main className="relative flex-1 flex flex-col items-center px-4 py-12 overflow-y-auto">
        <div className="w-full max-w-5xl space-y-12">
          <section className="text-center fade-in-up">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950 border border-emerald-700 text-xs font-medium text-emerald-300 mb-6 shadow-sm">
              <Terminal className="h-3 w-3" />
              <span>✅ Conectado a Releases</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-6 text-white leading-[1.05]">
              Lleva el Agente <span className="text-cyan-400">a tu SO</span>
            </h1>
            <p className="text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed">
              Descarga el cliente nativo de ILIAGPT. Se conecta automáticamente a tu panel administrativo para controlar tu sistema operativo de forma segura.
            </p>
          </section>

          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 fade-in-up fade-in-up-delay-1">
              {!releases || releases.length === 0 ? (
                <div className="col-span-full text-center text-zinc-500 py-12 border border-zinc-800 rounded-2xl bg-zinc-900/50">
                  <p>No hay software listado en este momento. Vuelve pronto.</p>
                </div>
              ) : (
                releases.map((platform) => {
                  const Icon = getIconForPlatform(platform.platform);
                  const isAvailable = platform.available === "true";

                  return (
                    <div
                      key={platform.id}
                      className="group p-6 rounded-2xl border border-zinc-800 bg-zinc-900/80 shadow-sm transition-all duration-200 hover:shadow-xl hover:border-cyan-500/60"
                    >
                      <div className="flex items-start justify-between gap-4 mb-5">
                        <div className="inline-flex p-3 rounded-xl border border-zinc-700 bg-zinc-950 text-zinc-100">
                          <Icon className="h-6 w-6" />
                        </div>
                        {isAvailable ? (
                          <span className="mt-1 inline-flex items-center rounded-full border border-emerald-600 bg-emerald-950 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
                            ✅ Disponible
                          </span>
                        ) : (
                          <span className="mt-1 inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-400">
                            Próximamente
                          </span>
                        )}
                      </div>

                      <h3 className="text-xl font-semibold text-zinc-100 mb-1 transition-colors group-hover:text-cyan-400">
                        {platform.platform}
                      </h3>
                      <p className="text-xs text-zinc-400 mb-2">
                        {platform.version} • {platform.size} • {platform.requirements}
                      </p>
                      <p className="text-[10px] text-zinc-500 mb-5 text-balance">
                        {platform.note || "Optimizado para tu arquitectura"}
                      </p>

                      {isAvailable ? (
                        <a href={platform.downloadUrl} target="_blank" rel="noopener noreferrer">
                          <Button className="w-full rounded-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition-all">
                            <Download className="h-4 w-4 mr-2" />
                            Descargar
                          </Button>
                        </a>
                      ) : (
                        <Button disabled className="w-full rounded-full bg-zinc-700 text-zinc-300 font-bold cursor-not-allowed">
                          Pronto disponible
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* All releases link */}
          <div className="text-center fade-in-up fade-in-up-delay-1">
            <a href={GITHUB_RELEASE_URL} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 transition-colors">
              <ExternalLink className="h-4 w-4" />
              Ver código fuente y Releases en GitHub
            </a>
          </div>

          <section className="rounded-3xl p-8 md:p-12 border border-zinc-800 bg-zinc-900/60 fade-in-up fade-in-up-delay-2">
            <div className="grid gap-10 md:grid-cols-2 md:items-center">
              <div>
                <h2 className="text-2xl font-semibold text-zinc-100 mb-2 tracking-tight">Siempre conectado a tu panel</h2>
                <p className="text-sm text-zinc-400 mb-6">La app de escritorio se conecta directamente a tu panel administrativo. Todas tus configuraciones, agentes y datos sincronizados.</p>
                <ul className="space-y-3">
                  {features.map((feature) => (
                    <li key={feature} className="flex items-center gap-3 text-zinc-200">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-cyan-500/40 bg-zinc-950">
                        <Check className="h-4 w-4 text-cyan-400" />
                      </span>
                      <span className="leading-snug">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm font-semibold text-cyan-400">ILIAGPT Desktop Node</div>
                  <div className="text-xs text-zinc-500">{FALLBACK_VERSION}</div>
                </div>
                <div className="space-y-3 text-xs font-mono text-zinc-500">
                  <div className="flex justify-between"><span>macOS (arm64)</span><span className="text-emerald-400">✅ Ready</span></div>
                  <div className="flex justify-between"><span>Windows (x64)</span><span className="text-emerald-400">✅ Ready</span></div>
                  <div className="flex justify-between"><span>Linux (AppImage)</span><span className="text-emerald-400">✅ Ready</span></div>
                  <div className="flex justify-between"><span>Auto-updater</span><span className="text-emerald-400">✅ Activo</span></div>
                  <div className="flex justify-between"><span>Panel sync</span><span className="text-emerald-400">✅ Conectado</span></div>
                </div>
              </div>
            </div>
          </section>

          <section className="text-center fade-in-up fade-in-up-delay-3">
            <p className="text-zinc-400 mb-4">También puedes usar la versión web completa sin instalar nada.</p>
            <Button
              variant="outline"
              className="rounded-full text-zinc-100 border-zinc-600 hover:bg-zinc-800"
              onClick={() => setLocation("/login")}
            >
              Ir a la versión web
            </Button>
          </section>
        </div>
      </main>
    </div>
  );
}
