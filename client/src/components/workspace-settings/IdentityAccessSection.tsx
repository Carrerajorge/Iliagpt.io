import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/apiClient";
import { useToast } from "@/hooks/use-toast";
import { Admin2FAGate } from "@/components/admin/Admin2FAGate";

type TwoFactorMode = "setup_required" | "verify_required";

type TwoFactorStatus = {
  enabled: boolean;
  verified: boolean;
};

type TwoFactorSetup = {
  secret: string;
  qrCodeUrl: string;
  qrCodeImage: string;
  backupCodes: string[];
  message?: string;
};

type IdentityDraft = {
  allow_registration: boolean;
  require_email_verification: boolean;
  session_timeout_minutes: number;
  max_login_attempts: number;
  lockout_duration_minutes: number;
  require_2fa_admins: boolean;
};

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === "string") {
    const s = value.toLowerCase().trim();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return fallback;
}

function coerceNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function parse2FAErrorMode(payload: any): TwoFactorMode | null {
  const code = payload?.code || payload?.errorCode;
  if (code === "2FA_REQUIRED") return "verify_required";
  if (code === "2FA_SETUP_REQUIRED") return "setup_required";
  return null;
}

function normalizeTwoFactorCode(value: string): string {
  return value.replace(/\s+/g, "").trim().toUpperCase();
}

export function IdentityAccessSection({
  isAdmin,
  onContactAdmin,
}: {
  isAdmin: boolean;
  onContactAdmin?: (action: string) => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gateMode, setGateMode] = useState<TwoFactorMode | null>(null);
  const [initial, setInitial] = useState<IdentityDraft | null>(null);
  const [draft, setDraft] = useState<IdentityDraft | null>(null);
  const [twoFactorStatus, setTwoFactorStatus] = useState<TwoFactorStatus | null>(null);
  const [twoFactorLoading, setTwoFactorLoading] = useState(false);
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [twoFactorSetup, setTwoFactorSetup] = useState<TwoFactorSetup | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [backupCopied, setBackupCopied] = useState(false);
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);

  const dirty = useMemo(() => {
    if (!initial || !draft) return false;
    return JSON.stringify(initial) !== JSON.stringify(draft);
  }, [initial, draft]);

  const validationError = useMemo(() => {
    if (!draft) return null;
    const checks: Array<{ key: keyof IdentityDraft; min: number; max: number; label: string }> = [
      { key: "session_timeout_minutes", min: 5, max: 60 * 24 * 30, label: "Tiempo de sesión (minutos)" },
      { key: "max_login_attempts", min: 1, max: 50, label: "Máx. intentos de inicio de sesión" },
      { key: "lockout_duration_minutes", min: 1, max: 24 * 60, label: "Bloqueo (minutos)" },
    ];
    for (const c of checks) {
      const value = draft[c.key] as unknown as number;
      if (!Number.isFinite(value)) return `${c.label}: valor inválido`;
      if (value < c.min || value > c.max) return `${c.label}: debe estar entre ${c.min} y ${c.max}`;
    }
    return null;
  }, [draft]);

  const loadSettings = async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    setGateMode(null);
    try {
      const [usersRes, securityRes] = await Promise.all([
        apiFetch("/api/admin/settings/category/users"),
        apiFetch("/api/admin/settings/category/security"),
      ]);

      const usersPayload = await usersRes.json().catch(() => null);
      if (!usersRes.ok) {
        const mode = parse2FAErrorMode(usersPayload);
        if (mode) {
          setGateMode(mode);
          return;
        }
        throw new Error(usersPayload?.error || usersPayload?.message || "No se pudo cargar la configuración de usuarios.");
      }

      const securityPayload = await securityRes.json().catch(() => null);
      if (!securityRes.ok) {
        const mode = parse2FAErrorMode(securityPayload);
        if (mode) {
          setGateMode(mode);
          return;
        }
        throw new Error(securityPayload?.error || securityPayload?.message || "No se pudo cargar la configuración de seguridad.");
      }

      const all = ([] as any[]).concat(usersPayload || [], securityPayload || []);
      const getValue = (key: string) => all.find((s) => s?.key === key)?.value;

      const next: IdentityDraft = {
        allow_registration: coerceBoolean(getValue("allow_registration"), true),
        require_email_verification: coerceBoolean(getValue("require_email_verification"), false),
        session_timeout_minutes: coerceNumber(getValue("session_timeout_minutes"), 1440),
        max_login_attempts: coerceNumber(getValue("max_login_attempts"), 5),
        lockout_duration_minutes: coerceNumber(getValue("lockout_duration_minutes"), 30),
        require_2fa_admins: coerceBoolean(getValue("require_2fa_admins"), false),
      };

      setInitial(next);
      setDraft(next);
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar la configuración.");
    } finally {
      setLoading(false);
    }
  };

  const loadTwoFactorStatus = async () => {
    if (!isAdmin) return;
    setTwoFactorLoading(true);
    try {
      const res = await apiFetch("/api/2fa/status");
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || payload?.message || "No se pudo cargar el estado de 2FA.");
      }
      setTwoFactorStatus({
        enabled: Boolean(payload?.enabled),
        verified: Boolean(payload?.verified),
      });
    } catch {
      setTwoFactorStatus(null);
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const copyBackupCodes = async (codes: string[]) => {
    if (!codes?.length) return;
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setBackupCopied(true);
      setTimeout(() => setBackupCopied(false), 1500);
      toast({ title: "Códigos copiados", description: "Guárdalos en un lugar seguro." });
    } catch {
      toast({ title: "Error", description: "No se pudieron copiar los códigos.", variant: "destructive" });
    }
  };

  const startTwoFactorSetup = async () => {
    setTwoFactorBusy(true);
    setNewBackupCodes(null);
    try {
      const res = await apiFetch("/api/2fa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || payload?.message || "No se pudo iniciar la configuración de 2FA.");
      }
      setTwoFactorSetup(payload as TwoFactorSetup);
      toast({ title: "2FA listo para configurar", description: "Escanea el QR y verifica el código." });
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "No se pudo iniciar 2FA.", variant: "destructive" });
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const verifyTwoFactorSetup = async () => {
    const normalized = normalizeTwoFactorCode(twoFactorCode);
    if (normalized.length < 6) {
      toast({ title: "Código inválido", description: "Ingresa un código válido.", variant: "destructive" });
      return;
    }
    setTwoFactorBusy(true);
    try {
      const res = await apiFetch("/api/2fa/verify-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalized }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || payload?.message || "No se pudo verificar 2FA.");
      }
      setTwoFactorSetup(null);
      setTwoFactorCode("");
      setTwoFactorStatus({ enabled: true, verified: true });
      toast({ title: "2FA activado", description: "Tu cuenta ahora tiene 2FA." });
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "No se pudo activar 2FA.", variant: "destructive" });
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const verifyTwoFactorSession = async () => {
    const normalized = normalizeTwoFactorCode(twoFactorCode);
    if (normalized.length < 6) {
      toast({ title: "Código inválido", description: "Ingresa un código válido.", variant: "destructive" });
      return;
    }
    setTwoFactorBusy(true);
    try {
      const res = await apiFetch("/api/2fa/verify-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalized }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || payload?.message || "No se pudo verificar la sesión.");
      }
      setTwoFactorStatus({ enabled: true, verified: true });
      toast({ title: "Sesión verificada", description: "Puedes acceder a rutas de administración." });
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "No se pudo verificar la sesión.", variant: "destructive" });
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const regenerateBackupCodes = async () => {
    const normalized = normalizeTwoFactorCode(twoFactorCode);
    if (normalized.length < 6) {
      toast({ title: "Código inválido", description: "Ingresa un código válido.", variant: "destructive" });
      return;
    }
    setTwoFactorBusy(true);
    try {
      const res = await apiFetch("/api/2fa/regenerate-backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalized }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || payload?.message || "No se pudieron regenerar los códigos.");
      }
      const codes = Array.isArray(payload?.backupCodes) ? payload.backupCodes : [];
      setNewBackupCodes(codes);
      toast({ title: "Códigos regenerados", description: "Guárdalos antes de salir." });
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "No se pudieron regenerar los códigos.", variant: "destructive" });
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const disableTwoFactor = async () => {
    const normalized = normalizeTwoFactorCode(twoFactorCode);
    if (normalized.length < 6) {
      toast({ title: "Código inválido", description: "Ingresa un código válido.", variant: "destructive" });
      return;
    }
    setTwoFactorBusy(true);
    try {
      const res = await apiFetch("/api/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalized }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || payload?.message || "No se pudo desactivar 2FA.");
      }
      setTwoFactorSetup(null);
      setTwoFactorCode("");
      setNewBackupCodes(null);
      setTwoFactorStatus({ enabled: false, verified: false });
      toast({ title: "2FA desactivado", description: "Tu cuenta ya no requiere 2FA." });
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "No se pudo desactivar 2FA.", variant: "destructive" });
    } finally {
      setTwoFactorBusy(false);
    }
  };

  useEffect(() => {
    void loadSettings();
    void loadTwoFactorStatus();
  }, [isAdmin]);

  const discardChanges = () => {
    if (!initial) return;
    setDraft(initial);
  };

  const save = async () => {
    if (!draft || !isAdmin) return;
    if (validationError) {
      toast({ title: "Revisa los campos", description: validationError, variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch("/api/admin/settings/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: [
            { key: "allow_registration", value: draft.allow_registration },
            { key: "require_email_verification", value: draft.require_email_verification },
            { key: "session_timeout_minutes", value: draft.session_timeout_minutes },
            { key: "max_login_attempts", value: draft.max_login_attempts },
            { key: "lockout_duration_minutes", value: draft.lockout_duration_minutes },
            { key: "require_2fa_admins", value: draft.require_2fa_admins },
          ],
        }),
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const mode = parse2FAErrorMode(payload);
        if (mode) {
          setGateMode(mode);
          return;
        }
        throw new Error(payload?.error || payload?.message || "No se pudo guardar la configuración.");
      }

      const updatedCount = typeof payload?.updated === "number" ? payload.updated : null;
      toast({
        title: "Configuración guardada",
        description: updatedCount === null ? "Los cambios se aplicaron correctamente." : `Cambios aplicados: ${updatedCount}.`,
      });

      setInitial(draft);
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "No se pudo guardar la configuración.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!draft && isAdmin && gateMode) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Identidad y acceso</h1>
          <p className="text-sm text-muted-foreground">Configura la identidad y el acceso de tu espacio de trabajo.</p>
        </div>
        <Admin2FAGate
          mode={gateMode}
          onVerified={() => {
            setGateMode(null);
            void loadSettings();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Identidad y acceso</h1>
        <p className="text-sm text-muted-foreground">Configura la identidad y el acceso de tu espacio de trabajo.</p>
      </div>

      {!isAdmin ? (
        <div className="rounded-lg border bg-muted/30 p-4 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Solo administrador</p>
            <p className="text-sm text-muted-foreground">
              Para cambiar configuraciones de identidad, sesión o seguridad, contacta al administrador.
            </p>
          </div>
          {onContactAdmin ? (
            <Button
              variant="outline"
              onClick={() => onContactAdmin("workspace_identity_access")}
              data-testid="button-identity-contact-admin"
            >
              Contactar administrador
            </Button>
          ) : null}
        </div>
      ) : null}

      {isAdmin ? (
        <>
          {gateMode ? (
            <Admin2FAGate
              mode={gateMode}
              onVerified={() => {
                setGateMode(null);
                void loadSettings();
              }}
            />
          ) : loading ? (
            <div className="text-sm text-muted-foreground">Cargando configuración...</div>
          ) : error ? (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="text-sm font-medium">No se pudo cargar</div>
              <div className="text-sm text-muted-foreground">{error}</div>
              <div>
                <Button variant="outline" onClick={() => void loadSettings()} data-testid="button-identity-retry">
                  Reintentar
                </Button>
              </div>
            </div>
          ) : !draft ? (
            <div className="text-sm text-muted-foreground">No hay datos.</div>
          ) : (
            <>
              <div className="border rounded-lg p-6 space-y-4">
                <div>
                  <h2 className="text-lg font-medium">Registro y verificación</h2>
                  <p className="text-sm text-muted-foreground">Controla cómo se crean y validan las cuentas.</p>
                </div>

                <Separator />

                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Permitir registro</div>
                    <div className="text-xs text-muted-foreground">Permite que nuevos usuarios creen una cuenta.</div>
                  </div>
                  <Switch
                    checked={draft.allow_registration}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => (prev ? { ...prev, allow_registration: checked } : prev))
                    }
                    data-testid="switch-allow-registration"
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Requerir verificación de email</div>
                    <div className="text-xs text-muted-foreground">Exige confirmar el correo antes de iniciar sesión.</div>
                  </div>
                  <Switch
                    checked={draft.require_email_verification}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => (prev ? { ...prev, require_email_verification: checked } : prev))
                    }
                    data-testid="switch-require-email-verification"
                  />
                </div>
              </div>

              <div className="border rounded-lg p-6 space-y-4">
                <div>
                  <h2 className="text-lg font-medium">Sesiones</h2>
                  <p className="text-sm text-muted-foreground">Define cuánto dura una sesión antes de expirar.</p>
                </div>

                <Separator />

                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Tiempo de sesión (minutos)</div>
                    <div className="text-xs text-muted-foreground">Por defecto: 1440 (24 horas).</div>
                  </div>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={5}
                    max={60 * 24 * 30}
                    className="w-40"
                    value={String(draft.session_timeout_minutes)}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setDraft((prev) => (prev ? { ...prev, session_timeout_minutes: next } : prev));
                    }}
                    data-testid="input-session-timeout-minutes"
                  />
                </div>
              </div>

              <div className="border rounded-lg p-6 space-y-4">
                <div>
                  <h2 className="text-lg font-medium">Seguridad</h2>
                  <p className="text-sm text-muted-foreground">Protecciones básicas para el acceso y el panel de administración.</p>
                </div>

                <Separator />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Máx. intentos de inicio de sesión</div>
                    <div className="text-xs text-muted-foreground">Bloquea el acceso tras intentos fallidos consecutivos.</div>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={50}
                      value={String(draft.max_login_attempts)}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        setDraft((prev) => (prev ? { ...prev, max_login_attempts: next } : prev));
                      }}
                      data-testid="input-max-login-attempts"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="text-sm font-medium">Bloqueo (minutos)</div>
                    <div className="text-xs text-muted-foreground">Tiempo de bloqueo después de exceder el máximo.</div>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={24 * 60}
                      value={String(draft.lockout_duration_minutes)}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        setDraft((prev) => (prev ? { ...prev, lockout_duration_minutes: next } : prev));
                      }}
                      data-testid="input-lockout-duration-minutes"
                    />
                  </div>
                </div>

                <Separator />

                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Requerir 2FA para administradores</div>
                    <div className="text-xs text-muted-foreground">
                      Si está activo, los administradores deberán configurar y verificar 2FA para acceder a rutas de administración.
                    </div>
                  </div>
                  <Switch
                    checked={draft.require_2fa_admins}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => (prev ? { ...prev, require_2fa_admins: checked } : prev))
                    }
                    data-testid="switch-require-2fa-admins"
                  />
                </div>

                <Separator />

                <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">2FA en tu cuenta</div>
                    <div className="text-xs text-muted-foreground">
                      {twoFactorLoading
                        ? "Cargando estado..."
                        : twoFactorStatus
                          ? twoFactorStatus.enabled
                            ? twoFactorStatus.verified
                              ? "Activo y verificado para esta sesión."
                              : "Activo, pero esta sesión no está verificada."
                            : "No configurado."
                          : "Estado no disponible."}
                    </div>
                  </div>

                  {!twoFactorStatus?.enabled ? (
                    <div className="space-y-3">
                      <Button
                        variant="outline"
                        onClick={() => void startTwoFactorSetup()}
                        disabled={twoFactorBusy}
                        data-testid="button-2fa-setup"
                      >
                        {twoFactorSetup ? "Reiniciar configuración" : "Iniciar configuración de 2FA"}
                      </Button>

                      {twoFactorSetup ? (
                        <div className="space-y-4">
                          <div className="rounded-lg border p-3">
                            <div className="text-sm font-medium">Escanea el código QR</div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Usa Google Authenticator, Authy o cualquier app compatible con TOTP.
                            </div>
                            <div className="mt-3 flex justify-center">
                              <img
                                src={twoFactorSetup.qrCodeImage}
                                alt="Código QR 2FA"
                                className="h-44 w-44 rounded bg-white p-2"
                              />
                            </div>
                          </div>

                          <div className="rounded-lg border p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="text-sm font-medium">Códigos de respaldo</div>
                                <div className="text-xs text-muted-foreground">Guárdalos en un lugar seguro.</div>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void copyBackupCodes(twoFactorSetup.backupCodes || [])}
                                disabled={twoFactorBusy}
                                data-testid="button-2fa-copy-backup"
                              >
                                {backupCopied ? "Copiados" : "Copiar"}
                              </Button>
                            </div>
                            <pre className="text-xs bg-muted/40 rounded p-2 overflow-auto max-h-40">
                              {(twoFactorSetup.backupCodes || []).join("\n")}
                            </pre>
                          </div>

                          <div className="space-y-2">
                            <div className="text-sm font-medium">Verifica tu código</div>
                            <Input
                              inputMode="numeric"
                              placeholder="123456"
                              value={twoFactorCode}
                              onChange={(e) => setTwoFactorCode(e.target.value.replace(/\\s+/g, ""))}
                              maxLength={12}
                              data-testid="input-2fa-verify"
                            />
                            <Button
                              onClick={() => void verifyTwoFactorSetup()}
                              disabled={twoFactorBusy}
                              data-testid="button-2fa-verify-setup"
                            >
                              Verificar y activar
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">
                          Ingresa un código del autenticador o un código de respaldo.
                        </div>
                        <Input
                          inputMode="text"
                          placeholder="123456 o ABCD-EFGH"
                          value={twoFactorCode}
                          onChange={(e) => setTwoFactorCode(e.target.value.replace(/\\s+/g, ""))}
                          maxLength={12}
                          data-testid="input-2fa-code"
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {!twoFactorStatus.verified ? (
                          <Button
                            variant="outline"
                            onClick={() => void verifyTwoFactorSession()}
                            disabled={twoFactorBusy}
                            data-testid="button-2fa-verify-session"
                          >
                            Verificar sesión
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          onClick={() => void regenerateBackupCodes()}
                          disabled={twoFactorBusy}
                          data-testid="button-2fa-regenerate"
                        >
                          Regenerar códigos
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => void disableTwoFactor()}
                          disabled={twoFactorBusy}
                          data-testid="button-2fa-disable"
                        >
                          Desactivar 2FA
                        </Button>
                      </div>

                      {newBackupCodes ? (
                        <div className="rounded-lg border p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="text-sm font-medium">Nuevos códigos de respaldo</div>
                              <div className="text-xs text-muted-foreground">Cópialos y guárdalos ahora.</div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void copyBackupCodes(newBackupCodes)}
                              disabled={twoFactorBusy}
                              data-testid="button-2fa-copy-new-backup"
                            >
                              {backupCopied ? "Copiados" : "Copiar"}
                            </Button>
                          </div>
                          <pre className="text-xs bg-muted/40 rounded p-2 overflow-auto max-h-40">
                            {newBackupCodes.join("\n")}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  {validationError ? <span className="text-destructive">{validationError}</span> : dirty ? "Cambios sin guardar" : "Sin cambios"}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={discardChanges}
                    disabled={!dirty || saving}
                    data-testid="button-identity-discard"
                  >
                    Descartar
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void save()}
                    disabled={!dirty || saving || !!validationError}
                    data-testid="button-identity-save"
                  >
                    {saving ? "Guardando..." : "Guardar"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
