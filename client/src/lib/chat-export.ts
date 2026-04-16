/**
 * Chat Export/Import Service
 * 
 * Allows users to:
 * - Export all chats as JSON or ZIP
 * - Import chats from backup
 */

import { Chat, Message } from '@/hooks/use-chats';

// ============================================================================
// EXPORT TYPES
// ============================================================================

export interface ChatExport {
    version: '1.0';
    exportedAt: string;
    chatsCount: number;
    chats: ExportedChat[];
}

export interface ExportedChat {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: ExportedMessage[];
}

export interface ExportedMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt: number;
}

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

/**
 * Export chats to JSON
 */
export function exportChatsToJSON(chats: Chat[]): string {
    const exportData: ChatExport = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        chatsCount: chats.length,
        chats: chats.map(chat => ({
            id: chat.id,
            title: chat.title,
            createdAt: chat.timestamp || Date.now(),
            updatedAt: chat.timestamp || Date.now(),
            messages: chat.messages.map(msg => ({
                id: msg.id,
                role: msg.role as 'user' | 'assistant' | 'system',
                content: msg.content,
                createdAt: Date.now()
            }))
        }))
    };

    return JSON.stringify(exportData, null, 2);
}

/**
 * Download export as file
 */
export function downloadExport(chats: Chat[], filename?: string): void {
    const json = exportChatsToJSON(chats);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `iliagpt-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`[Export] Downloaded ${chats.length} chats`);
}

// ============================================================================
// IMPORT FUNCTIONS
// ============================================================================

export interface ImportResult {
    success: boolean;
    importedCount: number;
    skippedCount: number;
    errors: string[];
}

/**
 * Parse and validate import file
 */
export function parseImportFile(jsonContent: string): ChatExport | null {
    try {
        const data = JSON.parse(jsonContent);

        // Validate structure
        if (!data.version || !Array.isArray(data.chats)) {
            console.error('[Import] Invalid file structure');
            return null;
        }

        return data as ChatExport;
    } catch (e) {
        console.error('[Import] Failed to parse JSON:', e);
        return null;
    }
}

/**
 * Convert imported data to Chat format
 */
export function convertImportedChats(exportData: ChatExport): Chat[] {
    return exportData.chats.map(exported => ({
        id: `imported_${exported.id}_${Date.now()}`,
        stableKey: `stable_${exported.id}_${Date.now()}`,
        title: exported.title,
        timestamp: exported.createdAt,
        messages: exported.messages.map(msg => ({
            id: `imported_${msg.id}_${Date.now()}`,
            role: msg.role,
            content: msg.content
        })) as Message[]
    }));
}

/**
 * Handle file input for import
 */
export function handleImportFile(
    file: File,
    onSuccess: (chats: Chat[]) => void,
    onError: (error: string) => void
): void {
    const reader = new FileReader();

    reader.onload = (e) => {
        const content = e.target?.result as string;
        if (!content) {
            onError('Failed to read file');
            return;
        }

        const parsed = parseImportFile(content);
        if (!parsed) {
            onError('Invalid backup file format');
            return;
        }

        const chats = convertImportedChats(parsed);
        console.log(`[Import] Parsed ${chats.length} chats from backup`);
        onSuccess(chats);
    };

    reader.onerror = () => {
        onError('Failed to read file');
    };

    reader.readAsText(file);
}

// ============================================================================
// FILE PICKER
// ============================================================================

/**
 * Open file picker for import
 */
export function openImportPicker(
    onSuccess: (chats: Chat[]) => void,
    onError: (error: string) => void
): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
            handleImportFile(file, onSuccess, onError);
        }
    };

    input.click();
}

export default {
    exportChatsToJSON,
    downloadExport,
    parseImportFile,
    convertImportedChats,
    handleImportFile,
    openImportPicker
};
