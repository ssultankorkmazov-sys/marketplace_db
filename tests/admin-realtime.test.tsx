import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { useAdminRealtime } from '../src/hooks/useAdminRealtime'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('shared admin realtime stream', () => {
  it('reports connected only after the socket opens and delivers anomaly events', async () => {
    class FakeWebSocket {
      static instance: FakeWebSocket
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onclose: (() => void) | null = null
      onerror: (() => void) | null = null
      close() {}
      constructor() { FakeWebSocket.instance = this }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    function Harness() {
      const [events, setEvents] = useState(0)
      const connected = useAdminRealtime((event) => { if (event.type === 'anomaly_incident') setEvents((count) => count + 1) })
      return <div><span>{connected ? 'connected' : 'disconnected'}</span><span>events:{events}</span></div>
    }
    render(<Harness/>)
    expect(screen.getByText('disconnected')).toBeTruthy()
    FakeWebSocket.instance.onopen?.()
    await waitFor(() => expect(screen.getByText('connected')).toBeTruthy())
    FakeWebSocket.instance.onmessage?.({ data: JSON.stringify({ type: 'anomaly_incident', incident: { incident_id: '3' } }) })
    await waitFor(() => expect(screen.getByText('events:1')).toBeTruthy())
  })
})
