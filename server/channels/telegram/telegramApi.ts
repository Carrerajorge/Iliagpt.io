import { env } from "../../config/env";
import {
  normalizeChannelId,
  normalizeChannelText,
  sanitizeOutboundFilePayload,
} from "../channelTransport";
let Bot: any, InputFile: any;
try { const grammy = require("grammy"); Bot = grammy.Bot; InputFile = grammy.InputFile; } catch {}

const TELEGRAM_MAX_TEXT_LEN = 3900;
const TELEGRAM_MAX_TOKEN_LENGTH = 256;
const TELEGRAM_TOKEN_PREFIX_RE = /^(\d+):[A-Za-z0-9_-]{35,}$/;

// Cache de instancias del bot por token para no instanciar múltiples veces
const botsByToken = new Map<string, Bot>();

function getBotInstance(token: string): Bot {
  if (botsByToken.has(token)) return botsByToken.get(token)!;
  const bot = new Bot(token);
  botsByToken.set(token, bot);
  return bot;
}

function chunkText(text: string, maxLen = TELEGRAM_MAX_TEXT_LEN): string[] {
  const cleaned = normalizeChannelText(text, 4_000).trim();
  if (!cleaned) return [];
  const parts: string[] = [];
  for (let i = 0; i < cleaned.length; i += maxLen) {
    parts.push(cleaned.slice(i, i + maxLen));
  }
  return parts;
}

function normalizeTelegramText(value: unknown, maxLen = TELEGRAM_MAX_TEXT_LEN): string {
  return normalizeChannelText(value, maxLen).trim();
}

function normalizeToken(raw: string | undefined): string {
  const token = normalizeChannelText(raw, TELEGRAM_MAX_TOKEN_LENGTH).replace(/\s+/g, "");
  if (!TELEGRAM_TOKEN_PREFIX_RE.test(token)) {
    return "";
  }
  return token;
}

function normalizeId(value: unknown): string {
  return normalizeChannelId(value, 64);
}

function normalizeSecret(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const normalized = normalizeChannelText(raw, 256).slice(0, 512);
  return normalized || undefined;
}

export async function telegramSendMessage(chatId: string, text: string): Promise<void> {
  const safeToken = normalizeToken(env.TELEGRAM_BOT_TOKEN);
  if (!safeToken) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const safeChatId = normalizeId(chatId);
  if (!safeChatId) throw new Error("Invalid Telegram chat id");

  const parts = chunkText(text);
  if (parts.length === 0) return;

  const bot = getBotInstance(safeToken);

  for (const [index, part] of parts.entries()) {
    try {
      await bot.api.sendMessage(safeChatId, normalizeTelegramText(part), {
        parse_mode: "HTML",
      });
    } catch (error) {
      const current = String((error as Error)?.message || error);
      if (index < parts.length - 1) {
        throw new Error(`Telegram message part failed: ${current}`);
      }
      throw error;
    }
  }
}

export async function telegramSendDocument(
  chatId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  caption?: string,
): Promise<void> {
  return telegramSendMediaInternal(chatId, "document", fileBuffer, fileName, mimeType, caption);
}

export async function telegramSendPhoto(
  chatId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  caption?: string,
): Promise<void> {
  return telegramSendMediaInternal(chatId, "photo", fileBuffer, fileName, mimeType, caption);
}

export async function telegramSendVideo(
  chatId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  caption?: string,
): Promise<void> {
  return telegramSendMediaInternal(chatId, "video", fileBuffer, fileName, mimeType, caption);
}

export async function telegramSendVoice(
  chatId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  caption?: string,
): Promise<void> {
  return telegramSendMediaInternal(chatId, "voice", fileBuffer, fileName, mimeType, caption);
}

async function telegramSendMediaInternal(
  chatId: string,
  mediaType: "document" | "photo" | "video" | "voice",
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  caption?: string,
): Promise<void> {
  const safeToken = normalizeToken(env.TELEGRAM_BOT_TOKEN);
  if (!safeToken) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const safeChatId = normalizeId(chatId);
  if (!safeChatId) throw new Error("Invalid Telegram chat id");

  const fileValidation = sanitizeOutboundFilePayload({
    kind: "document",
    fileBuffer,
    fileName,
    mimeType,
  });
  if (!fileValidation.ok) {
    throw new Error(`Invalid Telegram media payload: ${fileValidation.reason}`);
  }

  const bot = getBotInstance(safeToken);
  const inputFile = new InputFile(fileValidation.value.fileBuffer, fileValidation.value.fileName);
  const safeCaption = normalizeTelegramText(caption || "", 1024);

  try {
    if (mediaType === "document") {
      await bot.api.sendDocument(safeChatId, inputFile, safeCaption ? { caption: safeCaption } : undefined);
    } else if (mediaType === "photo") {
      await bot.api.sendPhoto(safeChatId, inputFile, safeCaption ? { caption: safeCaption } : undefined);
    } else if (mediaType === "video") {
      await bot.api.sendVideo(safeChatId, inputFile, safeCaption ? { caption: safeCaption } : undefined);
    } else if (mediaType === "voice") {
      await bot.api.sendVoice(safeChatId, inputFile, safeCaption ? { caption: safeCaption } : undefined);
    }
  } catch (error) {
    throw new Error(`Telegram send ${mediaType} failed: ${(error as Error).message}`);
  }
}

export async function downloadTelegramMedia(fileId: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
  const safeToken = normalizeToken(env.TELEGRAM_BOT_TOKEN);
  if (!safeToken) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const bot = getBotInstance(safeToken);
  const fileInfo = await bot.api.getFile(fileId);

  if (!fileInfo.file_path) {
    throw new Error("Could not get file_path from Telegram getFile");
  }

  const url = `https://api.telegram.org/file/bot${safeToken}/${fileInfo.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download Telegram media: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();

  const fileName = fileInfo.file_path.split('/').pop() || 'telegram_media';

  let mimeType = 'application/octet-stream';
  if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) mimeType = 'image/jpeg';
  else if (fileName.endsWith('.png')) mimeType = 'image/png';
  else if (fileName.endsWith('.oga') || fileName.endsWith('.ogg')) mimeType = 'audio/ogg';
  else if (fileName.endsWith('.mp3')) mimeType = 'audio/mpeg';
  else if (fileName.endsWith('.mp4')) mimeType = 'video/mp4';
  else if (fileName.endsWith('.pdf')) mimeType = 'application/pdf';

  return { buffer: Buffer.from(arrayBuffer), mimeType, fileName };
}

export async function telegramSetWebhook(input: {
  webhookUrl: string;
  secretToken?: string;
  botToken?: string;
}): Promise<void> {
  const tokenSource = input.botToken || env.TELEGRAM_BOT_TOKEN;
  const safeToken = normalizeToken(tokenSource);
  if (!safeToken) throw new Error("No Telegram bot token available");

  const safeWebhookUrl = normalizeChannelText(input.webhookUrl, 2048);
  if (!safeWebhookUrl.startsWith("https://")) {
    throw new Error("Invalid Telegram webhook URL");
  }

  const secret = normalizeSecret(input.secretToken);
  const bot = getBotInstance(safeToken);

  await bot.api.setWebhook(safeWebhookUrl, secret ? { secret_token: secret } : undefined);
}
