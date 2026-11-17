import { useEffect, useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  adminApi,
  type JeffreysShadowEvaluation,
  type JeffreysShadowEvaluationFilters,
  type JeffreysShadowEvaluationPage,
  type JeffreysShadowStatus,
  type ShadowEvaluationStatus,
  type StatisticalActionCategory,
  type StatisticalAnomalySnapshot,
} from '../../api/client'

const categories: StatisticalActionCategory[] = ['AUTH', 'ORDER', 'ADMIN_DENIED', 'PRODUCT_ADMIN', 'OTHER']
const statusText: Record<StatisticalAnomalySnapshot['detector_status'], string> = {
  DISABLED: 'Выключен конфигурацией',
  NOT_INTEGRATED: 'Не подключён к обработке событий',
  INSUFFICIENT_DATA: 'Недостаточно данных для оценки',
  AVAILABLE: 'Результат доступен только для эксперимента',
}
const evaluationStatusText: Record<ShadowEvaluationStatus, string> = {
  SUFFICIENT_DATA: 'Достаточно данных',
  INSUFFICIENT_DATA: 'Недостаточно данных',
  WORK_LIMIT_EXCEEDED: 'Превышен лимит обработки',
  EVALUATION_ERROR: 'Ошибка оценки',
}
const field = 'h-9 rounded-lg border border-neutral-300 bg-white px-2.5 text-sm outline-none focus:border-brand'
const dateTime = (value: string) => new Date(value).toLocaleString('ru-RU')
const actionName = (value: string) => value.toLowerCase().replace(/_/g, ' ')

function distributionText(distribution: Record<StatisticalActionCategory, number> | null, category: StatisticalActionCategory) {
  const value = distribution?.[category]
  return value === undefined || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`
}

export function StatisticalDetectorPanel({ snapshot, loading, error, refreshKey = 0 }: {
  snapshot: StatisticalAnomalySnapshot | null
  loading: boolean
  error: string
  refreshKey?: number
}) {
  const [shadowStatus, setShadowStatus] = useState<JeffreysShadowStatus | null>(null)
  const [shadowStatusLoading, setShadowStatusLoading] = useState(true)
  const [shadowStatusError, setShadowStatusError] = useState('')
  const [history, setHistory] = useState<JeffreysShadowEvaluationPage | null>(null)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [filters, setFilters] = useState<JeffreysShadowEvaluationFilters>({ page: 1, pageSize: 10 })
  const [draft, setDraft] = useState({ profile: '', userId: '', status: '', from: '', to: '' })

  useEffect(() => {
    let active = true
    setShadowStatusLoading(true)
    adminApi.jeffreysShadowStatus().then((result) => {
      if (active) { setShadowStatus(result); setShadowStatusError('') }
    }).catch((reason: unknown) => {
      if (active) setShadowStatusError(reason instanceof Error ? reason.message : 'Статус Shadow Mode недоступен.')
    }).finally(() => { if (active) setShadowStatusLoading(false) })
    return () => { active = false }
  }, [refreshKey])

  useEffect(() => {
    let active = true
    setHistoryLoading(true)
    adminApi.jeffreysShadowEvaluations(filters).then((result) => {
      if (active) { setHistory(result); setHistoryError('') }
    }).catch((reason: unknown) => {
      if (active) setHistoryError(reason instanceof Error ? reason.message : 'История Shadow Mode недоступна.')
    }).finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [filters, refreshKey])

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const next: JeffreysShadowEvaluationFilters = { page: 1, pageSize: 10 }
    if (draft.profile.trim()) next.profile = draft.profile.trim()
    if (draft.userId.trim()) next.userId = Number(draft.userId)
    if (draft.status) next.status = draft.status as ShadowEvaluationStatus
    if (draft.from) next.from = draft.from
    if (draft.to) next.to = draft.to
    setFilters(next)
  }

  const latest = history?.evaluations?.[0] ?? null
  const counts = shadowStatus?.evaluation_counts
  const totalPages = history?.totalPages ?? 0

  return <>
    <section className="mb-4 rounded-xl border border-violet-200 bg-white p-4" aria-label="Экспериментальный статистический детектор">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Jeffreys Divergence · эксперимент</h2>
        <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-800">Не используется для обнаружения инцидентов</span>
      </div>
      <p className="mt-2 text-sm text-neutral-600">Исследовательские измерения не являются доказательством атаки и не влияют на действующие правила, риск, severity или статусы инцидентов.</p>
      {loading ? <p className="mt-3 text-sm text-neutral-500">Загрузка статуса детектора…</p>
        : error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">Не удалось загрузить статус статистического детектора: {error}</p>
          : !snapshot ? <p className="mt-3 text-sm text-neutral-500">Статус детектора пока недоступен.</p>
            : <>
              <p className="mt-3 text-sm font-medium" role="status">Статус детектора: {statusText[snapshot.detector_status]}</p>
              <p className="mt-1 text-xs text-neutral-500">Калибровка: {snapshot.calibration_status === 'NOT_RUN' ? 'не проводилась' : snapshot.calibration_status === 'INSUFFICIENT_DATA' ? 'недостаточно данных' : 'достаточность подтверждена'}</p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Divergence (status contract)" value={snapshot.divergence === null ? '—' : snapshot.divergence.toFixed(4)}/>
                <Metric label="Baseline observations" value={snapshot.baseline.sample_count ?? '—'}/>
                <Metric label="Current observations" value={snapshot.current.sample_count ?? '—'}/>
                <Metric label="Калибровка достаточна" value={snapshot.calibration_sufficient ? 'Да' : 'Нет'}/>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-xs">
                  <thead className="text-neutral-500"><tr><th className="py-2 pr-3">Категория</th><th className="py-2 pr-3">Baseline</th><th className="py-2 pr-3">Current</th><th className="py-2">Вклад</th></tr></thead>
                  <tbody className="divide-y divide-neutral-100">{categories.map((category) => <tr key={category}>
                    <th scope="row" className="py-2 pr-3 font-medium">{category}</th>
                    <td className="py-2 pr-3">{distributionText(snapshot.baseline.distribution, category)}</td>
                    <td className="py-2 pr-3">{distributionText(snapshot.current.distribution, category)}</td>
                    <td className="py-2">{snapshot.category_contributions?.[category]?.toFixed(4) ?? '—'}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </>}
    </section>

    <section className="mb-4 rounded-xl border border-violet-200 bg-white p-4" aria-label="Jeffreys Shadow Mode">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-sm font-semibold">Shadow Mode · исследовательские измерения</h2><p className="mt-1 text-xs text-neutral-600">Только сохранённые наблюдения. Divergence не означает и не доказывает атаку.</p></div>
        <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-800">Наблюдательный режим · инциденты не изменяются</span>
      </div>
      {shadowStatusLoading ? <p className="mt-3 text-sm text-neutral-500">Загрузка состояния Shadow Mode…</p>
        : shadowStatusError ? <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">Не удалось загрузить состояние Shadow Mode: {shadowStatusError}</p>
          : shadowStatus && <>
            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Режим включён" value={shadowStatus.enabled ? 'Да' : 'Нет'}/>
              <Metric label="Профиль последней оценки" value={shadowStatus.profile_version ?? '—'}/>
              <Metric label="Последняя оценка" value={shadowStatus.latest_evaluation_at ? dateTime(shadowStatus.latest_evaluation_at) : '—'}/>
              <Metric label="Доступность хранилища" value={shadowStatus.storage_available ? 'Доступно' : 'Недоступно'}/>
            </dl>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Количество Shadow Mode оценок по статусам">
              {(['SUFFICIENT_DATA', 'INSUFFICIENT_DATA', 'WORK_LIMIT_EXCEEDED', 'EVALUATION_ERROR'] as const).map((key) => <Metric key={key} label={evaluationStatusText[key]} value={counts?.[key] ?? 0}/>)}</div>
          </>}

      {latest && <LatestEvaluation evaluation={latest}/>}

      <form onSubmit={applyFilters} className="mt-4 grid grid-cols-1 gap-2 rounded-lg border border-neutral-200 p-3 sm:grid-cols-2 lg:grid-cols-6" aria-label="Фильтры истории Jeffreys Shadow Mode">
        <input className={field} aria-label="Профиль Shadow Mode" placeholder="Профиль" value={draft.profile} onChange={(event) => setDraft((current) => ({ ...current, profile: event.target.value }))}/>
        <input className={field} aria-label="Пользователь Shadow Mode" type="number" min="1" step="1" placeholder="ID пользователя" value={draft.userId} onChange={(event) => setDraft((current) => ({ ...current, userId: event.target.value }))}/>
        <select className={field} aria-label="Статус оценки Shadow Mode" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}>
          <option value="">Все статусы</option>{Object.entries(evaluationStatusText).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <input className={field} aria-label="Дата оценки с" type="date" value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}/>
        <input className={field} aria-label="Дата оценки по" type="date" value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}/>
        <button className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700" type="submit">Применить фильтры</button>
      </form>

      {historyError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">Не удалось загрузить историю оценок: {historyError}</p>}
      <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="bg-neutral-50 text-neutral-500"><tr>{['Оценено', 'Пользователь', 'Статус', 'Baseline / current', 'Divergence', 'Временная корреляция с rule incidents'].map((label) => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-neutral-100">
            {historyLoading ? <tr><td colSpan={6} className="px-3 py-8 text-center text-neutral-500">Загрузка истории…</td></tr>
              : !history?.evaluations.length ? <tr><td colSpan={6} className="px-3 py-8 text-center text-neutral-500">Сохранённых оценок по выбранным фильтрам нет.</td></tr>
                : history.evaluations.map((evaluation) => <EvaluationRow key={evaluation.evaluation_id} evaluation={evaluation}/>)}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600">
        <span>{history?.total ?? 0} оценок · страница {history?.page ?? 1} из {Math.max(1, totalPages)}</span>
        <div className="flex gap-2">
          <button aria-label="Предыдущая страница истории Shadow Mode" className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-3 py-2 disabled:opacity-50" disabled={historyLoading || (filters.page ?? 1) <= 1} onClick={() => setFilters((current) => ({ ...current, page: Math.max(1, (current.page ?? 1) - 1) }))}><ChevronLeft size={14}/>Назад</button>
          <button aria-label="Следующая страница истории Shadow Mode" className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-3 py-2 disabled:opacity-50" disabled={historyLoading || !history || (filters.page ?? 1) >= totalPages} onClick={() => setFilters((current) => ({ ...current, page: (current.page ?? 1) + 1 }))}>Дальше<ChevronRight size={14}/></button>
        </div>
      </div>
    </section>
  </>
}

function LatestEvaluation({ evaluation }: { evaluation: JeffreysShadowEvaluation }) {
  return <section className="mt-4 rounded-lg border border-violet-100 bg-violet-50/40 p-3" aria-label="Последняя оценка Jeffreys Shadow Mode">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Последнее сохранённое измерение</h3><span className="text-xs text-neutral-500">Профиль {evaluation.profile_version} · {dateTime(evaluation.evaluated_at)}</span></div>
    <p className="mt-1 text-xs text-neutral-600">Пользователь #{evaluation.subject_user_id} · {evaluationStatusText[evaluation.evaluation_status]} · окно current: {dateTime(evaluation.current_start_at)} — {dateTime(evaluation.current_end_at)}</p>
    {evaluation.sample_counts_capped && <p className="mt-1 text-xs text-amber-800">Выборка достигла лимита чтения; divergence не следует интерпретировать как полный результат.</p>}
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Metric label="Jeffreys divergence" value={evaluation.divergence === null ? '—' : evaluation.divergence.toFixed(4)}/>
      <Metric label="Shadow baseline observations" value={evaluation.baseline_observations ?? '—'}/>
      <Metric label="Shadow current observations" value={evaluation.current_observations ?? '—'}/>
      <Metric label="Статус оценки" value={evaluationStatusText[evaluation.evaluation_status]}/>
    </div>
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-xs">
        <thead className="text-neutral-500"><tr><th className="py-1 pr-3">Категория</th><th className="py-1 pr-3">Baseline</th><th className="py-1 pr-3">Current</th><th className="py-1">Вклад</th></tr></thead>
        <tbody className="divide-y divide-neutral-100">{categories.map((category) => <tr key={category}><th scope="row" className="py-1 pr-3 font-medium">{category}</th><td className="py-1 pr-3">{distributionText(evaluation.baseline_distribution, category)}</td><td className="py-1 pr-3">{distributionText(evaluation.current_distribution, category)}</td><td className="py-1">{evaluation.category_contributions?.[category]?.toFixed(4) ?? '—'}</td></tr>)}</tbody>
      </table>
    </div>
  </section>
}

function EvaluationRow({ evaluation }: { evaluation: JeffreysShadowEvaluation }) {
  return <tr>
    <td className="whitespace-nowrap px-3 py-2">{dateTime(evaluation.evaluated_at)}<div className="text-neutral-500">{evaluation.profile_version}</div></td>
    <td className="px-3 py-2">#{evaluation.subject_user_id}</td>
    <td className="px-3 py-2">{evaluationStatusText[evaluation.evaluation_status]}{evaluation.sample_counts_capped ? <div className="text-amber-700">лимит выборки</div> : null}</td>
    <td className="px-3 py-2">{evaluation.baseline_observations ?? '—'} / {evaluation.current_observations ?? '—'}</td>
    <td className="px-3 py-2">{evaluation.divergence === null ? '—' : evaluation.divergence.toFixed(4)}</td>
    <td className="px-3 py-2">{evaluation.matching_incidents.length ? <ul className="space-y-1">{evaluation.matching_incidents.map((incident) => <li key={incident.incident_id}>#{incident.incident_id} · {actionName(incident.anomaly_type)} · {incident.status}<span className="block text-neutral-500">Только временная корреляция ({dateTime(incident.detected_at)})</span></li>)}</ul> : 'Нет совпадений по пользователю и времени'}</td>
  </tr>
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg bg-neutral-50 p-3"><div className="text-xs text-neutral-500">{label}</div><div className="mt-1 truncate text-lg font-semibold">{value}</div></div>
}
