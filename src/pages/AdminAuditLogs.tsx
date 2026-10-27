import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Activity, ChevronLeft, ChevronRight, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { adminApi, auditWebSocketUrl, type AuditLog, type AuditLogFilters, type AuditLogPage } from '../api/client'
import { btn, ErrorState } from '../components/ui'

const PAGE_SIZE = 25
const inputClass = 'h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-brand'
const actionLabel = (action: string) => action.toLowerCase().replace(/_/g, ' ')
const actions = ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'USER_REGISTERED', 'LOGOUT', 'ORDER_CREATED', 'ORDER_CREATE_FAILED', 'ORDER_STATUS_CHANGED', 'ADMIN_ORDERS_ACCESS_DENIED', 'PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_DELETED', 'PRODUCTS_ACCESS_DENIED', 'ADMIN_LOGS_ACCESS_DENIED']

export function AdminAuditLogs() {
  const [filters, setFilters] = useState<AuditLogFilters>({ page: 1, pageSize: PAGE_SIZE })
  const [query, setQuery] = useState('')
  const [data, setData] = useState<AuditLogPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [connected, setConnected] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  const refresh = useCallback(async () => {
    const result = await adminApi.logs(filters)
    setData(result)
    setError('')
    setExpanded((current) => new Set([...current].filter((id) => result.logs.some((log) => log.log_id === id))))
  }, [filters])
  const refreshRef = useRef(refresh)
  useEffect(() => { refreshRef.current = refresh }, [refresh])

  useEffect(() => {
    let active = true
    setLoading(true)
    adminApi.logs(filters).then((result) => {
      if (!active) return
      setData(result)
      setError('')
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить журнал.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [filters, refreshTick])

  useEffect(() => {
    let stopped = false
    let socket: WebSocket | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const connect = () => {
      if (stopped) return
      socket = new WebSocket(auditWebSocketUrl())
      socket.onopen = () => {
        attempts = 0
        setConnected(true)
        // Reload the REST page after each connect so events missed during a disconnect are recovered.
        void refreshRef.current().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Не удалось обновить журнал.'))
      }
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as { type?: string; log?: AuditLog }
          if (event.type === 'audit_log' && event.log) void refreshRef.current().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Не удалось обновить журнал.'))
        } catch { /* Ignore malformed or future message types; REST remains available. */ }
      }
      socket.onclose = () => {
        setConnected(false)
        if (!stopped) {
          const delay = Math.min(1000 * 2 ** attempts, 30_000)
          attempts += 1
          reconnectTimer = setTimeout(connect, delay)
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

  const setFilter = (patch: Partial<AuditLogFilters>) => setFilters((current) => ({ ...current, ...patch, page: 1 }))
  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault()
    setFilter({ q: query.trim() || undefined })
  }

  const totalPages = data?.totalPages ?? 0
  const latest = data?.logs[0]

  return <section>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-bold md:text-2xl">Журнал активности</h1><p className="mt-1 text-sm text-neutral-500">События безопасности и изменения в панели администратора</p></div>
      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center gap-1.5 text-xs ${connected ? 'text-green-700' : 'text-neutral-500'}`} aria-live="polite">
          {connected ? <Wifi size={15}/> : <WifiOff size={15}/>} {connected ? 'Live подключён' : 'Live недоступен'}
        </span>
        <button className={btn.secondary} onClick={() => setRefreshTick((tick) => tick + 1)} aria-label="Обновить журнал"><RefreshCw size={15}/>Обновить</button>
      </div>
    </div>

    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {([['Всего событий', data?.total ?? '—', Activity], ['Успешные', data?.successful ?? '—', Activity], ['Неуспешные', data?.failed ?? '—', Activity]] as const).map(([label, value, Icon], index) =>
        <div key={label} className="rounded-xl border border-neutral-200 bg-white p-4"><div className={`flex items-center gap-2 text-sm ${index === 2 ? 'text-red-700' : 'text-neutral-500'}`}><Icon size={16}/>{label}</div><div className="mt-2 text-2xl font-bold">{value}</div></div>
      )}
    </div>

    {latest && <p className="mb-3 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">Последнее событие: <b className="text-neutral-900">{actionLabel(latest.action)}</b> · {new Date(latest.created_at).toLocaleString('ru-RU')}</p>}

    <form onSubmit={submitSearch} className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3">
      <input className={`${inputClass} min-w-48 flex-1`} aria-label="Поиск событий" placeholder="Действие или ID пользователя/объекта" value={query} onChange={(event) => setQuery(event.target.value)} />
      <select className={inputClass} aria-label="Статус события" value={filters.status ?? ''} onChange={(event) => setFilter({ status: (event.target.value || undefined) as AuditLogFilters['status'] })}>
        <option value="">Все статусы</option><option value="SUCCESS">Успешно</option><option value="FAILURE">Ошибка</option>
      </select>
      <select className={inputClass} aria-label="Тип действия" value={filters.action ?? ''} onChange={(event) => setFilter({ action: event.target.value || undefined })}>
        <option value="">Все действия</option>{actions.map((action) => <option key={action} value={action}>{actionLabel(action)}</option>)}
      </select>
      <input className={`${inputClass} w-32`} type="number" min="1" aria-label="Фильтр по пользователю" placeholder="ID пользователя" value={filters.userId ?? ''} onChange={(event) => setFilter({ userId: event.target.value ? Number(event.target.value) : undefined })} />
      <input className={inputClass} type="date" aria-label="Дата с" value={filters.from ?? ''} onChange={(event) => setFilter({ from: event.target.value || undefined })} />
      <input className={inputClass} type="date" aria-label="Дата по" value={filters.to ?? ''} onChange={(event) => setFilter({ to: event.target.value || undefined })} />
      <button className={btn.primary}>Искать</button>
    </form>

    {error && <div className="mb-3"><ErrorState msg={error}/></div>}
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table className="w-full min-w-[780px] text-left text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase text-neutral-500"><tr>{['Время', 'Пользователь', 'Действие', 'Объект', 'Статус', 'Детали'].map((heading) => <th key={heading} className="px-4 py-3 font-medium">{heading}</th>)}</tr></thead>
        <tbody className="divide-y divide-neutral-100">
          {loading ? <tr><td colSpan={6} className="px-4 py-12 text-center text-neutral-400">Загрузка журнала…</td></tr>
            : !data?.logs.length ? <tr><td colSpan={6} className="px-4 py-12 text-center text-neutral-400">Событий по выбранным фильтрам нет.</td></tr>
              : data.logs.map((log) => <Fragment key={log.log_id}>
                <tr className={log.status === 'FAILURE' ? 'bg-red-50/40' : ''}>
                  <td className="whitespace-nowrap px-4 py-3 text-neutral-600">{new Date(log.created_at).toLocaleString('ru-RU')}</td>
                  <td className="px-4 py-3">{log.user_id === null ? 'Система / неизвестно' : `#${log.user_id}`}</td>
                  <td className="px-4 py-3"><span className="rounded-md bg-neutral-100 px-2 py-1 text-xs font-semibold uppercase">{actionLabel(log.action)}</span></td>
                  <td className="px-4 py-3">{log.entity_type ? `${log.entity_type}${log.entity_id === null ? '' : ` #${log.entity_id}`}` : '—'}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${log.status === 'SUCCESS' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{log.status === 'SUCCESS' ? 'Успешно' : 'Ошибка'}</span></td>
                  <td className="px-4 py-3"><button className="text-sm font-medium text-brand hover:underline" aria-expanded={expanded.has(log.log_id)} onClick={() => setExpanded((current) => { const next = new Set(current); next.has(log.log_id) ? next.delete(log.log_id) : next.add(log.log_id); return next })}>{expanded.has(log.log_id) ? 'Скрыть' : 'Подробнее'}</button></td>
                </tr>
                {expanded.has(log.log_id) && <tr key={`${log.log_id}-details`}><td colSpan={6} className="bg-neutral-50 px-4 py-3"><pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-neutral-600">{JSON.stringify(log.details, null, 2)}</pre>{log.ip_address && <p className="mt-2 text-xs text-neutral-500">IP: {log.ip_address}</p>}</td></tr>}
              </Fragment>)
          }
        </tbody>
      </table>
    </div>
    <div className="mt-3 flex items-center justify-between text-sm text-neutral-600">
      <span>{data?.total ?? 0} событий · страница {data?.page ?? 1} из {Math.max(1, totalPages)}</span>
      <div className="flex gap-2">
        <button className={btn.secondary} disabled={loading || (filters.page ?? 1) <= 1} onClick={() => setFilter({ page: Math.max(1, (filters.page ?? 1) - 1) })}><ChevronLeft size={16}/>Назад</button>
        <button className={btn.secondary} disabled={loading || !data || (filters.page ?? 1) >= totalPages} onClick={() => setFilter({ page: (filters.page ?? 1) + 1 })}>Дальше<ChevronRight size={16}/></button>
      </div>
    </div>
  </section>
}
