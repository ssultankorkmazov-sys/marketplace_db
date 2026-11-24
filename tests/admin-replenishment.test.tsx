import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AuthProvider } from '../src/context/Auth'
import { StoreProvider } from '../src/context/Store'
import App from '../src/App'
import { AdminReplenishment, parseReplenishmentReport } from '../src/pages/AdminReplenishment'

const reportPath = resolve(process.cwd(), 'public/demo/smart-replenishment.json')
const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as Record<string, any>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const admin = { user_id: 10, name: 'Admin', email: 'admin@example.kz', phone: '+77000000010', address: null, role: 'admin' }
const user = { ...admin, user_id: 11, role: 'user' }
const run = { run_id: '7', source: 'SYNTHETIC', model_name: 'xgboost-demo', model_version: null, forecast_start: '2026-07-01', forecast_end: '2026-07-28', review_period_days: 7, created_at: '2026-11-17T12:00:00Z', created_by_user_id: 10, created_by_name: 'Admin', recommendation_count: 1, accepted_count: 0, rejected_count: 0, pending_count: 1 }
const savedRecommendation = { ...report.recommendations.find((item: Record<string, unknown>) => item.recommendation_status === 'PURCHASE_RECOMMENDED'), recommendation_id: '31', recommendation_index: 0, decision_status: 'PENDING', decided_at: null, decided_by_user_id: null, decided_by_name: null }
const page = (runs = [], total = runs.length, pageNo = 1, totalPages = total ? 1 : 0) => ({ runs, total, page: pageNo, pageSize: 10, totalPages })
const forecastRow = {
  product_id: 42, name: 'Чай', stock_quantity: 10, available_stock: 10, delivered_90d: 12, open_orders: 3, sales_180d: 24, processing_orders: 3,
  forecast_30d: 4, safety_stock: 2, recommended_purchase: 1, procurement_status: 'REORDER',
  data_status: 'READY', sales_history_observations: 4, sales_observation_days_180d: 3, history_days_available: 180,
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
beforeEach(() => { window.history.replaceState({}, '', '/') })

function initialFetch(input: RequestInfo | URL) {
  const url = new URL(String(input), window.location.href)
  if (url.pathname.endsWith('/admin/replenishment/demo')) return json(report)
  if (url.pathname.endsWith('/admin/replenishment/runs')) return json(page())
  if (url.pathname.endsWith('/admin/procurement/forecast')) return json({ forecast: [forecastRow], total: 1 })
  return json({ error: 'Unexpected request' }, 500)
}

describe('Smart Replenishment synthetic history dashboard', () => {
  it('shows the backend procurement forecast and keeps the synthetic and history sections', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => initialFetch(input)))
    render(<BrowserRouter><AdminReplenishment/></BrowserRouter>)

    expect(await screen.findByRole('heading', { name: 'Smart Replenishment' })).toBeTruthy()
    expect(await screen.findByText('Прогноз закупок по реальным данным')).toBeTruthy()
    expect(screen.getByText('Чай')).toBeTruthy()
    expect(screen.getByText('Окно 180 дней и продажи в ≥2 дня')).toBeTruthy()
    expect(screen.getByText('Источник: SYNTHETIC.')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'История запусков' })).toBeTruthy()
  })

  it('shows loading, error and empty states for the live procurement API without synthetic fallback', async () => {
    const delayedFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/admin/procurement/forecast')) return await new Promise<Response>(() => {})
      return initialFetch(input)
    })
    vi.stubGlobal('fetch', delayedFetch)
    const view = render(<BrowserRouter><AdminReplenishment/></BrowserRouter>)
    expect(await screen.findByText('Загрузка прогноза закупок…')).toBeTruthy()
    view.unmount()

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.href)
      return url.pathname.endsWith('/admin/procurement/forecast') ? json({ error: 'unavailable' }, 503) : initialFetch(input)
    }))
    render(<BrowserRouter><AdminReplenishment/></BrowserRouter>)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Чай')).toBeNull()
    cleanup()

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.href)
      return url.pathname.endsWith('/admin/procurement/forecast') ? json({ forecast: [], total: 0 }) : initialFetch(input)
    }))
    render(<BrowserRouter><AdminReplenishment/></BrowserRouter>)
    expect(await screen.findByText(/VIEW не вернул товаров/)).toBeTruthy()
  })

  it('does not show purchase forecasts for insufficient history but retains stock and processing orders', async () => {
    const insufficient = { ...forecastRow, data_status: 'INSUFFICIENT_DATA', history_days_available: 70, forecast_30d: null, safety_stock: null, recommended_purchase: null, procurement_status: null }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.href)
      return url.pathname.endsWith('/admin/procurement/forecast') ? json({ forecast: [insufficient], total: 1 }) : initialFetch(input)
    }))
    render(<BrowserRouter><AdminReplenishment/></BrowserRouter>)
    const row = await screen.findByText('Чай')
    const tableRow = row.closest('tr')
    expect(tableRow?.textContent).toContain('Недостаточно истории')
    expect(tableRow?.textContent).toContain('10')
    expect(tableRow?.textContent).toContain('3')
    expect(tableRow?.textContent).toContain('—')
  })

  it('loads the synthetic preview and history without creating a run automatically', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => initialFetch(input))
    vi.stubGlobal('fetch', fetchMock)
    render(<BrowserRouter><AdminReplenishment/></BrowserRouter>)
    expect(await screen.findByRole('heading', { name: 'Smart Replenishment' })).toBeTruthy()
    expect(screen.getByText('Источник: SYNTHETIC.')).toBeTruthy()
    expect(screen.getByText(/These recommendations do not represent real MarketKZ stock/)).toBeTruthy()
    expect(screen.getByText('Синтетические товары').parentElement?.textContent).toContain('12')
    expect(screen.getByText('Альтернативы поставщиков').parentElement?.textContent).toContain('24')
    expect(screen.getByText('Товаров с рекомендацией закупки').parentElement?.textContent).toContain('11')
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/admin/replenishment/runs?'))).toBe(true)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/admin/replenishment/demo'))).toBe(true)
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('creates a run only after explicit action and selects its saved recommendation snapshot', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/admin/replenishment/demo')) return json(report)
      if (url.pathname.endsWith('/admin/replenishment/runs') && init?.method === 'POST') return json({ run })
      if (url.pathname.endsWith('/admin/replenishment/runs') && url.searchParams.get('page') === '1') return json(page([run], 1))
      if (url.pathname.endsWith('/runs/7/recommendations')) return json({ run_id: '7', recommendations: [savedRecommendation], page: 1, pageSize: 20, total: 1, totalPages: 1 })
      return json({ error: 'Unexpected request' }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BrowserRouter><AdminReplenishment/></BrowserRouter>)
    await screen.findByRole('heading', { name: 'Smart Replenishment' })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить новый запуск' }))
    expect(await screen.findByText(/Снимок сохранён как запуск #7/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Запуск #7/ })).toBeTruthy()
    expect(screen.getByText('Школьный рюкзак · Steppe Wholesale')).toBeTruthy()
    expect(screen.getByText('Товар SYN-P001 · поставщик SYN-SUP-001 · 7 дней доставки · источник SYNTHETIC')).toBeTruthy()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true)
  })

  it('paginates run history and loads recommendations only after selecting a run', async () => {
    const secondRun = { ...run, run_id: '6' }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/admin/replenishment/demo')) return json(report)
      if (url.pathname.endsWith('/admin/replenishment/runs')) return url.searchParams.get('page') === '1' ? json(page([run], 2, 1, 2)) : json(page([secondRun], 2, 2, 2))
      if (url.pathname.endsWith('/runs/6/recommendations')) return json({ run_id: '6', recommendations: [savedRecommendation], page: 1, pageSize: 20, total: 1, totalPages: 1 })
      return json({ error: 'Unexpected request' }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BrowserRouter><AdminReplenishment/></BrowserRouter>)
    await screen.findByRole('button', { name: /Запуск #7/ })
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
    expect(await screen.findByRole('button', { name: /Запуск #6/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Запуск #6/ }))
    expect(await screen.findByText('Школьный рюкзак · Steppe Wholesale')).toBeTruthy()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/runs/6/recommendations'))).toBe(true)
  })

  it('falls back to the synthetic ID for an older saved snapshot without product_name', async () => {
    const legacyRecommendation = Object.fromEntries(Object.entries(savedRecommendation).filter(([key]) => key !== 'product_name'))
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/admin/replenishment/demo')) return json(report)
      if (url.pathname.endsWith('/admin/replenishment/runs')) return json(page([run], 1))
      if (url.pathname.endsWith('/runs/7/recommendations')) return json({ run_id: '7', recommendations: [legacyRecommendation], page: 1, pageSize: 20, total: 1, totalPages: 1 })
      return json({ error: 'Unexpected request' }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BrowserRouter><AdminReplenishment/></BrowserRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Запуск #7/ }))
    expect(await screen.findByText('SYN-P001 · Steppe Wholesale')).toBeTruthy()
    expect(screen.getByText('Товар SYN-P001 · поставщик SYN-SUP-001 · 7 дней доставки · источник SYNTHETIC')).toBeTruthy()
  })

  it('keeps alternatives separate and filters preview rows locally', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => initialFetch(input)))
    render(<BrowserRouter><AdminReplenishment/></BrowserRouter>)
    await screen.findByRole('heading', { name: 'Smart Replenishment' })
    fireEvent.change(screen.getByLabelText('Фильтр по товару'), { target: { value: 'SYN-P001' } })
    expect(screen.getByText('Школьный рюкзак · Steppe Wholesale')).toBeTruthy()
    expect(screen.getByText('Школьный рюкзак · Alatau Distribution')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Фильтр по поставщику'), { target: { value: 'Steppe Wholesale' } })
    expect(screen.queryByText('Школьный рюкзак · Alatau Distribution')).toBeNull()
    fireEvent.change(screen.getByLabelText('Фильтр по статусу рекомендации'), { target: { value: 'PURCHASE_RECOMMENDED' } })
    expect(screen.getAllByRole('article').some(card => card.textContent?.includes('Закупка не нужна'))).toBe(false)
  })

  it('shows pending, accepted, rejected and controls only for eligible pending recommendations', async () => {
    const accepted = { ...savedRecommendation, decision_status: 'ACCEPTED', decided_at: '2026-11-17T12:30:00Z', decided_by_user_id: 10, decided_by_name: 'Admin' }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/admin/replenishment/demo')) return json(report)
      if (url.pathname.endsWith('/admin/replenishment/runs')) return json(page([run], 1))
      if (url.pathname.endsWith('/runs/7/recommendations')) return json({ run_id: '7', recommendations: [savedRecommendation, { ...savedRecommendation, recommendation_id: '32', recommendation_status: 'NO_PURCHASE_NEEDED' }, { ...savedRecommendation, recommendation_id: '33', decision_status: 'REJECTED' }, { ...accepted, recommendation_id: '34' }], page: 1, pageSize: 20, total: 4, totalPages: 1 })
      return json({ error: 'Unexpected request' }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BrowserRouter><AdminReplenishment/></BrowserRouter>)
    await screen.findByRole('button', { name: /Запуск #7/ })
    fireEvent.click(screen.getByRole('button', { name: /Запуск #7/ }))
    await screen.findAllByRole('button', { name: 'Принять рекомендацию' })
    expect(screen.getAllByRole('button', { name: 'Принять рекомендацию' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Отклонить' })).toHaveLength(1)
    expect(screen.getByText(/администратор Admin/)).toBeTruthy()
    expect(screen.getAllByText('Принято администратором').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Отклонено администратором').length).toBeGreaterThan(0)
  })

  it('refreshes saved details after a decision and does not claim success on conflict', async () => {
    let conflicting = false
    let detailCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/admin/replenishment/demo')) return json(report)
      if (url.pathname.endsWith('/admin/replenishment/runs')) return json(page([run], 1))
      if (url.pathname.endsWith('/runs/7/recommendations')) {
        detailCalls++
        const row = conflicting ? { ...savedRecommendation, decision_status: 'ACCEPTED', decided_at: '2026-11-17T12:30:00Z', decided_by_user_id: 10, decided_by_name: 'Admin' } : savedRecommendation
        return json({ run_id: '7', recommendations: [row], page: 1, pageSize: 20, total: 1, totalPages: 1 })
      }
      if (url.pathname.endsWith('/decision') && init?.method === 'PATCH') {
        if (conflicting) return json({ error: 'Conflict' }, 409)
        conflicting = true; return json({ decision: { decision: 'ACCEPTED', decided_at: '2026-11-17T12:30:00Z', decided_by_user_id: 10 }, already_recorded: false })
      }
      return json({ error: 'Unexpected request' }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BrowserRouter><AdminReplenishment/></BrowserRouter>)
    await screen.findByRole('button', { name: /Запуск #7/ }); fireEvent.click(screen.getByRole('button', { name: /Запуск #7/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Принять рекомендацию' }))
    expect(await screen.findByText('Решение сохранено. Заказ и остатки не изменены.')).toBeTruthy()
    await waitFor(() => expect(detailCalls).toBeGreaterThan(1))
    expect(screen.queryByRole('button', { name: 'Принять рекомендацию' })).toBeNull()
    expect(screen.getAllByText('Принято администратором').length).toBeGreaterThan(0)
    expect(screen.getByText(/администратор Admin/)).toBeTruthy()
    expect(screen.queryByText(/противоположное решение/)).toBeNull()
  })

  it('handles HTTP 409 without displaying a success message', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/admin/replenishment/demo')) return json(report)
      if (url.pathname.endsWith('/admin/replenishment/runs')) return json(page([run], 1))
      if (url.pathname.endsWith('/runs/7/recommendations')) return json({ run_id: '7', recommendations: [savedRecommendation], page: 1, pageSize: 20, total: 1, totalPages: 1 })
      if (url.pathname.endsWith('/decision') && init?.method === 'PATCH') return json({ error: 'Conflict' }, 409)
      return json({ error: 'Unexpected request' }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BrowserRouter><AdminReplenishment/></BrowserRouter>)
    await screen.findByRole('button', { name: /Запуск #7/ }); fireEvent.click(screen.getByRole('button', { name: /Запуск #7/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Принять рекомендацию' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/противоположное решение/)).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('does not invent results for insufficient forecasts and shows load errors', async () => {
    const insufficient = structuredClone(report)
    const row = insufficient.recommendations.find((item: Record<string, unknown>) => item.synthetic_product_id === 'SYN-P001' && item.supplier_id === 'SYN-SUP-001')
    Object.assign(row, { forecast_demand: null, recommended_quantity: null, estimated_cost: null, recommendation_status: 'INSUFFICIENT_FORECAST', explanation: 'Недостаточно прогноза для срока покрытия.' })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/demo')) return json(insufficient)
      if (String(input).includes('/admin/procurement/forecast')) return json({ forecast: [forecastRow], total: 1 })
      return json(page())
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<BrowserRouter><AdminReplenishment/></BrowserRouter>)
    await screen.findAllByText('Недостаточно прогноза')
    const insufficientCard = screen.getAllByRole('article').find(card => card.textContent?.includes('SYN-P001') && card.textContent.includes('Недостаточно прогноза'))
    expect(insufficientCard?.textContent).toContain('Прогноз: —')
    expect(insufficientCard?.textContent).toContain('Заказать: —')
    expect(insufficientCard?.textContent).toContain('Стоимость: —')
    cleanup()
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Service unavailable' }, 503)))
    render(<BrowserRouter><AdminReplenishment/></BrowserRouter>)
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('keeps the route protected by admin role and the navigation link available', async () => {
    let currentUser = user
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/auth/me')) return json({ user: currentUser })
      if (url.pathname.endsWith('/admin/replenishment/demo')) return json(report)
      if (url.pathname.endsWith('/admin/replenishment/runs')) return json(page())
      if (url.pathname.endsWith('/products')) return json({ items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 })
      if (url.pathname.endsWith('/categories')) return json([])
      return json({ error: 'Unexpected request' }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/admin/replenishment')
    const app = () => render(<BrowserRouter><AuthProvider><StoreProvider><App/></StoreProvider></AuthProvider></BrowserRouter>)
    app(); await waitFor(() => expect(window.location.pathname).toBe('/')); cleanup()
    currentUser = admin; window.history.pushState({}, '', '/admin'); app()
    fireEvent.click(await screen.findByRole('link', { name: 'Smart Replenishment' }))
    expect(await screen.findByRole('heading', { name: 'Smart Replenishment' })).toBeTruthy()
  })

  it('rejects insufficient rows with fabricated numeric results', () => {
    const malformed = structuredClone(report)
    const row = malformed.recommendations.find((item: Record<string, unknown>) => item.recommendation_status === 'PURCHASE_RECOMMENDED')
    row.recommendation_status = 'INSUFFICIENT_FORECAST'
    expect(() => parseReplenishmentReport(malformed)).toThrow(/должны быть неизвестны/)
  })
})
