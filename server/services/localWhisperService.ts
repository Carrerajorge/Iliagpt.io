/**
 * Local Whisper Transcription Service
 *
 * Uses @huggingface/transformers to run Whisper locally on the machine.
 * No API keys needed. Falls back to ffmpeg + Whisper pipeline for OGG conversion.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const execFileAsync = promisify(execFile);

// Find ffmpeg in PATH or known locations
async function findFFmpeg(): Promise<string | null> {
  const candidates = [
    "ffmpeg",
    path.join(process.cwd(), "node_modules", ".bin", "ffmpeg"),
    "/usr/local/bin/ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
    path.join(os.homedir(), ".local", "node", "bin", "ffmpeg"),
  ];
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["-version"], { timeout: 3000 });
      return candidate;
    } catch {}
  }
  return null;
}

/**
 * Convert any audio file to 16kHz mono WAV (required by Whisper).
 */
async function convertToWav16k(inputPath: string): Promise<string> {
  const outputPath = inputPath.replace(/\.[^.]+$/, "") + "_16k.wav";
  const ffmpegPath = await findFFmpeg();
  if (!ffmpegPath) {
    throw new Error("ffmpeg not found — required for audio conversion");
  }

  await execFileAsync(ffmpegPath, [
    "-i", inputPath,
    "-ar", "16000",   // 16kHz sample rate
    "-ac", "1",       // Mono
    "-c:a", "pcm_s16le",  // 16-bit PCM
    "-y",             // Overwrite
    outputPath,
  ], { timeout: 120000 });

  return outputPath;
}

/**
 * Read a WAV file and return Float32Array of audio samples.
 */
async function readWavAsFloat32(wavPath: string): Promise<Float32Array> {
  const buffer = await fs.readFile(wavPath);
  // WAV header is 44 bytes, then PCM s16le data
  const dataOffset = 44;
  const pcmData = buffer.subarray(dataOffset);
  const samples = new Float32Array(pcmData.length / 2);
  for (let i = 0; i < samples.length; i++) {
    const val = pcmData.readInt16LE(i * 2);
    samples[i] = val / 32768.0; // normalize to [-1, 1]
  }
  return samples;
}

// Singleton pipeline (lazy loaded)
let pipelineInstance: any = null;
let pipelineLoading: Promise<any> | null = null;

async function getWhisperPipeline() {
  if (pipelineInstance) return pipelineInstance;
  if (pipelineLoading) return pipelineLoading;

  pipelineLoading = (async () => {
    console.log("[LocalWhisper] Loading Whisper model (first time may take a minute)...");
    const { pipeline } = await import("@huggingface/transformers");
    // Use whisper-small for good accuracy/speed balance
    // Options: whisper-tiny, whisper-base, whisper-small, whisper-medium
    pipelineInstance = await pipeline(
      "automatic-speech-recognition",
      "onnx-community/whisper-small",
      { dtype: "q4", device: "cpu" }
    );
    console.log("[LocalWhisper] Whisper model loaded successfully");
    return pipelineInstance;
  })();

  return pipelineLoading;
}

export interface LocalTranscriptionResult {
  success: boolean;
  text: string;
  language?: string;
  chunks?: Array<{ timestamp: [number, number]; text: string }>;
  error?: string;
}

/**
 * Transcribe an audio buffer locally using Whisper.
 * Handles any audio format (OGG, MP3, WAV, etc.) via ffmpeg conversion.
 */
export async function transcribeLocally(
  audioBuffer: Buffer,
  fileName: string,
): Promise<LocalTranscriptionResult> {
  const tmpDir = os.tmpdir();
  const ext = path.extname(fileName) || ".ogg";
  const inputPath = path.join(tmpDir, `iliagpt-local-stt-${Date.now()}${ext}`);
  let wavPath: string | null = null;

  try {
    // Write audio to temp file
    await fs.writeFile(inputPath, audioBuffer);

    // Convert to 16kHz WAV
    console.log(`[LocalWhisper] Converting ${fileName} to WAV 16kHz...`);
    wavPath = await convertToWav16k(inputPath);

    // Read WAV as float32 samples
    const audioData = await readWavAsFloat32(wavPath);
    console.log(`[LocalWhisper] Audio loaded: ${audioData.length} samples (${(audioData.length / 16000).toFixed(1)}s)`);

    // Get Whisper pipeline and transcribe
    const whisper = await getWhisperPipeline();
    const result = await whisper(audioData, {
      language: "es",
      task: "transcribe",
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    const text = (result.text || "").trim();
    console.log(`[LocalWhisper] Transcription complete: ${text.length} chars`);

    return {
      success: !!text,
      text,
      chunks: result.chunks,
    };
  } catch (err: any) {
    console.error(`[LocalWhisper] Error:`, err.message);
    return {
      success: false,
      text: "",
      error: err.message,
    };
  } finally {
    // Cleanup temp files
    fs.unlink(inputPath).catch(() => {});
    if (wavPath) fs.unlink(wavPath).catch(() => {});
  }
}
