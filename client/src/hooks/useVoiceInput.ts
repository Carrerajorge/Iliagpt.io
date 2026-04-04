/**
 * useVoiceInput — Web Speech API voice input hook for ILIAGPT.
 * Supports interim transcripts, voice commands, auto-stop, language detection,
 * and microphone permission management.
 */

import { useState, useCallback, useRef, useEffect } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceInputStatus =
  | 'idle'
  | 'requesting_permission'
  | 'listening'
  | 'processing'
  | 'error'
  | 'unsupported'

export interface VoiceCommand {
  trigger: string
  action: 'send' | 'clear' | 'stop' | 'new_line'
  aliases?: string[]
}

export interface VoiceInputState {
  status: VoiceInputStatus
  transcript: string
  interimTranscript: string
  confidence: number
  language: string
  error: string | null
  isSupported: boolean
  permissionGranted: boolean | null
}

export interface VoiceInputOptions {
  language?: string
  onTranscript?: (text: string) => void
  onCommand?: (command: VoiceCommand) => void
  onSend?: (text: string) => void
  continuous?: boolean
  autoStopMs?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VOICE_COMMANDS: VoiceCommand[] = [
  { trigger: 'send', action: 'send', aliases: ['submit', 'go', 'enter', 'enviar'] },
  { trigger: 'clear', action: 'clear', aliases: ['reset', 'delete all', 'borrar'] },
  { trigger: 'stop', action: 'stop', aliases: ['cancel', 'abort', 'parar'] },
  { trigger: 'new line', action: 'new_line', aliases: ['next line', 'nueva línea', 'nueva linea'] },
]

// Spanish indicator words for auto language detection
const SPANISH_INDICATORS = [
  'como', 'que', 'para', 'una', 'los', 'las', 'del', 'por', 'con', 'hay',
  'este', 'esta', 'pero', 'más', 'mas', 'muy', 'bien', 'hola', 'gracias',
]

function detectSpanish(text: string): boolean {
  const words = text.toLowerCase().split(/\s+/)
  const matches = words.filter(w => SPANISH_INDICATORS.includes(w))
  return matches.length >= 2
}

function matchVoiceCommand(text: string): VoiceCommand | null {
  const lower = text.toLowerCase().trim()
  for (const cmd of VOICE_COMMANDS) {
    const allTriggers = [cmd.trigger, ...(cmd.aliases ?? [])]
    for (const trigger of allTriggers) {
      if (lower === trigger.toLowerCase() || lower.endsWith(` ${trigger.toLowerCase()}`)) {
        return cmd
      }
    }
  }
  return null
}

function isSpeechRecognitionSupported(): boolean {
  return typeof window !== 'undefined' &&
    !!(
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition
    )
}

function getSpeechRecognitionClass():
  | (new () => SpeechRecognition)
  | null {
  if (typeof window === 'undefined') return null
  return (
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition ||
    null
  )
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const DEFAULT_STATE: VoiceInputState = {
  status: 'idle',
  transcript: '',
  interimTranscript: '',
  confidence: 0,
  language: 'en-US',
  error: null,
  isSupported: false,
  permissionGranted: null,
}

export function useVoiceInput(options: VoiceInputOptions = {}) {
  const {
    language: initialLanguage = 'en-US',
    onTranscript,
    onCommand,
    onSend,
    continuous = true,
    autoStopMs = 3000,
  } = options

  const [state, setState] = useState<VoiceInputState>(() => ({
    ...DEFAULT_STATE,
    isSupported: isSpeechRecognitionSupported(),
    language: initialLanguage,
  }))

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const transcriptRef = useRef('')
  const languageRef = useRef(initialLanguage)
  const isListeningRef = useRef(false)

  // -------------------------------------------------------------------------
  // Auto-stop timer management
  // -------------------------------------------------------------------------

  const resetAutoStopTimer = useCallback(() => {
    if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current)
    if (autoStopMs > 0) {
      autoStopTimerRef.current = setTimeout(() => {
        if (isListeningRef.current) {
          recognitionRef.current?.stop()
        }
      }, autoStopMs)
    }
  }, [autoStopMs])

  // -------------------------------------------------------------------------
  // Build / rebuild recognition instance
  // -------------------------------------------------------------------------

  const buildRecognition = useCallback((): SpeechRecognition | null => {
    const Cls = getSpeechRecognitionClass()
    if (!Cls) return null

    const rec = new Cls()
    rec.continuous = continuous
    rec.interimResults = true
    rec.lang = languageRef.current
    rec.maxAlternatives = 1

    rec.onstart = () => {
      isListeningRef.current = true
      setState(prev => ({ ...prev, status: 'listening', error: null }))
      resetAutoStopTimer()
    }

    rec.onresult = (event: SpeechRecognitionEvent) => {
      resetAutoStopTimer()
      let interim = ''
      let finalSegment = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0].transcript
        if (result.isFinal) {
          finalSegment += text
          const confidence = result[0].confidence ?? 1
          setState(prev => ({ ...prev, confidence }))
        } else {
          interim += text
        }
      }

      if (finalSegment) {
        transcriptRef.current += (transcriptRef.current ? ' ' : '') + finalSegment.trim()

        // Auto-detect Spanish
        if (detectSpanish(transcriptRef.current) && languageRef.current !== 'es-ES') {
          languageRef.current = 'es-ES'
          setState(prev => ({ ...prev, language: 'es-ES' }))
        }

        // Check for voice command
        const cmd = matchVoiceCommand(finalSegment.trim())
        if (cmd) {
          onCommand?.(cmd)
          switch (cmd.action) {
            case 'send':
              onSend?.(transcriptRef.current)
              break
            case 'clear':
              transcriptRef.current = ''
              setState(prev => ({ ...prev, transcript: '', interimTranscript: '' }))
              break
            case 'stop':
              recognitionRef.current?.stop()
              break
            case 'new_line':
              transcriptRef.current += '\n'
              break
          }
          if (cmd.action !== 'new_line' && cmd.action !== 'send') {
            setState(prev => ({ ...prev, transcript: transcriptRef.current, interimTranscript: '' }))
            return
          }
        }

        onTranscript?.(transcriptRef.current)
        setState(prev => ({
          ...prev,
          transcript: transcriptRef.current,
          interimTranscript: '',
        }))
      }

      if (interim) {
        setState(prev => ({ ...prev, interimTranscript: interim }))
      }
    }

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      isListeningRef.current = false
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current)

      let errorMsg = event.error
      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        setState(prev => ({
          ...prev,
          status: 'error',
          error: 'Microphone permission denied.',
          permissionGranted: false,
        }))
        return
      }

      if (event.error === 'no-speech') {
        // Not a real error — just silence
        setState(prev => ({ ...prev, status: 'idle', interimTranscript: '' }))
        return
      }

      setState(prev => ({
        ...prev,
        status: 'error',
        error: `Speech recognition error: ${errorMsg}`,
      }))
    }

    rec.onend = () => {
      isListeningRef.current = false
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current)
      setState(prev => ({
        ...prev,
        status: prev.status === 'error' ? 'error' : 'idle',
        interimTranscript: '',
      }))
    }

    return rec
  }, [continuous, onTranscript, onCommand, onSend, resetAutoStopTimer])

  // -------------------------------------------------------------------------
  // Permission check
  // -------------------------------------------------------------------------

  const checkPermission = useCallback(async (): Promise<boolean> => {
    if (typeof navigator === 'undefined') return false

    if (navigator.permissions) {
      try {
        const result = await navigator.permissions.query({ name: 'microphone' as PermissionName })
        const granted = result.state === 'granted'
        setState(prev => ({ ...prev, permissionGranted: granted }))
        return result.state !== 'denied'
      } catch {
        // Some browsers don't support microphone permission query
      }
    }

    return true // Assume permission can be requested
  }, [])

  // -------------------------------------------------------------------------
  // Public: start
  // -------------------------------------------------------------------------

  const start = useCallback(async () => {
    if (!isSpeechRecognitionSupported()) {
      setState(prev => ({ ...prev, status: 'unsupported', isSupported: false }))
      return
    }

    setState(prev => ({ ...prev, status: 'requesting_permission' }))

    const canProceed = await checkPermission()
    if (!canProceed) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: 'Microphone permission denied.',
        permissionGranted: false,
      }))
      return
    }

    setState(prev => ({ ...prev, permissionGranted: true }))

    if (isListeningRef.current) return

    const rec = buildRecognition()
    if (!rec) {
      setState(prev => ({ ...prev, status: 'unsupported' }))
      return
    }

    recognitionRef.current = rec

    try {
      rec.start()
    } catch (err) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to start recognition',
      }))
    }
  }, [checkPermission, buildRecognition])

  // -------------------------------------------------------------------------
  // Public: stop
  // -------------------------------------------------------------------------

  const stop = useCallback(() => {
    if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current)
    if (recognitionRef.current && isListeningRef.current) {
      setState(prev => ({ ...prev, status: 'processing' }))
      recognitionRef.current.stop()
    }
  }, [])

  // -------------------------------------------------------------------------
  // Public: cancel
  // -------------------------------------------------------------------------

  const cancel = useCallback(() => {
    if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current)
    if (recognitionRef.current) {
      recognitionRef.current.abort()
    }
    transcriptRef.current = ''
    setState(prev => ({
      ...prev,
      status: 'idle',
      transcript: '',
      interimTranscript: '',
    }))
  }, [])

  // -------------------------------------------------------------------------
  // Public: clear
  // -------------------------------------------------------------------------

  const clear = useCallback(() => {
    transcriptRef.current = ''
    setState(prev => ({ ...prev, transcript: '', interimTranscript: '' }))
  }, [])

  // -------------------------------------------------------------------------
  // Public: toggle
  // -------------------------------------------------------------------------

  const toggle = useCallback(() => {
    if (isListeningRef.current) {
      stop()
    } else {
      start()
    }
  }, [start, stop])

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current)
      recognitionRef.current?.abort()
    }
  }, [])

  return {
    state,
    start,
    stop,
    cancel,
    clear,
    toggle,
  }
}
