import React, { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic, MicOff, Volume2, VolumeX, Loader2, Video, VideoOff, Upload, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { normalizeFileForUpload } from "@/lib/attachmentIngest";
import { apiFetch } from "@/lib/apiClient";
import { ensureCsrfToken, resolveUploadUrlForResponse, uploadBlobWithProgress } from "@/lib/uploadTransport";

const VOICE_UPLOAD_ALLOWED_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/bmp",
  "image/webp",
  "image/tiff",
]);

interface VoiceChatModeProps {
  open: boolean;
  onClose: () => void;
}

type InputMode = "idle" | "mic" | "camera" | "uploading";

export function VoiceChatMode({ open, onClose }: VoiceChatModeProps) {
  const [inputMode, setInputMode] = useState<InputMode>("idle");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const { settings } = useSettingsContext();
  const advancedVoiceEnabled = !!settings.advancedVoice;

  const speechLocale = useMemo(() => {
    const code = settings.spokenLanguage;
    if (!code || code === "auto") return navigator.language || "es-ES";
    if (code === "es") return "es-ES";
    if (code === "en") return "en-US";
    if (code === "fr") return "fr-FR";
    if (code === "de") return "de-DE";
    if (code === "pt") return "pt-PT";
    return navigator.language || "es-ES";
  }, [settings.spokenLanguage]);

  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<string>("");
  const interimTranscriptRef = useRef<string>("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const speechSynthesisRef = useRef<SpeechSynthesisUtterance | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Clean up on unmount or close
  useEffect(() => {
    if (!open) {
      stopListening();
      stopSpeaking();
      stopCamera();
      cleanupAudio();
      setTranscript("");
      transcriptRef.current = "";
      interimTranscriptRef.current = "";
      setResponse("");
      setError(null);
      setCameraError(null);
      setAudioLevel(0);
      setIsProcessing(false);
      setInputMode("idle");
    }
    return () => {
      stopListening();
      stopSpeaking();
      stopCamera();
      cleanupAudio();
    };
  }, [open]);

  // If advanced voice is disabled, make sure we don't keep advanced inputs active.
  useEffect(() => {
    if (!advancedVoiceEnabled) {
      if (isCameraActive) stopCamera();
      if (inputMode === "uploading") setInputMode("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advancedVoiceEnabled]);

  const cleanupAudio = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = "";
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => { });
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  };

  const startAudioAnalysis = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;

      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);

      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);

      const updateLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(average / 255);
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };

      updateLevel();
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setError("No se pudo acceder al micrófono");
    }
  };

  const sendAudioForTranscription = async (blob: Blob) => {
    setIsProcessing(true);
    setError(null);
    setTranscript("");

    try {
      const formData = new FormData();
      formData.append("audio", blob, "audio.webm");
      formData.append("language", speechLocale.split("-")[0]);

      await ensureCsrfToken();
      const res = await apiFetch("/api/voice/transcribe", {
        method: "POST",
        body: formData,
        headers: {}, // Do not set Content-Type header when using FormData with fetch
      });

      if (!res.ok) {
        throw new Error("Error en la transcripción de audio");
      }

      const data = await res.json();
      const transcribedText = data.text;
      setTranscript(transcribedText);

      if (transcribedText) {
        await sendToGrok(transcribedText);
      }
    } catch (err: any) {
      console.error("Transcription error:", err);
      setError("No se pudo transcribir el audio.");
    } finally {
      setIsProcessing(false);
    }
  };

  const startListening = async () => {
    setError(null);
    setTranscript("");
    transcriptRef.current = "";
    setInputMode("mic");
    setIsListening(true);

    await startAudioAnalysis();
    const stream = mediaStreamRef.current;

    if (!stream) {
      setIsListening(false);
      setInputMode("idle");
      return;
    }

    try {
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsListening(false);
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        audioChunksRef.current = [];

        cleanupAudio(); // Stop tracks immediately after recording
        setAudioLevel(0);
        setInputMode("idle");

        if (audioBlob.size > 0) {
          await sendAudioForTranscription(audioBlob);
        }
      };

      mediaRecorder.start();
    } catch (err) {
      console.error("MediaRecorder error:", err);
      setError("Error al iniciar la grabación");
      setIsListening(false);
      setInputMode("idle");
    }
  };

  const stopListening = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    } else {
      setIsListening(false);
      cleanupAudio();
      setAudioLevel(0);
      setInputMode("idle");
    }
  };

  const stopSpeaking = () => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = "";
    }
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  // Camera functions
  const startCamera = async () => {
    try {
      setCameraError(null);
      setInputMode("camera");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true
      });
      videoStreamRef.current = stream;
      setIsCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error("Error accessing camera:", err);
      setCameraError("No se pudo acceder a la cámara");
      setInputMode("idle");
    }
  };

  const stopCamera = () => {
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(track => track.stop());
      videoStreamRef.current = null;
    }
    setIsCameraActive(false);
    setInputMode("idle");
  };

  // File upload functions
  const handleFileUpload = () => {
    if (!advancedVoiceEnabled) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setInputMode("uploading");
    setError(null);
    const file = files[0];
    const normalizedFile = normalizeFileForUpload(file);
    const normalizedType = (normalizedFile.type || "").trim().toLowerCase();
    const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    const retryUpload = async (fn: () => Promise<void>, maxRetries = 3): Promise<void> => {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          await fn();
          return;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error("Error al subir el archivo");
          if (attempt < maxRetries) {
            const jitter = Math.floor(Math.random() * 120);
            await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, attempt) + jitter));
          }
        }
      }
      throw lastError || new Error("Error al subir el archivo");
    };

    // Validate file
    const maxSize = 500 * 1024 * 1024; // 500MB
    if (normalizedFile.size > maxSize) {
      setError("El archivo es demasiado grande (máximo 500MB)");
      setInputMode("idle");
      return;
    }
    if (!normalizedType || !VOICE_UPLOAD_ALLOWED_TYPES.has(normalizedType)) {
      setError("Tipo de archivo no soportado");
      setInputMode("idle");
      return;
    }

    try {
      // Get signed upload URL from server
      await ensureCsrfToken();
      const uploadRes = await apiFetch("/api/objects/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Upload-Id": uploadId,
        },
        body: JSON.stringify({
          uploadId,
          fileName: normalizedFile.name,
          mimeType: normalizedType,
          fileSize: normalizedFile.size,
        }),
      });

      if (!uploadRes.ok) {
        throw new Error("No se pudo obtener la URL de subida");
      }

      const { uploadURL, storagePath } = await uploadRes.json();
      const effectiveUploadUrl = resolveUploadUrlForResponse(uploadURL, uploadRes.url);

      // Upload file directly to storage
      await retryUpload(() =>
        uploadBlobWithProgress(effectiveUploadUrl, normalizedFile, undefined, {
          timeoutMs: 120000,
          skipContentType: true,
        })
      );

      // Register file in database
      await ensureCsrfToken();
      const registerRes = await apiFetch("/api/files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Upload-Id": uploadId,
        },
        body: JSON.stringify({
          name: normalizedFile.name,
          type: normalizedType,
          size: normalizedFile.size,
          storagePath,
          uploadId,
        }),
      });

      if (!registerRes.ok) {
        const errorData = await registerRes.json().catch(() => ({ error: "Archivo subido pero no se pudo registrar" }));
        throw new Error(errorData.error || "Archivo subido pero no se pudo registrar");
      }

      const registerData = await registerRes.json().catch(() => ({} as any));
      const statusLabel = registerData?.status === "ready" ? "Listo" : "Procesando";
      setResponse(`Archivo subido: ${normalizedFile.name} (${(normalizedFile.size / 1024).toFixed(1)} KB) (${statusLabel})`);

    } catch (err: any) {
      setError(err.message || "Error al subir el archivo");
    } finally {
      setInputMode("idle");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const sendToGrok = async (text: string) => {
    setIsProcessing(true);
    setResponse("");

    try {
      const res = await apiFetch("/api/voice-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok) {
        throw new Error("Error al comunicarse con el servidor");
      }

      const data = await res.json();
      setResponse(data.response);

      // Speak the response
      speakResponse(data.response);
    } catch (err: any) {
      console.error("Error sending to Grok:", err);
      setError(err.message || "Error al procesar tu mensaje");
    } finally {
      setIsProcessing(false);
    }
  };

  const speakResponse = async (text: string) => {
    if (!text) return;
    stopSpeaking();

    setIsProcessing(true);
    try {
      await ensureCsrfToken();
      const res = await apiFetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text,
          voice: settings.voice === "ember" ? "alloy" : "echo",
          speed: settings.voiceSpeed ?? 1.0,
        }),
      });

      if (!res.ok) throw new Error("TTS failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioElementRef.current = audio;

      audio.onplay = () => {
        setIsSpeaking(true);
        setIsProcessing(false);
      };

      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(url);
      };

      audio.onerror = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(url);
        setIsProcessing(false);
      };

      await audio.play();
    } catch (err) {
      console.error("TTS error:", err);
      setIsProcessing(false);
    }
  };

  const handleMicToggle = () => {
    if (isListening) {
      stopListening();
    } else {
      if (isSpeaking) stopSpeaking();
      startListening();
    }
  };

  const handleCameraToggle = () => {
    if (!advancedVoiceEnabled) return;
    if (isCameraActive) {
      stopCamera();
    } else {
      startCamera();
    }
  };

  // Calculate bubble scale based on audio level
  const bubbleScale = 1 + (audioLevel * 0.5);
  const bubbleGlow = audioLevel * 100;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-gradient-to-br from-gray-900 via-black to-gray-900 flex flex-col items-center justify-center"
          data-testid="voice-chat-mode"
        >
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
            onChange={handleFileChange}
            aria-label="File upload"
          />

          {/* Close button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="absolute top-6 right-6 h-12 w-12 rounded-full text-white/70 hover:text-white hover:bg-white/10"
            data-testid="button-close-voice-chat"
          >
            <X className="h-6 w-6" />
          </Button>

          {/* Status text */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute top-8 left-1/2 -translate-x-1/2 text-white/80 text-lg font-medium"
          >
            {isListening ? "Escuchando..." : isSpeaking ? "Hablando..." : isProcessing ? "Procesando..." : isCameraActive ? "Cámara activa" : "Modo conversación"}
          </motion.div>

          {/* Camera preview (when active) */}
          {isCameraActive && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute top-20 left-1/2 -translate-x-1/2 w-80 h-60 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl"
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-2 left-2 px-2 py-1 bg-red-500 rounded-full flex items-center gap-1">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                <span className="text-white text-xs font-medium">LIVE</span>
              </div>
            </motion.div>
          )}

          {/* Main animated bubble */}
          <motion.div
            className={cn(
              "relative flex items-center justify-center transition-[margin] duration-300",
              isCameraActive ? "mt-[160px]" : "mt-0"
            )}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            {/* Outer glow ring */}
            <motion.div
              className={cn(
                "absolute w-64 h-64 rounded-full",
                isListening ? "bg-blue-500/20" : isSpeaking ? "bg-green-500/20" : isCameraActive ? "bg-red-500/20" : "bg-white/10"
              )}
              animate={{
                scale: isListening || isSpeaking || isCameraActive ? [1, 1.2, 1] : 1,
                opacity: isListening || isSpeaking || isCameraActive ? [0.3, 0.5, 0.3] : 0.2,
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />

            {/* Middle ring */}
            <motion.div
              className={cn(
                "absolute w-48 h-48 rounded-full",
                isListening ? "bg-blue-400/30" : isSpeaking ? "bg-green-400/30" : isCameraActive ? "bg-red-400/30" : "bg-white/15"
              )}
              animate={{
                scale: isListening ? [1, 1 + audioLevel * 0.3, 1] : isSpeaking || isCameraActive ? [1, 1.15, 1] : 1,
              }}
              transition={{
                duration: isListening ? 0.1 : 1,
                repeat: isListening ? 0 : Infinity,
                ease: "easeOut",
              }}
              style={{
                transform: `scale(${isListening ? bubbleScale : 1})`,
              }}
            />

            {/* Main bubble - displays current state */}
            <motion.button
              type="button"
              onClick={handleMicToggle}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleMicToggle();
                }
              }}
              disabled={isProcessing || isCameraActive}
              className={cn(
                "relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300",
                "focus:outline-none focus:ring-4 focus:ring-white/20",
                isListening
                  ? "bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/50"
                  : isSpeaking
                    ? "bg-gradient-to-br from-green-500 to-green-600 shadow-lg shadow-green-500/50"
                    : isProcessing
                      ? "bg-gradient-to-br from-amber-500 to-amber-600 shadow-lg shadow-amber-500/50"
                      : isCameraActive
                        ? "bg-gradient-to-br from-red-500 to-red-600 shadow-lg shadow-red-500/50"
                        : "bg-gradient-to-br from-gray-700 to-gray-800 shadow-lg shadow-black/50 hover:from-gray-600 hover:to-gray-700"
              )}
              style={{
                boxShadow: isListening
                  ? `0 0 ${bubbleGlow}px rgba(59, 130, 246, 0.6)`
                  : isSpeaking
                    ? `0 0 60px rgba(34, 197, 94, 0.5)`
                    : isCameraActive
                      ? `0 0 60px rgba(239, 68, 68, 0.5)`
                      : undefined,
              }}
              aria-label={isListening ? "Detener y enviar" : isSpeaking ? "Interrumpir y hablar" : "Hablar"}
              data-testid="voice-bubble-display"
            >
              {isProcessing ? (
                <Loader2 className="h-12 w-12 text-white animate-spin" />
              ) : isListening ? (
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                >
                  <Mic className="h-12 w-12 text-white" />
                </motion.div>
              ) : isSpeaking ? (
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                >
                  <Volume2 className="h-12 w-12 text-white" />
                </motion.div>
              ) : isCameraActive ? (
                <motion.div
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                >
                  <Video className="h-12 w-12 text-white" />
                </motion.div>
              ) : (
                <div className="flex flex-col items-center">
                  <span className="text-white/80 text-sm">iliagpt</span>
                  <span className="text-white/50 text-[11px] mt-0.5">Toca para hablar</span>
                </div>
              )}
            </motion.button>

            {/* Audio level visualization rings */}
            {isListening && (
              <>
                {[...Array(3)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="absolute rounded-full border-2 border-blue-400/30"
                    style={{
                      width: 140 + (i * 40) + (audioLevel * 80),
                      height: 140 + (i * 40) + (audioLevel * 80),
                    }}
                    animate={{
                      opacity: [0.5 - i * 0.15, 0.2, 0.5 - i * 0.15],
                      scale: [1, 1.05, 1],
                    }}
                    transition={{
                      duration: 1,
                      repeat: Infinity,
                      delay: i * 0.2,
                    }}
                  />
                ))}
              </>
            )}
          </motion.div>

          {/* Transcript display */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute bottom-44 left-0 right-0 px-8 text-center"
          >
            {transcript && (
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-white/90 text-xl mb-4 max-w-lg mx-auto"
              >
                "{transcript}"
              </motion.p>
            )}
            {response && !isListening && (
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-white/70 text-lg max-w-lg mx-auto line-clamp-3"
              >
                {response}
              </motion.p>
            )}
            {(error || cameraError) && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-red-400 text-sm"
              >
                {error || cameraError}
              </motion.p>
            )}
          </motion.div>

          {/* Multimodal input buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="absolute bottom-16 flex items-center gap-6"
          >
            {advancedVoiceEnabled && (
              <>
                {/* Camera/Video button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <motion.button
                      onClick={handleCameraToggle}
                      disabled={isListening || isProcessing}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className={cn(
                        "w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300",
                        "focus:outline-none focus:ring-4 focus:ring-white/20",
                        isCameraActive
                          ? "bg-red-500 text-white shadow-lg shadow-red-500/40"
                          : "bg-gray-800/80 text-white/80 hover:bg-gray-700 hover:text-white"
                      )}
                      data-testid="button-camera-input"
                    >
                      {isCameraActive ? <VideoOff className="h-7 w-7" /> : <Video className="h-7 w-7" />}
                    </motion.button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-gray-800 text-white border-gray-700">
                    {isCameraActive ? "Detener cámara" : "Iniciar cámara"}
                  </TooltipContent>
                </Tooltip>

                {/* Upload/Attach button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <motion.button
                      onClick={handleFileUpload}
                      disabled={isListening || isProcessing || isCameraActive}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className={cn(
                        "w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300",
                        "focus:outline-none focus:ring-4 focus:ring-white/20",
                        inputMode === "uploading"
                          ? "bg-blue-500 text-white shadow-lg shadow-blue-500/40"
                          : "bg-gray-800/80 text-white/80 hover:bg-gray-700 hover:text-white"
                      )}
                      data-testid="button-upload-input"
                    >
                      {inputMode === "uploading" ? (
                        <Loader2 className="h-7 w-7 animate-spin" />
                      ) : (
                        <Upload className="h-7 w-7" />
                      )}
                    </motion.button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-gray-800 text-white border-gray-700">
                    Adjuntar archivo
                  </TooltipContent>
                </Tooltip>
              </>
            )}

            {/* Microphone button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <motion.button
                  onClick={handleMicToggle}
                  disabled={isProcessing || isCameraActive}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className={cn(
                    "w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300",
                    "focus:outline-none focus:ring-4 focus:ring-white/20",
                    isListening
                      ? "bg-blue-500 text-white shadow-lg shadow-blue-500/40 animate-pulse"
                      : isSpeaking
                        ? "bg-green-500 text-white shadow-lg shadow-green-500/40"
                        : "bg-gray-800/80 text-white/80 hover:bg-gray-700 hover:text-white"
                  )}
                  data-testid="button-mic-input"
                >
                  {isListening ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
                </motion.button>
              </TooltipTrigger>
              <TooltipContent className="bg-gray-800 text-white border-gray-700">
                {isListening ? "Detener y enviar" : isSpeaking ? "Interrumpir y hablar" : "Hablar"}
              </TooltipContent>
            </Tooltip>
          </motion.div>

          {/* Stop speaking button */}
          {isSpeaking && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute bottom-4"
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={stopSpeaking}
                className="text-white/70 hover:text-white hover:bg-white/10"
                data-testid="button-stop-speaking"
              >
                <VolumeX className="h-4 w-4 mr-2" />
                Silenciar
              </Button>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
