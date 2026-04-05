/**
 * useAIStreaming — SSE-based AI streaming hook for ILIAGPT.
 * Handles fetch-based streaming, thinking steps, auto-reconnect with
 * exponential backoff, token counting, and typing indicator.
 */

import { useState, useCallback, useRef, useEffect } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'complete' | 'error'

export interface ThinkingStep {
  id: string
  type: 'reasoning' | 'tool_call' | 'source_lookup' | 'memory_access'
  description: string
  status: 'active' | 'complete' | 'failed'
  data?: any
  startedAt: number
  completedAt?: number
}

export interface StreamOptions {
  url: string
  body?: Record<string, any>
  headers?: Record<string, string>
  onToken?: (token: string) => void
  onComplete?: (fullText: string, tokenCount: number) => void
  onError?: (error: Error) => void
  onThinkingStep?: (step: ThinkingStep) => void
  autoReconnect?: boolean
  maxReconnectAttempts?: number
}

export interface StreamState {
  status: StreamStatus
  content: string
  tokenCount: number
  thinkingSteps: ThinkingStep[]
  currentThinkingStep: ThinkingStep | null
  error: Error | null
  isTypingIndicator: boolean
  reconnectAttempts: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function parseSSEData(line: string): string | null {
  if (line.startsWith('data: ')) return line.slice(6)
  return null
}

function buildThinkingStep(raw: any): ThinkingStep | null {
  try {
    const thinking = raw.thinking
    if (!thinking) return null
    return {
      id: thinking.id ?? crypto.randomUUID(),
      type: thinking.type ?? 'reasoning',
      description: thinking.description ?? '',
      status: thinking.status ?? 'active',
      data: thinking.data,
      startedAt: thinking.startedAt ?? Date.now(),
      completedAt: thinking.completedAt,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const DEFAULT_STATE: StreamState = {
  status: 'idle',
  content: '',
  tokenCount: 0,
  thinkingSteps: [],
  currentThinkingStep: null,
  error: null,
  isTypingIndicator: false,
  reconnectAttempts: 0,
}

export function useAIStreaming(options?: StreamOptions) {
  const [state, setState] = useState<StreamState>(DEFAULT_STATE)
  const abortRef = useRef<AbortController | null>(null)
  const optionsRef = useRef<StreamOptions | undefined>(options)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<string>('')
  const isCancelledRef = useRef(false)

  // Keep options ref up to date without re-running effects
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    }
  }, [])

  const processSSEStream = useCallback(
    async (
      opts: StreamOptions,
      attempt: number
    ): Promise<'done' | 'error' | 'cancelled'> => {
      const controller = new AbortController()
      abortRef.current = controller

      setState(prev => ({
        ...prev,
        status: 'connecting',
        reconnectAttempts: attempt,
        error: null,
      }))

      let response: Response
      try {
        response = await fetch(opts.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...(opts.headers ?? {}),
          },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal,
        })
      } catch (err) {
        if (isCancelledRef.current) return 'cancelled'
        const error = err instanceof Error ? err : new Error(String(err))
        setState(prev => ({ ...prev, status: 'error', error, isTypingIndicator: false }))
        opts.onError?.(error)
        return 'error'
      }

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`)
        setState(prev => ({ ...prev, status: 'error', error, isTypingIndicator: false }))
        opts.onError?.(error)
        return 'error'
      }

      if (!response.body) {
        const error = new Error('Response body is null')
        setState(prev => ({ ...prev, status: 'error', error, isTypingIndicator: false }))
        opts.onError?.(error)
        return 'error'
      }

      setState(prev => ({ ...prev, status: 'streaming', isTypingIndicator: true }))

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const appendThinkingStep = (step: ThinkingStep) => {
        setState(prev => {
          const existing = prev.thinkingSteps.findIndex(s => s.id === step.id)
          const updated =
            existing >= 0
              ? prev.thinkingSteps.map((s, i) => (i === existing ? step : s))
              : [...prev.thinkingSteps, step]
          return {
            ...prev,
            thinkingSteps: updated,
            currentThinkingStep: step.status === 'active' ? step : prev.currentThinkingStep,
          }
        })
        opts.onThinkingStep?.(step)
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? '' // keep incomplete line in buffer

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            const data = parseSSEData(trimmed)
            if (data === null) continue

            // Done sentinel
            if (data === '[DONE]') {
              const finalContent = contentRef.current
              const finalTokens = countTokens(finalContent)
              setState(prev => ({
                ...prev,
                status: 'complete',
                isTypingIndicator: false,
                tokenCount: finalTokens,
                currentThinkingStep: null,
              }))
              opts.onComplete?.(finalContent, finalTokens)
              return 'done'
            }

            // Try JSON — thinking step or error
            if (data.startsWith('{')) {
              try {
                const parsed = JSON.parse(data)

                if (parsed.error) {
                  throw new Error(parsed.error)
                }

                if (parsed.thinking) {
                  const step = buildThinkingStep(parsed)
                  if (step) appendThinkingStep(step)
                  continue
                }

                // Some servers send { token: "..." }
                if (typeof parsed.token === 'string') {
                  const token = parsed.token
                  contentRef.current += token
                  opts.onToken?.(token)
                  setState(prev => ({
                    ...prev,
                    content: contentRef.current,
                    tokenCount: countTokens(contentRef.current),
                  }))
                  continue
                }

                // { content: "..." }
                if (typeof parsed.content === 'string') {
                  const token = parsed.content
                  contentRef.current += token
                  opts.onToken?.(token)
                  setState(prev => ({
                    ...prev,
                    content: contentRef.current,
                    tokenCount: countTokens(contentRef.current),
                  }))
                  continue
                }
              } catch (parseErr) {
                if ((parseErr as Error).message && !(parseErr as SyntaxError).stack?.includes('JSON')) {
                  // It's a real error from the server
                  throw parseErr
                }
                // JSON parse error — treat raw data as token
              }
            }

            // Plain text token
            contentRef.current += data
            opts.onToken?.(data)
            setState(prev => ({
              ...prev,
              content: contentRef.current,
              tokenCount: countTokens(contentRef.current),
            }))
          }
        }

        // Stream ended without [DONE]
        const finalContent = contentRef.current
        const finalTokens = countTokens(finalContent)
        setState(prev => ({
          ...prev,
          status: 'complete',
          isTypingIndicator: false,
          tokenCount: finalTokens,
          currentThinkingStep: null,
        }))
        opts.onComplete?.(finalContent, finalTokens)
        return 'done'
      } catch (err) {
        if (isCancelledRef.current) return 'cancelled'
        const error = err instanceof Error ? err : new Error(String(err))
        if (error.name === 'AbortError') return 'cancelled'
        setState(prev => ({ ...prev, status: 'error', error, isTypingIndicator: false }))
        opts.onError?.(error)
        return 'error'
      } finally {
        reader.releaseLock()
      }
    },
    []
  )

  const start = useCallback(
    (overrides?: Partial<StreamOptions>) => {
      const opts: StreamOptions = {
        ...(optionsRef.current ?? { url: '' }),
        ...overrides,
      }

      if (!opts.url) {
        console.error('[useAIStreaming] No URL provided')
        return
      }

      // Reset state
      isCancelledRef.current = false
      contentRef.current = ''
      setState({
        ...DEFAULT_STATE,
        status: 'connecting',
      })

      const maxAttempts = opts.maxReconnectAttempts ?? 3
      const autoReconnect = opts.autoReconnect ?? true

      const attemptStream = async (attempt: number) => {
        const result = await processSSEStream(opts, attempt)

        if (result === 'error' && autoReconnect && attempt < maxAttempts && !isCancelledRef.current) {
          const delay = Math.pow(2, attempt) * 1000 // 1s, 2s, 4s
          setState(prev => ({ ...prev, status: 'connecting', reconnectAttempts: attempt + 1 }))
          reconnectTimerRef.current = setTimeout(() => {
            attemptStream(attempt + 1)
          }, delay)
        }
      }

      attemptStream(0)
    },
    [processSSEStream]
  )

  const cancel = useCallback(() => {
    isCancelledRef.current = true
    abortRef.current?.abort()
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    setState(prev => ({
      ...prev,
      status: 'idle',
      isTypingIndicator: false,
      currentThinkingStep: null,
    }))
  }, [])

  const reset = useCallback(() => {
    cancel()
    contentRef.current = ''
    setState(DEFAULT_STATE)
  }, [cancel])

  const appendContent = useCallback((text: string) => {
    contentRef.current += text
    setState(prev => ({
      ...prev,
      content: contentRef.current,
      tokenCount: countTokens(contentRef.current),
    }))
  }, [])

  return {
    state,
    start,
    cancel,
    reset,
    appendContent,
  }
}
