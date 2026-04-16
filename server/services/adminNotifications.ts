/**
 * Admin Notifications Service
 * Internal notification system for admin events
 */

import { EventEmitter } from "events";

export interface AdminNotification {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  action?: {
    label: string;
    url: string;
  };
  read: boolean;
  createdAt: Date;
  expiresAt?: Date;
}

class AdminNotificationsService extends EventEmitter {
  private notifications: AdminNotification[] = [];
  private readonly MAX_NOTIFICATIONS = 100;

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * Create a new notification
   */
  create(
    type: AdminNotification["type"],
    title: string,
    message: string,
    options?: {
      action?: { label: string; url: string };
      expiresInMs?: number;
    }
  ): AdminNotification {
    const notification: AdminNotification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      type,
      title,
      message,
      action: options?.action,
      read: false,
      createdAt: new Date(),
      expiresAt: options?.expiresInMs 
        ? new Date(Date.now() + options.expiresInMs) 
        : undefined
    };

    this.notifications.unshift(notification);
    
    // Trim old notifications
    if (this.notifications.length > this.MAX_NOTIFICATIONS) {
      this.notifications = this.notifications.slice(0, this.MAX_NOTIFICATIONS);
    }

    this.emit("notification", notification);
    return notification;
  }

  /**
   * Get all notifications
   */
  getAll(includeRead = true): AdminNotification[] {
    const now = new Date();
    // Filter out expired notifications
    const active = this.notifications.filter(n => 
      !n.expiresAt || new Date(n.expiresAt) > now
    );
    
    if (includeRead) {
      return active;
    }
    return active.filter(n => !n.read);
  }

  /**
   * Get unread count
   */
  getUnreadCount(): number {
    return this.getAll(false).length;
  }

  /**
   * Mark notification as read
   */
  markAsRead(id: string): boolean {
    const notification = this.notifications.find(n => n.id === id);
    if (notification) {
      notification.read = true;
      return true;
    }
    return false;
  }

  /**
   * Mark all as read
   */
  markAllAsRead(): number {
    let count = 0;
    this.notifications.forEach(n => {
      if (!n.read) {
        n.read = true;
        count++;
      }
    });
    return count;
  }

  /**
   * Delete a notification
   */
  delete(id: string): boolean {
    const index = this.notifications.findIndex(n => n.id === id);
    if (index !== -1) {
      this.notifications.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Clear all notifications
   */
  clearAll(): number {
    const count = this.notifications.length;
    this.notifications = [];
    return count;
  }

  // Convenience methods for creating specific notification types
  
  info(title: string, message: string, action?: { label: string; url: string }) {
    return this.create("info", title, message, { action });
  }

  success(title: string, message: string, action?: { label: string; url: string }) {
    return this.create("success", title, message, { action });
  }

  warning(title: string, message: string, action?: { label: string; url: string }) {
    return this.create("warning", title, message, { action });
  }

  error(title: string, message: string, action?: { label: string; url: string }) {
    return this.create("error", title, message, { action });
  }

  // System event notifications

  notifyNewUser(email: string) {
    this.info(
      "Nuevo usuario registrado",
      `${email} se ha registrado en la plataforma`,
      { label: "Ver usuarios", url: "/admin/users" }
    );
  }

  notifyPaymentReceived(amount: number, currency: string) {
    this.success(
      "Pago recibido",
      `Se ha recibido un pago de ${amount} ${currency}`,
      { label: "Ver pagos", url: "/admin/payments" }
    );
  }

  notifySecurityAlert(message: string) {
    this.error(
      "Alerta de seguridad",
      message,
      { label: "Ver seguridad", url: "/admin/security" }
    );
  }

  notifySystemError(error: string) {
    this.error(
      "Error del sistema",
      error,
      { label: "Ver logs", url: "/admin/security" }
    );
  }
}

export const adminNotifications = new AdminNotificationsService();
