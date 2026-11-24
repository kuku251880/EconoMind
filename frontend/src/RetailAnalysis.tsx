import { lazy, Suspense, useEffect, useState } from 'react'
import type { Filters, IndicatorCode, IndicatorSeries } from './api'
import { errorMessage, fetchSeries } from './api'
import { displayUnit, indicatorLabels, useLanguage } from './i18n'
import type { UiText } from './i18n'
import { retailBasis, retailGroups, retailMethod, retailReleases, retailSource } from './retail'
import type { RetailRow } from './retail'

const SeriesChart = lazy(() => import('./SeriesChart'))

export function RetailTable({ rows, code, official }: { rows: RetailRow[]; code: IndicatorCode; official: boolean }) {
  const { t } = useLanguage()
  const basis = retailBasis(code)!
  const cumulative = basis === 'ytd'
  const [online, total, share] = retailGroups[basis]
  const grouped = new Map<string, Map<IndicatorCode, string>>()
  for (const row of rows) {
    if (retailBasis(row.code) !== basis) continue
    const values = grouped.get(row.period) ?? new Map<IndicatorCode, string>()
    values.set(row.code, row.value)
    grouped.set(row.period, values)
  }
  const title = cumulative ? t('年初至季末累计', 'Year to date') : t('当季三个月', 'Current quarter')
  return <div>
    <h3 className="mb-2 font-semibold">{title} · {t('零售明细', 'Retail details')}</h3>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm tabular-nums" aria-label={title}>
      <thead><tr><th>{t('覆盖月份', 'Months covered')}</th><th>{t('实物商品网上零售额（亿元）', 'Online physical goods (100m yuan)')}</th>
        <th>{t('社零总额（亿元）', 'Total retail (100m yuan)')}</th><th>{t('实物网零占社零', 'Online share of total retail')}</th>
        {official && <th>{t('核对原表', 'Verify source')}</th>}</tr></thead>
      <tbody>{[...grouped.keys()].sort().map(period => {
        const values = grouped.get(period)!
        const endMonth = Number(period.at(-1)) * 3
        const startMonth = cumulative ? 1 : endMonth - 2
        const releaseIndex = retailReleases.findIndex(r => r.period === period)
        const release = retailReleases[releaseIndex]
        const sources = release && !cumulative && startMonth > 1 ? [retailReleases[releaseIndex - 1], release] : [release]
        const value = (c: IndicatorCode) => {
          const raw = values.get(c)
          if (raw === undefined) return '—'
          if (c === share) return Number(raw).toFixed(cumulative ? 1 : 2) + '%'
          return raw.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
        }
        return <tr key={period}><th scope="row">{period.slice(0, 4)} · {t(`${startMonth}–${endMonth}月`, `months ${startMonth}–${endMonth}`)}</th>
          <td>{value(online)}</td><td>{value(total)}</td><td>{value(share)}</td>
          {official && <td>{sources.filter(Boolean).map(s => <a key={s.period} className="ml-2 underline" href={s.url} target="_blank" rel="noreferrer"
            title={s.date}>{s.period} ↗</a>)}</td>}</tr>
      })}</tbody>
    </table></div>
  </div>
}

export function RetailAnalysis({ filters, primary }: { filters: Filters; primary: IndicatorSeries }) {
  const { t } = useLanguage()
  const [companions, setCompanions] = useState<IndicatorSeries[] | null>(null)
  const [error, setError] = useState<UiText | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const codes = retailGroups[retailBasis(filters.code)!].filter(code => code !== filters.code)
    Promise.all(codes.map(code => fetchSeries({ ...filters, code }, controller.signal))).then(data => {
      if (!controller.signal.aborted) setCompanions(data)
    }).catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)) })
    return () => controller.abort()
  }, [filters])
  const official = primary.source === retailSource
  const unit = displayUnit(primary.unit, t)
  return <section className="panel my-5 min-w-0 p-5" aria-labelledby="retail-title">
    <h2 className="text-lg font-semibold" id="retail-title">{t(...indicatorLabels[primary.code])} ({unit})</h2>
    <p className="my-2 text-sm text-stone-600">{official ? t(...retailMethod) : primary.source}</p>
    {primary.points.length > 0 && <Suspense fallback={null}>
      <SeriesChart points={primary.points} name={t(...indicatorLabels[primary.code])} unit={unit} />
    </Suspense>}
    {error ? <p role="alert">{t(...error)}</p> : !companions ? <p role="status">{t('正在读取零售数据…', 'Loading retail data…')}</p> :
      [primary, ...companions].every(s => s.points.length === 0) ? <p role="status">{t('所选期间没有观测值。', 'No observations in this range.')}</p> :
      <RetailTable rows={[primary, ...companions].flatMap(s => s.points.map(p => ({...p, code: s.code})))} code={primary.code} official={official} />}
  </section>
}
