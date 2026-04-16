import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Copy, Check, Link, X, UserPlus, Loader2, Globe, Lock,
  Clock, QrCode, Share2, MessageCircle, Twitter, Linkedin,
  Mail, Trash2, Eye, Edit3, Download, Users
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import shareIconSrc from "@/assets/share-icon.png";
import { apiRequest } from "@/lib/queryClient";
import QRCode from 'qrcode';

// ============================================================================
// TYPES
// ============================================================================

interface Participant {
  email: string;
  role: "owner" | "editor" | "viewer";
  permissions?: SharePermissions;
}

interface SharePermissions {
  canExport: boolean;
  canInvite: boolean;
  canEdit: boolean;
  canComment: boolean;
}

interface ShareSettings {
  isPublic: boolean;
  expiresAt: string | null; // ISO date string
  password?: string;
  maxViews?: number;
  currentViews?: number;
}

interface ShareChatDialogProps {
  chatId: string;
  chatTitle: string;
  children?: React.ReactNode;
}

// ============================================================================
// EXPIRATION OPTIONS
// ============================================================================

const EXPIRATION_OPTIONS = [
  { value: "never", label: "Nunca expira" },
  { value: "1h", label: "1 hora" },
  { value: "24h", label: "24 horas" },
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
];

function getExpirationDate(option: string): string | null {
  const now = new Date();
  switch (option) {
    case "1h": return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    case "24h": return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    case "7d": return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    case "30d": return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    default: return null;
  }
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ShareChatDialog({ chatId, chatTitle, children }: ShareChatDialogProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("invite");

  // Invite state
  const [email, setEmail] = useState("");
  const [selectedRole, setSelectedRole] = useState<"editor" | "viewer">("viewer");
  const [participants, setParticipants] = useState<Participant[]>([]);

  // Link settings state
  const [shareSettings, setShareSettings] = useState<ShareSettings>({
    isPublic: false,
    expiresAt: null,
    maxViews: undefined
  });
  const [expiration, setExpiration] = useState("never");

  // UI state
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [showQR, setShowQR] = useState(false);

  const { toast } = useToast();
  const qrRef = useRef<HTMLCanvasElement>(null);

  const shareLink = `${window.location.origin}/chat/${chatId}`;

  // Generate QR code when link changes or QR modal opens
  useEffect(() => {
    if (showQR && shareLink) {
      QRCode.toDataURL(shareLink, {
        width: 256,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      }).then(setQrCodeUrl).catch(console.error);
    }
  }, [showQR, shareLink]);

  useEffect(() => {
    if (open && chatId) {
      loadExistingShares();
    }
  }, [open, chatId]);

  const loadExistingShares = async () => {
    try {
      const response = await fetch(`/api/chats/${chatId}/shares`, { credentials: 'include' });
      if (response.ok) {
        const shares = await response.json();
        setParticipants(shares.map((s: any) => ({ email: s.email, role: s.role })));
      }
    } catch (error) {
      console.error("Failed to load shares:", error);
    }
  };

  const handleSendInvitations = async () => {
    if (participants.length === 0) return;

    setSending(true);
    try {
      const response = await apiRequest("POST", `/api/chats/${chatId}/shares`, {
        participants,
        settings: shareSettings
      });

      if (response.ok) {
        toast({
          title: "Invitaciones enviadas",
          description: `Se enviaron notificaciones a ${participants.length} participante(s)`,
        });
        setOpen(false);
      } else {
        const error = await response.json();
        toast({
          title: "Error",
          description: error.error || "No se pudieron enviar las invitaciones",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudieron enviar las invitaciones",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const handleAddParticipant = () => {
    if (!email || !email.includes("@")) {
      toast({
        title: "Error",
        description: "Por favor ingresa un correo válido",
        variant: "destructive",
      });
      return;
    }

    if (participants.find(p => p.email === email)) {
      toast({
        title: "Error",
        description: "Este participante ya fue agregado",
        variant: "destructive",
      });
      return;
    }

    setParticipants([...participants, {
      email,
      role: selectedRole,
      permissions: {
        canExport: selectedRole === 'editor',
        canInvite: false,
        canEdit: selectedRole === 'editor',
        canComment: true
      }
    }]);
    setEmail("");
    toast({
      title: "Participante agregado",
      description: `${email} fue agregado como ${getRoleLabel(selectedRole)}`,
    });
  };

  const handleRemoveParticipant = (emailToRemove: string) => {
    setParticipants(participants.filter(p => p.email !== emailToRemove));
  };

  const handleChangeRole = (email: string, newRole: "owner" | "editor" | "viewer") => {
    setParticipants(participants.map(p =>
      p.email === email ? { ...p, role: newRole } : p
    ));
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    toast({
      title: "Link copiado",
      description: "El enlace para unirse ha sido copiado al portapapeles",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExpirationChange = (value: string) => {
    setExpiration(value);
    setShareSettings({
      ...shareSettings,
      expiresAt: getExpirationDate(value)
    });
  };

  const handlePublicToggle = (isPublic: boolean) => {
    setShareSettings({ ...shareSettings, isPublic });
    if (isPublic) {
      toast({
        title: "Enlace público activado",
        description: "Cualquier persona con el enlace puede ver este chat",
      });
    }
  };

  // Social sharing
  // FRONTEND FIX #26: Add noopener,noreferrer to prevent window.opener attacks
  const shareViaWhatsApp = () => {
    const text = encodeURIComponent(`¡Mira esta conversación! ${shareLink}`);
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
  };

  const shareViaTwitter = () => {
    const text = encodeURIComponent(`Mira esta conversación sobre "${chatTitle}"`);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(shareLink)}`, '_blank', 'noopener,noreferrer');
  };

  const shareViaLinkedIn = () => {
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareLink)}`, '_blank', 'noopener,noreferrer');
  };

  const shareViaEmail = () => {
    const subject = encodeURIComponent(`Conversación compartida: ${chatTitle}`);
    const body = encodeURIComponent(`Te invito a ver esta conversación:\n\n${shareLink}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case "owner": return "Dueño";
      case "editor": return "Editor";
      case "viewer": return "Visualizador";
      default: return role;
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "owner": return <Users className="h-3 w-3" />;
      case "editor": return <Edit3 className="h-3 w-3" />;
      case "viewer": return <Eye className="h-3 w-3" />;
      default: return null;
    }
  };

  const getInitials = (email: string) => {
    return email.split("@")[0].substring(0, 2).toUpperCase();
  };

  const downloadQR = () => {
    if (!qrCodeUrl) return;
    const link = document.createElement('a');
    link.download = `qr-${chatTitle || 'chat'}.png`;
    link.href = qrCodeUrl;
    link.click();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="ghost" size="icon" data-testid="button-share-chat">
            <img
              src={shareIconSrc}
              alt="Share"
              className="h-5 w-5 mix-blend-multiply dark:mix-blend-screen dark:invert"
            />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Compartir "{chatTitle || 'Chat'}"
          </DialogTitle>
          <VisuallyHidden>
            <DialogDescription>Comparte este chat con otros usuarios</DialogDescription>
          </VisuallyHidden>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="invite" className="text-xs">
              <UserPlus className="h-3.5 w-3.5 mr-1" />
              Invitar
            </TabsTrigger>
            <TabsTrigger value="link" className="text-xs">
              <Link className="h-3.5 w-3.5 mr-1" />
              Enlace
            </TabsTrigger>
            <TabsTrigger value="social" className="text-xs">
              <Share2 className="h-3.5 w-3.5 mr-1" />
              Redes
            </TabsTrigger>
          </TabsList>

          {/* TAB: Invite by Email */}
          <TabsContent value="invite" className="space-y-4 py-4">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Ingresa el correo electrónico"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddParticipant()}
                className="flex-1"
              />
              <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as "editor" | "viewer")}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">
                    <div className="flex items-center gap-2">
                      <Edit3 className="h-3 w-3" /> Editor
                    </div>
                  </SelectItem>
                  <SelectItem value="viewer">
                    <div className="flex items-center gap-2">
                      <Eye className="h-3 w-3" /> Visualizador
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleAddParticipant} size="icon">
                <UserPlus className="h-4 w-4" />
              </Button>
            </div>

            {participants.length > 0 && (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                <p className="text-sm font-medium text-muted-foreground">Participantes ({participants.length}):</p>
                {participants.map((participant) => (
                  <div
                    key={participant.email}
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                  >
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-xs bg-primary/20">
                          {getInitials(participant.email)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm truncate max-w-[140px]">{participant.email}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Select
                        value={participant.role}
                        onValueChange={(v) => handleChangeRole(participant.email, v as "owner" | "editor" | "viewer")}
                      >
                        <SelectTrigger className="w-[100px] h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="editor">Editor</SelectItem>
                          <SelectItem value="viewer">Visualizador</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveParticipant(participant.email)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Button
              className="w-full"
              onClick={handleSendInvitations}
              disabled={participants.length === 0 || sending}
            >
              {sending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  Enviar invitaciones
                </>
              )}
            </Button>
          </TabsContent>

          {/* TAB: Link Settings */}
          <TabsContent value="link" className="space-y-4 py-4">
            {/* Public Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-3">
                {shareSettings.isPublic ? (
                  <Globe className="h-5 w-5 text-green-500" />
                ) : (
                  <Lock className="h-5 w-5 text-muted-foreground" />
                )}
                <div>
                  <Label className="font-medium">Acceso público</Label>
                  <p className="text-xs text-muted-foreground">
                    {shareSettings.isPublic
                      ? "Cualquiera con el link puede ver"
                      : "Solo invitados pueden ver"}
                  </p>
                </div>
              </div>
              <Switch
                checked={shareSettings.isPublic}
                onCheckedChange={handlePublicToggle}
              />
            </div>

            {/* Expiration */}
            <div className="flex items-center gap-3 p-3 rounded-lg border">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <Label className="font-medium">Expiración del link</Label>
              </div>
              <Select value={expiration} onValueChange={handleExpirationChange}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRATION_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Link Display */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Link className="h-4 w-4" />
                Enlace para unirse
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  value={shareLink}
                  readOnly
                  className="flex-1 text-sm bg-muted font-mono"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopyLink}
                >
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowQR(!showQR)}
                >
                  <QrCode className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* QR Code */}
            {showQR && qrCodeUrl && (
              <div className="flex flex-col items-center gap-3 p-4 rounded-lg bg-white border">
                <img src={qrCodeUrl} alt="QR Code" className="w-48 h-48" />
                <Button variant="outline" size="sm" onClick={downloadQR}>
                  <Download className="h-4 w-4 mr-2" />
                  Descargar QR
                </Button>
              </div>
            )}
          </TabsContent>

          {/* TAB: Social Sharing */}
          <TabsContent value="social" className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground text-center">
              Comparte este chat en tus redes favoritas
            </p>

            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="h-14 flex-col gap-1"
                onClick={shareViaWhatsApp}
              >
                <MessageCircle className="h-5 w-5 text-green-500" />
                <span className="text-xs">WhatsApp</span>
              </Button>

              <Button
                variant="outline"
                className="h-14 flex-col gap-1"
                onClick={shareViaTwitter}
              >
                <Twitter className="h-5 w-5 text-blue-400" />
                <span className="text-xs">Twitter</span>
              </Button>

              <Button
                variant="outline"
                className="h-14 flex-col gap-1"
                onClick={shareViaLinkedIn}
              >
                <Linkedin className="h-5 w-5 text-blue-600" />
                <span className="text-xs">LinkedIn</span>
              </Button>

              <Button
                variant="outline"
                className="h-14 flex-col gap-1"
                onClick={shareViaEmail}
              >
                <Mail className="h-5 w-5 text-muted-foreground" />
                <span className="text-xs">Email</span>
              </Button>
            </div>

            <div className="pt-2 border-t">
              <Button
                variant="outline"
                className="w-full"
                onClick={handleCopyLink}
              >
                {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                Copiar enlace
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export function ShareIcon({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={shareIconSrc}
      alt="Share"
      width={size}
      height={size}
      className={`${className} mix-blend-multiply dark:mix-blend-screen dark:invert`}
      style={{ objectFit: "contain" }}
    />
  );
}
