/**
 * Chat State Hook
 * Manages all chat-related state in one place
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Message, AIState, UIPhase, DocumentEditorState, DocumentGenerationState, DocToolType, StreamingState } from './types';

export interface UseChatStateReturn {
    // Message state
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;

    // AI state
    aiState: AIState;
    setAiState: React.Dispatch<React.SetStateAction<AIState>>;
    uiPhase: UIPhase;
    setUiPhase: React.Dispatch<React.SetStateAction<UIPhase>>;

    // Streaming state
    streamingContent: string;
    setStreamingContent: React.Dispatch<React.SetStateAction<string>>;
    isStreaming: boolean;

    // Document editor state
    documentEditor: DocumentEditorState;
    setDocumentEditor: React.Dispatch<React.SetStateAction<DocumentEditorState>>;

    // Document generation state  
    docGeneration: DocumentGenerationState;
    setDocGeneration: React.Dispatch<React.SetStateAction<DocumentGenerationState>>;

    // Selected tool
    selectedDocTool: DocToolType;
    setSelectedDocTool: React.Dispatch<React.SetStateAction<DocToolType>>;

    // Actions
    resetState: () => void;
    cancelStreaming: () => void;
}

const initialDocEditor: DocumentEditorState = {
    isActive: false,
    type: null,
    title: '',
    content: '',
    isMinimized: false,
};

const initialDocGeneration: DocumentGenerationState = {
    status: 'idle',
    progress: 0,
    stage: '',
    downloadUrl: null,
    fileName: null,
    fileSize: null,
};

export function useChatState(initialMessages: Message[] = []): UseChatStateReturn {
    // Core message state
    const [messages, setMessages] = useState<Message[]>(initialMessages);

    // AI/streaming state
    const [aiState, setAiState] = useState<AIState>('idle');
    const [uiPhase, setUiPhase] = useState<UIPhase>('idle');
    const [streamingContent, setStreamingContent] = useState('');

    // Document state
    const [documentEditor, setDocumentEditor] = useState<DocumentEditorState>(initialDocEditor);
    const [docGeneration, setDocGeneration] = useState<DocumentGenerationState>(initialDocGeneration);
    const [selectedDocTool, setSelectedDocTool] = useState<DocToolType>(null);

    // Abort controller ref for cancellation
    const abortControllerRef = useRef<AbortController | null>(null);

    const isStreaming = aiState === 'responding' || aiState === 'thinking';

    const resetState = useCallback(() => {
        setAiState('idle');
        setUiPhase('idle');
        setStreamingContent('');
        setDocumentEditor(initialDocEditor);
        setDocGeneration(initialDocGeneration);
        setSelectedDocTool(null);
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
    }, []);

    const cancelStreaming = useCallback(() => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setAiState('idle');
        setUiPhase('idle');
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            abortControllerRef.current?.abort();
        };
    }, []);

    return {
        messages,
        setMessages,
        aiState,
        setAiState,
        uiPhase,
        setUiPhase,
        streamingContent,
        setStreamingContent,
        isStreaming,
        documentEditor,
        setDocumentEditor,
        docGeneration,
        setDocGeneration,
        selectedDocTool,
        setSelectedDocTool,
        resetState,
        cancelStreaming,
    };
}
