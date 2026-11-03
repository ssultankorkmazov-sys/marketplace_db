import { useEffect, useRef, useState } from 'react'
import { auditWebSocketUrl, type AnomalyIncident, type AuditLog } from '../api/client'

export type AdminRealtimeEvent = { type: 'connected' } | { type: 'audit_log'; log: AuditLog } | { type: 'anomaly_incident'; incident: AnomalyIncident }

/** Reconnecting admin event stream shared by admin pages. The server authenticates via the session cookie. */
export function useAdminRealtime(onEvent: (event: AdminRealtimeEvent) => void) {
  const [connected, setConnected] = useState(false)
  const callback = useRef(onEvent)
  useEffect(() => { callback.current = onEvent }, [onEvent])

  useEffect(() => {
    let stopped = false
    let socket: WebSocket | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const connect = () => {
      if (stopped) return
      socket = new WebSocket(auditWebSocketUrl())
      socket.onopen = () => { attempts = 0; setConnected(true) }
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as AdminRealtimeEvent
          if (event && (event.type === 'connected' || event.type === 'audit_log' || event.type === 'anomaly_incident')) callback.current(event)
        } catch { /* REST remains the source of truth if an event cannot be parsed. */ }
      }
      socket.onclose = () => {
        setConnected(false)
        if (!stopped) {
          reconnectTimer = setTimeout(connect, Math.min(1_000 * 2 ** attempts, 30_000))
          attempts += 1
        }
      }
      socket.onerror = () => socket?.close()
    }
    connect()
    return () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
      setConnected(false)
    }
  }, [])

  return connected
}
