import fs from 'fs/promises';
import path from 'path';
import type { Response } from 'express';
import { createUnifiedRun, executeUnifiedChat } from '../agent/unifiedChatHandler';
import { storage } from '../storage';
import { MemorySseResponse } from '../integrations/whatsappWebAutoReply';
import { processInboundMedia } from './mediaProcessor';
import type { WhatsAppMediaAttachment } from '../integrations/whatsappWeb';
import { MultimodalResponseSender, type SendTarget, type AgentOutput } from './multimodalResponseSender';

export interface ChannelExecutionRequest {
    userId: string;
    chatId: string;
    chatTitle?: string;
    inboundText: string;
    media?: WhatsAppMediaAttachment;
    sender: MultimodalResponseSender;
    sendTarget: SendTarget;
    customPrompt?: string;
    accessLevel?: 'owner' | 'trusted' | 'unknown';
}

const AUTO_REPLY_TIMEOUT_MS = 120_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
        timer.unref?.();
        promise.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); },
        );
    });
}

export async function executeChannelAgent(req: ChannelExecutionRequest): Promise<void> {
    const { userId, chatId, chatTitle, inboundText, media, sender, sendTarget, customPrompt, accessLevel = 'owner' } = req;

    // 1. Procesar media entrante y agregarlo al contexto conversacional actual
    const { messages: mediaContextMsgs, extractedText } = await processInboundMedia(media, inboundText);

    // 2. Cargar historial
    const history = await storage.getChatMessages(chatId).then((msgs) => msgs.slice(-20));
    const messages: Array<{ role: string; content: any }> = history
        .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m: any) => ({ role: m.role, content: m.content }));

    if (customPrompt) {
        messages.unshift({ role: 'system', content: customPrompt });
    }

    // Agregar los nuevos mensajes procesados por vision/audio/docs al final
    messages.push(...mediaContextMsgs);

    // 3. Crear entorno de ejecución Agentic
    const unifiedContext = await createUnifiedRun({
        messages,
        chatId,
        userId,
        messageId: `channel_msg_${Date.now()}`,
        accessLevel,
        // TODO: Aca en el futuro podemos forzar latencyMode: 'deep' si detectamos intención pesada
    });

    const memRes = new MemorySseResponse();

    console.log(`[ChannelAgentExecutor] Executing agent loop for run ${unifiedContext.runId}...`);

    // 4. Ejecutar con Timeout
    await withTimeout(
        executeUnifiedChat(unifiedContext, {
            messages,
            chatId,
            userId,
            messageId: `channel_msg_${Date.now()}`,
        }, memRes as any as Response),
        AUTO_REPLY_TIMEOUT_MS,
        'Auto-reply AI'
    );

    console.log(`[ChannelAgentExecutor] AI finished. Parsing events...`);

    // 5. Parsear la respuesta y los artefactos del stream SSE interceptado en memRes
    const assistantText = memRes.chunks
        .filter((c: any) => c.event === 'chunk' && typeof c.data?.content === 'string')
        .map((c: any) => c.data.content)
        .join('')
        .trim();

    const confirmationEvent = memRes.chunks.find((c: any) => c.event === 'confirmation');
    const browserSteps = memRes.chunks.filter((c: any) => c.event === 'browser_report');

    let finalText = assistantText;
    if (!finalText && confirmationEvent) {
        finalText = 'Listo. Responda CONFIRM o CANCEL para continuar.';
    } else if (!finalText && browserSteps.length > 0) {
        finalText = `He completado ${browserSteps.length} acciones en el navegador para cumplir tu solicitud.`;
    } else if (!finalText) {
        finalText = 'Listo.';
    }

    // 6. Persistir el output del agente en la base de datos local
    const savedAssistantMessage = await storage.createChatMessage({
        chatId,
        role: 'assistant',
        content: finalText,
        status: 'done',
        requestId: `ch_out_${unifiedContext.runId}`,
        metadata: { channel: sendTarget.channel, to: sendTarget.recipientId },
    } as any);
    await storage.updateChat(chatId, { lastMessageAt: new Date() } as any);

    // 7. Preparar la salida para el Multimodal Sender
    const output: AgentOutput = {
        text: finalText,
        generatedFiles: [],
    };

    // 8. Interceptar archivos generados (documentos, pptx, excel, etc)
    const artifactEvents = memRes.chunks.filter((c: any) => c.event === 'artifacts' && c.data?.artifacts);
    for (const evt of artifactEvents) {
        const artifacts: Array<{ type?: string; url?: string; name?: string }> = evt.data.artifacts || [];
        for (const artifact of artifacts) {
            if (!artifact.name) continue;
            const filePath = path.join(process.cwd(), 'generated_artifacts', artifact.name);

            const ext = path.extname(artifact.name).toLowerCase();
            let type: Exclude<AgentOutput['generatedFiles'], undefined>[0]['type'] = 'other';
            if (ext === '.pdf' || ext === '.docx') type = 'document';
            else if (ext === '.xlsx') type = 'spreadsheet';
            else if (ext === '.pptx') type = 'presentation';

            const mimeMap: Record<string, string> = {
                '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                '.pdf': 'application/pdf',
            };

            output.generatedFiles!.push({
                name: artifact.name,
                path: filePath,
                type,
                mimetype: mimeMap[ext] || 'application/octet-stream',
            });
        }
    }

    // Extraer un screenshot si el browser tool fue usado
    const lastBrowserStep = browserSteps[browserSteps.length - 1];
    if (lastBrowserStep && lastBrowserStep.data?.screenshot) { // asumiendo base64 en data.screenshot
        const base64Data = lastBrowserStep.data.screenshot.replace(/^data:image\/\w+;base64,/, "");
        output.screenshot = Buffer.from(base64Data, 'base64');
        output.screenshotCaption = lastBrowserStep.data?.reasoning || 'Último estado del navegador';
    }

    // 9. Enviar respuesta real mediante canal correspondiente (WhatsApp, Telegram, etc)
    console.log(`[ChannelAgentExecutor] Dispatching to MultimodalSender (${output.text.length} chars, ${output.generatedFiles?.length} files)`);
    await sender.send(sendTarget, output);
}
