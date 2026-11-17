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
const emptyShadowStatus = {
  experimental: true as const, operational: false as const, enabled: false, storage_available: true as const,
  profile_version: null, latest_evaluation_at: null,
  evaluation_counts: { SUFFICIENT_DATA: 0, INSUFFICIENT_DATA: 0, WORK_LIMIT_EXCEEDED: 0, EVALUATION_ERROR: 0 },
}
const emptyShadowPage = { evaluations: [], page: 1, pageSize: 10, total: 0, totalPages: 0 }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('admin anomaly dashboard', () => {
  it('shows server incidents and overview, applies supported filters, and loads evidence and recommendations', async () => {
    class FakeWebSocket { onopen: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null; close() {} }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/admin/anomalies/queue-stats')) return json({ pending: 3, processed: 21, dead_letter: 2, processing_errors: 4, last_processed_at: '2026-10-31T10:01:00.000Z' })
      if (url.pathname.endsWith('/admin/anomalies/statistical-status')) return json(statisticalStatus)
      if (url.pathname.endsWith('/admin/anomalies/shadow/status')) return json(emptyShadowStatus)
      if (url.pathname.endsWith('/admin/anomalies/shadow/evaluations')) return json(emptyShadowPage)
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
      if (url.pathname.endsWith('/admin/anomalies/shadow/status')) return json(emptyShadowStatus)
      if (url.pathname.endsWith('/admin/anomalies/shadow/evaluations')) return json(emptyShadowPage)
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
      if (url.pathname.endsWith('/admin/anomalies/shadow/status')) return json(emptyShadowStatus)
      if (url.pathname.endsWith('/admin/anomalies/shadow/evaluations')) return json(emptyShadowPage)
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

  it('shows saved Shadow Mode measurements and labels incident matches as temporal correlations', async () => {
    const shadowStatus = {
      experimental: true, operational: false, enabled: true, storage_available: true,
      profile_version: 'shadow-v1', latest_evaluation_at: '2026-11-01T10:00:00.000Z',
      evaluation_counts: { SUFFICIENT_DATA: 2, INSUFFICIENT_DATA: 1, WORK_LIMIT_EXCEEDED: 0, EVALUATION_ERROR: 0 },
    }
    const evaluation = {
      evaluation_id: '123', profile_version: 'shadow-v1', subject_user_id: 8,
      evaluated_at: '2026-11-01T10:00:00.000Z', baseline_start_at: '2026-10-01T10:00:00.000Z',
      baseline_end_at: '2026-10-31T10:00:00.000Z', current_start_at: '2026-10-31T10:00:00.000Z',
      current_end_at: '2026-11-01T10:00:00.000Z', baseline_observations: 60, current_observations: 24,
      baseline_distribution: { AUTH: 0.7, ORDER: 0.1, ADMIN_DENIED: 0.05, PRODUCT_ADMIN: 0.05, OTHER: 0.1 },
      current_distribution: { AUTH: 0.2, ORDER: 0.6, ADMIN_DENIED: 0.1, PRODUCT_ADMIN: 0.05, OTHER: 0.05 },
      divergence: 0.42, category_contributions: { AUTH: 0.1, ORDER: 0.2, ADMIN_DENIED: 0.05, PRODUCT_ADMIN: 0.01, OTHER: 0.06 },
      evaluation_status: 'SUFFICIENT_DATA', sample_counts_capped: false, recorded_at: '2026-11-01T10:00:01.000Z',
      matching_incidents: [{ incident_id: '41', anomaly_type: 'REPEATED_FAILED_LOGINS', status: 'NEW', severity: 'MEDIUM', detected_at: '2026-10-31T12:00:00.000Z', correlation_basis: 'SAME_USER_AND_OVERLAPPING_EVENT_TIME' }],
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/shadow/status')) return json(shadowStatus)
      if (url.pathname.endsWith('/shadow/evaluations')) return json({ evaluations: [evaluation], page: Number(url.searchParams.get('page') ?? 1), pageSize: 10, total: 11, totalPages: 2 })
      return json(statisticalStatus)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<StatisticalDetectorPanel snapshot={statisticalStatus} loading={false} error=""/>)

    expect((await screen.findAllByText('shadow-v1')).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Режим включён').parentElement?.textContent).toContain('Да')
    expect(screen.getByText('Jeffreys divergence').parentElement?.textContent).toContain('0.4200')
    expect(screen.getByText('Shadow baseline observations').parentElement?.textContent).toContain('60')
    expect(screen.getByText(/Только временная корреляция/)).toBeTruthy()
    expect(screen.getByText(/не являются доказательством атаки/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Профиль Shadow Mode'), { target: { value: 'shadow-v1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Применить фильтры' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('profile=shadow-v1'))).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница истории Shadow Mode' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('page=2'))).toBe(true))
  })

  it('shows empty, loading and API error states for Shadow Mode history', async () => {
    const emptyStatus = {
      experimental: true, operational: false, enabled: false, storage_available: true,
      profile_version: null, latest_evaluation_at: null,
      evaluation_counts: { SUFFICIENT_DATA: 0, INSUFFICIENT_DATA: 0, WORK_LIMIT_EXCEEDED: 0, EVALUATION_ERROR: 0 },
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/shadow/status')) return json(emptyStatus)
      if (url.pathname.endsWith('/shadow/evaluations')) return json({ evaluations: [], page: 1, pageSize: 10, total: 0, totalPages: 0 })
      return json(statisticalStatus)
    }))
    render(<StatisticalDetectorPanel snapshot={statisticalStatus} loading={false} error=""/>)
    expect(await screen.findByText('Сохранённых оценок по выбранным фильтрам нет.')).toBeTruthy()
    cleanup()

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/shadow/status')) return json({ error: 'Shadow storage unavailable' }, 503)
      if (url.pathname.endsWith('/shadow/evaluations')) return json({ error: 'Shadow history unavailable' }, 503)
      return json(statisticalStatus)
    }))
    render(<StatisticalDetectorPanel snapshot={statisticalStatus} loading={false} error=""/>)
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    expect(screen.getByText(/Shadow storage unavailable/)).toBeTruthy()
    expect(screen.getByText(/Shadow history unavailable/)).toBeTruthy()
  })

  it('shows Shadow Mode loading state while the API requests are pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)))
    render(<StatisticalDetectorPanel snapshot={statisticalStatus} loading={false} error=""/>)
    expect(screen.getByText('Загрузка состояния Shadow Mode…')).toBeTruthy()
    expect(screen.getByText('Загрузка истории…')).toBeTruthy()
  })
})
