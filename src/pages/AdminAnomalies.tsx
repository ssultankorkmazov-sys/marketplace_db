import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, ShieldAlert, Wifi, WifiOff, X } from 'lucide-react'
import { adminApi, type AnomalyFilters, type AnomalyIncident, type AnomalyPage, type AnomalyQueueStats, type AnomalySeverity, type AnomalyStatus, type AnomalyType, type StatisticalAnomalySnapshot } from '../api/client'
import { useAdminRealtime } from '../hooks/useAdminRealtime'
import { btn, ErrorState } from '../components/ui'
import { StatisticalDetectorPanel } from '../components/admin/StatisticalDetectorPanel'

const PAGE_SIZE = 20
const field = 'h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-brand'
const severityLabel: Record<AnomalySeverity, string> = { LOW: 'Низкий', MEDIUM: 'Средний', HIGH: 'Высокий', CRITICAL: 'Критический' }
const statusLabel: Record<AnomalyStatus, string> = { NEW: 'Новый', INVESTIGATING: 'На проверке', RESOLVED: 'Решён', FALSE_POSITIVE: 'Ложное срабатывание' }
const typeLabel: Record<AnomalyType, string> = { REPEATED_FAILED_LOGINS: 'Повторные ошибки входа', REPEATED_ADMIN_ACCESS_DENIED: 'Отказы доступа к админке', UNUSUAL_ORDER_ACTIVITY: 'Необычная активность заказов' }
const severityStyle: Record<AnomalySeverity, string> = { LOW: 'bg-slate-100 text-slate-700', MEDIUM: 'bg-amber-100 text-amber-800', HIGH: 'bg-orange-100 text-orange-800', CRITICAL: 'bg-red-100 text-red-800' }
const statusStyle: Record<AnomalyStatus, string> = { NEW: 'bg-blue-100 text-blue-800', INVESTIGATING: 'bg-violet-100 text-violet-800', RESOLVED: 'bg-green-100 text-green-800', FALSE_POSITIVE: 'bg-neutral-100 text-neutral-700' }
const dateTime = (value: string) => new Date(value).toLocaleString('ru-RU')
const display = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '—'
const eventLabel = (value: string) => value.toLowerCase().replace(/_/g, ' ')

function Pill({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>{children}</span>
}

export function AdminAnomalies() {
  const [filters, setFilters] = useState<AnomalyFilters>({ page: 1, pageSize: PAGE_SIZE })
  const [data, setData] = useState<AnomalyPage | null>(null)
  const [overview, setOverview] = useState<{ total: number; newCount: number; resolved: number; low: number; medium: number; high: number; critical: number } | null>(null)
  const [queueStats, setQueueStats] = useState<AnomalyQueueStats | null>(null)
  const [queueError, setQueueError] = useState('')
  const [statisticalStatus, setStatisticalStatus] = useState<StatisticalAnomalySnapshot | null>(null)
  const [statisticalError, setStatisticalError] = useState('')
  const [statisticalLoading, setStatisticalLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<AnomalyIncident | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [notice, setNotice] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)

  const connected = useAdminRealtime(useCallback((event) => {
    if (event.type === 'connected' || event.type === 'anomaly_incident') setRefreshTick((tick) => tick + 1)
  }, []))

  useEffect(() => {
    let active = true
    setLoading(true)
    adminApi.anomalies(filters).then((result) => {
      if (active) { setData(result); setError('') }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить инциденты.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [filters, refreshTick])

  useEffect(() => {
    let active = true
    Promise.all([
      adminApi.anomalies({ page: 1, pageSize: 1 }),
      adminApi.anomalies({ page: 1, pageSize: 1, status: 'NEW' }),
      adminApi.anomalies({ page: 1, pageSize: 1, status: 'RESOLVED' }),
    ]).then(([all, fresh, resolved]) => {
      if (active) setOverview({ total: all.total, newCount: fresh.total, resolved: resolved.total, low: all.low, medium: all.medium, high: all.high, critical: all.critical })
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить сводку.')
    })
    return () => { active = false }
  }, [refreshTick])

  useEffect(() => {
    let active = true
    setStatisticalLoading(true)
    adminApi.statisticalAnomalyStatus().then((status) => {
      if (active) { setStatisticalStatus(status); setStatisticalError('') }
    }).catch((reason: unknown) => {
      if (active) setStatisticalError(reason instanceof Error ? reason.message : 'Статус недоступен.')
    }).finally(() => { if (active) setStatisticalLoading(false) })
    return () => { active = false }
  }, [refreshTick])

  useEffect(() => {
    let active = true
    adminApi.anomalyQueueStats().then((stats) => {
      if (active) { setQueueStats(stats); setQueueError('') }
    }).catch((reason: unknown) => {
      if (active) setQueueError(reason instanceof Error ? reason.message : 'Не удалось загрузить состояние очереди.')
    })
    return () => { active = false }
  }, [refreshTick])

  useEffect(() => {
    if (!selectedId) { setSelected(null); return }
    let active = true
    setDetailLoading(true)
    adminApi.anomaly(selectedId).then((incident) => {
      if (active) { setSelected(incident); setDetailError('') }
    }).catch((reason: unknown) => {
      if (active) setDetailError(reason instanceof Error ? reason.message : 'Не удалось загрузить детали инцидента.')
    }).finally(() => { if (active) setDetailLoading(false) })
    return () => { active = false }
  }, [selectedId, refreshTick])

  const setFilter = (patch: Partial<AnomalyFilters>) => setFilters((current) => ({ ...current, ...patch, page: 1 }))
  const refresh = () => { setNotice(''); setRefreshTick((tick) => tick + 1) }
  const updateStatus = async (incident: AnomalyIncident, status: Exclude<AnomalyStatus, 'NEW'>) => {
    if (!window.confirm(`Изменить статус инцидента #${incident.incident_id} на «${statusLabel[status]}»?`)) return
    setSaving(true)
    try {
      await adminApi.updateAnomalyStatus(incident.incident_id, status)
      setNotice(`Статус инцидента #${incident.incident_id} обновлён.`)
      setRefreshTick((tick) => tick + 1)
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : 'Не удалось изменить статус.')
    } finally { setSaving(false) }
  }

  const totalPages = data?.totalPages ?? 0
  const overviewCards = [
    ['Всего инцидентов', overview?.total ?? '—', 'border-neutral-200'],
    ['Новые', overview?.newCount ?? '—', 'border-blue-200'],
    ['Высокий и критический риск', overview ? overview.high + overview.critical : '—', 'border-orange-200'],
    ['Решённые', overview?.resolved ?? '—', 'border-green-200'],
  ] as const

  return <section>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-bold md:text-2xl">Обнаруженные аномалии</h1><p className="mt-1 text-sm text-neutral-500">События, выявленные правилами мониторинга, с доказательствами и рекомендациями</p></div>
      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center gap-1.5 text-xs ${connected ? 'text-green-700' : 'text-neutral-500'}`} aria-live="polite">{connected ? <Wifi size={15}/> : <WifiOff size={15}/>} {connected ? 'Live подключён' : 'Live недоступен'}</span>
        <button className={btn.secondary} onClick={refresh}><RefreshCw size={15}/>Обновить</button>
      </div>
    </div>

    {notice && <p role="status" className="mb-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</p>}
    {error && <div className="mb-3"><ErrorState msg={error}/></div>}

    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {overviewCards.map(([label, value, border]) => <div key={label} className={`rounded-xl border ${border} bg-white p-4`}><div className="flex items-center gap-2 text-sm text-neutral-500"><ShieldAlert size={16}/>{label}</div><div className="mt-2 text-2xl font-bold">{value}</div></div>)}
    </div>
    {overview && <div className="mb-4 flex flex-wrap gap-2" aria-label="Распределение по уровню риска">{(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((severity) => <Pill key={severity} className={severityStyle[severity]}>{severityLabel[severity]} · {overview[severity.toLowerCase() as 'low' | 'medium' | 'high' | 'critical']}</Pill>)}</div>}

    <section className="mb-4 rounded-xl border border-neutral-200 bg-white p-4" aria-label="Мониторинг очереди аномалий">
      <h2 className="mb-3 text-sm font-semibold">Очередь обработки</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {([['Pending', queueStats?.pending ?? '—'], ['Processed', queueStats?.processed ?? '—'], ['Dead-letter', queueStats?.dead_letter ?? '—'], ['Ошибки обработки', queueStats?.processing_errors ?? '—'], ['Последняя обработка', queueStats?.last_processed_at ? dateTime(queueStats.last_processed_at) : '—']] as const).map(([label, value]) => <div key={label} className="rounded-lg bg-neutral-50 p-3"><div className="text-xs text-neutral-500">{label}</div><div className="mt-1 truncate text-lg font-semibold">{value}</div></div>)}
      </div>
      {queueError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">Не удалось загрузить состояние очереди: {queueError}</p>}
    </section>

    <StatisticalDetectorPanel snapshot={statisticalStatus} loading={statisticalLoading} error={statisticalError} refreshKey={refreshTick}/>

    <div className="mb-3 grid grid-cols-1 gap-2 rounded-xl border border-neutral-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
      <select className={field} aria-label="Фильтр по уровню риска" value={filters.severity ?? ''} onChange={(event) => setFilter({ severity: (event.target.value || undefined) as AnomalySeverity | undefined })}><option value="">Все уровни риска</option>{Object.entries(severityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select className={field} aria-label="Фильтр по типу аномалии" value={filters.type ?? ''} onChange={(event) => setFilter({ type: (event.target.value || undefined) as AnomalyType | undefined })}><option value="">Все типы</option>{Object.entries(typeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select className={field} aria-label="Фильтр по статусу" value={filters.status ?? ''} onChange={(event) => setFilter({ status: (event.target.value || undefined) as AnomalyStatus | undefined })}><option value="">Все статусы</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <input className={field} type="date" aria-label="Дата обнаружения с" value={filters.from ?? ''} onChange={(event) => setFilter({ from: event.target.value || undefined })}/>
      <input className={field} type="date" aria-label="Дата обнаружения по" value={filters.to ?? ''} onChange={(event) => setFilter({ to: event.target.value || undefined })}/>
    </div>

    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table className="w-full min-w-[850px] text-left text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase text-neutral-500"><tr>{['Обнаружено', 'Тип', 'Субъект', 'Риск', 'Оценка', 'События', 'Статус', ''].map((heading) => <th key={heading} className="px-3 py-3 font-medium">{heading}</th>)}</tr></thead>
        <tbody className="divide-y divide-neutral-100">
          {loading ? <tr><td colSpan={8} className="px-4 py-12 text-center text-neutral-400">Загрузка инцидентов…</td></tr>
            : !data?.incidents.length ? <tr><td colSpan={8} className="px-4 py-12 text-center text-neutral-400">Инцидентов по выбранным фильтрам нет.</td></tr>
              : data.incidents.map((incident) => <tr key={incident.incident_id} className="hover:bg-neutral-50">
                <td className="whitespace-nowrap px-3 py-3 text-neutral-600">{dateTime(incident.detected_at)}</td>
                <td className="px-3 py-3 font-medium">{typeLabel[incident.anomaly_type]}</td>
                <td className="px-3 py-3">{incident.subject_user_id === null ? '—' : `#${incident.subject_user_id}`}</td>
                <td className="px-3 py-3"><Pill className={severityStyle[incident.severity]}>{severityLabel[incident.severity]}</Pill></td>
                <td className="px-3 py-3 font-semibold">{incident.risk_score}/100</td>
                <td className="px-3 py-3">{incident.audit_log_ids?.length ?? display(incident.evidence.event_count)}</td>
                <td className="px-3 py-3"><Pill className={statusStyle[incident.status]}>{statusLabel[incident.status]}</Pill></td>
                <td className="px-3 py-3"><button className="font-medium text-brand hover:underline" onClick={() => setSelectedId(incident.incident_id)}>Детали</button></td>
              </tr>)}
        </tbody>
      </table>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-600"><span>{data?.total ?? 0} инцидентов · страница {data?.page ?? 1} из {Math.max(1, totalPages)}</span><div className="flex gap-2">
      <button className={btn.secondary} disabled={loading || (filters.page ?? 1) <= 1} onClick={() => setFilters((current) => ({ ...current, page: Math.max(1, (current.page ?? 1) - 1) }))}><ChevronLeft size={16}/>Назад</button>
      <button className={btn.secondary} disabled={loading || !data || (filters.page ?? 1) >= totalPages} onClick={() => setFilters((current) => ({ ...current, page: (current.page ?? 1) + 1 }))}>Дальше<ChevronRight size={16}/></button>
    </div></div>

    {selectedId && <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5" role="dialog" aria-modal="true" aria-label="Детали инцидента">
      <button className="absolute inset-0 bg-black/40" aria-label="Закрыть детали" onClick={() => setSelectedId(null)}/>
      <div className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Инцидент #{selectedId}</h2>{selected && <p className="mt-1 text-sm text-neutral-500">Обнаружен {dateTime(selected.detected_at)}</p>}</div><button className="rounded p-1 text-neutral-500 hover:bg-neutral-100" aria-label="Закрыть" onClick={() => setSelectedId(null)}><X size={20}/></button></div>
        {detailError && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{detailError}</p>}
        {detailLoading ? <p className="py-8 text-center text-neutral-500">Загрузка деталей…</p> : selected && <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2"><Pill className={severityStyle[selected.severity]}>{severityLabel[selected.severity]} · риск {selected.risk_score}/100</Pill><Pill className={statusStyle[selected.status]}>{statusLabel[selected.status]}</Pill><span className="text-xs text-neutral-500">Обновлён {dateTime(selected.updated_at)}</span></div>
          <section><h3 className="mb-1 font-semibold">Тип инцидента</h3><p className="text-sm text-neutral-700">{typeLabel[selected.anomaly_type]}</p></section>
          <section><h3 className="mb-1 font-semibold">Почему обнаружено</h3><p className="text-sm text-neutral-700">{selected.explanation}</p></section>
          <section><h3 className="mb-2 font-semibold">Подтверждающие данные</h3><dl className="grid gap-2 rounded-lg bg-neutral-50 p-3 text-sm sm:grid-cols-2">
            {([['Пользователь', selected.evidence.subject_user_id === null ? '—' : `#${display(selected.evidence.subject_user_id)}`], ['Событий в окне', display(selected.evidence.event_count)], ['Порог правила', display(selected.evidence.threshold)], ['Длительность окна (сек.)', display(selected.evidence.window_seconds)], ['Начало окна', display(selected.evidence.window_start)], ['Конец окна', display(selected.evidence.window_end)]] as [string, string][]).map(([label, value]) => <div key={label}><dt className="text-neutral-500">{label}</dt><dd className="break-words font-medium">{value}</dd></div>)}
          </dl></section>
          <section><h3 className="mb-2 font-semibold">Хронология событий</h3>{selected.timeline?.length ? <ol aria-label="Хронология событий" className="space-y-2">{selected.timeline.map((event) => <li key={event.log_id} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><time className="text-neutral-500" dateTime={event.created_at}>{dateTime(event.created_at)}</time><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${event.status === 'SUCCESS' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{event.status === 'SUCCESS' ? 'Успешно' : 'Ошибка'}</span></div><p className="mt-1 font-medium">{eventLabel(event.action)}</p><p className="mt-1 text-xs text-neutral-500">Событие #{event.log_id}{event.entity_type ? ` · ${event.entity_type}${event.entity_id === null ? '' : ` #${event.entity_id}`}` : ''}</p></li>)}</ol> : <p className="rounded-lg bg-neutral-50 p-3 text-sm text-neutral-500">Связанные события не найдены.</p>}</section>
          <section><h3 className="mb-2 font-semibold">Рекомендации</h3><div className="space-y-3">{selected.recommendations.map((recommendation, index) => <article key={`${selected.incident_id}-${index}`} className="rounded-lg border border-neutral-200 p-3 text-sm"><div className="mb-2 flex items-center justify-between gap-2"><Pill className={recommendation.priority === 'HIGH' ? 'bg-red-100 text-red-800' : recommendation.priority === 'MEDIUM' ? 'bg-amber-100 text-amber-800' : 'bg-neutral-100 text-neutral-700'}>Приоритет: {recommendation.priority}</Pill></div><p className="font-medium">{recommendation.action}</p><p className="mt-1 text-neutral-600"><b>Основание:</b> {recommendation.reason}</p><p className="mt-1 text-neutral-600"><b>Как проверить:</b> {recommendation.verification_step}</p></article>)}</div></section>
          {(selected.status === 'NEW' || selected.status === 'INVESTIGATING') && <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
            {selected.status === 'NEW' && <button disabled={saving} className={btn.secondary} onClick={() => void updateStatus(selected, 'INVESTIGATING')}>Начать проверку</button>}
            <button disabled={saving} className={btn.secondary} onClick={() => void updateStatus(selected, 'FALSE_POSITIVE')}>Ложное срабатывание</button>
            <button disabled={saving} className={btn.primary} onClick={() => void updateStatus(selected, 'RESOLVED')}>{saving ? 'Сохранение…' : 'Отметить решённым'}</button>
          </div>}
        </div>}
      </div>
    </div>}
    {!data && !loading && !error && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mr-2 inline" size={16}/>Сводка пока недоступна.</div>}
  </section>
}
