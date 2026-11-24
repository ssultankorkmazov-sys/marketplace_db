import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  adminApi,
  type ReplenishmentDemoReport,
  type ReplenishmentRun,
  type SavedReplenishmentRecommendation,
  type ProcurementForecastItem
} from '../api/client'

import { btn } from '../components/ui'

type Page<T> = { items: T[]; page: number; totalPages: number; total: number }
const box = 'rounded-xl border border-neutral-200 bg-white p-4'
const input = 'rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm'
const money = (value: number | null) => value === null ? '—' : `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₸`
const date = (value: string | null) => value ? new Date(value).toLocaleString('ru-RU') : '—'
const statusLabel: Record<string, string> = {
  PURCHASE_RECOMMENDED: 'Рекомендуется закупка', NO_PURCHASE_NEEDED: 'Закупка не нужна', INSUFFICIENT_FORECAST: 'Недостаточно прогноза',
  PENDING: 'Ожидает решения', ACCEPTED: 'Принято администратором', REJECTED: 'Отклонено администратором',
}
const procurementDataStatusLabel: Record<string, string> = {
  READY: 'Окно 180 дней и продажи в ≥2 дня',
  INSUFFICIENT_DATA: 'Недостаточно истории',
  NO_SALES: 'За 180 дней продаж не зарегистрировано',
  NO_HISTORY: 'Истории продаж нет',
}

export function parseReplenishmentReport(value: unknown): ReplenishmentDemoReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректный формат демонстрационного отчёта.')
  const report = value as ReplenishmentDemoReport
  if (!report.metadata || report.metadata.source !== 'SYNTHETIC' || !Array.isArray(report.recommendations)) throw new Error('Некорректный формат демонстрационного отчёта.')
  for (const row of report.recommendations) {
    if (!row || row.source !== 'SYNTHETIC' || typeof row.product_name !== 'string' || !row.product_name.trim() || !row.synthetic_product_id.startsWith('SYN-') || !row.supplier_id.startsWith('SYN-SUP-')) throw new Error('Отчёт содержит недопустимую запись.')
    if (row.recommendation_status === 'INSUFFICIENT_FORECAST' && (row.forecast_demand !== null || row.recommended_quantity !== null || row.estimated_cost !== null)) {
      throw new Error('Для недостаточного прогноза числовые результаты должны быть неизвестны.')
    }
  }
  return report
}

export function AdminReplenishment() {
  const [report, setReport] = useState<ReplenishmentDemoReport | null>(null)
  const [forecast, setForecast] = useState<ProcurementForecastItem[]>([])
  const [forecastLoading, setForecastLoading] = useState(true)
  const [forecastError, setForecastError] = useState('')
  const [runs, setRuns] = useState<Page<ReplenishmentRun>>({ items: [], page: 1, total: 0, totalPages: 0 })
  const [selectedRun, setSelectedRun] = useState<ReplenishmentRun | null>(null)
  const [recommendations, setRecommendations] = useState<Page<SavedReplenishmentRecommendation>>({ items: [], page: 1, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [runPage, setRunPage] = useState(1)
  const [recommendationPage, setRecommendationPage] = useState(1)
  const [productFilter, setProductFilter] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const loadRuns = useCallback(async (page = runPage) => {
    const result = await adminApi.replenishmentRuns(page, 10)
    setRuns({ items: result.runs, page: result.page, total: result.total, totalPages: result.totalPages })
  }, [runPage])

  const loadRecommendations = useCallback(async (runId: string, page = recommendationPage) => {
    const result = await adminApi.replenishmentRunRecommendations(runId, page, 20)
    setRecommendations({ items: result.recommendations, page: result.page, total: result.total, totalPages: result.totalPages })
  }, [recommendationPage])

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    Promise.all([adminApi.replenishmentDemo(), adminApi.replenishmentRuns(1, 10)])
      .then(([demo, history]) => {
        if (!active) return
        setReport(parseReplenishmentReport(demo))
        setRuns({ items: history.runs, page: history.page, total: history.total, totalPages: history.totalPages })
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить данные.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true

    adminApi.procurementForecast()
      .then(result => {
        if (!result || !Array.isArray(result.forecast)) throw new Error('Backend вернул некорректный формат прогноза закупок.')
        if (active) {
          setForecast(result.forecast)
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setForecastError(
            reason instanceof Error
              ? reason.message
              : 'Не удалось загрузить прогноз закупок.'
          )
        }
      })
      .finally(() => {
        if (active) setForecastLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const selectRun = async (run: ReplenishmentRun | null) => {
    setSelectedRun(run); setRecommendationPage(1); setRecommendations({ items: [], page: 1, total: 0, totalPages: 0 }); setError('')
    if (!run) return
    setDetailsLoading(true)
    try { await loadRecommendations(run.run_id, 1) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить историю запуска.') }
    finally { setDetailsLoading(false) }
  }

  const createRun = async () => {
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await adminApi.createReplenishmentRun()
      setNotice(`Снимок сохранён как запуск #${result.run.run_id}.`)
      setRunPage(1); await loadRuns(1); await selectRun(result.run)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить запуск.') }
    finally { setSaving(false) }
  }

  const decide = async (item: SavedReplenishmentRecommendation, decision: 'ACCEPTED' | 'REJECTED') => {
    setError(''); setNotice('')
    try {
      const result = await adminApi.decideReplenishmentRecommendation(item.recommendation_id, decision)
      setNotice(result.already_recorded ? 'Это решение уже было сохранено ранее.' : 'Решение сохранено. Заказ и остатки не изменены.')
      if (selectedRun) { await loadRecommendations(selectedRun.run_id); await loadRuns() }
    } catch (reason) {
      setError((reason as { status?: number })?.status === 409 ? 'Для этой рекомендации уже записано противоположное решение. История не изменена.' : reason instanceof Error ? reason.message : 'Не удалось сохранить решение.')
    }
  }

  const shownRows = useMemo(() => {
    const rows = selectedRun ? recommendations.items : report?.recommendations ?? []
    return rows.filter(row => (!productFilter || row.synthetic_product_id === productFilter) && (!supplierFilter || row.supplier_name === supplierFilter) &&
      (!statusFilter || (selectedRun ? (row as SavedReplenishmentRecommendation).decision_status : row.recommendation_status) === statusFilter))
  }, [selectedRun, recommendations.items, report, productFilter, supplierFilter, statusFilter])

  const options = report?.recommendations ?? []
  const productIds = [...new Set(options.map(row => row.synthetic_product_id))]
  const suppliers = [...new Set(options.map(row => row.supplier_name))]
  const purchaseProducts = new Set(options.filter(row => row.recommendation_status === 'PURCHASE_RECOMMENDED').map(row => row.synthetic_product_id))
  const minimumCost = productIds.reduce<number | null>((sum, id) => {
    const costs = options.filter(row => row.synthetic_product_id === id && row.recommendation_status === 'PURCHASE_RECOMMENDED' && row.estimated_cost !== null).map(row => row.estimated_cost as number)
    if (!costs.length) return sum
    return (sum ?? 0) + Math.min(...costs)
  }, null)
  const readyForecasts = forecast.filter(item => item.data_status === 'READY')
  const purchaseRecommendations = readyForecasts.filter(item => (item.recommended_purchase ?? 0) > 0)
  const totalRecommendedPurchase = purchaseRecommendations.reduce((sum, item) => sum + (item.recommended_purchase ?? 0), 0)

  if (loading) return <div className="py-12 text-center text-neutral-500">Загрузка демонстрационных данных…</div>
  if (!report && error) return <main className="space-y-4"><h1 className="text-2xl font-bold">Smart Replenishment</h1><p role="alert" className="rounded-lg bg-red-50 p-4 text-brand">{error}</p></main>

  return <main className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Smart Replenishment</h1><p className="mt-1 text-sm text-neutral-600">Экспериментальные рекомендации по синтетическому спросу и поставщикам.</p></div>
      <button className={btn.primary} disabled={saving || !report} onClick={createRun}>{saving ? 'Сохраняем…' : 'Сохранить новый запуск'}</button></header>
    <section className={box} aria-labelledby="procurement-forecast-heading">
      <div>
        <h2 id="procurement-forecast-heading" className="text-xl font-bold">Прогноз закупок по реальным данным</h2>
        <p className="text-sm text-neutral-600">Источник: public.procurement_forecast. Продажи за 180 дней в VIEW включают Delivered и Shipped; delivered_90d отдельно считает только Delivered. Открытые заказы — количество товара в статусе Processing.</p>
        <p className="mt-1 text-xs text-neutral-500">Доступный остаток равен текущему products.stock_quantity: backend уже уменьшает его при оформлении заказа. Не вычитайте Processing повторно.</p>
        <p className="mt-1 text-xs text-neutral-500">READY требует, чтобы первая зарегистрированная продажа была не менее 180 дней назад и продажи встречались минимум в два разных дня окна. Это минимальный инженерный фильтр повторяемости, а не статистическая гарантия; полнота журнала и доступность товара по дням неизвестны.</p>
      </div>
      {forecastLoading && <p role="status" className="py-6 text-center text-neutral-500">Загрузка прогноза закупок…</p>}
      {forecastError && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">Не удалось загрузить прогноз из backend: {forecastError}</p>}
      {!forecastLoading && !forecastError && forecast.length === 0 && <p role="status" className="mt-4 rounded-lg bg-neutral-50 p-4 text-sm text-neutral-600">VIEW не вернул товаров. Данные синтетического раздела не подставляются вместо реального прогноза.</p>}
      {!forecastLoading && !forecastError && forecast.length > 0 && <>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className={box}><p className="text-sm text-neutral-500">Товаров в источнике</p><p className="text-2xl font-bold">{forecast.length}</p></div>
          <div className={box}><p className="text-sm text-neutral-500">Достаточная история</p><p className="text-2xl font-bold">{readyForecasts.length}</p></div>
          <div className={box}><p className="text-sm text-neutral-500">Рекомендуется докупить</p><p className="text-2xl font-bold">{purchaseRecommendations.length} · {totalRecommendedPurchase.toLocaleString('ru-RU')} шт.</p></div>
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50"><tr className="text-left">
              <th className="p-3">Товар</th><th className="p-3">Остаток</th><th className="p-3">Доступный остаток</th>
              <th className="p-3">Поставлено за 90 дней</th><th className="p-3">Продажи, 180 дней</th>
              <th className="p-3">Открытые заказы, шт.</th><th className="p-3">Прогноз, 30 дней</th>
              <th className="p-3">Страховой запас</th><th className="p-3">Закупить</th><th className="p-3">Статус данных</th>
            </tr></thead>
            <tbody>{forecast.map(item => {
              const sufficient = item.data_status === 'READY'
              return <tr className="border-t border-neutral-100" key={item.product_id}>
                <th className="p-3 text-left font-medium">{item.name}<span className="block text-xs text-neutral-500">ID {item.product_id}</span></th>
                <td className="p-3">{item.stock_quantity.toLocaleString('ru-RU')}</td>
                <td className="p-3">{item.available_stock.toLocaleString('ru-RU')}</td>
                <td className="p-3">{item.delivered_90d.toLocaleString('ru-RU')}</td>
                <td className="p-3">{item.sales_180d.toLocaleString('ru-RU')}<span className="block text-xs text-neutral-500">Дней с продажами: {item.sales_observation_days_180d}</span></td>
                <td className="p-3">{item.open_orders.toLocaleString('ru-RU')}</td>
                <td className="p-3">{sufficient ? item.forecast_30d?.toLocaleString('ru-RU') : '—'}</td>
                <td className="p-3">{sufficient ? item.safety_stock?.toLocaleString('ru-RU') : '—'}</td>
                <td className="p-3">{item.data_status === 'READY' && item.recommended_purchase !== null ? item.recommended_purchase.toLocaleString('ru-RU') : '—'}</td>
                <td className="p-3"><span>{procurementDataStatusLabel[item.data_status]}</span><span className="mt-1 block text-xs text-neutral-500">Охват: {item.history_days_available}/180 дней</span>{!sufficient && <span className="mt-1 block max-w-xs text-xs text-neutral-500">Остаток и заказы показаны; прогноз и закупка не рассчитываются.</span>}</td>
              </tr>
            })}</tbody>
          </table>
        </div>
      </>}
    </section>
    <div role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><strong>Источник: SYNTHETIC.</strong> This is a synthetic demonstration. These recommendations do not represent real MarketKZ stock, sales, suppliers, or purchase orders. Решение администратора фиксирует только намерение: заказ поставщику не создаётся, складские остатки не меняются.</div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-brand">{error}</p>}{notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Сводка синтетического отчёта">
      {[['Синтетические товары', String(productIds.length)], ['Альтернативы поставщиков', String(options.length)], ['Товаров с рекомендацией закупки', String(purchaseProducts.size)], ['Оценка для демонстрации', minimumCost === null ? '—' : `${money(minimumCost)} · Минимальная рассчитанная альтернатива`]].map(([label, value]) => <div className={box} key={label}><div className="text-xl font-bold">{value}</div><div className="text-xs text-neutral-500">{label}</div></div>)}
    </section>
    <section className={box} aria-label="История запусков"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">История снимков</h2><p className="text-xs text-neutral-500">Каждый запуск хранит отдельную неизменяемую копию отчёта.</p></div><span className="text-sm text-neutral-500">Всего: {runs.total}</span></div>
      {runs.items.length === 0 ? <p className="py-4 text-sm text-neutral-500">Сохранённых запусков пока нет. Нажмите «Сохранить новый запуск», чтобы создать первый снимок.</p> : <div className="space-y-2">{runs.items.map(run => <button key={run.run_id} onClick={() => void selectRun(run)} className={`w-full rounded-lg border p-3 text-left text-sm ${selectedRun?.run_id === run.run_id ? 'border-brand bg-red-50/40' : 'border-neutral-200 hover:bg-neutral-50'}`}>
        <span className="flex flex-wrap items-center justify-between gap-2"><strong>Запуск #{run.run_id} · {date(run.created_at)}</strong><span>{run.source} · {run.model_name}</span></span><span className="mt-1 block text-neutral-600">Прогноз: {run.forecast_start} — {run.forecast_end} · рекомендаций {run.recommendation_count} · принято {run.accepted_count} · отклонено {run.rejected_count} · ожидают {run.pending_count}</span>
      </button>)}</div>}
      <div className="mt-3 flex items-center justify-end gap-2"><button className={btn.secondary} disabled={runPage <= 1} onClick={() => { const page = runPage - 1; setRunPage(page); void loadRuns(page) }}>Назад</button><span className="text-xs">Страница {runs.page} из {Math.max(1, runs.totalPages)}</span><button className={btn.secondary} disabled={!runs.totalPages || runPage >= runs.totalPages} onClick={() => { const page = runPage + 1; setRunPage(page); void loadRuns(page) }}>Далее</button></div>
    </section>
    <section className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">{selectedRun ? `Снимок запуска #${selectedRun.run_id}` : 'Текущий демонстрационный отчёт'}</h2><p className="text-xs text-neutral-500">{selectedRun ? `Зафиксирован ${date(selectedRun.created_at)}; данные не пересчитываются.` : 'Предпросмотр отчёта; история и решения появятся после явного сохранения запуска.'}</p></div>
      <div className="flex flex-wrap gap-2"><label className="grid text-xs text-neutral-500">Товар<select aria-label="Фильтр по товару" className={input} value={productFilter} onChange={event => setProductFilter(event.target.value)}><option value="">Все товары</option>{productIds.map(id => <option key={id}>{id}</option>)}</select></label><label className="grid text-xs text-neutral-500">Поставщик<select aria-label="Фильтр по поставщику" className={input} value={supplierFilter} onChange={event => setSupplierFilter(event.target.value)}><option value="">Все поставщики</option>{suppliers.map(name => <option key={name}>{name}</option>)}</select></label><label className="grid text-xs text-neutral-500">Статус<select aria-label="Фильтр по статусу рекомендации" className={input} value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">Все статусы</option>{(selectedRun ? ['PENDING','ACCEPTED','REJECTED'] : ['PURCHASE_RECOMMENDED','NO_PURCHASE_NEEDED','INSUFFICIENT_FORECAST']).map(value => <option key={value} value={value}>{statusLabel[value]}</option>)}</select></label></div></div>
      {detailsLoading ? <p className="py-8 text-center text-neutral-500">Загрузка снимка…</p> : shownRows.length === 0 ? <div className={`${box} text-sm text-neutral-500`}>По выбранным фильтрам рекомендаций нет.</div> : <div className="grid gap-3">{shownRows.map((row, index) => {
        const saved = selectedRun ? row as SavedReplenishmentRecommendation : null
        const key = saved?.recommendation_id ?? `${row.synthetic_product_id}-${row.supplier_id}-${index}`
        const state = saved?.decision_status ?? row.recommendation_status
        const eligible = !!saved && saved.recommendation_status === 'PURCHASE_RECOMMENDED' && saved.decision_status === 'PENDING'
        return <article className={box} key={key}><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{row.product_name || row.synthetic_product_id} · {row.supplier_name}</h3><p className="text-xs text-neutral-500">Товар {row.synthetic_product_id} · поставщик {row.supplier_id} · {row.lead_time_days} дней доставки · источник {row.source}</p></div><span className="rounded-full bg-neutral-100 px-3 py-1 text-xs">{statusLabel[state] ?? state}</span></div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-5"><span>Склад: {row.current_stock}</span><span>Прогноз: {row.forecast_demand ?? '—'}</span><span>Страховой запас: {row.safety_stock}</span><span>В пути: {row.inbound_quantity}</span><span>MOQ: {row.minimum_order_quantity}</span><span>Упаковка: {row.pack_size}</span><span>Заказать: {row.recommended_quantity ?? '—'}</span><span>Стоимость: {money(row.estimated_cost)}</span><span>Покрытие: {row.coverage_start_date} — {row.coverage_end_date}</span></div>
          {saved?.decided_at && <p className="mt-2 text-xs text-neutral-600">Решение {saved.decision_status === 'ACCEPTED' ? 'принято' : 'отклонено'} {date(saved.decided_at)} · администратор {saved.decided_by_name ?? (saved.decided_by_user_id ? `#${saved.decided_by_user_id}` : 'не указан')}</p>}
          <button className="mt-3 text-sm font-medium text-brand underline" onClick={() => setExpanded(expanded === key ? null : key)}>{expanded === key ? 'Скрыть пояснение' : 'Пояснение'}</button>{expanded === key && <p className="mt-2 rounded-lg bg-neutral-50 p-3 text-sm">{row.explanation}</p>}
          {eligible && <div className="mt-3 flex flex-wrap gap-2"><button className={btn.primary} onClick={() => void decide(saved!, 'ACCEPTED')}>Принять рекомендацию</button><button className={btn.secondary} onClick={() => void decide(saved!, 'REJECTED')}>Отклонить</button></div>}
        </article>
      })}</div>}
      {selectedRun && <div className="flex justify-end gap-2"><button className={btn.secondary} disabled={recommendationPage <= 1} onClick={() => { const page = recommendationPage - 1; setRecommendationPage(page); void loadRecommendations(selectedRun.run_id, page) }}>Предыдущие рекомендации</button><span className="self-center text-xs">Страница {recommendations.page} из {Math.max(1, recommendations.totalPages)}</span><button className={btn.secondary} disabled={!recommendations.totalPages || recommendationPage >= recommendations.totalPages} onClick={() => { const page = recommendationPage + 1; setRecommendationPage(page); void loadRecommendations(selectedRun.run_id, page) }}>Следующие рекомендации</button></div>}
    </section>
  </main>
}

export default AdminReplenishment
