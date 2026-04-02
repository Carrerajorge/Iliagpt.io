import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/apiClient";
import { useWhatsAppWebStatus } from "@/hooks/use-whatsapp-web";
import { ArrowLeft, ExternalLink } from "lucide-react";

const WhatsAppConnectDialogInner = lazy(() =>
  import("@/components/whatsapp-connect-dialog").then((m) => ({
    default: m.WhatsAppConnectDialog,
  }))
);

/* ─── Channel status hook ─────────────────────────── */

type IntegrationStatus = "active" | "inactive" | "unknown";

function useChannelStatus(channelId: "telegram" | "messenger" | "wechat", enabled: boolean) {
  const [status, setStatus] = useState<IntegrationStatus>("unknown");
  const [accounts, setAccounts] = useState<any[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/integrations/${channelId}/status`);
      if (!res.ok) { setStatus("unknown"); setAccounts([]); return; }
      const data = await res.json();
      const accounts: any[] = Array.isArray(data?.accounts) ? data.accounts : [];
      setAccounts(accounts);
      const hasActive = accounts.some((a) => a.status === "active");
      setStatus(hasActive ? "active" : accounts.length > 0 ? "inactive" : "unknown");
    } catch {
      setStatus("unknown");
      setAccounts([]);
    }
  }, [channelId]);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  return { status, accounts, refresh };
}

/* ─── Channel definitions ─────────────────────────── */

type ChannelId = "whatsapp" | "telegram" | "messenger" | "wechat";

interface ChannelDef {
  id: ChannelId;
  name: string;
  description: string;
  color: string;         // tailwind accent
  bgHover: string;
  borderColor: string;
  logo: string;          // svg component rendered inline
  available: boolean;    // false = "Próximamente"
}

const CHANNELS: ChannelDef[] = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Conecta tu WhatsApp personal o Business escaneando un código QR.",
    color: "text-green-600",
    bgHover: "hover:bg-green-50 dark:hover:bg-green-950/20",
    borderColor: "border-green-200 dark:border-green-800",
    logo: "whatsapp",
    available: true,
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Vincula un bot de Telegram usando el token de BotFather.",
    color: "text-blue-500",
    bgHover: "hover:bg-blue-50 dark:hover:bg-blue-950/20",
    borderColor: "border-blue-200 dark:border-blue-800",
    logo: "telegram",
    available: true,
  },
  {
    id: "messenger",
    name: "Messenger",
    description: "Conecta tu página de Facebook para recibir mensajes.",
    color: "text-purple-600",
    bgHover: "hover:bg-purple-50 dark:hover:bg-purple-950/20",
    borderColor: "border-purple-200 dark:border-purple-800",
    logo: "messenger",
    available: true,
  },
  {
    id: "wechat",
    name: "WeChat",
    description: "Integra tu cuenta oficial de WeChat para el mercado chino.",
    color: "text-emerald-600",
    bgHover: "hover:bg-emerald-50 dark:hover:bg-emerald-950/20",
    borderColor: "border-emerald-200 dark:border-emerald-800",
    logo: "wechat",
    available: true,
  },
];

/* ─── SVG Logos ───────────────────────────────────── */

function WhatsAppLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none">
      <path
        d="M24 4C12.954 4 4 12.954 4 24c0 3.53.922 6.84 2.533 9.71L4 44l10.59-2.47A19.9 19.9 0 0 0 24 44c11.046 0 20-8.954 20-20S35.046 4 24 4Z"
        fill="#25D366"
      />
      <path
        d="M34.6 28.4c-.6-.3-3.5-1.7-4-1.9-.6-.2-.9-.3-1.3.3-.4.6-1.5 1.9-1.8 2.3-.3.4-.7.4-1.3.1-.6-.3-2.5-.9-4.7-2.9-1.7-1.6-2.9-3.5-3.2-4.1-.3-.6 0-.9.3-1.2.2-.3.6-.7.8-1 .3-.3.3-.6.5-1 .2-.4.1-.7 0-1-.2-.3-1.3-3.1-1.8-4.3-.5-1.1-.9-1-1.3-1h-1.1c-.4 0-1 .1-1.5.7-.6.6-2 2-2 4.8s2.1 5.6 2.4 6c.3.4 4.1 6.3 10 8.8 1.4.6 2.5 1 3.3 1.2 1.4.4 2.7.4 3.7.2 1.1-.2 3.5-1.4 4-2.8.5-1.4.5-2.5.3-2.8-.1-.3-.5-.4-1.1-.7Z"
        fill="#fff"
      />
    </svg>
  );
}

function TelegramLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none">
      <circle cx="24" cy="24" r="20" fill="#2AABEE" />
      <path
        d="M10.9 23.3c6.4-2.8 10.7-4.6 12.8-5.5 6.1-2.5 7.4-3 8.2-3 .2 0 .6 0 .9.3.2.2.3.5.3.7 0 .2 0 .5-.1.7-.5 5.4-2.7 18.4-3.8 24.4-.5 2.5-1.4 3.4-2.3 3.5-2 .2-3.5-1.3-5.4-2.6-3-2-4.7-3.3-7.6-5.2-3.4-2.3-.1-3.5 2.3-5.6.4-.4 7.5-6.9 7.6-7.5 0-.1 0-.3-.1-.4-.1-.1-.3-.1-.5 0-.2.1-4.1 2.6-11.5 7.6-1.1.7-2.1 1.1-3 1.1-1 0-2.9-.6-4.3-1-1.7-.6-3.1-.9-3-1.9.1-.5.8-1.1 2.2-1.6Z"
        fill="#fff"
      />
    </svg>
  );
}

function MessengerLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none">
      <defs>
        <linearGradient id="msg-grad" x1="24" y1="2" x2="24" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00B2FF" />
          <stop offset="1" stopColor="#006AFF" />
        </linearGradient>
      </defs>
      <path
        d="M24 2C11.85 2 2 11.32 2 23.16c0 6.35 2.6 11.76 6.83 15.56V46l7.19-3.95c2.49.69 5.15 1.07 7.98 1.07 12.15 0 22-9.32 22-21.16S36.15 2 24 2Z"
        fill="url(#msg-grad)"
      />
      <path
        d="m10.5 28.8 6.63-10.53a3.3 3.3 0 0 1 4.77-.88l5.27 3.95a1.32 1.32 0 0 0 1.59 0l7.12-5.4c.95-.72 2.19.44 1.37 1.29l-6.63 10.53a3.3 3.3 0 0 1-4.77.88l-5.27-3.95a1.32 1.32 0 0 0-1.59 0l-7.12 5.4c-.95.72-2.19-.44-1.37-1.29Z"
        fill="#fff"
      />
    </svg>
  );
}

function WeChatLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none">
      <ellipse cx="19" cy="21" rx="14" ry="12" fill="#7BB32E" />
      <circle cx="14" cy="19" r="1.5" fill="#fff" />
      <circle cx="23" cy="19" r="1.5" fill="#fff" />
      <ellipse cx="29" cy="28" rx="12" ry="10" fill="#25D366" />
      <circle cx="25" cy="27" r="1.2" fill="#fff" />
      <circle cx="33" cy="27" r="1.2" fill="#fff" />
    </svg>
  );
}

function ChannelLogo({ id, className }: { id: ChannelId; className?: string }) {
  switch (id) {
    case "whatsapp":
      return <WhatsAppLogo className={className} />;
    case "telegram":
      return <TelegramLogo className={className} />;
    case "messenger":
      return <MessengerLogo className={className} />;
    case "wechat":
      return <WeChatLogo className={className} />;
  }
}

/* ─── Telegram Config Panel ───────────────────────── */

function TelegramConfigPanel({ onBack, onSaved }: { onBack: () => void; onSaved?: () => void }) {
  const [botToken, setBotToken] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const save = async () => {
    if (!botToken.trim()) {
      setError("Ingresa el token del bot");
      return;
    }
    setStatus("saving");
    setError("");
    try {
      const res = await apiFetch("/api/integrations/telegram/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: botToken.trim(), webhookUrl: webhookUrl.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("saved");
      onSaved?.();
    } catch (e: any) {
      setError(e?.message || "Error al guardar");
      setStatus("error");
    }
  };

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a canales
      </button>

      <div className="flex items-center gap-3">
        <TelegramLogo className="h-10 w-10" />
        <div>
          <h3 className="font-semibold text-lg">Telegram</h3>
          <p className="text-xs text-muted-foreground">Configura tu bot de Telegram</p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium block mb-1">Bot Token</label>
          <input
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="123456789:ABCdefGHIjklMNOpqrSTUVwxyz"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm font-mono"
            type="password"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Obtén tu token en{" "}
            <a href="https://t.me/BotFather" target="_blank" rel="noopener" className="text-blue-500 hover:underline">
              @BotFather
            </a>
          </p>
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Webhook URL (opcional)</label>
          <input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://tudominio.com/webhooks/telegram"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Si no lo configuras, se usará la URL del servidor automáticamente
          </p>
        </div>

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-md p-2">
            {error}
          </div>
        )}

        {status === "saved" && (
          <div className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 rounded-md p-2">
            ✓ Configuración guardada. Tu bot está activo.
          </div>
        )}

        <Button onClick={save} disabled={status === "saving"} className="w-full bg-blue-500 hover:bg-blue-600 text-white">
          {status === "saving" ? "Guardando..." : "Conectar Bot"}
        </Button>
      </div>
    </div>
  );
}

/* ─── Messenger Config Panel ──────────────────────── */

function MessengerConfigPanel({ onBack, onSaved }: { onBack: () => void; onSaved?: () => void }) {
  const [pageId, setPageId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const connectFacebook = () => {
    // In production, this would redirect to Facebook OAuth
    window.open(
      "https://developers.facebook.com/apps/",
      "_blank",
      "noopener,noreferrer"
    );
  };

  const save = async () => {
    if (!pageId.trim() || !accessToken.trim()) {
      setError("Completa todos los campos");
      return;
    }
    setStatus("saving");
    setError("");
    try {
      const res = await apiFetch("/api/integrations/messenger/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: pageId.trim(), accessToken: accessToken.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("saved");
      onSaved?.();
    } catch (e: any) {
      setError(e?.message || "Error al guardar");
      setStatus("error");
    }
  };

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a canales
      </button>

      <div className="flex items-center gap-3">
        <MessengerLogo className="h-10 w-10" />
        <div>
          <h3 className="font-semibold text-lg">Messenger</h3>
          <p className="text-xs text-muted-foreground">Conecta tu página de Facebook</p>
        </div>
      </div>

      <div className="space-y-3">
        <Button
          variant="outline"
          onClick={connectFacebook}
          className="w-full gap-2"
        >
          <ExternalLink className="h-4 w-4" />
          Abrir Facebook Developers
        </Button>

        <div>
          <label className="text-sm font-medium block mb-1">Page ID</label>
          <input
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            placeholder="123456789012345"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Page Access Token</label>
          <input
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="EAAx..."
            className="h-9 w-full rounded-md border bg-background px-3 text-sm font-mono"
            type="password"
          />
        </div>

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-md p-2">
            {error}
          </div>
        )}

        {status === "saved" && (
          <div className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 rounded-md p-2">
            ✓ Messenger conectado exitosamente.
          </div>
        )}

        <Button onClick={save} disabled={status === "saving"} className="w-full bg-purple-600 hover:bg-purple-700 text-white">
          {status === "saving" ? "Guardando..." : "Conectar Messenger"}
        </Button>
      </div>
    </div>
  );
}

/* ─── WeChat Config Panel ─────────────────────────── */

function WeChatConfigPanel({ onBack, onSaved }: { onBack: () => void; onSaved?: () => void }) {
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const save = async () => {
    if (!appId.trim() || !appSecret.trim()) {
      setError("Completa todos los campos");
      return;
    }
    setStatus("saving");
    setError("");
    try {
      const res = await apiFetch("/api/integrations/wechat/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: appId.trim(), appSecret: appSecret.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("saved");
      onSaved?.();
    } catch (e: any) {
      setError(e?.message || "Error al guardar");
      setStatus("error");
    }
  };

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a canales
      </button>

      <div className="flex items-center gap-3">
        <WeChatLogo className="h-10 w-10" />
        <div>
          <h3 className="font-semibold text-lg">WeChat</h3>
          <p className="text-xs text-muted-foreground">Conecta tu cuenta oficial de WeChat</p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium block mb-1">App ID</label>
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="wx1234567890abcdef"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Desde tu{" "}
            <a href="https://mp.weixin.qq.com/" target="_blank" rel="noopener" className="text-emerald-600 hover:underline">
              WeChat Official Account
            </a>
          </p>
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">App Secret</label>
          <input
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder="••••••••••••••••"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm font-mono"
            type="password"
          />
        </div>

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-md p-2">
            {error}
          </div>
        )}

        {status === "saved" && (
          <div className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 rounded-md p-2">
            ✓ WeChat conectado exitosamente.
          </div>
        )}

        <Button onClick={save} disabled={status === "saving"} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
          {status === "saving" ? "Guardando..." : "Conectar WeChat"}
        </Button>
      </div>
    </div>
  );
}

/* ─── Main Hub Dialog ─────────────────────────────── */

export function ChannelsHubDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  type AiSettingsMode = "none" | "on" | "off" | "mixed";

  const [activeChannel, setActiveChannel] = useState<ChannelId | null>(null);
  const [showWhatsAppDialog, setShowWhatsAppDialog] = useState(false);
  const { status: waStatus } = useWhatsAppWebStatus(open);
  const tgStatus = useChannelStatus("telegram", open);
  const msgStatus = useChannelStatus("messenger", open);
  const wcStatus = useChannelStatus("wechat", open);

  const [autoResponderEnabled, setAutoResponderEnabled] = useState(false);
  const [autoResponderMode, setAutoResponderMode] = useState<AiSettingsMode>("none");
  const [autoResponderTargets, setAutoResponderTargets] = useState(0);
  const [responseInstructions, setResponseInstructions] = useState("");
  const [responseInstructionsMixed, setResponseInstructionsMixed] = useState(false);
  const [autoResponderToContacts, setAutoResponderToContacts] = useState(false);
  const [autoResponderToContactsMixed, setAutoResponderToContactsMixed] = useState(false);
  const [aiSettingsBusy, setAiSettingsBusy] = useState(false);
  const [aiSettingsError, setAiSettingsError] = useState<string | null>(null);
  const [aiSettingsSaved, setAiSettingsSaved] = useState(false);
  const [confirmEnableAutoResponderOpen, setConfirmEnableAutoResponderOpen] = useState(false);

  const loadAiSettings = useCallback(async () => {
    if (!open) return;
    setAiSettingsError(null);

    const headers = { "Content-Type": "application/json" };

    try {
      const [waStatusRes, waSettingsRes, tgStatusRes, tgSettingsRes, msgStatusRes, wcStatusRes] = await Promise.all([
        apiFetch("/api/integrations/whatsapp/web/status", { headers }),
        apiFetch("/api/integrations/whatsapp/web/settings", { headers }),
        apiFetch("/api/integrations/telegram/status", { headers }),
        apiFetch("/api/integrations/telegram/settings", { headers }),
        apiFetch("/api/integrations/messenger/status", { headers }),
        apiFetch("/api/integrations/wechat/status", { headers }),
      ]);

      const normalizePrompt = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

      type Unit = {
        id: string;
        label: string;
        configured: boolean;
        enabled: boolean;
        prompt: string;
        autoReplyToContacts: boolean;
      };
      const units: Unit[] = [];

      // WhatsApp Web
      let waEnabled = false;
      let waPrompt = "";
      let waConfigured = false;
      let waAutoReplyToContacts = false;
      if (waStatusRes.ok) {
        const waJson = await waStatusRes.json().catch(() => null);
        waEnabled = typeof waJson?.autoReply === "boolean" ? waJson.autoReply : false;
        const state = waJson?.status?.state;
        if (typeof state === "string") {
          waConfigured = state !== "disconnected";
        }
      }
      if (waSettingsRes.ok) {
        const waSettingsJson = await waSettingsRes.json().catch(() => null);
        waPrompt = normalizePrompt(waSettingsJson?.settings?.customPrompt);
        waAutoReplyToContacts = !!waSettingsJson?.settings?.autoReplyToContacts;
      }
      // Even when disconnected, treat WhatsApp as "configured" if the user already enabled auto-reply or set a custom prompt.
      waConfigured = waConfigured || waEnabled || Boolean(waPrompt);
      units.push({ id: "whatsapp", label: "WhatsApp", configured: waConfigured, enabled: waEnabled, prompt: waPrompt, autoReplyToContacts: waAutoReplyToContacts });

      // Telegram (requires auth)
      const tgStatusJson = tgStatusRes.ok ? await tgStatusRes.json().catch(() => null) : null;
      const tgAccounts: any[] = Array.isArray(tgStatusJson?.accounts) ? tgStatusJson.accounts : [];
      const tgConfigured = tgAccounts.length > 0;
      let tgEnabled = false;
      let tgPrompt = "";
      if (tgSettingsRes.ok) {
        const tgJson = await tgSettingsRes.json().catch(() => null);
        const s = tgJson?.settings;
        tgEnabled = typeof s?.responder_enabled === "boolean" ? s.responder_enabled : false;
        tgPrompt = normalizePrompt(s?.custom_prompt);
      }
      units.push({ id: "telegram", label: "Telegram", configured: tgConfigured, enabled: tgEnabled, prompt: tgPrompt, autoReplyToContacts: false });

      // Messenger (can have multiple pages)
      const msgJson = msgStatusRes.ok ? await msgStatusRes.json().catch(() => null) : null;
      const msgAccounts: any[] = Array.isArray(msgJson?.accounts) ? msgJson.accounts : [];
      const msgPageIds = Array.from(
        new Set(
          msgAccounts
            .map((a) => a?.metadata?.pageId)
            .filter((v) => typeof v === "string" && v)
        )
      );
      const msgSettings = await Promise.all(
        msgPageIds.map(async (pageId) => {
          const sRes = await apiFetch(`/api/integrations/messenger/settings?pageId=${encodeURIComponent(pageId)}`, { headers });
          if (!sRes.ok) return null;
          const sJson = await sRes.json().catch(() => null);
          const s = sJson?.settings;
          return {
            pageId,
            enabled: typeof s?.responder_enabled === "boolean" ? s.responder_enabled : false,
            prompt: normalizePrompt(s?.custom_prompt),
          };
        })
      );
      for (const s of msgSettings) {
        if (!s) continue;
        units.push({
          id: `messenger:${s.pageId}`,
          label: "Messenger",
          configured: true,
          enabled: s.enabled,
          prompt: s.prompt,
          autoReplyToContacts: false,
        });
      }

      // WeChat (can have multiple apps)
      const wcJson = wcStatusRes.ok ? await wcStatusRes.json().catch(() => null) : null;
      const wcAccounts: any[] = Array.isArray(wcJson?.accounts) ? wcJson.accounts : [];
      const wcAppIds = Array.from(
        new Set(
          wcAccounts
            .map((a) => a?.metadata?.appId)
            .filter((v) => typeof v === "string" && v)
        )
      );
      const wcSettings = await Promise.all(
        wcAppIds.map(async (appId) => {
          const sRes = await apiFetch(`/api/integrations/wechat/settings?appId=${encodeURIComponent(appId)}`, { headers });
          if (!sRes.ok) return null;
          const sJson = await sRes.json().catch(() => null);
          const s = sJson?.settings;
          return {
            appId,
            enabled: typeof s?.responder_enabled === "boolean" ? s.responder_enabled : false,
            prompt: normalizePrompt(s?.custom_prompt),
          };
        })
      );
      for (const s of wcSettings) {
        if (!s) continue;
        units.push({
          id: `wechat:${s.appId}`,
          label: "WeChat",
          configured: true,
          enabled: s.enabled,
          prompt: s.prompt,
          autoReplyToContacts: false,
        });
      }

      const configuredUnits = units.filter((u) => u.configured);
      const enabledValues = configuredUnits.map((u) => u.enabled);
      const anyEnabled = enabledValues.some(Boolean);
      const allEnabled = enabledValues.length > 0 && enabledValues.every(Boolean);
      const allDisabled = enabledValues.length > 0 && enabledValues.every((v) => !v);
      const mode: AiSettingsMode =
        configuredUnits.length === 0 ? "none" : allEnabled ? "on" : allDisabled ? "off" : "mixed";

      setAutoResponderTargets(configuredUnits.length);
      setAutoResponderMode(mode);
      setAutoResponderEnabled(anyEnabled);

      const contactsValues = configuredUnits.map((u) => u.autoReplyToContacts);
      const anyContacts = contactsValues.some(Boolean);
      const mixedContacts = new Set(contactsValues).size > 1;
      setAutoResponderToContacts(anyContacts);
      setAutoResponderToContactsMixed(mixedContacts);

      const prompts = configuredUnits.map((u) => u.prompt);
      const promptSet = new Set(prompts.map((p) => p.trim()));
      const mixedPrompts = promptSet.size > 1;
      setResponseInstructionsMixed(mixedPrompts);

      if (!mixedPrompts) {
        setResponseInstructions(prompts[0] ?? "");
      } else {
        // Show a representative prompt (prefer WhatsApp), but warn the user that it's mixed.
        const waPromptCandidate = units.find((u) => u.id === "whatsapp")?.prompt?.trim();
        setResponseInstructions(waPromptCandidate || prompts.find((p) => p.trim()) || "");
      }
    } catch (e: any) {
      setAiSettingsError(e?.message || "No se pudieron cargar los ajustes de IA");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setAiSettingsSaved(false);
    void loadAiSettings();
  }, [open, loadAiSettings]);

  const applySettings = useCallback(async (updates: { enabled?: boolean; autoReplyToContacts?: boolean }) => {
    setAiSettingsBusy(true);
    setAiSettingsError(null);
    setAiSettingsSaved(false);

    const headers = { "Content-Type": "application/json" };

    try {
      const waReq = apiFetch("/api/integrations/whatsapp/web/auto-reply", {
        method: "POST",
        headers,
        body: JSON.stringify(updates),
      });

      const tgPayload: any = {};
      if (typeof updates.enabled === "boolean") tgPayload.responder_enabled = updates.enabled;

      const tgReq = apiFetch("/api/integrations/telegram/settings", {
        method: "PUT",
        headers,
        body: JSON.stringify(tgPayload),
      });

      const [msgStatusRes, wcStatusRes] = await Promise.all([
        apiFetch("/api/integrations/messenger/status", { headers }),
        apiFetch("/api/integrations/wechat/status", { headers }),
      ]);

      const msgJson = msgStatusRes.ok ? await msgStatusRes.json().catch(() => null) : null;
      const wcJson = wcStatusRes.ok ? await wcStatusRes.json().catch(() => null) : null;

      const msgAccounts: any[] = Array.isArray(msgJson?.accounts) ? msgJson.accounts : [];
      const wcAccounts: any[] = Array.isArray(wcJson?.accounts) ? wcJson.accounts : [];

      const msgPageIds = Array.from(
        new Set(
          msgAccounts
            .map((a) => a?.metadata?.pageId)
            .filter((v) => typeof v === "string" && v)
        )
      );
      const wcAppIds = Array.from(
        new Set(
          wcAccounts
            .map((a) => a?.metadata?.appId)
            .filter((v) => typeof v === "string" && v)
        )
      );

      type Op = { label: string; required: boolean; promise: Promise<Response> };
      const ops: Op[] = [
        { label: "WhatsApp", required: true, promise: waReq },
        { label: "Telegram", required: false, promise: tgReq },
        ...msgPageIds.map((pageId) => ({
          label: "Messenger",
          required: false,
          promise: apiFetch("/api/integrations/messenger/settings", {
            method: "PUT",
            headers,
            body: JSON.stringify({ pageId, ...tgPayload }),
          }),
        })),
        ...wcAppIds.map((appId) => ({
          label: "WeChat",
          required: false,
          promise: apiFetch("/api/integrations/wechat/settings", {
            method: "PUT",
            headers,
            body: JSON.stringify({ appId, ...tgPayload }),
          }),
        })),
      ];

      const results = await Promise.allSettled(ops.map((o) => o.promise));
      let requiredFailed = false;
      const optionalFailures = new Set<string>();

      for (let i = 0; i < results.length; i++) {
        const op = ops[i];
        const r = results[i];
        if (r.status !== "fulfilled") {
          if (op.required) requiredFailed = true;
          else optionalFailures.add(op.label);
          continue;
        }

        const res = r.value;
        if (res.ok) continue;
        if (!op.required && (res.status === 404 || res.status === 401)) continue;
        if (op.required) requiredFailed = true;
        else optionalFailures.add(op.label);
      }

      if (requiredFailed) {
        setAiSettingsError("No se pudo aplicar en WhatsApp. Intenta de nuevo.");
      } else if (optionalFailures.size > 0) {
        const labels = Array.from(optionalFailures);
        setAiSettingsError(`Se aplicó en WhatsApp, pero no se pudo actualizar: ${labels.join(", ")}.`);
      } else {
        setAiSettingsSaved(true);
      }
    } finally {
      setAiSettingsBusy(false);
      void loadAiSettings();
      void tgStatus.refresh();
      void msgStatus.refresh();
      void wcStatus.refresh();
    }
  }, [loadAiSettings, tgStatus, msgStatus, wcStatus]);

  const applyResponseInstructions = useCallback(async () => {
    setAiSettingsBusy(true);
    setAiSettingsError(null);
    setAiSettingsSaved(false);

    const headers = { "Content-Type": "application/json" };
    const trimmed = responseInstructions.trim();
    const runtimePatch = trimmed
      ? { response_style: "custom", custom_prompt: trimmed }
      : { response_style: "default", custom_prompt: "" };

    try {
      const waReq = apiFetch("/api/integrations/whatsapp/web/settings", {
        method: "PUT",
        headers,
        body: JSON.stringify({ customPrompt: trimmed }),
      });

      const tgReq = apiFetch("/api/integrations/telegram/settings", {
        method: "PUT",
        headers,
        body: JSON.stringify(runtimePatch),
      });

      const [msgStatusRes, wcStatusRes] = await Promise.all([
        apiFetch("/api/integrations/messenger/status", { headers }),
        apiFetch("/api/integrations/wechat/status", { headers }),
      ]);

      const msgJson = msgStatusRes.ok ? await msgStatusRes.json().catch(() => null) : null;
      const wcJson = wcStatusRes.ok ? await wcStatusRes.json().catch(() => null) : null;

      const msgAccounts: any[] = Array.isArray(msgJson?.accounts) ? msgJson.accounts : [];
      const wcAccounts: any[] = Array.isArray(wcJson?.accounts) ? wcJson.accounts : [];

      const msgPageIds = Array.from(
        new Set(
          msgAccounts
            .map((a) => a?.metadata?.pageId)
            .filter((v) => typeof v === "string" && v)
        )
      );
      const wcAppIds = Array.from(
        new Set(
          wcAccounts
            .map((a) => a?.metadata?.appId)
            .filter((v) => typeof v === "string" && v)
        )
      );

      type Op = { label: string; required: boolean; promise: Promise<Response> };
      const ops: Op[] = [
        { label: "WhatsApp", required: true, promise: waReq },
        { label: "Telegram", required: false, promise: tgReq },
        ...msgPageIds.map((pageId) => ({
          label: "Messenger",
          required: false,
          promise: apiFetch("/api/integrations/messenger/settings", {
            method: "PUT",
            headers,
            body: JSON.stringify({ pageId, ...runtimePatch }),
          }),
        })),
        ...wcAppIds.map((appId) => ({
          label: "WeChat",
          required: false,
          promise: apiFetch("/api/integrations/wechat/settings", {
            method: "PUT",
            headers,
            body: JSON.stringify({ appId, ...runtimePatch }),
          }),
        })),
      ];

      const results = await Promise.allSettled(ops.map((o) => o.promise));
      let requiredFailed = false;
      const optionalFailures = new Set<string>();

      for (let i = 0; i < results.length; i++) {
        const op = ops[i];
        const r = results[i];
        if (r.status !== "fulfilled") {
          if (op.required) requiredFailed = true;
          else optionalFailures.add(op.label);
          continue;
        }

        const res = r.value;
        if (res.ok) continue;
        if (!op.required && (res.status === 404 || res.status === 401)) continue;
        if (op.required) requiredFailed = true;
        else optionalFailures.add(op.label);
      }

      if (requiredFailed) {
        setAiSettingsError("No se pudo guardar en WhatsApp. Intenta de nuevo.");
      } else if (optionalFailures.size > 0) {
        const labels = Array.from(optionalFailures);
        setAiSettingsError(`Se guardó en WhatsApp, pero no se pudo actualizar: ${labels.join(", ")}.`);
      } else {
        setAiSettingsSaved(true);
      }
    } finally {
      setAiSettingsBusy(false);
      void loadAiSettings();
    }
  }, [responseInstructions, loadAiSettings]);

  // Reset when dialog closes
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setActiveChannel(null);
      setShowWhatsAppDialog(false);
    }
    onOpenChange(isOpen);
  };

  const handleChannelClick = (channelId: ChannelId) => {
    if (channelId === "whatsapp") {
      setShowWhatsAppDialog(true);
    } else {
      setActiveChannel(channelId);
    }
  };

  const getChannelIntegrationStatus = (channelId: ChannelId): IntegrationStatus => {
    if (channelId === "telegram") return tgStatus.status;
    if (channelId === "messenger") return msgStatus.status;
    if (channelId === "wechat") return wcStatus.status;
    return "unknown";
  };

  const getStatusDot = (channelId: ChannelId) => {
    if (channelId === "whatsapp") {
      return (
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full shrink-0",
            waStatus.state === "connected" && "bg-green-500",
            (waStatus.state === "connecting" || waStatus.state === "qr" || waStatus.state === "pairing_code") && "bg-amber-500 animate-pulse",
            waStatus.state === "disconnected" && "bg-gray-300 dark:bg-gray-600"
          )}
        />
      );
    }
    const s = getChannelIntegrationStatus(channelId);
    return (
      <span
        className={cn(
          "h-2.5 w-2.5 rounded-full shrink-0",
          s === "active" && "bg-green-500",
          s === "inactive" && "bg-amber-500",
          s === "unknown" && "bg-gray-300 dark:bg-gray-600"
        )}
      />
    );
  };

  // WhatsApp opens its own dialog (reuses existing component)
  if (showWhatsAppDialog) {
    return (
      <Suspense fallback={null}>
        <WhatsAppConnectDialogInner
          open={open}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              setShowWhatsAppDialog(false);
              // Keep hub open
            } else {
              onOpenChange(isOpen);
            }
          }}
        />
      </Suspense>
    );
  }

  // Channel detail panels
  if (activeChannel === "telegram") {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <TelegramConfigPanel onBack={() => setActiveChannel(null)} onSaved={tgStatus.refresh} />
        </DialogContent>
      </Dialog>
    );
  }

  if (activeChannel === "messenger") {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <MessengerConfigPanel onBack={() => setActiveChannel(null)} onSaved={msgStatus.refresh} />
        </DialogContent>
      </Dialog>
    );
  }

  if (activeChannel === "wechat") {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <WeChatConfigPanel onBack={() => setActiveChannel(null)} onSaved={wcStatus.refresh} />
        </DialogContent>
      </Dialog>
    );
  }

  // Main hub: channel cards grid
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-primary" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
            </svg>
            AppsWebChat
          </DialogTitle>
          <DialogDescription>
            Conecta tus canales de mensajería para enviar y recibir mensajes con IA, todo en un solo lugar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 mt-1">
          {CHANNELS.map((ch) => (
            <button
              key={ch.id}
              onClick={() => handleChannelClick(ch.id)}
              className={cn(
                "relative rounded-xl border p-4 text-left transition-all duration-200",
                "hover:shadow-md hover:scale-[1.02] active:scale-[0.98]",
                ch.bgHover,
                ch.borderColor,
                "group cursor-pointer"
              )}
            >
              {/* Status dot */}
              <div className="absolute top-3 right-3">
                {getStatusDot(ch.id)}
              </div>

              {/* Logo */}
              <div className="mb-3">
                <ChannelLogo id={ch.id} className="h-12 w-12" />
              </div>

              {/* Name & description */}
              <div className={cn("font-semibold text-sm", ch.color)}>
                {ch.name}
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                {ch.description}
              </p>

              {/* Connect hint */}
              <div className="mt-3 text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                {ch.id === "whatsapp" && waStatus.state === "connected"
                  ? "Conectado"
                  : ch.id !== "whatsapp" && getChannelIntegrationStatus(ch.id) === "active"
                    ? "Conectado"
                    : "Configurar →"}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-3 rounded-xl border bg-muted/20 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">Respuestas automáticas (IA)</div>
                {autoResponderMode === "mixed" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    Mixto
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Con tu permiso, iliagpt puede responder automáticamente a tus contactos en los canales conectados.
                Para responder adecuadamente, usará el historial reciente de cada conversación.
              </p>
              <div className="text-[11px] text-muted-foreground mt-2">
                Se aplica a todos los canales conectados. En WhatsApp no se responde automáticamente a grupos.
              </div>
              {autoResponderTargets === 0 && (
                <div className="text-[11px] text-muted-foreground mt-2">
                  Conecta al menos un canal para que esta opción tenga efecto.
                </div>
              )}
              {autoResponderMode === "mixed" && (
                <div className="flex items-center gap-2 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmEnableAutoResponderOpen(true)}
                    disabled={aiSettingsBusy}
                  >
                    Activar en todos
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAutoResponderEnabled(false);
                      void applySettings({ enabled: false });
                    }}
                    disabled={aiSettingsBusy}
                  >
                    Desactivar en todos
                  </Button>
                </div>
              )}
            </div>
            <Switch
              checked={autoResponderEnabled}
              onCheckedChange={(checked) => {
                if (checked && !autoResponderEnabled) {
                  setConfirmEnableAutoResponderOpen(true);
                  return;
                }
                setAutoResponderEnabled(checked);
                void applySettings({ enabled: checked });
              }}
              disabled={aiSettingsBusy}
            />
          </div>

          <div className="flex items-start justify-between gap-3 mt-4 pt-4 border-t border-border/50">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">Responder a mis contactos</div>
                {autoResponderToContactsMixed && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    Mixto
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Si está desactivado, iliagpt solo te responderá a ti mismo (Modo Espejo). Actívalo para que responda a cualquier persona que te escriba.
              </p>
            </div>
            <Switch
              checked={autoResponderToContacts}
              onCheckedChange={(checked) => {
                setAutoResponderToContacts(checked);
                void applySettings({ autoReplyToContacts: checked });
              }}
              disabled={aiSettingsBusy || !autoResponderEnabled}
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="text-xs font-medium">¿Cómo quieres que responda? (opcional)</div>
              {responseInstructionsMixed && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  Mixto
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={responseInstructions}
                onChange={(e) => setResponseInstructions(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void applyResponseInstructions();
                  }
                }}
                placeholder='Ej: "Responde breve, amable y pide confirmación antes de agendar."'
                className="text-sm"
                disabled={aiSettingsBusy}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void applyResponseInstructions()}
                disabled={aiSettingsBusy}
              >
                Guardar
              </Button>
            </div>
            {responseInstructionsMixed && (
              <div className="text-[11px] text-muted-foreground">
                Hay instrucciones diferentes entre canales. Guardar sobrescribirá todas.
              </div>
            )}
            <div className="text-[11px] text-muted-foreground">
              Tip: escribe el tono, el formato y reglas (por ejemplo: "si no estás seguro, pregunta").
            </div>
          </div>

          {aiSettingsError && (
            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-md p-2">
              {aiSettingsError}
            </div>
          )}

          {aiSettingsSaved && !aiSettingsError && (
            <div className="text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/20 rounded-md p-2">
              ✓ Ajustes guardados
            </div>
          )}
        </div>

        <AlertDialog open={confirmEnableAutoResponderOpen} onOpenChange={setConfirmEnableAutoResponderOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Permitir respuestas automáticas?</AlertDialogTitle>
              <AlertDialogDescription>
                Si lo activas, iliagpt podrá responder a tus contactos en los canales conectados.
                Para responder con contexto, usará el historial reciente de cada conversación.
                Puedes desactivarlo en cualquier momento.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={aiSettingsBusy}>No permitir</AlertDialogCancel>
              <AlertDialogAction
                disabled={aiSettingsBusy}
                onClick={() => {
                  setAutoResponderEnabled(true);
                  setConfirmEnableAutoResponderOpen(false);
                  void applySettings({ enabled: true });
                }}
              >
                Permitir y activar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="text-xs text-muted-foreground text-center mt-2">
          Los mensajes entrantes se procesan con IA y aparecen en tu bandeja, incluso si desactivas las respuestas automáticas.
        </div>
      </DialogContent>
    </Dialog>
  );
}
