import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { IliaGPTLogo } from "@/components/iliagpt-logo";
import { useLocation } from "wouter";

export default function MaintenancePage() {
  const [, setLocation] = useLocation();
  const { settings } = usePlatformSettings();

  const appName = settings.app_name || "App";
  const description = settings.app_description || "";
  const supportEmail = (settings.support_email || "").trim();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <IliaGPTLogo size={32} />
            <div className="flex flex-col">
              <CardTitle className="text-lg">{appName}</CardTitle>
              {description ? (
                <CardDescription className="text-xs">{description}</CardDescription>
              ) : null}
            </div>
          </div>
          <div>
            <CardTitle className="text-2xl">Mantenimiento</CardTitle>
            <CardDescription className="mt-2">
              Estamos realizando actualizaciones. Vuelve a intentar en unos minutos.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {supportEmail ? (
            <p className="text-sm text-muted-foreground">
              Soporte:{" "}
              <a className="text-primary hover:underline" href={`mailto:${supportEmail}`}>
                {supportEmail}
              </a>
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Si eres administrador, inicia sesion para acceder al panel y desactivar el modo mantenimiento.
          </p>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reintentar
          </Button>
          <Button onClick={() => setLocation("/login")}>Iniciar sesion</Button>
        </CardFooter>
      </Card>
    </div>
  );
}

