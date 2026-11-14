import type { StatisticalActionCategory, StatisticalAnomalySnapshot } from '../../api/client'

const categories: StatisticalActionCategory[] = ['AUTH', 'ORDER', 'ADMIN_DENIED', 'PRODUCT_ADMIN', 'OTHER']
const statusText: Record<StatisticalAnomalySnapshot['detector_status'], string> = {
  DISABLED: 'Выключен конфигурацией',
  NOT_INTEGRATED: 'Не подключён к обработке событий',
  INSUFFICIENT_DATA: 'Недостаточно данных для оценки',
  AVAILABLE: 'Результат доступен только для эксперимента',
}

function distributionText(distribution: Record<StatisticalActionCategory, number> | null, category: StatisticalActionCategory) {
  const value = distribution?.[category]
  return value === undefined || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`
}

export function StatisticalDetectorPanel({ snapshot, loading, error }: {
  snapshot: StatisticalAnomalySnapshot | null
  loading: boolean
  error: string
}) {
  return <section className="mb-4 rounded-xl border border-violet-200 bg-white p-4" aria-label="Экспериментальный статистический детектор">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">Jeffreys Divergence · эксперимент</h2>
      <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-800">Не используется для обнаружения инцидентов</span>
    </div>
    <p className="mt-2 text-sm text-neutral-600">Исследовательский статистический показатель. Не влияет на действующие правила, риск, severity или статусы инцидентов.</p>
    {loading ? <p className="mt-3 text-sm text-neutral-500">Загрузка статуса…</p>
      : error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">Не удалось загрузить статус статистического детектора: {error}</p>
        : !snapshot ? <p className="mt-3 text-sm text-neutral-500">Статус пока недоступен.</p>
          : <>
            <p className="mt-3 text-sm font-medium" role="status">Статус: {statusText[snapshot.detector_status]}</p>
            <p className="mt-1 text-xs text-neutral-500">Калибровка: {snapshot.calibration_status === 'NOT_RUN' ? 'не проводилась' : snapshot.calibration_status === 'INSUFFICIENT_DATA' ? 'недостаточно данных' : 'достаточность подтверждена'}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Jeffreys divergence" value={snapshot.divergence === null ? '—' : snapshot.divergence.toFixed(4)} />
              <Metric label="Baseline observations" value={snapshot.baseline.sample_count ?? '—'} />
              <Metric label="Current observations" value={snapshot.current.sample_count ?? '—'} />
              <Metric label="Калибровка достаточна" value={snapshot.calibration_sufficient ? 'Да' : 'Нет'} />
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
            {snapshot.evaluated_at && <p className="mt-2 text-xs text-neutral-500">Рассчитано: {new Date(snapshot.evaluated_at).toLocaleString('ru-RU')}</p>}
          </>}
  </section>
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg bg-neutral-50 p-3"><div className="text-xs text-neutral-500">{label}</div><div className="mt-1 truncate text-lg font-semibold">{value}</div></div>
}
