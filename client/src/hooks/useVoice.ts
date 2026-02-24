/**
 * Voice Input/Output Hook
 * 
 * Features:
 * - Speech-to-text using Web Speech API
 * - Text-to-speech for AI responses
 * - Voice commands
 * - Language detection
 */

/// <reference path="../types/speech.d.ts" />

import { useState, useCallback, useRef, useEffect } from "react";

export interface VoiceConfig {
    language: string;
    continuous: boolean;
    interimResults: boolean;
    ttsEnabled: boolean;
    ttsRate: number;
    ttsPitch: number;
    ttsVoice?: string;
}

export interface VoiceState {
    isListening: boolean;
    isSupported: boolean;
    isSpeaking: boolean;
    transcript: string;
    interimTranscript: string;
    error: string | null;
    confidence: number;
}

export interface UseVoiceReturn extends VoiceState {
    startListening: () => void;
    stopListening: () => void;
    toggleListening: () => void;
    speak: (text: string) => Promise<void>;
    stopSpeaking: () => void;
    clearTranscript: () => void;
    setLanguage: (lang: string) => void;
    availableVoices: SpeechSynthesisVoice[];
}

const DEFAULT_CONFIG: VoiceConfig = {
    language: "es-ES",
    continuous: true,
    interimResults: true,
    ttsEnabled: true,
    ttsRate: 1.0,
    ttsPitch: 1.0,
};

// Check browser support
const isSpeechRecognitionSupported = typeof window !== "undefined" && (
    "SpeechRecognition" in window ||
    "webkitSpeechRecognition" in window
);

const isSpeechSynthesisSupported = typeof window !== "undefined" &&
    "speechSynthesis" in window;

export function useVoice(
    config: Partial<VoiceConfig> = {},
    onResult?: (transcript: string, isFinal: boolean) => void
): UseVoiceReturn {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    const [state, setState] = useState<VoiceState>({
        isListening: false,
        isSupported: isSpeechRecognitionSupported,
        isSpeaking: false,
        transcript: "",
        interimTranscript: "",
        error: null,
        confidence: 0,
    });

    const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [language, setLanguageState] = useState(cfg.language);

    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

    // Load available voices
    useEffect(() => {
        if (!isSpeechSynthesisSupported) return;

        const loadVoices = () => {
            const voices = window.speechSynthesis.getVoices();
            setAvailableVoices(voices);
        };

        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;

        return () => {
            window.speechSynthesis.onvoiceschanged = null;
        };
    }, []);

    // Initialize speech recognition
    useEffect(() => {
        if (!isSpeechRecognitionSupported) return;

        const SpeechRecognition = (window as any).SpeechRecognition ||
            (window as any).webkitSpeechRecognition;

        const recognition = new SpeechRecognition();
        recognition.continuous = cfg.continuous;
        recognition.interimResults = cfg.interimResults;
        recognition.lang = language;

        recognition.onstart = () => {
            setState(s => ({ ...s, isListening: true, error: null }));
        };

        recognition.onend = () => {
            setState(s => ({ ...s, isListening: false }));
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            console.error("[Voice] Recognition error:", event.error);
            setState(s => ({
                ...s,
                isListening: false,
                error: getErrorMessage(event.error)
            }));
        };

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            let finalTranscript = "";
            let interimTranscript = "";
            let maxConfidence = 0;

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const text = result[0].transcript;
                const confidence = result[0].confidence;

                if (confidence > maxConfidence) {
                    maxConfidence = confidence;
                }

                if (result.isFinal) {
                    finalTranscript += text;
                    onResult?.(text, true);
                } else {
                    interimTranscript += text;
                    onResult?.(text, false);
                }
            }

            setState(s => ({
                ...s,
                transcript: s.transcript + finalTranscript,
                interimTranscript,
                confidence: maxConfidence,
            }));
        };

        recognitionRef.current = recognition;

        return () => {
            recognition.stop();
        };
    }, [cfg.continuous, cfg.interimResults, language, onResult]);

    // Start listening
    const startListening = useCallback(() => {
        if (!recognitionRef.current || !isSpeechRecognitionSupported) {
            setState(s => ({ ...s, error: "Speech recognition not supported" }));
            return;
        }

        try {
            recognitionRef.current.start();
        } catch (error) {
            // Already started
            console.warn("[Voice] Recognition already started");
        }
    }, []);

    // Stop listening
    const stopListening = useCallback(() => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
        }
    }, []);

    // Toggle listening
    const toggleListening = useCallback(() => {
        if (state.isListening) {
            stopListening();
        } else {
            startListening();
        }
    }, [state.isListening, startListening, stopListening]);

    // Speak text
    const speak = useCallback(async (text: string): Promise<void> => {
        if (!isSpeechSynthesisSupported || !cfg.ttsEnabled) {
            return;
        }

        // Cancel any ongoing speech
        window.speechSynthesis.cancel();

        return new Promise((resolve, reject) => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = language;
            utterance.rate = cfg.ttsRate;
            utterance.pitch = cfg.ttsPitch;

            // Select voice
            if (cfg.ttsVoice) {
                const voice = availableVoices.find(v => v.name === cfg.ttsVoice);
                if (voice) utterance.voice = voice;
            } else {
                // Try to find a voice for the language
                const langVoice = availableVoices.find(v =>
                    v.lang.startsWith(language.split("-")[0])
                );
                if (langVoice) utterance.voice = langVoice;
            }

            utterance.onstart = () => {
                setState(s => ({ ...s, isSpeaking: true }));
            };

            utterance.onend = () => {
                setState(s => ({ ...s, isSpeaking: false }));
                resolve();
            };

            utterance.onerror = (event) => {
                setState(s => ({ ...s, isSpeaking: false, error: event.error }));
                reject(new Error(event.error));
            };

            utteranceRef.current = utterance;
            window.speechSynthesis.speak(utterance);
        });
    }, [language, cfg.ttsEnabled, cfg.ttsRate, cfg.ttsPitch, cfg.ttsVoice, availableVoices]);

    // Stop speaking
    const stopSpeaking = useCallback(() => {
        if (isSpeechSynthesisSupported) {
            window.speechSynthesis.cancel();
            setState(s => ({ ...s, isSpeaking: false }));
        }
    }, []);

    // Clear transcript
    const clearTranscript = useCallback(() => {
        setState(s => ({ ...s, transcript: "", interimTranscript: "" }));
    }, []);

    // Set language
    const setLanguage = useCallback((lang: string) => {
        setLanguageState(lang);
        if (recognitionRef.current) {
            recognitionRef.current.lang = lang;
        }
    }, []);

    return {
        ...state,
        startListening,
        stopListening,
        toggleListening,
        speak,
        stopSpeaking,
        clearTranscript,
        setLanguage,
        availableVoices,
    };
}

// Helper to get user-friendly error messages
function getErrorMessage(error: string): string {
    switch (error) {
        case "no-speech":
            return "No se detectó voz. Intenta de nuevo.";
        case "aborted":
            return "Reconocimiento de voz cancelado.";
        case "audio-capture":
            return "No se pudo acceder al micrófono.";
        case "network":
            return "Error de red durante el reconocimiento.";
        case "not-allowed":
            return "Permiso de micrófono denegado.";
        case "service-not-allowed":
            return "Servicio de voz no disponible.";
        case "bad-grammar":
            return "Error en la configuración del reconocimiento.";
        case "language-not-supported":
            return "Idioma no soportado.";
        default:
            return `Error de reconocimiento: ${error}`;
    }
}

// Voice command parser
export function parseVoiceCommand(transcript: string): {
    command: string | null;
    params: Record<string, string>;
} {
    const commands: { pattern: RegExp; command: string; params: string[] }[] = [
        {
            pattern: /^(enviar|send|envía)(?: mensaje)?$/i,
            command: "send",
            params: []
        },
        {
            pattern: /^(nuevo|new) (chat|conversación|conversation)$/i,
            command: "new_chat",
            params: []
        },
        {
            pattern: /^(buscar?|search|find) (.+)$/i,
            command: "search",
            params: ["query"]
        },
        {
            pattern: /^(borrar|clear|limpiar)$/i,
            command: "clear",
            params: []
        },
        {
            pattern: /^(parar?|stop|detener)$/i,
            command: "stop",
            params: []
        },
        {
            pattern: /^(ayuda|help)$/i,
            command: "help",
            params: []
        },
    ];

    const normalized = transcript.toLowerCase().trim();

    for (const { pattern, command, params: paramNames } of commands) {
        const match = normalized.match(pattern);
        if (match) {
            const params: Record<string, string> = {};
            paramNames.forEach((name, i) => {
                if (match[i + 2]) {
                    params[name] = match[i + 2];
                }
            });
            return { command, params };
        }
    }

    return { command: null, params: {} };
}

export default useVoice;
