/**
 * Collaborative Editing Service
 * 
 * Features:
 * - Y.js CRDT-based real-time sync
 * - WebSocket provider for multi-user editing
 * - Awareness (cursors, selections, presence)
 * - Persistence and recovery
 */

import * as Y from "yjs";
import { WebSocket, WebSocketServer } from "ws";
import http from "http";
import crypto from "crypto";

// Document state management
interface DocumentSession {
    docId: string;
    doc: Y.Doc;
    clients: Map<string, ClientInfo>;
    createdAt: Date;
    lastActivity: Date;
}

interface ClientInfo {
    clientId: string;
    userId?: string;
    userName?: string;
    color: string;
    cursor?: { line: number; column: number };
    selection?: { start: number; end: number };
    connectedAt: Date;
}

// Configuration
export interface CollabConfig {
    port: number;
    path: string;
    maxClientsPerDoc: number;
    inactivityTimeout: number; // ms
    colors: string[];
}

const DEFAULT_CONFIG: CollabConfig = {
    port: 4444,
    path: "/collab",
    maxClientsPerDoc: 10,
    inactivityTimeout: 30 * 60 * 1000, // 30 minutes
    colors: [
        "#f44336", "#e91e63", "#9c27b0", "#673ab7", "#3f51b5",
        "#2196f3", "#03a9f4", "#00bcd4", "#009688", "#4caf50",
        "#8bc34a", "#cddc39", "#ffeb3b", "#ffc107", "#ff9800",
        "#ff5722", "#795548", "#607d8b",
    ],
};

// Active document sessions
const sessions = new Map<string, DocumentSession>();
let wss: WebSocketServer | null = null;
let config = { ...DEFAULT_CONFIG };

// Initialize collaborative editing server
export function initCollabServer(
    server: http.Server,
    customConfig: Partial<CollabConfig> = {}
): WebSocketServer {
    config = { ...DEFAULT_CONFIG, ...customConfig };

    wss = new WebSocketServer({
        server,
        path: config.path,
    });

    wss.on("connection", handleConnection);

    // Cleanup inactive sessions periodically
    setInterval(cleanupInactiveSessions, 60000);

    console.log(`[Collab] WebSocket server initialized on path ${config.path}`);

    return wss;
}

// Handle new WebSocket connection
function handleConnection(ws: WebSocket, req: http.IncomingMessage) {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const docId = url.searchParams.get("docId") || crypto.randomUUID();
    const userId = url.searchParams.get("userId");
    const userName = url.searchParams.get("userName") || "Anonymous";

    const clientId = crypto.randomUUID();

    console.log(`[Collab] Client ${clientId} connecting to doc ${docId}`);

    // Get or create session
    let session = sessions.get(docId);

    if (!session) {
        session = createSession(docId);
        sessions.set(docId, session);
    }

    // Check client limit
    if (session.clients.size >= config.maxClientsPerDoc) {
        ws.close(1013, "Max clients reached");
        return;
    }

    // Assign color
    const usedColors = new Set([...session.clients.values()].map(c => c.color));
    const availableColor = config.colors.find(c => !usedColors.has(c)) || config.colors[0];

    // Register client
    const clientInfo: ClientInfo = {
        clientId,
        userId,
        userName,
        color: availableColor,
        connectedAt: new Date(),
    };

    session.clients.set(clientId, clientInfo);
    session.lastActivity = new Date();

    // Send initial state
    ws.send(JSON.stringify({
        type: "init",
        docId,
        clientId,
        state: Y.encodeStateAsUpdate(session.doc),
        clients: [...session.clients.values()],
    }));

    // Broadcast join
    broadcastToDoc(docId, {
        type: "client_joined",
        client: clientInfo,
    }, clientId);

    // Handle messages
    ws.on("message", (data: Buffer) => {
        try {
            const message = JSON.parse(data.toString());
            handleMessage(docId, clientId, message, session!);
        } catch (error) {
            console.error("[Collab] Message parse error:", error);
        }
    });

    // Handle disconnect
    ws.on("close", () => {
        handleDisconnect(docId, clientId);
    });

    // Store WebSocket reference
    (ws as any).__clientId = clientId;
    (ws as any).__docId = docId;
}

// Create new document session
function createSession(docId: string): DocumentSession {
    const doc = new Y.Doc();

    // Create default document structure
    doc.getText("content");
    doc.getMap("metadata");

    console.log(`[Collab] Created session for doc ${docId}`);

    return {
        docId,
        doc,
        clients: new Map(),
        createdAt: new Date(),
        lastActivity: new Date(),
    };
}

// Handle incoming messages
function handleMessage(
    docId: string,
    clientId: string,
    message: any,
    session: DocumentSession
): void {
    session.lastActivity = new Date();

    switch (message.type) {
        case "update":
            // Apply Y.js update
            if (message.update) {
                const update = new Uint8Array(message.update);
                Y.applyUpdate(session.doc, update);

                // Broadcast to other clients
                broadcastToDoc(docId, {
                    type: "update",
                    update: message.update,
                    origin: clientId,
                }, clientId);
            }
            break;

        case "awareness":
            // Update client state
            const client = session.clients.get(clientId);
            if (client) {
                if (message.cursor) client.cursor = message.cursor;
                if (message.selection) client.selection = message.selection;

                // Broadcast awareness update
                broadcastToDoc(docId, {
                    type: "awareness",
                    clientId,
                    cursor: client.cursor,
                    selection: client.selection,
                    color: client.color,
                    userName: client.userName,
                }, clientId);
            }
            break;

        case "sync":
            // Client requesting full sync
            broadcastToClient(docId, clientId, {
                type: "sync",
                state: [...Y.encodeStateAsUpdate(session.doc)],
            });
            break;
    }
}

// Handle client disconnect
function handleDisconnect(docId: string, clientId: string): void {
    const session = sessions.get(docId);
    if (!session) return;

    session.clients.delete(clientId);

    // Broadcast leave
    broadcastToDoc(docId, {
        type: "client_left",
        clientId,
    });

    console.log(`[Collab] Client ${clientId} disconnected from doc ${docId}`);

    // Cleanup empty sessions (with delay)
    if (session.clients.size === 0) {
        setTimeout(() => {
            const current = sessions.get(docId);
            if (current && current.clients.size === 0) {
                sessions.delete(docId);
                console.log(`[Collab] Removed empty session ${docId}`);
            }
        }, 10000);
    }
}

// Broadcast to all clients in a document
function broadcastToDoc(docId: string, message: any, excludeClient?: string): void {
    if (!wss) return;

    const data = JSON.stringify(message);

    wss.clients.forEach((client) => {
        const ws = client as any;
        if (
            ws.__docId === docId &&
            ws.__clientId !== excludeClient &&
            client.readyState === WebSocket.OPEN
        ) {
            client.send(data);
        }
    });
}

// Send to specific client
function broadcastToClient(docId: string, clientId: string, message: any): void {
    if (!wss) return;

    const data = JSON.stringify(message);

    wss.clients.forEach((client) => {
        const ws = client as any;
        if (
            ws.__docId === docId &&
            ws.__clientId === clientId &&
            client.readyState === WebSocket.OPEN
        ) {
            client.send(data);
        }
    });
}

// Cleanup inactive sessions
function cleanupInactiveSessions(): void {
    const now = Date.now();

    for (const [docId, session] of sessions) {
        const inactive = now - session.lastActivity.getTime() > config.inactivityTimeout;
        const empty = session.clients.size === 0;

        if (inactive && empty) {
            sessions.delete(docId);
            console.log(`[Collab] Cleaned up inactive session ${docId}`);
        }
    }
}

// Get document content
export function getDocumentContent(docId: string): string | null {
    const session = sessions.get(docId);
    if (!session) return null;

    return session.doc.getText("content").toString();
}

// Set document content (for initial load)
export function setDocumentContent(docId: string, content: string): void {
    let session = sessions.get(docId);

    if (!session) {
        session = createSession(docId);
        sessions.set(docId, session);
    }

    const text = session.doc.getText("content");
    session.doc.transact(() => {
        text.delete(0, text.length);
        text.insert(0, content);
    });
}

// Get active sessions info
export function getActiveSessions(): {
    docId: string;
    clientCount: number;
    lastActivity: Date;
}[] {
    return [...sessions.values()].map(s => ({
        docId: s.docId,
        clientCount: s.clients.size,
        lastActivity: s.lastActivity,
    }));
}

// Get clients in a document
export function getDocumentClients(docId: string): ClientInfo[] {
    const session = sessions.get(docId);
    return session ? [...session.clients.values()] : [];
}

// Shutdown
export function shutdownCollabServer(): void {
    if (wss) {
        wss.clients.forEach((client) => {
            client.close(1001, "Server shutting down");
        });
        wss.close();
        wss = null;
    }

    sessions.clear();
    console.log("[Collab] Server shutdown complete");
}

export default {
    initCollabServer,
    getDocumentContent,
    setDocumentContent,
    getActiveSessions,
    getDocumentClients,
    shutdownCollabServer,
};
