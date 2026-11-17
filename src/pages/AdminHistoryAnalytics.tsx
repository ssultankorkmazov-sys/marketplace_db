import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { adminApi, type JeffreysShadowEvaluation, type JeffreysShadowEvaluationFilters, type JeffreysShadowEvaluationPage, type JeffreysShadowStatus, type ReplenishmentRun, type ReplenishmentRunPage, type SavedReplenishmentRecommendation, type SavedReplenishmentRecommendationPage, type ShadowEvaluationStatus } from '../api/client'
import { btn } from '../components/ui'

type SalesData = {
  metadata: { source: 'SYNTHETIC'; start_date: string; end_date: string; timezone: string; records: number; note: string }
  products: { synthetic_product_id: string; name: string; category_name: string }[]
  sales: { date: string; synthetic_product_id: string; quantity_sold: number; active_event_names: string[]; source: 'SYNTHETIC' }[]
}
type Tab = 'synthetic' | 'history'
const panel = 'rounded-xl border border-neutral-200 bg-white p-4'
const field = 'rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm'
const statusLabel: Record<string, string> = {
  PURCHASE_RECOMMENDED: 'Рекомендуется закупка', NO_PURCHASE_NEEDED: 'Закупка не нужна', INSUFFICIENT_FORECAST: 'Недостаточно прогноза',
  PENDING: 'Ожидает решения', ACCEPTED: 'Принято', REJECTED: 'Отклонено',
  SUFFICIENT_DATA: 'Достаточно данных', INSUFFICIENT_DATA: 'Недостаточно данных', WORK_LIMIT_EXCEEDED: 'Лимит обработки', EVALUATION_ERROR: 'Ошибка оценки',
}
const dateTime = (value: string) => new Date(value).toLocaleString('ru-RU')
const quantity = (value: number | null | undefined) => value === null || value === undefined ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
const money = (value: number | null) => value === null ? '—' : `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₸`

async function loadSalesData(): Promise<SalesData> {
  const response = await fetch(`${import.meta.env.BASE_URL}demo/synthetic-sales-daily.json`)
  if (!response.ok) throw new Error(`Не удалось загрузить synthetic fixture (${response.status}).`)
  const value: unknown = await response.json()
  if (!value || typeof value !== 'object' || !('metadata' in value) || !('products' in value) || !('sales' in value)) throw new Error('Некорректный формат synthetic fixture.')
  const data = value as SalesData
  if (data.metadata?.source !== 'SYNTHETIC' || !Array.isArray(data.products) || !Array.isArray(data.sales) ||
      data.sales.some(row => row.source !== 'SYNTHETIC' || !Number.isFinite(row.quantity_sold) || row.quantity_sold < 0)) {
    throw new Error('Synthetic fixture не прошёл проверку формата.')
  }
  return data
}

function DailySalesChart({ rows, productName }: { rows: SalesData['sales']; productName: string }) {
  const points = rows.slice(-30)
  if (!points.length) return <p className="py-8 text-center text-sm text-neutral-500">Нет ежедневных записей для выбранного товара.</p>
  const max = Math.max(1, ...points.map(row => row.quantity_sold))
  const coordinates = points.map((row, index) => `${points.length === 1 ? 300 : 12 + index * 576 / (points.length - 1)},${148 - row.quantity_sold / max * 128}`).join(' ')
  return <div className="overflow-x-auto">
    <svg className="h-48 min-w-[560px] w-full" viewBox="0 0 600 170" role="img" aria-label={`Ежедневные синтетические продажи: ${productName}, последние ${points.length} дней`}>
      <title>{`Синтетические продажи: ${productName}`}</title>
      <line x1="12" y1="148" x2="588" y2="148" stroke="#d4d4d4"/>
      <polyline points={coordinates} fill="none" stroke="#b91c1c" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
      {points.map((row, index) => <circle key={`${row.date}-${index}`} cx={points.length === 1 ? 300 : 12 + index * 576 / (points.length - 1)} cy={148 - row.quantity_sold / max * 128} r="2" fill="#b91c1c"><title>{`${row.date}: ${row.quantity_sold} шт.`}</title></circle>)}
    </svg>
    <div className="flex justify-between text-xs text-neutral-500"><span>{points[0].date}</span><span>Последние 30 дней в fixture</span><span>{points[points.length - 1].date}</span></div>
  </div>
}

function SyntheticTab() {
  const [sales, setSales] = useState<SalesData | null>(null)
  const [salesError, setSalesError] = useState('')
  const [salesLoading, setSalesLoading] = useState(true)
  const [report, setReport] = useState<Awaited<ReturnType<typeof adminApi.replenishmentDemo>> | null>(null)
  const [reportError, setReportError] = useState('')
  const [productId, setProductId] = useState('')

  useEffect(() => {
    let active = true
    loadSalesData().then(data => { if (active) { setSales(data); setProductId(data.products[0]?.synthetic_product_id ?? '') } })
      .catch(error => { if (active) setSalesError(error instanceof Error ? error.message : 'Synthetic fixture недоступен.') })
      .finally(() => { if (active) setSalesLoading(false) })
    adminApi.replenishmentDemo().then(data => { if (active) setReport(data) })
      .catch(error => { if (active) setReportError(error instanceof Error ? error.message : 'Отчёт прогнозов недоступен.') })
    return () => { active = false }
  }, [])

  const selectedProduct = sales?.products.find(product => product.synthetic_product_id === productId)
  const productRows = useMemo(() => sales?.sales.filter(row => row.synthetic_product_id === productId) ?? [], [sales, productId])
  const totalUnits = useMemo(() => sales?.sales.reduce((sum, row) => sum + row.quantity_sold, 0) ?? 0, [sales])
  const reportRows = report?.recommendations.filter(row => !productId || row.synthetic_product_id === productId) ?? []
  const sourceSalesUrl = `${import.meta.env.BASE_URL}demo/synthetic-sales-daily.json`

  return <div className="space-y-4">
    <div role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><strong>Источник: SYNTHETIC.</strong> Продажи, спрос, прогнозы, запасы и поставщики являются демонстрационными и не связаны с реальными товарами MarketKZ.</div>
    {salesLoading ? <p className="py-8 text-center text-neutral-500">Загружаются synthetic sales…</p> : salesError ? <p role="alert" className={`${panel} text-sm text-red-700`}>{salesError}</p> : sales && <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Синтетические товары" value={sales.products.length}/>
        <Metric label="Дневные записанные продажи" value={sales.sales.length.toLocaleString('ru-RU')}/>
        <Metric label="Продано единиц за период" value={totalUnits.toLocaleString('ru-RU')}/>
      </div>
      <section className={panel} aria-label="Синтетическая история продаж">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold">Дневная история спроса</h2><p className="text-xs text-neutral-500">{sales.metadata.start_date} — {sales.metadata.end_date} · source SYNTHETIC</p></div>
          <label className="grid text-xs text-neutral-500">Товар<select className={field} aria-label="Товар для графика продаж" value={productId} onChange={event => setProductId(event.target.value)}>{sales.products.map(product => <option key={product.synthetic_product_id} value={product.synthetic_product_id}>{product.name} ({product.synthetic_product_id})</option>)}</select></label>
        </div>
        {selectedProduct && <p className="mt-2 text-sm">{selectedProduct.name} · {selectedProduct.category_name} · ID {selectedProduct.synthetic_product_id}</p>}
        <DailySalesChart rows={productRows} productName={selectedProduct?.name ?? productId}/>
        <p className="mt-2 text-xs text-neutral-500">График строится по фактическим строкам synthetic fixture, без генерации значений в интерфейсе. <a className="underline" href={sourceSalesUrl} target="_blank" rel="noreferrer">Открыть проекцию исходного набора</a></p>
      </section>
    </>}

    <section className={panel} aria-label="Синтетические прогнозы и рекомендации">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold">Прогноз спроса и рекомендации replenishment</h2><p className="text-xs text-neutral-500">Прогноз спроса приведён отдельно для каждой альтернативы поставщика и её периода покрытия; альтернативы не суммируются.</p></div><Link className="text-sm text-brand underline" to="/admin/replenishment">Подробный Smart Replenishment</Link></div>
      {reportError ? <p role="alert" className="mt-3 text-sm text-red-700">{reportError}</p> : !report ? <p className="mt-3 text-sm text-neutral-500">Загрузка synthetic forecast report…</p> : <>
        <p className="mt-2 text-xs text-neutral-500">Модель: {report.metadata.model} · дата расчёта: {report.metadata.as_of_date} · forecast period: {report.metadata.forecast_period.start} — {report.metadata.forecast_period.end} · source {report.metadata.source}</p>
        <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="text-xs text-neutral-500"><tr><th className="py-2 pr-3">Товар</th><th className="py-2 pr-3">Поставщик</th><th className="py-2 pr-3">Покрытие</th><th className="py-2 pr-3">Прогноз спроса</th><th className="py-2 pr-3">Рекомендуемый заказ</th><th className="py-2 pr-3">Стоимость</th><th className="py-2">Статус</th></tr></thead><tbody className="divide-y divide-neutral-100">{reportRows.map((row, index) => <tr key={`${row.synthetic_product_id}-${row.supplier_id}-${index}`}>
          <td className="py-2 pr-3">{row.product_name}<span className="block text-xs text-neutral-500">{row.synthetic_product_id}</span></td><td className="py-2 pr-3">{row.supplier_name}</td><td className="py-2 pr-3">{row.coverage_start_date} — {row.coverage_end_date}</td><td className="py-2 pr-3">{quantity(row.forecast_demand)}</td><td className="py-2 pr-3">{quantity(row.recommended_quantity)}</td><td className="py-2 pr-3">{money(row.estimated_cost)}</td><td className="py-2">{statusLabel[row.recommendation_status]}</td>
        </tr>)}</tbody></table>{reportRows.length === 0 && <p className="py-6 text-center text-sm text-neutral-500">Нет рекомендаций для выбранного товара.</p>}</div>
      </>}
    </section>
  </div>
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className={panel}><dt className="text-xs text-neutral-500">{label}</dt><dd className="mt-1 text-xl font-semibold">{value}</dd></div>
}

function HistoryTab() {
  const [runs, setRuns] = useState<ReplenishmentRunPage | null>(null)
  const [shadow, setShadow] = useState<JeffreysShadowStatus | null>(null)
  const [evaluations, setEvaluations] = useState<JeffreysShadowEvaluationPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [runPage, setRunPage] = useState(1)
  const [selectedRun, setSelectedRun] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<SavedReplenishmentRecommendationPage | null>(null)
  const [snapshotPage, setSnapshotPage] = useState(1)
  const [snapshotError, setSnapshotError] = useState('')
  const [evalFilters, setEvalFilters] = useState<JeffreysShadowEvaluationFilters>({ page: 1, pageSize: 10 })
  const [draft, setDraft] = useState({ profile: '', status: '', userId: '', from: '', to: '' })

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    Promise.all([
      adminApi.replenishmentRuns(runPage, 10),
      adminApi.jeffreysShadowStatus(),
      adminApi.jeffreysShadowEvaluations(evalFilters),
    ]).then(([runResult, shadowResult, evalResult]) => {
      if (active) { setRuns(runResult); setShadow(shadowResult); setEvaluations(evalResult) }
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить историю.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [runPage, evalFilters])

  useEffect(() => {
    if (!selectedRun) return
    let active = true
    setSnapshot(null); setSnapshotError('')
    adminApi.replenishmentRunRecommendations(selectedRun, snapshotPage, 20).then(result => { if (active) setSnapshot(result) })
      .catch(reason => { if (active) setSnapshotError(reason instanceof Error ? reason.message : 'Снимок запуска недоступен.') })
    return () => { active = false }
  }, [selectedRun, snapshotPage])

  const selectRun = (run: ReplenishmentRun) => {
    setSnapshotPage(1)
    setSelectedRun(run.run_id)
  }
  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const filters: JeffreysShadowEvaluationFilters = { page: 1, pageSize: 10 }
    if (draft.profile.trim()) filters.profile = draft.profile.trim()
    if (draft.status) filters.status = draft.status as ShadowEvaluationStatus
    if (draft.userId.trim()) filters.userId = Number(draft.userId)
    if (draft.from) filters.from = draft.from
    if (draft.to) filters.to = draft.to
    setEvalFilters(filters)
  }

  if (loading && !runs) return <p className="py-8 text-center text-neutral-500">Загрузка истории…</p>
  if (error && !runs) return <p role="alert" className={`${panel} text-sm text-red-700`}>Не удалось загрузить историю: {error}</p>
  return <div className="space-y-5">
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">Некоторые данные истории недоступны: {error}</p>}
    <section className={panel} aria-label="История запусков replenishment"><div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold">Replenishment runs и snapshots</h2><p className="text-xs text-neutral-500">Синтетические рекомендации и записи решений администратора доступны только для просмотра.</p></div><Link to="/admin/replenishment" className="text-sm text-brand underline">Smart Replenishment</Link></div>
      {!runs?.runs.length ? <p className="py-5 text-sm text-neutral-500">Запусков пока нет.</p> : <div className="mt-3 space-y-2">{runs.runs.map(run => <button key={run.run_id} onClick={() => void selectRun(run)} className={`w-full rounded-lg border p-3 text-left text-sm ${selectedRun === run.run_id ? 'border-brand bg-red-50/40' : 'border-neutral-200 hover:bg-neutral-50'}`}>
        <span className="flex flex-wrap justify-between gap-2"><strong>Запуск #{run.run_id} · {dateTime(run.created_at)}</strong><span>{run.source} · {run.model_name}</span></span><span className="mt-1 block text-xs text-neutral-600">Прогноз {run.forecast_start} — {run.forecast_end} · снимков {run.recommendation_count} · принято {run.accepted_count} · отклонено {run.rejected_count} · ожидают {run.pending_count}</span>
      </button>)}</div>}
      {runs && <Pager page={runs.page} totalPages={runs.totalPages} onPage={setRunPage} label="запусков"/>}
      {selectedRun && <div className="mt-4 border-t border-neutral-200 pt-3"><h3 className="font-medium">Снимок запуска #{selectedRun}</h3>{snapshotError ? <p role="alert" className="mt-2 text-sm text-red-700">{snapshotError}</p> : !snapshot ? <p className="mt-2 text-sm text-neutral-500">Загрузка снимка…</p> : snapshot.recommendations.length === 0 ? <p className="mt-2 text-sm text-neutral-500">Снимок пуст.</p> : <><div className="mt-2 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="text-xs text-neutral-500"><tr><th className="py-2 pr-3">Товар</th><th className="py-2 pr-3">Поставщик</th><th className="py-2 pr-3">Рекомендация</th><th className="py-2 pr-3">Решение администратора</th><th className="py-2">Дата решения</th></tr></thead><tbody className="divide-y divide-neutral-100">{snapshot.recommendations.map(row => <tr key={row.recommendation_id}><td className="py-2 pr-3">{row.product_name || row.synthetic_product_id}<span className="block text-xs text-neutral-500">{row.synthetic_product_id}</span></td><td className="py-2 pr-3">{row.supplier_name}</td><td className="py-2 pr-3">{statusLabel[row.recommendation_status]} · {quantity(row.recommended_quantity)} шт.</td><td className="py-2 pr-3">{statusLabel[row.decision_status]}</td><td className="py-2">{row.decided_at ? dateTime(row.decided_at) : '—'}</td></tr>)}</tbody></table></div><Pager page={snapshot.page} totalPages={snapshot.totalPages} onPage={setSnapshotPage} label="рекомендаций"/></>}</div>}
    </section>

    <section className={panel} aria-label="Jeffreys Shadow Mode history"><div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold">Jeffreys Shadow Mode evaluations</h2><p className="text-xs text-neutral-500">EXPERIMENTAL · исследовательские наблюдения по audit events. Divergence не является доказательством атаки.</p></div><Link to="/admin/anomalies" className="text-sm text-brand underline">Anomalies</Link></div>
      {shadow && <div className="mt-3 grid gap-2 sm:grid-cols-4"><Metric label="Shadow Mode" value={shadow.enabled ? 'Включён' : 'Выключен'}/><Metric label="Профиль" value={shadow.profile_version ?? '—'}/><Metric label="Последняя оценка" value={shadow.latest_evaluation_at ? dateTime(shadow.latest_evaluation_at) : '—'}/><Metric label="Сохранено оценок" value={Object.values(shadow.evaluation_counts).reduce((sum, count) => sum + count, 0)}/></div>}
      <form onSubmit={applyFilters} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6" aria-label="Фильтры Jeffreys evaluations"><input className={field} aria-label="Профиль оценки" placeholder="Профиль" value={draft.profile} onChange={event => setDraft({ ...draft, profile: event.target.value })}/><select className={field} aria-label="Статус оценки" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="">Все статусы</option>{(['SUFFICIENT_DATA','INSUFFICIENT_DATA','WORK_LIMIT_EXCEEDED','EVALUATION_ERROR'] as ShadowEvaluationStatus[]).map(status => <option key={status} value={status}>{statusLabel[status]}</option>)}</select><input className={field} type="number" min="1" aria-label="ID субъекта" placeholder="ID пользователя" value={draft.userId} onChange={event => setDraft({ ...draft, userId: event.target.value })}/><input className={field} type="date" aria-label="Оценки с даты" value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })}/><input className={field} type="date" aria-label="Оценки по дату" value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })}/><button className={btn.secondary} type="submit">Фильтровать оценки</button></form>
      {!evaluations?.evaluations.length ? <p className="py-5 text-sm text-neutral-500">Сохранённых оценок нет.</p> : <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[920px] text-left text-sm"><thead className="text-xs text-neutral-500"><tr><th className="py-2 pr-3">Время</th><th className="py-2 pr-3">Пользователь</th><th className="py-2 pr-3">Профиль</th><th className="py-2 pr-3">Baseline / current</th><th className="py-2 pr-3">Divergence</th><th className="py-2 pr-3">Статус</th><th className="py-2">Корреляции</th></tr></thead><tbody className="divide-y divide-neutral-100">{evaluations.evaluations.map(evaluation => <EvaluationRow key={evaluation.evaluation_id} evaluation={evaluation}/>)}</tbody></table></div>}
      {evaluations && <Pager page={evaluations.page} totalPages={evaluations.totalPages} onPage={page => setEvalFilters(current => ({ ...current, page }))} label="оценок"/>}
    </section>
  </div>
}

function EvaluationRow({ evaluation }: { evaluation: JeffreysShadowEvaluation }) {
  return <tr><td className="py-2 pr-3">{dateTime(evaluation.evaluated_at)}</td><td className="py-2 pr-3">#{evaluation.subject_user_id}</td><td className="py-2 pr-3">{evaluation.profile_version}</td><td className="py-2 pr-3">{evaluation.baseline_observations ?? '—'} / {evaluation.current_observations ?? '—'}</td><td className="py-2 pr-3">{evaluation.divergence === null ? '—' : evaluation.divergence.toFixed(4)}</td><td className="py-2 pr-3">{statusLabel[evaluation.evaluation_status]}</td><td className="py-2">{evaluation.matching_incidents.length ? `${evaluation.matching_incidents.length} врем. корр.` : '—'}</td></tr>
}

function Pager({ page, totalPages, onPage, label }: { page: number; totalPages: number; onPage: (page: number) => void; label: string }) {
  return <div className="mt-3 flex items-center justify-end gap-3 text-xs"><button className={btn.secondary} disabled={page <= 1} onClick={() => onPage(page - 1)}>Назад</button><span>Страница {page} из {Math.max(1, totalPages)} · {label}</span><button className={btn.secondary} disabled={!totalPages || page >= totalPages} onClick={() => onPage(page + 1)}>Далее</button></div>
}

export function AdminHistoryAnalytics() {
  const [tab, setTab] = useState<Tab>('synthetic')
  return <main className="mx-auto max-w-7xl p-4 md:p-6"><header className="mb-5"><h1 className="text-2xl font-bold">History &amp; Analytics</h1><p className="mt-1 text-sm text-neutral-600">Синтетическая демонстрация и история сохранённых аналитических результатов.</p></header>
    <div role="tablist" aria-label="Разделы History & Analytics" className="mb-4 flex gap-2 border-b border-neutral-200"><button role="tab" aria-selected={tab === 'synthetic'} className={`px-4 py-2 text-sm ${tab === 'synthetic' ? 'border-b-2 border-brand font-semibold text-brand' : 'text-neutral-600'}`} onClick={() => setTab('synthetic')}>Synthetic Data</button><button role="tab" aria-selected={tab === 'history'} className={`px-4 py-2 text-sm ${tab === 'history' ? 'border-b-2 border-brand font-semibold text-brand' : 'text-neutral-600'}`} onClick={() => setTab('history')}>History</button></div>
    {tab === 'synthetic' ? <SyntheticTab/> : <HistoryTab/>}
  </main>
}

export default AdminHistoryAnalytics
