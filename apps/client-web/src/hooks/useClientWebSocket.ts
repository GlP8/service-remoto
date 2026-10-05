import { useEffect, useRef, useState } from 'react'
import { API_URL } from '../config'

export const ClientWebSocketStatus = {
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
} as const

export type ClientWebSocketStatus = typeof ClientWebSocketStatus[keyof typeof ClientWebSocketStatus]

type TicketUpdate<TTicket> = {
  type?: string
  ticket?: TTicket
}

type UseClientWebSocketOptions<TTicket> = {
  onTicketUpdated?: (ticket: TTicket) => void
  reconnectBaseDelayMs?: number
  reconnectMaxDelayMs?: number
}

function websocketUrl(token: string) {
  const url = new URL(API_URL)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/ws/client'
  url.search = new URLSearchParams({ token }).toString()
  return url.toString()
}

export function useClientWebSocket<TTicket>({
  onTicketUpdated,
  reconnectBaseDelayMs = 500,
  reconnectMaxDelayMs = 10_000,
}: UseClientWebSocketOptions<TTicket> = {}) {
  const [status, setStatus] = useState<ClientWebSocketStatus>(ClientWebSocketStatus.DISCONNECTED)
  const socketRef = useRef<WebSocket | null>(null)
  const retryTimerRef = useRef<number | null>(null)
  const retryCountRef = useRef(0)
  const stoppedRef = useRef(false)
  const onTicketUpdatedRef = useRef(onTicketUpdated)

  useEffect(() => {
    onTicketUpdatedRef.current = onTicketUpdated
  }, [onTicketUpdated])

  useEffect(() => {
    const token = sessionStorage.getItem('service-remoto-session')
    if (!token) {
      setStatus(ClientWebSocketStatus.DISCONNECTED)
      return
    }

    let parsedSession: { token?: string; user?: { role?: string } }
    try {
      parsedSession = JSON.parse(token) as { token?: string; user?: { role?: string } }
    } catch {
      setStatus(ClientWebSocketStatus.DISCONNECTED)
      return
    }

    if (!parsedSession.token || parsedSession.user?.role !== 'CLIENT') {
      setStatus(ClientWebSocketStatus.DISCONNECTED)
      return
    }

    stoppedRef.current = false
    retryCountRef.current = 0

    const clearRetryTimer = () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
    }

    const scheduleReconnect = () => {
      if (stoppedRef.current || retryTimerRef.current !== null) return
      const delay = Math.min(
        reconnectBaseDelayMs * 2 ** retryCountRef.current,
        reconnectMaxDelayMs,
      )
      retryCountRef.current += 1
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null
        connect()
      }, delay)
    }

    const connect = () => {
      if (stoppedRef.current) return
      setStatus(ClientWebSocketStatus.CONNECTING)
      const socket = new WebSocket(websocketUrl(parsedSession.token!))
      socketRef.current = socket

      socket.onopen = () => {
        retryCountRef.current = 0
        setStatus(ClientWebSocketStatus.CONNECTED)
      }

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as TicketUpdate<TTicket>
          if (message.type === 'ticket.updated' && message.ticket) {
            onTicketUpdatedRef.current?.(message.ticket)
          }
        } catch {
          // Ignore malformed server messages and keep the connection alive.
        }
      }

      socket.onerror = () => {
        setStatus(ClientWebSocketStatus.DISCONNECTED)
      }

      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null
        setStatus(ClientWebSocketStatus.DISCONNECTED)
        scheduleReconnect()
      }
    }

    connect()

    return () => {
      stoppedRef.current = true
      clearRetryTimer()
      const socket = socketRef.current
      socketRef.current = null
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
      setStatus(ClientWebSocketStatus.DISCONNECTED)
    }
  }, [reconnectBaseDelayMs, reconnectMaxDelayMs])

  return { status }
}
