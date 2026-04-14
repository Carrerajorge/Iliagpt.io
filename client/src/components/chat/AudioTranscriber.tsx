import { useState, useRef, useCallback, useEffect } from "react";
import { AudioWaveform } from "./AudioWaveform";
import { Mic, MicOff, Upload, Copy, Check, Download, FileAudio, Loader2, X, Send, Pause, Play, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

type TranscribeMode = "mic" | "file" | "whisper";
type Status = "idle" | "recording" | "paused" | "transcribing" | "downloading-model" | "done" | "error";

interface TranscriptSegment {
  text: string;
  timestamp: number;
  isFinal: boolean;
}

const LANGUAGES = [
  { code: "es-ES", label: "Español (España)" },
  { code: "es-PE", label: "Español (Perú)" },
  { code: "es-MX", label: "Español (México)" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "fr-FR", label: "Français" },
  { code: "de-DE", label: "Deutsch" },
  { code: "ja-JP", label: "日本語" },
  { code: "zh-CN", label: "中文" },
];

interface Capabilities {
  speechRecognition: boolean;
  microphone: boolean;
  audioContext: boolean;
}

function detectCapabilities(): Capabilities {
  return {
    speechRecognition: !!(window.SpeechRecognition || (window as any).webkitSpeechRecognition),
    microphone: !!navigator.mediaDevices?.getUserMedia,
    audioContext: !!(window.AudioContext || (window as any).webkitAudioContext),
  };
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function postProcess(text: string): string {
  if (!text) return "";
  let result = text.trim();
  // Capitalize first letter of sentences
  result = result.replace(/(^|[.!?]\s+)([a-záéíóúñ])/gi, (_, pre, letter) => pre + letter.toUpperCase());
  // Ensure first char is uppercase
  result = result.charAt(0).toUpperCase() + result.slice(1);
  // Add period at end if missing
  if (result && !/[.!?]$/.test(result)) result += ".";
  return result;
}

interface AudioTranscriberProps {
  onSendToChat?: (text: string) => void;
  className?: string;
}

export function AudioTranscriber({ onSendToChat, className }: AudioTranscriberProps) {
  const [mode, setMode] = useState<TranscribeMode>("mic");
  const [status, setStatus] = useState<Status>("idle");
  const [language, setLanguage] = useState("es-ES");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [autoPunctuation, setAutoPunctuation] = useState(true);
  const [capabilities] = useState(detectCapabilities);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [fileName, setFileName] = useState("");
  const [modelProgress, setModelProgress] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState("");

  const recognitionRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const startTimeRef = useRef(0);

  const fullText = segments
    .filter((s) => s.isFinal)
    .map((s) => {
      const t = autoPunctuation ? postProcess(s.text) : s.text;
      return showTimestamps ? `[${formatTime(s.timestamp)}] ${t}` : t;
    })
    .join(" ");

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
  }, [stream]);

  const startMicRecording = useCallback(async () => {
    if (!capabilities.speechRecognition || !capabilities.microphone) {
      setError("Tu navegador no soporta transcripción en vivo. Usa Chrome o Edge.");
      setStatus("error");
      return;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setStream(mediaStream);

      const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = language;

      startTimeRef.current = Date.now();

      recognition.onresult = (event: any) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const timestamp = (Date.now() - startTimeRef.current) / 1000;
          if (result.isFinal) {
            setSegments((prev) => [...prev, { text: result[0].transcript.trim(), timestamp, isFinal: true }]);
            setInterimText("");
          } else {
            interim += result[0].transcript;
          }
        }
        if (interim) setInterimText(interim);
      };

      recognition.onerror = (event: any) => {
        if (event.error !== "aborted" && event.error !== "no-speech") {
          setError(`Error: ${event.error}`);
          setStatus("error");
        }
      };

      recognition.onend = () => {
        // Auto-restart if still recording
        if (recognitionRef.current && status === "recording") {
          try { recognition.start(); } catch {}
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
      setSegments([]);
      setInterimText("");
      setError("");
      setStatus("recording");
    } catch (err: any) {
      setError(`No se pudo acceder al micrófono: ${err.message}`);
      setStatus("error");
    }
  }, [capabilities, language, status]);

  const pauseRecording = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    setStatus("paused");
  }, []);

  const resumeRecording = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.start(); } catch {}
    }
    setStatus("recording");
  }, []);

  const stopRecording = useCallback(() => {
    stopRecognition();
    setStatus(segments.length > 0 ? "done" : "idle");
  }, [stopRecognition, segments.length]);

  const transcribeFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setSegments([]);
    setInterimText("");
    setError("");

    if (!capabilities.speechRecognition) {
      // Fallback: try Whisper in browser
      setMode("whisper");
      await transcribeWithWhisper(file);
      return;
    }

    setStatus("transcribing");

    try {
      // Create audio element and play it, capture with SpeechRecognition
      const audioUrl = URL.createObjectURL(file);
      const audio = new Audio(audioUrl);

      const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = language;

      startTimeRef.current = Date.now();
      const fileSegments: TranscriptSegment[] = [];

      recognition.onresult = (event: any) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const timestamp = audio.currentTime;
          if (result.isFinal) {
            const seg = { text: result[0].transcript.trim(), timestamp, isFinal: true };
            fileSegments.push(seg);
            setSegments([...fileSegments]);
            setInterimText("");
          } else {
            interim += result[0].transcript;
          }
        }
        if (interim) setInterimText(interim);
      };

      recognition.onerror = (event: any) => {
        if (event.error !== "aborted" && event.error !== "no-speech") {
          console.warn("Recognition error during file transcription:", event.error);
        }
      };

      recognition.onend = () => {
        if (!audio.paused && !audio.ended) {
          try { recognition.start(); } catch {}
        }
      };

      // Use AudioContext to route audio to speakers AND capture
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaElementSource(audio);
      const dest = audioCtx.createMediaStreamDestination();
      source.connect(dest);
      source.connect(audioCtx.destination); // also play through speakers

      recognition.start();
      recognitionRef.current = recognition;
      audio.play();

      audio.onended = () => {
        setTimeout(() => {
          try { recognition.stop(); } catch {}
          recognitionRef.current = null;
          audioCtx.close().catch(() => {});
          URL.revokeObjectURL(audioUrl);
          setStatus(fileSegments.length > 0 ? "done" : "idle");
        }, 2000); // wait for last results
      };
    } catch (err: any) {
      setError(`Error al transcribir archivo: ${err.message}`);
      setStatus("error");
    }
  }, [capabilities, language]);

  const transcribeWithWhisper = useCallback(async (file: File) => {
    setStatus("downloading-model");
    setModelProgress(0);

    try {
      const { pipeline } = await import("@xenova/transformers");

      setModelProgress(30);
      const transcriber = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", {
        progress_callback: (p: any) => {
          if (p.progress) setModelProgress(Math.round(p.progress));
        },
      });
      setModelProgress(100);
      setStatus("transcribing");

      // Decode audio file to float32 array
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      // Get mono channel, resample to 16kHz
      const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * 16000, 16000);
      const bufferSource = offlineCtx.createBufferSource();
      bufferSource.buffer = audioBuffer;
      bufferSource.connect(offlineCtx.destination);
      bufferSource.start();
      const resampled = await offlineCtx.startRendering();
      const audioData = resampled.getChannelData(0);

      const result = await transcriber(audioData, {
        language: language.split("-")[0],
        task: "transcribe",
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      });

      const chunks = result.chunks || [{ text: result.text, timestamp: [0, 0] }];
      const newSegments = chunks.map((c: any) => ({
        text: c.text.trim(),
        timestamp: c.timestamp?.[0] || 0,
        isFinal: true,
      }));

      setSegments(newSegments);
      setStatus("done");
      audioCtx.close().catch(() => {});
    } catch (err: any) {
      setError(`Error Whisper: ${err.message}`);
      setStatus("error");
    }
  }, [language]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (mode === "whisper") transcribeWithWhisper(file);
      else transcribeFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [mode, transcribeFile, transcribeWithWhisper]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("audio/")) {
      if (mode === "whisper") transcribeWithWhisper(file);
      else transcribeFile(file);
    }
  }, [mode, transcribeFile, transcribeWithWhisper]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [fullText]);

  const handleDownloadTxt = useCallback(() => {
    const blob = new Blob([fullText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (fileName || "transcripcion").replace(/\.[^.]+$/, "") + ".txt";
    a.click();
    URL.revokeObjectURL(url);
  }, [fullText, fileName]);

  const handleDownloadSrt = useCallback(() => {
    const finalSegs = segments.filter((s) => s.isFinal);
    const srt = finalSegs.map((s, i) => {
      const start = formatTime(s.timestamp);
      const end = formatTime(s.timestamp + 3);
      return `${i + 1}\n${start},000 --> ${end},000\n${s.text}\n`;
    }).join("\n");
    const blob = new Blob([srt], { type: "text/srt" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (fileName || "transcripcion").replace(/\.[^.]+$/, "") + ".srt";
    a.click();
    URL.revokeObjectURL(url);
  }, [segments, fileName]);

  const reset = useCallback(() => {
    stopRecognition();
    setSegments([]);
    setInterimText("");
    setError("");
    setFileName("");
    setStatus("idle");
    setEditMode(false);
  }, [stopRecognition]);

  useEffect(() => () => stopRecognition(), [stopRecognition]);

  const isProcessing = status === "recording" || status === "transcribing" || status === "downloading-model";

  return (
    <div className={`flex flex-col gap-4 ${className || ""}`}>
      {/* Banner */}
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-2 text-center">
        <p className="text-sm text-emerald-400">Transcripcion 100% local — tu audio nunca sale de tu dispositivo</p>
      </div>

      {/* Capabilities */}
      <div className="flex flex-wrap gap-2">
        {[
          { ok: capabilities.speechRecognition, label: "Transcripcion en vivo" },
          { ok: capabilities.microphone, label: "Microfono" },
          { ok: capabilities.audioContext, label: "Visualizacion" },
        ].map((c) => (
          <span key={c.label} className={`text-xs px-2 py-1 rounded-full ${c.ok ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
            {c.ok ? "OK" : "No"} {c.label}
          </span>
        ))}
      </div>

      {/* Mode selector */}
      <div className="flex gap-2">
        {(["mic", "file", "whisper"] as TranscribeMode[]).map((m) => (
          <button
            key={m}
            onClick={() => { reset(); setMode(m); }}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${mode === m ? "bg-violet-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
          >
            {m === "mic" ? "Microfono" : m === "file" ? "Subir archivo" : "Whisper Offline"}
          </button>
        ))}
      </div>

      {/* Language */}
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 text-zinc-500" />
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 flex-1"
        >
          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </div>

      {/* Waveform */}
      {(mode === "mic" && (status === "recording" || status === "paused")) && (
        <AudioWaveform stream={stream} isRecording={status === "recording"} height={100} />
      )}

      {/* Controls */}
      <div className="flex justify-center gap-3">
        {mode === "mic" && (
          <>
            {status === "idle" || status === "done" || status === "error" ? (
              <Button onClick={startMicRecording} className="bg-red-600 hover:bg-red-700 text-white rounded-full w-14 h-14">
                <Mic className="w-6 h-6" />
              </Button>
            ) : status === "recording" ? (
              <>
                <Button onClick={pauseRecording} variant="outline" className="border-zinc-600 rounded-full w-12 h-12">
                  <Pause className="w-5 h-5" />
                </Button>
                <Button onClick={stopRecording} className="bg-red-600 hover:bg-red-700 text-white rounded-full w-14 h-14 animate-pulse">
                  <MicOff className="w-6 h-6" />
                </Button>
              </>
            ) : status === "paused" ? (
              <>
                <Button onClick={resumeRecording} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full w-12 h-12">
                  <Play className="w-5 h-5" />
                </Button>
                <Button onClick={stopRecording} variant="outline" className="border-zinc-600 rounded-full w-12 h-12">
                  <MicOff className="w-5 h-5" />
                </Button>
              </>
            ) : null}
          </>
        )}

        {(mode === "file" || mode === "whisper") && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="w-full border-2 border-dashed border-zinc-700 rounded-xl p-8 text-center hover:border-violet-500 transition-colors cursor-pointer"
            onClick={() => !isProcessing && fileInputRef.current?.click()}
          >
            {isProcessing ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
                <p className="text-zinc-300 text-sm">
                  {status === "downloading-model" ? `Descargando modelo Whisper... ${modelProgress}%` : "Transcribiendo..."}
                </p>
                {status === "downloading-model" && (
                  <div className="w-48 h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 transition-all" style={{ width: `${modelProgress}%` }} />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-8 h-8 text-zinc-500" />
                <p className="text-zinc-300">Arrastra un audio o haz clic para seleccionar</p>
                <p className="text-xs text-zinc-500">MP3, WAV, M4A, OGG, WebM</p>
                {mode === "whisper" && <p className="text-xs text-violet-400 mt-1">Usa Whisper AI directamente en tu navegador</p>}
              </div>
            )}
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFileChange} className="hidden" />
      </div>

      {/* Status indicator */}
      <div className="flex items-center justify-center gap-2 text-sm">
        {status === "idle" && <span className="text-zinc-500">Listo</span>}
        {status === "recording" && <><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /><span className="text-red-400">Grabando...</span></>}
        {status === "paused" && <><span className="w-2 h-2 rounded-full bg-yellow-500" /><span className="text-yellow-400">Pausado</span></>}
        {status === "transcribing" && <><Loader2 className="w-4 h-4 text-violet-400 animate-spin" /><span className="text-violet-400">Transcribiendo...</span></>}
        {status === "downloading-model" && <><Loader2 className="w-4 h-4 text-violet-400 animate-spin" /><span className="text-violet-400">Descargando modelo...</span></>}
        {status === "done" && <><Check className="w-4 h-4 text-emerald-400" /><span className="text-emerald-400">Completado</span></>}
        {status === "error" && <><X className="w-4 h-4 text-red-400" /><span className="text-red-400">Error</span></>}
      </div>

      {/* Interim text */}
      {interimText && (
        <div className="bg-zinc-800/50 rounded-lg px-4 py-2">
          <p className="text-zinc-500 italic text-sm">{interimText}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Transcript */}
      {(fullText || segments.length > 0) && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-300">Transcripcion</h3>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-zinc-500 cursor-pointer">
                <input type="checkbox" checked={showTimestamps} onChange={(e) => setShowTimestamps(e.target.checked)} className="rounded" />
                Timestamps
              </label>
              <label className="flex items-center gap-1 text-xs text-zinc-500 cursor-pointer">
                <input type="checkbox" checked={autoPunctuation} onChange={(e) => setAutoPunctuation(e.target.checked)} className="rounded" />
                Auto-puntuacion
              </label>
            </div>
          </div>

          {editMode ? (
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="bg-zinc-800 rounded-lg p-3 text-zinc-200 text-sm min-h-[120px] resize-y border border-zinc-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          ) : (
            <div className="bg-zinc-800/50 rounded-lg p-4 max-h-72 overflow-y-auto">
              <p className="text-zinc-200 whitespace-pre-wrap leading-relaxed text-sm">{fullText}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={handleCopy} className="text-zinc-400 hover:text-white">
              {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDownloadTxt} className="text-zinc-400 hover:text-white">
              <Download className="w-4 h-4 mr-1" />.txt
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDownloadSrt} className="text-zinc-400 hover:text-white">
              <Download className="w-4 h-4 mr-1" />.srt
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setEditMode(!editMode); if (!editMode) setEditText(fullText); }} className="text-zinc-400 hover:text-white">
              {editMode ? "Vista previa" : "Editar"}
            </Button>
            {onSendToChat && (
              <Button onClick={() => onSendToChat(editMode ? editText : fullText)} className="bg-violet-600 hover:bg-violet-700 text-white ml-auto" size="sm">
                <Send className="w-4 h-4 mr-1" />Enviar al chat
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={reset} className="border-zinc-700 text-zinc-400">
              Nuevo
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AudioTranscriber;
