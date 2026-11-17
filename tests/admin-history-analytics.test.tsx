import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AuthProvider } from '../src/context/Auth'
import { StoreProvider } from '../src/context/Store'
import App from '../src/App'
import { AdminHistoryAnalytics } from '../src/pages/AdminHistoryAnalytics'

const report = JSON.parse(readFileSync(resolve(process.cwd(), 'public/demo/smart-replenishment.json'), 'utf8'))
const dailySales = JSON.parse(readFileSync(resolve(process.cwd(), 'public/demo/synthetic-sales-daily.json'), 'utf8'))
const run = { run_id: '4', source: 'SYNTHETIC', model_name: 'xgboost-demo', model_version: null, forecast_start: '2026-07-01', forecast_end: '2026-07-28', review_period_days: 7, created_at: '2026-11-17T10:00:00Z', created_by_user_id: 6, created_by_name: 'Admin', recommendation_count: 1, accepted_count: 1, rejected_count: 0, pending_count: 0 }
const evaluation = { evaluation_id: '9', profile_version: 'shadow-v1', subject_user_id: 12, evaluated_at: '2026-11-16T10:00:00Z', baseline_start_at: '2026-10-17T10:00:00Z', baseline_end_at: '2026-11-15T10:00:00Z', current_start_at: '2026-11-15T10:00:00Z', current_end_at: '2026-11-16T10:00:00Z', baseline_observations: 72, current_observations: 24, baseline_distribution: null, current_distribution: null, divergence: 0.42, category_contributions: null, evaluation_status: 'SUFFICIENT_DATA', sample_counts_capped: false, recorded_at: '2026-11-16T10:00:01Z', matching_incidents: [] }
const shadowStatus = { experimental: true, operational: false, enabled: true, storage_available: true, profile_version: 'shadow-v1', latest_evaluation_at: evaluation.evaluated_at, evaluation_counts: { SUFFICIENT_DATA: 1, INSUFFICIENT_DATA: 0, WORK_LIMIT_EXCEEDED: 0, EVALUATION_ERROR: 0 } }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const admin = { user_id: 6, name: 'Admin', email: 'admin@example.kz', phone: '+77000000006', address: null, role: 'admin' }
const user = { ...admin, user_id: 7, role: 'user' }
let currentUser: typeof admin | typeof user = admin

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
beforeEach(() => { currentUser = admin; window.history.replaceState({}, '', '/') })

function responseFor(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), window.location.href)
  if (url.pathname.endsWith('/demo/synthetic-sales-daily.json')) return json(dailySales)
  if (url.pathname.endsWith('/admin/replenishment/demo')) return json(report)
  if (url.pathname.endsWith('/admin/replenishment/runs') && init?.method !== 'POST') return json({ runs: [run], page: 1, pageSize: 10, total: 1, totalPages: 1 })
  if (url.pathname.endsWith('/runs/4/recommendations')) return json({ run_id: '4', recommendations: [{ ...report.recommendations[0], recommendation_id: '20', recommendation_index: 0, decision_status: 'ACCEPTED', decided_at: '2026-11-17T11:00:00Z', decided_by_user_id: 6, decided_by_name: 'Admin' }], page: 1, pageSize: 20, total: 1, totalPages: 1 })
  if (url.pathname.endsWith('/admin/anomalies/shadow/status')) return json(shadowStatus)
  if (url.pathname.endsWith('/admin/anomalies/shadow/evaluations')) return json({ evaluations: [evaluation], page: Number(url.searchParams.get('page') ?? 1), pageSize: 10, total: 1, totalPages: 1 })
  if (url.pathname.endsWith('/auth/me')) return json({ user: currentUser })
  if (url.pathname.endsWith('/products')) return json({ items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 })
  if (url.pathname.endsWith('/categories')) return json([])
  return json({ error: 'Unexpected request' }, 500)
}

describe('History & Analytics dashboard', () => {
  it('shows real rows from the synthetic daily fixture and report without fabricating a chart', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => responseFor(input, init)))
    render(<BrowserRouter><AdminHistoryAnalytics/></BrowserRouter>)
    expect(await screen.findByRole('heading', { name: 'History & Analytics' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Школьный рюкзак (SYN-P001)' })).toBeTruthy()
    expect(screen.getAllByText('Школьный рюкзак').length).toBeGreaterThan(0)
    expect(screen.getByText('Дневные записанные продажи').parentElement?.textContent).toContain('8 760')
    expect(screen.getByRole('img', { name: /Ежедневные синтетические продажи/ })).toBeTruthy()
    expect(await screen.findByText('Прогноз спроса и рекомендации replenishment')).toBeTruthy()
  })

  it('shows replenishment snapshots read-only and experimental Jeffreys history', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => responseFor(input, init))
    vi.stubGlobal('fetch', fetchMock)
    render(<BrowserRouter><AdminHistoryAnalytics/></BrowserRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    fireEvent.click(await screen.findByRole('button', { name: /Запуск #4/ }))
    expect(await screen.findByText('Принято')).toBeTruthy()
    expect(screen.getByText('Jeffreys Shadow Mode evaluations')).toBeTruthy()
    expect(screen.getByText(/EXPERIMENTAL/)).toBeTruthy()
    expect(await screen.findByText('0.4200')).toBeTruthy()
    expect(fetchMock.mock.calls.some(([, init]) => ['PATCH', 'POST', 'DELETE'].includes(init?.method ?? ''))).toBe(false)
    fireEvent.change(screen.getByLabelText('Статус оценки'), { target: { value: 'SUFFICIENT_DATA' } })
    fireEvent.click(screen.getByRole('button', { name: 'Фильтровать оценки' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('status=SUFFICIENT_DATA'))).toBe(true))
  })

  it('keeps the new route admin-protected and linked in navigation', async () => {
    currentUser = user
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => responseFor(input, init)))
    window.history.pushState({}, '', '/admin/history-analytics')
    const mount = () => render(<BrowserRouter><AuthProvider><StoreProvider><App/></StoreProvider></AuthProvider></BrowserRouter>)
    mount()
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    cleanup()
    currentUser = admin
    window.history.pushState({}, '', '/admin')
    mount()
    fireEvent.click(await screen.findByRole('link', { name: /History & Analytics/ }))
    expect(await screen.findByRole('heading', { name: 'History & Analytics' })).toBeTruthy()
  })
})
