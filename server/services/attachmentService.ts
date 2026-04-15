import { ObjectStorageService, ObjectNotFoundError } from "../replit_integrations/object_storage/objectStorage";
import { PdfParser } from "../parsers/pdfParser";
import { DocxParser } from "../parsers/docxParser";
import { XlsxParser } from "../parsers/xlsxParser";
import { PptxParser } from "../parsers/pptxParser";
import { TextParser } from "../parsers/textParser";
import type { DetectedFileType } from "../parsers/base";
import { sttService } from "./voiceAudioService";
import { transcribeLocally } from "./localWhisperService";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

export interface Attachment {
  type: string;
  name: string;
  mimeType: string;
  storagePath: string;
  fileId?: string;
}

export interface ExtractedContent {
  fileName: string;
  content: string;
  mimeType: string;
  documentType?: string;
  metadata?: Record<string, any>;
}

const objectStorageService = new ObjectStorageService();

const pdfParser = new PdfParser();
const docxParser = new DocxParser();
const xlsxParser = new XlsxParser();
const pptxParser = new PptxParser();
const textParser = new TextParser();

const MIME_TYPE_MAP: Record<string, { parser: any; docType: string; ext: string }> = {
  "application/pdf": { parser: pdfParser, docType: "PDF", ext: "pdf" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { parser: docxParser, docType: "Word", ext: "docx" },
  "application/msword": { parser: docxParser, docType: "Word", ext: "doc" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { parser: xlsxParser, docType: "Excel", ext: "xlsx" },
  "application/vnd.ms-excel": { parser: xlsxParser, docType: "Excel", ext: "xls" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { parser: pptxParser, docType: "PowerPoint", ext: "pptx" },
  "application/vnd.ms-powerpoint": { parser: pptxParser, docType: "PowerPoint", ext: "ppt" },
  "text/plain": { parser: textParser, docType: "Text", ext: "txt" },
  "text/markdown": { parser: textParser, docType: "Markdown", ext: "md" },
  "text/md": { parser: textParser, docType: "Markdown", ext: "md" },
  "text/csv": { parser: textParser, docType: "CSV", ext: "csv" },
  "text/html": { parser: textParser, docType: "HTML", ext: "html" },
  "application/json": { parser: textParser, docType: "JSON", ext: "json" },
};

const AUDIO_MIME_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav",
  "audio/ogg", "audio/webm", "audio/flac", "audio/aac", "audio/mp4",
  "audio/x-m4a", "audio/m4a", "audio/opus", "audio/amr", "audio/x-ms-wma",
  "application/ogg", "video/ogg",
]);

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "ogg", "flac", "webm", "aac", "opus"]);

function isAudioFile(mimeType: string, fileName: string): boolean {
  if (AUDIO_MIME_TYPES.has(mimeType)) return true;
  if (mimeType?.startsWith("audio/")) return true;
  const ext = getExtensionFromFileName(fileName);
  return AUDIO_EXTENSIONS.has(ext);
}

/**
 * Transcribe using Groq Whisper API (most accurate, free tier available).
 * https://console.groq.com — free key, whisper-large-v3-turbo model.
 */
async function transcribeWithGroqWhisper(buffer: Buffer, fileName: string): Promise<{ success: boolean; text: string; error?: string }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { success: false, text: "", error: "GROQ_API_KEY not set" };

  try {
    const formData = new FormData();
    formData.append("file", new Blob([buffer]), fileName);
    formData.append("model", "whisper-large-v3-turbo");
    formData.append("response_format", "verbose_json");
    // Don't force language — let Whisper auto-detect for best accuracy

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const err = await response.text();
      return { success: false, text: "", error: `Groq Whisper error ${response.status}: ${err.slice(0, 200)}` };
    }

    const data = await response.json() as any;
    const text = (data.text || "").trim();
    console.log(`[AudioTranscribe] Groq Whisper success: ${text.length} chars, lang=${data.language}, duration=${data.duration}s`);
    return { success: !!text, text, error: text ? undefined : "Empty transcription" };
  } catch (err: any) {
    return { success: false, text: "", error: `Groq Whisper: ${err.message}` };
  }
}

/**
 * Transcribe audio using the best available provider.
 * Priority: Groq Whisper → Gemini direct → OpenRouter → XAI
 */
async function transcribeWithLLM(buffer: Buffer, fileName: string, mimeType: string): Promise<{ success: boolean; text: string; error?: string }> {
  const audioBase64 = buffer.toString("base64");
  const normalizedMime = mimeType.startsWith("audio/") ? mimeType
    : (mimeType === "application/ogg" || mimeType === "video/ogg") ? "audio/ogg"
    : "audio/ogg";
  const dataUri = `data:${normalizedMime};base64,${audioBase64}`;

  // 0a) Local Whisper — runs on your machine, no API keys, high accuracy
  try {
    console.log(`[AudioTranscribe] Trying local Whisper (no API key needed)...`);
    const localResult = await transcribeLocally(buffer, fileName);
    if (localResult.success && localResult.text && localResult.text.length > 3) {
      console.log(`[AudioTranscribe] Local Whisper success: ${localResult.text.length} chars`);
      return { success: true, text: localResult.text };
    }
    if (localResult.error) console.log(`[AudioTranscribe] Local Whisper failed: ${localResult.error}`);
  } catch (err: any) {
    console.log(`[AudioTranscribe] Local Whisper unavailable: ${err.message}`);
  }

  // 0b) Groq Whisper — cloud STT, free tier, very accurate
  const groqResult = await transcribeWithGroqWhisper(buffer, fileName);
  if (groqResult.success && groqResult.text) return groqResult;

  const transcriptionPrompt = "Eres un transcriptor de audio profesional. Transcribe este audio de forma exacta, palabra por palabra, tal como se habla. Devuelve ÚNICAMENTE el texto transcrito. Sin etiquetas, sin comillas, sin formato markdown, sin explicaciones. Preserva el idioma original del hablante.";

  const errors: string[] = [];

  // 1) OpenRouter with Gemini 2.5 Flash (best multimodal audio support)
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    const models = ["google/gemini-2.5-flash", "google/gemini-2.0-flash-001", "google/gemini-2.0-flash-exp:free"];
    for (const model of models) {
      try {
        console.log(`[AudioTranscribe] Trying OpenRouter model: ${model}`);
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openRouterKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.BASE_URL || "http://localhost:5050",
            "X-Title": "IliaGPT Audio Transcription",
          },
          body: JSON.stringify({
            model,
            messages: [{
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: dataUri },
                },
                {
                  type: "text",
                  text: transcriptionPrompt,
                },
              ],
            }],
            temperature: 0.0,
            max_tokens: 16384,
          }),
        });

        if (response.ok) {
          const data = await response.json() as any;
          const text = data?.choices?.[0]?.message?.content?.trim() || "";
          if (text && text.length > 3) {
            console.log(`[AudioTranscribe] Success with ${model}: ${text.length} chars`);
            return { success: true, text };
          }
        }
        const errBody = await response.text().catch(() => "");
        console.log(`[AudioTranscribe] ${model} failed (${response.status}): ${errBody.slice(0, 200)}`);
        errors.push(`${model}: ${response.status}`);
      } catch (err: any) {
        console.log(`[AudioTranscribe] ${model} error: ${err.message}`);
        errors.push(`${model}: ${err.message}`);
      }
    }
  }

  // 2) Gemini direct API
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      console.log(`[AudioTranscribe] Trying Gemini direct API`);
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: normalizedMime, data: audioBase64 } },
                { text: transcriptionPrompt },
              ],
            }],
            generationConfig: { temperature: 0.0, maxOutputTokens: 16384 },
          }),
        }
      );
      if (response.ok) {
        const data = await response.json() as any;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
        if (text && text.length > 3) {
          console.log(`[AudioTranscribe] Gemini direct success: ${text.length} chars`);
          return { success: true, text };
        }
      }
      const err = await response.text().catch(() => "");
      errors.push(`gemini-direct: ${err.slice(0, 100)}`);
    } catch (err: any) {
      errors.push(`gemini-direct: ${err.message}`);
    }
  }

  // 3) XAI Grok (supports audio via data URI)
  const xaiKey = process.env.XAI_API_KEY;
  if (xaiKey) {
    try {
      console.log(`[AudioTranscribe] Trying XAI Grok`);
      const response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${xaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "grok-2-vision",
          messages: [{
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUri } },
              { type: "text", text: transcriptionPrompt },
            ],
          }],
          temperature: 0.0,
        }),
      });
      if (response.ok) {
        const data = await response.json() as any;
        const text = data?.choices?.[0]?.message?.content?.trim() || "";
        if (text && text.length > 3) {
          console.log(`[AudioTranscribe] XAI Grok success: ${text.length} chars`);
          return { success: true, text };
        }
      }
    } catch {}
  }

  console.error(`[AudioTranscribe] All providers failed:`, errors);
  return { success: false, text: "", error: `Transcripción fallida. Errores: ${errors.join("; ")}. Renueva tu GEMINI_API_KEY en https://aistudio.google.com/apikey` };
}

async function transcribeAudioBuffer(buffer: Buffer, fileName: string): Promise<ExtractedContent | null> {
  const ext = getExtensionFromFileName(fileName);
  const mimeGuess = ext === "ogg" ? "audio/ogg" : ext === "mp3" ? "audio/mpeg" : ext === "wav" ? "audio/wav" : ext === "m4a" ? "audio/mp4" : `audio/${ext}`;

  // Try LLM-based transcription (OpenRouter → Gemini → XAI)
  console.log(`[AttachmentService] Attempting LLM transcription for: ${fileName}`);
  const llmResult = await transcribeWithLLM(buffer, fileName, mimeGuess);

  if (llmResult.success && llmResult.text) {
    return {
      fileName,
      content: `[Transcripción de audio: ${fileName}]\n\n${llmResult.text}`,
      mimeType: "audio/transcription",
      documentType: "Audio",
      metadata: { provider: "llm" },
    };
  }

  // Fallback to Whisper API if available
  const openaiKey = process.env.OPENAI_API_KEY;
  const isRealOpenAIKey = openaiKey && openaiKey.startsWith("sk-") && !openaiKey.startsWith("sk-or-");

  if (isRealOpenAIKey) {
    const tmpPath = path.join(os.tmpdir(), `iliagpt-stt-${Date.now()}-${fileName}`);
    try {
      await fs.writeFile(tmpPath, buffer);
      const result = await sttService.transcribe(tmpPath, { provider: "whisper_api", format: "verbose_json" });
      if (result.success && result.text) {
        const durationInfo = result.durationMs ? ` (duración: ${Math.round(result.durationMs / 1000)}s)` : "";
        return {
          fileName,
          content: `[Transcripción de audio${durationInfo}]\n\n${result.text}`,
          mimeType: "audio/transcription",
          documentType: "Audio",
          metadata: { durationMs: result.durationMs, language: result.language, provider: "whisper" },
        };
      }
    } catch {} finally {
      fs.unlink(tmpPath).catch(() => {});
    }
  }

  const errorMsg = llmResult.error || "No se pudo transcribir con los proveedores disponibles";
  console.log(`[AttachmentService] Audio transcription failed for ${fileName}: ${errorMsg}`);
  return {
    fileName,
    content: `[Archivo de audio: ${fileName} — Error: ${errorMsg}]`,
    mimeType: "audio/transcription",
    documentType: "Audio",
  };
}

function getExtensionFromFileName(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

function inferMimeTypeFromExtension(ext: string): string | null {
  const extMap: Record<string, string> = {
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'doc': 'application/msword',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xls': 'application/vnd.ms-excel',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'ppt': 'application/vnd.ms-powerpoint',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'markdown': 'text/markdown',
    'csv': 'text/csv',
    'html': 'text/html',
    'htm': 'text/html',
    'json': 'application/json',
  };
  return extMap[ext] || null;
}

/**
 * Resolve the raw buffer for an attachment. Tries local disk first
 * (`uploads/` directory based on storagePath), then falls back to
 * the object-storage service used in cloud/Replit environments.
 */
async function resolveAttachmentBuffer(storagePath: string): Promise<Buffer> {
  // storagePath looks like "/objects/uploads/UUID.ext"
  const localFileName = storagePath.replace(/^\/objects\/uploads\//, "");
  const localPath = path.join(process.cwd(), "uploads", localFileName);
  try {
    await fs.access(localPath);
    return await fs.readFile(localPath);
  } catch {
    // Fallback to cloud object storage
    return objectStorageService.getObjectEntityBuffer(storagePath);
  }
}

export async function extractAttachmentContent(attachment: Attachment): Promise<ExtractedContent | null> {
  try {
    if (!attachment.storagePath) {
      console.log(`[AttachmentService] No storage path for attachment: ${attachment.name}`);
      return null;
    }

    let mimeType = attachment.mimeType;
    const ext = getExtensionFromFileName(attachment.name);

    // Handle audio files — transcribe via STT service (resolve buffer separately)
    if (isAudioFile(mimeType, attachment.name)) {
      try {
        const audioBuffer = await resolveAttachmentBuffer(attachment.storagePath);
        console.log(`[AttachmentService] Transcribing audio file: ${attachment.name} (${mimeType}, ${audioBuffer.length} bytes)`);
        return transcribeAudioBuffer(audioBuffer, attachment.name);
      } catch (err: any) {
        console.error(`[AttachmentService] Failed to read audio file: ${attachment.name}:`, err.message);
        return {
          fileName: attachment.name,
          content: `[Archivo de audio: ${attachment.name} — No se pudo leer el archivo para transcripción]`,
          mimeType: "audio/transcription",
          documentType: "Audio",
        };
      }
    }

    const buffer = await resolveAttachmentBuffer(attachment.storagePath);

    if (!MIME_TYPE_MAP[mimeType] && ext) {
      const inferredMime = inferMimeTypeFromExtension(ext);
      if (inferredMime) {
        console.log(`[AttachmentService] Inferred MIME type from extension: ${ext} -> ${inferredMime}`);
        mimeType = inferredMime;
      }
    }
    
    if (mimeType?.startsWith('text/') && !MIME_TYPE_MAP[mimeType]) {
      mimeType = 'text/plain';
    }

    const parserConfig = MIME_TYPE_MAP[mimeType];
    
    if (parserConfig) {
      console.log(`[AttachmentService] Parsing ${parserConfig.docType}: ${attachment.name}, size: ${buffer.length} bytes`);
      
      const detectedType: DetectedFileType = {
        mimeType: mimeType,
        extension: ext || parserConfig.ext,
        confidence: 1.0
      };
      
      const result = await parserConfig.parser.parse(buffer, detectedType);
      
      return {
        fileName: attachment.name,
        content: result.text,
        mimeType: mimeType,
        documentType: parserConfig.docType,
        metadata: result.metadata
      };
    }
    
    if (mimeType?.startsWith("text/") || mimeType === "application/octet-stream") {
      try {
        const textContent = buffer.toString("utf-8");
        if (textContent && !textContent.includes('\ufffd')) {
          console.log(`[AttachmentService] Fallback text extraction for: ${attachment.name}`);
          return {
            fileName: attachment.name,
            content: textContent,
            mimeType: mimeType,
            documentType: "Text"
          };
        }
      } catch (e) {
        console.log(`[AttachmentService] Could not decode as text: ${attachment.name}`);
      }
    }
    
    console.log(`[AttachmentService] Unsupported MIME type: ${mimeType} for file: ${attachment.name}`);
    return null;
  } catch (error) {
    console.error(`[AttachmentService] Error extracting content from ${attachment.name}:`, error);
    if (error instanceof ObjectNotFoundError) {
      console.log(`[AttachmentService] File not found: ${attachment.storagePath}`);
    }
    return null;
  }
}

export async function extractAllAttachmentsContent(attachments: Attachment[]): Promise<ExtractedContent[]> {
  const results: ExtractedContent[] = [];
  
  for (const attachment of attachments) {
    const content = await extractAttachmentContent(attachment);
    if (content) {
      results.push(content);
    }
  }
  
  return results;
}

export function formatAttachmentsAsContext(extractedContents: ExtractedContent[]): string {
  if (extractedContents.length === 0) return "";
  
  const parts: string[] = [];
  parts.push("\n\n=== DOCUMENTOS ADJUNTOS ===\n");
  
  for (const content of extractedContents) {
    const typeLabel = content.documentType ? ` (${content.documentType})` : '';
    parts.push(`\n--- Archivo: ${content.fileName}${typeLabel} ---\n`);
    parts.push(content.content);
    parts.push("\n--- Fin del archivo ---\n");
  }
  
  return parts.join("");
}

export function getSupportedMimeTypes(): string[] {
  return Object.keys(MIME_TYPE_MAP);
}

export function isSupportedMimeType(mimeType: string): boolean {
  if (MIME_TYPE_MAP[mimeType]) return true;
  if (mimeType?.startsWith('text/')) return true;
  if (mimeType?.startsWith('audio/')) return true;
  return false;
}
