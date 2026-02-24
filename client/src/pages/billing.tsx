import { useLocation } from "wouter";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, CreditCard, Calendar, CheckCircle, Download, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { isAdminUser } from "@/lib/admin";

export default function BillingPage() {
  const [, setLocation] = useLocation();
  const { user, isLoading } = useAuth();
  const isAdmin = isAdminUser(user as any);

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      setLocation("/");
    }
  }, [isAdmin, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Cargando...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <ShieldAlert className="h-16 w-16 text-muted-foreground mx-auto" />
          <h1 className="text-xl font-semibold">Acceso restringido</h1>
          <p className="text-muted-foreground">Esta página solo está disponible para administradores.</p>
          <Button onClick={() => setLocation("/")}>Volver al inicio</Button>
        </div>
      </div>
    );
  }

  const invoices = [
    { date: "15 Dic 2024", amount: "€99.00", status: "Pagado" },
    { date: "15 Nov 2024", amount: "€99.00", status: "Pagado" },
    { date: "15 Oct 2024", amount: "€99.00", status: "Pagado" },
    { date: "15 Sep 2024", amount: "€99.00", status: "Pagado" },
    { date: "15 Ago 2024", amount: "€99.00", status: "Pagado" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back-billing"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold">Facturación (Admin)</h1>
        </div>
      </div>
      
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="space-y-8">
          <div className="rounded-lg border p-6 space-y-4">
            <h2 className="font-medium">Plan actual</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-semibold">Enterprise</p>
                <p className="text-muted-foreground">€99/mes</p>
              </div>
              <Badge variant="secondary" className="text-sm">ACTIVO</Badge>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>Próxima factura: 15 Enero 2025</span>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" data-testid="button-change-plan">Cambiar plan</Button>
              <Button variant="outline" data-testid="button-cancel-subscription">Cancelar</Button>
            </div>
          </div>
          
          <div className="rounded-lg border p-6 space-y-4">
            <h2 className="font-medium flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Método de pago
            </h2>
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-4">
                <div className="h-10 w-16 rounded bg-background border flex items-center justify-center font-semibold text-sm">
                  VISA
                </div>
                <div>
                  <p className="font-medium">•••• •••• •••• 4242</p>
                  <p className="text-sm text-muted-foreground">Expira 12/26</p>
                </div>
              </div>
              <Button variant="outline" size="sm" data-testid="button-edit-payment">
                Editar
              </Button>
            </div>
            <Button variant="outline" className="w-full" data-testid="button-add-payment">
              Añadir método de pago
            </Button>
          </div>
          
          <Separator />
          
          <div className="space-y-4">
            <h2 className="font-medium flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Historial de facturas
            </h2>
            <div className="rounded-lg border divide-y">
              {invoices.map((invoice, i) => (
                <div key={i} className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4">
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    <div>
                      <p className="font-medium">{invoice.amount}</p>
                      <p className="text-sm text-muted-foreground">{invoice.date}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" data-testid={`button-download-invoice-${i}`}>
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
