import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { whatsappWebEventStream, type WhatsAppWebStatus } from '@/lib/whatsapp-web-events';

export function useWhatsAppWebStatus(enabled: boolean) {
  const [status, setStatus] = useState<WhatsAppWebStatus>({ state: 'disconnected' });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/integrations/whatsapp/web/status`, {
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }
      setStatus(json.status as WhatsAppWebStatus);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Error');
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const unsub = whatsappWebEventStream.subscribe({
      onStatus: (s) => {
        setStatus(s);
        setError(null);
      },
      onError: (msg) => {
        setError(msg);
      },
    });

    // Snapshot in case SSE is slow to connect or temporarily unavailable.
    void refresh();

    return unsub;
  }, [enabled, refresh]);

  return { status, error, refresh };
}
