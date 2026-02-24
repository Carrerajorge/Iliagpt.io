import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { 
  Bell, 
  Check, 
  CheckCheck, 
  Info, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle,
  ExternalLink,
  Trash2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface AdminNotification {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  action?: {
    label: string;
    url: string;
  };
  read: boolean;
  createdAt: string;
}

const TYPE_CONFIG = {
  info: { icon: Info, color: "text-blue-500", bg: "bg-blue-500/10" },
  success: { icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/10" },
  warning: { icon: AlertTriangle, color: "text-yellow-500", bg: "bg-yellow-500/10" },
  error: { icon: XCircle, color: "text-red-500", bg: "bg-red-500/10" }
};

export function AdminNotificationsPopover() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery<{ notifications: AdminNotification[]; unreadCount: number }>({
    queryKey: ["/api/admin/dashboard/notifications"],
    queryFn: async () => {
      const res = await fetch("/api/admin/dashboard/notifications", { credentials: "include" });
      return res.json();
    },
    refetchInterval: 30000
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/admin/dashboard/notifications/${id}/read`, {
        method: "POST",
        credentials: "include"
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard/notifications"] });
    }
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/admin/dashboard/notifications/read-all", {
        method: "POST",
        credentials: "include"
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard/notifications"] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/admin/dashboard/notifications/${id}`, {
        method: "DELETE",
        credentials: "include"
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard/notifications"] });
    }
  });

  const notifications = data?.notifications || [];
  const unreadCount = data?.unreadCount || 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-[10px]"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h4 className="font-semibold text-sm">Notificaciones</h4>
          {unreadCount > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-7 text-xs"
              onClick={() => markAllAsReadMutation.mutate()}
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              Marcar todas
            </Button>
          )}
        </div>
        <ScrollArea className="h-[300px]">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No hay notificaciones</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notif) => {
                const config = TYPE_CONFIG[notif.type];
                const Icon = config.icon;
                
                return (
                  <div 
                    key={notif.id} 
                    className={cn(
                      "px-4 py-3 hover:bg-muted/50 transition-colors",
                      !notif.read && "bg-muted/30"
                    )}
                  >
                    <div className="flex gap-3">
                      <div className={cn("p-1.5 rounded-md", config.bg)}>
                        <Icon className={cn("h-4 w-4", config.color)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium">{notif.title}</p>
                          <div className="flex items-center gap-1">
                            {!notif.read && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => markAsReadMutation.mutate(notif.id)}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() => deleteMutation.mutate(notif.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {notif.message}
                        </p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-[10px] text-muted-foreground">
                            {formatDistanceToNow(new Date(notif.createdAt), { 
                              addSuffix: true, 
                              locale: es 
                            })}
                          </span>
                          {notif.action && (
                            <a 
                              href={notif.action.url}
                              className="text-xs text-primary hover:underline flex items-center gap-1"
                              onClick={() => setOpen(false)}
                            >
                              {notif.action.label}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
