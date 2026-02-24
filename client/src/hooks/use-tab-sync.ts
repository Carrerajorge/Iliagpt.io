/**
 * Multi-Tab Synchronization Hook - ILIAGPT PRO 3.0
 * 
 * Uses BroadcastChannel API to sync streaming state and notifications
 * across multiple browser tabs.
 */

import { useEffect, useCallback, useRef } from "react";
import { useStreamingStore } from "@/stores/streamingStore";

const CHANNEL_NAME = "iliagpt-streaming-sync";

interface SyncMessage {
    type: "notification" | "run-complete" | "run-start" | "ping" | "pong";
    payload?: unknown;
    tabId: string;
    timestamp: number;
}

// Generate unique tab ID
const TAB_ID = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let channelInstance: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
    if (typeof window === "undefined") return null;
    if (!("BroadcastChannel" in window)) return null;

    if (!channelInstance) {
        try {
            channelInstance = new BroadcastChannel(CHANNEL_NAME);
        } catch {
            console.warn("[TabSync] BroadcastChannel not available");
            return null;
        }
    }
    return channelInstance;
}

/**
 * Hook to enable multi-tab synchronization of streaming state
 */
export function useTabSync() {
    const addNotification = useStreamingStore((s) => s.addNotification);
    const isLeaderRef = useRef(false);

    // Broadcast a message to other tabs
    const broadcast = useCallback((type: SyncMessage["type"], payload?: unknown) => {
        const channel = getChannel();
        if (!channel) return;

        const message: SyncMessage = {
            type,
            payload,
            tabId: TAB_ID,
            timestamp: Date.now(),
        };

        try {
            channel.postMessage(message);
        } catch (error) {
            console.error("[TabSync] Broadcast error:", error);
        }
    }, []);

    // Handle incoming messages from other tabs
    useEffect(() => {
        const channel = getChannel();
        if (!channel) return;

        const handleMessage = (event: MessageEvent<SyncMessage>) => {
            const { type, payload, tabId, timestamp } = event.data;

            // Ignore messages from self
            if (tabId === TAB_ID) return;

            // Ignore old messages (> 5 seconds)
            if (Date.now() - timestamp > 5000) return;

            switch (type) {
                case "notification":
                    // Add notification from another tab
                    if (payload && typeof payload === "object") {
                        const notif = payload as { chatId: string; chatTitle: string; preview: string; type: "completed" | "failed" };
                        addNotification({
                            chatId: notif.chatId,
                            chatTitle: notif.chatTitle,
                            preview: notif.preview,
                            type: notif.type,
                        });
                    }
                    break;

                case "run-complete":
                    console.debug("[TabSync] Received run-complete from tab:", tabId);
                    break;

                case "ping":
                    // Respond to ping for leader election
                    broadcast("pong");
                    break;

                case "pong":
                    // Another tab is alive
                    break;
            }
        };

        channel.addEventListener("message", handleMessage);

        // Announce presence
        broadcast("ping");

        return () => {
            channel.removeEventListener("message", handleMessage);
        };
    }, [addNotification, broadcast]);

    // Broadcast notification when one is added locally
    const broadcastNotification = useCallback((notif: {
        chatId: string;
        chatTitle: string;
        preview: string;
        type: "completed" | "failed";
    }) => {
        broadcast("notification", notif);
    }, [broadcast]);

    const broadcastRunComplete = useCallback((chatId: string) => {
        broadcast("run-complete", { chatId });
    }, [broadcast]);

    return {
        tabId: TAB_ID,
        isLeader: isLeaderRef.current,
        broadcast,
        broadcastNotification,
        broadcastRunComplete,
    };
}

/**
 * Get the current tab ID
 */
export function getTabId() {
    return TAB_ID;
}
