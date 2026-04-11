import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft,
  User,
  Mail,
  Building,
  MessageSquare,
  CheckCircle2,
  Globe,
  Bell,
  Shield,
  Sparkles,
  ChevronRight,
  Loader2,
  Link2,
  Clock3,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getPlanLabel } from "@/lib/planUtils";
import { isAdminUser } from "@/lib/admin";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { channelIncludesEmail } from "@/lib/notification-preferences";
import { apiFetch } from "@/lib/apiClient";
import { useToast } from "@/hooks/use-toast";
import { ServiceConnectionPanel } from "@/components/service-connection-panel";
import { useServiceConnections } from "@/hooks/use-service-connections";

function formatAccountDate(value: unknown, fallback: string): string {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getProviderLabel(authProvider: unknown): string {
  const value = typeof authProvider === "string" ? authProvider.toLowerCase() : "";
  switch (value) {
    case "google":
      return "Google";
    case "microsoft":
      return "Microsoft";
    case "auth0":
      return "Auth0";
    case "email":
      return "Email";
    case "anonymous":
      return "Invitado";
    default:
      return "Cuenta";
  }
}

export default function ProfilePage() {
  const [, setLocation] = useLocation();
  const { user, refreshAuth } = useAuth();
  const isAdmin = isAdminUser(user as any);
  const { settings, updateSetting } = useSettingsContext();
  const { toast } = useToast();
  const { connectedCount, isLoading: isConnectionsLoading } = useServiceConnections();

  const notificationsEnabled = settings.notifInApp;
  const emailUpdates = channelIncludesEmail(settings.notifRecommendations);
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const { data: chatCount = 0, isLoading: isChatCountLoading } = useQuery<number>({
    queryKey: ["profile", "chat-count", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await apiFetch("/api/chats", { credentials: "include" });
      if (!res.ok) return 0;
      const chats = await res.json();
      return Array.isArray(chats) ? chats.length : 0;
    },
  });

  const quickActions = [
    { label: "Privacidad y seguridad", icon: Shield, path: "/privacy" },
    ...(isAdmin ? [{ label: "Facturación", icon: Sparkles, path: "/billing" }] : []),
    { label: "Configuración", icon: Globe, path: "/settings" },
  ];

  const displayName = useMemo(
    () => user?.fullName || (user as any)?.firstName || user?.email?.split("@")[0] || "Usuario",
    [user]
  );

  const profileImageUrl = useMemo(() => {
    const candidate = (user as any)?.profileImageUrl || (user as any)?.avatarUrl || null;
    return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
  }, [user]);

  const initials = useMemo(() => {
    const parts = displayName.split(/\s+/g).filter(Boolean);
    const raw =
      parts.length >= 2 ? `${parts[0][0] || ""}${parts[1][0] || ""}` : parts[0]?.[0] || "U";
    return raw.toUpperCase();
  }, [displayName]);

  const planLabel = getPlanLabel({
    plan: (user as any)?.plan,
    role: (user as any)?.role,
    subscriptionStatus: (user as any)?.subscriptionStatus,
    subscriptionPlan: (user as any)?.subscriptionPlan,
    subscriptionPeriodEnd: (user as any)?.subscriptionPeriodEnd,
    subscriptionExpiresAt: (user as any)?.subscriptionExpiresAt,
  });

  const providerLabel = getProviderLabel((user as any)?.authProvider);
  const emailDomain = user?.email?.split("@")[1] || "Sin dominio";
  const memberSinceLabel = formatAccountDate((user as any)?.createdAt, "Cuenta activa");
  const lastLoginLabel = formatAccountDate((user as any)?.lastLoginAt, "Sesión actual");

  const stats = [
    {
      label: "Plan actual",
      value: planLabel,
      hint: isAdmin ? "Permisos elevados" : "Cuenta operativa",
      icon: Sparkles,
    },
    {
      label: "Chats guardados",
      value: isChatCountLoading ? "..." : String(chatCount),
      hint: "Historial disponible",
      icon: MessageSquare,
    },
    {
      label: "Servicios conectados",
      value: isConnectionsLoading ? "..." : String(connectedCount),
      hint: "Integraciones activas",
      icon: Link2,
    },
    {
      label: "Método de acceso",
      value: providerLabel,
      hint: "Identidad principal",
      icon: ShieldCheck,
    },
  ];

  useEffect(() => {
    setFullName(displayName);
    setCompany((user as any)?.company || "");
  }, [displayName, user]);

  const canSave = !!user?.id && !isSaving && fullName.trim().length > 0;

  const saveProfile = async () => {
    if (!user?.id) {
      toast({
        title: "Sesión requerida",
        description: "Inicia sesión para guardar cambios.",
        variant: "destructive",
      });
      return;
    }
    if (fullName.trim().length === 0) {
      toast({
        title: "Nombre requerido",
        description: "Ingresa tu nombre.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const res = await apiFetch(`/api/users/${user.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          company: company.trim().length ? company.trim() : null,
        }),
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || payload?.message || "No se pudo guardar.");
      }

      toast({ title: "Guardado", description: "Tu perfil se actualizó correctamente." });
      refreshAuth();
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "No se pudo guardar.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,rgba(241,245,249,0.9)_0%,rgba(255,255,255,0.98)_22%,rgba(255,255,255,1)_100%)]">
      <div className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={() => setLocation("/")}
            data-testid="button-back-profile"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">Perfil</h1>
            <p className="text-xs text-muted-foreground">Identidad, cuenta y preferencias</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="overflow-hidden border border-border/60 bg-card shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)]">
            <div className="h-1 bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400" />
            <CardContent className="space-y-8 p-6 pt-6 sm:p-8">
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-5">
                  <Avatar className="h-24 w-24 ring-4 ring-background shadow-xl sm:h-28 sm:w-28">
                    {profileImageUrl ? (
                      <AvatarImage
                        src={profileImageUrl}
                        alt={`Foto de perfil de ${displayName}`}
                        referrerPolicy="no-referrer"
                      />
                    ) : null}
                    <AvatarFallback className="bg-gradient-to-br from-sky-600 to-cyan-500 text-2xl font-semibold text-white">
                      {initials}
                    </AvatarFallback>
                  </Avatar>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                          {displayName}
                        </h2>
                        {isAdmin ? (
                          <Badge className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50">
                            Admin
                          </Badge>
                        ) : null}
                        <Badge variant="outline" className="gap-1 text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Activo
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-2">
                          <Mail className="h-4 w-4" />
                          {user?.email || "usuario@email.com"}
                        </span>
                        <span className="hidden text-muted-foreground/40 sm:inline">•</span>
                        <span>{emailDomain}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary" className="gap-1.5">
                        <Sparkles className="h-3.5 w-3.5" />
                        {planLabel}
                      </Badge>
                      <Badge variant="outline" className="gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Acceso por {providerLabel}
                      </Badge>
                      <Badge variant="outline" className="gap-1.5">
                        <Clock3 className="h-3.5 w-3.5" />
                        Miembro desde {memberSinceLabel}
                      </Badge>
                    </div>

                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      {profileImageUrl
                        ? "La foto del perfil está sincronizada con tu cuenta autenticada y se actualiza automáticamente cuando el proveedor la expone."
                        : "Todavía no hay una foto sincronizada disponible desde tu proveedor de acceso. Mientras tanto usamos un avatar generado con tus iniciales."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {stats.map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-2xl border border-border/60 bg-muted/30 p-4 shadow-sm"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        {stat.label}
                      </span>
                      <stat.icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="text-xl font-semibold tracking-tight">{stat.value}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{stat.hint}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Estado de la cuenta</CardTitle>
              <CardDescription>Resumen operativo y de identidad.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
                <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  Sesión
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Sesión vigente
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Último acceso conocido: {lastLoginLabel}
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3 rounded-xl border border-border/50 p-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Rol</p>
                    <p className="mt-1 font-medium">{isAdmin ? "Administrador" : "Cuenta personal"}</p>
                  </div>
                  <Shield className="mt-0.5 h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex items-start justify-between gap-3 rounded-xl border border-border/50 p-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Organización</p>
                    <p className="mt-1 font-medium">
                      {company.trim().length > 0 ? company : "Sin organización definida"}
                    </p>
                  </div>
                  <Building className="mt-0.5 h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex items-start justify-between gap-3 rounded-xl border border-border/50 p-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Proveedor</p>
                    <p className="mt-1 font-medium">{providerLabel}</p>
                  </div>
                  <Globe className="mt-0.5 h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="border border-border/60 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base font-medium">
                <User className="h-4 w-4" />
                Información personal
              </CardTitle>
              <CardDescription>
                Actualiza tu nombre visible y la organización asociada a esta cuenta.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    Nombre visible
                  </Label>
                  <Input
                    id="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="h-11 border-border/60 bg-background"
                    data-testid="input-profile-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    Email
                  </Label>
                  <Input
                    id="email"
                    value={user?.email || ""}
                    className="h-11 border-border/60 bg-muted/40"
                    disabled
                    data-testid="input-profile-email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="company"
                  className="flex items-center gap-1 text-xs uppercase tracking-[0.12em] text-muted-foreground"
                >
                  <Building className="h-3.5 w-3.5" />
                  Organización
                </Label>
                <Input
                  id="company"
                  placeholder="Tu empresa u organización"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="h-11 border-border/60 bg-background"
                  data-testid="input-profile-company"
                />
              </div>

              <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4 text-sm text-sky-900">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-700" />
                  <div>
                    <p className="font-medium">Foto de perfil sincronizada</p>
                    <p className="mt-1 text-sky-800/80">
                      La imagen se toma de tu proveedor de acceso cuando está disponible. No hace falta subirla manualmente.
                    </p>
                  </div>
                </div>
              </div>

              <Button
                className="w-full sm:w-auto"
                onClick={saveProfile}
                disabled={!canSave}
                data-testid="button-save-profile"
              >
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Guardar cambios
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border border-border/60 shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                  <Bell className="h-4 w-4" />
                  Preferencias
                </CardTitle>
                <CardDescription>
                  Controla cómo quieres recibir avisos y novedades.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium">Notificaciones</Label>
                    <p className="text-xs text-muted-foreground">
                      Recibir alertas cuando se complete un proceso.
                    </p>
                  </div>
                  <Switch
                    checked={notificationsEnabled}
                    onCheckedChange={(checked) => updateSetting("notifInApp", checked)}
                    data-testid="switch-notifications"
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium">Actualizaciones por email</Label>
                    <p className="text-xs text-muted-foreground">
                      Recibir novedades, mejoras y consejos de uso.
                    </p>
                  </div>
                  <Switch
                    checked={emailUpdates}
                    onCheckedChange={(checked) => {
                      const current = settings.notifRecommendations;

                      if (checked) {
                        if (current === "none") updateSetting("notifRecommendations", "email");
                        else if (current === "push") updateSetting("notifRecommendations", "push_email");
                        return;
                      }

                      if (current === "push_email") updateSetting("notifRecommendations", "push");
                      else if (current === "email") updateSetting("notifRecommendations", "none");
                    }}
                    data-testid="switch-email-updates"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border border-border/60 shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-base">Accesos rápidos</CardTitle>
                <CardDescription>Atajos útiles para la gestión de tu cuenta.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {quickActions.map((action, index) => (
                  <div key={action.label}>
                    <button
                      className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted/50"
                      onClick={() => setLocation(action.path)}
                      data-testid={`button-${action.path.slice(1)}`}
                    >
                      <div className="flex items-center gap-3">
                        <action.icon className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{action.label}</span>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                    {index < quickActions.length - 1 ? <Separator /> : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="mt-6 border border-border/60 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <Link2 className="h-4 w-4" />
              Servicios conectados
            </CardTitle>
            <CardDescription>
              Gestiona las integraciones activas para correo, calendario, productividad y desarrollo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ServiceConnectionPanel />
          </CardContent>
        </Card>

        <div className="py-6 text-center">
          <p className="text-xs text-muted-foreground">
            iliagpt v1.0 ·{" "}
            <button className="underline hover:text-foreground" onClick={() => setLocation("/terms")} type="button">
              Términos
            </button>{" "}
            ·{" "}
            <button className="underline hover:text-foreground" onClick={() => setLocation("/privacy")} type="button">
              Privacidad
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
