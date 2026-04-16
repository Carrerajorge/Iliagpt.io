/**
 * Voice First Mode Hook - ILIAGPT PRO 3.0
 * 
 * Voice input/output for hands-free operation.
 * Speech recognition and text-to-speech.
 */

import { useState, useCallback, useRef, useEffect } from "react";

// ============== Types ==============

export interface VoiceConfig {
    language?: string;
    continuous?: boolean;
    interimResults?: boolean;
    voiceName?: string;
    speechRate?: number;
    speechPitch?: number;
    autoSpeak?: boolean;
}

export interface VoiceState {
    isListening: boolean;
    isSpeaking: boolean;
    transcript: string;
    interimTranscript: string;
    error: string | null;
    isSupported: boolean;
}

export interface VoiceCommand {
    pattern: RegExp | string;
    action: (matches: string[]) => void;
    description?: string;
}

// ============== Hook ==============

export function useVoiceMode(config: VoiceConfig = {}) {
    const {
        language = "es-ES",
        continuous = true,
        interimResults = true,
        voiceName,
        speechRate = 1.0,
        speechPitch = 1.0,
        autoSpeak = false,
    } = config;

    const [state, setState] = useState<VoiceState>({
        isListening: false,
        isSpeaking: false,
        transcript: "",
        interimTranscript: "",
        error: null,
        isSupported: typeof window !== "undefined" && "webkitSpeechRecognition" in window,
    });

    const recognition = useRef<any>(null);
    const synthesis = useRef<SpeechSynthesis | null>(null);
    const commands = useRef<VoiceCommand[]>([]);
    const voicesLoaded = useRef(false);
    const availableVoices = useRef<SpeechSynthesisVoice[]>([]);

    // ======== Initialize ========

    useEffect(() => {
        if (typeof window === "undefined") return;

        // Speech recognition
        const SpeechRecognition = (window as any).webkitSpeechRecognition ||
            (window as any).SpeechRecognition;

        if (SpeechRecognition) {
            recognition.current = new SpeechRecognition();
            recognition.current.lang = language;
            recognition.current.continuous = continuous;
            recognition.current.interimResults = interimResults;

            recognition.current.onresult = (event: any) => {
                let final = "";
                let interim = "";

                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const result = event.results[i];
                    if (result.isFinal) {
                        final += result[0].transcript;
                    } else {
                        interim += result[0].transcript;
                    }
                }

                setState(s => ({
                    ...s,
                    transcript: s.transcript + final,
                    interimTranscript: interim,
                }));

                if (final) {
                    processCommands(final);
                }
            };

            recognition.current.onerror = (event: any) => {
                setState(s => ({ ...s, error: event.error, isListening: false }));
            };

            recognition.current.onend = () => {
                setState(s => ({ ...s, isListening: false }));
            };
        }

        // Speech synthesis
        synthesis.current = window.speechSynthesis;

        const loadVoices = () => {
            if (synthesis.current) {
                availableVoices.current = synthesis.current.getVoices();
                voicesLoaded.current = true;
            }
        };

        if (synthesis.current) {
            loadVoices();
            synthesis.current.addEventListener("voiceschanged", loadVoices);
        }

        return () => {
            if (recognition.current) {
                recognition.current.abort();
            }
            if (synthesis.current) {
                synthesis.current.cancel();
                synthesis.current.removeEventListener("voiceschanged", loadVoices);
            }
        };
    }, [language, continuous, interimResults]);

    // ======== Commands ========

    const processCommands = useCallback((text: string) => {
        const lowerText = text.toLowerCase().trim();

        for (const command of commands.current) {
            if (typeof command.pattern === "string") {
                if (lowerText.includes(command.pattern.toLowerCase())) {
                    command.action([text]);
                    return;
                }
            } else {
                const matches = text.match(command.pattern);
                if (matches) {
                    command.action(matches);
                    return;
                }
            }
        }
    }, []);

    const registerCommand = useCallback((command: VoiceCommand) => {
        commands.current.push(command);
        return () => {
            const index = commands.current.indexOf(command);
            if (index > -1) commands.current.splice(index, 1);
        };
    }, []);

    // ======== Listening ========

    const startListening = useCallback(() => {
        if (!recognition.current) {
            setState(s => ({ ...s, error: "Speech recognition not supported" }));
            return;
        }

        // Interrupt any ongoing speech
        if (synthesis.current) {
            synthesis.current.cancel();
            setState(s => ({ ...s, isSpeaking: false }));
        }

        setState(s => ({
            ...s,
            isListening: true,
            error: null,
            transcript: "",
            interimTranscript: "",
        }));

        try {
            recognition.current.start();
        } catch {
            // Already started
        }
    }, []);

    const stopListening = useCallback(() => {
        if (recognition.current) {
            recognition.current.stop();
        }
        setState(s => ({ ...s, isListening: false }));
    }, []);

    const toggleListening = useCallback(() => {
        if (state.isListening) {
            stopListening();
        } else {
            startListening();
        }
    }, [state.isListening, startListening, stopListening]);

    // ======== Speaking ========

    const speak = useCallback((text: string, options?: {
        voice?: string;
        rate?: number;
        pitch?: number;
        onEnd?: () => void;
    }): void => {
        if (!synthesis.current) return;

        // Cancel any ongoing speech
        synthesis.current.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = language;
        utterance.rate = options?.rate ?? speechRate;
        utterance.pitch = options?.pitch ?? speechPitch;

        // Find voice
        const targetVoiceName = options?.voice ?? voiceName;
        if (targetVoiceName && voicesLoaded.current) {
            const voice = availableVoices.current.find(v =>
                v.name.toLowerCase().includes(targetVoiceName.toLowerCase()) ||
                v.lang.startsWith(language.split("-")[0])
            );
            if (voice) utterance.voice = voice;
        }

        utterance.onstart = () => {
            setState(s => ({ ...s, isSpeaking: true }));
        };

        utterance.onend = () => {
            setState(s => ({ ...s, isSpeaking: false }));
            options?.onEnd?.();
        };

        utterance.onerror = (event) => {
            setState(s => ({ ...s, isSpeaking: false, error: event.error }));
        };

        synthesis.current.speak(utterance);
    }, [language, speechRate, speechPitch, voiceName]);

    const stopSpeaking = useCallback(() => {
        if (synthesis.current) {
            synthesis.current.cancel();
        }
        setState(s => ({ ...s, isSpeaking: false }));
    }, []);

    // ======== Utilities ========

    const getVoices = useCallback((): SpeechSynthesisVoice[] => {
        return availableVoices.current;
    }, []);

    const clearTranscript = useCallback(() => {
        setState(s => ({ ...s, transcript: "", interimTranscript: "" }));
    }, []);

    // ======== Voice Conversation Mode ========

    const conversationMode = useCallback((
        onUserSpoke: (text: string) => Promise<string>
    ) => {
        const handleResult = async () => {
            if (state.transcript && !state.isListening) {
                stopListening();

                const response = await onUserSpoke(state.transcript);

                speak(response, {
                    onEnd: () => {
                        clearTranscript();
                        startListening();
                    },
                });
            }
        };

        handleResult();
    }, [state.transcript, state.isListening, speak, clearTranscript, startListening, stopListening]);

    return {
        ...state,
        startListening,
        stopListening,
        toggleListening,
        speak,
        stopSpeaking,
        registerCommand,
        getVoices,
        clearTranscript,
        conversationMode,
    };
}

// ============== Default Commands ==============

export const DEFAULT_VOICE_COMMANDS: VoiceCommand[] = [
    {
        pattern: /parar|stop|detener/i,
        action: () => console.log("Stop command"),
        description: "Stop current action",
    },
    {
        pattern: /nuevo chat|new chat/i,
        action: () => console.log("New chat command"),
        description: "Start new conversation",
    },
    {
        pattern: /guardar|save/i,
        action: () => console.log("Save command"),
        description: "Save current conversation",
    },
    {
        pattern: /borrar|clear|limpiar/i,
        action: () => console.log("Clear command"),
        description: "Clear transcript",
    },
];

export default useVoiceMode;
