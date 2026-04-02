import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft,
  User,
  Mail,
  Building,
  Calendar,
  MessageSquare,
  FileText,
  Zap,
  CheckCircle2,
  Globe,
  Bell,
  Shield,
  Sparkles,
  ChevronRight,
  Loader2
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getPlanLabel } from "@/lib/planUtils";
import { isAdminUser } from "@/lib/admin";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { channelIncludesEmail } from "@/lib/notification-preferences";
import { apiFetch } from "@/lib/apiClient";
import { useToast } from "@/hooks/use-toast";
import { ServiceConnectionPanel } from "@/components/service-connection-panel";

export default function ProfilePage() {
  const [, setLocation] = useLocation();
  const { user, refreshAuth } = useAuth();
  const isAdmin = isAdminUser(user as any);
  const { settings, updateSetting } = useSettingsContext();
  const { toast } = useToast();

  const notificationsEnabled = settings.notifInApp;
  const emailUpdates = channelIncludesEmail(settings.notifRecommendations);
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const stats = [
    { label: "Chats", value: "24", icon: MessageSquare },
    { label: "Documentos", value: "12", icon: FileText },
    { label: "Skills activos", value: "8", icon: Zap },
  ];

  const quickActions = [
    { label: "Privacidad y seguridad", icon: Shield, path: "/privacy" },
    ...(isAdmin ? [{ label: "Facturación", icon: Calendar, path: "/billing" }] : []),
    { label: "Configuración", icon: Globe, path: "/settings" },
  ];

  const displayName = useMemo(
    () => user?.fullName || user?.firstName || user?.email?.split("@")[0] || "Usuario",
    [user?.email, user?.firstName, user?.fullName]
  );
  const initials = useMemo(() => {
    const parts = displayName.split(/\s+/g).filter(Boolean);
    const raw =
      parts.length >= 2 ? `${parts[0][0] || ""}${parts[1][0] || ""}` : (parts[0]?.[0] || "U");
    return raw.toUpperCase();
  }, [displayName]);

  useEffect(() => {
    setFullName(displayName);
    setCompany(user?.company || "");
  }, [displayName, user?.company, user?.id]);

  const canSave = !!user?.id && !isSaving && fullName.trim().length > 0;

  const saveProfile = async () => {
    if (!user?.id) {
      toast({ title: "Sesión requerida", description: "Inicia sesión para guardar cambios.", variant: "destructive" });
      return;
    }
    if (fullName.trim().length === 0) {
      toast({ title: "Nombre requerido", description: "Ingresa tu nombre.", variant: "destructive" });
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
      toast({ title: "Error", description: e?.message || "No se pudo guardar.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/30 to-background">
      <div className="sticky top-0 z-10 backdrop-blur-xl bg-background/80 border-b">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon"
            className="rounded-full"
            onClick={() => setLocation("/")}
            data-testid="button-back-profile"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-medium">Perfil</h1>
        </div>
      </div>
      
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <Card className="border-0 shadow-lg bg-gradient-to-br from-card to-card/80">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <div className="relative group">
                <Avatar className="h-24 w-24 ring-4 ring-background shadow-xl">
                  <AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white text-2xl font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <button 
                  className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  data-testid="button-change-avatar"
                >
                  <span className="text-white text-xs">Cambiar</span>
                </button>
              </div>
              <div className="text-center sm:text-left flex-1">
                <div className="flex items-center justify-center sm:justify-start gap-2">
                  <h2 className="text-2xl font-bold">{displayName}</h2>
                  {isAdmin && (
                    <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                      Admin
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground mt-1">{user?.email || "usuario@email.com"}</p>
                <div className="flex items-center justify-center sm:justify-start gap-2 mt-3">
                  <Badge variant="secondary" className="gap-1">
                    <Sparkles className="h-3 w-3" />
                    {getPlanLabel({
                      plan: (user as any)?.plan,
                      role: (user as any)?.role,
                      subscriptionStatus: (user as any)?.subscriptionStatus,
                      subscriptionPlan: (user as any)?.subscriptionPlan,
                      subscriptionPeriodEnd: (user as any)?.subscriptionPeriodEnd,
                      subscriptionExpiresAt: (user as any)?.subscriptionExpiresAt,
                    })}
                  </Badge>
                  <Badge variant="outline" className="gap-1 text-green-600">
                    <CheckCircle2 className="h-3 w-3" />
                    Activo
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-3 gap-4">
          {stats.map((stat) => (
            <Card key={stat.label} className="border-0 shadow-md hover:shadow-lg transition-shadow">
              <CardContent className="p-4 text-center">
                <stat.icon className="h-5 w-5 mx-auto text-muted-foreground mb-2" />
                <div className="text-2xl font-bold">{stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="border-0 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <User className="h-4 w-4" />
              Información personal
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-xs text-muted-foreground">Nombre</Label>
                <Input 
                  id="name" 
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="bg-muted/50 border-0"
                  data-testid="input-profile-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs text-muted-foreground">Email</Label>
                <Input 
                  id="email" 
                  defaultValue={user?.email || ""}
                  className="bg-muted/50 border-0"
                  disabled
                  data-testid="input-profile-email"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="company" className="text-xs text-muted-foreground flex items-center gap-1">
                <Building className="h-3 w-3" />
                Organización
              </Label>
              <Input 
                id="company" 
                placeholder="Tu empresa u organización"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="bg-muted/50 border-0"
                data-testid="input-profile-company"
              />
            </div>
            <Button className="w-full sm:w-auto" onClick={saveProfile} disabled={!canSave} data-testid="button-save-profile">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Guardar cambios
            </Button>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Servicios conectados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ServiceConnectionPanel />
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Preferencias
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Notificaciones</Label>
                <p className="text-xs text-muted-foreground">Recibir alertas cuando se complete un proceso</p>
              </div>
              <Switch 
                checked={notificationsEnabled} 
                onCheckedChange={(checked) => updateSetting("notifInApp", checked)}
                data-testid="switch-notifications"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Actualizaciones por email</Label>
                <p className="text-xs text-muted-foreground">Recibir novedades y consejos</p>
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

        <Card className="border-0 shadow-md">
          <CardContent className="p-2">
            {quickActions.map((action, i) => (
              <div key={action.label}>
                <button
                  className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors"
                  onClick={() => setLocation(action.path)}
                  data-testid={`button-${action.path.slice(1)}`}
                >
                  <div className="flex items-center gap-3">
                    <action.icon className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{action.label}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
                {i < quickActions.length - 1 && <Separator className="mx-3" />}
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="text-center py-4">
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
