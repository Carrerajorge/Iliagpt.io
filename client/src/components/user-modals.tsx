import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { 
  User, 
  Mail, 
  Phone, 
  Building,
  CreditCard,
  Calendar,
  CheckCircle,
  Bell,
  Moon,
  Globe,
  Shield,
  Eye,
  Download,
  Trash2,
  Users,
  BarChart3,
  Settings
} from "lucide-react";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProfileModal({ open, onOpenChange }: ModalProps) {
  const [name, setName] = useState("Admin");
  const [email, setEmail] = useState("admin@empresa.com");
  const [phone, setPhone] = useState("+34 600 000 000");
  const [company, setCompany] = useState("Mi Empresa");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-medium">Perfil</DialogTitle>
          <VisuallyHidden>
            <DialogDescription>Administra tu información de perfil</DialogDescription>
          </VisuallyHidden>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarFallback className="bg-primary/10 text-primary text-xl">A</AvatarFallback>
            </Avatar>
            <Button variant="outline" size="sm" data-testid="button-change-avatar">
              Cambiar foto
            </Button>
          </div>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm text-muted-foreground flex items-center gap-2">
                <User className="h-3.5 w-3.5" />
                Nombre
              </Label>
              <Input 
                id="name" 
                value={name} 
                onChange={(e) => setName(e.target.value)}
                className="h-9"
                data-testid="input-profile-name"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-muted-foreground flex items-center gap-2">
                <Mail className="h-3.5 w-3.5" />
                Email
              </Label>
              <Input 
                id="email" 
                type="email"
                value={email} 
                onChange={(e) => setEmail(e.target.value)}
                className="h-9"
                data-testid="input-profile-email"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="phone" className="text-sm text-muted-foreground flex items-center gap-2">
                <Phone className="h-3.5 w-3.5" />
                Teléfono
              </Label>
              <Input 
                id="phone" 
                value={phone} 
                onChange={(e) => setPhone(e.target.value)}
                className="h-9"
                data-testid="input-profile-phone"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="company" className="text-sm text-muted-foreground flex items-center gap-2">
                <Building className="h-3.5 w-3.5" />
                Empresa
              </Label>
              <Input 
                id="company" 
                value={company} 
                onChange={(e) => setCompany(e.target.value)}
                className="h-9"
                data-testid="input-profile-company"
              />
            </div>
          </div>
          
          <Button className="w-full" data-testid="button-save-profile">
            Guardar cambios
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BillingModal({ open, onOpenChange }: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-medium">Facturación</DialogTitle>
          <VisuallyHidden>
            <DialogDescription>Información de facturación y métodos de pago</DialogDescription>
          </VisuallyHidden>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Plan actual</span>
              <Badge variant="secondary">ENTERPRISE</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Precio</span>
              <span className="font-medium">€99/mes</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Próxima factura</span>
              <span className="text-sm">15 Ene 2025</span>
            </div>
          </div>
          
          <Separator />
          
          <div className="space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Método de pago
            </h4>
            <div className="rounded-lg border p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-12 rounded bg-muted flex items-center justify-center text-xs font-medium">
                  VISA
                </div>
                <span className="text-sm">•••• 4242</span>
              </div>
              <Button variant="ghost" size="sm" data-testid="button-edit-payment">
                Editar
              </Button>
            </div>
          </div>
          
          <Separator />
          
          <div className="space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Historial
            </h4>
            <div className="space-y-2">
              {[
                { date: "15 Dic 2024", amount: "€99.00", status: "Pagado" },
                { date: "15 Nov 2024", amount: "€99.00", status: "Pagado" },
                { date: "15 Oct 2024", amount: "€99.00", status: "Pagado" },
              ].map((invoice, i) => (
                <div key={i} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-muted-foreground">{invoice.date}</span>
                  <div className="flex items-center gap-3">
                    <span>{invoice.amount}</span>
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsModal({ open, onOpenChange }: ModalProps) {
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [language, setLanguage] = useState("es");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-medium">Configuración</DialogTitle>
          <VisuallyHidden>
            <DialogDescription>Opciones de configuración de la aplicación</DialogDescription>
          </VisuallyHidden>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Notificaciones</p>
                <p className="text-xs text-muted-foreground">Recibir alertas</p>
              </div>
            </div>
            <Switch 
              checked={notifications} 
              onCheckedChange={setNotifications}
              data-testid="switch-notifications"
            />
          </div>
          
          <Separator />
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Moon className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Modo oscuro</p>
                <p className="text-xs text-muted-foreground">Tema de la interfaz</p>
              </div>
            </div>
            <Switch 
              checked={darkMode} 
              onCheckedChange={setDarkMode}
              data-testid="switch-dark-mode"
            />
          </div>
          
          <Separator />
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Idioma</p>
                <p className="text-xs text-muted-foreground">Español</p>
              </div>
            </div>
            <Button variant="outline" size="sm" data-testid="button-change-language">
              Cambiar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PrivacyModal({ open, onOpenChange }: ModalProps) {
  const [shareData, setShareData] = useState(false);
  const [saveHistory, setSaveHistory] = useState(true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-medium">Privacidad</DialogTitle>
          <VisuallyHidden>
            <DialogDescription>Opciones de privacidad y datos personales</DialogDescription>
          </VisuallyHidden>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Compartir datos</p>
                <p className="text-xs text-muted-foreground">Mejoras del servicio</p>
              </div>
            </div>
            <Switch 
              checked={shareData} 
              onCheckedChange={setShareData}
              data-testid="switch-share-data"
            />
          </div>
          
          <Separator />
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Guardar historial</p>
                <p className="text-xs text-muted-foreground">Conservar conversaciones</p>
              </div>
            </div>
            <Switch 
              checked={saveHistory} 
              onCheckedChange={setSaveHistory}
              data-testid="switch-save-history"
            />
          </div>
          
          <Separator />
          
          <div className="space-y-3">
            <Button variant="outline" className="w-full justify-start gap-2" data-testid="button-download-data">
              <Download className="h-4 w-4" />
              Descargar mis datos
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2 text-red-500 hover:text-red-600 hover:bg-red-50" data-testid="button-delete-account">
              <Trash2 className="h-4 w-4" />
              Eliminar cuenta
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AdminPanelModal({ open, onOpenChange }: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-medium">Admin Panel</DialogTitle>
          <VisuallyHidden>
            <DialogDescription>Panel de administración del sistema</DialogDescription>
          </VisuallyHidden>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border p-4 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-4 w-4" />
                <span className="text-xs">Usuarios</span>
              </div>
              <p className="text-2xl font-semibold">24</p>
            </div>
            <div className="rounded-lg border p-4 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <BarChart3 className="h-4 w-4" />
                <span className="text-xs">Consultas/día</span>
              </div>
              <p className="text-2xl font-semibold">1,247</p>
            </div>
          </div>
          
          <Separator />
          
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Acciones rápidas</h4>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start gap-2" data-testid="button-manage-users">
                <Users className="h-4 w-4" />
                Gestionar usuarios
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" data-testid="button-view-analytics">
                <BarChart3 className="h-4 w-4" />
                Ver analíticas
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" data-testid="button-system-settings">
                <Settings className="h-4 w-4" />
                Configuración del sistema
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
