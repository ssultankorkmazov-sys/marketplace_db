import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { AdminAnomalies } from '../src/pages/AdminAnomalies'
import { StatisticalDetectorPanel } from '../src/components/admin/StatisticalDetectorPanel'
import type { StatisticalAnomalySnapshot } from '../src/api/client'

const incident = {
  incident_id: '17', anomaly_type: 'REPEATED_FAILED_LOGINS', subject_user_id: 8, severity: 'HIGH', risk_score: 75, status: 'NEW',
  detected_at: '2026-10-31T10:00:00.000Z', updated_at: '2026-10-31T10:00:00.000Z', first_event_at: '2026-10-31T09:59:00.000Z', last_event_at: '2026-10-31T10:00:00.000Z',
  evidence: { subject_user_id: 8, event_count: 6, threshold: 5, window_seconds: 120, window_start: '2026-10-31T09:59:00.000Z', window_end: '2026-10-31T10:00:00.000Z', audit_log_ids: ['1', '2'] },
  explanation: 'Six failed sign-in events exceeded the configured threshold.',
  recommendations: [{ action: 'Review recent sign-in activity.', reason: 'Six failures were recorded for one account.', priority: 'HIGH', verification_step: 'Confirm further failures stop.' }],
  deduplication_key: 'REPEATED_FAILED_LOGINS:user:8', audit_log_ids: ['1', '2'],
  timeline: [{ log_id: '1', created_at: '2026-10-31T09:59:10.000Z', action: 'LOGIN_FAILED', status: 'FAILURE', entity_type: 'user', entity_id: 8 }],
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const statisticalStatus: StatisticalAnomalySnapshot = {
  detector: 'JEFFREYS_DIVERGENCE', experimental: true, operational: false,
  detector_status: 'DISABLED', calibration_status: 'NOT_RUN', calibration_sufficient: false,
  divergence: null, baseline: { sample_count: null, distribution: null }, current: { sample_count: null, distribution: null },
  category_contributions: null, evaluated_at: null,
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('admin anomaly dashboard', () => {
  it('shows server incidents and overview, applies supported filters, and loads evidence and recommendations', async () => {
    class FakeWebSocket { onopen: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null; close() {} }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/admin/anomalies/queue-stats')) return json({ pending: 3, processed: 21, dead_letter: 2, processing_errors: 4, last_processed_at: '2026-10-31T10:01:00.000Z' })
      if (url.pathname.endsWith('/admin/anomalies/statistical-status')) return json(statisticalStatus)
      if (url.pathname.endsWith('/admin/anomalies/17')) return json({ incident })
      const status = url.searchParams.get('status')
      return json({ incidents: [incident], page: Number(url.searchParams.get('page') ?? 1), pageSize: Number(url.searchParams.get('pageSize') ?? 20), total: status === 'NEW' ? 1 : 2, low: 0, medium: 1, high: 1, critical: 0, totalPages: url.searchParams.get('pageSize') === '1' ? 1 : 2 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BrowserRouter><AdminAnomalies/></BrowserRouter>)

    expect(await screen.findByText('Повторные ошибки входа')).toBeTruthy()
    expect(await screen.findByText('Высокий и критический риск')).toBeTruthy()
    expect(await screen.findByText('Jeffreys Divergence · эксперимент')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Выключен конфигурацией')
    expect(screen.getByText('Не используется для обнаружения инцидентов')).toBeTruthy()
    expect(screen.getByText('Pending').parentElement?.textContent).toContain('3')
    expect(screen.getByText('Processed').parentElement?.textContent).toContain('21')
    expect(screen.getByText('Dead-letter').parentElement?.textContent).toContain('2')
    expect(screen.getByText('Ошибки обработки').parentElement?.textContent).toContain('4')
    expect(screen.getByText('Последняя обработка').parentElement?.textContent).toContain('31.10.2026')
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('page=2'))).toBe(true))
    fireEvent.change(screen.getByLabelText('Фильтр по уровню риска'), { target: { value: 'HIGH' } })
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('severity=HIGH'))).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'Детали' }))
    expect(await screen.findByText('Six failed sign-in events exceeded the configured threshold.')).toBeTruthy()
    expect(screen.getByText('Review recent sign-in activity.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Хронология событий' })).toBeTruthy()
    expect(screen.getByText('login failed')).toBeTruthy()
    expect(screen.getByText('Ошибка')).toBeTruthy()
    expect(screen.getByText(/Событие #1 · user #8/)).toBeTruthy()
    expect(screen.queryByText(/ip_address|details/i)).toBeNull()
  })

  it('confirms status changes and sends them through the API', async () => {
    class FakeWebSocket { onopen: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null; close() {} }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let savedStatus = 'NEW'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/admin/anomalies/queue-stats')) return json({ pending: 0, processed: 0, dead_letter: 0, processing_errors: 0, last_processed_at: null })
      if (url.pathname.endsWith('/admin/anomalies/statistical-status')) return json(statisticalStatus)
      if (url.pathname.endsWith('/status')) {
        savedStatus = JSON.parse(String(init?.body)).status
        return json({ incident: { incident_id: '17', status: savedStatus } })
      }
      if (url.pathname.endsWith('/admin/anomalies/17')) return json({ incident: { ...incident, status: savedStatus } })
      const status = url.searchParams.get('status')
      return json({ incidents: [{ ...incident, status: savedStatus }], page: 1, pageSize: 20, total: status === 'NEW' ? (savedStatus === 'NEW' ? 1 : 0) : 1, low: 0, medium: 0, high: 1, critical: 0, totalPages: 1 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BrowserRouter><AdminAnomalies/></BrowserRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Детали' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Отметить решённым' }))

    await waitFor(() => expect(savedStatus).toBe('RESOLVED'))
    expect(window.confirm).toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/admin/anomalies/17/status') && init?.method === 'PATCH')).toBe(true)
    expect(await screen.findByText('Статус инцидента #17 обновлён.')).toBeTruthy()
  })

  it('shows a queue-specific error when queue statistics cannot be loaded', async () => {
    class FakeWebSocket { onopen: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null; close() {} }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/admin/anomalies/queue-stats')) return json({ error: 'Queue unavailable' }, 503)
      if (url.pathname.endsWith('/admin/anomalies/statistical-status')) return json(statisticalStatus)
      return json({ incidents: [], page: 1, pageSize: 20, total: 0, low: 0, medium: 0, high: 0, critical: 0, totalPages: 0 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BrowserRouter><AdminAnomalies/></BrowserRouter>)

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Queue unavailable')
  })

  it('clearly renders an insufficient-data experimental result without presenting it as operational', () => {
    const insufficient: StatisticalAnomalySnapshot = {
      ...statisticalStatus,
      detector_status: 'INSUFFICIENT_DATA', calibration_status: 'INSUFFICIENT_DATA',
      baseline: { sample_count: 12, distribution: null }, current: { sample_count: 4, distribution: null },
    }
    render(<StatisticalDetectorPanel snapshot={insufficient} loading={false} error=""/>)

    expect(screen.getByRole('status').textContent).toContain('Недостаточно данных для оценки')
    expect(screen.getByText('Baseline observations').parentElement?.textContent).toContain('12')
    expect(screen.getByText('Current observations').parentElement?.textContent).toContain('4')
    expect(screen.getByText('Калибровка: недостаточно данных')).toBeTruthy()
    expect(screen.getByText('Не используется для обнаружения инцидентов')).toBeTruthy()
  })
})
