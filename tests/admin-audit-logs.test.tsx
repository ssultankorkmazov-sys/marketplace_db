import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { AdminAuditLogs } from '../src/pages/AdminAuditLogs'

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('admin audit log filters', () => {
  it.each(['ADMIN_ANOMALIES_ACCESS_DENIED', 'ANOMALY_STATUS_CHANGED'])(
    'offers and requests the %s action filter', async (action) => {
      class FakeWebSocket { onopen: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null; close() {} }
      vi.stubGlobal('WebSocket', FakeWebSocket)
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), window.location.href)
        const selectedAction = url.searchParams.get('action')
        return json({
          logs: selectedAction ? [{ log_id: '91', user_id: 8, action: selectedAction, entity_type: 'anomaly_incident', entity_id: 17, status: 'SUCCESS', details: {}, ip_address: null, created_at: '2026-11-01T10:00:00.000Z' }] : [],
          page: 1, pageSize: 25, total: selectedAction ? 1 : 0, successful: selectedAction ? 1 : 0, failed: 0, totalPages: 1,
        })
      })
      vi.stubGlobal('fetch', fetchMock)
      render(<BrowserRouter><AdminAuditLogs/></BrowserRouter>)

      const filter = await screen.findByLabelText('Тип действия')
      fireEvent.change(filter, { target: { value: action } })
      await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => new URL(String(input), window.location.href).searchParams.get('action') === action)).toBe(true))
      expect(screen.getByRole('option', { name: action.toLowerCase().replace(/_/g, ' ') })).toBeTruthy()
      await waitFor(() => expect(screen.getAllByText(action.toLowerCase().replace(/_/g, ' ')).length).toBeGreaterThan(1))
    },
  )
})
