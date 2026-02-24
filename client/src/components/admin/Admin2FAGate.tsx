import { useMemo, useState } from "react";
import { Shield, KeyRound, Copy, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { apiFetch } from "@/lib/apiClient";

type SetupResponse = {
  secret: string;
  qrCodeUrl: string;
  qrCodeImage: string;
  backupCodes: string[];
  message?: string;
};

export function Admin2FAGate({
  mode,
  onVerified,
}: {
  mode: "setup_required" | "verify_required";
  onVerified: () => void;
}) {
  const [code, setCode] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [backupCopied, setBackupCopied] = useState(false);

  const title = useMemo(() => {
    if (mode === "setup_required") return "2FA Required for Admin Access";
    return "Verify 2FA to Continue";
  }, [mode]);

  const description = useMemo(() => {
    if (mode === "setup_required") {
      return "This workspace requires two-factor authentication for administrators. Set up 2FA to access the admin panel.";
    }
    return "Enter your 6-digit authenticator code to unlock this admin session.";
  }, [mode]);

  const setup2fa = async () => {
    setIsBusy(true);
    try {
      const res = await apiFetch("/api/2fa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        throw new Error(payload?.error || payload?.message || "Failed to start 2FA setup");
      }
      setSetup(payload as SetupResponse);
      toast.success("2FA setup initialized");
    } catch (e: any) {
      toast.error(e?.message || "Failed to start 2FA setup");
    } finally {
      setIsBusy(false);
    }
  };

  const verifySetup = async () => {
    const trimmed = code.trim();
    if (trimmed.length !== 6) {
      toast.error("Enter a 6-digit code");
      return;
    }
    setIsBusy(true);
    try {
      const res = await apiFetch("/api/2fa/verify-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || payload?.message || "Invalid code");
      }
      toast.success("2FA enabled");
      onVerified();
    } catch (e: any) {
      toast.error(e?.message || "Verification failed");
    } finally {
      setIsBusy(false);
    }
  };

  const verifySession = async () => {
    const trimmed = code.trim();
    if (trimmed.length !== 6) {
      toast.error("Enter a 6-digit code");
      return;
    }
    setIsBusy(true);
    try {
      const res = await apiFetch("/api/2fa/verify-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || payload?.message || "Invalid code");
      }
      toast.success("Session verified");
      onVerified();
    } catch (e: any) {
      toast.error(e?.message || "Verification failed");
    } finally {
      setIsBusy(false);
    }
  };

  const copyBackupCodes = async () => {
    if (!setup?.backupCodes?.length) return;
    try {
      await navigator.clipboard.writeText(setup.backupCodes.join("\n"));
      setBackupCopied(true);
      setTimeout(() => setBackupCopied(false), 1500);
      toast.success("Backup codes copied");
    } catch {
      toast.error("Failed to copy backup codes");
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === "setup_required" ? (
            <>
              {!setup ? (
                <Button onClick={setup2fa} disabled={isBusy} className="w-full">
                  <KeyRound className="h-4 w-4 mr-2" />
                  Start 2FA Setup
                </Button>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg border p-3">
                    <div className="text-sm font-medium">Scan QR Code</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Use Google Authenticator, Authy, or any TOTP-compatible app.
                    </div>
                    <div className="mt-3 flex justify-center">
                      {/* QR is returned as a hosted image URL */}
                      <img
                        src={setup.qrCodeImage}
                        alt="2FA QR code"
                        className="h-44 w-44 rounded bg-white p-2"
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">Backup Codes</div>
                        <div className="text-xs text-muted-foreground">Store these securely.</div>
                      </div>
                      <Button variant="outline" size="sm" onClick={copyBackupCodes} disabled={isBusy}>
                        {backupCopied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                    <pre className="text-xs bg-muted/40 rounded p-2 overflow-auto max-h-40">
                      {(setup.backupCodes || []).join("\n")}
                    </pre>
                  </div>

                  <Separator />
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Verify Code</div>
                    <Input
                      inputMode="numeric"
                      placeholder="123456"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\\s+/g, ""))}
                      maxLength={6}
                    />
                    <Button onClick={verifySetup} disabled={isBusy} className="w-full">
                      Verify and Enable
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <div className="text-sm font-medium">Authenticator Code</div>
              <Input
                inputMode="numeric"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\\s+/g, ""))}
                maxLength={6}
              />
              <Button onClick={verifySession} disabled={isBusy} className="w-full">
                Verify Session
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
