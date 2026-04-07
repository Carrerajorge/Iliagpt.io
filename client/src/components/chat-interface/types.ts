/**
 * Chat Interface Types
 * Extracted from chat-interface.tsx for modularity
 */

import React from 'react';

// ============================================
// MESSAGE TYPES
// ============================================

export interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    attachments?: Attachment[];
    artifacts?: Artifact[];
    sources?: Source[];
    isStreaming?: boolean;
    metadata?: MessageMetadata;
    confidence?: 'high' | 'medium' | 'low';
    uncertaintyReason?: string;
}

export interface Attachment {
    id: string;
    name: string;
    type: string;
    size: number;
    url?: string;
    content?: string;
    thumbnail?: string;
}

export interface Artifact {
    id: string;
    type: 'code' | 'document' | 'spreadsheet' | 'presentation' | 'image' | 'diagram';
    title: string;
    content: string;
    language?: string;
    metadata?: Record<string, any>;
}

export interface Source {
    id: string;
    title: string;
    url?: string;
    type: 'web' | 'academic' | 'document' | 'internal';
    snippet?: string;
    relevance?: number;
    metadata?: {
        pageNumber?: number;
        section?: string;
        totalPages?: number;
    };
}

export interface MessageMetadata {
    model?: string;
    tokens?: { prompt: number; completion: number };
    duration?: number;
    toolsUsed?: string[];
}

// ============================================
// CHAT STATE TYPES
// ============================================

export interface Chat {
    id: string;
    title: string;
    messages: Message[];
    createdAt: Date;
    updatedAt: Date;
    projectId?: string;
    metadata?: ChatMetadata;
}

export interface ChatMetadata {
    gptId?: string;
    systemPrompt?: string;
    model?: string;
    temperature?: number;
}

// ============================================
// UI STATE TYPES
// ============================================

// Canonical streaming states: idle -> queued -> sending -> reconnecting/recovering -> streaming -> done/error
// Legacy aliases (thinking/responding) are still accepted for compatibility.
export type AIState =
    | 'idle'
    | 'queued'
    | 'sending'
    | 'reconnecting'
    | 'recovering'
    | 'streaming'
    | 'done'
    | 'error'
    | 'agent_working'
    | 'thinking'
    | 'responding';

export const isAiSendingState = (state: AIState): boolean =>
    state === 'sending' || state === 'thinking' || state === 'reconnecting' || state === 'recovering';

export const isAiStreamingState = (state: AIState): boolean =>
    state === 'streaming' || state === 'responding';

export const isAiBusyState = (state: AIState): boolean =>
    !['idle', 'done', 'error'].includes(state);

export interface AiProcessStep {
    id?: string;
    title?: string;
    description?: string;
    status: 'pending' | 'active' | 'done';
    step?: string; // Legacy
    message?: string;
    startedAt?: number;
    retryAfterSeconds?: number;
    queuePosition?: number;
}
export type UIPhase = 'idle' | 'thinking' | 'console' | 'done';

export interface DocumentEditorState {
    isActive: boolean;
    type: 'word' | 'excel' | 'powerpoint' | 'code' | null;
    title: string;
    content: string;
    isMinimized: boolean;
}

export interface DocumentGenerationState {
    status: 'idle' | 'generating' | 'complete' | 'error';
    progress: number;
    stage: string;
    downloadUrl: string | null;
    fileName: string | null;
    fileSize: number | null;
}

// ============================================
// CONTENT BLOCK TYPES
// ============================================

export interface ContentBlock {
    id: number;
    type: 'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'list' | 'numberedList' | 'blockquote' | 'table' | 'hr';
    content: string;
    raw: string;
}

export interface TextSelection {
    text: string;
    startIndex: number;
    endIndex: number;
}

// ============================================
// STREAMING TYPES
// ============================================

export interface StreamingState {
    isStreaming: boolean;
    content: string;
    chunks: string[];
    startTime: number | null;
}

// ============================================
// TOOL TYPES
// ============================================

export type DocToolType = 'word' | 'excel' | 'powerpoint' | 'diagram' | 'code' | null;

export interface ToolExecution {
    id: string;
    name: string;
    status: 'pending' | 'running' | 'complete' | 'error';
    input?: Record<string, any>;
    output?: Record<string, any>;
    duration?: number;
}

// ============================================
// PROPS TYPES
// ============================================

export interface ChatInterfaceProps {
    chatId: string | null;
    messages: Message[];
    onSendMessage: (content: string, attachments?: File[]) => Promise<void>;
    onNewChat: () => void;
    onDeleteMessage?: (messageId: string) => void;
    onEditMessage?: (messageId: string, newContent: string) => void;
    isLoading?: boolean;
    className?: string;
    projectId?: string;
    gptConfig?: ChatMetadata;
}

export interface StreamingIndicatorProps {
    aiState: AIState;
    streamingContent: string;
    onCancel: () => void;
    uiPhase?: UIPhase;
    aiProcessSteps?: AiProcessStep[];
}

export interface MessageListProps {
    messages: Message[];
    isStreaming: boolean;
    streamingContent: string;
    onEditMessage?: (messageId: string, newContent: string) => void;
    onDeleteMessage?: (messageId: string) => void;
    onArtifactClick?: (artifact: Artifact) => void;
}

export interface ComposerAreaProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onFileAttach: (files: File[]) => void;
    isDisabled: boolean;
    placeholder?: string;
    attachments: File[];
    onRemoveAttachment: (index: number) => void;
}

// ============================================
// DOCUMENT PREVIEW TYPES
// ============================================

export interface DocumentPreviewArtifact {
    id: string;
    type: 'document' | 'spreadsheet' | 'presentation';
    title: string;
    content: string;
    format?: string;
}
