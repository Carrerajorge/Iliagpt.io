/**
 * Voice & Audio Router
 *
 * REST API for TTS, STT, recording, and voice session management.
 */

import { Router, type Request, type Response } from "express";
import { ttsService, sttService, audioRecorder, listAvailableVoices, type TTSProvider } from "../services/voiceAudioService";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import multer from "multer";

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max (Whisper API limit)
});

export function createVoiceRouter(): Router {
  const router = Router();

  // ── TTS: Text to Speech ──────────────────────────────────────────

  router.post("/tts", async (req: Request, res: Response) => {
    try {
      const { text, provider, voice, speed, model, format, elevenLabsVoiceId } = req.body;

      if (!text) {
        return res.status(400).json({ success: false, error: "text is required" });
      }

      const result = await ttsService.synthesize(text, {
        provider: provider || "system",
        voice,
        speed,
        model,
        format: format || "mp3",
        elevenLabsVoiceId,
      });

      if (!result.success) {
        return res.status(500).json({ success: false, error: result.error });
      }

      // Return audio file
      const audioBuffer = await fs.readFile(result.audioPath);
      const mimeMap: Record<string, string> = {
        mp3: "audio/mpeg",
        wav: "audio/wav",
        aac: "audio/aac",
        opus: "audio/opus",
        aiff: "audio/aiff",
      };

      res.set("Content-Type", mimeMap[result.format] || "audio/mpeg");
      res.set("Content-Disposition", `attachment; filename="speech.${result.format}"`);
      res.send(audioBuffer);

      // Cleanup
      fs.unlink(result.audioPath).catch(() => {});
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── TTS: Get as JSON with base64 ─────────────────────────────────

  router.post("/tts/json", async (req: Request, res: Response) => {
    try {
      const { text, provider, voice, speed, model, format, elevenLabsVoiceId } = req.body;

      if (!text) {
        return res.status(400).json({ success: false, error: "text is required" });
      }

      const result = await ttsService.synthesize(text, {
        provider: provider || "system",
        voice,
        speed,
        model,
        format: format || "mp3",
        elevenLabsVoiceId,
      });

      if (!result.success) {
        return res.status(500).json({ success: false, error: result.error });
      }

      const audioBuffer = await fs.readFile(result.audioPath);
      const base64 = audioBuffer.toString("base64");

      res.json({
        success: true,
        format: result.format,
        base64,
        size: audioBuffer.length,
      });

      fs.unlink(result.audioPath).catch(() => {});
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── STT: Speech to Text ──────────────────────────────────────────

  router.post("/stt", upload.single("audio"), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ success: false, error: "audio file required (form field: 'audio')" });
      }

      const { provider, language, prompt, model, temperature } = req.body;

      const result = await sttService.transcribe(file.path, {
        provider: provider || "whisper_api",
        language,
        prompt,
        model,
        temperature: temperature ? parseFloat(temperature) : undefined,
      });

      // Cleanup uploaded file
      fs.unlink(file.path).catch(() => {});

      res.json({
        success: result.success,
        text: result.text,
        language: result.language,
        durationMs: result.durationMs,
        segments: result.segments,
        error: result.error,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── STT from URL or base64 ──────────────────────────────────────

  router.post("/stt/inline", async (req: Request, res: Response) => {
    try {
      const { base64, url, provider, language, prompt } = req.body;

      let audioPath: string;

      if (base64) {
        audioPath = path.join(os.tmpdir(), `iliagpt-stt-${Date.now()}.mp3`);
        const buffer = Buffer.from(base64, "base64");
        await fs.writeFile(audioPath, buffer);
      } else if (url) {
        audioPath = path.join(os.tmpdir(), `iliagpt-stt-${Date.now()}.mp3`);
        const response = await fetch(url);
        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(audioPath, buffer);
      } else {
        return res.status(400).json({ success: false, error: "base64 or url required" });
      }

      const result = await sttService.transcribe(audioPath, {
        provider: provider || "whisper_api",
        language,
        prompt,
      });

      fs.unlink(audioPath).catch(() => {});

      res.json({
        success: result.success,
        text: result.text,
        language: result.language,
        segments: result.segments,
        error: result.error,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── List voices ──────────────────────────────────────────────────

  router.get("/voices", async (req: Request, res: Response) => {
    const provider = (req.query.provider as TTSProvider) || "system";
    const voices = await listAvailableVoices(provider);
    res.json({ success: true, provider, voices, count: voices.length });
  });

  // ── Recording ────────────────────────────────────────────────────

  router.post("/record/start", async (_req: Request, res: Response) => {
    try {
      const filePath = await audioRecorder.startRecording();
      res.json({ success: true, path: filePath });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post("/record/stop", async (_req: Request, res: Response) => {
    try {
      await audioRecorder.stopRecording();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
