/**
 * useAgentStatus — real-time agent execution status via WebSocket + polling fallback.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentStep {
  id: string
  name: string
  type: 'llm_call' | 'tool_execute' | 'search' | 'memory' | 'code_exec' | 'waiting'
  status: 'pending' | 'active' | 'complete' | 'failed' | 'skipped'
  startedAt?: Date
  completedAt?: Date
  durationMs?: number
  result?: any
  error?: string
  model?: string
  tokensUsed?: number
  costUsd?: number
}

export interface AgentStatus {
  agentId: string
  status: 'idle' | 'planning' | 'executing' | 'waiting_approval' | 'complete' | 'failed' | 'cancelled'
  task?: string
  steps: AgentStep[]
  currentStep?: AgentStep
  progress: number
  tokensTotal: number
  costTotal: number
  budgetRemaining?: number
  model?: string
  startedAt?: Date
  completedAt?: Date
  error?: string
  memory?: Array<{ key: string; value: string }>
}

type ConnectionMethod = 'websocket' | 'polling' | 'none'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(['complete', 'failed', 'cancelled'])

function sortSteps(steps: AgentStep[]): AgentStep[] {
  return [...steps].sort((a, b) => {
    const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0
    const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0
    return aTime - bTime
  })
}

function computeProgress(steps: AgentStep[]): number {
  if (!steps.length) return 0
  const done = steps.filter(s => s.status === 'complete' || s.status === 'skipped').length
  return Math.round((done / steps.length) * 100)
}

function parseStatusPayload(data: any): Partial<AgentStatus> {
  const steps: AgentStep[] = (data.steps ?? []).map((s: any) => ({
    ...s,
    startedAt: s.startedAt ? new Date(s.startedAt) : undefined,
    completedAt: s.completedAt ? new Date(s.completedAt) : undefined,
  }))

  const sorted = sortSteps(steps)
  const currentStep = sorted.find(s => s.status === 'active')

  return {
    ...data,
    steps: sorted,
    currentStep,
    progress: data.progress ?? computeProgress(sorted),
    startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
    completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
    tokensTotal: data.tokensTotal ?? 0,
    costTotal: data.costTotal ?? 0,
  }
}

async function agentAction(agentId: string, action: 'cancel' | 'pause' | 'resume'): Promise<void> {
  const response = await fetch(`/api/agents/${agentId}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Failed to ${action} agent: HTTP ${response.status}`)
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentStatus(agentId?: string) {
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [connectionMethod, setConnectionMethod] = useState<ConnectionMethod>('none')
  const [budgetWarning, setBudgetWarning] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const pollingEnabledRef = useRef(false)
  const prevAgentIdRef = useRef<string | undefined>(undefined)

  // -------------------------------------------------------------------------
  // Polling fallback via TanStack Query
  // -------------------------------------------------------------------------

  const { data: polledData } = useQuery({
    queryKey: ['agent-status', agentId],
    queryFn: async () => {
      if (!agentId) return null
      const res = await fetch(`/api/agents/${agentId}/status`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled: !!agentId && pollingEnabledRef.current,
    refetchInterval: (query) => {
      const data = query.state.data as AgentStatus | null
      if (!data) return 2000
      if (TERMINAL_STATUSES.has(data.status)) return false
      return 2000
    },
    staleTime: 1000,
  })

  // Apply polled data to state
  useEffect(() => {
    if (!polledData || !pollingEnabledRef.current) return
    const parsed = parseStatusPayload(polledData)
    setStatus(prev => ({ ...(prev ?? { agentId: agentId! }), ...parsed } as AgentStatus))
    checkBudget(parsed as AgentStatus)
  }, [polledData, agentId])

  // -------------------------------------------------------------------------
  // Budget warning
  // -------------------------------------------------------------------------

  const checkBudget = useCallback((s: AgentStatus) => {
    if (
      s.budgetRemaining !== undefined &&
      s.costTotal !== undefined &&
      s.budgetRemaining < s.costTotal * 0.1
    ) {
      setBudgetWarning(true)
    }
  }, [])

  // -------------------------------------------------------------------------
  // WebSocket connection
  // -------------------------------------------------------------------------

  const connectWebSocket = useCallback(
    (id: string) => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }

      pollingEnabledRef.current = false
      setConnectionMethod('none')
      setIsConnected(false)

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/api/agents/${id}/status/ws`

      let ws: WebSocket
      try {
        ws = new WebSocket(wsUrl)
      } catch {
        // WebSocket not supported or blocked — fall back to polling immediately
        pollingEnabledRef.current = true
        setConnectionMethod('polling')
        return
      }

      wsRef.current = ws

      ws.onopen = () => {
        setIsConnected(true)
        setConnectionMethod('websocket')
        pollingEnabledRef.current = false
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          const parsed = parseStatusPayload(data)
          setStatus(prev => ({ ...(prev ?? { agentId: id }), ...parsed } as AgentStatus))
          checkBudget(parsed as AgentStatus)

          // Auto-disconnect on terminal state
          if (TERMINAL_STATUSES.has(data.status)) {
            ws.close()
          }
        } catch {
          // ignore malformed messages
        }
      }

      ws.onerror = () => {
        // Fall back to polling
        pollingEnabledRef.current = true
        setConnectionMethod('polling')
        setIsConnected(false)
      }

      ws.onclose = () => {
        setIsConnected(false)
        // Only switch to polling if not already on a terminal state
        setStatus(prev => {
          if (prev && TERMINAL_STATUSES.has(prev.status)) return prev
          pollingEnabledRef.current = true
          setConnectionMethod('polling')
          return prev
        })
      }
    },
    [checkBudget]
  )

  // -------------------------------------------------------------------------
  // Effect: connect/disconnect on agentId change
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (agentId === prevAgentIdRef.current) return
    prevAgentIdRef.current = agentId

    // Cleanup previous
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    pollingEnabledRef.current = false
    setStatus(null)
    setIsConnected(false)
    setConnectionMethod('none')
    setBudgetWarning(false)

    if (agentId) {
      connectWebSocket(agentId)
    }
  }, [agentId, connectWebSocket])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close()
    }
  }, [])

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const cancel = useCallback(async () => {
    if (!agentId) return
    await agentAction(agentId, 'cancel')
  }, [agentId])

  const pause = useCallback(async () => {
    if (!agentId) return
    await agentAction(agentId, 'pause')
  }, [agentId])

  const resume = useCallback(async () => {
    if (!agentId) return
    await agentAction(agentId, 'resume')
  }, [agentId])

  const clearStatus = useCallback(() => {
    setStatus(null)
    setBudgetWarning(false)
  }, [])

  return {
    status,
    isConnected,
    connectionMethod,
    budgetWarning,
    cancel,
    pause,
    resume,
    clearStatus,
  }
}
