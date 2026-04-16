/**
 * Chat API Zod Schemas
 * Fix #20: Add Zod validation to chat endpoints
 */
import { z } from 'zod';
import {
    MAX_CHAT_ATTACHMENTS,
    MAX_CHAT_ATTACHMENT_SIZE_BYTES,
    MAX_CHAT_ATTACHMENT_TOTAL_BYTES,
    MAX_CHAT_INLINE_IMAGE_BASE64_CHARS,
} from '@shared/chatLimits';

const MAX_CHAT_MESSAGES = 100;

function applyChatAttachmentRefinements<T extends z.ZodTypeAny>(schema: T): T {
    return schema.superRefine((data: any, ctx: z.RefinementCtx) => {
        const attachments = data.attachments ?? [];
        let totalAttachmentBytes = 0;

        attachments.forEach((attachment: { size?: number }, index: number) => {
            if (typeof attachment.size !== 'number') {
                return;
            }

            totalAttachmentBytes += attachment.size;

            if (attachment.size > MAX_CHAT_ATTACHMENT_SIZE_BYTES) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['attachments', index, 'size'],
                    message: `Attachment exceeds maximum size of ${Math.round(MAX_CHAT_ATTACHMENT_SIZE_BYTES / (1024 * 1024))} MB`,
                });
            }
        });

        if (totalAttachmentBytes > MAX_CHAT_ATTACHMENT_TOTAL_BYTES) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['attachments'],
                message: `Combined attachment size exceeds ${Math.round(MAX_CHAT_ATTACHMENT_TOTAL_BYTES / (1024 * 1024))} MB`,
            });
        }
    }) as T;
}

// Chat message schema
export const chatMessageSchema = z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().min(1, 'Message content cannot be empty').max(500_000, 'Message too long'),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

// Attachment schema — validates file metadata without blocking legitimate files
const attachmentSchema = z.object({
    id: z.string().max(200).optional(),
    fileId: z.string().max(200).optional(),
    name: z.string().max(255).optional(),
    type: z.string().max(160).optional(),
    mimeType: z.string().max(180).optional(),
    size: z.number().int().min(0).max(MAX_CHAT_ATTACHMENT_SIZE_BYTES).optional(),
    storagePath: z.string().max(512).optional(),
    content: z.string().max(2_000_000).optional(),
    url: z.string().max(2048).optional(),
}).passthrough(); // allow extra fields from legacy clients

const baseChatRequestSchema = z.object({
    messages: z.array(chatMessageSchema).min(1, 'At least one message is required').max(MAX_CHAT_MESSAGES, 'Too many messages'),
    useRag: z.boolean().optional().default(true),
    conversationId: z.string().max(200).optional(),
    images: z.array(z.string()).max(10).optional(),
    gptConfig: z.any().optional(), // Legacy GPT config
    gptId: z.string().max(120).optional(),
    documentMode: z.boolean().optional(),
    figmaMode: z.boolean().optional(),
    provider: z.string().max(40).optional().default('gemini'),
    model: z.string().max(160).trim().optional().default('gemini-2.5-flash'),
    attachments: z.array(attachmentSchema).max(MAX_CHAT_ATTACHMENTS).optional(),
    lastImageBase64: z.string().max(MAX_CHAT_INLINE_IMAGE_BASE64_CHARS).nullable().optional(),
    lastImageId: z.string().max(200).nullable().optional(),
    session_id: z.string().max(120).optional(),
});

// Chat request body schema
export const chatRequestSchema = applyChatAttachmentRefinements(baseChatRequestSchema);

export type ChatRequest = z.infer<typeof chatRequestSchema>;

// Streaming chat request schema
export const streamChatRequestSchema = applyChatAttachmentRefinements(baseChatRequestSchema.extend({
    runId: z.string().max(200).optional(),
    chatId: z.string().max(200).optional(),
    // Client may send docTool="figma" even when server ignores it; accept to avoid hard-failing validation.
    // Client sends null when no doc tool is selected — must accept null alongside undefined.
    docTool: z.enum(['word', 'excel', 'ppt', 'figma']).nullable().optional(),

    // Streaming/runtime controls (used by /api/chat/stream)
    latencyMode: z.enum(['fast', 'deep', 'auto']).optional(),
    queueMode: z.enum(['queue', 'replace', 'reject']).optional(),
    forceWebSearch: z.boolean().optional(),
    webSearchAuto: z.boolean().optional(),

    // Idempotency/correlation
    clientRequestId: z.string().max(200).optional(),
    userRequestId: z.string().max(200).optional(),

    // Skill routing
    skillId: z.string().max(120).optional(),
    skill: z.any().optional(),
    skillScopes: z.array(z.string().max(120)).max(30).optional(),

    // Client-generated request correlation ID
    requestId: z.string().max(200).optional(),
}).passthrough()); // allow extra fields from client without hard-failing

export type StreamChatRequest = z.infer<typeof streamChatRequestSchema>;

// Image generation request
export const imageGenerateRequestSchema = z.object({
    prompt: z.string().min(1, 'Prompt is required').max(4000, 'Prompt too long'),
});

export type ImageGenerateRequest = z.infer<typeof imageGenerateRequestSchema>;

// Voice chat request
export const voiceChatRequestSchema = z.object({
    message: z.string().min(1, 'Message is required'),
});

export type VoiceChatRequest = z.infer<typeof voiceChatRequestSchema>;

// PARE analyze request
export const analyzeRequestSchema = z.object({
    message: z.string().optional(),
    attachments: z.array(z.object({
        name: z.string(),
        type: z.string().optional(),
        mimeType: z.string().optional(),
        fileId: z.string().optional(),
        storagePath: z.string().optional(),
        url: z.string().optional(),
        content: z.string().optional(),
        size: z.number().optional(),
    })).min(1, 'At least one attachment is required'),
    chatId: z.string().optional(),
    locale: z.string().optional().default('es'),
});

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

// Feedback request
export const feedbackRequestSchema = z.object({
    messageId: z.string().min(1, 'Message ID is required'),
    conversationId: z.string().optional(),
    feedbackType: z.enum(['positive', 'negative']),
    timestamp: z.string().optional(),
    comment: z.string().max(2000).optional(),
});

export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;

// ETL request
export const etlRunRequestSchema = z.object({
    countries: z.array(z.string()).min(1, 'At least one country is required'),
    indicators: z.array(z.string()).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
});

export type EtlRunRequest = z.infer<typeof etlRunRequestSchema>;

// Export all schemas for endpoint use
export const chatSchemas = {
    chat: chatRequestSchema,
    stream: streamChatRequestSchema,
    imageGenerate: imageGenerateRequestSchema,
    voiceChat: voiceChatRequestSchema,
    analyze: analyzeRequestSchema,
    feedback: feedbackRequestSchema,
    etlRun: etlRunRequestSchema,
};
