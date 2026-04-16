
export interface ActiveGpt {
    id: string;
    name: string;
    description: string | null;
    placeholder?: string | null;
    systemPrompt: string;
    model: string;
    temperature: number | null;
    topP: number | null;
    maxTokens?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    welcomeMessage: string | null;
    conversationStarters: string[] | null;
    avatar: string | null;
    isPublic?: boolean;
    userId?: string;
    createdAt?: Date;
    updatedAt?: Date;
    capabilities?: {
        webBrowsing?: boolean;
        codeInterpreter?: boolean;
        imageGeneration?: boolean;
        wordCreation?: boolean;
        excelCreation?: boolean;
        pptCreation?: boolean;
    };
}

export type AiState = "idle" | "sending" | "streaming" | "done" | "error" | "agent_working";

export interface Message {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
    attachments?: {
        id: string;
        name: string;
        type: string;
        url: string;
    }[];
    // Add other message properties as needed matching the existing type
}
