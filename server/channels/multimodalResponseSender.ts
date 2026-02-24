import fs from 'fs/promises';
import path from 'path';
import { WhatsAppIntegration } from '../integrations/whatsappWeb';
import { ttsService } from '../services/voiceAudioService';
import { telegramSendMessage, telegramSendPhoto, telegramSendVoice, telegramSendVideo, telegramSendDocument } from './telegram/telegramApi';
import { filterContent } from '../services/contentModerationService';
import { Logger } from '../lib/logger';

export interface AgentOutput {
    text: string;
    generatedFiles?: Array<{
        path: string;
        name: string;
        type: 'document' | 'image' | 'audio' | 'video' | 'spreadsheet' | 'presentation' | 'other';
        mimetype: string;
    }>;
    screenshot?: Buffer;
    screenshotCaption?: string;
}

export interface SendTarget {
    channel: 'whatsapp_web' | 'whatsapp_cloud' | 'telegram' | 'messenger' | 'wechat' | 'slack';
    userId: string;
    recipientId: string;  // JID para WhatsApp, chat_id para Telegram, channel para Slack
    slackToken?: string;  // Bot token para Slack (si aplica)
}

export class MultimodalResponseSender {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(private whatsappManager: any) { }

    private async delay(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private chunkText(text: string, maxLength: number): string[] {
        const chunks: string[] = [];
        let currentChunk = '';
        const paragraphs = text.split('\n\n');

        for (const paragraph of paragraphs) {
            if (currentChunk.length + paragraph.length > maxLength) {
                if (currentChunk) chunks.push(currentChunk.trim());
                currentChunk = paragraph;
            } else {
                currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
            }
        }
        if (currentChunk) chunks.push(currentChunk.trim());
        return chunks;
    }

    async send(target: SendTarget, output: AgentOutput): Promise<void> {
        // Moderar contenido antes de enviarlo a cualquier canal
        const safeText = filterContent(output.text || '', { plan: 'pro', channel: target.channel });
        if (safeText === null) {
            Logger.warn('[MultimodalSender] Content blocked by moderation', { channel: target.channel, userId: target.userId });
            const blockedOutput: AgentOutput = {
                ...output,
                text: '⚠️ El contenido de esta respuesta fue bloqueado por las políticas de moderación.',
                generatedFiles: [],
                screenshot: undefined,
            };
            output = blockedOutput;
        } else if (safeText !== output.text) {
            output = { ...output, text: safeText };
        }

        switch (target.channel) {
            case 'whatsapp_web':
                await this.sendViaWhatsApp(target, output);
                break;
            case 'telegram':
                await this.sendViaTelegram(target, output);
                break;
            case 'slack':
                await this.sendViaSlack(target, output);
                break;
            case 'messenger':
                await this.sendViaMessenger(target, output);
                break;
            case 'wechat':
                await this.sendViaWeChat(target, output);
                break;
        }
    }

    private async sendViaWhatsApp(target: SendTarget, output: AgentOutput): Promise<void> {
        const { userId, recipientId } = target;

        // 1. Enviar texto principal (chunked si es largo)
        if (output.text) {
            const chunks = this.chunkText(output.text, 4000);
            for (const chunk of chunks) {
                await this.whatsappManager.sendText(userId, recipientId, chunk);
                await this.delay(300); // evitar rate limit
            }
        }

        // 2. Enviar screenshot si hay
        if (output.screenshot) {
            await this.whatsappManager.sendImage(
                userId,
                recipientId,
                output.screenshot,
                'image/png',
                output.screenshotCaption || '📸 Screenshot del desktop'
            );
            await this.delay(300);
        }

        // 3. Enviar archivos generados
        if (output.generatedFiles?.length) {
            for (const file of output.generatedFiles) {
                try {
                    const buffer = await fs.readFile(file.path);

                    if (file.type === 'image') {
                        await this.whatsappManager.sendImage(
                            userId, recipientId, buffer, file.mimetype, file.name
                        );
                    } else if (file.type === 'audio') {
                        await this.whatsappManager.sendAudioNote(
                            userId, recipientId, buffer, file.mimetype
                        );
                    } else if (file.type === 'video') {
                        await this.whatsappManager.sendVideo(
                            userId, recipientId, buffer, file.mimetype, file.name
                        );
                    } else {
                        // document, spreadsheet, presentation, other
                        await this.whatsappManager.sendDocument(
                            userId, recipientId, buffer, file.name, file.mimetype
                        );
                    }
                    await this.delay(500);
                } catch (err: any) {
                    console.error(`[MultimodalSender] Failed to send file ${file.path}:`, err?.message);
                }
            }
        }

        // 4. Opcionalmente generar nota de voz para respuestas largas (Desactivado por defecto excepto si hay flag/condicion, pero según spec se genera si text > 3000)
        if (output.text && output.text.length > 3000) {
            try {
                const tts = await ttsService.synthesize(output.text.slice(0, 2000), {
                    provider: 'openai', // O elevenlabs si está configurado
                    format: 'opus',
                });
                if (tts.success && tts.audioPath) {
                    const audioBuffer = await fs.readFile(tts.audioPath);
                    await this.whatsappManager.sendAudioNote(
                        userId, recipientId, audioBuffer, 'audio/ogg; codecs=opus'
                    );
                }
            } catch (err) {
                console.warn('[MultimodalSender] TTS failed, skipping voice note:', err);
            }
        }
    }

    private async sendViaTelegram(target: SendTarget, output: AgentOutput): Promise<void> {
        const { recipientId } = target;

        // 1. Enviar texto principal
        if (output.text) {
            await telegramSendMessage(recipientId, output.text);
            await this.delay(300);
        }

        // 2. Enviar screenshot
        if (output.screenshot) {
            await telegramSendPhoto(recipientId, output.screenshot, 'screenshot.png', 'image/png', output.screenshotCaption || '📸 Screenshot del desktop');
            await this.delay(300);
        }

        // 3. Enviar archivos generados
        if (output.generatedFiles?.length) {
            for (const file of output.generatedFiles) {
                try {
                    const buffer = await fs.readFile(file.path);

                    if (file.type === 'image') {
                        await telegramSendPhoto(recipientId, buffer, file.name, file.mimetype);
                    } else if (file.type === 'audio') {
                        await telegramSendVoice(recipientId, buffer, file.name, file.mimetype);
                    } else if (file.type === 'video') {
                        await telegramSendVideo(recipientId, buffer, file.name, file.mimetype);
                    } else {
                        await telegramSendDocument(recipientId, buffer, file.name, file.mimetype);
                    }
                    await this.delay(500);
                } catch (err: any) {
                    console.error(`[MultimodalSender] Failed to send file to Telegram ${file.path}:`, err?.message);
                }
            }
        }

        // 4. TTS opcional
        if (output.text && output.text.length > 3000) {
            try {
                const tts = await ttsService.synthesize(output.text.slice(0, 2000), {
                    provider: 'openai',
                    format: 'opus',
                });
                if (tts.success && tts.audioPath) {
                    const audioBuffer = await fs.readFile(tts.audioPath);
                    await telegramSendVoice(recipientId, audioBuffer, 'voice.ogg', 'audio/ogg');
                }
            } catch (err) {
                console.warn('[MultimodalSender] TTS failed for Telegram:', err);
            }
        }
    }

    private async sendViaMessenger(target: SendTarget, output: AgentOutput): Promise<void> {
        console.log('[MultimodalSender] Messenger not fully implemented yet');
    }

    private async sendViaWeChat(target: SendTarget, output: AgentOutput): Promise<void> {
        console.log('[MultimodalSender] WeChat not fully implemented yet');
    }

    /** 
     * Slack: usa la API de Slack Web para enviar mensajes y archivos.
     * Requiere que el token de bot tenga permisos: chat:write, files:upload
     */
    private async sendViaSlack(target: SendTarget, output: AgentOutput): Promise<void> {
        const token = target.slackToken || process.env.SLACK_BOT_TOKEN;
        if (!token) {
            Logger.warn('[MultimodalSender] No Slack bot token configured');
            return;
        }

        const channelId = target.recipientId;
        const baseHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        };

        // 1. Enviar texto usando Slack Block Kit
        if (output.text) {
            const chunks = this.chunkText(output.text, 3000); // Slack limit: 3001 chars per block
            for (const chunk of chunks) {
                await fetch('https://slack.com/api/chat.postMessage', {
                    method: 'POST',
                    headers: baseHeaders,
                    body: JSON.stringify({
                        channel: channelId,
                        text: chunk,
                        blocks: [
                            { type: 'section', text: { type: 'mrkdwn', text: chunk.slice(0, 3000) } },
                        ],
                    }),
                });
                await this.delay(300);
            }
        }

        // 2. Enviar screenshot
        if (output.screenshot) {
            await this.slackUploadFile(token, channelId, output.screenshot, 'screenshot.png', 'image/png', output.screenshotCaption || '📸 Screenshot');
            await this.delay(300);
        }

        // 3. Enviar archivos generados
        if (output.generatedFiles?.length) {
            for (const file of output.generatedFiles) {
                try {
                    const buffer = await fs.readFile(file.path);
                    await this.slackUploadFile(token, channelId, buffer, file.name, file.mimetype);
                    await this.delay(500);
                } catch (err: any) {
                    Logger.error(`[MultimodalSender] Failed to upload file to Slack: ${file.path}`, err);
                }
            }
        }
    }

    private async slackUploadFile(
        token: string,
        channelId: string,
        buffer: Buffer,
        filename: string,
        mimeType: string,
        title?: string,
    ): Promise<void> {
        // Paso 1: Obtener URL de upload
        const getUrlRes = await fetch('https://slack.com/api/files.getUploadURLExternal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ filename, length: buffer.length }),
        });
        const urlData = await getUrlRes.json() as Record<string, unknown>;
        if (!urlData.ok) return;

        // Paso 2: Subir el archivo
        await fetch(urlData.upload_url as string, {
            method: 'POST',
            headers: { 'Content-Type': mimeType },
            body: new Uint8Array(buffer),
        });

        // Paso 3: Completar el upload y publicar en el canal
        await fetch('https://slack.com/api/files.completeUploadExternal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                files: [{ id: urlData.file_id, title: title || filename }],
                channel_id: channelId,
            }),
        });
    }
}
