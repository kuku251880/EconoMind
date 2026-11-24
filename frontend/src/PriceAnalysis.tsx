import { lazy, Suspense, useEffect, useState } from 'react'
import { errorMessage, fetchSeries } from './api'
import type { Filters, IndicatorSeries } from './api'
import { indicatorLabels, useLanguage } from './i18n'
import type { UiText } from './i18n'
import { priceCodes, priceEntry, priceSource } from './prices'

const SeriesChart = lazy(() => import('./SeriesChart'))

export function PriceAnalysis({ filters, primary }: { filters: Filters; primary: IndicatorSeries }) {
  const { t } = useLanguage()
  const [others, setOthers] = useState<IndicatorSeries[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<UiText | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    Promise.all(priceCodes.filter(code => code !== primary.code).map(code => fetchSeries({ ...filters, code }, controller.signal)))
      .then(series => { if (!controller.signal.aborted) setOthers(series) })
      .catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [filters, primary.code])

  const series = [primary, ...others]
  const values = new Map(series.map(s => [s.code, new Map(s.points.map(p => [p.period, p.value]))]))
  const periods = [...new Set(series.flatMap(s => s.points.map(p => p.period)))].sort()
  const official = !!primary.version_id || primary.source === priceSource
  const unit = primary.code.endsWith('_index') ? t('指数点', 'index points') : '%'
  const chartTitle = t(...indicatorLabels[primary.code])

  return <section className="panel min-w-0 p-5" aria-labelledby="price-title">
    <h2 id="price-title" className="text-lg font-semibold">{chartTitle}</h2>
    <p className="mt-2 text-sm text-stone-600">{official ? t(...priceEntry.method) : primary.source}</p>
    {primary.points.length > 0 && <Suspense fallback={null}><SeriesChart points={primary.points} name={chartTitle} unit={unit} /></Suspense>}
    {error && <p role="alert">{t(...error)}</p>}
    {loading && <p role="status">{t('正在加载月度指标…', 'Loading monthly indicators…')}</p>}
    {!loading && !error && periods.length === 0 && <p role="status">{t('所选月份暂无数据。', 'No observations in the selected months.')}</p>}
    {periods.length > 0 && <div className="overflow-x-auto">
      <table className="w-full text-left text-sm tabular-nums" aria-label={t('月度 CPI 明细', 'Monthly CPI details')}>
        <thead><tr><th scope="col">{t('月份', 'Month')}</th>{priceCodes.map(code =>
          <th scope="col" key={code}>{t(...indicatorLabels[code])}{code.endsWith('_index') ? '' : ' (%)'}</th>
        )}{official && <th scope="col">{t('来源', 'Source')}</th>}</tr></thead>
        <tbody>{periods.map(period => {
          const release = (primary.version_id ? primary.releases : priceEntry.releases)?.find(row => row.period === period)
          return <tr key={period}><th scope="row">{period}</th>{priceCodes.map(code => {
            const value = values.get(code)?.get(period)
            return <td key={code}>{value === undefined ? '—' : Number(value).toFixed(1) + (code.endsWith('_index') ? '' : '%')}</td>
          })}{official && <td>{release && <a className="underline" href={release.url} target="_blank" rel="noreferrer">
            {t('原表', 'Official table')} · {release.date} ↗</a>}{release?.survey_base && <span className="ml-2">{t("编制基期", "Survey base")} {release.survey_base}</span>}</td>}</tr>
        })}</tbody>
      </table>
    </div>}
  </section>
}
