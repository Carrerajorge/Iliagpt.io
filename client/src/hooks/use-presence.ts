import { useState, useEffect, useCallback, useRef } from "react";

interface PresenceUser {
  userId: string;
  username?: string;
  status: "online" | "away" | "offline";
  currentChatId?: string;
  isTyping: boolean;
}

interface PresenceUpdate {
  type: "join" | "leave" | "typing_start" | "typing_stop" | "chat_focus" | "status_change";
  userId: string;
  username?: string;
  chatId?: string;
  timestamp: number;
}

interface ChatPresence {
  viewers: PresenceUser[];
  typing: PresenceUser[];
}

const HEARTBEAT_INTERVAL_MS = 30_000;

export function usePresence() {
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch initial online users
  useEffect(() => {
    fetch("/api/presence/online", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : []))
      .then((users: PresenceUser[]) => setOnlineUsers(users))
      .catch(() => {});
  }, []);

  // Listen to WebSocket for presence updates
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/presence`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== "presence") return;

        const update: PresenceUpdate = msg.data;

        setOnlineUsers((prev) => {
          switch (update.type) {
            case "join": {
              // Add or update user
              const existing = prev.findIndex((u) => u.userId === update.userId);
              const user: PresenceUser = {
                userId: update.userId,
                username: update.username,
                status: "online",
                isTyping: false,
              };
              if (existing >= 0) {
                const next = [...prev];
                next[existing] = { ...next[existing], ...user };
                return next;
              }
              return [...prev, user];
            }
            case "leave": {
              return prev.filter((u) => u.userId !== update.userId);
            }
            case "typing_start": {
              return prev.map((u) =>
                u.userId === update.userId
                  ? { ...u, isTyping: true, currentChatId: update.chatId }
                  : u
              );
            }
            case "typing_stop": {
              return prev.map((u) =>
                u.userId === update.userId ? { ...u, isTyping: false } : u
              );
            }
            case "chat_focus": {
              return prev.map((u) =>
                u.userId === update.userId
                  ? { ...u, currentChatId: update.chatId }
                  : u
              );
            }
            case "status_change": {
              return prev.map((u) =>
                u.userId === update.userId
                  ? { ...u, status: "online" as const }
                  : u
              );
            }
            default:
              return prev;
          }
        });
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  // Heartbeat interval
  useEffect(() => {
    const sendHeartbeat = () => {
      fetch("/api/presence/heartbeat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      }).catch(() => {});
    };

    // Send initial heartbeat
    sendHeartbeat();

    heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, []);

  const sendTyping = useCallback((chatId: string, isTyping: boolean) => {
    fetch("/api/presence/typing", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, isTyping }),
    }).catch(() => {});
  }, []);

  const sendFocus = useCallback((chatId: string) => {
    fetch("/api/presence/focus", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
    }).catch(() => {});
  }, []);

  const getChatPresence = useCallback(
    async (chatId: string): Promise<ChatPresence> => {
      try {
        const res = await fetch(`/api/presence/chat/${chatId}`, {
          credentials: "include",
        });
        if (res.ok) return res.json();
      } catch {
        // Ignore
      }
      return { viewers: [], typing: [] };
    },
    []
  );

  return { onlineUsers, sendTyping, sendFocus, getChatPresence };
}
