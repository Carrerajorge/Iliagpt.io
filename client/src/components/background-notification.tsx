/**
 * Background Notification Component - ILIAGPT PRO 3.0
 * Toast notifications for background task completion
 */

import React, { useEffect, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, MessageSquare } from 'lucide-react';
import { useNotifications, useStreamingStore, BackgroundNotification } from '@/stores/streamingStore';
import { playSuccessSound, playErrorSound } from '@/lib/notification-sound';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { channelIncludesPush, isWithinQuietHours } from '@/lib/notification-preferences';

interface BackgroundNotificationToastProps {
    notification: BackgroundNotification;
    onDismiss: (id: string) => void;
    onNavigate: (chatId: string) => void;
}

function BackgroundNotificationToast({
    notification,
    onDismiss,
    onNavigate
}: BackgroundNotificationToastProps) {
    const isSuccess = notification.type === 'completed';

    // Auto-dismiss after 8 seconds
    useEffect(() => {
        const timer = setTimeout(() => {
            onDismiss(notification.id);
        }, 8000);
        return () => clearTimeout(timer);
    }, [notification.id, onDismiss]);

    const handleClick = useCallback(() => {
        onNavigate(notification.chatId);
        onDismiss(notification.id);
    }, [notification.chatId, notification.id, onNavigate, onDismiss]);

    return (
        <div
            className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl p-4 max-w-sm animate-in slide-in-from-right-5 fade-in duration-300 cursor-pointer hover:bg-zinc-800 transition-colors"
            onClick={handleClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleClick()}
        >
            <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 p-1.5 rounded-full ${isSuccess ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                    {isSuccess ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <MessageSquare className="w-3.5 h-3.5 text-zinc-400" />
                        <span className="text-sm font-medium text-zinc-200 truncate">
                            {notification.chatTitle}
                        </span>
                    </div>
                    <p className="text-xs text-zinc-400 line-clamp-2">
                        {isSuccess ? 'Tarea completada' : 'Error en la tarea'}
                    </p>
                    {notification.preview && (
                        <p className="text-xs text-zinc-500 mt-1 line-clamp-1 italic">
                            {notification.preview}
                        </p>
                    )}
                </div>

                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDismiss(notification.id);
                    }}
                    className="flex-shrink-0 p-1 rounded-md hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                    aria-label="Dismiss notification"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

interface BackgroundNotificationContainerProps {
    onNavigateToChat: (chatId: string) => void;
}

export function BackgroundNotificationContainer({ onNavigateToChat }: BackgroundNotificationContainerProps) {
  const notifications = useNotifications();
  const dismissNotification = useStreamingStore((s) => s.dismissNotification);
  const { settings } = useSettingsContext();

  const pushEnabled = channelIncludesPush(settings.notifResponses);
  const quietNow = isWithinQuietHours({
    enabled: settings.notifQuietHours,
    start: settings.notifQuietStart,
    end: settings.notifQuietEnd,
  });

  const allowInApp = settings.notifInApp && pushEnabled && !quietNow;
  const allowDesktop = settings.notifDesktop && pushEnabled && !quietNow;

  // Play sound when new notification arrives
  useEffect(() => {
    if (!settings.notifSound || !pushEnabled || quietNow) return;
    if (notifications.length > 0) {
      const latest = notifications[notifications.length - 1];
      if (Date.now() - latest.timestamp < 1000) {
        // Only play for new notifications (less than 1 second old)
        if (latest.type === 'completed') {
          playSuccessSound();
        } else {
          playErrorSound();
        }
      }
    }
  }, [notifications.length, pushEnabled, quietNow, settings.notifSound]);

  // Send desktop notifications (only when tab is hidden)
  useEffect(() => {
    if (!allowDesktop) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible') return;

    if (notifications.length > 0) {
      const latest = notifications[notifications.length - 1];
      if (Date.now() - latest.timestamp < 1500) {
        try {
          new Notification(latest.type === 'completed' ? 'Tarea completada' : 'Error en la tarea', {
            body: latest.chatTitle,
            icon: '/favicon.png',
            tag: `bg-${latest.type}`,
          });
        } catch {
          // ignore
        }
      }
    }
  }, [allowDesktop, notifications.length]);

    const handleNavigate = useCallback((chatId: string) => {
        // Dispatch event to select chat
        window.dispatchEvent(new CustomEvent('select-chat', {
            detail: { chatId, preserveKey: true }
        }));
        onNavigateToChat(chatId);
    }, [onNavigateToChat]);

  if (!allowInApp || notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-auto">
      {notifications.slice(-3).map((notif) => (
        <BackgroundNotificationToast
                    key={notif.id}
                    notification={notif}
                    onDismiss={dismissNotification}
                    onNavigate={handleNavigate}
                />
            ))}
        </div>
    );
}

export default BackgroundNotificationContainer;
