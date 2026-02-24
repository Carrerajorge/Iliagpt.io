/**
 * Collaborative Cursor Component - ILIAGPT PRO 3.0
 * 
 * Real-time cursor presence for collaborative editing.
 * Shows other users' positions and selections.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";

// ============== Types ==============

export interface CursorPosition {
    userId: string;
    userName: string;
    color: string;
    x: number;
    y: number;
    documentId: string;
    selection?: {
        start: number;
        end: number;
    };
    isTyping: boolean;
    lastUpdate: number;
}

export interface CollaboratorInfo {
    userId: string;
    userName: string;
    color: string;
    avatar?: string;
    isOnline: boolean;
    lastSeen: Date;
}

interface CollaborativeCursorProps {
    documentId: string;
    currentUserId: string;
    currentUserName: string;
    currentUserColor?: string;
    onCursorMove?: (position: CursorPosition) => void;
    children?: React.ReactNode;
}

// ============== Color Palette ==============

const CURSOR_COLORS = [
    "#EF4444", "#F59E0B", "#10B981", "#3B82F6",
    "#8B5CF6", "#EC4899", "#14B8A6", "#F97316",
];

function getColorForUser(userId: string): string {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    }
    return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

// ============== Mock WebSocket ==============

const remoteCursors: Map<string, CursorPosition> = new Map();
const cursorListeners: Set<(cursors: CursorPosition[]) => void> = new Set();

function broadcastCursor(cursor: CursorPosition): void {
    remoteCursors.set(cursor.userId, cursor);
    cursorListeners.forEach(listener =>
        listener(Array.from(remoteCursors.values()))
    );
}

function subscribeToCursors(listener: (cursors: CursorPosition[]) => void): () => void {
    cursorListeners.add(listener);
    listener(Array.from(remoteCursors.values()));
    return () => cursorListeners.delete(listener);
}

// ============== Component ==============

export function CollaborativeCursor({
    documentId,
    currentUserId,
    currentUserName,
    currentUserColor,
    onCursorMove,
    children,
}: CollaborativeCursorProps) {
    const [cursors, setCursors] = useState<CursorPosition[]>([]);
    const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);
    const color = currentUserColor || getColorForUser(currentUserId);
    const typingTimeout = useRef<NodeJS.Timeout | null>(null);
    const [isTyping, setIsTyping] = useState(false);

    // ======== Subscribe to Remote Cursors ========

    useEffect(() => {
        const unsubscribe = subscribeToCursors((allCursors) => {
            // Filter out current user and expired cursors
            const filtered = allCursors.filter(c =>
                c.userId !== currentUserId &&
                c.documentId === documentId &&
                Date.now() - c.lastUpdate < 30000 // 30s timeout
            );
            setCursors(filtered);

            // Update collaborators list
            const collabs: CollaboratorInfo[] = filtered.map(c => ({
                userId: c.userId,
                userName: c.userName,
                color: c.color,
                isOnline: Date.now() - c.lastUpdate < 10000,
                lastSeen: new Date(c.lastUpdate),
            }));
            setCollaborators(collabs);
        });

        return unsubscribe;
    }, [currentUserId, documentId]);

    // ======== Mouse Movement Handler ========

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!containerRef.current) return;

        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const position: CursorPosition = {
            userId: currentUserId,
            userName: currentUserName,
            color,
            x,
            y,
            documentId,
            isTyping,
            lastUpdate: Date.now(),
        };

        broadcastCursor(position);
        onCursorMove?.(position);
    }, [currentUserId, currentUserName, color, documentId, isTyping, onCursorMove]);

    // ======== Selection Handler ========

    const handleSelection = useCallback(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const range = selection.getRangeAt(0);
        const position: CursorPosition = {
            userId: currentUserId,
            userName: currentUserName,
            color,
            x: 0,
            y: 0,
            documentId,
            selection: {
                start: range.startOffset,
                end: range.endOffset,
            },
            isTyping: false,
            lastUpdate: Date.now(),
        };

        broadcastCursor(position);
    }, [currentUserId, currentUserName, color, documentId]);

    // ======== Typing Indicator ========

    const handleKeyDown = useCallback(() => {
        setIsTyping(true);

        if (typingTimeout.current) {
            clearTimeout(typingTimeout.current);
        }

        typingTimeout.current = setTimeout(() => {
            setIsTyping(false);
        }, 2000);
    }, []);

    // ======== Event Listeners ========

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        container.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("selectionchange", handleSelection);
        container.addEventListener("keydown", handleKeyDown);

        return () => {
            container.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("selectionchange", handleSelection);
            container.removeEventListener("keydown", handleKeyDown);
        };
    }, [handleMouseMove, handleSelection, handleKeyDown]);

    // ======== Render ========

    return (
        <div ref={containerRef} className="relative" style={{ isolation: "isolate" }}>
            {/* Content */}
            <div className="relative z-0">
                {children}
            </div>

            {/* Remote Cursors */}
            {cursors.map(cursor => (
                <RemoteCursor key={cursor.userId} cursor={cursor} />
            ))}

            {/* Collaborators List */}
            <div className="absolute top-4 right-4 z-50">
                <CollaboratorsList collaborators={collaborators} />
            </div>
        </div>
    );
}

// ============== Remote Cursor Component ==============

interface RemoteCursorProps {
    cursor: CursorPosition;
}

function RemoteCursor({ cursor }: RemoteCursorProps) {
    const opacity = Math.max(0.3, 1 - (Date.now() - cursor.lastUpdate) / 30000);

    return (
        <div
            className="absolute pointer-events-none z-40 transition-all duration-100"
            style={{
                left: cursor.x,
                top: cursor.y,
                opacity,
            }}
        >
            {/* Cursor Arrow */}
            <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill={cursor.color}
                className="drop-shadow-md"
            >
                <path d="M4 2l16 12-7 2-5 8-4-22z" />
            </svg>

            {/* Name Label */}
            <div
                className="absolute left-4 top-4 px-2 py-1 rounded text-xs text-white whitespace-nowrap shadow-lg flex items-center gap-1"
                style={{ backgroundColor: cursor.color }}
            >
                {cursor.userName}
                {cursor.isTyping && (
                    <span className="animate-pulse">...</span>
                )}
            </div>
        </div>
    );
}

// ============== Collaborators List ==============

interface CollaboratorsListProps {
    collaborators: CollaboratorInfo[];
}

function CollaboratorsList({ collaborators }: CollaboratorsListProps) {
    if (collaborators.length === 0) return null;

    return (
        <div className="flex -space-x-2">
            {collaborators.slice(0, 5).map(collab => (
                <div
                    key={collab.userId}
                    className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-xs text-white font-bold shadow-md"
                    style={{ backgroundColor: collab.color }}
                    title={`${collab.userName} (${collab.isOnline ? "online" : "away"})`}
                >
                    {collab.avatar ? (
                        // FRONTEND FIX #6: Add meaningful alt text for accessibility
                        <img src={collab.avatar} alt={`${collab.userName}'s avatar`} className="w-full h-full rounded-full" />
                    ) : (
                        collab.userName.charAt(0).toUpperCase()
                    )}
                    {collab.isOnline && (
                        <div className="absolute bottom-0 right-0 w-2 h-2 bg-green-500 rounded-full border border-white" />
                    )}
                </div>
            ))}
            {collaborators.length > 5 && (
                <div className="w-8 h-8 rounded-full bg-gray-500 border-2 border-white flex items-center justify-center text-xs text-white font-bold">
                    +{collaborators.length - 5}
                </div>
            )}
        </div>
    );
}

// ============== Hook for External Use ==============

export function useCollaborativeCursors(documentId: string) {
    const [cursors, setCursors] = useState<CursorPosition[]>([]);

    useEffect(() => {
        return subscribeToCursors((allCursors) => {
            setCursors(allCursors.filter(c => c.documentId === documentId));
        });
    }, [documentId]);

    return { cursors };
}

export default CollaborativeCursor;
